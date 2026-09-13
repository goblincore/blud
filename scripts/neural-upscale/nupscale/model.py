"""The ESPCN-family network: an exact mirror of upscale-model.ts (contracts §2)."""
from __future__ import annotations

import math

import torch
from torch import nn

from .constants import (DEPTH_INPUT_SCALE, HEAD_INPUT_CHANNELS, HEAD_OUT_CHANNELS, HEAD_WIDTH, HIDDEN_DILATIONS, HIDDEN_WIDTHS,
                        ICNR_SCALE, INPUT_CHANNELS, LAST_CHANNELS, NORMAL_CHANNELS)
from torch.nn import functional as F


def linear_depth(clip: torch.Tensor, near: float, far: float) -> torch.Tensor:
    """WebGPU [0, 1] clip depth -> linear view depth (upscale-reference.ts `linearDepth`)."""
    d = clip.clamp(0.0, 1.0)
    return (near * far) / (far - d * (far - near))


class RepConv(nn.Module):
    """Training-time structural reparameterisation (NTIRE-ESR style): a 3x3 conv, a 1x1 conv and
    (when shapes allow) an identity branch, summed. `fuse()` folds all three into ONE plain
    replicate-padded 3x3 conv with identical output, so the export is the same format as an
    unreparameterised model and the runtime never knows. Replicate padding makes the fold exact:
    the 1x1 and identity branches sit at the kernel centre, which never reads a padded texel."""

    def __init__(self, in_c: int, out_c: int, dilation: int = 1) -> None:
        super().__init__()
        self.conv3 = nn.Conv2d(in_c, out_c, 3, padding=dilation, dilation=dilation, padding_mode="replicate")
        self.conv1 = nn.Conv2d(in_c, out_c, 1)
        self.identity = in_c == out_c
        self.in_channels, self.out_channels, self.dilation = in_c, out_c, (dilation, dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.conv3(x) + self.conv1(x)
        return y + x if self.identity else y

    @torch.no_grad()
    def fuse(self) -> nn.Conv2d:
        d = self.dilation[0]
        fused = nn.Conv2d(self.in_channels, self.out_channels, 3, padding=d, dilation=d, padding_mode="replicate")
        w = self.conv3.weight.clone()
        w[:, :, 1, 1] += self.conv1.weight[:, :, 0, 0]
        b = self.conv3.bias + self.conv1.bias
        if self.identity:
            for c in range(self.out_channels):
                w[c, c, 1, 1] += 1.0
        fused.weight.copy_(w)
        fused.bias.copy_(b)
        return fused


class Upscaler(nn.Module):
    """3x3 replicate-padded convs at low resolution with ReLU between them (hidden layers may be
    dilated, HIDDEN_DILATIONS); the last layer has 16 channels. `forward` returns that last layer
    (N, 16, h, w); `reconstruct.reconstruct` places it. `reparam=True` trains the hidden layers as
    RepConv branches; `fused()` returns the plain equivalent for export."""

    def __init__(self, model_id: str, inputs: str, seed: int = 1, reparam: bool = False, head: bool = False,
                head_inputs: str = "detail") -> None:
        super().__init__()
        self.head_enabled = head
        if model_id not in HIDDEN_WIDTHS:
            raise ValueError(f"unknown model id {model_id!r} (expected {'|'.join(HIDDEN_WIDTHS)})")
        if inputs not in INPUT_CHANNELS:
            raise ValueError(f"unknown input set {inputs!r} (expected {'|'.join(INPUT_CHANNELS)})")
        if head_inputs not in HEAD_INPUT_CHANNELS:
            raise ValueError(f"unknown head_inputs {head_inputs!r} (expected {'|'.join(HEAD_INPUT_CHANNELS)})")
        self.model_id = model_id
        self.inputs = inputs
        self.reparam = reparam
        self.head_inputs = head_inputs
        widths = [INPUT_CHANNELS[inputs], *HIDDEN_WIDTHS[model_id], LAST_CHANNELS]
        dilations = [*HIDDEN_DILATIONS[model_id], 1]
        convs: list[nn.Module] = []
        for k, (a, b) in enumerate(zip(widths[:-1], widths[1:])):
            d = dilations[k]
            hidden = k < len(widths) - 2
            if reparam and hidden:
                convs.append(RepConv(a, b, d))
            else:
                convs.append(nn.Conv2d(a, b, 3, padding=d, dilation=d, padding_mode="replicate"))
        self.convs = nn.ModuleList(convs)
        # Run-4 head: two full-res 3x3 convs (head_in -> HEAD_WIDTH -> 3), replicate padded, ReLU between.
        head_in = HEAD_INPUT_CHANNELS[head_inputs]
        self.head = nn.ModuleList([
            nn.Conv2d(head_in, HEAD_WIDTH, 3, padding=1, padding_mode="replicate"),
            nn.Conv2d(HEAD_WIDTH, HEAD_OUT_CHANNELS, 3, padding=1, padding_mode="replicate"),
        ]) if head else None
        in_scale = torch.ones(widths[0])
        if inputs in ("rgbd", "rgbdn"):
            in_scale[4] = DEPTH_INPUT_SCALE
        self.register_buffer("in_scale", in_scale)
        self.register_buffer("in_offset", torch.zeros(widths[0]))
        self.reset_parameters(seed)

    @torch.no_grad()
    def reset_parameters(self, seed: int = 1) -> None:
        """He-normal hidden layers. ICNR last layer: one 4-channel kernel shared by the four
        sub-pixels, scaled by ICNR_SCALE, zero bias, so a fresh model starts near the nearest
        upscale without checkerboard artifacts. 'zero' is all zeros."""
        g = torch.Generator().manual_seed(seed)
        for conv in self.convs[:-1]:
            std = math.sqrt(2.0 / (conv.in_channels * 9))
            if isinstance(conv, RepConv):
                conv.conv3.weight.copy_(torch.randn(conv.conv3.weight.shape, generator=g) * std)
                conv.conv3.bias.zero_()
                conv.conv1.weight.copy_(torch.randn(conv.conv1.weight.shape, generator=g) * std)
                conv.conv1.bias.zero_()
                continue
            conv.weight.copy_(torch.randn(conv.weight.shape, generator=g) * std)
            conv.bias.zero_()
        last = self.convs[-1]
        std = math.sqrt(2.0 / (last.in_channels * 9))
        base = torch.randn((LAST_CHANNELS // 4, last.in_channels, 3, 3), generator=g) * std
        last.weight.copy_(base.repeat_interleave(4, dim=0) * ICNR_SCALE)
        last.bias.zero_()
        # Drawn last: a headless model and one with a head (any head_inputs width) share the same
        # RNG stream up to this point, so their low-res convs are bit-identical for the same seed.
        if self.head is not None:
            h0, h1 = self.head
            h0.weight.copy_(torch.randn(h0.weight.shape, generator=g) * math.sqrt(2.0 / (h0.in_channels * 9)))
            h0.bias.zero_()
            h1.weight.zero_()   # the head starts as a no-op: the network is exactly the headless one at step 0
            h1.bias.zero_()
        if self.model_id == "zero":
            for conv in [*self.convs, *(self.head or [])]:
                for m in (conv.modules() if isinstance(conv, RepConv) else [conv]):
                    if isinstance(m, nn.Conv2d):
                        m.weight.zero_()
                        m.bias.zero_()

    @staticmethod
    def head_input(rec_rgb: torch.Tensor, covered: torch.Tensor, detail: torch.Tensor, march: torch.Tensor,
                   refine: torch.Tensor | None = None) -> torch.Tensor:
        """(N, 10 or 17, 2h, 2w): reconstructed rgb, covered, detail.xyz * gate, nearest-up input rgb * hit
        [, refined world normal*gate, re-lit rgb*gate, gate] when `refine` (N, 8, 2h, 2w; xyz normal, w=1
        where written, rgb re-lit, w=accept-clip-depth) is given. Mirrors upscale-reference.ts
        `assembleHeadInput`. Channel order is a cross-language contract (TS twin)."""
        cov = covered.to(rec_rgb.dtype)
        d = detail[:, :3] * (detail[:, 3:4] > 0).to(rec_rgb.dtype)
        up = march.repeat_interleave(2, dim=2).repeat_interleave(2, dim=3)
        up_rgb = up[:, :3] * (up[:, 3:4] < 1).to(rec_rgb.dtype)
        x = torch.cat([rec_rgb * cov, cov, d, up_rgb], dim=1)
        if refine is not None:
            ga = (refine[:, 7:8] < 1).to(rec_rgb.dtype)
            x = torch.cat([x, refine[:, 0:3] * ga, refine[:, 4:7] * ga, ga], dim=1)
        return x

    def head_residual(self, rec_rgb: torch.Tensor, covered: torch.Tensor, detail: torch.Tensor, march: torch.Tensor,
                      refine: torch.Tensor | None = None) -> torch.Tensor:
        """(N, 3, 2h, 2w) rgb residual from the full-res head; zero where not covered."""
        if self.head is None:
            raise ValueError("model has no head")
        # A detail-only head ignores a refine tensor the trainer hands every head model on a refine
        # dataset (run 5: the control and the experiment train on the same v3.2 pairs).
        if self.head_inputs != "detail+refine":
            refine = None
        x = self.head_input(rec_rgb, covered, detail, march, refine)
        h0, h1 = self.head
        y = h1(torch.relu(h0(x)))
        return y * covered.to(y.dtype)

    @torch.no_grad()
    def fused(self) -> "Upscaler":
        """The plain-conv equivalent (RepConv branches folded); `self` when not reparameterised."""
        if not self.reparam:
            return self
        plain = Upscaler(self.model_id, self.inputs, reparam=False, head=self.head is not None,
                        head_inputs=self.head_inputs).to(self.in_scale.device)
        for k, conv in enumerate(self.convs):
            src = conv.fuse() if isinstance(conv, RepConv) else conv
            plain.convs[k].weight.copy_(src.weight)
            plain.convs[k].bias.copy_(src.bias)
        if self.head is not None:
            for k, conv in enumerate(self.head):
                plain.head[k].weight.copy_(conv.weight)
                plain.head[k].bias.copy_(conv.bias)
        plain.in_scale.copy_(self.in_scale)
        plain.in_offset.copy_(self.in_offset)
        return plain

    @property
    def wants_normals(self) -> bool:
        return self.inputs in ("rgbn", "rgbdn")

    def assemble(self, march: torch.Tensor, near: float, far: float) -> torch.Tensor:
        """upscale-reference.ts `assembleInput`: rgb*hit, hit[, hit*linearDepth][, normal*hit], then
        *inScale + inOffset. `march` is (N, 4, h, w), or (N, 7, h, w) with the view-space normal in
        channels 4..6 (dataset pairs that carry normal.npy) — required by the rgbn/rgbdn sets."""
        alpha = march[:, 3:4]
        hit = (alpha < 1).to(march.dtype)
        parts = [march[:, :3] * hit, hit]
        if self.inputs in ("rgbd", "rgbdn"):
            parts.append(hit * linear_depth(alpha, near, far))
        if self.wants_normals:
            if march.shape[1] < 4 + NORMAL_CHANNELS:
                raise ValueError(f"input set {self.inputs!r} needs normals (7 input channels), got {march.shape[1]}")
            parts.append(march[:, 4:4 + NORMAL_CHANNELS] * hit)
        x = torch.cat(parts, dim=1)
        return x * self.in_scale.view(1, -1, 1, 1) + self.in_offset.view(1, -1, 1, 1)

    def forward(self, march: torch.Tensor, near: float, far: float) -> torch.Tensor:
        x = self.assemble(march, near, far)
        last = len(self.convs) - 1
        for k, conv in enumerate(self.convs):
            x = conv(x)
            if k < last:
                x = torch.relu(x)
        return x
