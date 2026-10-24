#!/usr/bin/env python3
"""Generate public/assets/lab/faces/flayer-face.png — the flayer's face decal.

Same method and projection as make-butcher-face.py (the flayer wears the same
face-block head). Only the LOWER face shows: the kit's helmet covers everything
from just under the nose up (its rim at about image y 0.56 at the centre,
lower at the cheeks), so the decal spends itself on what is bare:

  * the cheeks FLAYED: the skin peeled back off raw cheek muscle, drawn as red
    fibre striations fanning from the mouth corners toward the ears, with a
    ragged dark edge where the skin was cut;
  * a LIPLESS grin: no lips at all, a long row of exposed teeth in gums from
    cheek to cheek, wider than the butcher's mouth;
  * staples along the helmet's rim where it is fixed into the face.

MULTIPLY (decal 0), seeded, original art, as the butcher's.

Run:  python3 scripts/make-flayer-face.py
Out:  public/assets/lab/faces/flayer-face.png  (512x512 RGBA)
"""
from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
SS = 4
W = SIZE * SS
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "public", "assets", "lab", "faces", "flayer-face.png")

EYE_Y = 0.40
EYE_DX = 0.12
MOUTH_Y = 0.70

rng = random.Random(0xF1A7)


def P(x: float, y: float) -> tuple[float, float]:
    return (x * W, y * W)


def ink(rgb: tuple[int, int, int], a: int) -> tuple[int, int, int, int]:
    return (*rgb, a)


def layer() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def ragged(cx: float, cy: float, rx: float, ry: float, jitter: float, n: int = 26) -> list[tuple[float, float]]:
    return [P(cx + rx * math.cos(2 * math.pi * k / n) * rng.uniform(1 - jitter, 1 + jitter),
              cy + ry * math.sin(2 * math.pi * k / n) * rng.uniform(1 - jitter, 1 + jitter)) for k in range(n)]


img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# --- 1. flayed cheeks: raw muscle fanning from the mouth corners, the cut skin's ragged edge ---
flay, d = layer()
for sx in (-1, 1):
    cx, cy = 0.5 + sx * 0.17, 0.70
    poly = ragged(cx + sx * 0.06, 0.66, 0.15, 0.12, 0.22, 30)
    d.polygon(poly, fill=ink((150, 30, 32), 170))                                   # raw meat
    for k in range(16):                                                            # fibres toward the ear
        a = math.radians(-70 + k * 9) if sx > 0 else math.radians(180 + 70 - k * 9)
        x0, y0 = cx - sx * 0.02, cy + 0.01
        L = rng.uniform(0.10, 0.17)
        d.line([P(x0, y0), P(x0 + math.cos(a) * L, y0 + math.sin(a) * L * 0.7)], fill=ink((95, 12, 16), 150), width=int(W * 0.004))
    d.line(poly + poly[:1], fill=ink((40, 8, 8), 200), width=int(W * 0.007), joint="curve")   # the cut edge
flay = flay.filter(ImageFilter.GaussianBlur(W * 0.002))
img = Image.alpha_composite(img, flay)

# --- 2. the lipless grin: gums and a long row of teeth, cheek to cheek ---
mouth, d = layer()
L_, R_ = 0.28, 0.72


def lip(t: float, up: bool) -> tuple[float, float]:
    x = L_ + (R_ - L_) * t
    open_h = 0.034 * math.sin(math.pi * t) ** 0.6
    curl = -0.030 * (2 * t - 1) ** 2                                               # corners pulled UP: the grin
    return P(x, 0.70 + curl + (-open_h if up else open_h))


N = 48
top = [lip(i / N, True) for i in range(N + 1)]
bot = [lip(i / N, False) for i in range(N + 1)]
d.polygon(top + bot[::-1], fill=ink((70, 12, 14), 240))
inner = [(x, y + W * 0.012) for x, y in [lip(i / N, True) for i in range(3, N - 2)]]
inner_b = [(x, y - W * 0.012) for x, y in [lip(i / N, False) for i in range(3, N - 2)]]
d.polygon(inner + inner_b[::-1], fill=ink((8, 2, 2), 250))
for up in (True, False):
    for i in range(15):
        t = 0.06 + i * 0.063 + rng.uniform(-0.008, 0.008)
        x0, y0 = lip(t, up)
        h = W * rng.uniform(0.022, 0.034) * (1 if up else -1)
        w = W * rng.uniform(0.010, 0.013)
        sh = rng.randint(150, 195)
        d.polygon([(x0 - w / 2, y0), (x0 + w / 2, y0), (x0 + w * 0.2, y0 + h), (x0 - w * 0.25, y0 + h * 0.92)],
                  fill=ink((sh, sh - 12, sh - 44), 240))
mouth = mouth.filter(ImageFilter.GaussianBlur(W * 0.0015))
img = Image.alpha_composite(img, mouth)

# --- 3. staples along the helmet's rim ---
scar, d = layer()
rim = [(0.12 + 0.76 * k / 20, 0.56 + 0.10 * ((k / 20 - 0.5) * 2) ** 2) for k in range(21)]
for k in range(1, 20, 2):
    x, y = P(*rim[k])
    d.line([(x, y - W * 0.018), (x, y + W * 0.018)], fill=ink((165, 165, 170), 240), width=int(W * 0.006))
d.line([P(*p) for p in rim], fill=ink((60, 14, 14), 160), width=int(W * 0.006), joint="curve")
img = Image.alpha_composite(img, scar)

# --- 6. pitting and grime: pocks inside a face oval; a grey-violet grime so
# the face is a shade sicker than the scalp (a yellow grime read as the ogre) ---
pit, d = layer()
for _ in range(600):
    x, y = rng.uniform(0.12, 0.88), rng.uniform(0.10, 0.92)
    e = ((x - 0.5) / 0.40) ** 2 + ((y - 0.52) / 0.44) ** 2
    if e > 1:
        continue
    r = W * rng.choice((0.002, 0.002, 0.003, 0.003, 0.004, 0.006))
    a = int(rng.uniform(50, 150) * (1 - e ** 3))
    d.ellipse([x * W - r, y * W - r, x * W + r, y * W + r], fill=ink((25, 12, 6), a))
img = Image.alpha_composite(img, pit)
grime = Image.new("L", (W, W), 0)
ImageDraw.Draw(grime).ellipse([*P(0.14, 0.12), *P(0.86, 0.92)], fill=52)
grime = grime.filter(ImageFilter.GaussianBlur(W * 0.05))
base = Image.new("RGBA", (W, W), (78, 56, 70, 0))
base.putalpha(grime)
img = Image.alpha_composite(base, img)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save(OUT, optimize=True)
op = sum(1 for p in img.get_flattened_data() if p[3] > 0)
print(f"wrote {OUT}: {SIZE}x{SIZE}, {op / SIZE / SIZE:.1%} texels above alpha 0")
