#!/usr/bin/env python3
"""Generate public/assets/lab/faces/cyberdemon-face.png — the character's mouth decal.

WHY A GENERATOR, AND WHY IT IS COMMITTED
----------------------------------------
There is no reference mesh for cyberdemon, so `npm run blob:face-bake` cannot
run: the bake renders a mesh's own face, and there is no mesh. The gargoyle is
the precedent for a mesh-less face — all facial structure is PRIMS, and the
decal carries the MOUTH and nothing else (face.ts's header records four failed
rebuilds behind "geometric eye sockets never read as a face"; three dispatches
of fully painted faces read as a visor band or a zombie).

gargoyle-face.png has no generator: it cannot be regenerated or retuned without
redrawing it by hand, which is exactly the trap this script exists to avoid.
The art here is ORIGINAL — drawn from scratch in PIL below, no download, no
copy of any existing face PNG.

WHAT IT DRAWS
-------------
A wide, grim, slightly frowning mouth: dark cavity, dark dried-red lips, one
row of blunt teeth under the upper lip. Everything else is alpha 0, because a
MULTIPLY decal (decal 0) darkens whatever it covers — any stray opaque texel
would smear a grey patch across the face. The sheet is 512x512; only ~3% of
texels are above alpha 0.

Run:  python3 scripts/make-cyberdemon-face.py
Out:  public/assets/lab/faces/cyberdemon-face.png  (512x512 RGBA, ~3-4 KB)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

SIZE = 512          # final sheet size; every bake/face texture in this project is 512
SS = 4              # supersample factor: draw at 2048, LANCZOS down. Gives the
                    # soft alpha ramp the shader's decal blend wants; a 1x
                    # draw gives hard aliased lips that read as a printed band.

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "lab", "faces", "cyberdemon-face.png",
)

# Mouth geometry, in FRACTIONS of the sheet, so the drawing survives a size
# change. The mouth is 0.30 of the sheet wide and sits on the vertical centre
# (the .blob's projCentreY solves the world height; the drawing is centred so
# that solve stays one line).
HALF_W = 0.150      # half-width  -> mouth spans uv.x 0.35..0.65
OPEN_H = 0.042      # cavity height at the centre; pinches to ~0 at the corners
CORNER_DROP = 0.030 # corners drop this far below the centre line -> the frown
LIP_W = 0.016       # lip band thickness
TOOTH_H = 0.016     # tooth depth hanging from the upper lip

# Colours. Deliberately NOT pure black or pure white: the sheet MULTIPLIES the
# body's albedo, so the teeth cannot be brighter than the skin they cover —
# they only have to be brighter than the cavity around them. A pure-white tooth
# also clears the sheet's own glow cut, which is the all-white-sheet-glows-red
# trap the gargoyle paid for (this character additionally gates glow off hard
# with eyeGlowCut 0.99 / eyeGlowAmp 0 in the .blob).
CAVITY = (16, 8, 10, 255)
LIP = (96, 26, 28, 255)
LIP_SHADOW = (54, 14, 16, 210)
TOOTH = (214, 205, 190, 255)


def edge_points(cx: float, cy: float, half_w: float, open_h: float,
                drop: float, upper: bool) -> list[tuple[float, float]]:
    """One lip edge as a polyline, t from -1 (left corner) to +1 (right corner).

    The opening closes at the corners (`1 - 0.96 t^2`) and the whole line bows
    DOWN toward them (`drop * t^2`) — a frown, which is the read this character
    needs and the one thing a flat line cannot give.
    """
    pts = []
    n = 48
    for i in range(n + 1):
        t = -1.0 + 2.0 * i / n
        x = cx + t * half_w
        half_open = 0.5 * open_h * (1.0 - 0.96 * t * t)
        y = cy - half_open if upper else cy + half_open
        y += drop * t * t
        pts.append((x, y))
    return pts


def main() -> int:
    w = SIZE * SS
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx, cy = w * 0.5, w * 0.5
    half_w = w * HALF_W
    open_h = w * OPEN_H
    drop = w * CORNER_DROP
    lip_w = w * LIP_W

    upper = edge_points(cx, cy, half_w, open_h, drop, upper=True)
    lower = edge_points(cx, cy, half_w, open_h, drop, upper=False)

    # 1. LIPS — a thick band along both edges, drawn first so the cavity sits
    #    inside it. The shadow pass is a wider, darker stroke underneath.
    for pts, colour, width in (
        (upper, LIP_SHADOW, lip_w * 2.6),
        (lower, LIP_SHADOW, lip_w * 2.6),
        (upper, LIP, lip_w * 1.5),
        (lower, LIP, lip_w * 1.5),
    ):
        d.line(pts, fill=colour, width=int(width), joint="curve")

    # 2. CAVITY — the dark opening, between the two edges.
    d.polygon(upper + list(reversed(lower)), fill=CAVITY)

    # 3. TEETH — a row of blunt blocks hanging from the upper edge. Five, spread
    #    across the middle 70% of the mouth so the corners stay dark.
    n_teeth = 5
    for i in range(n_teeth):
        t0 = -0.70 + 1.40 * i / n_teeth
        t1 = -0.70 + 1.40 * (i + 1) / n_teeth
        tm = 0.5 * (t0 + t1)
        # Sample the upper edge at the tooth's own t.
        half_open = 0.5 * open_h * (1.0 - 0.96 * tm * tm)
        y_top = cy - half_open + drop * tm * tm
        x0 = cx + t0 * half_w + lip_w * 0.30
        x1 = cx + t1 * half_w - lip_w * 0.30
        y_bot = y_top + w * TOOTH_H * (1.0 - 0.35 * abs(tm))
        d.rectangle([x0, y_top, x1, y_bot], fill=TOOTH)

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT)

    # Report the two numbers the .blob/registry care about: how much of the
    # sheet is actually opaque (a MULTIPLY decal must stay sparse), and the
    # measured mean of the opaque texels (the shader divides by it).
    px = out.load()
    lit = 0
    acc = [0.0, 0.0, 0.0]
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px[x, y]
            if a > 8:
                lit += 1
                acc[0] += r
                acc[1] += g
                acc[2] += b
    total = SIZE * SIZE
    mean = [c / lit / 255.0 for c in acc] if lit else [0.0, 0.0, 0.0]
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    print(f"opaque texels: {lit}/{total} = {100.0 * lit / total:.2f}%")
    print(f"mean of opaque texels: {mean[0]:.4f} {mean[1]:.4f} {mean[2]:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
