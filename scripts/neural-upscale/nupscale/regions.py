"""Region masks and per-pixel loss weights (spec §2 Loss; contracts §1 regions)."""
from __future__ import annotations

from typing import Iterable

import torch
import torch.nn.functional as F

from .constants import EDGE_BAND_PX, MIN_REGION_RADIUS_PX, REGION_WEIGHTS

REGIONS = ("face", "wound", "edge", "interior")


def disc_mask(h: int, w: int, circles: Iterable[tuple[float, float, float]]) -> torch.Tensor:
    """Pixels whose centre (X + 0.5, Y + 0.5) lies inside any circle (x, y, r), in the same px
    frame. Radii below MIN_REGION_RADIUS_PX are raised to it, so a far head still marks pixels."""
    mask = torch.zeros(h, w, dtype=torch.bool)
    yy = (torch.arange(h, dtype=torch.float32) + 0.5).view(-1, 1)
    xx = (torch.arange(w, dtype=torch.float32) + 0.5).view(1, -1)
    for x, y, r in circles:
        r = max(float(r), MIN_REGION_RADIUS_PX)
        mask |= (xx - float(x)) ** 2 + (yy - float(y)) ** 2 <= r * r
    return mask


def dilate(mask: torch.Tensor, px: int) -> torch.Tensor:
    """Chebyshev dilation by `px`. Outside the image counts as False (no wrap)."""
    if px <= 0:
        return mask.clone()
    m = mask.to(torch.float32)[None, None]
    return F.max_pool2d(m, kernel_size=2 * px + 1, stride=1, padding=px)[0, 0] > 0.5


def region_masks(target_alpha: torch.Tensor, input_alpha: torch.Tensor,
                 heads: list[tuple[float, float, float]], wounds: list[tuple[float, float, float]]) -> dict[str, torch.Tensor]:
    """Bool masks over the target (2h, 2w): flesh, face, wound, edge, interior.

    edge = target flesh within EDGE_BAND_PX of non-flesh, or where the input's nearest coverage
    and the target's coverage disagree. interior = flesh in no other region."""
    th, tw = target_alpha.shape
    if input_alpha.shape[0] * 2 != th or input_alpha.shape[1] * 2 != tw:
        raise ValueError(f"region_masks: input {tuple(input_alpha.shape)} is not half of target {(th, tw)}")
    flesh = target_alpha < 1
    input_up = (input_alpha < 1).repeat_interleave(2, dim=0).repeat_interleave(2, dim=1)
    edge = (flesh & dilate(~flesh, EDGE_BAND_PX)) | (input_up != flesh)
    face = disc_mask(th, tw, heads)
    wound = disc_mask(th, tw, wounds)
    interior = flesh & ~edge & ~face & ~wound
    return {"flesh": flesh, "face": face, "wound": wound, "edge": edge, "interior": interior}


def weight_map(masks: dict[str, torch.Tensor], weights: dict[str, float] = REGION_WEIGHTS) -> torch.Tensor:
    """Per-pixel loss weight (1, 2h, 2w): the LARGEST weight of the regions covering a pixel,
    never the product. Pixels in no region get the interior weight."""
    w = torch.full(masks["flesh"].shape, float(weights["interior"]), dtype=torch.float32)
    for name in ("edge", "face", "wound"):
        w = torch.where(masks[name], w.clamp(min=float(weights[name])), w)
    return w[None]
