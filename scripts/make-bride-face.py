#!/usr/bin/env python3
"""Generate public/assets/lab/faces/bride-face.png — the bride's corpse makeup.

WHY A GENERATOR
---------------
The bride has no reference mesh (prose + one uncommitted inspiration photo), so
`npm run blob:face-bake` cannot run: the bake renders a mesh's own face and
there is no mesh. Same bargain as make-ogre-face.py / make-cyberdemon-face.py:
all facial STRUCTURE is prims in bride.blob (almond eyes with sclera and iris,
heavy upper lids, bruised socket ovals, brow arcs, a small nose, lilac lips,
cheekbones, a slim jaw) and this sheet carries only the PAINT — the things
prims cannot draw at a readable size. The art is original, drawn in PIL below.
Seeded (random.Random(24)), so a rerun is byte-identical.

WHAT IT DRAWS (in this order, one function each)
------------------------------------------------
 1. sockets()  soft near-black smoke round each eye, spaced on the eye prims
 2. lids()     thin bruised-red crescents on the upper and lower socket rims
 3. hollows()  SUNKEN CHEEKS (owner, 2026-09-24: texture, not geometry) — a
               blurred, deep grey-violet hollow under each cheekbone, with a faint
               light band along its top edge as the cheekbone highlight
 4. lips()     a grey-lilac lip shape over the lip prims
 5. sutures()  a fine dark line from each mouth corner arcing back toward the
               ear, cross-stitched
 6. veins()    faint blue branching veins at the temples
 7. liner()    winged black liner along each lash line (owner ask, 2026-09-24:
               "eyelashes ... or some kind of mascara look")
 8. lashes()   painted upper and lower lashes (prim lashes would be subpixel
               at game distance)
 9. runs()     running mascara: dark streaks from the lower lid down the cheek

Between 6 and 7 the eye ALMONDS are cleared back to the neutral base, so the
smoke and bruise never paint over the sclera (an all-black almond read as a
grey alien's eye — Task 1's loudest alien cue). Liner, lashes and runs go on
after, so the lash line may bite a hair into the eye the way real liner does.

HOW IT BLENDS (read this before changing a colour)
--------------------------------------------------
The .blob wears this at `decal 0` (MULTIPLY) with `blendLuma 0`. The shader
computes `detail = tex.rgb / mean` and mixes albedo -> albedo * detail by alpha,
where `mean` is the average luma of every texel with alpha >= 8. So:

* A dark stroke on its own (alpha 0 elsewhere, the ogre's layout) would be its
  OWN mean and multiply by ~1 — invisible. This sheet therefore lays a NEUTRAL
  GREY BASE (BASE_GREY, alpha 1 over the face, feathered at the edge) under the
  makeup. The base dominates the mean, so the base multiplies by just over 1
  (a faint pale powder) and the makeup by its luma / mean — near-black liner
  multiplies by ~0.05.
* Every texel's rgb is BASE_GREY where the alpha fades out, so the luminance
  relief (texRelief) sees no ridge at the base's edge.

GEOMETRY — every position is measured, not drawn by eye
-------------------------------------------------------
The shader projects uv = hs * PROJ_SCALE + PROJ_CENTRE, where hs is the surface
point in the head frame normalised by the FATTEST head prim's semi-axes
(headShape(): the cranium, centre y 1.7223 z -0.0107, semi-axes 0.07097 x
0.09118 x 0.09024). The prim coordinates below were read off the BUILT body
(buildBody + headShape, 2026-09-24) and converted to hs:

  iris centre             x +-0.034 y 1.6998      hs (+-0.479, -0.247)
  sclera almond           x 0.0175..0.0505        hs x 0.247..0.712, half-h 0.084
  upper lid (lash line)   lid prim lower edge     hs y ~ -0.215
  lower lid               eye bottom 1.6923       hs y ~ -0.330
  socket oval             semi 0.0257 x 0.0162    hs 0.361 x 0.177
  cheekbone               x 0.046 y 1.678         hs (0.648, -0.483)
  soft cheek              x 0.032 y 1.660         hs (0.451, -0.680)
  mouth (between lips)    y 1.635, corners x 0.0195  hs y -0.955, corners x 0.275
  jaw corner              x ~0.056 y 1.625        hs (0.79, -1.07)

PROJ_SCALE / PROJ_CENTRE must match the .blob's sheet block exactly.

Run:  python3 scripts/make-bride-face.py
Out:  public/assets/lab/faces/bride-face.png  (512x512 RGBA)
"""
from __future__ import annotations

import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 512
SS = 4  # supersample: draw at 2048, LANCZOS down, for a soft alpha ramp
W = SIZE * SS

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "lab", "faces", "bride-face.png",
)

# The projection — IDENTICAL to bride.blob's sheet block. projScale is a
# FREQUENCY: one uv unit spans 1/0.40 = 2.5 head-frame units, i.e. 0.177 m
# across and 0.228 m down, which fits brow-to-chin and ear-to-ear on the sheet.
# The centre puts hs (0, -0.5) — mid-face, halfway between the eyes and the
# mouth — at uv (0.5, 0.5), so the drawing is centred on the sheet.
PROJ_SCALE_X = 0.40
PROJ_SCALE_Y = 0.40
PROJ_CENTRE_X = 0.50
PROJ_CENTRE_Y = 0.70

BASE_GREY = 206          # the neutral base; ~1.12x after the mean divides out
EYE_X = 0.479            # iris centre, hs
EYE_Y = -0.247
ALMOND_IN, ALMOND_OUT = 0.247, 0.712
ALMOND_HALF_H = 0.084
LASH_Y = -0.212          # upper lid's lower edge (the lash line) at mid-eye
MOUTH_Y = -0.955
MOUTH_HALF_W = 0.275

INK = (10, 8, 8)             # 0a0808 — liner, lashes, mascara
BRUISE = (122, 30, 34)       # 7a1e22 — lid crescents
HOLLOW = (58, 44, 70)        # 3a2c46 — sunken cheeks (was 4a3c55; owner: deeper)
HIGHLIGHT = (232, 228, 238)  # e8e4ee — cheekbone highlight
LIP = (138, 122, 142)        # 8a7a8e — dead lips
STITCH = (42, 18, 22)        # 2a1216 — sutures
VEIN = (61, 79, 115)         # 3d4f73 — temple veins


def px(hx: float, hy: float) -> tuple[float, float]:
    """Head-frame (hs.x, hs.y) -> supersampled pixel. Image top = face top
    (the loader flips rows, so uv.y 1 is the first row); image left = the
    viewer's left = the character's RIGHT (-x)."""
    u = hx * PROJ_SCALE_X + PROJ_CENTRE_X
    v = hy * PROJ_SCALE_Y + PROJ_CENTRE_Y
    return u * W, (1.0 - v) * W


def hs_len(d: float) -> float:
    """A length in hs units -> supersampled pixels (x and y scales match)."""
    return d * PROJ_SCALE_X * W


def recolour(mask: Image.Image, colour: tuple[int, int, int], alpha: float) -> Image.Image:
    """A single-colour RGBA layer whose alpha is `mask` (L) scaled by alpha."""
    a = mask.point(lambda v: int(round(v * alpha)))
    im = Image.new("RGBA", (W, W), colour + (0,))
    im.putalpha(a)
    return im


def stroke(d: ImageDraw.ImageDraw, pts, w0: float, w1: float, fill=255) -> None:
    """A tapered polyline of stamped discs (PIL's wide lines notch at joins)."""
    n = len(pts)
    for k in range(n - 1):
        (xa, ya), (xb, yb) = pts[k], pts[k + 1]
        seg = max(1, int(math.hypot(xb - xa, yb - ya) / 2))
        for j in range(seg):
            t = (k + j / seg) / (n - 1)
            r = 0.5 * (w0 + (w1 - w0) * t)
            x, y = xa + (xb - xa) * j / seg, ya + (yb - ya) * j / seg
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def eyes():
    """(sign, iris_x) for each eye; sign flips outward x."""
    return ((-1.0, -EYE_X), (1.0, EYE_X))


def almond_edge(t: float, upper: bool) -> tuple[float, float]:
    """A point on the eye almond, t 0 inner corner -> 1 outer corner (hs,
    positive-x eye). The prim is a capsule from inner (0.026) to outer
    (0.042) tipped up 2 mm at the outer end, radius 0.0085 x 0.90 tall."""
    x = ALMOND_IN + (ALMOND_OUT - ALMOND_IN) * t
    yc = -0.257 + 0.022 * t
    h = ALMOND_HALF_H * math.sin(math.pi * t) ** 0.7
    return x, yc + (h if upper else -h)


# ---------------------------------------------------------------------------
def sockets() -> Image.Image:
    """Near-black smoke, darkest hugging the almond and fading out over ~70 px
    (0.34 hs — the socket oval's own 0.36 x 0.18 semi-axes, a touch wider),
    centred a hair above the iris so the smoke rides up onto the lid."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    u = Image.new("L", (W, W), 0)
    du = ImageDraw.Draw(u)
    for s, ex in eyes():
        cx, cy = px(ex + s * 0.03, EYE_Y + 0.03)
        # 0.38 x 0.26: the socket oval's 0.36 x 0.18, spread a little onto
        # the lid and the brow valley — at 0.34 x 0.20 the smoke was only a
        # thin band above and below the almond and did not read at 3 m.
        rx, ry = hs_len(0.38), hs_len(0.26)
        steps = 40
        for i in range(steps):
            f = 1.0 - i / steps           # 1 at the rim -> 0 at the centre
            # Solid out to ~half the radius (the almond is cleared from the
            # middle later, so "near-black at the centre" lands as a dark ring
            # hugging the eye), then a smooth fade to nothing at the rim.
            val = 255 if f < 0.5 else int(255 * (1.0 - (f - 0.5) / 0.5) ** 1.4)
            d.ellipse([cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f], fill=val)
        # UNDER-EYE: a second, flatter ellipse below the almond. The lid
        # ellipse alone left the under-eye pale in the close-up (its solid
        # core ended ~0.015 hs under the almond), which read as eyeliner, not
        # as a smoky, sunken eye.
        # Centred at hs -0.36 (the sclera PRIM's front covers down to ~-0.37
        # in the render, and painted prims ignore the sheet — a banded
        # diagnostic sheet showed it), so the dark core lands on the skin
        # just under the eye rather than under the eyeball.
        ux, uy = px(ex + s * 0.02, EYE_Y - 0.13)
        urx, ury = hs_len(0.30), hs_len(0.17)
        for i in range(steps):
            f = 1.0 - i / steps
            val = 255 if f < 0.55 else int(255 * (1.0 - (f - 0.55) / 0.45) ** 1.4)
            du.ellipse([ux - urx * f, uy - ury * f, ux + urx * f, uy + ury * f], fill=val)
    m = ImageChops.lighter(m, u)
    m = m.filter(ImageFilter.GaussianBlur(hs_len(0.03)))
    return recolour(m, (22, 14, 18), 0.92)


def lids() -> Image.Image:
    """Bruised-red crescents on the socket rims: one above the lash line on
    the lid, one under the lower lid. Alpha ~0.6."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    for s, _ in eyes():
        up = [px(s * x, y + 0.075 * math.sin(math.pi * t) + 0.02)
              for t in [i / 16 for i in range(17)]
              for x, y in [almond_edge(t, True)]]
        lo = [px(s * x, y - 0.035 * math.sin(math.pi * t) - 0.012)
              for t in [0.1 + 0.85 * i / 16 for i in range(17)]
              for x, y in [almond_edge(t, False)]]
        stroke(d, up, hs_len(0.020), hs_len(0.030))
        stroke(d, lo, hs_len(0.018), hs_len(0.026))
    m = m.filter(ImageFilter.GaussianBlur(hs_len(0.012)))
    return recolour(m, BRUISE, 0.6)


def hollows() -> Image.Image:
    """SUNKEN CHEEKS as texture. A diagonal hollow from under the cheekbone
    (hs 0.67, -0.58) sloping in toward the mouth corner (0.49, -0.92), between
    the cheekbone (0.648, -0.483) and the soft cheek (0.451, -0.680) — the
    valley the .blob deliberately left shallow — heavily blurred, core alpha
    0.85.
    Returns (hollow, highlight) composited in that order."""
    m = Image.new("L", (W, W), 0)
    h = Image.new("L", (W, W), 0)
    dm, dh = ImageDraw.Draw(m), ImageDraw.Draw(h)
    for s, _ in eyes():
        # (0.70, -0.58) -> (0.52, -0.92): under the cheekbone's front and
        # sloping in toward the mouth corner (the buccal hollow). The first
        # placement ran down the OUTER cheek (x 0.78 -> 0.68) where the
        # surface turns away and the facing fade ate it: invisible in the 3/4.
        # Shifted 0.03 in when the cheekbones were narrowed (Task 2 review).
        pts = [px(s * (0.67 - 0.18 * t), -0.58 - 0.34 * t) for t in [i / 12 for i in range(13)]]
        stroke(dm, pts, hs_len(0.13), hs_len(0.08))
        # Cheekbone highlight: a thin arc hugging the hollow's TOP edge, from
        # under the outer eye corner out along the cheekbone.
        hl = [px(s * (0.38 + 0.36 * t), -0.50 + 0.04 * t - 0.05 * math.sin(math.pi * t))
              for t in [i / 12 for i in range(13)]]
        stroke(dh, hl, hs_len(0.030), hs_len(0.020))
    m = m.filter(ImageFilter.GaussianBlur(hs_len(0.07)))
    h = h.filter(ImageFilter.GaussianBlur(hs_len(0.03)))
    # The blur roughly halves the stroke's peak; normalise so the CORE lands
    # at alpha 0.55 (and the highlight's at 0.20) whatever the blur radius.
    m = m.point(lambda v, k=255.0 / max(1, m.getextrema()[1]): min(255, int(v * k)))
    h = h.point(lambda v, k=255.0 / max(1, h.getextrema()[1]): min(255, int(v * k)))
    # Core alpha 0.85 (was 0.55): the owner's review asked for deeper
    # hollows, roughly double the darkness. The highlight rides a touch
    # higher (0.25) so the pair still reads as a concave shadow under a
    # lit cheekbone rather than a bruise.
    return recolour(m, HOLLOW, 0.85), recolour(h, HIGHLIGHT, 0.25)


def lips() -> Image.Image:
    """Grey-lilac over the lip prims: upper lip y 1.6403 (hs -0.899), lower
    1.6304 (hs -1.009), a bow at the top; corners at hs x +-0.275.
    NOTE: the lips are PAINTED prims (color=b4a6bc), and a painted prim's
    albedo overwrites the sheet (paint-char.wgsl runs after the face pass), so
    this only greys the skin margin round the lips. Same for the sclera, iris
    and socket ovals: the sheet cannot darken them, which is why the smoke
    below is placed on the skin AROUND them."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    n = 32
    top, bot = [], []
    for i in range(n + 1):
        t = -1 + 2 * i / n
        x = t * MOUTH_HALF_W
        env = (1 - t * t) ** 0.6
        bow = 0.018 * math.exp(-((abs(t) - 0.28) / 0.16) ** 2)
        top.append(px(x, MOUTH_Y + 0.105 * env + bow))
        bot.append(px(x, MOUTH_Y - 0.115 * env))
    d.polygon(top + list(reversed(bot)), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(hs_len(0.012)))
    # The parting line between the lips, a little darker.
    p = Image.new("L", (W, W), 0)
    stroke(ImageDraw.Draw(p), [px(t * MOUTH_HALF_W * 0.95, MOUTH_Y - 0.004 * (1 - t * t))
                               for t in [-1 + 2 * i / 24 for i in range(25)]],
           hs_len(0.006), hs_len(0.006))
    m = ImageChops.lighter(m, p)
    return recolour(m, LIP, 0.7)


def sutures(rng: random.Random) -> Image.Image:
    """From each mouth corner a fine line (2 px at 512) arcing back and up
    toward the ear (~110 px), with ~9 cross-stitches perpendicular to it."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    for s, _ in eyes():
        # corner (0.27, -0.95) -> (0.52, -0.90) -> (0.78, -0.74): ~0.55 hs,
        # 112 px at 512.
        def at(t):
            x = 0.27 + 0.51 * t
            y = MOUTH_Y + 0.01 + 0.20 * t * t + 0.03 * t
            return x, y
        pts = [px(s * at(i / 30)[0], at(i / 30)[1]) for i in range(31)]
        stroke(d, pts, 2.0 * SS, 1.6 * SS)
        for k in range(9):
            t = 0.07 + 0.88 * k / 8 + rng.uniform(-0.02, 0.02)
            (x0, y0), (x1, y1) = at(t), at(t + 0.01)
            nx, ny = -(y1 - y0), (x1 - x0)
            ln = math.hypot(nx, ny)
            half = 0.030 * rng.uniform(0.85, 1.15)
            skew = rng.uniform(-0.25, 0.25)
            ax, ay = x0 + (nx / ln) * half + skew * (x1 - x0) * 3, y0 + (ny / ln) * half
            bx, by = x0 - (nx / ln) * half, y0 - (ny / ln) * half
            stroke(d, [px(s * ax, ay), px(s * bx, by)], 1.8 * SS, 1.8 * SS)
    return recolour(m, STITCH, 0.92)


def veins(rng: random.Random) -> Image.Image:
    """2-3 faint blue branching polylines at each temple, alpha ~0.25."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)

    def branch(x, y, ang, length, width, depth, s):
        pts = [(x, y)]
        for _ in range(6):
            ang += rng.uniform(-0.35, 0.35)
            x += math.cos(ang) * length / 6
            y += math.sin(ang) * length / 6
            pts.append((x, y))
        stroke(d, [px(s * a, b) for a, b in pts], width, width * 0.5)
        if depth > 0:
            k = rng.randint(2, 4)
            branch(pts[k][0], pts[k][1], ang + rng.choice((-0.8, 0.8)), length * 0.55,
                   width * 0.7, depth - 1, s)

    for s, _ in eyes():
        for _ in range(rng.randint(2, 3)):
            branch(0.78 + rng.uniform(-0.04, 0.04), -0.05 + rng.uniform(-0.05, 0.12),
                   rng.uniform(-0.9, 0.3), 0.20, 1.6 * SS, 1, s)
    m = m.filter(ImageFilter.GaussianBlur(0.8 * SS))
    return recolour(m, VEIN, 0.25)


def almond_mask() -> Image.Image:
    """The sclera almonds (slightly shrunk and feathered), for clearing."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    for s, _ in eyes():
        up = [almond_edge(i / 24, True) for i in range(25)]
        lo = [almond_edge(i / 24, False) for i in range(25)]
        poly = [px(s * x, y - 0.006) for x, y in up] + [px(s * x, y + 0.008) for x, y in reversed(lo)]
        d.polygon(poly, fill=255)
    return m.filter(ImageFilter.GaussianBlur(hs_len(0.008)))


def lash_line(t: float) -> tuple[float, float]:
    """The upper lash line, t 0 inner -> 1 outer (positive-x eye): the lid
    prim's lower edge, which sits a hair below the almond's top."""
    x, y = almond_edge(t, True)
    return x, min(y, LASH_Y + 0.02 * t) - 0.004


def liner() -> Image.Image:
    """Thick black along each lash line, thin at the inner corner, thickening
    toward the outer corner, ending in a short upswept wing. Alpha ~0.9."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    for s, _ in eyes():
        pts = [lash_line(0.05 + 0.95 * i / 30) for i in range(31)]
        ox, oy = pts[-1]
        wing = [(ox + 0.10 * t, oy + 0.02 + 0.08 * t) for t in [i / 8 for i in range(1, 9)]]
        line = pts + wing
        n = len(line)
        for k in range(n - 1):
            t = k / (n - 1)
            # thickness: 0.012 hs at the inner corner -> 0.040 near the outer
            # corner -> tapering to a point along the wing.
            # 0.016 hs at the inner corner -> 0.055 (~4.5 px at 512, ~4 mm)
            # at the outer corner -> a point along the wing. The first pass
            # peaked at 0.040 and read as a thin line even in the close-up.
            w = 0.016 + 0.039 * min(1.0, t / 0.72) if t < 0.72 else 0.055 * (1 - (t - 0.72) / 0.28) + 0.004
            (xa, ya), (xb, yb) = line[k], line[k + 1]
            # Weight the stroke UP (onto the lid), so the sclera stays clear.
            stroke(d, [px(s * xa, ya + w * 0.35), px(s * xb, yb + w * 0.35)], hs_len(w), hs_len(w))
    m = m.filter(ImageFilter.GaussianBlur(0.6 * SS))
    return recolour(m, INK, 0.9)


def lashes(rng: random.Random) -> Image.Image:
    """~14 fine tapered strokes per upper lash line (2 px root -> 0 tip),
    fanning up and out, longest and most curled at the outer corner; ~6 short
    ones on each lower lid."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    for s, _ in eyes():
        for i in range(14):
            t = 0.08 + 0.90 * i / 13 + rng.uniform(-0.015, 0.015)
            x0, y0 = lash_line(t)
            y0 += 0.012
            length = (0.065 + 0.090 * t ** 1.5) * rng.uniform(0.9, 1.1)
            ang = math.radians(100 - 70 * t + rng.uniform(-5, 5))  # up, fanning out
            curl = math.radians(-(10 + 45 * t))                   # curls outward
            pts = []
            for k in range(9):
                f = k / 8
                a = ang + curl * f * f
                pts.append((x0 + math.cos(a) * length * f, y0 + math.sin(a) * length * f))
            stroke(d, [px(s * a, b) for a, b in pts], 2.2 * SS, 0.2 * SS)
        for i in range(6):
            t = 0.35 + 0.60 * i / 5
            x0, y0 = almond_edge(t, False)
            y0 -= 0.006
            length = (0.025 + 0.030 * t) * rng.uniform(0.85, 1.15)
            ang = math.radians(-80 - 35 * t + rng.uniform(-6, 6))  # down and out
            pts = [(x0 + math.cos(ang) * length * f, y0 + math.sin(ang) * length * f)
                   for f in (0, 0.5, 1.0)]
            stroke(d, [px(s * a, b) for a, b in pts], 1.6 * SS, 0.2 * SS)
    return recolour(m, INK, 1.0)


def runs(rng: random.Random) -> Image.Image:
    """Running mascara: one or two thin wavering streaks per eye from the
    lower lid down the cheek, fading out over ~60-90 px, uneven left/right.
    Returns the streak layer; the fade is baked into its alpha."""
    out = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    for s, _ in eyes():
        count = 2 if s > 0 else 1 + rng.randint(0, 1)
        for j in range(count):
            m = Image.new("L", (W, W), 0)
            d = ImageDraw.Draw(m)
            t = rng.uniform(0.35, 0.55) if j == 0 else rng.uniform(0.70, 0.82)
            x, y = almond_edge(t, False)
            y -= 0.010
            length_px = rng.uniform(60, 90)
            length = length_px * SS / (PROJ_SCALE_Y * W)
            pts = []
            steps = 24
            phase = rng.uniform(0, math.tau)
            for k in range(steps + 1):
                f = k / steps
                wob = 0.012 * math.sin(phase + f * 7.0) * f + 0.03 * f * f
                pts.append((x + wob, y - length * f))
            w0 = rng.uniform(2.6, 3.0) * SS
            n = len(pts)
            for k in range(n - 1):
                f = k / (n - 1)
                val = int(255 * (1.0 - f) ** 1.3)
                (xa, ya), (xb, yb) = pts[k], pts[k + 1]
                r = w0 * (1.0 - 0.45 * f)
                # a small drip bead part way down
                stroke(d, [px(s * xa, ya), px(s * xb, yb)], r, r, fill=val)
            bead = pts[int(n * 0.55)]
            bx, by = px(s * bead[0], bead[1])
            br = w0 * 0.9
            d.ellipse([bx - br, by - br * 1.3, bx + br, by + br * 1.3], fill=150)
            # A SMUDGE under the streak: a wide, soft grey wash (~10 px) at
            # alpha ~0.35 around the thin core. The 2-3 px core is the tear
            # line at 1 m; the smudge is what still reads at 3 m, where the
            # core is ~1 mm and sub-pixel.
            # sigma 7 px at 512 -> a track ~20 px (~7 mm) wide: one screen
            # pixel at 3 m in the lab frame is ~9 mm of face, so anything
            # narrower is gone there. The first smudge (sigma 4, alpha 0.35)
            # did not register at 3 m.
            smudge = m.filter(ImageFilter.GaussianBlur(7.0 * SS))
            smudge = smudge.point(lambda v, k=255.0 / max(1, smudge.getextrema()[1]): min(255, int(v * k)))
            out = Image.alpha_composite(out, recolour(smudge, INK, 0.45))
            m = m.filter(ImageFilter.GaussianBlur(0.7 * SS))
            out = Image.alpha_composite(out, recolour(m, INK, 0.92))
    return out


def base() -> Image.Image:
    """Neutral grey over the face, alpha 1 inside a soft oval (hs centre
    (0, -0.40), semi-axes 1.12 x 1.05, feathered over the last ~0.2), rgb grey
    everywhere so the relief sees no edge. See HOW IT BLENDS."""
    m = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(m)
    cx, cy = px(0.0, -0.40)
    rx, ry = hs_len(1.12), hs_len(1.05)
    steps = 24
    for i in range(steps):
        f = 1.0 - i / steps                      # 1 at the rim -> 0 inside
        val = 255 if f <= 0.8 else int(255 * (1.0 - f) / 0.2)
        d.ellipse([cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f], fill=val)
    m = m.filter(ImageFilter.GaussianBlur(hs_len(0.05)))
    im = Image.new("RGBA", (W, W), (BASE_GREY, BASE_GREY, BASE_GREY, 0))
    im.putalpha(m)
    return im


def over(dst: Image.Image, src: Image.Image) -> Image.Image:
    """Composite src over dst but keep dst's ALPHA: makeup changes the colour
    of the base, never its coverage (a stroke outside the base oval is
    clipped rather than painting a stray opaque texel)."""
    a = dst.getchannel("A")
    rgb = dst.copy()
    rgb.putalpha(255)
    rgb = Image.alpha_composite(rgb, src)
    rgb.putalpha(a)
    return rgb


def main() -> int:
    rng = random.Random(24)
    img = base()
    img = over(img, sockets())
    img = over(img, lids())
    hol, hi = hollows()
    img = over(img, hol)
    img = over(img, hi)
    img = over(img, lips())
    img = over(img, sutures(rng))
    img = over(img, veins(rng))
    # Clear the sclera back to the base: the eyes stay white.
    clean = base()
    clean.putalpha(255)
    keep_a = img.getchannel("A")
    img.putalpha(255)
    img = Image.composite(clean, img, almond_mask())
    img.putalpha(keep_a)
    img = over(img, liner())
    img = over(img, lashes(rng))
    img = over(img, runs(rng))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, optimize=True)

    # The mean the shader divides by: luma of every texel with alpha >= 8,
    # exactly as lab-main applyMeanOf measures it. The registry declares it
    # for the game (which does not measure).
    px_ = out.load()
    n, acc = 0, 0.0
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px_[x, y]
            if a >= 8:
                n += 1
                acc += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    mean = acc / n if n else 1.0
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    print(f"covered texels (a>=8): {n}/{SIZE * SIZE} = {100.0 * n / (SIZE * SIZE):.1f}%")
    print(f"mean luma (the shader's divisor): {mean:.6f}")
    print(f"base multiplies by {BASE_GREY / 255.0 / mean:.3f}; ink by {0.0327 / mean:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
