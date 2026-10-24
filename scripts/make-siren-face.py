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

  eye          x 9..46 mm, centre line rel -29 mm, 26 mm tall (anime, huge)
  iris         centre x +-27.5 mm, rel -27 mm, a 19 x 24 mm oval
  socket       siren.blob's carve, centred x 28 mm, rel -27 mm
  brows        rel -6.5..+4.8 mm, x 11..52 mm, slanting in toward the nose
  mouth line   rel -81.5 mm (the lip prims' probed swells: upper -78,
               lower -89.5), corners x +-19.5 mm

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
SCLERA_SHADE = (0.80, 0.95, 1.10)  # the upper lid's shadow across the white
IRIS_DARK = (0.04, 0.08, 0.06)   # the iris top, under the lid
IRIS = (0.20, 0.52, 0.34)        # emerald
IRIS_LIGHT = (0.70, 1.45, 0.80)  # the anime glow at the iris foot
LIMBAL = (0.05, 0.07, 0.06)      # the dark rim of the iris
PUPIL = (0.02, 0.02, 0.02)
CATCH = (1.40, 2.00, 2.10)     # the catchlight: clamps to near-white
INK = (0.02, 0.015, 0.015)     # liner and lashes
BROW = (0.07, 0.05, 0.05)      # cool near-black brown
CREASE = (0.40, 0.26, 0.40)    # the lid's crease: a firm plum line round the top of the big lid
LID = (0.98, 0.66, 1.45)       # lavender-pink shadow over the whole heavy lid (the 1940s pin-up's)
LID_ROUND = (1.10, 1.08, 1.08) # a soft highlight across the lid's middle: the lid reads convex, a fold over the eye
BROW_BONE = (1.10, 1.08, 1.06)  # a lift under the brow, so the lid reads set back
BLUSH = (1.08, 0.78, 0.82)     # rose flush
LIP = (0.52, 0.00, 0.07)       # red lipstick (owner, 2026-10-23): crimson; warmer values rendered salmon on her skin
LIP_LINE = (0.22, 0.02, 0.04)  # the line where the lips meet

# Eye geometry, mm (positive-x eye; mirrored for the other). ANIME, and
# "a bit ridiculous big" (owner, 2026-10-23): 37 x 22 mm, ~4x a realistic
# eye's area, centred in siren.blob's carved socket (x 28, rel -27 mm: the
# carve's offset), a tall graded iris nearly filling it.
EYE_IN, EYE_OUT = 12.0, 49.0     # (9, 46 read as too close-set, owner 2026-10-24)
EYE_Y = -29.0          # eye centre line at the inner corner, rel cranium centre
EYE_LIFT = 3.0         # outer corner this much higher
EYE_HALF_H = 14.5      # the eye's full height above the centre line: the top of the big lid
# HEAVY LIDS (owner, 2026-10-24: "the eyelids are really big and long lashes,
# eyes are not so wide open though eyes are big"; the 1940s cartoon pin-up):
# the upper lid's EDGE drops to this share of EYE_HALF_H, so the lid covers
# the top ~40% of the iris and the eye looks half-closed, knowing. Everything
# between the lid edge and the eye's full top is LID, painted lavender-pink.
LID_OPEN = 0.40
EYE_LOW = 0.78         # the lower lid's depth, as a share of EYE_HALF_H
IRIS_X, IRIS_Y, IRIS_RX, IRIS_RY = 31.0, -28.5, 9.6, 11.5
PUPIL_RX, PUPIL_RY = 3.4, 4.6
# The mouth line and lip peaks are siren.blob's lip prims, PROBED (where
# each prim lies closest under the skin): upper peak -78, lower -89.5, the
# line between at -81.5 mm (the owner's "closer to the eyes" pass moved the
# mouth up 4.8 mm). An earlier sheet put the line 2.3 mm under its lips.
MOUTH_Y = -81.5
MOUTH_HALF_W = 18.0


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
        # The LID EDGE: low and only gently curved (a drowsy lid is nearly
        # straight across), highest a little past the middle.
        h = LID_OPEN * EYE_HALF_H * math.sin(math.pi * t ** 0.95) ** 0.45 + grow
        return x, yc + h
    h = EYE_LOW * EYE_HALF_H * math.sin(math.pi * t ** 1.1) ** 0.8 + grow
    return x, yc - h


def orbit_top(t: float, grow: float = 0.0) -> tuple[float, float]:
    """The top of the eye's full shape — where the big lid ends at its
    crease — t 0 inner -> 1 outer."""
    x = EYE_IN + (EYE_OUT - EYE_IN) * t
    yc = EYE_Y + EYE_LIFT * t
    return x, yc + EYE_HALF_H * math.sin(math.pi * t ** 0.80) ** 0.55 + grow


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
    """THE HEAVY LID: everything from the dropped lid edge up to the eye's
    full top plus ~3 mm, lavender-pink, deepest at the lash line and swept
    out past the outer corner; a soft highlight across its middle so it
    reads as a convex fold over the eye; a firm plum crease round its top;
    a faint lift under the brow."""
    lid, d = new_mask()
    n = 30
    for s_ in (1.0, -1.0):
        band = [almond_edge(i / n, True, -0.5) for i in range(n + 1)] + \
               [orbit_top(1 - i / n, 3.0) for i in range(n + 1)]
        d.polygon([mm(s_ * x, y) for x, y in band], fill=255)
        ox, oy = almond_edge(1.0, True, 0.0)
        ellipse(d, s_ * (ox + 2.0), oy + 3.5, 7.0, 5.0)   # swept out past the corner
    lid = blur(lid, 1.2)
    rnd, dr = new_mask()
    for s_ in (1.0, -1.0):
        mx, my = almond_edge(0.55, True, 0.0)
        tx, ty = orbit_top(0.55, 0.0)
        ellipse(dr, s_ * mx, (my + ty) / 2 + 1.0, 11.0, 3.5)
    rnd = blur(rnd, 2.0)
    crease, dc = new_mask()
    pts = [orbit_top(0.06 + 0.94 * t / 14, 3.0) for t in range(15)]
    ox, oy = pts[-1]
    pts.append((ox + 3.0, oy - 1.5))
    for side in both(pts):
        stroke(dc, side, 0.6, 1.4)
    crease = blur(crease, 0.5)
    bone, db = new_mask()
    for s_ in (1.0, -1.0):
        tx, ty = orbit_top(0.55, 0.0)
        ellipse(db, s_ * tx, ty + 8.0, 15.0, 3.0)
    bone = blur(bone, 2.0)
    return [(bone, BROW_BONE, 0.8), (lid, LID, 0.95), (rnd, LID_ROUND, 0.7), (crease, CREASE, 0.85)]


def blush_layer():
    m, d = new_mask()
    for s in (1.0, -1.0):
        ellipse(d, s * 38.0, -53.0, 14.0, 7.0)
    return [(blur(m, 6.0), BLUSH, 0.9)]


def brow_layer():
    """Thin, high, gently arched brows (the 1940s pin-up's, owner
    2026-10-24): the peak two thirds out, both ends falling away."""
    m, d = new_mask()
    # Above the big eye (its lid tops out at rel ~-15 mm).
    # THIN, HIGH ARCHES (the pin-up's): set well above the big lid, rising
    # from a low inner head to a peak two thirds out, falling off sharply.
    # Inner heads NOT low: a first pass dropped them to -4 mm and the
    # brows rendered as an angry V. A gentle high arch reads knowing.
    path = [(16.0, 3.0), (22.0, 6.2), (29.0, 8.6), (36.0, 9.8), (42.0, 9.4), (48.0, 6.8), (54.0, 2.0)]
    for side in both(path):
        stroke(d, side, 2.6, 0.7)
    return [(blur(m, 0.35), BROW, 0.92)]


def eye_layers():
    """Sclera, a graded anime iris (dark under the lid, glowing at its
    foot), pupil, two catchlights — clipped to the eye."""
    alm = almond_mask()
    alm_a = np.asarray(alm)
    clip = lambda m: Image.fromarray(np.minimum(np.asarray(m), alm_a))
    out = [(blur(alm, 0.25), SCLERA, 1.0)]
    sh, d = new_mask()
    for s_ in (1.0, -1.0):
        lx, ly = almond_edge(0.5, True, 0.0)
        ellipse(d, s_ * IRIS_X, ly + 1.0, 20.0, 4.0)
    out.append((clip(blur(sh, 1.2)), SCLERA_SHADE, 0.9))
    for colour, rx, ry, dy, b in ((LIMBAL, IRIS_RX, IRIS_RY, 0.0, 0.3),
                                  (IRIS_DARK, IRIS_RX - 0.8, IRIS_RY - 0.9, 0.0, 0.4),
                                  (IRIS, IRIS_RX - 1.4, IRIS_RY * 0.70, -IRIS_RY * 0.22, 1.4),
                                  (IRIS_LIGHT, IRIS_RX - 3.0, IRIS_RY * 0.36, -IRIS_RY * 0.55, 1.8),
                                  (PUPIL, PUPIL_RX, PUPIL_RY, 0.6, 0.4)):
        m, d = new_mask()
        for s_ in (1.0, -1.0):
            ellipse(d, s_ * IRIS_X, IRIS_Y + dy, rx, ry)
        out.append((clip(blur(m, b)), colour, 1.0))
    out.append((clip(blur(sh, 1.2)), (0.55, 0.55, 0.55), 0.6))
    c, d = new_mask()
    for s_ in (1.0, -1.0):
        # One key light: a big catchlight upper-left on both eyes, a small
        # one lower-right.
        ellipse(d, s_ * IRIS_X - 3.2, IRIS_Y + 1.6, 2.0, 2.0)
        ellipse(d, s_ * IRIS_X + 3.0, IRIS_Y - 5.0, 0.9, 0.9)
    out.append((blur(c, 0.15), CATCH, 1.0))
    return out


def liner_layer():
    """A HEAVY upper lash line (3 mm, swelling to 4.5 mm over the outer
    third) with a thick wing 12 mm out and up past the corner; a firm lower
    line on the outer half."""
    m, d = new_mask()
    n = 24
    upper = [almond_edge(i / n, True, 0.4) for i in range(1, n + 1)]
    ox, oy = upper[-1]
    # HEAVIER (owner, twice): 3 mm along the lid, swelling to 4.5 mm over
    # the outer third, and a long thick wing 12 mm out and up.
    upper += [(ox + 4.0, oy + 1.4), (ox + 8.0, oy + 3.4), (ox + 11.0, oy + 5.5)]
    for side in both(upper):
        stroke(d, side, 2.8, 1.6)
    for side in both([almond_edge(1 - i / n * 0.75, True, 1.4) for i in range(n)]):
        stroke(d, side, 3.6, 1.2)
    lower, dl = new_mask()
    for side in both([almond_edge(0.35 + 0.65 * i / 12, False, 0.3) for i in range(13)]):
        stroke(dl, side, 0.8, 1.8)
    return [(blur(m, 0.25), INK, 0.97), (blur(lower, 0.3), INK, 0.65)]


def lash_layer():
    """LONG LASHES at the heavy lid's OUTER half (the pin-up's): five thick,
    tapered sweeps, 9-16 mm, going OUT more than up and curling up a little
    at the tips, the longest past the outer corner. (A first pass stood
    eight lashes up across the lid like a comb and hid the lid colour.)
    Two short ones under the outer corner."""
    m, d = new_mask()
    for s_ in (1.0, -1.0):
        for t, length, ang in ((0.62, 9.0, 52), (0.74, 11.5, 38), (0.85, 13.5, 26), (0.94, 15.5, 14), (1.00, 15.0, 2)):
            x, y = almond_edge(t, True, 0.6)
            pts = []
            for j in range(8):
                f = j / 7
                a = math.radians(ang) + 0.45 * f * f    # curl up at the tips
                pts.append((x + math.cos(a) * length * f, y + math.sin(a) * length * f * 0.80))
            stroke(d, [(s_ * px_, py_) for px_, py_ in pts], 2.8, 0.4)
        for t in (0.80, 0.92):
            x, y = almond_edge(t, False, 0.6)
            pts = [(x, y), (x + 1.2, y - 1.8), (x + 2.2, y - 3.2)]
            stroke(d, [(s_ * px_, py_) for px_, py_ in pts], 0.9, 0.2)
    return [(blur(m, 0.15), INK, 0.97)]


def nose_light():
    """A soft counter-light under the nose ridge's end (rel ~-54 mm), where
    the shading pools in the hollow between the nose and the lip: without
    it a dark smudge ~1.5 cm wide sat under her nose at every distance."""
    m, d = new_mask()
    ellipse(d, 0.0, -55.0, 9.0, 6.0)
    return [(blur(m, 3.0), (1.55, 1.45, 1.42), 0.9)]


def lip_layers():
    """A cupid's-bow upper lip, a fuller lower, a darker line between, and a
    soft highlight on the lower lip's centre."""
    m, d = new_mask()
    w = MOUTH_HALF_W
    pts = []
    for i in range(41):
        x = -w + 2 * w * i / 40
        t = abs(x) / w
        # A pronounced cupid's bow: two peaks and a deep dip (the pout).
        h = 10.5 * math.sin(math.pi * (1 - t) / 2) ** 0.65 - 3.0 * math.exp(-(x / (0.14 * w)) ** 2)
        pts.append(mm(x, MOUTH_Y + max(0.0, h)))
    for i in range(41):
        x = w - 2 * w * i / 40
        t = abs(x) / w
        h = 14.0 * math.sin(math.pi * (1 - t) / 2) ** 0.75
        pts.append(mm(x, MOUTH_Y - h))
    d.polygon(pts, fill=255)
    line, dl = new_mask()
    lp = []
    for i in range(31):
        x = -w + 2 * w * i / 30
        lp.append((x, MOUTH_Y + 0.5 * math.cos(math.pi * x / (2 * w)) - 0.4 * (x / w) ** 2))
    stroke(dl, lp, 0.9, 0.9)
    hi, dh = new_mask()
    ellipse(dh, 0.0, MOUTH_Y - 6.5, 6.0, 2.0)
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
              + nose_light() + lip_layers())
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
