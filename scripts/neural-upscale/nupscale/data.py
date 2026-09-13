"""Dataset v2 loading and training crops (contracts §1; spec §2 Sampling)."""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from .constants import CROP_IN, DATASET_FORMAT, FLIP_X, FLIP_Y, NORMAL_CHANNELS, REGION_CENTRED_SHARE, REGION_WEIGHTS
from .regions import region_masks, weight_map

SENTINEL = torch.tensor([0.0, 0.0, 0.0, 1.0])
# The no-flesh sentinel for a 7-channel input (normal channels 4..6 are 0 off flesh).
SENTINEL_N = torch.tensor([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0])


@dataclass
class Pair:
    id: str
    seq: int
    split: str
    cls: str
    showcase: bool
    inp: torch.Tensor                   # (4, h, w); (7, h, w) when the pair has normal.npy: view-space nx, ny, nz * hit
    target: torch.Tensor                # (4, 2h, 2w)
    native: torch.Tensor | None         # (4, 2h, 2w), validation pairs only
    detail: torch.Tensor | None         # (4, 2h, 2w) run-4 output-res skin-detail field (xyz noise, w gate), optional
    weight: torch.Tensor                # (1, 2h, 2w)
    masks: dict[str, torch.Tensor]      # bool (2h, 2w): flesh, face, wound, edge, interior
    centres: list[tuple[float, float]]  # face and wound centres, crop-local output px


@dataclass
class Dataset:
    root: Path
    name: str
    near: float
    far: float
    manifest_hash: str
    pairs: list[Pair] = field(default_factory=list)

    def split(self, name: str) -> list[Pair]:
        return [p for p in self.pairs if p.split == name]


def manifest_hash(path: Path | str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def chw(array: np.ndarray) -> torch.Tensor:
    return torch.from_numpy(np.ascontiguousarray(array.transpose(2, 0, 1), dtype=np.float32))


def _load(root: Path, rel: str, shape: tuple[int, ...], pid: str) -> np.ndarray:
    a = np.load(root / rel)
    if a.dtype != np.float32 or a.shape != shape:
        raise ValueError(f"pair {pid}: {rel} is {a.dtype} {a.shape}, expected float32 {shape}")
    if not np.isfinite(a).all():
        raise ValueError(f"pair {pid}: {rel} has non-finite values")
    return a


def load_dataset(root: Path | str, weights: dict[str, float] = REGION_WEIGHTS) -> Dataset:
    """Loads every pair into memory (the loader must not be the bottleneck)."""
    root = Path(root)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("format") != DATASET_FORMAT:
        raise ValueError(f"{manifest_path}: format {manifest.get('format')!r}, expected {DATASET_FORMAT!r}")
    ds = Dataset(root=root, name=root.name, near=float(manifest["near"]), far=float(manifest["far"]),
                 manifest_hash=manifest_hash(manifest_path))
    for e in manifest["pairs"]:
        pid = e["id"]
        if e["split"] not in ("train", "val"):
            raise ValueError(f"pair {pid}: split {e['split']!r}")
        h, w = int(e["crop"]["h"]), int(e["crop"]["w"])
        inp = chw(_load(root, e["files"]["in"], (h, w, 4), pid))
        normal_rel = e["files"].get("normal")
        if normal_rel:
            normal = chw(_load(root, normal_rel, (h, w, NORMAL_CHANNELS), pid))
            inp = torch.cat([inp, normal * (inp[3:4] < 1)], dim=0)
        target = chw(_load(root, e["files"]["target"], (2 * h, 2 * w, 4), pid))
        native_rel = e["files"].get("native")
        native = chw(_load(root, native_rel, (2 * h, 2 * w, 4), pid)) if native_rel else None
        detail_rel = e["files"].get("detail")
        detail = chw(_load(root, detail_rel, (2 * h, 2 * w, 4), pid)) if detail_rel else None
        regions = e.get("regions") or {}
        heads = [(r["x"], r["y"], r["r"]) for r in regions.get("heads", [])]
        wounds = [(r["x"], r["y"], r["r"]) for r in regions.get("wounds", [])]
        masks = region_masks(target[3], inp[3], heads, wounds)
        ds.pairs.append(Pair(
            id=pid, seq=int(e["seq"]), split=e["split"], cls=e["class"], showcase=bool(e.get("showcase", False)),
            inp=inp, target=target, native=native, detail=detail, weight=weight_map(masks, weights), masks=masks,
            centres=[(float(x), float(y)) for x, y, _ in heads + wounds],
        ))
    if not ds.pairs:
        raise ValueError(f"{manifest_path}: no pairs")
    return ds


def paste(src: torch.Tensor, ox: int, oy: int, size: int, fill: torch.Tensor) -> torch.Tensor:
    """The size x size window of src (C, H, W) with top-left (ox, oy); outside src is `fill` (C,)."""
    c, h, w = src.shape
    out = fill.to(src.dtype).view(c, 1, 1).repeat(1, size, size)
    x0, y0 = max(ox, 0), max(oy, 0)
    x1, y1 = min(ox + size, w), min(oy + size, h)
    if x1 > x0 and y1 > y0:
        out[:, y0 - oy:y1 - oy, x0 - ox:x1 - ox] = src[:, y0:y1, x0:x1]
    return out


class CropSampler:
    """crop x crop input windows (2x target windows). `region_share` of them are centred (with a
    small jitter) on a face or wound when the pair has one; the rest on a random target flesh
    pixel. Pair crops smaller than the window are padded with the no-flesh sentinel, never resized."""

    def __init__(self, pairs: list[Pair], crop: int = CROP_IN, seed: int = 1,
                 region_share: float = REGION_CENTRED_SHARE, flip_x: float = FLIP_X, flip_y: float = FLIP_Y,
                 negate_x: tuple[int, ...] = (), negate_y: tuple[int, ...] = ()) -> None:
        """flip_x / flip_y: probability a window is mirrored along that axis (input, target and
        weight together). negate_x / negate_y: input channels that are vector components along
        that axis (a normal's x or y) and change sign under the mirror."""
        if not pairs:
            raise ValueError("CropSampler: no pairs")
        self.pairs = pairs
        self.crop = crop
        self.region_share = region_share
        self.flip_x, self.flip_y = flip_x, flip_y
        # Pairs with normals (7 channels): view space is x right, y up, so mirroring columns
        # negates nx (channel 4) and mirroring rows negates ny (channel 5), unless told otherwise.
        with_normals = pairs[0].inp.shape[0] == 4 + NORMAL_CHANNELS
        if with_normals and not negate_x and not negate_y:
            negate_x, negate_y = (4,), (5,)
        self.sentinel = SENTINEL_N if with_normals else SENTINEL
        self.negate_x, self.negate_y = tuple(negate_x), tuple(negate_y)
        self.rng = random.Random(seed)
        self.flesh = [p.masks["flesh"].nonzero() for p in pairs]

    def _origin(self, centre: float, n: int) -> int:
        if n >= self.crop:
            return min(max(int(round(centre - self.crop / 2)), 0), n - self.crop)
        return self.rng.randint(n - self.crop, 0)

    def window(self, k: int) -> tuple[int, int]:
        """The input-px origin (x, y) of a window on pair k."""
        p = self.pairs[k]
        _, h, w = p.inp.shape
        jitter = self.crop / 8
        if p.centres and self.rng.random() < self.region_share:
            x, y = self.rng.choice(p.centres)
            cx = x / 2 + self.rng.uniform(-jitter, jitter)
            cy = y / 2 + self.rng.uniform(-jitter, jitter)
        elif len(self.flesh[k]):
            yy, xx = self.flesh[k][self.rng.randrange(len(self.flesh[k]))].tolist()
            cx, cy = (xx + 0.5) / 2, (yy + 0.5) / 2
        else:
            cx, cy = w / 2, h / 2
        return self._origin(cx, w), self._origin(cy, h)

    def sample(self, batch: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """march (B, 4 or 7, c, c), target (B, 4, 2c, 2c), weight (B, 1, 2c, 2c)."""
        c = self.crop
        one = torch.ones(1)
        marches, targets, weights = [], [], []
        for _ in range(batch):
            k = self.rng.randrange(len(self.pairs))
            p = self.pairs[k]
            ox, oy = self.window(k)
            m = paste(p.inp, ox, oy, c, self.sentinel)
            t = paste(p.target, 2 * ox, 2 * oy, 2 * c, SENTINEL)
            w = paste(p.weight, 2 * ox, 2 * oy, 2 * c, one)
            # Mirroring is exact for the §4 reconstruction: output column 2i-1-x swaps the
            # sub-pixel parity AND the neighbour direction, which is what a mirrored input has.
            if self.rng.random() < self.flip_x:
                m, t, w = m.flip(2), t.flip(2), w.flip(2)
                for ch in self.negate_x:
                    m[ch] = -m[ch]
            if self.rng.random() < self.flip_y:
                m, t, w = m.flip(1), t.flip(1), w.flip(1)
                for ch in self.negate_y:
                    m[ch] = -m[ch]
            marches.append(m)
            targets.append(t)
            weights.append(w)
        return torch.stack(marches), torch.stack(targets), torch.stack(weights)
