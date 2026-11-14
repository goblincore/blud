# The organ's head (organ.blob, "the cantor"): eyeless flesh, nearly all mouth. Kit: a bone-metal MASK over the
# cranium (a crest, a heavy brow ridge pointed at the middle, sutures, no eye holes) and human TEETH in the mouth: an upper row on `skull`,
# a lower on `jaw`, so the bite shows them.
import bpy, bmesh, math
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {"mask", "teeth", "flankteeth"}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1))
smoothc = lambda c: (lambda x: x * x * (3 - 2 * x))(max(0.0, min(1.0, c)))


def lowball(name, p, r, sx=1.0, sy=1.0, sz=1.0, sub=2):
    """ball() at a lower subdivision (teeth: hundreds of them)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=Matrix.Translation(p) @ Matrix.Diagonal((sx, sy, sz, 1.0)))
    return mkobj(name, bm)


def join_plain(material, kit):
    """Join the work collection into one part WITHOUT a remesh (many small separate pieces: a remesh grid over all of
    them is too big), give it `material` and install it."""
    w = work_coll(); objs = list(w.objects)
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.hide_set(False); o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    plain(o, material); install(o, kit); clear_work()
    return o


F = BoneFrame(JV['atlas'], JV['muzzle'], fwd=UP)                    # ph 0 = the top of the head, +90 toward s

if 'mask' in PARTS:
    drop(['skull|mask']); clear_work()
    # Radii probed off organ.blob's cranium (centre (0, 0.941, 1.245), semi-axes 0.168 / 0.133 / 0.154): ~0.183 above
    # the bone axis over most of its length, plus 1.2 cm of lift; the sides follow its half-width.
    # Round 1 (0.195 lift, ending at t 0.66) rendered as a HEADBAND: the flesh's surface noise stood through its top
    # and the face bulged out in front of it. Now 2 cm higher and run down over the brow onto the face (t 0.86),
    # dropping to the face blob's top (0.106 above the axis at t 0.72).
    rf = lambda t: 0.215 - 0.085 * smoothc((t - 0.40) / 0.45)
    rs = lambda t: 0.200 - 0.050 * smoothc((t - 0.40) / 0.45)
    T0 = lambda ph: -0.18 + 0.10 * (abs(ph) / D(100)) ** 2
    T1 = lambda ph: 0.80 + 0.08 * math.exp(-(ph / D(22)) ** 2) - 0.22 * (abs(ph) / D(100)) ** 2   # a point at the brow
    _, P, N = bone_shell('plate', F, T0, T1, D(-100), D(100), rf, rs, 0.012, nu=48, nv=56)
    edge_lips(P, N, 0.0065, n=80)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [-0.12 + 1.0 * i / 50 for i in range(51)]
    tube('crest', [on(t, 0, 0.004) for t in S], [0.005 + 0.007 * sn((t + 0.12) / 1.0) for t in S])
    tube('crest2', [on(t, 0, 0.014 * sn((t + 0.12) / 1.0) ** 0.5) for t in S][4:-4], [0.002 + 0.004 * sn((t + 0.12) / 1.0) for t in S][4:-4])
    # the brow: a heavy ridge over where eyes would be, sweeping back to the temples, a V pointing at the nose
    B = [i / 30 for i in range(31)]
    for side in (-1, 1):
        tube(f'brow{side}', [on(0.74 - 0.30 * b, side * (D(8) + D(80) * b), 0.006) for b in B], [0.010 + 0.006 * sn(b) for b in B])
        for k, t0 in enumerate((0.05, 0.22, 0.38)):                    # chevron ribs raking back off the crest
            R = [j / 14 for j in range(15)]
            tube(f'rib{side}{k}', [on(t0 - 0.10 * r_, side * (D(10) + D(70) * r_), 0.001) for r_ in R],
                 [0.0018 + 0.0032 * sn(0.1 + r_ * 0.9) for r_ in R], segs=8)
    sut = [zigzag(lambda s: on(-0.05 + 0.55 * s, D(40)), 0.004, 8, lambda s: UP),
           zigzag(lambda s: on(-0.05 + 0.55 * s, D(-40)), 0.004, 8, lambda s: UP)]
    finish('mask', 'skull|mask', 6000, mirror=False, lines=sut)

# (Two small flue pipes rising off the temples were tried and dropped: from the front they read as levers stuck in a
# helmet, and the organ is already on the back.)
drop(['skull|hornpipes', 'skull|hornvoid'])

if 'teeth' in PARTS:
    # Human teeth, a row behind each lip (organ.blob: the upper lip at skull t=1, y 0.81; the jaw's lip ~0.77):
    # incisors flat and broad at the middle, narrowing to the corners, set on an arch.
    for bone, yc, zc, down in (('skull', 0.794, 1.420, 1), ('jaw', 0.768, 1.400, -1)):
        drop([f'{bone}|teeth']); clear_work()
        n = 10
        for i in range(n):
            a = -0.95 + 1.9 * (i + 0.5) / n
            x = 0.075 * math.sin(a); z = zc - 0.040 * (1 - math.cos(a))
            w = 1.0 - 0.35 * abs(a)
            lowball(f't{i}', bv(x, yc, z), 0.012, 0.85 * w, 0.55, 1.25 * w)
        join_plain('tooth', f'{bone}|teeth')

if 'flankteeth' in PARTS:
    # The FLANK MOUTHS' teeth, on `spine` (organ.blob's three mouths a side, at spine t 0.29 / 0.50 / 0.71). Each
    # row sits INSIDE the closed lips (their overlap, at x just behind the lips' outer face), so at rest the mouths
    # are shut and toothless; the swell morph parts the lips (up 2.4-2.8 cm, down 2.8-3.2 cm) and bares them.
    # (t, row x, mouth centre y offset from the spine) from the .blob's lines: the rows stand just proud of the dark gullet slab (its face is 2.6 cm out of the lips' centre), behind the lips' outer face (4 cm).
    drop(['spine|teeth']); clear_work()
    for t, xl, ym_ in ((0.29, 0.349, -0.097), (0.50, 0.363, -0.062), (0.71, 0.347, -0.114)):
        sy = 0.900 + 0.105 * t; sz = 0.854 * t
        ym = sy + ym_
        for side in (-1, 1):
            n = 8
            for i in range(n):
                dz = -0.060 + 0.12 * (i + 0.5) / n
                x = side * (xl - 2.0 * dz * dz)
                w = 1.0 - 3.0 * abs(dz)
                lowball(f'u{t}{side}{i}', bv(x, ym + 0.010, sz + dz), 0.011, 0.55, 0.9 * w, 1.35, sub=1)
                lowball(f'l{t}{side}{i}', bv(x, ym - 0.009, sz + dz), 0.010, 0.55, 0.85 * w, 1.25, sub=1)
    join_plain('tooth', 'spine|teeth')
