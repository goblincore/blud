"""Spec §4 reconstruction, vectorized (upscale-reference.ts `reconstructPixel`)."""
from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn.functional as F


@dataclass
class Reconstruction:
    rgb: torch.Tensor         # (N, 3, 2h, 2w): max(src + residual, 0) where covered, else 0
    depth: torch.Tensor       # (N, 1, 2h, 2w): the source texel's clip depth where covered, else 1.0
    covered: torch.Tensor     # (N, 1, 2h, 2w) bool
    margin: torch.Tensor      # (N, 1, 2h, 2w): ownHit + coverage residual - 0.5
    src_rgb: torch.Tensor     # (N, 3, 2h, 2w): the §4 source texel's rgb (meaningless where no source)
    res_rgb: torch.Tensor     # (N, 3, 2h, 2w): the predicted rgb residual
    src_exists: torch.Tensor  # (N, 1, 2h, 2w) bool

    def march(self) -> torch.Tensor:
        """The output in the march convention: rgb, clip depth in alpha (1.0 = no flesh)."""
        return torch.cat([self.rgb, self.depth], dim=1)


def _axis(n: int, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    """For 2n output positions: the own texel index and the §4 neighbour index (edge-clamped)."""
    out = torch.arange(2 * n, device=device)
    own = out // 2
    step = (out % 2) * 2 - 1  # sub-pixel 0 looks at -1, sub-pixel 1 at +1
    return own, (own + step).clamp(0, n - 1)


def neighbours(march: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """The own, horizontal, vertical and diagonal candidate texels, each (N, 4, 2h, 2w)."""
    _, _, h, w = march.shape
    ys, nys = _axis(h, march.device)
    xs, nxs = _axis(w, march.device)
    rows = march.index_select(2, ys)
    rows_n = march.index_select(2, nys)
    return rows.index_select(3, xs), rows.index_select(3, nxs), rows_n.index_select(3, xs), rows_n.index_select(3, nxs)


def reconstruct(march: torch.Tensor, last: torch.Tensor) -> Reconstruction:
    """march (N, 4, h, w), clip depth in alpha; last (N, 16, h, w) from `Upscaler`."""
    if last.shape[1] != 16 or last.shape[2:] != march.shape[2:]:
        raise ValueError(f"reconstruct: last layer {tuple(last.shape)} does not fit march {tuple(march.shape)}")
    res = F.pixel_shuffle(last, 2)
    own, hor, ver, diag = neighbours(march)
    own_hit = own[:, 3:4] < 1
    hor_hit = hor[:, 3:4] < 1
    ver_hit = ver[:, 3:4] < 1
    diag_hit = diag[:, 3:4] < 1
    src = torch.where(ver_hit, ver, diag)
    src = torch.where(hor_hit, hor, src)
    src = torch.where(own_hit, own, src)
    src_exists = own_hit | hor_hit | ver_hit | diag_hit
    margin = own_hit.to(res.dtype) + res[:, 3:4] - 0.5
    covered = (margin > 0) & src_exists
    src_rgb = src[:, :3]
    res_rgb = res[:, :3]
    rgb = torch.where(covered, (src_rgb + res_rgb).clamp(min=0), torch.zeros_like(src_rgb))
    depth = torch.where(covered, src[:, 3:4], torch.ones_like(margin))
    return Reconstruction(rgb=rgb, depth=depth, covered=covered, margin=margin,
                          src_rgb=src_rgb, res_rgb=res_rgb, src_exists=src_exists)
