#!/usr/bin/env python3
"""Generate public/assets/lab/faces/siren-face.png — the siren's painted face.

WHY A GENERATOR
---------------
The siren has no reference mesh (owner, 2026-10-23: "you choose"), so
`npm run blob:face-bake` cannot run. The face's SHAPE is unpainted prims in
siren.blob (a smooth cranium and face mass, eyeballs under the skin, a small
nose, the lips); this sheet is ALL of its colour: the eyes, brows, lashes,
lid shadow, blush and lips. The art is original, drawn below with no
randomness (a rerun is byte-identical).

WHY THE EYES AND LIPS ARE PAINT, NOT PAINTED PRIMS
--------------------------------------------------
A painted prim owns every surface point it is NEAREST to, not just its own
bulge. The first passes had sclera, iris, liner and lip prims (the bride's
road): the sclera's off-white spread over the lids and swallowed the lashes,
and the lips read as a red wax band 1.7 cm tall. Painted here, each feature is
exactly the outline drawn.

HOW IT BLENDS — author MULTIPLIERS, not colours
-----------------------------------------------
Worn at `decal 0` (MULTIPLY) with `blendLuma 0`: linear albedo * (tex.rgb /
mean), mean = average luma of every texel with alpha >= 8. Every colour below
is therefore a MULTIPLIER on her skin (linear 0.82 0.58 0.47), and the texel
written is BASE * multiplier:

* BASE is a dark-ish neutral grey (120), so the mean sits near 0.48 and a
  texel can multiply by up to ~2.1x. That headroom is what makes a WHITE
  sclera possible on peach skin (it needs blue x1.7); at the bride's base of
  206 the ceiling was ~1.25x and the whites came out peach.
* The multiply is on LINEAR albedo, and the frame is lifted to sRGB after, so
  a multiplier of 0.3 only darkens the rendered skin ~0.6x: paint darker than
  you want it to look (the first pass's mid-brown brows rendered brick red).
* The base covers the whole face, so the mean is ~BASE/255 and the base
  itself multiplies by ~1.0.

GEOMETRY — authored in MILLIMETRES on the face, converted to head space
------------------------------------------------------------------------
The shader projects uv = hs * PROJ_SCALE + PROJ_CENTRE, where hs is the
surface point relative to the FATTEST head prim (the cranium: centre y 1.7223,
semi-axes 0.07097 x 0.09118 x 0.09024; the bride's skull, which siren.blob
keeps), divided by its semi-axes. hs x and y units differ (71 vs 91 mm), so
a circle drawn in hs would land 1.28x tall on the face: everything here is
placed in mm (mm()) and converted, so an iris is round.

  eye          x 11..43 mm, centre line rel -31 mm, 20 mm tall (anime: big, low)
  iris         centre x +-26.5 mm, rel -29.5 mm, a 17 x 22 mm oval
  brows        rel +1..+6 mm, x 11..47 mm (thin, high; the bangs graze them)
  blush        x 31 mm, rel -50 mm, under the eyes
  mouth line   y 1.635 (rel -87.3 mm; painted at -88.5), corners x +-10 mm

PROJ_SCALE / PROJ_CENTRE must match siren.blob's sheet block exactly.

Run:  python3 scripts/make-siren-face.py
Out:  public/assets/lab/faces/siren-face.png  (512x512 RGBA)
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
SS = 4  # supersample: draw at 2048, LANCZOS down
W = SIZE * SS

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "lab", "faces", "siren-face.png",
)

# The projection — IDENTICAL to siren.blob's sheet block (the bride's: one uv
# unit spans 2.5 head-frame units; hs (0, -0.5) lands mid-sheet).
PROJ_SCALE_X = 0.40
PROJ_SCALE_Y = 0.40
PROJ_CENTRE_X = 0.50
PROJ_CENTRE_Y = 0.70
# The cranium's semi-axes (m): hs = offset / these.
AX_X, AX_Y = 0.07097, 0.09118

BASE = 120  # the neutral grey every multiplier scales

# Multipliers on her skin (see HOW IT BLENDS).
SCLERA = (1.20, 1.52, 1.72)    # -> a warm white (0.98 0.88 0.81)
SCLERA_SHADE = (0.72, 0.85, 1.05)  # the upper lid's shadow across the white
IRIS_DARK = (0.08, 0.04, 0.05)     # the iris top, under the lid
IRIS = (0.42, 0.16, 0.14)          # garnet
IRIS_LIGHT = (1.15, 0.62, 0.42)    # the anime glow at the iris foot (amber)
PUPIL = (0.02, 0.01, 0.01)
CATCH = (1.40, 2.00, 2.10)     # the catchlights: clamp to near-white
INK = (0.02, 0.015, 0.015)     # lash line and lashes
BROW = (0.07, 0.05, 0.05)      # cool near-black brown
CREASE = (0.45, 0.32, 0.36)    # the double-lid crease line
LID = (0.82, 0.62, 0.70)       # mauve on the lid
BLUSH = (1.12, 0.72, 0.78)     # rose flush under the eyes
LIP = (0.92, 0.40, 0.48)       # pink mouth
LIP_LINE = (0.30, 0.08, 0.12)  # the line where the lips meet

# Eye geometry, mm (positive-x eye; mirrored for the other). ANIME: the eye
# is ~3x the first pass's area and sits LOWER on the face (the owner, on the
# realistic first pass: "needs to be more exaggerated"; references
# anime-3d.glb and Mai Shiranui): 32 mm wide, 20 mm tall, a big round upper
# lid over a flatter lower one, the iris a tall oval nearly filling it.
# (A first anime pass at 29 x 18 mm read big in the sheet but ordinary on
# the head at 3 m: another ~15%.)
EYE_IN, EYE_OUT = 11.0, 43.0
EYE_Y = -31.0          # almond centre line at the inner corner, rel cranium centre
EYE_LIFT = 2.5         # outer corner this much higher
EYE_HALF_H = 11.5      # upper lid height above the centre line
EYE_LOW = 0.72         # the lower lid's depth, as a share of EYE_HALF_H
IRIS_X, IRIS_Y, IRIS_RX, IRIS_RY = 26.5, -29.5, 8.4, 10.8
PUPIL_RX, PUPIL_RY = 3.5, 5.0
MOUTH_Y = -88.5        # 1.2 mm under the prims' 1.635: the head's 4-degree
                       # tilt drops the projection on the lower face
MOUTH_HALF_W = 10.0    # small: the lip prims are 2.0 cm now


def mm(x: float, y: float) -> tuple[float, float]:
    """Face millimetres (x right of centre, y up from the cranium centre) ->
    supersampled pixel. Image top = face top; image left = the viewer's left
    = the character's RIGHT (-x)."""
    u = (x / 1000.0 / AX_X) * PROJ_SCALE_X + PROJ_CENTRE_X
    v = (y / 1000.0 / AX_Y) * PROJ_SCALE_Y + PROJ_CENTRE_Y
    return u * W, (1.0 - v) * W


PX_PER_MM_X = PROJ_SCALE_X * W / (AX_X * 1000.0)
PX_PER_MM_Y = PROJ_SCALE_Y * W / (AX_Y * 1000.0)


def new_mask() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    m = Image.new("L", (W, W), 0)
    return m, ImageDraw.Draw(m)


def blur(m: Image.Image, mm_r: float) -> Image.Image:
    return m.filter(ImageFilter.GaussianBlur(mm_r * PX_PER_MM_X))


def ellipse(d: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float, fill: int = 255) -> None:
    x, y = mm(cx, cy)
    d.ellipse([x - rx * PX_PER_MM_X, y - ry * PX_PER_MM_Y, x + rx * PX_PER_MM_X, y + ry * PX_PER_MM_Y], fill=fill)


def stroke(d: ImageDraw.ImageDraw, pts_mm, w0: float, w1: float, fill: int = 255) -> None:
    """A tapered polyline of stamped discs, widths in mm."""
    pts = [mm(x, y) for x, y in pts_mm]
    n = len(pts)
    for k in range(n - 1):
        (xa, ya), (xb, yb) = pts[k], pts[k + 1]
        seg = max(1, int(math.hypot(xb - xa, yb - ya) / 2))
        for j in range(seg):
            t = (k + j / seg) / (n - 1)
            r = 0.5 * (w0 + (w1 - w0) * t) * PX_PER_MM_X
            x, y = xa + (xb - xa) * j / seg, ya + (yb - ya) * j / seg
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def almond_edge(t: float, upper: bool, grow: float = 0.0) -> tuple[float, float]:
    """A point on the almond, t 0 inner corner -> 1 outer; `grow` (mm) pushes
    it outward. The upper lid arcs higher toward the inner third (where the
    lid is fullest), the lower is flatter."""
    x = EYE_IN + (EYE_OUT - EYE_IN) * t
    yc = EYE_Y + EYE_LIFT * t
    if upper:
        h = EYE_HALF_H * math.sin(math.pi * t ** 0.80) ** 0.55 + grow
        return x, yc + h
    h = EYE_LOW * EYE_HALF_H * math.sin(math.pi * t ** 1.1) ** 0.8 + grow
    return x, yc - h


def both(pts):
    return (pts, [(-x, y) for x, y in pts])


def almond_mask(grow: float = 0.0) -> Image.Image:
    m, d = new_mask()
    n = 40
    for side in both([almond_edge(i / n, True, grow) for i in range(n + 1)] +
                     [almond_edge(1 - i / n, False, grow) for i in range(n + 1)]):
        d.polygon([mm(x, y) for x, y in side], fill=255)
    return m


# ---------------------------------------------------------------------------
# Layers: each returns (mask L, multiplier rgb, opacity).

def lid_layers():
    """A little mauve on the lid, and the double-lid crease: a thin dark arc
    ~3.5 mm above the lash line, the anime eye's second line."""
    lid, d = new_mask()
    for s_ in (1.0, -1.0):
        ellipse(d, s_ * 28.0, EYE_Y + EYE_HALF_H + 2.0, 16.0, 5.0)
    lid = blur(lid, 2.0)
    crease, dc = new_mask()
    pts = [almond_edge(0.18 + 0.78 * t / 10, True, 3.6) for t in range(11)]
    for side in both(pts):
        stroke(dc, side, 0.5, 0.9)
    crease = blur(crease, 0.35)
    return [(lid, LID, 0.70), (crease, CREASE, 0.80)]


def blush_layer():
    """Anime blush: a soft rose band under each eye, wider than tall."""
    m, d = new_mask()
    for s_ in (1.0, -1.0):
        ellipse(d, s_ * 31.0, -50.0, 14.0, 6.0)
    return [(blur(m, 4.0), BLUSH, 0.85)]


def brow_layer():
    """Thin, high, gently arched brows (Mai's): well above the eye, so the
    face reads open and surprised-sweet rather than stern."""
    m, d = new_mask()
    path = [(11.0, -1.0), (19.0, 3.5), (29.0, 5.6), (39.0, 4.6), (47.0, 0.5)]
    for side in both(path):
        stroke(d, side, 2.2, 0.8)
    return [(blur(m, 0.3), BROW, 0.92)]


def eye_layers():
    """Sclera, a graded iris (dark under the lid, glowing amber at its foot),
    pupil, two catchlights — clipped to the eye."""
    alm = almond_mask()
    alm_a = np.asarray(alm)
    clip = lambda m: Image.fromarray(np.minimum(np.asarray(m), alm_a))
    out = [(blur(alm, 0.25), SCLERA, 1.0)]
    sh, d = new_mask()
    for s_ in (1.0, -1.0):
        ellipse(d, s_ * IRIS_X, EYE_Y + EYE_HALF_H + 1.0, 17.0, 5.0)
    out.append((clip(blur(sh, 1.0)), SCLERA_SHADE, 0.9))
    for colour, rx, ry, dy, b in ((IRIS_DARK, IRIS_RX, IRIS_RY, 0.0, 0.3),
                                  (IRIS, IRIS_RX - 0.9, IRIS_RY - 1.0, -0.6, 0.5),
                                  (IRIS_LIGHT, IRIS_RX - 2.2, IRIS_RY * 0.42, -IRIS_RY * 0.50, 1.6),
                                  (PUPIL, PUPIL_RX, PUPIL_RY, 0.4, 0.4)):
        m, d = new_mask()
        for s_ in (1.0, -1.0):
            ellipse(d, s_ * IRIS_X, IRIS_Y + dy, rx, ry)
        out.append((clip(blur(m, b)), colour, 1.0))
    # The lid's shadow over the iris top.
    out.append((clip(blur(sh, 1.0)), (0.55, 0.55, 0.55), 0.6))
    c, d = new_mask()
    for s_ in (1.0, -1.0):
        # One key light: the big catchlight upper-left on both eyes, a small
        # one lower-right.
        ellipse(d, s_ * IRIS_X - 3.0, IRIS_Y + 3.4, 2.3, 2.6)
        ellipse(d, s_ * IRIS_X + 2.6, IRIS_Y - 3.8, 1.0, 1.0)
    out.append((blur(c, 0.15), CATCH, 1.0))
    return out


def liner_layer():
    """The anime upper lash line: heavy, thickening to the outer corner and
    flicked out and up past it; a thin lower line on the outer half."""
    m, d = new_mask()
    n = 24
    upper = [almond_edge(i / n, True, 0.4) for i in range(1, n + 1)]
    ox, oy = upper[-1]
    upper += [(ox + 2.5, oy + 0.6), (ox + 5.0, oy + 2.0)]
    for side in both(upper):
        stroke(d, side, 1.3, 2.6)
    lower, dl = new_mask()
    for side in both([almond_edge(0.35 + 0.65 * i / 12, False, 0.3) for i in range(13)]):
        stroke(dl, side, 0.4, 0.9)
    return [(blur(m, 0.25), INK, 0.97), (blur(lower, 0.3), INK, 0.70)]


def lash_layer():
    """A few thick lash CLUMPS at the outer corner, swept out (anime lashes
    are shapes, not hairs), and two short ones under the outer corner."""
    m, d = new_mask()
    for s_ in (1.0, -1.0):
        for t, length, ang in ((0.70, 2.6, 70), (0.82, 3.4, 45), (0.93, 3.8, 22)):
            x, y = almond_edge(t, True, 0.8)
            a = math.radians(ang)
            pts = [(x, y), (x + math.cos(a) * length * 0.6, y + math.sin(a) * length * 0.6 + 0.3),
                   (x + math.cos(a - 0.3) * length, y + math.sin(a - 0.3) * length)]
            stroke(d, [(s_ * px_, py_) for px_, py_ in pts], 1.1, 0.2)
        for t in (0.78, 0.9):
            x, y = almond_edge(t, False, 0.5)
            pts = [(x, y), (x + 1.2, y - 1.8)]
            stroke(d, [(s_ * px_, py_) for px_, py_ in pts], 0.6, 0.15)
    return [(blur(m, 0.15), INK, 0.95)]


def lip_layers():
    """A cupid's-bow upper lip, a fuller lower, a darker line between, and a
    soft highlight on the lower lip's centre."""
    m, d = new_mask()
    w = MOUTH_HALF_W
    pts = []
    for i in range(41):
        x = -w + 2 * w * i / 40
        t = abs(x) / w
        h = 3.2 * math.sin(math.pi * (1 - t) / 2) ** 0.8 - 0.7 * math.exp(-(x / (0.15 * w)) ** 2)
        pts.append(mm(x, MOUTH_Y + 0.9 * t * t + max(0.0, h)))
    for i in range(41):
        x = w - 2 * w * i / 40
        t = abs(x) / w
        h = 4.4 * math.sin(math.pi * (1 - t) / 2) ** 0.9
        pts.append(mm(x, MOUTH_Y + 0.9 * t * t - h))
    d.polygon(pts, fill=255)
    line, dl = new_mask()
    lp = []
    for i in range(31):
        x = -w + 2 * w * i / 30
        lp.append((x, MOUTH_Y + 0.3 * math.cos(math.pi * x / (2 * w)) + 1.2 * (x / w) ** 2))  # corners up: a small smile
    stroke(dl, lp, 0.7, 0.7)
    hi, dh = new_mask()
    ellipse(dh, 0.0, MOUTH_Y - 2.2, 3.0, 1.0)
    return [(blur(m, 0.5), LIP, 0.95), (blur(line, 0.35), LIP_LINE, 0.85), (blur(hi, 1.2), (1.05, 0.95, 0.95), 0.6)]


def base_alpha() -> np.ndarray:
    """The face oval: alpha 1 over the face, feathered at the edge (the
    bride's, hs centre (0, -0.40), semi-axes 1.12 x 1.05)."""
    m, d = new_mask()
    cx, cy = mm(0.0, -0.40 * AX_Y * 1000)
    rx, ry = 1.12 * PROJ_SCALE_X * W, 1.05 * PROJ_SCALE_Y * W
    steps = 24
    for i in range(steps):
        f = 1.0 - i / steps
        val = 255 if f <= 0.8 else int(255 * (1.0 - f) / 0.2)
        d.ellipse([cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f], fill=val)
    m = m.filter(ImageFilter.GaussianBlur(0.05 * PROJ_SCALE_X * W))
    return np.asarray(m, dtype=np.float32) / 255.0


def main() -> int:
    mult = np.ones((W, W, 3), dtype=np.float32)
    layers = (lid_layers() + blush_layer() + brow_layer() + eye_layers() + liner_layer() + lash_layer()
              + lip_layers())
    for mask, colour, opacity in layers:
        a = (np.asarray(mask, dtype=np.float32) / 255.0 * opacity)[..., None]
        mult = mult * (1.0 - a) + np.asarray(colour, dtype=np.float32) * a
    rgb = np.clip(mult * BASE, 0, 255)
    rgba = np.concatenate([rgb, base_alpha()[..., None] * 255.0], axis=2).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, optimize=True)

    # The mean the shader divides by (lab-main applyMeanOf): luma of every
    # texel with alpha >= 8. The registry declares it for the game.
    a = np.asarray(out, dtype=np.float32)
    keep = a[..., 3] >= 8
    luma = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) / 255.0
    mean = float(luma[keep].mean())
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    print(f"mean luma (the shader's divisor): {mean:.6f}")
    print(f"base multiplies by {BASE / 255.0 / mean:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
