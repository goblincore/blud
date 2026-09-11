"""PNG crops for the dashboard showcase (spec §4)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from PIL import Image

BACKGROUND = (22, 24, 28)


def to_rgb8(march: torch.Tensor) -> np.ndarray:
    """(4, H, W) march convention -> (H, W, 3) uint8: Reinhard, gamma 2.2; no flesh = BACKGROUND."""
    m = march.detach().cpu().to(torch.float32)
    rgb = m[:3].clamp(min=0)
    mapped = (rgb / (1 + rgb)).pow(1 / 2.2)
    u8 = (mapped * 255 + 0.5).clamp(0, 255).to(torch.uint8).permute(1, 2, 0).numpy().copy()
    u8[(m[3] >= 1).numpy()] = BACKGROUND
    return u8


def enlarge_factor(h: int, w: int, target_px: int = 320, cap: int = 8) -> int:
    return int(max(1, min(cap, round(target_px / max(h, w)))))


def save_march_png(march: torch.Tensor, path: Path | str, factor: int | None = None) -> int:
    """Saves enlarged with nearest filtering so pixels stay visible. Returns the factor."""
    u8 = to_rgb8(march)
    h, w = u8.shape[:2]
    f = factor or enlarge_factor(h, w)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(u8).resize((w * f, h * f), Image.NEAREST).save(path)
    return f
