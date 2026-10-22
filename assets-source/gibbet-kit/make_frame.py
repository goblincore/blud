# The gibbet's machinery: a walking gallows (biomech-style.md). Run with ../gorehound-kit/build.py on gibbet-kit.blend:
#   Blender -b assets-source/gibbet-kit/gibbet-kit.blend --python assets-source/gorehound-kit/build.py -- \
#       make_legs.py make_frame.py --export
#   beam    the spine is a gallows beam of bone-metal: a carapace with a crest, chevron ribs and raked spines,
#           a skull-cap over the hips and a yoke over the withers where the legs hang from
#   cage    a BIRDCAGE hung from the hips on chains, the meat inside it; it rides the `hem` pendulum with the sac,
#           so the whole cage swings under the beam as it walks. Bars bulge round the sac and pinch to a spike
#           below; the bars sit a touch INSIDE the sac's skin so the meat bulges between them
#   hooks   meat hooks from the cage's collar down into the sac's wounds
#   neck    a twisted cable bundle down the drooping neck, a collar at its root
#   muzzle  a small cage over the dangling face: the big cage's motif again
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'beam', 'cage', 'hooks', 'neck', 'muzzle', 'upper'}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0))

# ---------------------------------------------------------------- beam
if 'beam' in PARTS:
    drop(['spine|beam']); clear_work()
    F = BoneFrame(JV['hips'], JV['withers'], fwd=UP)              # f = UP here: ph 0 is the top of the beam
    rf = lambda t: 0.060 + 0.012 * math.sin(math.pi * t)
    rs = lambda t: 0.055 + 0.010 * math.sin(math.pi * t)
    _, P, N = bone_shell('plate', F, -0.04, 1.06, D(-150), D(150), rf, rs, 0.012, nu=56, nv=48)
    edge_lips(P, N, 0.0055, n=80, which=('v0', 'v1'))
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [i / 60 for i in range(61)]
    tube('crest', [on(t, 0, 0.004) for t in S], [0.006 + 0.004 * sn(t) for t in S])
    tube('crest2', [on(t, 0, 0.016) for t in S][3:-3], [0.002 + 0.004 * sn(t) for t in S][3:-3])
    for i, t in enumerate([0.08 + 0.12 * k for k in range(8)]):
        horn(f'sp{i}', on(t, 0, 0.012), UP + BACK * 0.8, X, 0.06 + 0.05 * sn(t), 0.012, curl=0.7)
        for side in (-1, 1):
            R = [k / 16 for k in range(17)]
            tube(f'rib{i}{side}', [on(t - 0.05 * r_, side * (D(10) + D(110) * r_), 0.001) for r_ in R],
                 [0.002 + 0.004 * sn(0.1 + r_ * 0.9) for r_ in R], segs=8)
    # the hip cap: a skull-like dome over the pivot the cage hangs from
    ball('hipcap', JV['hips'] + UP * 0.02, 1.0, 0.13, 0.09, 0.07)
    for sx in (-1, 1):
        ball(f'socket{sx}', bv(sx * 0.20, 1.06, 0.0), 0.045)
        ring(f'sring{sx}', bv(sx * 0.215, 1.06, 0.0), X, 0.045, 0.007)
        ball(f'yoke{sx}', bv(sx * 0.23, 0.95, 0.62), 0.042)
        ring(f'yring{sx}', bv(sx * 0.24, 0.95, 0.62), X, 0.042, 0.007)
    tube('yokebar', [bv(-0.23, 0.95, 0.62).lerp(bv(0.23, 0.95, 0.62), i / 20) + UP * 0.03 * sn(i / 20) for i in range(21)], [0.022] * 21)
    tube('hipbar', [bv(-0.21, 1.06, 0.0).lerp(bv(0.21, 1.06, 0.0), i / 20) for i in range(21)], [0.024] * 21)
    horn('hipspurL', JV['hips'] + Vector((0.08, 0.06, 0.05)), BACK + UP * 0.4 + X * 0.6, X, 0.12, 0.018, curl=0.8)
    horn('hipspurR', JV['hips'] + Vector((-0.08, 0.06, 0.05)), BACK + UP * 0.4 - X * 0.6, X, 0.12, 0.018, curl=0.8)
    sut = [zigzag(lambda s: on(0.1 + 0.8 * s, D(55)), 0.004, 10, lambda s: UP),
           zigzag(lambda s: on(0.1 + 0.8 * s, D(-55)), 0.004, 10, lambda s: UP)]
    finish('beam', 'spine|beam', 12000, mirror=False, lines=sut)

# ---------------------------------------------------------------- cage (on the pendulum)
A, B = JV['hemTop'], JV['hemEnd']
ax = (B - A).normalized(); L = (B - A).length
e1 = X; e2 = ax.cross(e1).normalized()                           # e2: the cage's forward-ish radial axis


def cage_at(t, ph, r):
    """A point on the cage: t along the hem (0 hips .. 1 sac bottom, >1 below), angle ph round it, radius r."""
    return A + ax * (L * t) + (e1 * math.cos(ph) + e2 * math.sin(ph)) * r


# The sac's radius along the hem, from gibbet.blob (the bulk blobs at 0.62 and 0.85, the stalk below 0.4),
# a touch INSIDE it so the bars press into the meat.
sac_r = lambda t: max(0.03, 0.30 * math.sin(math.pi * min(1.0, max(0.0, (t - 0.22) / 0.95))) ** 0.8)

if 'cage' in PARTS:
    drop(['hem|cage']); clear_work()
    NB = 12
    T = [0.26 + (1.20 - 0.26) * i / 60 for i in range(61)]
    for b in range(NB):
        ph = 2 * math.pi * b / NB + 0.15
        tube(f'bar{b}', [cage_at(t, ph + 0.10 * math.sin(4 * t), sac_r(t) * 1.14 + 0.025) for t in T], [0.019] * len(T), segs=8)
    for t in (0.26, 0.45, 0.70, 0.95):
        ring(f'band{t}', A + ax * (L * t), ax, sac_r(t) * 1.14 + 0.025, 0.022 if t in (0.26, 0.95) else 0.015)
    horn('spike', A + ax * (L * 1.18), ax, X, 0.16, 0.030, curl=0.25)    # the cage pinches to a point below
    # the LID: a dome of bars over the collar and a finial ring, so the cage reads as a cage from above and behind
    for b in range(6):
        ph = 2 * math.pi * b / 6
        top_r = sac_r(0.26) * 1.14 + 0.025
        tube(f'lid{b}', [cage_at(0.26 - 0.10 * math.sin(math.pi * u / 2), ph, top_r * math.cos(math.pi * u / 2) + 0.012) for u in [k / 12 for k in range(13)]],
             [0.015] * 13, segs=8)
    ring('finial', A + ax * (L * 0.15), ax, 0.035, 0.012)
    # the chains up to the hip cap: links alternating 90 degrees, from the collar to the pivot
    top = A + ax * (L * 0.26)
    for sx in (-1, 1):
        a = top + e1 * (sx * 0.10); b = A + X * (sx * 0.05) + UP * 0.02
        n = 7
        for k in range(n):
            c = a.lerp(b, (k + 0.5) / n); d = (b - a).normalized()
            nrm = d.cross(X if k % 2 else e2).normalized()
            ring(f'link{sx}{k}', c, nrm, 0.018, 0.0045, segs=16)
    finish('cage', 'hem|cage', 14000, mirror=False, material='iron', noise=0.0012)
    o = bpy.data.objects['hem|cage']
    # Lighter than the first pass (0.32 grey, rust from a tenth of the way): the cage read as a dark ball against the
    # meat. Pale bone-iron, rust only toward the bottom, the blood where it drips.
    wear_colours(o, Vector((0.55, 0.54, 0.52)), Vector((0.38, 0.18, 0.07)), Vector((0.25, 0.02, 0.02)), B, A,
                 rust_at=(0.45, 0.85), blood_at=(0.15, 0.40))

# ---------------------------------------------------------------- hooks into the sac
if 'hooks' in PARTS:
    drop(['hem|hooks']); clear_work()
    for k, (ph, dt) in enumerate(((0.3, 0.0), (2.2, 0.03), (4.1, -0.02), (5.4, 0.02))):
        root = cage_at(0.27, ph, sac_r(0.27) + 0.005)
        tip = cage_at(0.47 + dt, ph + 0.15, sac_r(0.47) * 0.78)
        d = (tip - root).normalized()
        horn(f'hook{k}', root, d, d.cross(ax).normalized(), (tip - root).length * 1.25, 0.010, curl=1.6)
    o = finish('hooks', 'hem|hooks', 4000, mirror=False, material='chrome', noise=0.0)

# ---------------------------------------------------------------- neck cables and collar
if 'neck' in PARTS:
    drop(['neck|cables', 'chest|collar']); clear_work()
    F = BoneFrame(JV['neckBase'], JV['atlas'])
    for k in range(5):
        pts = [F.at(t, 2 * math.pi * k / 5 + 2.2 * t, 0.040, 0.040) for t in [i / 40 * 1.05 for i in range(41)]]
        tube(f'c{k}', pts, [0.0075] * len(pts), segs=8)
    finish('cables', 'neck|cables', 5000, mirror=False, material='cable', noise=0.0)
    ring('collar', JV['neckBase'] + (JV['atlas'] - JV['neckBase']).normalized() * 0.02, (JV['atlas'] - JV['neckBase']).normalized(), 0.055, 0.016)
    for k in range(6):
        ph = 2 * math.pi * k / 6
        F2 = BoneFrame(JV['neckBase'], JV['atlas'])
        ball(f'rivet{k}', F2.at(0.07, ph, 0.068, 0.068), 0.008)
    finish('collar', 'chest|collar', 2500, mirror=False)

# ---------------------------------------------------------------- muzzle cage on the dangling face
if 'muzzle' in PARTS:
    drop(['skull|muzzle']); clear_work()
    F = BoneFrame(JV['atlas'], JV['face'])
    rr = lambda t: 0.080 * math.sin(math.pi * min(1.0, 0.25 + 0.75 * t)) ** 0.6 + 0.015
    T = [0.35 + 0.80 * i / 30 for i in range(31)]
    for b in range(7):
        ph = 2 * math.pi * b / 7
        tube(f'mb{b}', [F.at(t, ph, rr(t), rr(t)) for t in T], [0.006] * len(T), segs=6)
    for t in (0.40, 0.75):
        ring(f'mr{t}', F.h + F.u * (F.L * t), F.u, rr(t), 0.007)
    ball('nose', F.h + F.u * (F.L * 1.16), 0.016)
    finish('muzzle', 'skull|muzzle', 3000, mirror=False, material='iron', noise=0.0)

# ---------------------------------------------------------------- upper legs: humerus and femur carapaces
# The gorehound's upper legs were flesh, so make_legs.py sculpts only from the middle joint down; the gibbet's are
# machine all the way up: a crested shell with a rolled lip, chevron ribs and a spine raking back off the crest.
if 'upper' in PARTS:
    for bone, a_, b_ in (('upperarm', 'shoulder', 'elbow'), ('thigh', 'hip', 'knee')):
        drop([f'{bone}.l|carapace', f'{bone}.r|carapace']); clear_work()
        F = BoneFrame(JV[a_], JV[b_])
        prof = lambda t: math.exp(-((t - 0.35) / 0.40) ** 2)
        rf = lambda t: 0.038 + 0.016 * prof(t)
        rs = lambda t: 0.040 + 0.012 * prof(t)
        _, P, N = bone_shell('plate', F, 0.06, lambda ph: 0.88 + 0.07 * math.exp(-(ph / D(35)) ** 2), D(-165), D(165), rf, rs, 0.009, nu=44, nv=48)
        edge_lips(P, N, 0.0045, n=60, which=('u0', 'u1'))
        on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
        S = [0.08 + 0.84 * i / 40 for i in range(41)]
        tube('crest', [on(t, D(180), 0.003) for t in S], [0.004 + 0.006 * sn(t) for t in S])
        for t0 in (0.25, 0.45, 0.65):
            for side in (-1, 1):
                R_ = [k / 16 for k in range(17)]
                tube(f'rib{t0}{side}', [on(t0 + 0.10 * r_, D(180) + side * (D(10) + D(90) * r_), 0.001) for r_ in R_],
                     [0.0016 + 0.003 * sn(0.1 + r_ * 0.9) for r_ in R_], segs=8)
        horn('spur', on(0.30, D(180), 0.006), -F.f + F.u * 0.6, F.s, 0.07, 0.012, curl=-0.7)
        ball('knuckle', JV[a_], 0.045)
        finish('carapace', f'{bone}.l|carapace', 3500)
