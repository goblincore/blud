"""Test fixtures: synthetic marches, scalar ports of the TypeScript twin, a dataset v2 writer."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import torch

from nupscale.constants import DATASET_FORMAT


def random_march(h: int, w: int, seed: int, cover: float = 0.4) -> torch.Tensor:
    """(4, h, w): HDR rgb on a central disc of flesh plus speckle; alpha = clip depth, 1.0 off flesh.
    The speckle leaves isolated texels, which exercise the §4 neighbour search."""
    g = torch.Generator().manual_seed(seed)
    rgb = torch.rand((3, h, w), generator=g) * 2.0
    depth = 0.9 + 0.09 * torch.rand((h, w), generator=g)
    yy = (torch.arange(h, dtype=torch.float32) + 0.5).view(-1, 1)
    xx = (torch.arange(w, dtype=torch.float32) + 0.5).view(1, -1)
    flesh = (xx - w / 2) ** 2 + (yy - h / 2) ** 2 <= cover * h * w / math.pi
    flesh = flesh | (torch.rand((h, w), generator=g) < 0.05)
    alpha = torch.where(flesh, depth, torch.ones(h, w))
    return torch.cat([rgb * flesh, alpha[None]], dim=0)


def upsample_nearest(march: torch.Tensor) -> torch.Tensor:
    return march.repeat_interleave(2, dim=-2).repeat_interleave(2, dim=-1)


def hwc(t: torch.Tensor) -> np.ndarray:
    return np.ascontiguousarray(t.permute(1, 2, 0).numpy(), dtype="<f4")


def scalar_forward(model, march: torch.Tensor, near: float, far: float) -> list:
    """upscale-reference.ts assembleInput + conv3x3 chain in plain Python. march (4, h, w).
    Returns the last layer as nested lists [16][h][w]."""
    _, h, w = march.shape
    scale, offset = model.in_scale.tolist(), model.in_offset.tolist()
    m = march.tolist()
    x = []
    for c in range(len(scale)):
        plane = []
        for yy in range(h):
            row = []
            for xx in range(w):
                a = m[3][yy][xx]
                hit = 1.0 if a < 1 else 0.0
                raw = m[c][yy][xx] * hit if c < 3 else hit if c == 3 else hit * (near * far / (far - a * (far - near)))
                row.append(raw * scale[c] + offset[c])
            plane.append(row)
        x.append(plane)
    last = len(model.convs) - 1
    for k, conv in enumerate(model.convs):
        weights = conv.weight.detach().reshape(-1).tolist()
        bias = conv.bias.detach().tolist()
        in_c, out_c = conv.in_channels, conv.out_channels
        out = [[[0.0] * w for _ in range(h)] for _ in range(out_c)]
        for o in range(out_c):
            for yy in range(h):
                for xx in range(w):
                    s = bias[o]
                    for ky in range(3):
                        sy = min(max(yy + ky - 1, 0), h - 1)
                        for kx in range(3):
                            sx = min(max(xx + kx - 1, 0), w - 1)
                            for i in range(in_c):
                                s += weights[((o * in_c + i) * 3 + ky) * 3 + kx] * x[i][sy][sx]
                    out[o][yy][xx] = max(0.0, s) if k < last else s
        x = out
    return x


def scalar_reconstruct(march: torch.Tensor, last) -> torch.Tensor:
    """upscale-reference.ts reconstructPixel for every output pixel. Returns (4, 2h, 2w) float64."""
    _, h, w = march.shape
    m = march.tolist()
    lst = last.tolist() if isinstance(last, torch.Tensor) else last

    def texel(xx: int, yy: int) -> list[float]:
        xx, yy = min(max(xx, 0), w - 1), min(max(yy, 0), h - 1)
        return [m[c][yy][xx] for c in range(4)]

    out = torch.zeros(4, 2 * h, 2 * w, dtype=torch.float64)
    for Y in range(2 * h):
        y, i = Y >> 1, Y & 1
        for X in range(2 * w):
            x, j = X >> 1, X & 1
            res = [lst[c * 4 + i * 2 + j][y][x] for c in range(4)]
            own = texel(x, y)
            own_hit = 1.0 if own[3] < 1 else 0.0
            out[3, Y, X] = 1.0
            if own_hit + res[3] <= 0.5:
                continue
            sx, sy = (1 if j == 1 else -1), (1 if i == 1 else -1)
            src = next((t for t in (own, texel(x + sx, y), texel(x, y + sy), texel(x + sx, y + sy)) if t[3] < 1), None)
            if src is None:
                continue
            out[:, Y, X] = torch.tensor([max(0.0, src[0] + res[0]), max(0.0, src[1] + res[1]),
                                         max(0.0, src[2] + res[2]), src[3]], dtype=torch.float64)
    return out


def write_v2_dataset(root: Path | str, *, pairs: int = 6, size: tuple[int, int] = (12, 16), val_every: int = 3,
                     seed: int = 1, native: bool = True, regions: bool = True, normals: bool = False) -> Path:
    """A tiny dataset v2: one pair per sequence; target = nearest-upsampled input plus a little
    noise on flesh. Every `val_every`-th sequence is validation (and showcase). Heads sit at the
    image centre; even pairs also have a wound."""
    root = Path(root)
    h, w = size
    classes = ("close", "medium", "far")
    entries = []
    for k in range(pairs):
        inp = random_march(h, w, seed + k, cover=0.3)
        g = torch.Generator().manual_seed(1000 + seed + k)
        target = upsample_nearest(inp).clone()
        flesh = target[3:4] < 1
        target[:3] = (target[:3] + 0.1 * torch.rand((3, 2 * h, 2 * w), generator=g)) * flesh
        pid = f"s{k:04d}-f000"
        split = "val" if k % val_every == val_every - 1 else "train"
        d = root / "pairs" / pid
        d.mkdir(parents=True)
        np.save(d / "in.npy", hwc(inp))
        np.save(d / "target.npy", hwc(target))
        np.save(d / "target-coverage.npy", hwc(flesh.to(torch.float32)))
        files = {"in": f"pairs/{pid}/in.npy", "target": f"pairs/{pid}/target.npy",
                 "targetCoverage": f"pairs/{pid}/target-coverage.npy", "native": None}
        if native and split == "val":
            np.save(d / "native.npy", hwc(upsample_nearest(inp)))
            files["native"] = f"pairs/{pid}/native.npy"
        if normals:
            nrm = torch.rand((3, h, w), generator=g) * 2 - 1
            nrm = nrm / nrm.norm(dim=0, keepdim=True).clamp(min=1e-6) * (inp[3:4] < 1)
            np.save(d / "normal.npy", hwc(nrm))
            files["normal"] = f"pairs/{pid}/normal.npy"
        heads = [{"x": float(w), "y": float(h), "r": 3.0, "actorId": 1}] if regions else []
        wounds = [{"x": w * 1.4, "y": h * 1.2, "r": 1.5, "type": "pellet", "actorId": 1}] if regions and k % 2 == 0 else []
        entries.append({
            "id": pid, "seq": k, "frame": 0, "split": split, "showcase": split == "val",
            "class": classes[k % 3], "lookAt": "head", "character": "zombie", "room": 1,
            "distance": 2.0, "orbitDeg": 0.0, "wounds": len(wounds),
            "crop": {"x": 0, "y": 0, "w": w, "h": h}, "files": files,
            "regions": {"heads": heads, "wounds": wounds},
            "inputCoverage": float(flesh.to(torch.float32).mean()), "iouPrev": None, "bytes": 0,
        })
    manifest = {"format": DATASET_FORMAT, "near": 0.1, "far": 200.0, "seed": seed, "pairs": entries}
    (root / "manifest.json").write_text(json.dumps(manifest))
    return root
