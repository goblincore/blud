#!/usr/bin/env python3
"""Bake a character's face DECAL from its reference mesh.

    npm run blob:face-bake -- <name> [--head-frac 0.165] [--front -z] [--size 512]

Reads docs/dev-notes/refs/<name>-mesh/<name>.glb, takes every triangle whose
three vertices sit in the top <head-frac> of the figure's height, and renders
them orthographically from the front with their own texture, z-buffered.
Writes public/assets/lab/faces/<name>-face.png: RGBA, square, alpha 0 off the
head. A `.blob` then wears it with

    sheet
      image <name>-face.png
      decal 1

Why bake rather than lift: these meshes carry a fragmented atlas (hundreds of
scattered patches, no face island), so there is nothing to crop. The bake is
what the mesh LOOKS like from the front, which is exactly the painted-on PSX
face the decal mode pastes. It is flat and lit once, deliberately.

Pure numpy + Pillow (both already used by scripts/vision-ask.py); no GPU.
"""
import argparse, json, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('name')
ap.add_argument('--head-frac', type=float, default=0.165,
                help='fraction of the figure height, from the top, that is head')
ap.add_argument('--front', default='+z', choices=['+z', '-z'],
                help='which way the mesh faces (glTF convention is +z)')
ap.add_argument('--size', type=int, default=512)
ap.add_argument('--out')
ap.add_argument('--eye-band', type=float, default=0.55,
                help="How far down the covered face --eye-glow will look for "
                     "eyes, as a fraction. Default 0.55 because an open mouth "
                     "is red as well: on the soldier the eyes sit at 40-50%% and "
                     "the mouth at 65-100%%, so anything in 0.5-0.6 splits them.")
ap.add_argument('--eye-grow', type=int, default=2,
                help="Dilate the eye mask by this many texels. The source red is "
                     "sparse and the shader samples NEAREST, so an undilated mask "
                     "reads as specks rather than eyes. 0 disables.")
ap.add_argument('--eye-soft', type=int, default=4,
                help="Blur passes on the eye mask, so the glow reads as a light "
                     "with a bright centre rather than a hard red sticker. 0 "
                     "gives the old binary punch.")
ap.add_argument('--grey', action='store_true',
                help="Bake a GREYSCALE MODULATION MAP instead of a colour decal. "
                     "The colour bake is meant for `decal 1` (replace the albedo); "
                     "under `decal 0` (multiply) a full-colour skin bake tints as "
                     "well as shades, which reads warm and orange. Luma modulates "
                     "only, which is how the zombie's face has always worked.")
ap.add_argument('--eye-glow', action='store_true',
                help="Punch red-dominant texels to white so the shader's glow mask "
                     "(smoothstep(eyeGlowCut, 1, luma)) catches them. The source "
                     "mesh paints its eyes red, so this finds them without hand-"
                     "placed coordinates. Only meaningful with --grey: a colour "
                     "bake's eyes are already red but sit BELOW the cut (the "
                     "soldier's max luma is 0.855 against a 0.88 default), which is "
                     "why nothing glowed.")
a = ap.parse_args()

root = Path(__file__).resolve().parent.parent
glb = root / 'docs/dev-notes/refs' / f'{a.name}-mesh' / f'{a.name}.glb'
out = Path(a.out) if a.out else root / 'public/assets/lab/faces' / f'{a.name}-face.png'
if not glb.exists():
    sys.exit(f'no mesh at {glb}')

d = glb.read_bytes()
ln = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20 + ln])
off = 20 + ln
bl = struct.unpack('<I', d[off:off + 4])[0]
bin_ = d[off + 8:off + 8 + bl]

def acc(i):
    ac = j['accessors'][i]; bv = j['bufferViews'][ac['bufferView']]
    ct = {5126: 'f4', 5123: 'u2', 5125: 'u4', 5121: 'u1'}[ac['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[ac['type']]
    st = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
    return np.frombuffer(bin_, dtype=ct, count=ac['count'] * n, offset=st).reshape(ac['count'], n)

# Gather every textured primitive across every mesh (bind pose, node
# transforms ignored -- same simplification as gltfTriangles in silhouette.ts).
P, U, T, IMG = [], [], [], []
base = 0
for me in j['meshes']:
    for pr in me['primitives']:
        if 'TEXCOORD_0' not in pr['attributes']:
            continue
        mat = j['materials'][pr['material']]
        ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
        img = j['images'][j['textures'][ti]['source']]
        bv = j['bufferViews'][img['bufferView']]
        raw = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        import io
        IMG.append(np.asarray(Image.open(io.BytesIO(raw)).convert('RGB')))
        pos = acc(pr['attributes']['POSITION']).astype(np.float64)
        idx = acc(pr['indices']).reshape(-1, 3).astype(np.int64) + base
        P.append(pos); U.append(acc(pr['attributes']['TEXCOORD_0']).astype(np.float64))
        T.append(np.concatenate([idx, np.full((len(idx), 1), len(IMG) - 1)], 1))
        base += len(pos)
pos = np.concatenate(P); uv = np.concatenate(U); tri = np.concatenate(T)

ymax = pos[:, 1].max(); h = ymax - pos[:, 1].min()
head = pos[:, 1] > ymax - a.head_frac * h
tris = tri[head[tri[:, :3]].all(1)]
print(f'{len(tris)} head triangles (y > {ymax - a.head_frac * h:.3f} of {h:.3f} tall)')

sign = 1.0 if a.front == '+z' else -1.0
R = a.size
Pt = pos[tris[:, :3]]
sx = Pt[:, :, 0] * sign; sy = Pt[:, :, 1]; dz = Pt[:, :, 2] * sign
xmin, xmax = sx.min(), sx.max(); ymin, ymax = sy.min(), sy.max()
span = max(xmax - xmin, ymax - ymin)
s = (R - 2) / span
# centre the head in the square
cx = (xmin + xmax) / 2; cy = (ymin + ymax) / 2
X = (sx - cx) * s + R / 2; Y = (cy - sy) * s + R / 2
Ut = uv[tris[:, :3]]
img = np.zeros((R, R, 4), np.uint8); zb = np.full((R, R), -1e9)
for t in range(len(tris)):
    x = X[t]; y = Y[t]; z = dz[t]; u = Ut[t]; atlas = IMG[tris[t, 3]]; AW = atlas.shape[1]; AH = atlas.shape[0]
    x0, x1 = int(max(0, x.min())), int(min(R - 1, np.ceil(x.max())))
    y0, y1 = int(max(0, y.min())), int(min(R - 1, np.ceil(y.max())))
    if x1 < x0 or y1 < y0: continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    det = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])
    if abs(det) < 1e-9: continue
    l1 = ((gx - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (gy - y[0])) / det
    l2 = ((x[1] - x[0]) * (gy - y[0]) - (gx - x[0]) * (y[1] - y[0])) / det
    l0 = 1 - l1 - l2
    m = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
    if not m.any(): continue
    zz = l0 * z[0] + l1 * z[1] + l2 * z[2]
    sub = zb[y0:y1 + 1, x0:x1 + 1]; m &= zz > sub
    uu = l0 * u[0, 0] + l1 * u[1, 0] + l2 * u[2, 0]
    vv = l0 * u[0, 1] + l1 * u[1, 1] + l2 * u[2, 1]
    # glTF uv origin is TOP-left: no V flip.
    # REPEAT-wrapped UVs (values outside 0..1) must be wrapped, not clipped --
    # clipping smears the atlas edge across the face in streaks (the female
    # head's v runs -0.994..-0.007, its hair/eyes sit at |uv| ~16).
    uu = uu % 1.0; vv = vv % 1.0
    px = np.clip((uu * AW).astype(int), 0, AW - 1); py = np.clip((vv * AH).astype(int), 0, AH - 1)
    col = np.concatenate([atlas[py, px], np.full(px.shape + (1,), 255, np.uint8)], -1)
    sub[m] = zz[m]; img[y0:y1 + 1, x0:x1 + 1][m] = col[m]

eye_n = 0
if a.grey:
    rgb = img[:, :, :3].astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    if a.eye_glow:
        # Red-dominant AND bright enough to be a lit eye rather than a shadow.
        cov = img[:, :, 3] > 8
        red = (r > 90) & (r > g * 1.7) & (r > b * 1.7) & cov
        # POSITION GATE, and it is not optional: the inside of an open mouth is
        # red too. Measured on the soldier, the split is unambiguous -- eye
        # texels land 40-50% down the covered face (758 of them) and the mouth
        # 65-100% (about 1100). Without this the whole jaw glows, which is a
        # different character.
        yy = np.arange(img.shape[0])[:, None] * np.ones((1, img.shape[1]))
        cy = np.where(cov)[0]
        if cy.size:
            top, bot = cy.min(), cy.max()
            red &= (yy - top) < (bot - top) * a.eye_band
        # DILATE. The red texels are scattered through the eye region rather
        # than solid, and the shader samples NEAREST (PSX texels, no blur), so
        # undilated they render as a handful of specks instead of two eyes.
        # Grown by --eye-grow texels with a square structuring element, which
        # is enough to close the gaps without reaching the brow.
        eyes = red
        for _ in range(max(0, a.eye_grow)):
            e = eyes
            eyes = (e
                    | np.roll(e, 1, 0) | np.roll(e, -1, 0)
                    | np.roll(e, 1, 1) | np.roll(e, -1, 1))
        eyes &= cov
        eye_n = int(eyes.sum())
        # SOFT, WITH A HOT CENTRE. A binary punch to white gives hard-edged
        # blobs; blurring the mask and using it to lerp toward white gives a
        # core that clears eyeGlowCut and edges that fall under it, so the
        # shader's own smoothstep does the falloff. That reads as a glowing
        # light rather than a red sticker. --eye-soft 0 restores the hard punch.
        soft = eyes.astype(np.float32)
        for _ in range(max(0, a.eye_soft)):
            soft = (soft
                    + np.roll(soft, 1, 0) + np.roll(soft, -1, 0)
                    + np.roll(soft, 1, 1) + np.roll(soft, -1, 1)) / 5.0
        if a.eye_soft > 0 and soft.max() > 0:
            # Renormalise so the centre still reaches white after blurring,
            # then bias with a gamma < 1 to keep the core broad and the
            # shoulder quick -- a raw gaussian is too dim to clear the cut.
            soft = np.clip(soft / soft.max(), 0, 1) ** 0.55
        lum = lum * (1 - soft) + 255.0 * soft
    v = np.clip(lum, 0, 255).astype(np.uint8)
    img = np.dstack([v, v, v, img[:, :, 3]])

out.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(img).save(out)
if a.grey:
    cov_m = img[:, :, 3] > 8
    ml = (img[:, :, 0][cov_m] / 255.0).mean() if cov_m.any() else 0.0
    print(f'  greyscale modulation map, mean luma {ml:.3f}'
          + (f', {eye_n} eye texels punched to white' if a.eye_glow else ''))
cov = (img[:, :, 3] > 0).mean()
print(f'wrote {out.relative_to(root)} ({R}x{R}, {cov:.0%} covered, head {xmax - xmin:.3f} wide x {ymax - ymin:.3f} tall)')

# HOW TO WEAR IT. Printed because every character authored so far started with
# the face far too small and needed it enlarged by hand.
#
# DEFAULT_SHEET's projScaleX/Y are 0.45/0.58, and those are RIGHT for the
# generated 64x64 sheet, where the drawn face fills the texture -- five
# characters rely on them. They are wrong by about 2.4x for a BAKED face, which
# occupies part of a 512-square atlas surrounded by alpha. Both characters
# tuned against a render converged near 0.19 / 0.22 instead: the soldier at
# 0.180/0.200 and the Widow at 0.19/0.23.
#
# projScale is uv-per-unit-head-space -- a FREQUENCY, so LOWER means a BIGGER
# face. That is the other half of why it kept coming out small: the number
# reads backwards.
aspect = (ymax - ymin) / max(xmax - xmin, 1e-6)
sx = 0.19
sy = round(sx * (1.15 if aspect < 1 else 1.25), 3)
print()
print('  paste into the character\'s sheet block, then tune on a render:')
print(f'    image       {out.name}')
print('    decal       0            # MULTIPLY -- the face takes the body\'s light')
print(f'    projScaleX  {sx}         # lower = BIGGER face')
print(f'    projScaleY  {sy}')
print('    projCentreX 0.50')
print('    projCentreY 0.47')
print('    eyeGlowCut  0.70         # must sit BELOW the bake\'s max luma or nothing glows')
