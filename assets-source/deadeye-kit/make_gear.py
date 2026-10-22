# The deadeye's grafted gear. Run after kit_sculpt.py + butcher_common.py (../butcher-kit/build.py).
# Skin probes (deadeye.blob): the right eye socket front at (-0.033, 1.718, 0.229); the head's side x -0.090 at
# y 1.70, z 0.13, and x -0.066 at z 0.20.
#   optic     - skull:      a bony half-mask over the RIGHT eye (brow to cheekbone, the temple back to the missing
#               ear), carrying a telescopic sight: a ribbed barrel out of the socket with brass bands and a
#               glowing red lens (`led`), a cable from its side to a plug behind the ear;
#   bandolier - spine:      a strap right shoulder to left hip and round the back (bandolier-path.json, probed off
#               the skin by scripts/deadeye-bandolier-path.ts), leather with brass cartridges in bony loops;
#   bracer    - foreArm.r:  a ribbed bony vambrace on the gun arm.
import bpy, bmesh, json, math, os
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'optic', 'bandolier', 'bracer'}

HC = Vector((0.0, 1.700, 0.136)); SEMI = Vector((0.092, 0.138, 0.106))
EYE = Vector((-0.033, 1.718, 0.229))


def head(ph, y, grow):
    """Blob point on an ellipsoid fitted to the head (6 mm clear at the eye, 2 at the side), grown by `grow`."""
    c = max(-1.0, min(1.0, (y - HC[1]) / SEMI[1])); s = math.sqrt(1 - c * c)
    return Vector((HC[0] + (SEMI[0] + grow) * s * math.sin(ph), y, HC[2] + (SEMI[2] + grow) * s * math.cos(ph)))


if 'optic' in PARTS:
    drop(['skull|mask', 'skull|lens', 'skull|scopeband', 'skull|cable']); clear_work()
    # From the bridge of the nose round to the temple, TAPERING to a point there: the first cut ran to -112 deg
    # at full height and read as a flat slab on the side of the head (in-engine, 2026-10-22).
    PH0, PH1 = math.radians(-88), math.radians(-4)
    def taper(ph): return 0.25 + 0.75 * min(1.0, (ph - PH0) / (PH1 - PH0) / 0.45) ** 0.8
    def ylo(ph): return 1.722 - 0.042 * taper(ph)
    def yhi(ph): return 1.722 + 0.044 * taper(ph)
    def P(u, v):
        ph = PH0 + (PH1 - PH0) * v; y = ylo(ph) + (yhi(ph) - ylo(ph)) * u
        bulge = 0.004 * math.sin(math.pi * u) * math.sin(math.pi * v)
        return bv(*head(ph, y, 0.008 + bulge))

    def N(u, v):
        ph = PH0 + (PH1 - PH0) * v; y = ylo(ph) + (yhi(ph) - ylo(ph)) * u
        return (bv(*head(ph, y, 0.02)) - bv(*head(ph, y, 0.0))).normalized()
    surface_solid('plate', P, N, 24, 40, 0.008)
    edge_lips(P, N, 0.0045, n=50)
    R = [i / 40 for i in range(41)]
    tube('crest', [P(0.55, 0.05 + 0.85 * s) + N(0.55, 0.05 + 0.85 * s) * 0.004 for s in R], [0.003 + 0.004 * sn(s) for s in R])
    for k, v0 in enumerate((0.35, 0.50, 0.68)):
        tube(f'rib{k}', [P(0.15 + 0.7 * s, v0 + 0.05 * s) + N(0.15 + 0.7 * s, v0) * 0.002 for s in R], [0.0018 + 0.0025 * sn(s) for s in R], segs=8)
    for k, (u, v) in enumerate(((0.2, 0.55), (0.85, 0.55), (0.2, 0.9), (0.85, 0.85))):
        ball(f'bolt{k}', P(u, v) + N(u, v) * 0.003, 0.0055)
    # the sight: out of the socket, forward and a touch out and down
    ax = bv(-0.10, -0.05, 1).normalized(); base = bv(*EYE) - ax * 0.004
    S = [i / 30 for i in range(31)]
    tube('barrel', [base + ax * (0.075 * s) for s in S], [0.021 - 0.004 * s + 0.004 * math.exp(-((s - 0.92) / 0.08) ** 2) for s in S], segs=20)
    ring('socketring', base + ax * 0.004, ax, 0.024, 0.006)
    for k, s in enumerate((0.35, 0.55)):
        ring(f'rib{k}b', base + ax * (0.075 * s), ax, 0.019 - 0.004 * s, 0.0035)
    horn('sighthorn', base + ax * 0.04 + bv(0, 0.018, 0), bv(0, 1, -0.6), bv(1, 0, 0), 0.03, 0.006, curl=-0.8)
    tube('rangefinder', [base + ax * 0.02 + bv(-0.024, 0.004, 0) + ax * (0.035 * s) for s in S], [0.007] * 31, segs=10)
    o = fuse('mask', voxel=0.0013, smooth=(0.4, 2), noise=0.0008, noise_scale=0.02)
    decimate(o, 7000); bake_ao(o); install(o, 'skull|mask'); clear_work()
    for k, s in enumerate((0.20, 0.80)):
        o = ring('band', base + ax * (0.075 * s), ax, 0.021 - 0.004 * s + 0.0015, 0.003, segs=28)
        plain(o, 'brass'); install(o, f'skull|scopeband{k}'); clear_work()
    lens = ball('lens', base + ax * 0.0745, 1.0, 0.0165, 0.0165, 0.0165)
    sc = lens.scale; plain(lens, 'led'); install(lens, 'skull|lens'); clear_work()
    # the cable: from the rangefinder's back round under the temple to a plug where the right ear was
    # about one cable radius off the skin (x -0.066 at z 0.20, -0.090 at 0.13); at -0.104 it stood off like a stick
    pts = [bv(-0.058, 1.716, 0.212), bv(-0.078, 1.708, 0.180), bv(-0.093, 1.700, 0.140), bv(-0.094, 1.692, 0.105), bv(-0.090, 1.686, 0.082)]
    P2 = []
    for i in range(len(pts) - 1):
        for k in range(10): P2.append(pts[i].lerp(pts[i + 1], k / 10))
    P2.append(pts[-1])
    tube('cable', P2, [0.0055] * len(P2), segs=10)
    ball('plug', pts[-1], 0.011)
    o = fuse('cable', voxel=0.0012, smooth=(0.4, 2), noise=0)
    decimate(o, 1200); plain(o, 'cable'); install(o, 'skull|cable'); clear_work()

if 'bandolier' in PARTS:
    drop(['spine|bandolier', 'spine|cartridges']); clear_work()
    data = json.load(open(os.path.join(KIT_DIR, 'bandolier-path.json')))
    P = [Vector(p) for p in data['points']]; n = len(P)
    C = [bv(*p) for p in P]
    axis = lambda p: Vector((0, p[1], 0.03))
    # the strap: a flat band, 34 mm wide (along the loop's tangent x outward), 5 mm thick
    bm = bmesh.new(); rows = []
    for i in range(n):
        p = P[i]; t = (P[(i + 1) % n] - P[i - 1]).normalized(); o = (p - axis(p)); o = (o - t * o.dot(t)).normalized()
        w = t.cross(o).normalized()
        row = [bm.verts.new(bv(*(p + w * a + o * b))) for a, b in ((-0.017, 0.0), (0.017, 0.0), (0.017, 0.005), (-0.017, 0.005))]
        rows.append(row)
    for i in range(n):
        a, b = rows[i], rows[(i + 1) % n]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    strap = mkobj('strap', bm)
    for f in strap.data.polygons: f.use_smooth = True
    plain(strap, 'leather'); install(strap, 'spine|bandolier'); clear_work()
    # cartridges on the FRONT half: brass cases with dull bullet tips, each in a bony loop
    for i in range(n):
        th = 2 * math.pi * i / n
        if math.cos(th) < 0.15 or i % 2: continue
        p = P[i]; t = (P[(i + 1) % n] - P[i - 1]).normalized(); o = (p - axis(p)); o = (o - t * o.dot(t)).normalized()
        w = t.cross(o).normalized()
        up = w if w.y > 0 else -w
        c0 = p + o * 0.012 - up * 0.020
        tube(f'case{i}', [bv(*(c0 + up * (0.034 * s))) for s in (0, 0.5, 1)], [0.0065, 0.0065, 0.0060], segs=12)
    o = fuse('cartridges', voxel=0.0011, smooth=(0.3, 1), noise=0)
    decimate(o, 4000); plain(o, 'brass'); install(o, 'spine|cartridges'); clear_work()
    for i in range(n):
        th = 2 * math.pi * i / n
        if math.cos(th) < 0.15 or i % 2: continue
        p = P[i]; t = (P[(i + 1) % n] - P[i - 1]).normalized(); o = (p - axis(p)); o = (o - t * o.dot(t)).normalized()
        w = t.cross(o).normalized(); up = w if w.y > 0 else -w
        ball(f'tip{i}', bv(*(p + o * 0.012 + up * 0.019)), 1.0, 0.0058, 0.0058, 0.0058)
        ring(f'loop{i}', bv(*(p + o * 0.010 - up * 0.002)), bv(*up) - bv(0, 0, 0), 0.0085, 0.0028, segs=16)
    o = fuse('loops', voxel=0.0011, smooth=(0.3, 1), noise=0)
    decimate(o, 4000); bake_ao(o); install(o, 'spine|loops'); clear_work()

if 'bracer' in PARTS:
    drop(['foreArm.r|bracer']); clear_work()
    F = BoneFrame(JV['elbowR'], JV['wristR'])
    rf = lambda t: 0.060 - 0.010 * t
    rs = lambda t: 0.062 - 0.012 * t
    _, P, N = bone_shell('plate', F, 0.22, 0.86, D(-200), D(40), rf, rs, 0.008, nu=30, nv=40)
    edge_lips(P, N, 0.0045, n=40)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.24 + 0.6 * i / 30 for i in range(31)]
    tube('crest', [on(t, D(-80), 0.003) for t in S], [0.003 + 0.005 * bell((t - 0.54) / 0.32) for t in S])
    for k, t0 in enumerate((0.32, 0.48, 0.64)):
        R = [i / 16 for i in range(17)]
        tube(f'rib{k}', [on(t0 + 0.1 * u, D(-80) - D(90) * u, 0.001) for u in R], [0.0018 + 0.003 * sn(u) for u in R], segs=8)
    horn('spur', on(0.30, D(-90), 0.004), -F.s - F.u * 0.8, F.f, 0.05, 0.010, curl=0.7)
    o = fuse('bracer'); decimate(o, 4000); bake_ao(o); install(o, 'foreArm.r|bracer'); clear_work()
