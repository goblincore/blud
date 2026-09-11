#!/usr/bin/env python3
"""Offline G2 alignment diagnosis on the frames the capture's checks scored.

Usage: uv run --with numpy python3 scripts/upscale-g2-diag.py <UPSCALE_OUT of a capture run with UPSCALE_DUMP_CHECK=1>
Needs check-in.npy, check-target.npy (UPSCALE_DUMP_CHECK=1) and manifest.json (near/far).

Separates a REAL geometric offset from shading/aliasing confounds:
  - colour registration (what the gate measured)
  - linear-depth registration (geometry only: no shading, no texture detail)
  - mask IoU vs shift (edges)
  - silhouette extents (a real offset moves opposite edges the same way)
"""
import json
import sys
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

root = Path(sys.argv[1])
lr = np.load(root / "check-in.npy").astype(np.float64)      # (300, 400, 4)
hr = np.load(root / "check-target.npy").astype(np.float64)  # (600, 800, 4)
manifest = json.loads((root / "manifest.json").read_text())
near = manifest["checks"]["nearFar"]["near"]
far = manifest["checks"]["nearFar"]["far"]
lin = lambda d: near * far / (far - d * (far - near))
R = 2
lh = lr[..., 3] < 1
hh = hr[..., 3] < 1
Hh, Wh = hh.shape
print(f"input {lr.shape}, target {hr.shape}, near {near}, far {far}")
print(f"flesh: input {lh.sum()} texels, target {hh.sum()} px")

# Interior texels: LR flesh, and the whole HR window any shift reads is flesh.
win = 2 * R + 2
allflesh = sliding_window_view(hh, (win, win)).all(axis=(-1, -2))
ys, xs = np.nonzero(lh)
Y0, X0 = 2 * ys - R, 2 * xs - R
ok = (Y0 >= 0) & (X0 >= 0) & (Y0 < allflesh.shape[0]) & (X0 < allflesh.shape[1])
ys, xs, Y0, X0 = ys[ok], xs[ok], Y0[ok], X0[ok]
ok = allflesh[Y0, X0]
ys, xs = ys[ok], xs[ok]
print(f"interior texels: {len(ys)}")


def block_mean(img, oy, ox):
    Y, X = 2 * ys + oy, 2 * xs + ox
    return 0.25 * (img[Y, X] + img[Y, X + 1] + img[Y + 1, X] + img[Y + 1, X + 1])


def surface(lr_vals, hr_img):
    g = np.zeros((2 * R + 1, 2 * R + 1))
    for oy in range(-R, R + 1):
        for ox in range(-R, R + 1):
            d = lr_vals - block_mean(hr_img, oy, ox)
            g[oy + R, ox + R] = np.mean(d * d)
    return g


def vertex(g):
    at = lambda ox, oy: g[oy + R, ox + R]
    e0 = at(0, 0)
    A = (at(1, 0) - 2 * e0 + at(-1, 0)) / 2
    B = (at(0, 1) - 2 * e0 + at(0, -1)) / 2
    C = (at(1, 1) - at(1, -1) - at(-1, 1) + at(-1, -1)) / 4
    D = (at(1, 0) - at(-1, 0)) / 2
    E = (at(0, 1) - at(0, -1)) / 2
    det = 4 * A * B - C * C
    if det > 0 and A > 0:
        return ((C * E - 2 * B * D) / det, (C * D - 2 * A * E) / det)
    return (float("nan"), float("nan"))


def report(name, g, fmt="%.3e", best=np.argmin):
    iy, ix = np.unravel_index(best(g), g.shape)
    v = vertex(g) if best is np.argmin else ("n/a",)
    print(f"\n{name}: best (ox, oy) = ({ix - R}, {iy - R})  quadratic vertex = {v}")
    print("        " + " ".join(f"ox={ox:+d}".rjust(10) for ox in range(-R, R + 1)))
    for oy in range(-R, R + 1):
        print(f"  oy={oy:+d} " + " ".join((fmt % g[oy + R, ox + R]).rjust(10) for ox in range(-R, R + 1)))


rgb = lr[ys, xs, :3]
print(f"\nrgb on interior flesh: input mean {rgb.mean():.3f} max {rgb.max():.3f}; "
      f"target mean {hr[hh][:, :3].mean():.3f} max {hr[hh][:, :3].max():.3f}")
report("COLOUR registration (rgb MSE)", surface(rgb, hr[..., :3]))
report("DEPTH registration (linear depth MSE, m^2)", surface(lin(lr[ys, xs, 3]), lin(hr[..., 3])))

# Pixel-scale energy: how much the target varies INSIDE a 2x2 block (sub-texel detail a
# half-res ray cannot see) vs the colour error at the best shift.
Y, X = 2 * ys, 2 * xs
blk = np.stack([hr[Y, X, :3], hr[Y, X + 1, :3], hr[Y + 1, X, :3], hr[Y + 1, X + 1, :3]])
print(f"\nwithin-block rgb variance (sub-texel detail), mean: {blk.var(axis=0).mean():.3e}")

# Mask IoU vs shift: LR coverage nearest-upsampled x2 vs target coverage shifted by (ox, oy).
up = np.repeat(np.repeat(lh, 2, 0), 2, 1)
iou = np.zeros((2 * R + 1, 2 * R + 1))
for oy in range(-R, R + 1):
    for ox in range(-R, R + 1):
        ya, yb = max(0, -oy), min(Hh, Hh - oy)
        xa, xb = max(0, -ox), min(Wh, Wh - ox)
        a = up[ya:yb, xa:xb]
        b = hh[ya + oy:yb + oy, xa + ox:xb + ox]
        iou[oy + R, ox + R] = (a & b).sum() / max(1, (a | b).sum())
report("MASK IoU vs shift (higher = better)", iou, fmt="%.4f", best=np.argmax)


def extents(mask, scale):
    rows = np.nonzero(mask.any(axis=1))[0]
    cols = np.nonzero(mask.any(axis=0))[0]
    # continuous output-px edges: LR texel i spans [scale*i, scale*(i+1)]
    return dict(top=rows[0] * scale, bottom=(rows[-1] + 1) * scale, left=cols[0] * scale, right=(cols[-1] + 1) * scale)


el, eh = extents(lh, 2), extents(hh, 1)
print("\nsilhouette extents in output px (input x2 vs target, and input - target):")
for k in ("top", "bottom", "left", "right"):
    print(f"  {k:6s} {el[k]:5d} {eh[k]:5d}  {el[k] - eh[k]:+d}")

# Row-wise coverage profile cross-correlation: robust vertical offset of the whole silhouette.
pl = np.repeat(lh.sum(axis=1).astype(float) / 2.0, 2)   # per output row, in output-px widths
ph = hh.sum(axis=1).astype(float)
best = None
for s in np.arange(-3.0, 3.01, 0.5):
    shifted = np.interp(np.arange(Hh) - s, np.arange(Hh), pl)   # input profile moved down by s
    err = np.mean((shifted - ph) ** 2)
    print(f"  row-profile shift {s:+.1f}: mse {err:.2f}")
    if best is None or err < best[1]:
        best = (s, err)
print(f"row-profile best vertical shift of input vs target: {best[0]:+.1f} output px")
