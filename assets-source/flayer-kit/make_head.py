# The flayer's helmet: a bony casing over the upper head with a glowing visor slit (the owner's reference figure's
# visor head), the flayed jaw left bare beneath it. Run after kit_sculpt.py + butcher_common.py (../butcher-kit/build.py).
# Fitted to the flesh head by probe (march sdBody along rays, flayer.blob): crown y 1.832 at z 0.13; face front
# z 0.248 at y 1.64-1.70, 0.242 at 1.73, 0.226 at 1.76; back z 0.025-0.031; sides x 0.090 at y 1.70.
#   helmet - an ellipsoid shell (centre (0, 1.700, 0.136), semi 0.104 x 0.150 x 0.128: 10-16 mm clear of the skin)
#            cut along a rim that sits just under the nose at the front, sweeps down into cheek guards and lower at
#            the back; a crest, chevron ribs, a brow ledge over the visor, curled horn "ears", rivets, sutures;
#   visor  - a curved slit across the eye row (y 1.718), `led` (glows orange-red), framed by a rolled lip.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'helmet', 'visor'}

HC = Vector((0.0, 1.700, 0.136)); SEMI = Vector((0.104, 0.150, 0.128))
EYE_Y = 1.718
g = lambda x, c, w: math.exp(-((x - c) / w) ** 2)


def rim_y(ph):                                           # ph 0 = front (+z), +-pi = back
    a = abs(math.atan2(math.sin(ph), math.cos(ph)))
    return 1.676 - 0.058 * ((1 - math.cos(a)) / 2) ** 0.7 - 0.030 * g(a, math.radians(70), math.radians(18))


def ell(th, ph, grow=0.0):
    """Blob-coord point on the helmet ellipsoid: th from the crown (+y), ph round it (0 = front)."""
    return (HC[0] + (SEMI[0] + grow) * math.sin(th) * math.sin(ph),
            HC[1] + (SEMI[1] + grow) * math.cos(th),
            HC[2] + (SEMI[2] + grow) * math.sin(th) * math.cos(ph))


def th_at(y, grow=0.0):
    return math.acos(max(-1.0, min(1.0, (y - HC[1]) / (SEMI[1] + grow))))


if 'helmet' in PARTS:
    drop(['skull|helmet']); clear_work()

    def P(u, v):
        ph = 2 * math.pi * v - math.pi
        th = th_at(rim_y(ph)) * u
        return bv(*ell(max(th, 1e-3), ph))

    def N(u, v):
        p = P(u, v); c = bv(*HC); return (p - c).normalized()
    surface_solid('shell', P, N, 36, 120, 0.010, closed_v=True)
    tube('rimlip', [P(1, i / 160) - N(1, i / 160) * 0.004 for i in range(162)], [0.0065] * 162, segs=10)
    S = [i / 50 for i in range(51)]
    # sagittal crest from the brow over the crown to the nape: a in (-1.05, 1.55), front for a < 0, back after
    def mid(a, grow):
        return bv(*ell(abs(a) + 1e-3, 0.0 if a < 0 else math.pi, grow))
    A = [-1.05 + 2.6 * s for s in S]
    tube('crest', [mid(a, 0.004) for a in A], [0.004 + 0.007 * sn(s) for s in S])
    tube('crest2', [mid(a, 0.004 + 0.012 * sn(s) ** 0.5) for a, s in zip(A, S)], [0.0015 + 0.004 * sn(s) for s in S])
    # chevron ribs raking down and back from the crest over each side
    for side in (1, -1):
        for k, th0 in enumerate((0.35, 0.55, 0.75, 0.95)):
            R = [i / 20 for i in range(21)]
            tube(f'rib{side}{k}', [bv(*ell(th0 + 0.45 * u, side * (0.25 + 1.6 * u ** 0.9), 0.001)) for u in R],
                 [0.0022 + 0.0032 * sn(u) for u in R], segs=8)
    # brow ledge over the visor
    R = [i / 40 for i in range(41)]
    tube('brow', [bv(*ell(th_at(EYE_Y + 0.024), -1.0 + 2.0 * u, 0.006)) for u in R], [0.006 + 0.006 * sn(u) for u in R])
    # horn "ears": curled back from the temples
    for side in (1, -1):
        base = bv(*ell(th_at(1.735), side * math.radians(95), 0.004))
        horn(f'ear{side}', base, bv(side * 0.5, 0.35, -1.0), bv(0, 1, 0) * -side, 0.09, 0.016, curl=1.1)
        for k, y in enumerate((1.69, 1.66)):           # rivets on the cheek guards
            ball(f'riv{side}{k}', bv(*ell(th_at(y), side * math.radians(62), 0.002)), 0.0055)
    # a hose socket at the nape (the neck hose goes into it)
    ball('socket', bv(*ell(th_at(1.645), math.pi, 0.004)), 1.0, 0.020, 0.020, 0.016)
    sut = [zigzag(lambda s, sd=sd: bv(*ell(0.35 + 0.6 * s, sd * 1.2, 0.0)), 0.004, 8, lambda s: bv(0, 1, 0)) for sd in (1, -1)]
    o = fuse('helmet'); press_lines(o, sut); decimate(o, 9000); bake_ao(o); install(o, 'skull|helmet'); clear_work()

if 'visor' in PARTS:
    drop(['skull|visor', 'skull|visorframe']); clear_work()
    PH = math.radians(58); H = 0.011
    NU, NV = 8, 48
    from mathutils import Vector as V3
    import bmesh
    bm = bmesh.new(); G = []
    for i in range(NU + 1):
        y = EYE_Y - H + 2 * H * i / NU
        row = []
        for j in range(NV + 1):
            ph = -PH + 2 * PH * j / NV
            y2 = y + 0.004 * math.cos(ph * 1.6)           # a slight scowl: the slit dips toward the temples
            row.append((bm.verts.new(bv(*ell(th_at(y2, 0.004), ph, 0.004))), bm.verts.new(bv(*ell(th_at(y2, -0.004), ph, -0.004)))))
        G.append(row)
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((G[i][j][0], G[i][j + 1][0], G[i + 1][j + 1][0], G[i + 1][j][0]))
            bm.faces.new((G[i + 1][j][1], G[i + 1][j + 1][1], G[i][j + 1][1], G[i][j][1]))
    for i in range(NU):
        for j in (0, NV):
            bm.faces.new((G[i][j][0], G[i + 1][j][0], G[i + 1][j][1], G[i][j][1]))
    for j in range(NV):
        for i in (0, NU):
            bm.faces.new((G[i][j][0], G[i][j][1], G[i][j + 1][1], G[i][j + 1][0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    vis = mkobj('visor', bm); plain(vis, 'led'); install(vis, 'skull|visor'); clear_work()
    outline = []
    for k in range(97):
        a = 2 * math.pi * k / 96
        ph = PH * 1.06 * math.cos(a); y = EYE_Y + (H + 0.004) * math.sin(a) + 0.004 * math.cos(ph * 1.6)
        outline.append(bv(*ell(th_at(y, 0.008), ph, 0.008)))
    tube('frame', outline, [0.0055] * len(outline), segs=10)
    o = fuse('visorframe', voxel=0.0014, smooth=(0.4, 2), noise=0.0006, noise_scale=0.02)
    decimate(o, 2500); bake_ao(o); install(o, 'skull|visorframe'); clear_work()
