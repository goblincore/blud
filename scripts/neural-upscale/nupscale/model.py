"""The ESPCN-family network: an exact mirror of upscale-model.ts (contracts §2)."""
from __future__ import annotations

import math

import torch
from torch import nn

from .constants import DEPTH_INPUT_SCALE, HIDDEN_WIDTHS, ICNR_SCALE, INPUT_CHANNELS, LAST_CHANNELS


def linear_depth(clip: torch.Tensor, near: float, far: float) -> torch.Tensor:
    """WebGPU [0, 1] clip depth -> linear view depth (upscale-reference.ts `linearDepth`)."""
    d = clip.clamp(0.0, 1.0)
    return (near * far) / (far - d * (far - near))


class Upscaler(nn.Module):
    """3x3 replicate-padded convs at low resolution with ReLU between them; the last layer has
    16 channels. `forward` returns that last layer (N, 16, h, w); `reconstruct.reconstruct`
    places it."""

    def __init__(self, model_id: str, inputs: str, seed: int = 1) -> None:
        super().__init__()
        if model_id not in HIDDEN_WIDTHS:
            raise ValueError(f"unknown model id {model_id!r} (expected {'|'.join(HIDDEN_WIDTHS)})")
        if inputs not in INPUT_CHANNELS:
            raise ValueError(f"unknown input set {inputs!r} (expected {'|'.join(INPUT_CHANNELS)})")
        self.model_id = model_id
        self.inputs = inputs
        widths = [INPUT_CHANNELS[inputs], *HIDDEN_WIDTHS[model_id], LAST_CHANNELS]
        self.convs = nn.ModuleList(
            nn.Conv2d(a, b, 3, padding=1, padding_mode="replicate") for a, b in zip(widths[:-1], widths[1:])
        )
        in_scale = torch.ones(widths[0])
        if inputs == "rgbd":
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
            conv.weight.copy_(torch.randn(conv.weight.shape, generator=g) * std)
            conv.bias.zero_()
        last = self.convs[-1]
        std = math.sqrt(2.0 / (last.in_channels * 9))
        base = torch.randn((LAST_CHANNELS // 4, last.in_channels, 3, 3), generator=g) * std
        last.weight.copy_(base.repeat_interleave(4, dim=0) * ICNR_SCALE)
        last.bias.zero_()
        if self.model_id == "zero":
            for conv in self.convs:
                conv.weight.zero_()
                conv.bias.zero_()

    def assemble(self, march: torch.Tensor, near: float, far: float) -> torch.Tensor:
        """upscale-reference.ts `assembleInput`: rgb*hit, hit[, hit*linearDepth], then *inScale + inOffset."""
        alpha = march[:, 3:4]
        hit = (alpha < 1).to(march.dtype)
        parts = [march[:, :3] * hit, hit]
        if self.inputs == "rgbd":
            parts.append(hit * linear_depth(alpha, near, far))
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
