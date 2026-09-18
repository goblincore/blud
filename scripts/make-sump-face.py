#!/usr/bin/env python3
"""Generate public/assets/lab/faces/sump-face.png — the Sump's hand-authored
face decal (the gargoyle road: no reference mesh to bake, so the face's value
contrast is painted, worn at MULTIPLY).

The canvas is ALPHA-MASKED: transparent everywhere except the facial shading
(brow shadow, eye pits, nose shading, folds, mouth, sagging cheek), so the
rest of the skin keeps the palette's own mottle.

Feature positions are derived from the head geometry in
src/lab/sdf-zombie/characters/sump.blob: world offsets from the cranium
centre (0, 2.024, 0.522), divided by its semi-axes (0.109, 0.115, 0.121),
mapped through the sheet block's projScale (0.19, 0.22) and projCentre
(0.50, 0.47), with three.js flipY putting uv.y 0 at the image BOTTOM.

Prints the alpha-weighted mean (the number the registry's FaceSheet carries;
the face step re-measures off the decoded pixels, this is the declared one).
"""
from PIL import Image, ImageDraw, ImageFilter
import math

S = 4  # supersample factor
W = H = 512 * S

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def px(u, v):
    """uv (0..1, y down after flipY) -> supersampled pixel col."""
    return u * W, (1.0 - v) * H

def hs(x, y):
    """head-space (world offset / semi-axis) -> uv via the sheet block."""
    return 0.50 + x * 0.19, 0.47 + y * 0.22

def ell(x, y, rx, ry, fill, blur=0):
    """soft ellipse at head-space (x, y) with head-space radii."""
    u, v = hs(x, y)
    ru, rv = rx * 0.19, ry * 0.22
    bbox = [(u - ru) * W, (1 - (v + rv)) * H, (u + ru) * W, (1 - (v - rv)) * H]
    if blur == 0:
        d.ellipse(bbox, fill=fill)
        return
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(bbox, fill=fill)
    layer = layer.filter(ImageFilter.GaussianBlur(blur * S))
    img.alpha_composite(layer)

# ---- neutral base: the oval of face the decal covers. Its luma is what the
# mean normalisation (below) pins to detail 1.0, so the base does not shift
# the face's level against the body; only the features deviate.
ell(+0.02, -0.05, 1.75, 1.55, (128, 126, 122, 255), blur=30)

# ---- brow shadow: low heavy brow, heavier over the +x eye ------------------
ell(+0.50, 0.708, 0.34, 0.14, (38, 33, 30, 190), blur=6)
ell(-0.46, 0.708, 0.30, 0.13, (48, 42, 38, 160), blur=6)

# ---- eye pits: dark crater, darker lid on top, pale glint at the eyeball ---
for ex, ey, pit, glint in ((+0.50, 0.42, (20, 16, 14), (196, 188, 172)),
                           (-0.46, 0.35, (24, 20, 17), (188, 180, 164))):
    ell(ex, ey - 0.05, 0.26, 0.13, (14, 11, 10, 235), blur=3)   # lid shadow
    ell(ex, ey, 0.235, 0.155, pit + (235,), blur=2)             # pit
    u, v = hs(ex + 0.02, ey - 0.02)
    r = 5 * S
    d.ellipse([(u) * W - r, (1 - v) * H - r, (u) * W + r, (1 - v) * H + r],
              fill=glint + (255,))                               # eyeball glint

# under-eye bags
ell(+0.50, 0.23, 0.24, 0.07, (66, 58, 52, 120), blur=5)
ell(-0.46, 0.22, 0.22, 0.06, (74, 66, 60, 100), blur=5)

# ---- crushed nose: bright broken bridge, dark flanks, nostril dots ---------
ell(0.10, 0.19, 0.10, 0.24, (152, 144, 136, 90), blur=4)       # bridge light
ell(0.13, 0.25, 0.045, 0.09, (176, 166, 154, 110), blur=2)     # broken bump
ell(-0.03, 0.07, 0.085, 0.22, (52, 45, 40, 150), blur=5)       # -x flank
ell(0.24, 0.07, 0.075, 0.20, (62, 54, 48, 130), blur=5)        # +x flank
for nx in (0.02, 0.19):
    ell(nx, -0.07, 0.035, 0.045, (22, 17, 15, 220), blur=1)     # nostrils

# ---- nasolabial folds: deeper on the sagging -x side ----------------------
ell(-0.30, -0.18, 0.07, 0.24, (58, 50, 46, 150), blur=4)
ell(+0.34, -0.18, 0.06, 0.20, (70, 62, 56, 110), blur=4)

# ---- mouth: crooked dark line (the geometry bar sits here too) -------------
ell(+0.09, -0.58, 0.30, 0.055, (34, 19, 17, 215), blur=2)       # main line
ell(-0.22, -0.56, 0.14, 0.045, (52, 30, 26, 170), blur=2)      # -x tail, drier
ell(+0.09, -0.65, 0.24, 0.035, (120, 70, 62, 90), blur=3)       # raw lower lip

# ---- sagging -x cheek: drooping shadow with a plum cast --------------------
ell(-0.55, -0.43, 0.34, 0.42, (74, 60, 70, 105), blur=10)
ell(-0.55, -0.25, 0.28, 0.10, (128, 116, 110, 70), blur=5)      # fold above it

# ---- forehead creases ------------------------------------------------------
for fy, alpha in ((0.99, 55), (1.11, 45)):
    ell(+0.05, fy, 0.40, 0.035, (92, 85, 78, alpha), blur=4)

# ---- grime speckle around brows and cheeks --------------------------------
import random
random.seed(7)
for _ in range(260):
    gx = random.uniform(-1.1, 1.1)
    gy = random.uniform(-1.0, 0.9)
    if abs(gx) < 0.2 and -0.5 < gy < 0.3:
        continue  # keep the mid-face clean
    a = random.randint(12, 34)
    ell(gx, gy, random.uniform(0.02, 0.07), random.uniform(0.02, 0.06),
        (58, 52, 46, a), blur=1)

img = img.resize((512, 512), Image.LANCZOS)
img.save('public/assets/lab/faces/sump-face.png')

# Normalise so the BASE luma maps to detail 1.0: the shader multiplies
# albedo by tex.rgb / mean, so if the mean sits at the base's luma the base
# is a no-op and only features deviate (darken/brighten) from the body.
def measure(im):
    pxl = im.load()
    total = 0.0
    weight = 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = pxl[x, y]
            if a < 8:
                continue
            total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            weight += 1
    return total / weight if weight else 1.0

BASE_LUMA = (0.2126 * 128 + 0.7152 * 126 + 0.0722 * 122) / 255.0
m0 = measure(img)
f = BASE_LUMA / m0
px_img = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = px_img[x, y]
        if a == 0:
            continue
        px_img[x, y] = (min(255, round(r * f)), min(255, round(g * f)),
                        min(255, round(b * f)), a)

# alpha-weighted mean, in the SAME space the shader reads: the sheet is used
# sRGB-encoded (march.wgsl.ts: "Not linearised, deliberately"), and the lab's
# applyMeanOf measures the sRGB luma (0.2126R+0.7152G+0.0722B)/255 over
# alpha >= 8 texels. Match it exactly — this is the declared registry mean.
px_img = img.load()
total = 0.0
weight = 0
for y in range(512):
    for x in range(512):
        r, g, b, a = px_img[x, y]
        if a < 8:
            continue
        total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        weight += 1
mean = total / weight if weight else 1.0
print(f'wrote public/assets/lab/faces/sump-face.png  sRGB luma mean = {mean!r}')
