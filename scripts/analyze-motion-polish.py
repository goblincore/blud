#!/usr/bin/env python3
"""Motion-polish browser verification analysis (CDP screenshots, no eyes).

1. NOISE ANCHOR: correlate a high-pass TORSO crop between settle-1/settle-2
   (same authored pose, follow-camera framing, ~1.4m apart in the world).
   Rides-the-flesh => strong correlation at zero shift; world-anchored =>
   the pattern slid ~a body height and decorrelates.
2. HEAD SOCKET: per gait frame, the upper body must be ONE connected flesh
   component with the head band centred over the torso — no floating head,
   no detached brow spike.
"""
import glob
import sys

import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/motion-polish'


def load(name):
    return np.asarray(Image.open(f'{OUT}/{name}.png').convert('RGB'), dtype=np.float32)


def body_mask(img):
    """Tight body locale: brighter than the dark scene floor, left of the
    panel, off the HUD bands, and only rows whose bright run is narrow (the
    body is < 25% of frame width; the floor reflection spans half)."""
    h, w, _ = img.shape
    m = img.mean(axis=2) > 45
    m[:, int(w * 0.72):] = False
    m[:, :int(w * 0.06)] = False
    m[:int(h * 0.05), :] = False
    m[int(h * 0.93):, :] = False
    keep = np.zeros_like(m)
    for y in range(h):
        row = np.where(m[y])[0]
        if len(row) > 20 and row.max() - row.min() < w * 0.25:
            keep[y, row] = True
    return keep


def bbox(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def highpass(img, sigma=6):
    lum = img.mean(axis=2)
    pim = Image.fromarray(np.uint8(np.clip(lum, 0, 255)))
    blur = np.asarray(pim.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
    return lum - blur


def corr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


# --- 1. noise anchor ---------------------------------------------------------
s1, s2 = load('settle-1'), load('settle-2')
m1, m2 = body_mask(s1), body_mask(s2)
b1, b2 = bbox(m1), bbox(m2)
if not b1 or not b2:
    raise SystemExit('body not found in settle shots')


def torso(img, b):
    x0, x1, y0, y1 = b
    cy = (y0 + y1) // 2
    bh = y1 - y0
    return img[cy - bh // 6: cy + bh // 6, x0:x1]


print(f'body bbox settle-1: {b1}  settle-2: {b2}')
c1, c2 = highpass(torso(s1, b1)), highpass(torso(s2, b2))
r0 = corr(c1, c2)
ctrls = {}
for d in (-30, -15, 15, 30):
    ctrls[f'dy{d}'] = corr(c1[max(0, -d):c1.shape[0] - max(0, d)],
                           c2[max(0, d):c2.shape[0] - max(0, -d)])
    ctrls[f'dx{d}'] = corr(c1[:, max(0, -d):c1.shape[1] - max(0, d)],
                           c2[:, max(0, d):c2.shape[1] - max(0, -d)])
print(f'NOISE ANCHOR torso high-pass correlation, aligned: {r0:+.3f}')
print('  shifted controls: ' + ', '.join(f'{k}: {v:+.3f}' for k, v in ctrls.items()))


# --- 2. head socket ----------------------------------------------------------
def n_components(mask, min_size=500):
    hh, ww = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    sizes = []
    for yy in range(hh):
        for xx in range(ww):
            if mask[yy, xx] and not seen[yy, xx]:
                stack = [(yy, xx)]
                seen[yy, xx] = True
                n = 0
                while stack:
                    cy, cx = stack.pop()
                    n += 1
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < hh and 0 <= nx < ww and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
                sizes.append(n)
    return sorted((s for s in sizes if s >= min_size), reverse=True)


for path in sorted(glob.glob(f'{OUT}/gait-*.png')) + [f'{OUT}/walk-B.png']:
    name = path.split('/')[-1]
    img = load(name.replace('.png', ''))
    mask = body_mask(img)
    b = bbox(mask)
    if not b:
        print(f'{name}: NO BODY')
        continue
    x0, x1, y0, y1 = b
    hgt, bodyw = y1 - y0, x1 - x0
    ys, xs = np.where(mask)
    headband = ys < y0 + hgt * 0.18
    torsoband = (ys > y0 + hgt * 0.38) & (ys < y0 + hgt * 0.58)
    off = (abs(xs[headband].mean() - xs[torsoband].mean()) / max(bodyw, 1)
           if headband.sum() and torsoband.sum() else float('nan'))
    upper = mask[:int(y0 + hgt * 0.45), :]
    comps = n_components(upper)
    print(f'{name}: upper-body comps>={comps and 500}px={len(comps)} '
          f'(sizes {comps[:4]})  head-vs-torso lateral offset={off:.2f} body-widths')
