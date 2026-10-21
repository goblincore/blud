#!/usr/bin/env python3
"""Generate public/assets/lab/faces/twinhead-face.png — the human twin's face decal.

WHY A GENERATOR: the twinhead has no reference mesh (authored from the brief),
so blob:face-bake cannot run, and prim-only faces read as cartoon apes (owner,
first look: "a lil too goofy"; face.ts records the older failures). The decal
carries the DETAIL the prims cannot: hollow sockets, a skull-like nasal
cavity, a lipless stitched mouth, surgical scars and staples, and a field of
pitting. The prims carry the mass (brow ledge, cheekbones, jaw, ears).

ONE HEAD ONLY, by design: the shader projects the sheet round the head
cluster's fattest prim, which twinhead.blob makes the HUMAN twin's face prim.
The machine twin's face is metal (optic, grille, plate) and needs none.

MULTIPLY (decal 0): opaque texels DARKEN the body's lit albedo, alpha 0 leaves
it. So everything is drawn as dark ink with alpha, never as light paint; the
lightest marks (teeth, staples) only need to be lighter than what surrounds
them. Original art, drawn from scratch below; deterministic (seeded).

Run:  python3 scripts/make-twinhead-face.py
Out:  public/assets/lab/faces/twinhead-face.png  (512x512 RGBA)

LAYOUT (fractions of the sheet, y DOWN as drawn; the .blob's sheet block
solves the projection onto two features):
  eyes   centres (0.38, 0.40) and (0.62, 0.40)
  mouth  centre line y 0.70
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
                   "public", "assets", "lab", "faces", "twinhead-face.png")

EYE_Y = 0.40
EYE_DX = 0.12
MOUTH_Y = 0.70

rng = random.Random(0x7717)


def P(x: float, y: float) -> tuple[float, float]:
    return (x * W, y * W)


def ink(rgb: tuple[int, int, int], a: int) -> tuple[int, int, int, int]:
    return (*rgb, a)


img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# --- 1. sockets: a soft dark bowl, a darker pit, a hard rim shadow on top ---
sock = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(sock)
for sx in (-1, 1):
    cx, cy = 0.5 + sx * EYE_DX, EYE_Y
    d.ellipse([*P(cx - 0.105, cy - 0.075), *P(cx + 0.105, cy + 0.085)], fill=ink((40, 18, 16), 120))
    d.ellipse([*P(cx - 0.070, cy - 0.050), *P(cx + 0.070, cy + 0.055)], fill=ink((22, 8, 8), 205))
    d.ellipse([*P(cx - 0.038, cy - 0.028), *P(cx + 0.038, cy + 0.030)], fill=ink((6, 2, 2), 245))
sock = sock.filter(ImageFilter.GaussianBlur(W * 0.012))
img = Image.alpha_composite(img, sock)

# --- 2. nasal wound: the .blob carves a real hole here and pushes unpainted
# swellings up round it; the decal gives them their colour — a raw red rim
# (multiplied into the skin it reads as inflamed meat), a darker clotted
# ring, and a ragged blot of dried blood running down toward the mouth ---
nose = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(nose)


def ragged(cx: float, cy: float, rx: float, ry: float, jitter: float, n: int = 26) -> list[tuple[float, float]]:
    return [P(cx + rx * math.cos(2 * math.pi * k / n) * rng.uniform(1 - jitter, 1 + jitter),
              cy + ry * math.sin(2 * math.pi * k / n) * rng.uniform(1 - jitter, 1 + jitter)) for k in range(n)]


# NOT a clean disc: a clean saturated circle read as a clown nose. A ragged,
# dark, uneven stain: inflamed skin fading out, a torn raw rim, clotted
# blood, and a run of it down toward the mouth.
d.polygon(ragged(0.50, 0.53, 0.13, 0.12, 0.30), fill=ink((150, 80, 70), 70))     # inflamed skin
d.polygon(ragged(0.50, 0.53, 0.085, 0.085, 0.35), fill=ink((120, 30, 30), 150))  # raw rim, torn
for _ in range(7):                                                               # wet raw flecks
    cx, cy = 0.5 + rng.uniform(-0.07, 0.07), 0.53 + rng.uniform(-0.07, 0.07)
    d.polygon(ragged(cx, cy, 0.018, 0.014, 0.4, 9), fill=ink((170, 45, 45), 140))
d.polygon(ragged(0.50, 0.535, 0.045, 0.05, 0.3), fill=ink((60, 8, 10), 235))    # clot
d.polygon([P(0.49, 0.58), P(0.515, 0.58), P(0.507, 0.66), P(0.497, 0.65)], fill=ink((80, 12, 12), 170))  # drip
nose = nose.filter(ImageFilter.GaussianBlur(W * 0.005))
img = Image.alpha_composite(img, nose)

# --- 3. mouth: lipless gash, gums, teeth, and stitches pulling it shut at
# the corners ---
mouth = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(mouth)
L, R = 0.33, 0.67


def lip(t: float, up: bool) -> tuple[float, float]:
    x = L + (R - L) * t
    open_h = 0.030 * math.sin(math.pi * t) ** 0.7
    sag = 0.018 * (2 * t - 1) ** 2   # corners pull DOWN: a grimace
    return P(x, MOUTH_Y + sag + (-open_h if up else open_h))


N = 40
top = [lip(i / N, True) for i in range(N + 1)]
bot = [lip(i / N, False) for i in range(N + 1)]
d.polygon(top + bot[::-1], fill=ink((60, 14, 14), 230))          # gums
inner = [lip(i / N, True) for i in range(4, N - 3)]
inner = [(x, y + W * 0.010) for x, y in inner]
inner_b = [(x, y - W * 0.010) for x, y in [lip(i / N, False) for i in range(4, N - 3)]]
d.polygon(inner + inner_b[::-1], fill=ink((8, 2, 2), 250))       # cavity
# teeth: long, uneven, upper and lower, lighter than the cavity
for row, up in ((0, True), (1, False)):
    for i in range(11):
        t = 0.12 + i * 0.076 + rng.uniform(-0.01, 0.01)
        x0, y0 = lip(t, up)
        h = W * rng.uniform(0.020, 0.030) * (1 if up else -1)
        w = W * rng.uniform(0.010, 0.014)
        shade = rng.randint(150, 190)
        d.polygon([(x0 - w / 2, y0), (x0 + w / 2, y0), (x0 + w * 0.2, y0 + h), (x0 - w * 0.25, y0 + h * 0.92)],
                  fill=ink((shade, shade - 12, shade - 40), 235))
mouth = mouth.filter(ImageFilter.GaussianBlur(W * 0.0015))
img = Image.alpha_composite(img, mouth)

# --- 4. scars, stitches and staples ---
scar = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(scar)


def stitched(path: list[tuple[float, float]], stitches: int, staple: bool) -> None:
    pts = [P(*p) for p in path]
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
            d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink((150, 150, 155), 235), width=int(W * 0.006))
        else:
            d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink((20, 8, 8), 230), width=int(W * 0.004))


# across the forehead and down past the left socket (the conversion's cut)
stitched([(0.20, 0.20), (0.36, 0.17), (0.52, 0.21), (0.66, 0.19), (0.80, 0.24)], 9, True)
# down the right cheek from socket to jaw
stitched([(0.70, 0.47), (0.73, 0.57), (0.71, 0.66), (0.74, 0.78)], 5, False)
# the mouth's corners sewn shut
stitched([(0.29, 0.71), (0.35, 0.715)], 2, False)
stitched([(0.65, 0.715), (0.71, 0.71)], 2, False)
img = Image.alpha_composite(img, scar)

# --- 5. wrinkles: brow furrows and crow's feet, thin and dark ---
wr = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(wr)
for k in range(4):
    y = 0.27 + k * 0.022
    d.arc([*P(0.36, y), *P(0.64, y + 0.06)], 200, 340, fill=ink((30, 10, 10), 120), width=int(W * 0.003))
for sx in (-1, 1):
    cx = 0.5 + sx * (EYE_DX + 0.10)
    for k in range(3):
        a = math.radians(-25 + k * 25)
        d.line([P(cx, EYE_Y + 0.01), P(cx + sx * 0.06 * math.cos(a), EYE_Y + 0.01 + 0.06 * math.sin(a))],
               fill=ink((30, 10, 10), 110), width=int(W * 0.003))
wr = wr.filter(ImageFilter.GaussianBlur(W * 0.001))
img = Image.alpha_composite(img, wr)

# --- 6. pitting: the point noise. Many small dark pocks, denser toward the
# cheeks and jaw, inside a face oval that fades at its edge ---
pit = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(pit)
for _ in range(650):
    x, y = rng.uniform(0.12, 0.88), rng.uniform(0.10, 0.92)
    e = ((x - 0.5) / 0.40) ** 2 + ((y - 0.52) / 0.44) ** 2
    if e > 1:
        continue
    r = W * rng.choice((0.002, 0.002, 0.003, 0.003, 0.004, 0.006))
    a = int(rng.uniform(50, 150) * (1 - e ** 3))
    d.ellipse([x * W - r, y * W - r, x * W + r, y * W + r], fill=ink((25, 8, 6), a))
img = Image.alpha_composite(img, pit)

# a faint overall grime inside the oval, so the face is a shade darker and
# dirtier than the scalp it sits in (alpha stays low: it MULTIPLIES)
grime = Image.new("L", (W, W), 0)
gd = ImageDraw.Draw(grime)
gd.ellipse([*P(0.14, 0.12), *P(0.86, 0.92)], fill=46)
grime = grime.filter(ImageFilter.GaussianBlur(W * 0.05))
base = Image.new("RGBA", (W, W), (70, 40, 34, 0))
base.putalpha(grime)
img = Image.alpha_composite(base, img)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save(OUT, optimize=True)
op = sum(1 for p in img.get_flattened_data() if p[3] > 0)
print(f"wrote {OUT}: {SIZE}x{SIZE}, {op / SIZE / SIZE:.1%} texels above alpha 0")
