#!/usr/bin/env python3
"""Generate public/assets/lab/faces/chair-face.png: the face decal of the man fused into the chair.

WHY A GENERATOR: the chair has no reference mesh (authored from the brief), so blob:face-bake cannot run, and
the generated zombie sheet made him read as a stock zombie (owner, first look: wants "a new face map ... some
kind of pointy nose and ear shape"). The PRIMS carry the mass: the long hooked nose, the pointed ears, the brow
ledge, the cheekbones, the pointed chin (chair.blob). This decal carries what prims cannot: sunken sockets round
the ember eyes, the hollows under the cheekbones, a slack thin-lipped mouth with bad teeth, the blood running
down from under the crown, stitched scars where the crown's bolts go into his temples, and pitting.

MULTIPLY (decal 0, blendLuma 0): opaque texels DARKEN or TINT the body's lit albedo, alpha 0 leaves it. So it is
drawn as dark ink and red stain, never as light paint. Original art, drawn from scratch; deterministic (seeded).
Built on scripts/make-twinhead-face.py's recipe.

Run:  python3 scripts/make-chair-face.py
Out:  public/assets/lab/faces/chair-face.png  (512x512 RGBA)

LAYOUT (fractions of the sheet, y DOWN as drawn; chair.blob's sheet block projects it round the face prim):
  eyes   centres (0.38, 0.40) and (0.62, 0.40)
  mouth  centre line y 0.72
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
                   "public", "assets", "lab", "faces", "chair-face.png")

EYE_Y = 0.40
EYE_DX = 0.12
MOUTH_Y = 0.72

rng = random.Random(0xC4A1)


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

# --- 1. sockets: deep, bruised, a little uneven; the ember eye prims sit at the bottom ---
sock, d = layer()
for sx in (-1, 1):
    cx, cy = 0.5 + sx * EYE_DX, EYE_Y
    d.ellipse([*P(cx - 0.115, cy - 0.080), *P(cx + 0.110, cy + 0.100)], fill=ink((70, 25, 35), 110))   # bruise
    d.ellipse([*P(cx - 0.075, cy - 0.050), *P(cx + 0.075, cy + 0.060)], fill=ink((28, 8, 10), 210))
    d.ellipse([*P(cx - 0.040, cy - 0.028), *P(cx + 0.040, cy + 0.032)], fill=ink((6, 2, 2), 245))
sock = sock.filter(ImageFilter.GaussianBlur(W * 0.013))
img = Image.alpha_composite(img, sock)

# --- 2. gaunt hollows under the cheekbones, and the shadow down each side of the long nose ---
hol, d = layer()
for sx in (-1, 1):
    d.polygon([P(0.5 + sx * 0.10, 0.52), P(0.5 + sx * 0.25, 0.50), P(0.5 + sx * 0.23, 0.66), P(0.5 + sx * 0.12, 0.64)],
              fill=ink((45, 18, 18), 120))
    d.line([P(0.5 + sx * 0.035, 0.42), P(0.5 + sx * 0.05, 0.60)], fill=ink((35, 12, 12), 110), width=int(W * 0.02))
hol = hol.filter(ImageFilter.GaussianBlur(W * 0.025))
img = Image.alpha_composite(img, hol)

# --- 3. the mouth: slack, thin-lipped, a little open, bad teeth; raw red at the lips' wet line ---
mouth, d = layer()
L, R = 0.36, 0.64


def lip(t: float, up: bool) -> tuple[float, float]:
    x = L + (R - L) * t
    open_h = 0.022 * math.sin(math.pi * t) ** 0.8
    sag = 0.020 * (2 * t - 1) ** 2            # the corners drag down
    return P(x, MOUTH_Y + sag + (-open_h if up else open_h * 1.4))


N = 40
top = [lip(i / N, True) for i in range(N + 1)]
bot = [lip(i / N, False) for i in range(N + 1)]
d.polygon([(x, y - W * 0.012) for x, y in top] + [(x, y + W * 0.014) for x, y in bot[::-1]], fill=ink((130, 40, 40), 150))  # raw lips
d.polygon(top + bot[::-1], fill=ink((40, 8, 8), 235))                                                  # the gap
for i in range(9):
    t = 0.16 + i * 0.085 + rng.uniform(-0.012, 0.012)
    if rng.random() < 0.25:
        continue                                                     # missing teeth
    x0, y0 = lip(t, True)
    h = W * rng.uniform(0.012, 0.022)
    w = W * rng.uniform(0.012, 0.016)
    shade = rng.randint(120, 165)
    d.polygon([(x0 - w / 2, y0), (x0 + w / 2, y0), (x0 + w * 0.3, y0 + h), (x0 - w * 0.3, y0 + h * 0.9)],
              fill=ink((shade, shade - 10, shade - 55), 225))         # yellowed
mouth = mouth.filter(ImageFilter.GaussianBlur(W * 0.0015))
img = Image.alpha_composite(img, mouth)

# --- 4. blood from under the crown: runnels down the forehead and one down past an eye ---
blood, d = layer()
for k in range(9):
    x = 0.20 + 0.075 * k + rng.uniform(-0.02, 0.02)
    y0 = 0.05 + rng.uniform(0, 0.03)
    y1 = y0 + rng.uniform(0.06, 0.20) * (1.8 if k in (2, 6) else 1.0)
    pts = []
    for i in range(12):
        u = i / 11
        pts.append(P(x + 0.008 * math.sin(u * 7 + k), y0 + (y1 - y0) * u))
    d.line(pts, fill=ink((110, 10, 12), 200), width=int(W * rng.uniform(0.006, 0.010)), joint="curve")
    d.ellipse([pts[-1][0] - W * 0.007, pts[-1][1] - W * 0.004, pts[-1][0] + W * 0.007, pts[-1][1] + W * 0.012],
              fill=ink((90, 8, 10), 210))                              # a bead at each runnel's end
d.polygon(ragged(0.5, 0.045, 0.30, 0.028, 0.35, 40), fill=ink((100, 14, 16), 120))  # the crown line, raw
blood = blood.filter(ImageFilter.GaussianBlur(W * 0.002))
img = Image.alpha_composite(img, blood)

# --- 5. scars: stitched, at the temples where the crown's bolts go in, and one old cut through the right brow ---
scar, d = layer()


def stitched(path: list[tuple[float, float]], stitches: int) -> None:
    pts = [P(*p) for p in path]
    d.line(pts, fill=ink((90, 20, 22), 220), width=int(W * 0.008), joint="curve")
    for k in range(stitches):
        t = (k + 0.5) / stitches
        f = t * (len(path) - 1)
        i = min(int(f), len(path) - 2)
        u = f - i
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        x, y = ax + (bx - ax) * u, ay + (by - ay) * u
        nx, ny = -(by - ay), (bx - ax)
        nl = math.hypot(nx, ny) or 1
        nx, ny = nx / nl * W * 0.018, ny / nl * W * 0.018
        d.line([(x - nx, y - ny), (x + nx, y + ny)], fill=ink((20, 8, 8), 230), width=int(W * 0.004))


stitched([(0.06, 0.30), (0.10, 0.40), (0.08, 0.52)], 5)
stitched([(0.94, 0.30), (0.90, 0.40), (0.92, 0.52)], 5)
stitched([(0.60, 0.20), (0.64, 0.33), (0.67, 0.50), (0.70, 0.60)], 7)
img = Image.alpha_composite(img, scar)

# --- 6. wrinkles: deep brow furrows, crow's feet, nasolabial folds ---
wr, d = layer()
for k in range(5):
    y = 0.22 + k * 0.022
    d.arc([*P(0.30, y), *P(0.70, y + 0.07)], 200, 340, fill=ink((30, 10, 10), 130), width=int(W * 0.003))
for sx in (-1, 1):
    cx = 0.5 + sx * (EYE_DX + 0.10)
    for k in range(4):
        a = math.radians(-35 + k * 22)
        d.line([P(cx, EYE_Y + 0.01), P(cx + sx * 0.07 * math.cos(a), EYE_Y + 0.01 + 0.07 * math.sin(a))],
               fill=ink((30, 10, 10), 115), width=int(W * 0.003))
    d.line([P(0.5 + sx * 0.07, 0.55), P(0.5 + sx * 0.13, 0.66), P(0.5 + sx * 0.16, 0.78)],
           fill=ink((30, 10, 10), 120), width=int(W * 0.004), joint="curve")      # nasolabial folds
wr = wr.filter(ImageFilter.GaussianBlur(W * 0.001))
img = Image.alpha_composite(img, wr)

# --- 7. pitting and blotches ---
pit, d = layer()
for _ in range(700):
    x, y = rng.uniform(0.10, 0.90), rng.uniform(0.08, 0.94)
    e = ((x - 0.5) / 0.42) ** 2 + ((y - 0.52) / 0.46) ** 2
    if e > 1:
        continue
    r = W * rng.choice((0.002, 0.002, 0.003, 0.003, 0.004, 0.007))
    a = int(rng.uniform(50, 150) * (1 - e ** 3))
    d.ellipse([x * W - r, y * W - r, x * W + r, y * W + r], fill=ink((35, 8, 6), a))
for _ in range(14):
    x, y = rng.uniform(0.2, 0.8), rng.uniform(0.15, 0.85)
    d.polygon(ragged(x, y, rng.uniform(0.02, 0.05), rng.uniform(0.02, 0.04), 0.4, 14), fill=ink((120, 45, 50), 55))
pit = pit.filter(ImageFilter.GaussianBlur(W * 0.0015))
img = Image.alpha_composite(img, pit)

# grime inside the face oval (low alpha: it MULTIPLIES)
grime = Image.new("L", (W, W), 0)
ImageDraw.Draw(grime).ellipse([*P(0.12, 0.10), *P(0.88, 0.94)], fill=50)
grime = grime.filter(ImageFilter.GaussianBlur(W * 0.05))
base = Image.new("RGBA", (W, W), (70, 40, 34, 0))
base.putalpha(grime)
img = Image.alpha_composite(base, img)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save(OUT, optimize=True)
op = sum(1 for p in img.get_flattened_data() if p[3] > 0)
print(f"wrote {OUT}: {SIZE}x{SIZE}, {op / SIZE / SIZE:.1%} texels above alpha 0")
