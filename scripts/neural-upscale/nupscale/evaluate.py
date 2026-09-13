"""Validation metrics and baselines (spec §2 Validation, §6 G4).

Every error is flesh-masked mean |Δ log1p rgb| against the SUPERSAMPLED target, pixel-weighted
across pairs. Target flesh a prediction leaves uncovered counts as black."""
from __future__ import annotations

from typing import Callable, Iterable

import torch

from .constants import BICUBIC_A, BICUBIC_MIN_WEIGHT, CLASSES, G4_KEYS
from .data import Pair
from .reconstruct import neighbours, predict, reconstruct
from .regions import REGIONS

METRIC_KEYS = ("overall", *REGIONS, *(f"class:{c}" for c in CLASSES), "coverage_error_rate")


@torch.no_grad()
def predict_model(model, pair: Pair, near: float, far: float, device: torch.device | None = None) -> torch.Tensor:
    """(4, 2h, 2w) in the march convention, on the CPU."""
    device = device or next(model.parameters()).device
    march = pair.inp.unsqueeze(0).to(device)
    detail = pair.detail.unsqueeze(0).to(device) if pair.detail is not None else None
    refine = pair.refine.unsqueeze(0).to(device) if pair.refine is not None else None
    return predict(model, march, near, far, detail, refine).march()[0].cpu()


@torch.no_grad()
def predict_nearest(pair: Pair) -> torch.Tensor:
    """The zero model: nearest colour, coverage = the own texel's."""
    march = pair.inp.unsqueeze(0)
    _, _, h, w = march.shape
    return reconstruct(march, torch.zeros(1, 16, h, w)).march()[0]


def cubic(t: torch.Tensor, a: float = BICUBIC_A) -> torch.Tensor:
    t = t.abs()
    inner = (a + 2) * t**3 - (a + 3) * t**2 + 1
    outer = a * t**3 - 5 * a * t**2 + 8 * a * t - 4 * a
    return torch.where(t <= 1, inner, torch.where(t < 2, outer, torch.zeros_like(t)))


def _taps(n: int, a: float) -> tuple[torch.Tensor, torch.Tensor]:
    """For 2n output positions: 4 edge-clamped input tap indices and their cubic weights."""
    u = (torch.arange(2 * n, dtype=torch.float64) + 0.5) / 2 - 0.5
    base = torch.floor(u).long()
    idx = torch.stack([base + k for k in (-1, 0, 1, 2)], dim=1)
    wts = cubic(u.unsqueeze(1) - idx.to(torch.float64), a).to(torch.float32)
    return idx.clamp(0, n - 1), wts


@torch.no_grad()
def predict_bicubic(pair: Pair, a: float = BICUBIC_A) -> torch.Tensor:
    """Coverage-aware bicubic: flesh taps only, weights renormalized (falling back to the nearest
    colour when the flesh taps carry less than BICUBIC_MIN_WEIGHT); coverage and depth from the
    nearest texel."""
    inp = pair.inp
    _, h, w = inp.shape
    hit = (inp[3] < 1).to(torch.float32)
    rgb = inp[:3] * hit
    iy, wy = _taps(h, a)
    ix, wx = _taps(w, a)
    num = torch.zeros(3, 2 * h, 2 * w)
    den = torch.zeros(2 * h, 2 * w)
    for ky in range(4):
        rows_rgb = rgb.index_select(1, iy[:, ky])
        rows_hit = hit.index_select(0, iy[:, ky])
        for kx in range(4):
            tap = wy[:, ky].view(-1, 1) * wx[:, kx].view(1, -1) * rows_hit.index_select(1, ix[:, kx])
            num += tap * rows_rgb.index_select(2, ix[:, kx])
            den += tap
    own = neighbours(inp.unsqueeze(0))[0][0]
    covered = own[3] < 1
    smooth = torch.where(den > BICUBIC_MIN_WEIGHT, num / den.clamp(min=BICUBIC_MIN_WEIGHT), own[:3])
    out_rgb = torch.where(covered, smooth.clamp(min=0), torch.zeros_like(smooth))
    depth = torch.where(covered, own[3], torch.ones_like(own[3]))
    return torch.cat([out_rgb, depth[None]], dim=0)


def pair_errors(pred: torch.Tensor, pair: Pair) -> dict[str, tuple[float, int]]:
    """(sum, count) per metric key for one prediction (4, 2h, 2w)."""
    flesh = pair.masks["flesh"]
    err = (torch.log1p(pred[:3].clamp(min=0)) - torch.log1p(pair.target[:3].clamp(min=0))).abs().mean(dim=0)
    sums: dict[str, tuple[float, int]] = {}

    def add(key: str, m: torch.Tensor) -> None:
        sums[key] = (float(err[m].sum()), int(m.sum()))

    add("overall", flesh)
    for r in REGIONS:
        add(r, pair.masks[r] & flesh)
    add(f"class:{pair.cls}", flesh)
    sums["coverage_error_rate"] = (float(((pred[3] < 1) != flesh).sum()), flesh.numel())
    return sums


def aggregate(per_pair: Iterable[dict[str, tuple[float, int]]]) -> dict[str, float | None]:
    total = {k: [0.0, 0] for k in METRIC_KEYS}
    for sums in per_pair:
        for k, (s, n) in sums.items():
            acc = total.setdefault(k, [0.0, 0])
            acc[0] += s
            acc[1] += n
    return {k: (s / n if n else None) for k, (s, n) in total.items()}


def evaluate(predict: Callable[[Pair], torch.Tensor], pairs: list[Pair]) -> dict[str, float | None]:
    return aggregate(pair_errors(predict(p), p) for p in pairs)


def beats(model: dict, baseline: dict, keys: Iterable[str] = G4_KEYS) -> dict[str, bool | None]:
    """Per key: model error < baseline error, or None when either side has no data."""
    out: dict[str, bool | None] = {}
    for k in keys:
        m, b = model.get(k), baseline.get(k)
        out[k] = None if m is None or b is None else m < b
    return out


def g4_pass(model: dict, bicubic: dict) -> bool:
    """Spec §6 G4: beats coverage-aware bicubic on every G4 key (missing data does not pass)."""
    return all(v is True for v in beats(model, bicubic).values())
