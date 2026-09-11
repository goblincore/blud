"""Training loss (spec §2 Loss). Every term is on output pixels and weighted per pixel."""
from __future__ import annotations

import torch
import torch.nn.functional as F

from .constants import COVERAGE_MARGIN, COVERAGE_WEIGHT, DETAIL_WEIGHT
from .reconstruct import Reconstruction


def upscale_loss(rec: Reconstruction, target: torch.Tensor, weight: torch.Tensor, *,
                 margin: float = COVERAGE_MARGIN, detail_weight: float = DETAIL_WEIGHT,
                 coverage_weight: float = COVERAGE_WEIGHT) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
    """target (N, 4, 2h, 2w) supersampled, clip depth in alpha; weight (N, 1, 2h, 2w).

    colour:   weighted L1 on log1p(rgb), over target flesh that has a §4 source.
    detail:   weighted L1 on the x and y finite differences of log1p(rgb), same mask.
    coverage: hinge — target flesh wants margin >= +margin, non-flesh wants <= -margin.
              Target flesh with no §4 source can never be covered, so it is left out.
    Returns (total, parts); parts are detached."""
    flesh = target[:, 3:4] < 1
    mask = flesh & rec.src_exists
    pred = torch.log1p((rec.src_rgb + rec.res_rgb).clamp(min=0))
    tgt = torch.log1p(target[:, :3].clamp(min=0))

    w = weight * mask
    colour = (w * (pred - tgt).abs()).sum() / (3 * w.sum()).clamp(min=1e-6)

    dx = (pred[..., 1:] - pred[..., :-1]) - (tgt[..., 1:] - tgt[..., :-1])
    wx = torch.maximum(weight[..., 1:], weight[..., :-1]) * (mask[..., 1:] & mask[..., :-1])
    dy = (pred[..., 1:, :] - pred[..., :-1, :]) - (tgt[..., 1:, :] - tgt[..., :-1, :])
    wy = torch.maximum(weight[..., 1:, :], weight[..., :-1, :]) * (mask[..., 1:, :] & mask[..., :-1, :])
    detail = ((wx * dx.abs()).sum() + (wy * dy.abs()).sum()) / (3 * (wx.sum() + wy.sum())).clamp(min=1e-6)

    hinge = torch.where(flesh, F.relu(margin - rec.margin), F.relu(rec.margin + margin))
    wc = weight * ~(flesh & ~rec.src_exists)
    coverage = (wc * hinge).sum() / wc.sum().clamp(min=1e-6)

    total = colour + detail_weight * detail + coverage_weight * coverage
    return total, {"colour": colour.detach(), "detail": detail.detach(), "coverage": coverage.detach()}
