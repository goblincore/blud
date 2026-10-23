#!/usr/bin/env python3
"""Generate public/assets/lab/faces/deadeye-face.png — the deadeye's face decal.

Same method and projection as make-butcher-face.py (the deadeye wears the same
face-block head), and a different face again:

  * ONE bare eye: the LEFT socket sunken and bruised round its ember; the
    right is under the kit's optic mask, so the decal gives it only the raw,
    stapled skin round the mask's edge;
  * the MOUTH SEWN SHUT: a closed seam with wire cross-stitches (he does not
    bite, he shoots);
  * gaunt cheek hollows and the purple temple veins (biomech-style.md's
    meander recipe), the hooked nose left to the face block's prims.

MULTIPLY (decal 0): everything is ink with alpha that DARKENS the lit skin;
the lightest marks (staples, teeth) only need to beat their surroundings.
Original art, deterministic (seeded).

Run:  python3 scripts/make-deadeye-face.py
Out:  public/assets/lab/faces/deadeye-face.png  (512x512 RGBA)

LAYOUT (fractions of the sheet, y DOWN): eyes (0.38, 0.40) and (0.62, 0.40),
respirator seat (0.50, 0.53), mouth line y 0.70 — the .blob's sheet block
solves the projection onto the eye embers and the mouth.
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
                   "public", "assets", "lab", "faces", "deadeye-face.png")

EYE_Y = 0.40
EYE_DX = 0.12
MOUTH_Y = 0.70

rng = random.Random(0xDEAD)


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

# --- 1. the left socket: bruised round a deep pit; the right: raw skin and staples round the mask's edge ---
sock, d = layer()
cx, cy = 0.5 + EYE_DX, EYE_Y
d.ellipse([*P(cx - 0.115, cy - 0.080), *P(cx + 0.115, cy + 0.100)], fill=ink((70, 30, 70), 110))
d.ellipse([*P(cx - 0.075, cy - 0.052), *P(cx + 0.075, cy + 0.060)], fill=ink((24, 8, 14), 210))
d.ellipse([*P(cx - 0.040, cy - 0.028), *P(cx + 0.040, cy + 0.032)], fill=ink((6, 2, 2), 248))
d.polygon(ragged(0.36, 0.40, 0.17, 0.16, 0.18, 30), fill=ink((140, 40, 40), 110))   # inflamed under the mask
sock = sock.filter(ImageFilter.GaussianBlur(W * 0.012))
img = Image.alpha_composite(img, sock)

# --- 2. gaunt hollows under the cheekbones ---
hol, d = layer()
for sx in (-1, 1):
    d.ellipse([*P(0.5 + sx * 0.21 - 0.07, 0.55), *P(0.5 + sx * 0.21 + 0.07, 0.70)], fill=ink((40, 20, 26), 90))
hol = hol.filter(ImageFilter.GaussianBlur(W * 0.025))
img = Image.alpha_composite(img, hol)

# --- 3. the mouth sewn shut: a closed seam, wire cross-stitches ---
scar, d = layer()
seam = [(0.36 + 0.28 * k / 16, MOUTH_Y + 0.010 * math.sin(math.pi * k / 16) - 0.004 * (k % 2)) for k in range(17)]
d.line([P(*p) for p in seam], fill=ink((40, 8, 10), 235), width=int(W * 0.010), joint="curve")
for k in range(1, 16, 2):
    x, y = P(*seam[k])
    for s_ in (-1, 1):
        d.line([(x - W * 0.012, y - s_ * W * 0.020), (x + W * 0.012, y + s_ * W * 0.020)], fill=ink((150, 150, 158), 235), width=int(W * 0.004))


def stitched(path, stitches, staple, line=True):
    pts = [P(*p) for p in path]
    if line:
        d.line(pts, fill=ink((50, 12, 12), 220), width=int(W * 0.007), joint="curve")
    for k in range(stitches):
        t = (k + 0.5) / stitches
        f = t * (len(path) - 1)
        i = min(int(f), len(path) - 2)
        u = f - i
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        x, y = ax + (bx - ax) * u, ay + (by - ay) * u
        nx, ny = -(by - ay), (bx - ax)
        nl = math.hypot(nx, ny) or 1
        nx, ny = nx / nl * W * 0.020, ny / nl * W * 0.020
        col = (160, 160, 165) if staple else (20, 8, 8)
        d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink(col, 235), width=int(W * (0.006 if staple else 0.004)))


# staples round the mask's lower edge on the right cheek
stitched([(0.14, 0.50), (0.26, 0.57), (0.40, 0.58), (0.47, 0.52)], 6, True, line=False)
img = Image.alpha_composite(img, scar)

# --- 5. purple varicose veins on the temples and forehead: slow sine meanders
# (biomech-style.md's recipe: long wavelength, small swing, a knot now and then,
# one branch), drawn as a dark rim with a lighter core so they read raised ---
vein, d = layer()


def meander(x0: float, y0: float, ang: float, length: float, amp: float, width: float, branch: bool) -> None:
    pts = []; ph = rng.uniform(0, 6.28); a = ang
    n = int(length / 0.008)
    for k in range(n + 1):
        s = k * 0.008
        ph += rng.uniform(0.22, 0.36); a += rng.uniform(-0.05, 0.05)
        cx = x0 + math.cos(a) * s - math.sin(a) * amp * math.sin(ph)
        cy = y0 + math.sin(a) * s + math.cos(a) * amp * math.sin(ph)
        pts.append((cx, cy))
    for k in range(len(pts) - 1):
        t = k / max(1, len(pts) - 2)
        wv = width * (0.55 + 0.45 * math.sin(math.pi * t))
        d.line([P(*pts[k]), P(*pts[k + 1])], fill=ink((60, 20, 70), 200), width=max(1, int(W * wv)))
        if k % 6 == 3:
            r = W * wv * 0.9
            x, y = P(*pts[k])
            d.ellipse([x - r, y - r, x + r, y + r], fill=ink((55, 18, 64), 210))
    for k in range(len(pts) - 1):
        t = k / max(1, len(pts) - 2)
        wv = width * 0.35 * (0.55 + 0.45 * math.sin(math.pi * t))
        d.line([P(*pts[k]), P(*pts[k + 1])], fill=ink((120, 70, 130), 120), width=max(1, int(W * wv)))
    if branch:
        k = len(pts) // 2
        meander(pts[k][0], pts[k][1], ang + rng.choice((-1, 1)) * math.radians(rng.uniform(30, 55)), length * 0.5, amp * 0.7, width * 0.65, False)


meander(0.83, 0.44, math.radians(-115), 0.26, 0.010, 0.010, True)                             # the bare temple, up to the crown
meander(0.58, 0.30, math.radians(-75), 0.14, 0.008, 0.008, True)                               # forehead, left of the mask
vein = vein.filter(ImageFilter.GaussianBlur(W * 0.0012))
img = Image.alpha_composite(img, vein)

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
