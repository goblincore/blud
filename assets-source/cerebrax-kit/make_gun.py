# The cerebrax's UNDER-BARREL (pelvis|gun, pelvis|barrels, pelvis|feed): a chaingun slung under the harness's
# mandible point, below the face. A bony shroud (skullmetal: a tapered shell with a crest and rolled lips, a jaw of
# points round its mouth) round a six-barrel cluster of chrome, and a corrugated ammo feed from its back into the
# band's flank. It rides `pelvis` with the harness: the gun turns with the body (the chaingun's sweep is the body's
# turn, soldier-brain.ts CHAINGUN_TUNING), the brain turns over it.
# Exec after make_harness.py (it uses band_point). Its MUZZLE (printed) is MotionProfile.spit in motion-profile.ts.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'gun'}

fp = band_point(0.0, 0.5, 0.0)                    # the band's front point (blender coords), the mandible's root
REAR = fp + Vector((0, 0.05, -0.17))              # blender: +y is blob -z (back), z is up
MUZ = fp + Vector((0, -0.50, -0.20))
if 'gun' in PARTS:
    drop(['pelvis|gun', 'pelvis|barrels', 'pelvis|feed']); clear_work()
    F = BoneFrame(REAR, MUZ, fwd=Vector((0, 0, 1)))   # ph 0 = up
    prof = lambda t: math.exp(-((t - 0.35) / 0.35) ** 2)
    rr = lambda t: 0.060 + 0.030 * prof(t) - 0.012 * t
    T0 = lambda ph: 0.0
    T1 = lambda ph: 0.70 + 0.06 * (0.5 + 0.5 * math.cos(3 * ph))      # three points round the shroud's mouth
    _, P, N = bone_shell('shroud', F, T0, T1, D(-178), D(178), rr, rr, 0.016, nu=40, nv=48)
    edge_lips(P, N, 0.009, n=60, which=('u1',))
    on = lambda t, ph, off=0.0: F.at(t, ph, rr(t) + off, rr(t) + off)
    S = [0.02 + 0.66 * i / 40 for i in range(41)]
    tube('crest', [on(t, 0, 0.004) for t in S], [0.006 + 0.008 * bell((t - 0.35) / 0.35) for t in S])
    ball('cap', F.h, 1.0, 0.070, 0.070, 0.070)
    # The hanger: the shroud hangs off the mandible point.
    tube('hanger', [fp + Vector((0, 0.01, -0.06)), on(0.25, 0, 0.0)], [0.040, 0.034], segs=14)
    for side in (-1, 1):
        R_ = [i / 10 for i in range(11)]
        for t0 in (0.20, 0.40):
            tube(f'rib{side}{t0}', [on(t0 - 0.06 * u, side * (D(10) + D(80) * u), 0.002) for u in R_], [0.003 + 0.005 * sn(u) for u in R_], segs=8)
    finish_part('gun', 'pelvis|gun', 2200, voxel=0.003, noise=0.002, ao=(1.5, 1.6))
    # Six chrome barrels in a ring, out of the shroud's mouth, and a muzzle plate round them.
    for k in range(6):
        a = 2 * math.pi * k / 6
        off = (F.f * math.cos(a) + F.s * math.sin(a)) * 0.034
        tube(f'b{k}', [F.at(0.30, 0, 0, 0) + off, MUZ + off], [0.011, 0.011], segs=10)
    ring('mplate', MUZ - F.u * 0.04, F.u, 0.034, 0.010)
    ring('mplate2', F.at(0.78, 0, 0, 0), F.u, 0.036, 0.009)
    tube('spindle', [F.at(0.30, 0, 0, 0), MUZ - F.u * 0.02], [0.012, 0.012], segs=10)
    plain_part(join_work(), 'chrome', 'pelvis|barrels', mirror=False)
    # The ammo feed: from the shroud's back, up the left of the keel into the band's flank.
    pts = [F.at(0.08, D(90), rr(0.08) * 0.6, rr(0.08) * 0.6), F.at(0.0, D(90), 0.10, 0.10) + Vector((0, 0.10, 0.02)),
           band_point(0.25, 0.5 + 25 / 360.0, 0.03) + Vector((0, 0.02, -0.04)), band_point(0.35, 0.5 + 40 / 360.0, -0.005)]
    import mathutils
    sm = []
    for i in range(len(pts) - 1):
        for j in range(12):
            u = j / 12
            p0 = pts[max(0, i - 1)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(len(pts) - 1, i + 2)]
            sm.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    sm.append(pts[-1])
    tube('feed', sm, [0.026] * len(sm), segs=12)
    for j in range(2, len(sm) - 2, 2):
        ring(f'fr{j}', sm[j], (sm[j + 1] - sm[j - 1]).normalized(), 0.027, 0.006)
    finish_part('feed', 'pelvis|feed', 1500, material='cable', voxel=0.003, noise=0.001, ao=(1.3, 1.3))
    # The muzzle in BLOB coords (blender (x, y, z) -> blob (x, z, -y)): MotionProfile.spit's offset is this minus the
    # hips' rig point (0, 1.504, 0).
    print('MUZZLE blob', (round(MUZ.x, 3), round(MUZ.z, 3), round(-MUZ.y, 3)))
