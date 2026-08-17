# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["numpy==2.5.2"]
# ///
"""Numeric midpoint diagnostics for the X1.27 clip (Task B gate).

For every frame and every adjacent-pair alpha=0.5 blend, scan each (y, z) row
along X (the thumbward axis the four fingers fan across) and count inside
intervals (negative runs). Ghosting from blending two laterally-offset surfaces
adds EXTRA intervals vs both parents; mitten bridging collapses the interval
count toward 1 in rows where parents keep separate digits.

Run: uv run scripts/clip_midpoint_probe.py
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
LAB = SCRIPTS_DIR.parent / "public" / "assets" / "lab"


def load_mod():
    spec = importlib.util.spec_from_file_location(
        "bake_hand_sdf_clip", SCRIPTS_DIR / "bake_hand_sdf_clip.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["bake_hand_sdf_clip"] = mod
    spec.loader.exec_module(mod)
    return mod


def intervals_along_x(field: np.ndarray) -> np.ndarray:
    """(ny, nz) count of negative runs along axis x (axis 2)."""
    neg = field < 0.0
    starts = neg & ~np.roll(neg, 1, axis=2)
    starts[:, :, 0] = neg[:, :, 0]
    return starts.sum(axis=2)


def deep_ranges(row: np.ndarray, depth: float) -> list[tuple[int, int, float]]:
    """Negative x-ranges of a row that reach `depth` (m) below zero."""
    neg = row < 0.0
    out = []
    i = 0
    n = len(row)
    while i < n:
        if not neg[i]:
            i += 1
            continue
        j = i
        while j < n and neg[j]:
            j += 1
        if row[i:j].min() <= -depth:
            out.append((i, j, float(row[i:j].min())))
        i = j
    return out


def row_artifacts(row0: np.ndarray, row1: np.ndarray, rowb: np.ndarray,
                  depth: float, min_voxels: int) -> tuple[int, int]:
    """True ghost/mitten artifacts for one row against both parents.

    A GHOST is a deep blend interval inside the x-span where both parents
    hold the SAME digit (overlapping deep ranges): one digit rendering as two
    surfaces. A MITTEN is a bridge between two x-ranges that are separate
    digits in BOTH parents with a persistent open gap.
    """
    r0 = deep_ranges(row0, depth)
    r1 = deep_ranges(row1, depth)
    ghosts = 0
    if r0 and r1:
        rb = [rng for rng in deep_ranges(rowb, depth)
              if rng[1] - rng[0] >= min_voxels]
        for a0, b0, _ in r0:
            for a1, b1, _ in r1:
                lo, hi = max(a0, a1), min(b0, b1)
                if hi - lo < min_voxels:
                    continue  # not the same digit in both parents
                inside = sum(1 for ab, bb, _ in rb if ab < hi and bb > lo)
                if inside >= 2:
                    ghosts += 1
    mittens = 0
    for which, ranges in ((0, r0), (1, r1)):
        if len(ranges) < 2:
            continue
        other = r1 if which == 0 else r0
        for ai in range(len(ranges)):
            for bi in range(ai + 1, len(ranges)):
                a0, b0, _ = ranges[ai]
                a1, b1, _ = ranges[bi]
                mid = (b0 + a1) // 2
                if not (b0 <= mid < a1):
                    continue
                gap_p = row0 if which == 0 else row1
                gap_o = row1 if which == 0 else row0
                if gap_p[mid] <= 0.0:
                    continue  # no open gap in this parent
                # the gap must be open in the OTHER parent too (persistent web)
                if any(aa < mid < bb for aa, bb, _ in other):
                    continue
                if gap_o[mid] <= 0.0:
                    continue
                if rowb[mid] < 0.0:
                    mittens += 1
    return ghosts, mittens


def main() -> int:
    mod = load_mod()
    manifest = json.loads((LAB / "hand-sdf-dynamite-grip-r.json").read_text())
    data = (LAB / "hand-sdf-dynamite-grip-r.r16f").read_bytes()
    nx, ny, nz = manifest["dimensions"]
    atlas = np.frombuffer(data, dtype="<f2").reshape(
        nz * manifest["frameCount"], ny, nx).astype(np.float32)

    frames = [np.ascontiguousarray(atlas[i * nz:(i + 1) * nz]) for i in range(6)]
    counts = [intervals_along_x(f) for f in frames]

    print("per-frame interval stats along X (rows = ny*nz grid):")
    for i, label in enumerate(mod.LABELS):
        c = counts[i]
        print(f"  {i} {label:<14} max={c.max()} rows>=2 int: "
              f"{int((c >= 2).sum()):5d}  rows>=3: {int((c >= 3).sum()):5d}  "
              f"rows>=4: {int((c >= 4).sum()):5d}")

    print("\nmidpoint (alpha=0.5) vs parents (depth-guarded):")
    ok = True
    pitch = min(manifest["voxelSize"])
    for i in range(5):
        blend = 0.5 * (frames[i].astype(np.float64)
                       + frames[i + 1].astype(np.float64)).astype(np.float32)
        ghost_rows = mitten_rows = 0
        for zi in range(nz):
            for yi in range(ny):
                g, m = row_artifacts(frames[i][zi, yi], frames[i + 1][zi, yi],
                                     blend[zi, yi], depth=0.0015,
                                     min_voxels=2)
                ghost_rows += g
                mitten_rows += m
        print(f"  {mod.LABELS[i]:<14}+{mod.LABELS[i + 1]:<14} "
              f"ghostRows={ghost_rows} mittenRows={mitten_rows}")
        if ghost_rows:
            ok = False
            print("    GHOST: same digit splits into two deep surfaces")
        if mitten_rows:
            ok = False
            print("    MITTEN: gap open in both parents bridges over")
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
