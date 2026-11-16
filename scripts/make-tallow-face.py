#!/usr/bin/env python3
"""Generate public/assets/lab/faces/tallow-face.png — the tallow's mouth decal.

Adapted from make-ogre-face.py (read its header for the bargain): the tallow's facial STRUCTURE is prims in
tallow.blob (swollen cranium, brow shelf, glowing slit eyes, bulbous nose, thick wet lips) and this decal carries only
the MOUTH. Original art, drawn in PIL.

WHAT IT DRAWS: a wide, drooping, slack grimace (owner, 2026-11-14: "evil and ugly"): a dark wet cavity with a raw red
gum line, thick liver lips, and a ragged row of uneven brown-yellow teeth, several missing, some broken, and a shorter
lower row. No tusk gaps (the tallow has no tusk prims). Everything else alpha 0 (a MULTIPLY decal, decal 0).

Run:  python3 scripts/make-tallow-face.py
Out:  public/assets/lab/faces/tallow-face.png  (512x512 RGBA)
"""
from __future__ import annotations

import math
import os
import random
import sys

from PIL import Image, ImageDraw

SIZE = 512
SS = 4  # supersample: draw at 2048, LANCZOS down, for a soft alpha ramp

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "lab", "faces", "tallow-face.png",
)

# Geometry in FRACTIONS of the sheet. At projScale 0.30 one sheet unit spans
# 1/0.30 of the cranium's semi-axis, so HALF_W 0.19 is a mouth ~0.070 m either
# side of centre — the jaw prim's front is ~0.13 m wide at that height, so the
# corners stop just inside the cheeks.
HALF_W = 0.19
OPEN_H = 0.075       # cavity height at the centre
CORNER_DROP = 0.060  # corners sag below the centre line: the grimace
LIP_W = 0.020
# Where the tusks break through, as t along the mouth (-1..1). The tusk prims
# sit at x = +-0.042 m on a 0.070 m half-mouth -> t = +-0.60.
TUSK_T = 0.60
TUSK_GAP = 0.0

CAVITY = (26, 6, 6, 255)
GUM = (96, 26, 24, 255)
LIP = (92, 40, 36, 255)
LIP_SHADOW = (58, 22, 20, 200)
# Yellowed, not white: the sheet multiplies the skin, and a near-white texel
# brushes the glow cut (gated off in the .blob regardless).
TOOTH = (176, 150, 96, 255)
TOOTH_DARK = (120, 96, 58, 255)


def edge(cx, cy, half_w, open_h, drop, upper, t):
    half_open = 0.5 * open_h * (1.0 - 0.92 * t * t)
    y = cy - half_open if upper else cy + half_open
    # A snarl: the upper lip lifts a little either side of centre (where the
    # upper canines would be), which reads as a sneer rather than a slot.
    if upper:
        y -= 0.18 * open_h * math.exp(-((abs(t) - 0.35) / 0.18) ** 2)
    return cx + t * half_w, y + drop * t * t


def polyline(cx, cy, half_w, open_h, drop, upper, n=64):
    return [edge(cx, cy, half_w, open_h, drop, upper, -1 + 2 * i / n) for i in range(n + 1)]


def main() -> int:
    rng = random.Random(23)
    w = SIZE * SS
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = w * 0.5, w * 0.5
    half_w, open_h, drop, lip_w = w * HALF_W, w * OPEN_H, w * CORNER_DROP, w * LIP_W

    upper = polyline(cx, cy, half_w, open_h, drop, True)
    lower = polyline(cx, cy, half_w, open_h, drop, False)

    # 1. LIPS — shadow stroke, then the lip band.
    for pts, colour, width in (
        (upper, LIP_SHADOW, lip_w * 2.8), (lower, LIP_SHADOW, lip_w * 3.0),
        (upper, LIP, lip_w * 1.5), (lower, LIP, lip_w * 1.9),
    ):
        # Stamped discs, not d.line: PIL's wide polylines leave notches at
        # every segment join, which read as stitch marks on the lip.
        dense = [(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * j / 6,
                  pts[k][1] + (pts[k + 1][1] - pts[k][1]) * j / 6)
                 for k in range(len(pts) - 1) for j in range(6)]
        rad = width * 0.5
        for x, y in dense:
            d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=colour)

    # 2. CAVITY.
    d.polygon(upper + list(reversed(lower)), fill=CAVITY)

    # 2b. GUM — a raw band just inside the upper edge, so the teeth hang from meat, not from the lip.
    gum = [(x, y + open_h * 0.10) for x, y in upper]
    rad = lip_w * 0.7
    for k in range(len(gum) - 1):
        for j in range(6):
            x = gum[k][0] + (gum[k + 1][0] - gum[k][0]) * j / 6
            y = gum[k][1] + (gum[k + 1][1] - gum[k][1]) * j / 6
            d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=GUM)

    def in_tusk_gap(t):
        return abs(abs(t) - TUSK_T) < TUSK_GAP

    # 3. UPPER TEETH — uneven pointed fangs hanging from the upper edge.
    n = 9
    for i in range(n):
        t0 = -0.85 + 1.70 * i / n
        t1 = -0.85 + 1.70 * (i + 1) / n
        tm = 0.5 * (t0 + t1)
        if in_tusk_gap(tm) or rng.random() < 0.22:  # missing teeth
            continue
        xa, ya = edge(cx, cy, half_w, open_h, drop, True, t0)
        xb, yb = edge(cx, cy, half_w, open_h, drop, True, t1)
        length = open_h * rng.uniform(0.25, 0.70) * (1.0 - 0.35 * abs(tm))  # some broken short
        tipx = 0.5 * (xa + xb) + rng.uniform(-0.2, 0.2) * (xb - xa)
        tipy = 0.5 * (ya + yb) + length
        inset = lip_w * 0.25
        d.polygon([(xa + inset, ya - lip_w * 0.2), (xb - inset, yb - lip_w * 0.2), (tipx, tipy)],
                  fill=TOOTH if rng.random() > 0.3 else TOOTH_DARK)

    # 4. LOWER TEETH — shorter stubs rising from the lower edge, fewer of them.
    n = 7
    for i in range(n):
        t0 = -0.70 + 1.40 * i / n
        t1 = -0.70 + 1.40 * (i + 1) / n
        tm = 0.5 * (t0 + t1)
        if in_tusk_gap(tm) or rng.random() < 0.2:
            continue
        xa, ya = edge(cx, cy, half_w, open_h, drop, False, t0)
        xb, yb = edge(cx, cy, half_w, open_h, drop, False, t1)
        length = open_h * rng.uniform(0.25, 0.45)
        inset = lip_w * 0.35
        d.polygon([(xa + inset, ya + lip_w * 0.2), (xb - inset, yb + lip_w * 0.2),
                   (xb - inset * 1.6, yb - length), (xa + inset * 1.6, ya - length)],
                  fill=TOOTH_DARK)

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT)

    px = out.load()
    lit, acc = 0, [0.0, 0.0, 0.0]
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px[x, y]
            if a > 8:
                lit += 1
                acc[0] += r; acc[1] += g; acc[2] += b
    mean = [c / lit / 255.0 for c in acc] if lit else [0.0] * 3
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    print(f"opaque texels: {lit}/{SIZE * SIZE} = {100.0 * lit / (SIZE * SIZE):.2f}%")
    print(f"mean of opaque texels: {mean[0]:.4f} {mean[1]:.4f} {mean[2]:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
