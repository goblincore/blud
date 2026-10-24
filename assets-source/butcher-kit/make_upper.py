# Butcher upper-body machinery: what is grafted onto the zombie (biomech-style.md). Run after kit_sculpt.py +
# butcher_common.py. Every point below is blob rest coords (bv() converts), placed against the skin found by marching
# the plain body (sdBody) along rays: the numbers in the comments are those probes.
#   pump      - spine:    a bony heart-pump carapace between the shoulder blades (back skin z -0.093 at y 1.40,
#               -0.103 at 1.30), crested, with three brass ports on top the hoses leave from;
#   hoses     - ribbed black hoses: over the left trap (top y 1.555 at x 0.12) into a port in the left pec (skin z 0.184),
#               up the back of the neck (skin z -0.027 at y 1.55) into a socket in the occiput (z 0.041 at y 1.62),
#               down the left arm's back, and down the right forearm into the axe's cuff;
#   respirator- skull:    the NOSE is cut off and replaced by a ribbed nasal cone bolted to the face (face front z 0.256
#               at y 1.685), its hose running round the right cheek (skin x -0.064 at z 0.20, -0.083 at 0.15) under the
#               ear into the side of the head;
#   pauldron  - clavicle.r: a bony spiked cap over the axe arm's shoulder (shoulder top y 1.563, outer x -0.289);
#   hips      - pelvis:   bony sockets where the machine legs go in (hip skin x 0.205) and a lumbar brace down the back.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'pump', 'hoses', 'respirator', 'pauldron', 'hips'}


def spline(ctrl, n=60):
    """Catmull-Rom through blob-coord control points -> blender points."""
    P = [bv(*c) for c in ctrl]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        m = max(2, n // (len(P) - 3))
        for k in range(m):
            t = k / m
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    return out


def hose(kit, ctrl, r=0.011, pitch=0.016, collars=True):
    """A ribbed rubber hose along ctrl: a tube with a ridge ring every `pitch` metres and a brass collar at each end."""
    clear_work()
    pts = spline(ctrl, 80)
    tube('h', pts, [r] * len(pts), segs=12)
    L = 0.0; last = -1.0
    for i in range(1, len(pts) - 1):
        L += (pts[i] - pts[i - 1]).length
        if L - last >= pitch:
            last = L
            ring(f'r{i}', pts[i], pts[i + 1] - pts[i - 1], r * 1.02, r * 0.28, segs=14)
    o = fuse('hose', voxel=0.0016, smooth=(0.5, 2), noise=0.0006, noise_scale=0.02)
    decimate(o, 1800); bake_ao(o, 'cable', gain=1.0, gamma=1.0, tint=(1, 1, 1)); install(o, kit); clear_work()
    if collars:
        for a, b in ((pts[0], pts[2]), (pts[-1], pts[-3])):
            c = ring('c', a + (b - a).normalized() * 0.006, b - a, r * 1.25, r * 0.45, segs=24)
            c2 = ring('c2', a + (b - a).normalized() * 0.014, b - a, r * 1.18, r * 0.30, segs=24)
        o = fuse('collars', voxel=0.0012, smooth=(0.4, 2), noise=0)
        decimate(o, 500); plain(o, 'brass'); install(o, kit + 'C'); clear_work()


def port(kit, c, normal, r=0.022):
    """A bony flanged port set into the skin where a hose goes in."""
    clear_work()
    nrm = bv(*normal).normalized(); p = bv(*c)
    ring('lip', p, nrm, r, r * 0.35, segs=28)
    ball('flange', p - nrm * 0.004, 1.0, r * 1.3, r * 1.3, r * 1.3)
    for k in range(4):
        e = nrm.orthogonal().normalized(); e = Matrix_rot(2 * math.pi * k / 4 + 0.4, nrm) @ e
        ball(f'bolt{k}', p + e * r * 1.45 + nrm * 0.004, 0.0055)
    o = fuse('port', voxel=0.0014, smooth=(0.5, 2), noise=0.0008, noise_scale=0.02)
    decimate(o, 1200); bake_ao(o); install(o, kit); clear_work()


def Matrix_rot(a, axis):
    from mathutils import Matrix
    return Matrix.Rotation(a, 3, axis)


# ---------------------------------------------------------------- the pump
if 'pump' in PARTS:
    drop(['spine|pump']); clear_work()
    pc = bv(0.0, 1.33, -0.150)
    ball('shell', pc, 1.0, 0.088, 0.055, 0.115)                   # blender (x, depth, height)
    ball('lobeL', pc + bv(0.05, -0.04, 0.0), 1.0, 0.050, 0.04, 0.06)
    ball('lobeR', pc + bv(-0.05, -0.04, 0.0), 1.0, 0.050, 0.04, 0.06)
    S = [i / 30 for i in range(31)]
    tube('crest', [pc + bv(0, -0.11 + 0.22 * s, -0.053 - 0.012 * sn(s)) for s in S], [0.004 + 0.008 * sn(s) for s in S])
    tube('crest2', [pc + bv(0, -0.09 + 0.18 * s, -0.066 - 0.012 * sn(s)) for s in S], [0.0015 + 0.004 * sn(s) for s in S])
    for side in (-1, 1):                                          # chevron ribs raking down and out from the crest
        for k, y0 in enumerate((0.07, 0.03, -0.01, -0.05)):
            R = [i / 16 for i in range(17)]
            tube(f'rib{side}{k}', [pc + bv(side * 0.075 * u, y0 - 0.04 * u, -0.054 + 0.040 * u * u) for u in R],
                 [0.0025 + 0.003 * sn(u) for u in R], segs=8)
        horn(f'horn{side}', pc + bv(side * 0.07, 0.07, -0.02), bv(side * 0.8, 0.6, -0.4), bv(0, 0, side), 0.07, 0.013, curl=0.8)
    for k, x in enumerate((-0.045, 0.0, 0.045)):                  # the ports the hoses leave from
        ball(f'boss{k}', pc + bv(x, 0.105, -0.01), 0.018)
    sut = [zigzag(lambda s: pc + bv(-0.05 + 0.10 * s, -0.07, -0.050), 0.004, 7, lambda s: bv(0, 1, 0))]
    o = fuse('pump'); press_lines(o, sut); decimate(o, 6000); bake_ao(o); install(o, 'spine|pump'); clear_work()
    for k, x in enumerate((-0.045, 0.0, 0.045)):
        o = ring('pr', pc + bv(x, 0.118, -0.01), bv(0, 1, 0), 0.016, 0.004, segs=24)
        plain(o, 'brass'); install(o, f'spine|portring{k}'); clear_work()

if 'hoses' in PARTS:
    drop(['spine|hose', 'neck|hose', 'upperArm.l|hose', 'foreArm.r|hose', 'spine|chestport', 'skull|occport', 'upperArm.l|elbowport'])
    # over the left trap into the pec
    hose('spine|hoseL', [(0.045, 1.445, -0.140), (0.09, 1.52, -0.085), (0.12, 1.572, 0.0), (0.12, 1.53, 0.10), (0.105, 1.445, 0.190)])
    port('spine|chestport', (0.105, 1.430, 0.188), (0, -0.15, 1))
    # up the back of the neck into the occiput (neck bone: rides between spine and skull)
    hose('neck|hoseN', [(0.0, 1.445, -0.140), (0.0, 1.52, -0.075), (0.0, 1.575, -0.030), (0.0, 1.615, 0.020)], r=0.013)
    port('skull|occport', (0.0, 1.625, 0.038), (0, -0.2, -1), r=0.024)
    # down the back of the left upper arm into the elbow
    hose('spine|hoseA', [(-0.045, 1.445, -0.140), (-0.10, 1.50, -0.10), (-0.17, 1.52, -0.06), (-0.22, 1.50, -0.02)], r=0.010)
    hose('upperArm.l|hose', [(0.24, 1.53, -0.02), (0.30, 1.42, -0.01), (0.34, 1.30, 0.03), (0.345, 1.20, 0.07)], r=0.009)
    port('upperArm.l|elbowport', (0.338, 1.195, 0.075), (1, -0.1, 0.1), r=0.016)
    # two feed lines down the right forearm into the axe's cuff (the cuff's lip is 0.058 m round the forearm line)
    E, Wr = J['elbowR'], J['wristR']
    def fa(t, ox, oz):
        return (E[0] + (Wr[0] - E[0]) * t + ox, E[1] + (Wr[1] - E[1]) * t, E[2] + (Wr[2] - E[2]) * t + oz)
    hose('foreArm.r|hose1', [fa(0.12, -0.058, -0.010), fa(0.45, -0.062, -0.005), fa(0.75, -0.064, 0.0), fa(0.93, -0.060, 0.004)], r=0.008)
    hose('foreArm.r|hose2', [fa(0.18, -0.020, -0.056), fa(0.50, -0.022, -0.060), fa(0.78, -0.025, -0.062), fa(0.94, -0.022, -0.058)], r=0.008)

if 'respirator' in PARTS:
    drop(['skull|respirator', 'skull|hoseR']); clear_work()
    base = bv(0.0, 1.682, 0.240); ax = bv(0, -0.40, 1).normalized()   # the decal's raw seat lands at y 1.679
    S = [i / 24 for i in range(25)]
    tube('cone', [base + ax * (0.062 * s) for s in S], [0.030 - 0.010 * s for s in S], segs=20)
    for k, s in enumerate((0.25, 0.48, 0.70)):
        ring(f'rib{k}', base + ax * (0.062 * s), ax, 0.030 - 0.010 * s, 0.0045, segs=24)
    ring('mouth', base + ax * 0.062, ax, 0.019, 0.005, segs=24)
    for sx in (-1, 1):                                            # bolted flanges on the cheekbones
        f = bv(sx * 0.050, 1.698, 0.212)                          # onto the decal's bolt holes (x -+0.055)
        ball(f'flange{sx}', f, 1.0, 0.020, 0.010, 0.016)
        tube(f'strut{sx}', [f, base + bv(sx * 0.012, 0.0, 0.01)], [0.006, 0.006], segs=8)
        ball(f'bolt{sx}', f + bv(0, 0, 0.008), 0.006)
    ball('intake', base + ax * 0.03 + bv(-0.028, -0.004, 0), 0.011)
    o = fuse('respirator', voxel=0.0011, smooth=(0.4, 2), noise=0.0006, noise_scale=0.015)
    grille = [[base + ax * 0.063 + bv(-0.012 + 0.012 * k, -0.010 + 0.020 * s, 0) for s in (0, 0.5, 1)] for k in range(3)]
    press_lines(o, grille, width=0.0025, depth=0.003)
    decimate(o, 3500); bake_ao(o); install(o, 'skull|respirator'); clear_work()
    hose('skull|hoseR', [(-0.030, 1.668, 0.262), (-0.060, 1.652, 0.235), (-0.080, 1.648, 0.180), (-0.095, 1.650, 0.120),
                         (-0.088, 1.655, 0.070), (-0.060, 1.660, 0.040)], r=0.008, pitch=0.012)

if 'pauldron' in PARTS:
    drop(['clavicle.r|pauldron']); clear_work()
    sc = bv(-0.215, 1.460, 0.060); up = bv(-0.60, 1, 0).normalized()
    e1 = bv(0, 0, 1); e1 = (e1 - up * e1.dot(up)).normalized(); e2 = up.cross(e1)
    R0 = 0.098

    def Pc(u, v):                                                 # a dome cap: u from crown to rim, v round it
        th = math.radians(78) * u; ph = 2 * math.pi * v
        rim = 1 + 0.25 * math.exp(-((math.cos(ph) - 1) / 0.25) ** 2) * u ** 2   # a swept point at the front
        r = R0 * (1 + 0.08 * math.sin(math.pi * u))
        return sc + (up * math.cos(th) + (e1 * math.cos(ph) + e2 * math.sin(ph)) * math.sin(th) * rim) * r

    def Nc(u, v):
        p = Pc(u, v); return (p - sc).normalized()
    surface_solid('cap', Pc, Nc, 24, 64, 0.012, closed_v=True)
    tube('lip', [Pc(1, i / 96) - Nc(1, i / 96) * 0.004 for i in range(98)], [0.0065] * 98, segs=10)
    S = [i / 30 for i in range(31)]
    tube('crest', [Pc(0.05 + 0.9 * s, 0.25) + Nc(0.05 + 0.9 * s, 0.25) * 0.003 for s in S], [0.004 + 0.008 * sn(s) for s in S])
    for k, (u, v) in enumerate(((0.35, 0.25), (0.55, 0.25), (0.75, 0.25))):   # spines raked back along the crest
        p = Pc(u, v); nrm = Nc(u, v)
        horn(f'sp{k}', p + nrm * 0.006, nrm + e2 * -0.6 + up * 0.2, e1, 0.06 + 0.02 * k, 0.013, curl=-0.7)
    for k in range(6):
        v = 0.25 + (k - 2.5) * 0.07
        R = [i / 16 for i in range(17)]
        tube(f'rib{k}', [Pc(0.2 + 0.7 * s, v + 0.02 * s * (1 if k > 2 else -1)) + Nc(0.2 + 0.7 * s, v) * 0.001 for s in R],
             [0.002 + 0.003 * sn(s) for s in R], segs=8)
    o = fuse('pauldron'); decimate(o, 6000); bake_ao(o); install(o, 'clavicle.r|pauldron'); clear_work()

if 'hips' in PARTS:
    drop(['pelvis|hips', 'pelvis|brace']); clear_work()
    for sx in (-1, 1):                                            # sockets on the hips (skin x 0.205 at y 1.13)
        k = bv(sx * 0.200, 1.130, -0.005)
        ball(f'boss{sx}', k, 1.0, 0.030, 0.055, 0.055)
        ring(f'r1{sx}', k + bv(sx * 0.012, 0, 0), bv(1, 0, 0), 0.050, 0.0075)
        ring(f'r2{sx}', k + bv(sx * 0.022, 0, 0), bv(1, 0, 0), 0.030, 0.006)
        horn(f'spur{sx}', k + bv(sx * 0.02, 0.03, -0.03), bv(sx * 0.5, 0.6, -1), bv(0, 0, 1) * sx, 0.06, 0.011, curl=0.7)
    for i in range(5):                                            # a lumbar brace down the back (skin z -0.127 at y 1.10)
        y = 1.235 - 0.055 * i; z = -0.138 + 0.004 * i
        c = bv(0, y, z)
        ball(f'centrum{i}', c, 1.0, 0.034, 0.022, 0.022)
        horn(f'spinous{i}', c + bv(0, 0, -0.016), bv(0, -0.55, -1), bv(1, 0, 0), 0.04, 0.010, curl=0.5)
        for sx in (-1, 1):
            horn(f't{i}{sx}', c + bv(sx * 0.024, 0, -0.004), bv(sx, -0.1, -0.35), bv(0, 0, 1) * sx, 0.04, 0.008, curl=0.5)
    tube('cord', [bv(0, 1.26 - 0.30 * s, -0.130 + 0.004 * s) for s in [i / 30 for i in range(31)]], [0.014] * 31)
    o = fuse('hips'); decimate(o, 6000); bake_ao(o); install(o, 'pelvis|hips'); clear_work()
