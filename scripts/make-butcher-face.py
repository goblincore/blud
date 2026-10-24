#!/usr/bin/env python3
"""Generate public/assets/lab/faces/butcher-face.png — the butcher's face decal.

Same method as make-twinhead-face.py (no reference mesh, so blob:face-bake
cannot run; a generated MULTIPLY decal carries the detail the prims cannot),
and a deliberately different face so the variant does not read as the base
zombie wearing a mask:

  * the NOSE IS GONE: the kit's respirator cone is bolted over the nasal
    cavity, so the decal paints the raw, weeping ring round its seat and the
    two bolt holes on the cheekbones the cone's struts go into;
  * a GLASGOW SMILE: the mouth's corners are slit up toward the ears and
    stapled half shut, so the grin reads from a distance;
  * PURPLE VARICOSE VEINS on the temples and forehead (the owner's reference
    figure: tan skin, purple veins), drawn as slow sine meanders per the vein
    recipe in biomech-style.md, never alternating zigzags;
  * a stapled skull-cap cut across the crown (the conversion's surgery), and
    bruised, sunken sockets.

MULTIPLY (decal 0): everything is ink with alpha that DARKENS the lit skin;
the lightest marks (staples, teeth) only need to beat their surroundings.
Original art, deterministic (seeded).

Run:  python3 scripts/make-butcher-face.py
Out:  public/assets/lab/faces/butcher-face.png  (512x512 RGBA)

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
                   "public", "assets", "lab", "faces", "butcher-face.png")

EYE_Y = 0.40
EYE_DX = 0.12
MOUTH_Y = 0.70

rng = random.Random(0xB07C)


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

# --- 1. sockets: bruised purple rings round deep pits ---
sock, d = layer()
for sx in (-1, 1):
    cx, cy = 0.5 + sx * EYE_DX, EYE_Y
    d.ellipse([*P(cx - 0.115, cy - 0.080), *P(cx + 0.115, cy + 0.100)], fill=ink((70, 30, 70), 110))   # bruise
    d.ellipse([*P(cx - 0.075, cy - 0.052), *P(cx + 0.075, cy + 0.060)], fill=ink((24, 8, 14), 210))
    d.ellipse([*P(cx - 0.040, cy - 0.028), *P(cx + 0.040, cy + 0.032)], fill=ink((6, 2, 2), 248))
sock = sock.filter(ImageFilter.GaussianBlur(W * 0.013))
img = Image.alpha_composite(img, sock)

# --- 2. the respirator's seat: weeping raw skin round where the cone goes in,
# and the two bolt holes on the cheekbones (struts land at x -+0.042) ---
seat, d = layer()
d.polygon(ragged(0.50, 0.535, 0.120, 0.095, 0.25), fill=ink((150, 70, 60), 80))   # inflamed
d.polygon(ragged(0.50, 0.535, 0.080, 0.065, 0.30), fill=ink((120, 26, 26), 165))  # raw ring
d.ellipse([*P(0.455, 0.500), *P(0.545, 0.570)], fill=ink((30, 6, 6), 240))       # the cavity under the cone
for sx in (-1, 1):
    bx = 0.5 + sx * 0.20
    d.polygon(ragged(bx, 0.47, 0.035, 0.030, 0.3, 14), fill=ink((130, 40, 36), 150))
    d.ellipse([*P(bx - 0.014, 0.457), *P(bx + 0.014, 0.483)], fill=ink((20, 6, 6), 240))
for _ in range(3):                                                               # weeping runs
    x = 0.47 + rng.uniform(0, 0.06)
    d.line([P(x, 0.57), P(x + rng.uniform(-0.01, 0.01), 0.57 + rng.uniform(0.05, 0.09))],
           fill=ink((90, 18, 16), 150), width=int(W * 0.006))
seat = seat.filter(ImageFilter.GaussianBlur(W * 0.005))
img = Image.alpha_composite(img, seat)

# --- 3. the mouth: a gash whose corners are SLIT up the cheeks (the Glasgow
# smile), gums and teeth in the middle, the slits stapled half shut ---
mouth, d = layer()
L, R = 0.36, 0.64


def lip(t: float, up: bool) -> tuple[float, float]:
    x = L + (R - L) * t
    open_h = 0.028 * math.sin(math.pi * t) ** 0.7
    return P(x, MOUTH_Y + (-open_h if up else open_h))


N = 40
top = [lip(i / N, True) for i in range(N + 1)]
bot = [lip(i / N, False) for i in range(N + 1)]
d.polygon(top + bot[::-1], fill=ink((60, 14, 14), 232))
inner = [(x, y + W * 0.009) for x, y in [lip(i / N, True) for i in range(4, N - 3)]]
inner_b = [(x, y - W * 0.009) for x, y in [lip(i / N, False) for i in range(4, N - 3)]]
d.polygon(inner + inner_b[::-1], fill=ink((8, 2, 2), 250))
for up in (True, False):
    for i in range(9):
        t = 0.12 + i * 0.095 + rng.uniform(-0.01, 0.01)
        x0, y0 = lip(t, up)
        h = W * rng.uniform(0.018, 0.028) * (1 if up else -1)
        w = W * rng.uniform(0.010, 0.014)
        s = rng.randint(140, 180)
        d.polygon([(x0 - w / 2, y0), (x0 + w / 2, y0), (x0 + w * 0.2, y0 + h), (x0 - w * 0.25, y0 + h * 0.92)],
                  fill=ink((s, s - 14, s - 46), 235))
smile = {}
for sx in (-1, 1):                                                               # the slits, curving up to the ears
    path = [(0.5 + sx * (0.14 + 0.10 * u ** 0.9), MOUTH_Y - 0.13 * u ** 1.4) for u in [k / 12 for k in range(13)]]
    smile[sx] = path
    d.line([P(*p) for p in path], fill=ink((70, 12, 12), 230), width=int(W * 0.011), joint="curve")
    d.line([P(*p) for p in path], fill=ink((15, 3, 3), 240), width=int(W * 0.004), joint="curve")
mouth = mouth.filter(ImageFilter.GaussianBlur(W * 0.0015))
img = Image.alpha_composite(img, mouth)

# --- 4. staples and stitches ---
scar, d = layer()


def stitched(path: list[tuple[float, float]], stitches: int, staple: bool, line: bool = True) -> None:
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
        if staple:
            d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink((160, 160, 165), 240), width=int(W * 0.006))
        else:
            d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink((20, 8, 8), 230), width=int(W * 0.004))


for sx in (-1, 1):
    stitched(smile[sx][2:], 4, True, line=False)
# the skull-cap cut across the crown, stapled
stitched([(0.14, 0.17), (0.30, 0.12), (0.50, 0.10), (0.70, 0.12), (0.86, 0.17)], 11, True)
# an old stitched scar down the left cheek
stitched([(0.27, 0.46), (0.25, 0.56), (0.27, 0.64)], 4, False)
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


for sx in (-1, 1):
    meander(0.5 + sx * 0.33, 0.44, math.radians(-90 - sx * 25), 0.26, 0.010, 0.010, True)     # temple, up to the crown
meander(0.44, 0.33, math.radians(-75), 0.16, 0.008, 0.008, True)                               # forehead
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
