# Neural Upscale P3b — Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PyTorch trainer in `scripts/neural-upscale/` that:
- trains the ESPCN-family upscaler on dataset v2;
- measures it against nearest and coverage-aware bicubic, per region and per distance class;
- writes checkpoints, model JSON exports with parity fixtures, and a static dashboard;
- runs the 6-run grid under a spend cap.

**Architecture:** One small package, `nupscale`, with one responsibility per module:
- `model.py` and `reconstruct.py` mirror `upscale-model.ts` and §4 of `upscale-reference.ts` exactly. Tests check them against scalar Python ports of the TypeScript twin.
- `regions.py` and `data.py` load dataset v2 into memory, build face/wound/edge/interior masks and loss weights, and sample crops.
- `losses.py` and `evaluate.py` hold the loss, the validation metrics and the baselines.
- `export.py`, `images.py` and `dashboard.py` write model JSON plus parity fixtures, PNG crops, and `dashboard.json` next to a static `index.html`.
- `train.py` runs one resumable run. `grid.py` runs the grid under `SpendMeter`. `convert_p2.py` turns the P2 smoke capture into dataset v2 for the pre-flight.

**Tech Stack:** Python ≥ 3.10 (the RunPod image is Python 3.10 + torch 2.1), PyTorch ≥ 2.1, NumPy, Pillow, pytest, all through `uv`. No browser. No GPU needed for tests.

**Read first:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` §0 (rules), §1 (dataset v2), §2 (model JSON), §3 (run and export layout). Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md` §2–§4.

**Harness:** CPU-only Python, so any harness that can run `uv` and commit. The first `uv run` downloads torch (about a minute).

**Names that differ from the spec's file table** (this plan is newer):
- the grid runner is `nupscale/grid.py`, not `run_grid.py`;
- the dashboard page is `nupscale/dashboard_index.html`, copied into each run root;
- each export's parity fixture is a `parity/` directory with `.npy` files and `meta.json` (contracts §3), not an `.npz`.

**Test command.** Every task uses this, from the repo root, with `<file>` replaced:

```bash
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt --with pytest python -m pytest -q -p no:cacheprovider tests/<file>)
```

**Verified while writing this plan:**
- The full suite passes on Python 3.12 with torch 2.14, and on Python 3.10 with torch 2.1.2.
- `convert_p2` plus a 600-step s8-rgb run on the 60 smoke pairs trained in 16 s on MPS. Validation overall was 0.0220, against 0.0228 for nearest and 0.0213 for bicubic.
- That run's export passed the TypeScript G3 parity check at a max relative rgb difference of 2.4e-7.

---

## File map

All paths are under `scripts/neural-upscale/`.

| File | Task | Responsibility |
|---|---|---|
| `requirements.txt`, `conftest.py`, `nupscale/__init__.py`, `tests/__init__.py`, `tests/helpers.py` | 1 | Dependencies, import path, synthetic data, scalar ports of the TypeScript twin |
| `nupscale/constants.py` | 1 | Shapes, formats, loss weights, schedule, grid |
| `nupscale/model.py` (+ `tests/test_model.py`) | 1 | `Upscaler`: layers, input assembly, He/ICNR init |
| `nupscale/reconstruct.py` (+ test) | 2 | §4 reconstruction, vectorized |
| `nupscale/regions.py`, `nupscale/data.py` (+ tests) | 3 | Region masks, loss weights, dataset v2 loader, crop sampler |
| `nupscale/losses.py` (+ test) | 4 | Colour, detail and coverage-hinge loss |
| `nupscale/evaluate.py` (+ test) | 5 | Metrics; nearest, bicubic and native baselines; G4 |
| `nupscale/export.py` (+ test) | 6 | FNV-1a hash, model JSON, parity fixtures |
| `nupscale/images.py`, `nupscale/dashboard.py`, `nupscale/dashboard_index.html` (+ test) | 7 | PNG crops, `dashboard.json`, the static page |
| `nupscale/train.py` (+ test) | 8 | One resumable run, and a CLI |
| `nupscale/grid.py` (+ test) | 9 | Spend meter, the 6-run grid, and a CLI |
| `nupscale/convert_p2.py` (+ test) | 10 | P2 smoke capture → dataset v2 |

---

### Task 1: Package scaffold and the network

**Files:**
- Create: `scripts/neural-upscale/requirements.txt`, `scripts/neural-upscale/conftest.py`
- Create: `scripts/neural-upscale/nupscale/__init__.py`, `nupscale/constants.py`, `nupscale/model.py`
- Create: `scripts/neural-upscale/tests/__init__.py` (empty), `tests/helpers.py`, `tests/test_model.py`

- [ ] **Step 1: Scaffold**

`scripts/neural-upscale/requirements.txt`:

```text
# Neural upscale trainer (docs/superpowers/plans/2026-09-11-neural-upscale-p3b-trainer.md).
# Floors, not pins: the RunPod PyTorch image already ships torch, and reinstalling it costs pod time.
torch>=2.1
numpy>=1.24
pillow>=9.0
```

`scripts/neural-upscale/conftest.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
```

`scripts/neural-upscale/nupscale/__init__.py`:

```python
"""Neural upscale trainer (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md)."""
```

Create an empty `scripts/neural-upscale/tests/__init__.py`:

```bash
mkdir -p scripts/neural-upscale/tests && touch scripts/neural-upscale/tests/__init__.py
```

`scripts/neural-upscale/nupscale/constants.py`:

```python
"""Shared constants. Network shapes mirror src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts."""

HIDDEN_WIDTHS = {"s8": (8, 8), "s16": (16, 16), "s32": (32, 32), "zero": (8, 8)}
INPUT_CHANNELS = {"rgb": 4, "rgbd": 5}
LAST_CHANNELS = 16
DEPTH_INPUT_SCALE = 0.1
ICNR_SCALE = 0.1

DATASET_FORMAT = "blud-upscale-dataset/2"
MODEL_FORMAT = "blud-upscale-model/1"
CLASSES = ("close", "medium", "far")

# Loss (spec §2): where regions overlap, the largest weight applies.
REGION_WEIGHTS = {"face": 2.0, "wound": 2.0, "edge": 1.5, "interior": 1.0}
EDGE_BAND_PX = 2
MIN_REGION_RADIUS_PX = 1.0
COVERAGE_MARGIN = 0.25
DETAIL_WEIGHT = 0.5
COVERAGE_WEIGHT = 1.0

# Sampling and schedule defaults (spec §2), recorded per run.
CROP_IN = 64
BATCH = 64
LR = 1e-3
MAX_STEPS = 20_000
TIME_CAP_S = 25 * 60
VAL_EVERY = 500
LOG_EVERY = 50
REGION_CENTRED_SHARE = 0.5
SHOWCASE_FALLBACK = 12

# Coverage-aware bicubic baseline.
BICUBIC_A = -0.5
BICUBIC_MIN_WEIGHT = 0.25

# The grid (spec §4) and its spend estimate.
GRID = (("s8", "rgb"), ("s8", "rgbd"), ("s16", "rgb"), ("s16", "rgbd"), ("s32", "rgb"), ("s32", "rgbd"))
G4_KEYS = ("overall", "face", "wound", "edge", "class:medium", "class:far")
RUN_OVERHEAD = 1.15
RESERVE_S = 45 * 60
```

- [ ] **Step 2: Test helpers**

These are shared by every later test. `scalar_forward` and `scalar_reconstruct` are line-by-line Python ports of `convAt`/`assembleInput` and `reconstructPixel` in `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts`.

`scripts/neural-upscale/tests/helpers.py`:

```python
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
                     seed: int = 1, native: bool = True, regions: bool = True) -> Path:
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
```

- [ ] **Step 3: Write the failing tests**

`scripts/neural-upscale/tests/test_model.py`:

```python
import pytest
import torch

from nupscale.model import Upscaler, linear_depth
from tests.helpers import random_march, scalar_forward


def test_layer_chain_matches_the_typescript_model():
    m = Upscaler("s8", "rgb")
    assert [(c.in_channels, c.out_channels) for c in m.convs] == [(4, 8), (8, 8), (8, 16)]
    m = Upscaler("s32", "rgbd")
    assert [(c.in_channels, c.out_channels) for c in m.convs] == [(5, 32), (32, 32), (32, 16)]
    assert all(c.padding_mode == "replicate" and c.kernel_size == (3, 3) and c.padding == (1, 1) for c in m.convs)


def test_input_normalization_buffers():
    m = Upscaler("s16", "rgbd")
    assert m.in_scale.dtype == torch.float32
    assert m.in_scale[:4].tolist() == [1.0, 1.0, 1.0, 1.0]
    assert m.in_scale[4].item() == 0.10000000149011612
    assert float(m.in_offset.abs().sum()) == 0.0
    assert Upscaler("s16", "rgb").in_scale.tolist() == [1.0, 1.0, 1.0, 1.0]


def test_unknown_ids_raise():
    with pytest.raises(ValueError, match="model id"):
        Upscaler("s64", "rgb")
    with pytest.raises(ValueError, match="input set"):
        Upscaler("s8", "rgba")


def test_zero_model_is_all_zero():
    m = Upscaler("zero", "rgbd")
    assert all(int(torch.count_nonzero(c.weight.detach())) == 0 and int(torch.count_nonzero(c.bias.detach())) == 0 for c in m.convs)


def test_icnr_last_layer_shares_one_kernel_per_channel():
    last = Upscaler("s16", "rgb", seed=3).convs[-1]
    w = last.weight.detach()
    for c in range(4):
        for s in range(1, 4):
            assert torch.equal(w[c * 4 + s], w[c * 4])
    assert int(torch.count_nonzero(last.bias.detach())) == 0
    assert 0 < float(w.abs().max()) < 0.1


def test_seeded_init_is_deterministic():
    a, b, c = Upscaler("s8", "rgb", seed=5), Upscaler("s8", "rgb", seed=5), Upscaler("s8", "rgb", seed=6)
    assert all(torch.equal(x, y) for x, y in zip(a.state_dict().values(), b.state_dict().values()))
    assert not torch.equal(a.convs[0].weight, c.convs[0].weight)


def test_linear_depth_matches_the_reference_formula():
    near, far = 0.1, 200.0
    d = torch.tensor([0.0, 0.5, 0.999], dtype=torch.float64)
    expect = [near * far / (far - v * (far - near)) for v in d.tolist()]
    assert linear_depth(d, near, far).tolist() == pytest.approx(expect, rel=1e-12)


@pytest.mark.parametrize("inputs", ["rgb", "rgbd"])
def test_forward_matches_the_scalar_typescript_twin(inputs):
    torch.manual_seed(0)
    m = Upscaler("s8", inputs, seed=7).double()
    with torch.no_grad():
        for conv in m.convs:
            conv.bias.uniform_(-0.2, 0.2)
        # Break ICNR's shared kernels so a sub-pixel channel-order mistake cannot hide.
        m.convs[-1].weight.add_(torch.randn_like(m.convs[-1].weight) * 0.1)
    march = random_march(4, 5, seed=11).double()
    got = m(march[None], 0.1, 200.0)[0]
    want = torch.tensor(scalar_forward(m, march, 0.1, 200.0), dtype=torch.float64)
    assert got.shape == (16, 4, 5)
    assert torch.allclose(got, want, rtol=1e-9, atol=1e-9)
```

- [ ] **Step 4: Run them to see them fail**

Run the test command with `tests/test_model.py`.
Expected: collection error, `ModuleNotFoundError: No module named 'nupscale.model'`.

- [ ] **Step 5: Implement the network**

`scripts/neural-upscale/nupscale/model.py`:

```python
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
```

- [ ] **Step 6: Run the tests**

Run the test command with `tests/test_model.py`. Expected: `9 passed`.
If `test_forward_matches_the_scalar_typescript_twin` fails, the weight order or padding is wrong. Don't loosen the tolerance: the GPU shaders and the exported JSON both depend on this order.

- [ ] **Step 7: Commit**

```bash
git add scripts/neural-upscale
git commit -m "feat(upscale P3b): trainer scaffold and the ESPCN network (mirrors upscale-model.ts)"
```

---

### Task 2: §4 reconstruction

**Files:**
- Create: `scripts/neural-upscale/nupscale/reconstruct.py`, `scripts/neural-upscale/tests/test_reconstruct.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_reconstruct.py`:

```python
import torch

from nupscale.reconstruct import reconstruct
from tests.helpers import random_march, scalar_reconstruct, upsample_nearest


def test_matches_the_scalar_typescript_twin():
    march = random_march(6, 7, seed=3, cover=0.35).double()
    g = torch.Generator().manual_seed(9)
    last = (torch.rand((16, 6, 7), generator=g, dtype=torch.float64) - 0.5) * 1.6
    rec = reconstruct(march[None], last[None])
    want = scalar_reconstruct(march, last)
    assert torch.allclose(rec.march()[0], want, rtol=0, atol=1e-12)
    covered = want[3] < 1
    assert torch.equal(rec.covered[0, 0], covered)
    own_hit = upsample_nearest(march)[3] < 1
    # the case mix is real: some pixels gain coverage off their own texel, some lose it
    assert bool((covered & ~own_hit).any()) and bool((~covered & own_hit).any())


def test_zero_residual_is_nearest():
    march = random_march(5, 6, seed=4)
    rec = reconstruct(march[None], torch.zeros(1, 16, 5, 6))
    up = upsample_nearest(march)
    hit = up[3] < 1
    assert torch.equal(rec.covered[0, 0], hit)
    assert torch.equal(rec.rgb[0], torch.where(hit, up[:3], torch.zeros_like(up[:3])))
    assert torch.equal(rec.depth[0, 0], torch.where(hit, up[3], torch.ones_like(up[3])))
    assert torch.equal(rec.margin[0, 0], hit.float() - 0.5)


def test_source_priority_is_own_horizontal_vertical_diagonal():
    # 2x2 march; texel (x, y): (0,0) and (1,0) miss, (0,1) hits with rgb 1, (1,1) hits with rgb 2.
    march = torch.zeros(1, 4, 2, 2)
    march[0, 3] = torch.tensor([[1.0, 1.0], [0.5, 0.6]])
    march[0, 0] = torch.tensor([[0.0, 0.0], [1.0, 2.0]])
    last = torch.zeros(1, 16, 2, 2)
    last[0, 15, 0, 0] = 1.0  # coverage residual of sub-pixel (i=1, j=1) of texel (0, 0)
    rec = reconstruct(march, last)
    # output (X=1, Y=1) looks right and down: own misses, horizontal misses, vertical hits
    assert rec.covered[0, 0, 1, 1] and rec.rgb[0, 0, 1, 1] == 1.0 and rec.depth[0, 0, 1, 1] == 0.5
    march[0, 3, 1, 0] = 1.0  # the vertical neighbour now misses too: the diagonal is used
    rec = reconstruct(march, last)
    assert rec.covered[0, 0, 1, 1] and rec.rgb[0, 0, 1, 1] == 2.0 and rec.depth[0, 0, 1, 1] == torch.tensor(0.6)
    march[0, 3, 1, 1] = 1.0  # no source at all: never covered, whatever the residual says
    rec = reconstruct(march, last)
    assert not rec.covered[0, 0, 1, 1] and not rec.src_exists[0, 0, 1, 1] and rec.depth[0, 0, 1, 1] == 1.0
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_reconstruct.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.reconstruct'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/reconstruct.py`:

```python
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
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_reconstruct.py`. Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/reconstruct.py scripts/neural-upscale/tests/test_reconstruct.py
git commit -m "feat(upscale P3b): vectorized §4 reconstruction, checked against the scalar TS twin"
```

---

### Task 3: Regions, loss weights, dataset loader and crop sampler

**Files:**
- Create: `scripts/neural-upscale/nupscale/regions.py`, `scripts/neural-upscale/nupscale/data.py`
- Create: `scripts/neural-upscale/tests/test_regions.py`, `scripts/neural-upscale/tests/test_data.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_regions.py`:

```python
import torch

from nupscale.regions import dilate, disc_mask, region_masks, weight_map


def test_disc_mask_uses_pixel_centres():
    m = disc_mask(4, 4, [(2.0, 2.0, 1.0)])
    assert int(m.sum()) == 4 and bool(m[1:3, 1:3].all())


def test_tiny_circles_still_mark_pixels():
    m = disc_mask(4, 4, [(1.5, 1.5, 0.2)])
    assert bool(m[1, 1]) and int(m.sum()) == 5


def test_dilate_does_not_wrap():
    m = torch.zeros(5, 6, dtype=torch.bool)
    m[2, 0] = True
    d = dilate(m, 2)
    assert bool(d[0:5, 0:3].all()) and int(d.sum()) == 15


def test_edge_band_and_max_weight_rule():
    target_alpha = torch.ones(8, 8)
    target_alpha[2:6, 2:6] = 0.5
    input_alpha = torch.ones(4, 4)
    input_alpha[1:3, 1:3] = 0.5
    masks = region_masks(target_alpha, input_alpha, heads=[(4.0, 4.0, 1.0)], wounds=[])
    flesh = masks["flesh"]
    assert int(flesh.sum()) == 16
    assert torch.equal(masks["edge"] & flesh, flesh)  # a 4x4 block is all within 2 px of background
    assert int(masks["interior"].sum()) == 0
    w = weight_map(masks)
    assert w.shape == (1, 8, 8)
    assert w[0, 3, 3] == 2.0  # face and edge: the max, not the product
    assert w[0, 2, 5] == 1.5  # edge only
    assert w[0, 0, 0] == 1.0  # background


def test_interior_is_flesh_in_no_other_region():
    target_alpha = torch.ones(16, 16)
    target_alpha[2:14, 2:14] = 0.5
    input_alpha = torch.ones(8, 8)
    input_alpha[1:7, 1:7] = 0.5
    masks = region_masks(target_alpha, input_alpha, heads=[], wounds=[(10.5, 10.5, 1.0)])
    assert bool(masks["interior"][7, 7]) and not bool(masks["interior"][3, 3]) and not bool(masks["interior"][10, 10])
    assert torch.equal(masks["interior"] | (masks["edge"] & masks["flesh"]) | masks["wound"], masks["flesh"] | masks["wound"])


def test_input_target_disagreement_is_edge_even_off_flesh():
    target_alpha = torch.ones(8, 8)
    input_alpha = torch.ones(4, 4)
    input_alpha[0, 0] = 0.5
    masks = region_masks(target_alpha, input_alpha, [], [])
    assert bool(masks["edge"][:2, :2].all()) and int(masks["edge"].sum()) == 4
```

`scripts/neural-upscale/tests/test_data.py`:

```python
import json

import pytest
import torch

from nupscale.constants import DATASET_FORMAT
from nupscale.data import CropSampler, load_dataset, paste
from tests.helpers import write_v2_dataset


def test_load_dataset_shapes_splits_and_regions(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    assert ds.name == "ds" and ds.near == 0.1 and ds.far == 200.0 and len(ds.manifest_hash) == 16
    assert [p.split for p in ds.pairs].count("val") == 2
    p = ds.pairs[0]
    assert p.inp.shape == (4, 12, 16) and p.target.shape == (4, 24, 32) and p.weight.shape == (1, 24, 32)
    assert p.native is None and ds.split("val")[0].native.shape == (4, 24, 32)
    assert p.centres == [(16.0, 12.0), pytest.approx((22.4, 14.4))]
    assert set(p.masks) == {"flesh", "face", "wound", "edge", "interior"}
    assert bool(p.masks["face"][12, 16]) and p.weight[0, 12, 16] == 2.0


def test_format_and_shapes_are_validated(tmp_path):
    root = write_v2_dataset(tmp_path / "ds", pairs=3)
    manifest = json.loads((root / "manifest.json").read_text())
    manifest["format"] = "blud-upscale-dataset/1"
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="format"):
        load_dataset(root)
    manifest["format"] = DATASET_FORMAT
    manifest["pairs"][0]["crop"]["w"] = 15
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="expected float32"):
        load_dataset(root)


def test_paste_fills_outside_with_the_sentinel():
    src = torch.arange(2 * 3 * 4, dtype=torch.float32).view(2, 3, 4)
    out = paste(src, -1, 1, 3, torch.tensor([7.0, 9.0]))
    assert out[:, 0, 0].tolist() == [7.0, 9.0]            # column -1 is outside
    assert out[:, 0, 1].tolist() == src[:, 1, 0].tolist()
    assert out[:, 2, 2].tolist() == [7.0, 9.0]            # row 3 is outside


def test_sampler_shapes_padding_and_determinism(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=4, size=(10, 12)))
    march, target, weight = CropSampler(ds.split("train"), crop=16, seed=3).sample(5)
    assert march.shape == (5, 4, 16, 16) and target.shape == (5, 4, 32, 32) and weight.shape == (5, 1, 32, 32)
    # every pair crop (10x12) is smaller than the window, so every window is padded with the sentinel
    assert bool((march[:, 3] == 1).flatten(1).any(dim=1).all())
    pad = target[:, 3] == 1
    assert bool((target[:, :3].abs().sum(dim=1)[pad] == 0).all())
    assert bool((weight[:, 0][pad] >= 1).all())
    again = CropSampler(ds.split("train"), crop=16, seed=3).sample(5)
    assert torch.equal(again[0], march) and torch.equal(again[1], target)


def test_region_centred_windows_contain_a_region(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3, size=(40, 48)))
    pairs = ds.split("train")
    sampler = CropSampler(pairs, crop=16, seed=1, region_share=1.0)
    for k in range(len(pairs)):
        for _ in range(10):
            ox, oy = sampler.window(k)
            assert any(ox <= x / 2 < ox + 16 and oy <= y / 2 < oy + 16 for x, y in pairs[k].centres)
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_regions.py tests/test_data.py`. Expected: `ModuleNotFoundError` for `nupscale.regions`.

- [ ] **Step 3: Implement regions**

`scripts/neural-upscale/nupscale/regions.py`:

```python
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
```

- [ ] **Step 4: Implement the loader and sampler**

`scripts/neural-upscale/nupscale/data.py`:

```python
"""Dataset v2 loading and training crops (contracts §1; spec §2 Sampling)."""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from .constants import CROP_IN, DATASET_FORMAT, REGION_CENTRED_SHARE, REGION_WEIGHTS
from .regions import region_masks, weight_map

SENTINEL = torch.tensor([0.0, 0.0, 0.0, 1.0])


@dataclass
class Pair:
    id: str
    seq: int
    split: str
    cls: str
    showcase: bool
    inp: torch.Tensor                   # (4, h, w)
    target: torch.Tensor                # (4, 2h, 2w)
    native: torch.Tensor | None         # (4, 2h, 2w), validation pairs only
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
        target = chw(_load(root, e["files"]["target"], (2 * h, 2 * w, 4), pid))
        native_rel = e["files"].get("native")
        native = chw(_load(root, native_rel, (2 * h, 2 * w, 4), pid)) if native_rel else None
        regions = e.get("regions") or {}
        heads = [(r["x"], r["y"], r["r"]) for r in regions.get("heads", [])]
        wounds = [(r["x"], r["y"], r["r"]) for r in regions.get("wounds", [])]
        masks = region_masks(target[3], inp[3], heads, wounds)
        ds.pairs.append(Pair(
            id=pid, seq=int(e["seq"]), split=e["split"], cls=e["class"], showcase=bool(e.get("showcase", False)),
            inp=inp, target=target, native=native, weight=weight_map(masks, weights), masks=masks,
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
                 region_share: float = REGION_CENTRED_SHARE) -> None:
        if not pairs:
            raise ValueError("CropSampler: no pairs")
        self.pairs = pairs
        self.crop = crop
        self.region_share = region_share
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
        """march (B, 4, c, c), target (B, 4, 2c, 2c), weight (B, 1, 2c, 2c)."""
        c = self.crop
        one = torch.ones(1)
        marches, targets, weights = [], [], []
        for _ in range(batch):
            k = self.rng.randrange(len(self.pairs))
            p = self.pairs[k]
            ox, oy = self.window(k)
            marches.append(paste(p.inp, ox, oy, c, SENTINEL))
            targets.append(paste(p.target, 2 * ox, 2 * oy, 2 * c, SENTINEL))
            weights.append(paste(p.weight, 2 * ox, 2 * oy, 2 * c, one))
        return torch.stack(marches), torch.stack(targets), torch.stack(weights)
```

- [ ] **Step 5: Run the tests**

Run the test command with `tests/test_regions.py tests/test_data.py`. Expected: `11 passed`.

- [ ] **Step 6: Commit**

```bash
git add scripts/neural-upscale/nupscale/regions.py scripts/neural-upscale/nupscale/data.py scripts/neural-upscale/tests/test_regions.py scripts/neural-upscale/tests/test_data.py
git commit -m "feat(upscale P3b): region masks, max-rule loss weights, dataset v2 loader, sentinel-padded crops"
```

---

### Task 4: Loss

**Files:**
- Create: `scripts/neural-upscale/nupscale/losses.py`, `scripts/neural-upscale/tests/test_losses.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_losses.py`:

```python
import pytest
import torch

from nupscale.losses import upscale_loss
from nupscale.reconstruct import reconstruct
from tests.helpers import random_march, upsample_nearest


def test_zero_residual_on_a_nearest_target_has_zero_loss():
    march = random_march(6, 8, seed=2)[None]
    rec = reconstruct(march, torch.zeros(1, 16, 6, 8))
    total, parts = upscale_loss(rec, upsample_nearest(march), torch.ones(1, 1, 12, 16))
    assert float(total) == 0.0 and all(float(v) == 0.0 for v in parts.values())


def test_colour_ignores_background_and_uses_log1p():
    march = random_march(6, 8, seed=2)[None]
    rec = reconstruct(march, torch.zeros(1, 16, 6, 8))
    ones = torch.ones(1, 1, 12, 16)
    target = upsample_nearest(march).clone()
    background = target[:, 3:4] >= 1
    target[:, :3] = torch.where(background, torch.full_like(target[:, :3], 50.0), target[:, :3])
    assert float(upscale_loss(rec, target, ones)[1]["colour"]) == 0.0
    up = upsample_nearest(march)
    flesh = up[:, 3:4] < 1
    brighter = up.clone()
    brighter[:, :3] += flesh.float()
    expect = (torch.log1p(up[:, :3] + 1) - torch.log1p(up[:, :3])).expand(1, 3, 12, 16)[flesh.expand(1, 3, 12, 16)].mean()
    assert float(upscale_loss(rec, brighter, ones)[1]["colour"]) == pytest.approx(float(expect), rel=1e-5)


def _one_texel_case():
    march = torch.tensor([0.5, 0.5, 0.5, 0.5]).view(1, 4, 1, 1)
    target = torch.tensor([0.0, 0.0, 0.0, 1.0]).view(1, 4, 1, 1).repeat(1, 1, 2, 2)
    target[0, :, 0, 0] = torch.tensor([0.5, 0.5, 0.5, 0.5])  # only output (0, 0) is flesh
    last = torch.zeros(1, 16, 1, 1)
    last[0, 13] = -0.6  # (0, 1): margin -0.1 on background -> hinge 0.15
    last[0, 14] = -1.0  # (1, 0): margin -0.5 on background -> 0
    # (0, 0): margin +0.5 on flesh -> 0;  (1, 1): margin +0.5 on background -> 0.75
    return reconstruct(march, last), target


def test_coverage_hinge_uses_the_margin():
    rec, target = _one_texel_case()
    _, parts = upscale_loss(rec, target, torch.ones(1, 1, 2, 2))
    assert float(parts["coverage"]) == pytest.approx((0.15 + 0.75) / 4)
    assert float(parts["colour"]) == 0.0


def test_region_weight_scales_its_pixel():
    rec, target = _one_texel_case()
    weight = torch.ones(1, 1, 2, 2)
    weight[0, 0, 1, 1] = 2.0
    _, parts = upscale_loss(rec, target, weight)
    assert float(parts["coverage"]) == pytest.approx((0.15 + 2 * 0.75) / 5)


def test_gradients_reach_every_residual_channel():
    march = random_march(6, 8, seed=2)[None]
    last = torch.zeros(1, 16, 6, 8, requires_grad=True)
    target = upsample_nearest(march).clone()
    target[:, :3] *= 1.5
    # flip coverage on every third column, so the hinge is active (a zero residual's ±0.5 margins are past it)
    col = target[:, 3:4, :, ::3]
    target[:, 3:4, :, ::3] = torch.where(col < 1, torch.ones_like(col), torch.full_like(col, 0.5))
    total, _ = upscale_loss(reconstruct(march, last), target, torch.ones(1, 1, 12, 16))
    total.backward()
    assert float(last.grad[:, :12].abs().sum()) > 0 and float(last.grad[:, 12:].abs().sum()) > 0
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_losses.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.losses'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/losses.py`:

```python
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
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_losses.py`. Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/losses.py scripts/neural-upscale/tests/test_losses.py
git commit -m "feat(upscale P3b): log1p colour + detail + coverage-hinge loss with region weights"
```

---

### Task 5: Metrics and baselines

**Files:**
- Create: `scripts/neural-upscale/nupscale/evaluate.py`, `scripts/neural-upscale/tests/test_evaluate.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_evaluate.py`:

```python
from types import SimpleNamespace

import pytest
import torch
import torch.nn.functional as F

from nupscale.constants import CLASSES
from nupscale.data import load_dataset
from nupscale.evaluate import aggregate, beats, g4_pass, pair_errors, predict_bicubic, predict_model, predict_nearest
from nupscale.model import Upscaler
from tests.helpers import random_march, upsample_nearest, write_v2_dataset


def test_nearest_is_the_zero_model(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    assert torch.equal(predict_nearest(p), predict_model(Upscaler("zero", "rgb"), p, ds.near, ds.far))


def test_bicubic_reproduces_a_constant_and_keeps_nearest_coverage():
    march = random_march(8, 10, seed=5)
    march[:3] = torch.where(march[3] < 1, 0.7, 0.0)
    out = predict_bicubic(SimpleNamespace(inp=march))
    hit = upsample_nearest(march)[3] < 1
    assert torch.equal(out[3] < 1, hit)
    assert torch.allclose(out[:3][:, hit], torch.full_like(out[:3][:, hit], 0.7), atol=1e-6)
    assert bool((out[:3][:, ~hit] == 0).all())


def test_bicubic_on_full_coverage_is_plain_bicubic():
    g = torch.Generator().manual_seed(8)
    march = torch.cat([torch.rand((3, 6, 7), generator=g), torch.full((1, 6, 7), 0.5)])
    ours = predict_bicubic(SimpleNamespace(inp=march), a=-0.75)
    torch_bicubic = F.interpolate(march[None, :3], scale_factor=2, mode="bicubic", align_corners=False)[0]
    assert torch.allclose(ours[:3], torch_bicubic.clamp(min=0), atol=1e-5)


def test_pair_errors_are_zero_for_the_target(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    m = aggregate([pair_errors(p.target, p)])
    assert m["overall"] == 0.0 and m["coverage_error_rate"] == 0.0 and m["face"] == 0.0
    assert m[f"class:{p.cls}"] == 0.0
    assert all(m[f"class:{c}"] is None for c in CLASSES if c != p.cls)


def test_uncovered_flesh_counts_as_black(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    pred = torch.zeros_like(p.target)
    pred[3] = 1.0
    m = aggregate([pair_errors(pred, p)])
    flesh = p.masks["flesh"]
    expect = torch.log1p(p.target[:3].clamp(min=0)).mean(dim=0)[flesh].mean()
    assert m["overall"] == pytest.approx(float(expect), rel=1e-5)
    assert m["coverage_error_rate"] == pytest.approx(float(flesh.float().mean()))


def test_aggregate_is_pixel_weighted():
    m = aggregate([{"overall": (1.0, 1)}, {"overall": (3.0, 3)}, {"overall": (0.0, 0)}])
    assert m["overall"] == 1.0 and m["face"] is None


def test_beats_and_g4():
    bicubic = {"overall": 0.5, "face": 0.5, "wound": 0.5, "edge": 0.5, "class:medium": 0.5, "class:far": 0.5}
    good = {k: 0.4 for k in bicubic}
    assert all(v is True for v in beats(good, bicubic).values()) and g4_pass(good, bicubic)
    assert beats({**good, "wound": None}, bicubic)["wound"] is None
    assert not g4_pass({**good, "wound": None}, bicubic)
    assert not g4_pass({**good, "class:far": 0.6}, bicubic)
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_evaluate.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.evaluate'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/evaluate.py`:

```python
"""Validation metrics and baselines (spec §2 Validation, §6 G4).

Every error is flesh-masked mean |Δ log1p rgb| against the SUPERSAMPLED target, pixel-weighted
across pairs. Target flesh a prediction leaves uncovered counts as black."""
from __future__ import annotations

from typing import Callable, Iterable

import torch

from .constants import BICUBIC_A, BICUBIC_MIN_WEIGHT, CLASSES, G4_KEYS
from .data import Pair
from .reconstruct import neighbours, reconstruct
from .regions import REGIONS

METRIC_KEYS = ("overall", *REGIONS, *(f"class:{c}" for c in CLASSES), "coverage_error_rate")


@torch.no_grad()
def predict_model(model, pair: Pair, near: float, far: float, device: torch.device | None = None) -> torch.Tensor:
    """(4, 2h, 2w) in the march convention, on the CPU."""
    device = device or next(model.parameters()).device
    march = pair.inp.unsqueeze(0).to(device)
    return reconstruct(march, model(march, near, far)).march()[0].cpu()


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
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_evaluate.py`. Expected: `7 passed`.
`test_bicubic_on_full_coverage_is_plain_bicubic` compares with `a = -0.75` (PyTorch's constant). The baseline itself uses `BICUBIC_A = -0.5`.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/evaluate.py scripts/neural-upscale/tests/test_evaluate.py
git commit -m "feat(upscale P3b): flesh-masked log1p metrics per region and distance, nearest/bicubic/native baselines, G4"
```

---

### Task 6: Model JSON export and parity fixtures

**Files:**
- Create: `scripts/neural-upscale/nupscale/export.py`, `scripts/neural-upscale/tests/test_export.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_export.py`:

```python
import base64
import json

import numpy as np
import pytest

from nupscale.constants import MODEL_FORMAT
from nupscale.data import load_dataset
from nupscale.export import export_model, export_parity_fixture, f32_bytes, fnv1a32, weight_hash
from nupscale.model import Upscaler
from nupscale.reconstruct import reconstruct
from tests.helpers import write_v2_dataset


def test_fnv_matches_the_typescript_tiny_vector():
    chunks = [f32_bytes([0.5, -1.25, 3, 0, 0, 0, 0, 0, 0.001]), f32_bytes([0.25]), f32_bytes([1, 0.1]), f32_bytes([0, 0.5])]
    assert fnv1a32(chunks) == "21f3e5c5"


@pytest.mark.parametrize("inputs,expected", [("rgb", "3d86dba5"), ("rgbd", "55870aa7")])
def test_zero_model_hash_matches_typescript(inputs, expected):
    assert weight_hash(Upscaler("zero", inputs)) == expected


def test_export_model_json(tmp_path):
    m = Upscaler("s8", "rgbd", seed=2)
    doc = export_model(m, tmp_path / "e", run="s8-rgbd", step=500, dataset="ds",
                       manifest_hash="0123456789abcdef", metrics={"overall": 0.1, "face": None})
    saved = json.loads((tmp_path / "e" / "model.json").read_text())
    assert saved == doc
    assert (saved["format"], saved["id"], saved["inputs"], saved["source"], saved["run"], saved["step"]) == \
        (MODEL_FORMAT, "s8", "rgbd", "trained", "s8-rgbd", 500)
    assert [(l["inC"], l["outC"], l["relu"]) for l in saved["layers"]] == [(5, 8, True), (8, 8, True), (8, 16, False)]
    w0 = np.frombuffer(base64.b64decode(saved["layers"][0]["weights"]), dtype="<f4")
    assert np.array_equal(w0, m.convs[0].weight.detach().numpy().reshape(-1))
    assert saved["inScale"] == [1.0, 1.0, 1.0, 1.0, 0.10000000149011612] and saved["inOffset"] == [0.0] * 5
    assert saved["trainedOn"] == {"dataset": "ds", "manifestHash": "0123456789abcdef"}
    # recomputable from the JSON alone, as parseUpscaleModelJson does
    chunks = []
    for layer in saved["layers"]:
        chunks += [base64.b64decode(layer["weights"]), base64.b64decode(layer["bias"])]
    chunks += [f32_bytes(saved["inScale"]), f32_bytes(saved["inOffset"])]
    assert fnv1a32(chunks) == saved["weightHash"] == weight_hash(m)


def test_parity_fixture(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3))
    m = Upscaler("s8", "rgb", seed=4)
    pairs = ds.split("val") + ds.split("train")
    fixtures = export_parity_fixture(m, pairs, ds.near, ds.far, tmp_path / "parity")
    meta = json.loads((tmp_path / "parity" / "meta.json").read_text())
    assert meta == {"near": 0.1, "far": 200.0, "fixtures": fixtures} and len(fixtures) == 2
    assert [f["pair"] for f in fixtures] == [pairs[0].id, pairs[1].id]
    for k, name in enumerate(["input-0.npy", "output-sp-0.npy"]):
        with open(tmp_path / "parity" / name, "rb") as f:
            assert np.lib.format.read_magic(f) == (1, 0)
            shape, fortran, dtype = np.lib.format.read_array_header_1_0(f)
            assert not fortran and dtype == np.dtype("<f4") and shape == [(12, 16, 4), (24, 32, 4)][k]
    out = np.load(tmp_path / "parity" / "output-sp-0.npy")
    p = pairs[0]
    want = reconstruct(p.inp[None], m(p.inp[None], 0.1, 200.0)).march()[0].permute(1, 2, 0).detach().numpy()
    assert np.array_equal(out, want)
    assert np.array_equal(np.load(tmp_path / "parity" / "input-0.npy"), p.inp.permute(1, 2, 0).numpy())
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_export.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.export'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/export.py`:

```python
"""Model JSON export and parity fixtures (contracts §2, §3)."""
from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import torch

from .constants import MODEL_FORMAT
from .data import Pair
from .reconstruct import reconstruct


def fnv1a32(chunks: Iterable[bytes]) -> str:
    """FNV-1a 32 over the concatenated bytes, lowercase 8-digit hex (upscale-model.ts `hashModel`)."""
    h = 0x811C9DC5
    for chunk in chunks:
        for byte in chunk:
            h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def f32_bytes(values) -> bytes:
    if isinstance(values, torch.Tensor):
        values = values.detach().cpu().numpy()
    return np.ascontiguousarray(values, dtype="<f4").tobytes()


def model_layers(model) -> list[dict]:
    """Each conv as {inC, outC, relu, weights, bias} with float32 LE bytes in PyTorch order."""
    last = len(model.convs) - 1
    return [{"inC": c.in_channels, "outC": c.out_channels, "relu": k < last,
             "weights": f32_bytes(c.weight), "bias": f32_bytes(c.bias)} for k, c in enumerate(model.convs)]


def hash_arrays(layers: list[dict], in_scale: bytes, in_offset: bytes) -> str:
    chunks: list[bytes] = []
    for layer in layers:
        chunks += [layer["weights"], layer["bias"]]
    return fnv1a32([*chunks, in_scale, in_offset])


def weight_hash(model) -> str:
    return hash_arrays(model_layers(model), f32_bytes(model.in_scale), f32_bytes(model.in_offset))


def export_model(model, out_dir: Path | str, *, run: str, step: int, dataset: str, manifest_hash: str,
                 metrics: dict | None) -> dict:
    """Writes <out_dir>/model.json (`blud-upscale-model/1`) and returns the document."""
    layers = model_layers(model)
    in_scale = f32_bytes(model.in_scale)
    in_offset = f32_bytes(model.in_offset)

    def b64(raw: bytes) -> str:
        return base64.b64encode(raw).decode("ascii")

    doc = {
        "format": MODEL_FORMAT,
        "id": model.model_id,
        "inputs": model.inputs,
        "source": "trained",
        "run": run,
        "step": int(step),
        "layers": [{"inC": l["inC"], "outC": l["outC"], "relu": l["relu"],
                    "weights": b64(l["weights"]), "bias": b64(l["bias"])} for l in layers],
        "inScale": np.frombuffer(in_scale, dtype="<f4").astype(float).tolist(),
        "inOffset": np.frombuffer(in_offset, dtype="<f4").astype(float).tolist(),
        "weightHash": hash_arrays(layers, in_scale, in_offset),
        "trainedOn": {"dataset": dataset, "manifestHash": manifest_hash},
        "metrics": metrics,
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "model.json").write_text(json.dumps(doc, indent=1))
    return doc


def _save_hwc(path: Path, chw_tensor: torch.Tensor) -> None:
    np.save(path, np.ascontiguousarray(chw_tensor.detach().cpu().permute(1, 2, 0).numpy(), dtype="<f4"))


@torch.no_grad()
def export_parity_fixture(model, pairs: list[Pair], near: float, far: float, out_dir: Path | str,
                          count: int = 2) -> list[dict]:
    """The first `count` pairs' inputs and PyTorch's float32 CPU §4 reconstruction (contracts §3)."""
    cpu = copy.deepcopy(model).to("cpu").float().eval()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fixtures = []
    for k, pair in enumerate(pairs[:count]):
        march = pair.inp.unsqueeze(0)
        output = reconstruct(march, cpu(march, near, far)).march()[0]
        _save_hwc(out / f"input-{k}.npy", pair.inp)
        _save_hwc(out / f"output-sp-{k}.npy", output)
        fixtures.append({"pair": pair.id, "input": f"input-{k}.npy", "output": f"output-sp-{k}.npy"})
    (out / "meta.json").write_text(json.dumps({"near": near, "far": far, "fixtures": fixtures}, indent=1))
    return fixtures
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_export.py`. Expected: `5 passed`.
The three hash vectors (`21f3e5c5`, `3d86dba5`, `55870aa7`) come from `hashModel` in TypeScript. A mismatch means the game will reject every export, so fix the byte order, not the vector.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/export.py scripts/neural-upscale/tests/test_export.py
git commit -m "feat(upscale P3b): blud-upscale-model/1 export with the TS weightHash, and parity fixtures"
```

---

### Task 7: PNG crops and the dashboard

**Files:**
- Create: `scripts/neural-upscale/nupscale/images.py`, `scripts/neural-upscale/nupscale/dashboard.py`, `scripts/neural-upscale/nupscale/dashboard_index.html`
- Create: `scripts/neural-upscale/tests/test_dashboard.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_dashboard.py`:

```python
import json

import numpy as np
import torch
from PIL import Image

from nupscale.dashboard import INDEX_HTML, Dashboard
from nupscale.images import BACKGROUND, save_march_png, to_rgb8
from tests.helpers import random_march


def test_to_rgb8_tonemaps_and_paints_background():
    march = torch.tensor([[[0.0, 1.0]], [[0.0, 1.0]], [[0.0, 1.0]], [[0.5, 1.0]]])
    u8 = to_rgb8(march)
    assert u8.shape == (1, 2, 3) and u8.dtype == np.uint8
    assert tuple(u8[0, 0]) == (0, 0, 0) and tuple(u8[0, 1]) == BACKGROUND
    one = torch.tensor([1.0, 1.0, 1.0, 0.5]).view(4, 1, 1)
    assert int(to_rgb8(one)[0, 0, 0]) == int((0.5 ** (1 / 2.2)) * 255 + 0.5)


def test_save_png_enlarges_with_nearest(tmp_path):
    march = random_march(10, 20, seed=1)
    factor = save_march_png(march, tmp_path / "a.png")
    img = np.asarray(Image.open(tmp_path / "a.png"))
    assert factor == 8 and img.shape == (80, 160, 3)
    assert np.array_equal(img[::8, ::8], to_rgb8(march))


def test_dashboard_writes_json_and_index_and_reloads(tmp_path):
    d = Dashboard(tmp_path / "root")
    d.run("s8-rgb")["state"] = "running"
    d.showcase_images("s8-rgb", "best")["p1"] = "img/x.png"
    d.save()
    assert (tmp_path / "root" / "index.html").read_text().startswith("<!doctype html>")
    saved = json.loads((tmp_path / "root" / "dashboard.json").read_text())
    assert saved["format"] == "blud-upscale-dashboard/1" and saved["updated"]
    assert saved["runs"][0]["state"] == "running" and saved["showcase"]["runs"]["s8-rgb"]["best"] == {"p1": "img/x.png"}
    again = Dashboard(tmp_path / "root")
    assert again.run("s8-rgb")["state"] == "running" and len(again.state["runs"]) == 1


def test_index_html_is_self_contained():
    html = INDEX_HTML.read_text()
    assert "http://" not in html and "https://" not in html
    assert "dashboard.json" in html and "30000" in html
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_dashboard.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.dashboard'`.

- [ ] **Step 3: Implement the images**

`scripts/neural-upscale/nupscale/images.py`:

```python
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
```

- [ ] **Step 4: Implement the dashboard writer**

`scripts/neural-upscale/nupscale/dashboard.py`:

```python
"""dashboard.json writer. index.html is static and polls it (spec §4 Dashboard)."""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

INDEX_HTML = Path(__file__).with_name("dashboard_index.html")
DASHBOARD_FORMAT = "blud-upscale-dashboard/1"


def new_run(name: str) -> dict:
    return {"name": name, "state": "pending", "step": 0, "maxSteps": 0, "seconds": 0.0, "bestStep": None,
            "best": None, "g4": None, "config": None, "train": [], "val": []}


class Dashboard:
    """In-memory dashboard state, reloaded from <root>/dashboard.json when present (resume)."""

    def __init__(self, root: Path | str, dataset=None, meter=None) -> None:
        self.root = Path(root)
        (self.root / "img").mkdir(parents=True, exist_ok=True)
        path = self.root / "dashboard.json"
        if path.exists():
            self.state = json.loads(path.read_text())
        else:
            self.state = {"format": DASHBOARD_FORMAT, "updated": None, "dataset": None, "spend": None,
                          "baselines": {}, "runs": [], "showcase": {"pairs": [], "runs": {}}}
        if dataset is not None:
            self.state["dataset"] = {"name": dataset.name, "manifestHash": dataset.manifest_hash,
                                     "train": len(dataset.split("train")), "val": len(dataset.split("val"))}
        self.meter = meter
        shutil.copyfile(INDEX_HTML, self.root / "index.html")

    def run(self, name: str) -> dict:
        for r in self.state["runs"]:
            if r["name"] == name:
                return r
        r = new_run(name)
        self.state["runs"].append(r)
        return r

    def showcase_images(self, run: str, which: str) -> dict:
        return self.state["showcase"]["runs"].setdefault(run, {}).setdefault(which, {})

    def save(self) -> None:
        self.state["updated"] = datetime.now(timezone.utc).isoformat()
        if self.meter is not None:
            self.state["spend"] = self.meter.snapshot()
        tmp = self.root / "dashboard.json.tmp"
        tmp.write_text(json.dumps(self.state))
        os.replace(tmp, self.root / "dashboard.json")
```

- [ ] **Step 5: The static page**

The page must not load anything from the network: it is served from the pod's proxy and opened on phones. It polls `dashboard.json` every 30 s.

`scripts/neural-upscale/nupscale/dashboard_index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blud upscale training</title>
<style>
:root { color-scheme: dark; --bg: #111316; --panel: #1b1e23; --ink: #e6e6e6; --dim: #8b929c; --line: #2c3139; --good: #6fcf7f; --bad: #e36b6b; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
h1 { font-size: 18px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 24px 0 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dim { color: var(--dim); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 4px 8px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
svg { width: 100%; height: auto; display: block; }
.legend { font-size: 12px; } .legend span { margin-right: 10px; white-space: nowrap; }
.shots { display: grid; gap: 10px; }
.shot { display: flex; gap: 8px; overflow-x: auto; align-items: flex-start; }
.shot figure { margin: 0; }
.shot img { image-rendering: pixelated; display: block; max-height: 320px; }
figcaption { font-size: 12px; color: var(--dim); }
select { background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; font: inherit; }
.good { color: var(--good); } .bad { color: var(--bad); }
</style>
</head>
<body>
<main>
<h1>Blud neural upscale — training</h1>
<div id="meta" class="dim">loading…</div>
<h2>Runs <span class="dim">(best checkpoint; green = beats coverage-aware bicubic)</span></h2>
<div class="panel"><table id="runs"></table></div>
<h2>Curves <select id="curveRun" aria-label="run for curves"></select></h2>
<div class="charts" id="charts"></div>
<h2>Showcase <select id="shotRun" aria-label="run for showcase"></select>
<select id="shotWhich" aria-label="checkpoint"><option>best</option><option>latest</option></select></h2>
<div class="shots" id="shots"></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const COLORS = ['#e0a458', '#6fb3e0', '#b58be0', '#6fcf7f', '#e36b6b', '#d6d66b'];
const BASE_COLORS = { nearest: '#8b929c', bicubic: '#f0f0f0', native: '#d98bb0' };
const G4 = ['overall', 'face', 'wound', 'edge', 'class:medium', 'class:far'];
const COLS = ['overall', 'face', 'wound', 'edge', 'interior', 'class:close', 'class:medium', 'class:far', 'coverage_error_rate'];
let data = null;

const fmt = (v, d = 4) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() {
  try {
    const r = await fetch('dashboard.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
    render();
  } catch (e) {
    $('meta').textContent = 'Could not load dashboard.json: ' + e.message + ' (retrying every 30 s)';
  }
  setTimeout(load, 30000);
}

function bestRun() {
  let b = null;
  for (const r of data.runs) if (r.best && r.best.overall != null && (!b || r.best.overall < b.best.overall)) b = r;
  return b ? b.name : (data.runs[0] || {}).name;
}

function fillSelect(id, names) {
  const sel = $(id);
  const keep = sel.value;
  if ([...sel.options].map((o) => o.value).join('|') !== names.join('|')) {
    sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('');
  }
  sel.value = names.includes(keep) ? keep : bestRun();
}

function render() {
  const d = data;
  const ds = d.dataset ? ` · ${esc(d.dataset.name)}: ${d.dataset.train} train / ${d.dataset.val} val pairs` : '';
  const spend = d.spend ? ` · spend $${fmt(d.spend.spentUsd, 2)} of $${fmt(d.spend.capUsd, 2)} ($${fmt(d.spend.hourlyUsd, 2)}/h)` : '';
  $('meta').innerHTML = `Updated ${esc(new Date(d.updated).toLocaleString())}${ds}${spend}`;
  const names = d.runs.map((r) => r.name);
  fillSelect('curveRun', names);
  fillSelect('shotRun', names);
  renderRuns(d);
  renderCharts(d);
  renderShots(d);
}

function renderRuns(d) {
  const b = d.baselines || {};
  const bic = b.bicubic || {};
  const head = `<tr><th>run</th><th>state</th><th>step</th><th>best @</th>${COLS.map((c) => `<th>${esc(c.replace('class:', '').replace('coverage_error_rate', 'cov err'))}</th>`).join('')}<th>G4</th></tr>`;
  const baseRows = ['nearest', 'bicubic', 'native'].filter((k) => b[k]).map((k) =>
    `<tr class="dim"><td>${k}</td><td>baseline</td><td></td><td></td>${COLS.map((c) => `<td>${fmt(b[k][c])}</td>`).join('')}<td></td></tr>`);
  const runRows = d.runs.map((r) => {
    const cells = COLS.map((c) => {
      const v = r.best ? r.best[c] : null;
      const cls = v != null && bic[c] != null ? (v < bic[c] ? 'good' : 'bad') : '';
      return `<td class="${cls}">${fmt(v)}</td>`;
    }).join('');
    const g4 = r.g4 ? (G4.every((k) => r.g4[k] === true) ? '<span class="good">pass</span>' : '<span class="bad">not yet</span>') : '—';
    return `<tr><td>${esc(r.name)}</td><td>${esc(r.state)}</td><td>${r.step}/${r.maxSteps}</td><td>${r.bestStep ?? '—'}</td>${cells}<td>${g4}</td></tr>`;
  });
  $('runs').innerHTML = head + baseRows.join('') + runRows.join('');
}

function chart(title, series) {
  const W = 360, H = 200, L = 48, R = 8, T = 22, B = 24;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return `<div class="panel dim">${esc(title)}: no data yet</div>`;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]).concat(series.filter((s) => s.flat != null).map((s) => s.flat));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 === x0) x1 = x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1e-3;
  const pad = (y1 - y0) * 0.05;
  y0 -= pad; y1 += pad;
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  svg += `<text x="${L}" y="14" fill="#e6e6e6" font-size="12">${esc(title)}</text>`;
  svg += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#2c3139"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#2c3139"/>`;
  svg += `<text x="${L - 4}" y="${T + 8}" fill="#8b929c" font-size="10" text-anchor="end">${fmt(y1, 3)}</text>`;
  svg += `<text x="${L - 4}" y="${H - B}" fill="#8b929c" font-size="10" text-anchor="end">${fmt(y0, 3)}</text>`;
  svg += `<text x="${L}" y="${H - 8}" fill="#8b929c" font-size="10">${x0}</text><text x="${W - R}" y="${H - 8}" fill="#8b929c" font-size="10" text-anchor="end">${x1}</text>`;
  for (const s of series) {
    if (s.flat != null) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${sy(s.flat).toFixed(1)}" y2="${sy(s.flat).toFixed(1)}" stroke="${s.color}" stroke-dasharray="4 3" opacity="0.8"/>`;
    } else if (s.points.length) {
      svg += `<polyline fill="none" stroke="${s.color}" stroke-width="1.5" points="${s.points.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}"/>`;
    }
  }
  svg += '</svg>';
  const legend = series.map((s) => `<span style="color:${s.color}">${s.flat != null ? '- -' : '—'} ${esc(s.name)}</span>`).join('');
  return `<div class="panel">${svg}<div class="legend">${legend}</div></div>`;
}

function renderCharts(d) {
  const b = d.baselines || {};
  const flats = (key) => ['nearest', 'bicubic', 'native'].filter((k) => b[k] && b[k][key] != null)
    .map((k) => ({ name: k, color: BASE_COLORS[k], flat: b[k][key], points: [] }));
  const valOf = (run, key) => run.val.filter((v) => v.metrics[key] != null).map((v) => [v.step, v.metrics[key]]);
  const all = chart('validation overall, all runs', [
    ...d.runs.map((r, i) => ({ name: r.name, color: COLORS[i % COLORS.length], points: valOf(r, 'overall') })),
    ...flats('overall'),
  ]);
  const run = d.runs.find((r) => r.name === $('curveRun').value);
  if (!run) { $('charts').innerHTML = all; return; }
  const one = (key, title, color) => chart(title, [{ name: run.name, color, points: valOf(run, key) }, ...flats(key)]);
  $('charts').innerHTML = [
    all,
    chart(`${run.name} train loss`, [
      { name: 'total', color: COLORS[0], points: run.train.map((t) => [t[0], t[1]]) },
      { name: 'colour', color: COLORS[1], points: run.train.map((t) => [t[0], t[2]]) },
      { name: 'detail', color: COLORS[2], points: run.train.map((t) => [t[0], t[3]]) },
      { name: 'coverage', color: COLORS[4], points: run.train.map((t) => [t[0], t[4]]) },
    ]),
    one('face', 'face', COLORS[0]),
    one('wound', 'wound', COLORS[4]),
    one('edge', 'edge band', COLORS[1]),
    one('interior', 'body interior', COLORS[3]),
    one('class:close', 'close range', COLORS[2]),
    one('class:medium', 'medium range', COLORS[2]),
    one('class:far', 'far range', COLORS[2]),
    one('coverage_error_rate', 'coverage error rate', COLORS[5]),
  ].join('');
}

function renderShots(d) {
  const run = $('shotRun').value;
  const which = $('shotWhich').value;
  const imgs = ((d.showcase.runs || {})[run] || {})[which] || {};
  const v = encodeURIComponent(d.updated);
  const fig = (src, cap) => (src ? `<figure><img src="${esc(src)}?v=${v}" alt="${esc(cap)}" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>` : '');
  $('shots').innerHTML = d.showcase.pairs.map((p) => `<div class="panel"><div class="dim">${esc(p.id)} · ${esc(p.class)}</div><div class="shot">`
    + fig(p.base.nearest, 'nearest') + fig(p.base.bicubic, 'bicubic') + fig(imgs[p.id], `${run} (${which})`)
    + fig(p.base.native, 'native single-ray') + fig(p.base.target, 'supersampled target') + '</div></div>').join('')
    || '<div class="dim">no showcase pairs</div>';
}

$('curveRun').onchange = () => data && renderCharts(data);
$('shotRun').onchange = () => data && renderShots(data);
$('shotWhich').onchange = () => data && renderShots(data);
load();
</script>
</body>
</html>
```

- [ ] **Step 6: Run the tests**

Run the test command with `tests/test_dashboard.py`. Expected: `4 passed`.

- [ ] **Step 7: Commit**

```bash
git add scripts/neural-upscale/nupscale/images.py scripts/neural-upscale/nupscale/dashboard.py scripts/neural-upscale/nupscale/dashboard_index.html scripts/neural-upscale/tests/test_dashboard.py
git commit -m "feat(upscale P3b): dashboard.json, showcase PNGs and a self-contained polling page"
```

---

### Task 8: One training run

**Files:**
- Create: `scripts/neural-upscale/nupscale/train.py`, `scripts/neural-upscale/tests/test_train.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_train.py`:

```python
import json

import pytest
import torch

from nupscale.dashboard import Dashboard
from nupscale.data import load_dataset
from nupscale.train import RunConfig, prepare_dashboard, train_run
from tests.helpers import write_v2_dataset

CPU = torch.device("cpu")


def _cfg(**overrides):
    base = dict(max_steps=12, time_cap_s=600, val_every=6, log_every=3, batch=4, crop=8)
    base.update(overrides)
    return RunConfig("s8", "rgbd", **base)


def _setup(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    dash = Dashboard(root, ds)
    return ds, root, dash, prepare_dashboard(dash, ds)


def test_run_writes_checkpoints_exports_and_dashboard(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    res = train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines)
    assert res["state"] == "done" and res["step"] == 12 and res["bestStep"] in (6, 12)
    run = root / "s8-rgbd"
    for rel in ["ckpt-latest.pt", "ckpt-best.pt", "RUN_DONE.json",
                "exports/s8-rgbd-final/model.json", "exports/s8-rgbd-final/parity/meta.json",
                "exports/s8-rgbd-best/model.json", "exports/s8-rgbd-best/parity/output-sp-1.npy"]:
        assert (run / rel).exists(), rel
    best = json.loads((run / "exports/s8-rgbd-best/model.json").read_text())
    assert best["step"] == res["bestStep"] and best["trainedOn"] == {"dataset": "ds", "manifestHash": ds.manifest_hash}
    saved = json.loads((root / "dashboard.json").read_text())
    entry = saved["runs"][0]
    assert entry["state"] == "done" and [v["step"] for v in entry["val"]] == [6, 12]
    assert [t[0] for t in entry["train"]] == [1, 3, 6, 9, 12] and entry["g4"] is not None
    assert entry["config"]["regionWeights"]["face"] == 2.0
    assert set(saved["baselines"]) == {"nearest", "bicubic", "native"}
    pair = saved["showcase"]["pairs"][0]
    assert set(pair["base"]) == {"nearest", "bicubic", "native", "target"}
    assert (root / pair["base"]["bicubic"]).exists()
    assert (root / saved["showcase"]["runs"]["s8-rgbd"]["best"][pair["id"]]).exists()
    # a finished run is not trained again
    assert train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines) == res


def test_resume_continues_from_the_latest_checkpoint(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    calls = {"n": 0}

    def crash():
        calls["n"] += 1
        if calls["n"] > 8:
            raise RuntimeError("pod died")
        return False

    with pytest.raises(RuntimeError, match="pod died"):
        train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines, should_stop=crash)
    assert torch.load(root / "s8-rgbd" / "ckpt-latest.pt", weights_only=True)["step"] == 6
    res = train_run(_cfg(), ds, root, device=CPU, dashboard=Dashboard(root, ds), baselines=baselines)
    assert res["state"] == "done" and res["step"] == 12
    entry = json.loads((root / "dashboard.json").read_text())["runs"][0]
    assert [v["step"] for v in entry["val"]] == [6, 12]
    assert [t[0] for t in entry["train"]] == [1, 3, 6, 9, 12]


def test_time_cap_and_stop_still_validate_and_export(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    now = {"t": 0.0}

    def clock():
        now["t"] += 10.0
        return now["t"]

    res = train_run(_cfg(time_cap_s=45), ds, root, device=CPU, dashboard=dash, baselines=baselines, clock=clock)
    assert res["state"] == "time-cap" and 0 < res["step"] < 12
    assert (root / "s8-rgbd" / "exports" / "s8-rgbd-final" / "model.json").exists()
    stopped = train_run(RunConfig("s8", "rgb", max_steps=12, val_every=6, log_every=3, batch=4, crop=8),
                        ds, root, device=CPU, dashboard=dash, baselines=baselines, should_stop=lambda: True)
    assert stopped["state"] == "stopped" and stopped["step"] == 0
    assert json.loads((root / "s8-rgb" / "exports" / "s8-rgb-final" / "model.json").read_text())["step"] == 0
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_train.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.train'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/train.py`:

```python
"""One training run (spec §2), plus a CLI for a single run.

Usage: python -m nupscale.train --data <dataset> --root <run root> --model s16 --inputs rgbd
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import torch

from . import constants as C
from .dashboard import Dashboard
from .data import CropSampler, Dataset, Pair, load_dataset
from .evaluate import beats, evaluate, predict_bicubic, predict_model, predict_nearest
from .export import export_model, export_parity_fixture
from .images import save_march_png
from .losses import upscale_loss
from .model import Upscaler
from .reconstruct import reconstruct


@dataclass
class RunConfig:
    model_id: str
    inputs: str
    max_steps: int = C.MAX_STEPS
    time_cap_s: float = C.TIME_CAP_S
    val_every: int = C.VAL_EVERY
    log_every: int = C.LOG_EVERY
    batch: int = C.BATCH
    lr: float = C.LR
    crop: int = C.CROP_IN
    seed: int = 1
    region_share: float = C.REGION_CENTRED_SHARE
    coverage_margin: float = C.COVERAGE_MARGIN
    detail_weight: float = C.DETAIL_WEIGHT
    coverage_weight: float = C.COVERAGE_WEIGHT

    @property
    def name(self) -> str:
        return f"{self.model_id}-{self.inputs}"

    def record(self) -> dict:
        return {**asdict(self), "regionWeights": dict(C.REGION_WEIGHTS), "edgeBandPx": C.EDGE_BAND_PX,
                "icnrScale": C.ICNR_SCALE, "optimizer": "adam", "schedule": "cosine"}


def pick_device(name: str = "auto") -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def showcase_pairs(dataset: Dataset) -> list[Pair]:
    val = dataset.split("val")
    return [p for p in val if p.showcase] or val[:C.SHOWCASE_FALLBACK]


def compute_baselines(dataset: Dataset) -> dict:
    val = dataset.split("val")
    if not val:
        raise ValueError(f"dataset {dataset.name} has no validation pairs")
    native = [p for p in val if p.native is not None]
    return {
        "nearest": evaluate(predict_nearest, val),
        "bicubic": evaluate(predict_bicubic, val),
        "native": evaluate(lambda p: p.native, native) if native else None,
    }


def prepare_dashboard(dashboard: Dashboard, dataset: Dataset) -> dict:
    """Baseline metrics and showcase baseline crops, computed once per session."""
    baselines = compute_baselines(dataset)
    dashboard.state["baselines"] = baselines
    entries = []
    for p in showcase_pairs(dataset):
        kinds = {"nearest": predict_nearest(p), "bicubic": predict_bicubic(p), "target": p.target}
        if p.native is not None:
            kinds["native"] = p.native
        base = {}
        for kind, image in kinds.items():
            rel = f"img/base-{p.id}-{kind}.png"
            save_march_png(image, dashboard.root / rel)
            base[kind] = rel
        entries.append({"id": p.id, "class": p.cls, "base": base})
    dashboard.state["showcase"]["pairs"] = entries
    dashboard.save()
    return baselines


def _atomic_save(obj: dict, path: Path) -> None:
    tmp = path.with_name(path.name + ".tmp")
    torch.save(obj, tmp)
    os.replace(tmp, path)


def train_run(cfg: RunConfig, dataset: Dataset, root: Path | str, *, device: torch.device, dashboard: Dashboard,
              baselines: dict, should_stop: Callable[[], bool] = lambda: False,
              clock: Callable[[], float] = time.monotonic) -> dict:
    """Trains one run with validation, checkpoints and exports. Resumes from ckpt-latest.pt; a run
    with RUN_DONE.json is not re-trained. Stops at max_steps ("done"), the time cap ("time-cap") or
    when should_stop() is true ("stopped"), and always validates and exports before returning."""
    root = Path(root)
    run_dir = root / cfg.name
    run_dir.mkdir(parents=True, exist_ok=True)
    done_path = run_dir / "RUN_DONE.json"
    if done_path.exists():
        return json.loads(done_path.read_text())
    val = dataset.split("val")
    if not val:
        raise ValueError(f"dataset {dataset.name} has no validation pairs")
    near, far = dataset.near, dataset.far

    torch.manual_seed(cfg.seed)
    model = Upscaler(cfg.model_id, cfg.inputs, seed=cfg.seed).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=cfg.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(cfg.max_steps, 1))
    latest_path, best_path = run_dir / "ckpt-latest.pt", run_dir / "ckpt-best.pt"
    step, best_step, best_score, best_metrics = 0, None, None, None
    if latest_path.exists():
        ck = torch.load(latest_path, map_location=device, weights_only=True)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        step, best_step, best_score, best_metrics = ck["step"], ck["best_step"], ck["best_score"], ck["best_metrics"]
    validated_at = step if latest_path.exists() else -1

    sampler = CropSampler(dataset.split("train"), crop=cfg.crop, seed=cfg.seed + step, region_share=cfg.region_share)
    showcase = showcase_pairs(dataset)
    entry = dashboard.run(cfg.name)
    entry.update(state="running", maxSteps=cfg.max_steps, config=cfg.record())
    entry["train"] = [t for t in entry["train"] if t[0] <= step]
    entry["val"] = [v for v in entry["val"] if v["step"] <= step]

    def validate() -> None:
        nonlocal best_step, best_score, best_metrics
        model.eval()
        metrics = evaluate(lambda p: predict_model(model, p, near, far, device), val)
        latest = dashboard.showcase_images(cfg.name, "latest")
        for p in showcase:
            rel = f"img/{cfg.name}-{p.id}-latest.png"
            save_march_png(predict_model(model, p, near, far, device), root / rel)
            latest[p.id] = rel
        model.train()
        entry["val"] = [v for v in entry["val"] if v["step"] < step] + [{"step": step, "metrics": metrics}]
        score = metrics["overall"]
        if score is not None and (best_score is None or score < best_score):
            best_step, best_score, best_metrics = step, score, metrics
            _atomic_save({"model": model.state_dict(), "step": step, "metrics": metrics}, best_path)
            best = dashboard.showcase_images(cfg.name, "best")
            for p in showcase:
                rel = f"img/{cfg.name}-{p.id}-best.png"
                shutil.copyfile(root / latest[p.id], root / rel)
                best[p.id] = rel
        _atomic_save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                      "step": step, "best_step": best_step, "best_score": best_score,
                      "best_metrics": best_metrics}, latest_path)
        entry.update(step=step, bestStep=best_step, best=best_metrics,
                     g4=beats(best_metrics, baselines["bicubic"]) if best_metrics else None)
        dashboard.save()

    start = clock()
    elapsed = 0.0
    model.train()
    while True:
        if step >= cfg.max_steps:
            state = "done"
            break
        if should_stop():
            state = "stopped"
            break
        elapsed = clock() - start
        if elapsed >= cfg.time_cap_s:
            state = "time-cap"
            break
        march, target, weight = (t.to(device) for t in sampler.sample(cfg.batch))
        rec = reconstruct(march, model(march, near, far))
        loss, parts = upscale_loss(rec, target, weight, margin=cfg.coverage_margin,
                                   detail_weight=cfg.detail_weight, coverage_weight=cfg.coverage_weight)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        step += 1
        if step == 1 or step % cfg.log_every == 0:
            entry["train"].append([step, float(loss.detach()), float(parts["colour"]), float(parts["detail"]), float(parts["coverage"])])
            entry.update(step=step, seconds=elapsed)
        if step % cfg.val_every == 0:
            validate()
            validated_at = step
    if validated_at != step:
        validate()

    exports = run_dir / "exports"
    fixture_pairs = showcase + [p for p in val if p not in showcase]
    final_dir = exports / f"{cfg.name}-final"
    export_model(model, final_dir, run=cfg.name, step=step, dataset=dataset.name,
                 manifest_hash=dataset.manifest_hash, metrics=entry["val"][-1]["metrics"])
    export_parity_fixture(model, fixture_pairs, near, far, final_dir / "parity")
    if best_path.exists():
        ck = torch.load(best_path, map_location="cpu", weights_only=True)
        best_model = Upscaler(cfg.model_id, cfg.inputs)
        best_model.load_state_dict(ck["model"])
        best_dir = exports / f"{cfg.name}-best"
        export_model(best_model, best_dir, run=cfg.name, step=ck["step"], dataset=dataset.name,
                     manifest_hash=dataset.manifest_hash, metrics=ck["metrics"])
        export_parity_fixture(best_model, fixture_pairs, near, far, best_dir / "parity")

    result = {"name": cfg.name, "state": state, "step": step, "bestStep": best_step, "best": best_metrics,
              "g4": entry["g4"], "seconds": elapsed}
    entry.update(state=state, step=step, seconds=elapsed)
    dashboard.save()
    done_path.write_text(json.dumps(result, indent=1))
    return result


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Train one neural upscale run (P3b).")
    ap.add_argument("--data", required=True, help="dataset v2 directory")
    ap.add_argument("--root", required=True, help="run root (dashboard + run directories)")
    ap.add_argument("--model", default="s16", choices=["s8", "s16", "s32"])
    ap.add_argument("--inputs", default="rgbd", choices=["rgb", "rgbd"])
    ap.add_argument("--max-steps", type=int, default=C.MAX_STEPS)
    ap.add_argument("--time-cap-min", type=float, default=C.TIME_CAP_S / 60)
    ap.add_argument("--val-every", type=int, default=C.VAL_EVERY)
    ap.add_argument("--batch", type=int, default=C.BATCH)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    dataset = load_dataset(args.data)
    dashboard = Dashboard(args.root, dataset)
    baselines = prepare_dashboard(dashboard, dataset)
    cfg = RunConfig(args.model, args.inputs, max_steps=args.max_steps, time_cap_s=args.time_cap_min * 60,
                    val_every=args.val_every, batch=args.batch)
    result = train_run(cfg, dataset, args.root, device=pick_device(args.device), dashboard=dashboard, baselines=baselines)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_train.py`. Expected: `3 passed` (about 10 s on CPU).
Debugging facts:
- Checkpoints hold only tensors, numbers, strings and `None`, so `torch.load(..., weights_only=True)` must work. Don't switch to `weights_only=False`.
- The loop checks max steps, then `should_stop`, then the time cap, in that order. The tests count calls on that order.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/train.py scripts/neural-upscale/tests/test_train.py
git commit -m "feat(upscale P3b): resumable training run with validation, best/final exports and dashboard updates"
```

---

### Task 9: The grid and the spend meter

**Files:**
- Create: `scripts/neural-upscale/nupscale/grid.py`, `scripts/neural-upscale/tests/test_grid.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_grid.py`:

```python
import json

import pytest
import torch

from nupscale.constants import GRID
from nupscale.data import load_dataset
from nupscale.grid import SpendMeter, parse_runs, run_grid
from nupscale.train import RunConfig
from tests.helpers import write_v2_dataset

CPU = torch.device("cpu")


def _tiny(model_id, inputs):
    return RunConfig(model_id, inputs, max_steps=6, time_cap_s=1800, val_every=3, log_every=3, batch=2, crop=8)


class FakeMeter:
    def __init__(self, start_ok=True, over_after=None):
        self.start_ok, self.over_after, self.calls = start_ok, over_after, 0

    def can_start(self, seconds):
        return self.start_ok

    def over_cap(self):
        self.calls += 1
        return self.over_after is not None and self.calls > self.over_after

    def snapshot(self):
        return {"hourlyUsd": 1.0, "capUsd": 10.0, "spentUsd": 0.0}


def test_spend_meter():
    now = {"t": 1000.0}
    m = SpendMeter(0.6, 1.0, started_at=1000.0, spent_before=0.1, clock=lambda: now["t"])
    assert m.spent() == pytest.approx(0.1)
    now["t"] += 3600
    assert m.spent() == pytest.approx(0.7) and not m.over_cap()
    assert m.can_start(1700) and not m.can_start(1900)
    now["t"] += 3000
    assert m.over_cap() and m.snapshot() == {"hourlyUsd": 0.6, "capUsd": 1.0, "spentUsd": pytest.approx(1.2)}
    with pytest.raises(ValueError):
        SpendMeter(0, 10)


def test_parse_runs():
    assert parse_runs("") == list(GRID)
    assert parse_runs("s16-rgbd, s8-rgb") == [("s16", "rgbd"), ("s8", "rgb")]
    with pytest.raises(ValueError, match="unknown run"):
        parse_runs("s64-rgb")


def test_grid_runs_everything_and_resumes(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    runs = [("s8", "rgb"), ("s8", "rgbd")]
    summary = run_grid(ds, root, meter=FakeMeter(), device=CPU, runs=runs, make_config=_tiny)
    assert not summary["stoppedAtCap"] and [r["state"] for r in summary["results"]] == ["done", "done"]
    assert (root / "GRID_DONE.json").exists() and not (root / "STOPPED_AT_CAP").exists()
    assert json.loads((root / "dashboard.json").read_text())["spend"]["capUsd"] == 10.0
    again = run_grid(ds, root, meter=FakeMeter(), device=CPU, runs=runs, make_config=_tiny)
    assert again["results"] == summary["results"]


def test_grid_stops_mid_run_at_the_cap(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    summary = run_grid(ds, root, meter=FakeMeter(over_after=4), device=CPU,
                       runs=[("s8", "rgb"), ("s8", "rgbd")], make_config=_tiny)
    assert summary["stoppedAtCap"] and len(summary["results"]) == 1
    assert summary["results"][0]["state"] == "stopped" and summary["results"][0]["step"] == 4
    assert (root / "STOPPED_AT_CAP").exists()
    assert (root / "s8-rgb" / "exports" / "s8-rgb-final" / "model.json").exists()
    states = {r["name"]: r["state"] for r in json.loads((root / "dashboard.json").read_text())["runs"]}
    assert states == {"s8-rgb": "stopped", "s8-rgbd": "skipped-cap"}


def test_grid_does_not_start_an_unaffordable_run(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    meter = SpendMeter(1.0, 1.0, started_at=0.0, spent_before=0.5, clock=lambda: 0.0)
    summary = run_grid(ds, root, meter=meter, device=CPU, runs=[("s8", "rgb")], reserve_s=600, make_config=_tiny)
    assert summary["stoppedAtCap"] and summary["results"] == []
    assert not (root / "s8-rgb").exists()
    assert json.loads((root / "STOPPED_AT_CAP").read_text())["spentUsd"] == 0.5
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_grid.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.grid'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/grid.py`:

```python
"""The 6-run grid under the spend meter (spec §4 Grid, §6 stop rules).

Usage (on the pod): python -m nupscale.grid --data /workspace/data/<name> --root /workspace/runs/p3 \
    --hourly-usd 0.69 --cap-usd 10 --started-at <epoch seconds the pod started>
"""
from __future__ import annotations

import argparse
import json
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import constants as C
from .dashboard import Dashboard
from .data import Dataset, load_dataset
from .train import RunConfig, pick_device, prepare_dashboard, train_run


class SpendMeter:
    """Estimated spend = spent_before + hourly price x hours since started_at (wall clock)."""

    def __init__(self, hourly_usd: float, cap_usd: float, *, started_at: float | None = None,
                 spent_before: float = 0.0, clock: Callable[[], float] = time.time) -> None:
        if hourly_usd <= 0:
            raise ValueError("hourly_usd must be > 0")
        self.hourly_usd = float(hourly_usd)
        self.cap_usd = float(cap_usd)
        self.spent_before = float(spent_before)
        self.clock = clock
        self.started_at = clock() if started_at is None else float(started_at)

    def spent(self) -> float:
        return self.spent_before + max(0.0, self.clock() - self.started_at) / 3600 * self.hourly_usd

    def cost_of(self, seconds: float) -> float:
        return seconds / 3600 * self.hourly_usd

    def can_start(self, seconds: float) -> bool:
        return self.spent() + self.cost_of(seconds) <= self.cap_usd

    def over_cap(self) -> bool:
        return self.spent() >= self.cap_usd

    def snapshot(self) -> dict:
        return {"hourlyUsd": self.hourly_usd, "capUsd": self.cap_usd, "spentUsd": round(self.spent(), 4)}


def parse_runs(text: str | None) -> list[tuple[str, str]]:
    if not text:
        return list(C.GRID)
    runs = []
    for name in text.split(","):
        model_id, _, inputs = name.strip().partition("-")
        if (model_id, inputs) not in C.GRID:
            raise ValueError(f"unknown run {name.strip()!r} (expected one of {', '.join(f'{m}-{i}' for m, i in C.GRID)})")
        runs.append((model_id, inputs))
    return runs


def run_grid(dataset: Dataset, root: Path | str, *, meter, device, runs=C.GRID, reserve_s: float = C.RESERVE_S,
             make_config: Callable[[str, str], RunConfig] = RunConfig,
             clock: Callable[[], float] = time.monotonic) -> dict:
    """Runs in order. Before each run: if its estimated cost (time cap x RUN_OVERHEAD + reserve)
    would cross the cap, the grid stops. During a run the meter's over_cap stops it at the next
    step; the run still validates and exports. Either way STOPPED_AT_CAP is written."""
    root = Path(root)
    dashboard = Dashboard(root, dataset, meter=meter)
    baselines = prepare_dashboard(dashboard, dataset)
    for model_id, inputs in runs:
        dashboard.run(f"{model_id}-{inputs}")
    dashboard.save()
    results, stopped = [], False
    for model_id, inputs in runs:
        cfg = make_config(model_id, inputs)
        finished = (root / cfg.name / "RUN_DONE.json").exists()
        if not finished and not meter.can_start(cfg.time_cap_s * C.RUN_OVERHEAD + reserve_s):
            stopped = True
            break
        result = train_run(cfg, dataset, root, device=device, dashboard=dashboard, baselines=baselines,
                           should_stop=meter.over_cap, clock=clock)
        results.append(result)
        if result["state"] == "stopped":
            stopped = True
            break
    if stopped:
        (root / "STOPPED_AT_CAP").write_text(json.dumps(meter.snapshot()))
        for r in dashboard.state["runs"]:
            if r["state"] == "pending":
                r["state"] = "skipped-cap"
    summary = {"finished": datetime.now(timezone.utc).isoformat(), "stoppedAtCap": stopped,
               "spend": meter.snapshot(), "results": results}
    (root / "GRID_DONE.json").write_text(json.dumps(summary, indent=1))
    dashboard.save()
    return summary


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Run the neural upscale training grid under a spend cap (P3b).")
    ap.add_argument("--data", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--hourly-usd", type=float, required=True, help="the pod's hourly price")
    ap.add_argument("--cap-usd", type=float, default=10.0)
    ap.add_argument("--started-at", type=float, default=None, help="epoch seconds the pod started billing (default: now)")
    ap.add_argument("--spent-before", type=float, default=0.0, help="USD already spent outside this pod session")
    ap.add_argument("--reserve-min", type=float, default=C.RESERVE_S / 60, help="minutes kept back for pulling exports")
    ap.add_argument("--runs", default="", help="comma list, e.g. s16-rgbd,s8-rgb (default: the full grid)")
    ap.add_argument("--max-steps", type=int, default=C.MAX_STEPS)
    ap.add_argument("--time-cap-min", type=float, default=C.TIME_CAP_S / 60)
    ap.add_argument("--val-every", type=int, default=C.VAL_EVERY)
    ap.add_argument("--batch", type=int, default=C.BATCH)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    meter = SpendMeter(args.hourly_usd, args.cap_usd, started_at=args.started_at, spent_before=args.spent_before)

    def make_config(model_id: str, inputs: str) -> RunConfig:
        return RunConfig(model_id, inputs, max_steps=args.max_steps, time_cap_s=args.time_cap_min * 60,
                         val_every=args.val_every, batch=args.batch)

    try:
        summary = run_grid(load_dataset(args.data), root, meter=meter, device=pick_device(args.device),
                           runs=parse_runs(args.runs), reserve_s=args.reserve_min * 60, make_config=make_config)
    except Exception:
        (root / "GRID_FAILED.txt").write_text(traceback.format_exc())
        raise
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run the test command with `tests/test_grid.py`. Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/neural-upscale/nupscale/grid.py scripts/neural-upscale/tests/test_grid.py
git commit -m "feat(upscale P3b): 6-run grid under a spend meter (refuses unaffordable runs, stops at the cap)"
```

---

### Task 10: P2 conversion, full suite, pod compatibility

**Files:**
- Create: `scripts/neural-upscale/nupscale/convert_p2.py`, `scripts/neural-upscale/tests/test_convert_p2.py`

- [ ] **Step 1: Write the failing tests**

`scripts/neural-upscale/tests/test_convert_p2.py`:

```python
import json

import numpy as np
import pytest
import torch

from nupscale.constants import DATASET_FORMAT
from nupscale.convert_p2 import convert_p2, pair_crop
from nupscale.data import load_dataset
from tests.helpers import hwc, upsample_nearest


def _write_p2(root):
    frames = []
    for seq in range(3):
        (root / f"seq{seq}").mkdir(parents=True)
        for f in range(2 + (seq == 0)):
            inp = torch.zeros(4, 20, 30)
            inp[3] = 1.0
            if f < 2:  # seq 0 frame 2 stays empty and is skipped
                inp[:, 5:9, 10:14] = 0.5
            np.save(root / f"seq{seq}/frame{f:03d}-in.npy", hwc(inp))
            np.save(root / f"seq{seq}/frame{f:03d}-target.npy", hwc(upsample_nearest(inp)))
            frames.append({"seq": seq, "frame": f, "room": 1, "body": 2, "dist": [1.0, 2.5, 5.0][seq], "orbit": 0,
                           "input": f"seq{seq}/frame{f:03d}-in.npy", "target": f"seq{seq}/frame{f:03d}-target.npy",
                           "inputCoverage": 0.03})
    (root / "manifest.json").write_text(json.dumps({"near": 0.1, "far": 200, "checkout": "abc", "frames": frames}))


def test_pair_crop_rule():
    inp = np.ones((20, 30, 4), dtype=np.float32)
    target = np.ones((40, 60, 4), dtype=np.float32)
    assert pair_crop(inp, target) is None
    inp[5:9, 10:14, 3] = 0.5
    assert pair_crop(inp, target) == (2, 0, 20, 17)
    target[30:31, 57:59, 3] = 0.5  # target-only flesh, halved outward: x 28..30, y 15..16
    assert pair_crop(inp, target) == (2, 0, 28, 20)


def test_convert_p2(tmp_path):
    _write_p2(tmp_path / "p2")
    m = convert_p2(tmp_path / "p2", tmp_path / "v2")
    assert m["format"] == DATASET_FORMAT and len(m["pairs"]) == 6 and m["stats"]["skippedEmpty"] == 1
    assert m["pairs"][0]["crop"] == {"x": 2, "y": 0, "w": 20, "h": 17}
    assert [p["class"] for p in m["pairs"]][::2] == ["close", "medium", "far"]
    assert {p["split"] for p in m["pairs"] if p["seq"] == 2} == {"val"}
    assert {p["split"] for p in m["pairs"] if p["seq"] < 2} == {"train"}
    assert [p["showcase"] for p in m["pairs"]].count(True) == 2
    assert (tmp_path / "v2" / "pairs.jsonl").read_text().count("\n") == 6
    ds = load_dataset(tmp_path / "v2")
    assert ds.pairs[0].inp.shape == (4, 17, 20) and ds.pairs[0].target.shape == (4, 34, 40)
    assert int(ds.pairs[0].masks["flesh"].sum()) == 64
    with pytest.raises(FileExistsError):
        convert_p2(tmp_path / "p2", tmp_path / "v2")
```

- [ ] **Step 2: Run them to see them fail**

Run the test command with `tests/test_convert_p2.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.convert_p2'`.

- [ ] **Step 3: Implement**

`scripts/neural-upscale/nupscale/convert_p2.py`:

```python
"""Convert a P2 pair capture (full frames, single-ray targets) to dataset v2 for the pre-flight.

Usage: python -m nupscale.convert_p2 /tmp/blud-upscale-data/smoke-2026-09-11-r4 /tmp/blud-upscale-data/preflight-v2
The last sequence becomes validation. P2 has no head/wound annotations, so regions are empty.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .constants import DATASET_FORMAT

CROP_PAD = 8


def flesh_box(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    """(x0, y0, x1, y1), end-exclusive, of alpha < 1; None when there is no flesh."""
    ys, xs = np.nonzero(alpha < 1)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def pair_crop(inp: np.ndarray, target: np.ndarray, pad: int = CROP_PAD) -> tuple[int, int, int, int] | None:
    """Contracts §1 crop rule in input px: (x, y, w, h), or None when neither image has flesh."""
    h, w = inp.shape[:2]
    boxes = []
    a = flesh_box(inp[..., 3])
    if a:
        boxes.append(a)
    b = flesh_box(target[..., 3])
    if b:
        boxes.append((b[0] // 2, b[1] // 2, -(-b[2] // 2), -(-b[3] // 2)))
    if not boxes:
        return None
    x0 = max(min(bx[0] for bx in boxes) - pad, 0)
    y0 = max(min(bx[1] for bx in boxes) - pad, 0)
    x1 = min(max(bx[2] for bx in boxes) + pad, w)
    y1 = min(max(bx[3] for bx in boxes) + pad, h)
    return x0, y0, x1 - x0, y1 - y0


def distance_class(distance: float) -> str:
    return "close" if distance < 1.5 else "medium" if distance < 3.5 else "far"


def _save(path: Path, array: np.ndarray) -> int:
    np.save(path, np.ascontiguousarray(array, dtype="<f4"))
    return path.stat().st_size


def convert_p2(src: Path | str, dst: Path | str, *, showcase: int = 12) -> dict:
    src, dst = Path(src), Path(dst)
    manifest = json.loads((src / "manifest.json").read_text())
    if "frames" not in manifest:
        raise ValueError(f"{src}: not a P2 capture manifest (no 'frames')")
    if dst.exists() and any(dst.iterdir()):
        raise FileExistsError(f"{dst} exists and is not empty")
    (dst / "pairs").mkdir(parents=True, exist_ok=True)
    val_seq = max(int(f["seq"]) for f in manifest["frames"])
    pairs, sequences, skipped = [], {}, 0
    for fr in manifest["frames"]:
        inp = np.load(src / fr["input"])
        tgt = np.load(src / fr["target"])
        crop = pair_crop(inp, tgt)
        if crop is None:
            skipped += 1
            continue
        x, y, w, h = crop
        seq, frame = int(fr["seq"]), int(fr["frame"])
        pid = f"s{seq:04d}-f{frame:03d}"
        split = "val" if seq == val_seq else "train"
        cls = distance_class(float(fr["dist"]))
        d = dst / "pairs" / pid
        d.mkdir(parents=True)
        t = tgt[2 * y:2 * (y + h), 2 * x:2 * (x + w)]
        size = _save(d / "in.npy", inp[y:y + h, x:x + w])
        size += _save(d / "target.npy", t)
        size += _save(d / "target-coverage.npy", (t[..., 3:4] < 1).astype(np.float32))
        pairs.append({
            "id": pid, "seq": seq, "frame": frame, "split": split, "showcase": False,
            "class": cls, "lookAt": "torso", "character": f"p2-body-{fr.get('body')}", "room": fr.get("room"),
            "distance": fr["dist"], "orbitDeg": None, "wounds": 0,
            "crop": {"x": x, "y": y, "w": w, "h": h},
            "files": {"in": f"pairs/{pid}/in.npy", "target": f"pairs/{pid}/target.npy",
                      "targetCoverage": f"pairs/{pid}/target-coverage.npy", "native": None},
            "regions": {"heads": [], "wounds": []},
            "inputCoverage": fr.get("inputCoverage"), "iouPrev": None, "bytes": size, "p2": fr,
        })
        sequences.setdefault(seq, {"id": seq, "split": split, "captured": 0, "class": cls, "room": fr.get("room")})
        sequences[seq]["captured"] += 1
    for e in [p for p in pairs if p["split"] == "val"][:showcase]:
        e["showcase"] = True
    out = {
        "format": DATASET_FORMAT,
        "created": datetime.now(timezone.utc).isoformat(),
        "checkout": manifest.get("checkout"),
        "convertedFrom": str(src),
        "note": "P2 single-ray targets (not supersampled), no regions: pre-flight only",
        "near": manifest["near"],
        "far": manifest["far"],
        "input": manifest.get("input"),
        "target": {**(manifest.get("target") or {}), "samples": 1},
        "rowOrder": "row 0 = top",
        "checks": manifest.get("checks", {}),
        "stats": {"skippedEmpty": skipped},
        "sequences": list(sequences.values()),
        "pairs": pairs,
    }
    (dst / "pairs.jsonl").write_text("".join(json.dumps(p) + "\n" for p in pairs))
    (dst / "sequences.jsonl").write_text("".join(json.dumps(s) + "\n" for s in sequences.values()))
    (dst / "manifest.json").write_text(json.dumps(out, indent=1))
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Convert a P2 pair capture to dataset v2 (pre-flight only).")
    ap.add_argument("src")
    ap.add_argument("dst")
    args = ap.parse_args(argv)
    m = convert_p2(args.src, args.dst)
    splits = [p["split"] for p in m["pairs"]]
    print(f"OK {len(m['pairs'])} pairs ({splits.count('train')} train, {splits.count('val')} val), "
          f"skipped {m['stats']['skippedEmpty']} empty -> {args.dst}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run the test command with `tests/test_convert_p2.py`. Expected: `2 passed`.
Run the test command with `tests` (the whole directory). Expected: `54 passed`, no warnings.

- [ ] **Step 5: Pod compatibility (Python 3.10, torch 2.1)**

```bash
(cd scripts/neural-upscale && uv run --python 3.10 --with 'torch==2.1.2' --with 'numpy<2' --with 'pillow>=9.0' --with pytest python -m pytest -q -p no:cacheprovider tests)
```

Expected: `54 passed`. If a failure is only a syntax or typing feature newer than 3.10, rewrite that line for 3.10. The pod image can't run it otherwise.

- [ ] **Step 6: Convert the real smoke capture (when present)**

```bash
ls /tmp/blud-upscale-data/smoke-2026-09-11-r4/manifest.json && \
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.convert_p2 /tmp/blud-upscale-data/smoke-2026-09-11-r4 /tmp/blud-upscale-data/preflight-v2)
```

Expected: `OK 60 pairs (40 train, 20 val), skipped 0 empty -> /tmp/blud-upscale-data/preflight-v2`.
- If the smoke capture is missing, skip this step; P3d regenerates it.
- If the destination already has a `manifest.json` (`FileExistsError`), an earlier run converted it; leave it.

- [ ] **Step 7: Commit**

```bash
git add scripts/neural-upscale/nupscale/convert_p2.py scripts/neural-upscale/tests/test_convert_p2.py
git commit -m "feat(upscale P3b): convert the P2 smoke capture to dataset v2 for the pre-flight"
```
