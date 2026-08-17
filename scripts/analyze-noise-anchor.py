#!/usr/bin/env python3
"""Noise-anchor wiring A/B analysis (motion-polish).

S_live  : walking, anchor = live rootShift (-1.27, 0.62)
statue1 : motion disabled same second — body/camera frozen, anchor forced (0,0)
statue2 : another statue frame — identical anchor, noise floor

Locates the body as the largest region that CHANGES between shots (background
is static), then measures high-pass RMS diff inside the torso:
  plumbed  => diff(S_live, statue1) >> floor diff(statue1, statue2)
  dead     => S_live == statue1 == statue2
Also writes a side-by-side + diff panel for the dev-note.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/motion-polish'


def load(name):
    return np.asarray(Image.open(f'{OUT}/{name}.png').convert('RGB'), dtype=np.float32)


def highpass(img, sigma=6):
    lum = img.mean(axis=2)
    pim = Image.fromarray(np.uint8(np.clip(lum, 0, 255)))
    blur = np.asarray(pim.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
    return lum - blur


live, st1, st2 = load('S_live'), load('statue1'), load('statue2')
h, w, _ = live.shape

# body locale = biggest blob of pixels that changed between live and statue
change = np.abs(live - st1).mean(axis=2) > 12
change[:, int(w * 0.75):] = False
change[:int(h * 0.05), :] = False
ys, xs = np.where(change)
if len(xs) == 0:
    raise SystemExit('nothing changed between live and statue — anchor dead or body static')
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print(f'changed region (body locale): x {x0}..{x1}  y {y0}..{y1}  ({change.sum()} px)')

# torso band: middle of the changed bbox, avoid the head (eye-glow flicker)
cy, bh = (y0 + y1) // 2, y1 - y0
band = np.s_[max(0, cy - bh // 8): cy + bh // 8, x0:x1]
hp_live, hp1, hp2 = highpass(live), highpass(st1), highpass(st2)
d_live = hp_live[band] - hp1[band]
d_floor = hp1[band] - hp2[band]
print(f'torso high-pass RMS  live->statue1 (anchor flipped): {np.sqrt((d_live**2).mean()):.3f}')
print(f'torso high-pass RMS  statue1->statue2 (noise floor): {np.sqrt((d_floor**2).mean()):.3f}')
print(f'torso high-pass std  (pattern scale, live):          {hp_live[band].std():.3f}')

# panel for the dev-note
def eightbit(a):
    return Image.fromarray(np.uint8(np.clip(a, 0, 255)))
panel = Image.new('RGB', (w, h * 3 + 20))
panel.paste(eightbit(live), (0, 0))
panel.paste(eightbit(st1), (0, h + 10))
diff = np.abs(hp_live - hp1) * 6 + 128
panel.paste(Image.fromarray(np.uint8(np.clip(diff, 0, 255)), 'L').convert('RGB'), (0, 2 * h + 20))
panel.save(f'{OUT}/noise-anchor-ab.png')
print('panel ->', f'{OUT}/noise-anchor-ab.png')
