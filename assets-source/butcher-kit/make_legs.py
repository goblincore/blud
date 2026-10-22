# Butcher legs: a dog's hind leg in the demon skull's bone-metal (biomech-style.md). Run inside Blender after
# kit_sculpt.py and butcher_common.py; set PARTS first to rebuild a subset.
# The zigzag is the .blob's rest pose (butcher.blob, THE LEGS): femur forward to the knee, tibia raked BACK to the
# hock, a long metatarsal down to the toes. The hock is the read, so it gets the biggest shape: a knuckle with a
# curled spur raking back and up, the silhouette of a reverse knee from any side.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'femur', 'knee', 'tibia', 'hock', 'cannon', 'toes', 'pistons', 'wires'}

HIP, KNEE, HOCK, TOE = JV['hip'], JV['knee'], JV['hock'], JV['toe']
X = Vector((1, 0, 0))

# ---------------------------------------------------------------- femur carapace (thigh)
if 'femur' in PARTS:
    drop(['thigh.l|femur', 'thigh.r|femur']); clear_work()
    F = BoneFrame(HIP, KNEE)
    prof = lambda t: math.exp(-((t - 0.40) / 0.36) ** 2)        # a haunch: widest at mid-thigh, tight at the knee
    rf = lambda t: 0.058 + 0.026 * prof(t)
    rs = lambda t: 0.062 + 0.018 * prof(t)
    A0, A1 = D(-160), D(80)
    T0 = lambda ph: 0.16 + 0.05 * (1 - math.cos(ph)) * 0.5      # tucks under the flesh haunch (r 0.095 at the hip)
    T1 = lambda ph: 0.88 + 0.08 * math.exp(-(ph / D(30)) ** 2)  # a point over the knee at the front
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, rf, rs, 0.011, nu=50, nv=56)
    edge_lips(P, N, 0.0058, n=70)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.18 + 0.74 * i / 50 for i in range(51)]
    cb = lambda t: bell((t - 0.55) / 0.38)
    tube('crest', [on(t, D(-10), 0.003) for t in S], [0.004 + 0.008 * cb(t) for t in S])
    tube('crest2', [on(t, D(-10), 0.015 * cb(t) ** 0.5) for t in S], [0.0013 + 0.005 * cb(t) for t in S])
    for t0 in (0.26, 0.42, 0.58):                                # chevron ribs raking down and back from the crest
        R = [i / 26 for i in range(27)]
        tube(f'ribo{t0}', [on(t0 + 0.18 * u, D(-14) - D(100) * u ** 0.8, 0.001) for u in R], [0.0019 + 0.0038 * sn(0.1 + u * 0.9) for u in R], segs=8)
        tube(f'ribi{t0}', [on(t0 + 0.12 * u, D(-8) + D(60) * u ** 0.8, 0.001) for u in R], [0.0017 + 0.003 * sn(0.1 + u * 0.9) for u in R], segs=8)
    horn('hipspur', on(0.24, D(-95), 0.003), -F.s - F.u * 0.4 + F.f * -0.3, F.f, 0.06, 0.011, curl=0.9)
    sut = [zigzag(lambda s: on(0.25 + 0.55 * s, D(-60)), 0.0045, 9, lambda s: (on(0.25 + 0.55 * s, D(-66)) - on(0.25 + 0.55 * s, D(-60))).normalized())]
    finish('femur', 'thigh.l|femur', 5500, lines=sut)

# ---------------------------------------------------------------- knee: skull-cap patella with a forward horn
if 'knee' in PARTS:
    drop(['shin.l|knee', 'shin.r|knee']); clear_work()
    F = BoneFrame(KNEE, HOCK)
    Ft = BoneFrame(HIP, KNEE)
    fwd = (Ft.u + F.u * -1).normalized()                         # the knee's point: bisects femur-in and tibia-out
    cap = KNEE + fwd * 0.045
    ball('cap', cap, 1.0, 0.046, 0.042, 0.042)
    tube('capcrest', [cap + fwd * 0.036 + X.cross(fwd).normalized() * (0.04 * (i / 20 - 0.5) * 2) for i in range(21)],
         [0.003 + 0.005 * bell((i / 20 - 0.5) * 2) for i in range(21)])
    horn('kneehorn', cap + fwd * 0.02, fwd + Vector((0, 0, 0.5)), X, 0.07, 0.014, curl=-1.0)
    for sx in (-1, 1):
        k = KNEE + X * (sx * 0.058)
        ball(f'knuckle{sx}', k, 1.0, 0.024, 0.044, 0.044)
        ring(f'kring{sx}', k + X * (sx * 0.010), X, 0.036, 0.0055)
    finish('knee', 'shin.l|knee', 2600)

# ---------------------------------------------------------------- tibia: a blade raked back, crest and spines behind
if 'tibia' in PARTS:
    drop(['shin.l|tibia', 'shin.r|tibia']); clear_work()
    F = BoneFrame(KNEE, HOCK)
    prof = lambda t: math.exp(-((t - 0.22) / 0.34) ** 2)
    rf = lambda t: 0.040 + 0.020 * prof(t)
    rs = lambda t: 0.046 + 0.014 * prof(t)
    A0, A1 = D(40), D(320)                                       # wraps the back and both sides; the front stays open
    T0 = lambda ph: 0.10 + 0.05 * (1 + math.cos(ph)) * 0.5
    T1 = lambda ph: 0.90 - 0.04 * (1 + math.cos(ph)) * 0.5
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, rf, rs, 0.010, nu=50, nv=56)
    edge_lips(P, N, 0.0052, n=70)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.10 + 0.80 * i / 50 for i in range(51)]
    cb = lambda t: bell((t - 0.45) / 0.45)
    tube('crest', [on(t, D(180), 0.003) for t in S], [0.004 + 0.008 * cb(t) for t in S])
    tube('crest2', [on(t, D(180), 0.014 * cb(t) ** 0.5) for t in S], [0.0013 + 0.0045 * cb(t) for t in S])
    for i, t in enumerate((0.20, 0.34, 0.48, 0.62, 0.76)):      # spines raking down the back ridge (the reference's spiked leg)
        horn(f'sp{i}', on(t, D(180), 0.013), -F.f + F.u * 1.1, F.s, 0.035 + 0.02 * sn((t - 0.1) / 0.7), 0.009, curl=-0.55)
    for side in (-1, 1):
        R = [i / 26 for i in range(27)]
        for t0 in (0.18, 0.38, 0.58):
            tube(f'rib{side}{t0}', [on(t0 + 0.14 * u, D(180) + side * (D(10) + D(85) * u ** 0.8), 0.001) for u in R],
                 [0.0016 + 0.0034 * sn(0.1 + u * 0.9) for u in R], segs=8)
    sut = [zigzag(lambda s: on(0.2 + 0.6 * s, D(110)), 0.004, 9, lambda s: (on(0.2 + 0.6 * s, D(116)) - on(0.2 + 0.6 * s, D(110))).normalized())]
    finish('tibia', 'shin.l|tibia', 5000, lines=sut)

# ---------------------------------------------------------------- hock: the reverse knee, a knuckle and a curled spur
if 'hock' in PARTS:
    drop(['foot.l|hock', 'foot.r|hock']); clear_work()
    Fs = BoneFrame(KNEE, HOCK); Fm = BoneFrame(HOCK, TOE)
    back = (Fs.u - Fm.u).normalized()                            # the point of the hock: tibia-in minus metatarsal-out
    ball('core', HOCK + back * 0.012, 1.0, 0.042, 0.046, 0.046)
    for sx in (-1, 1):
        k = HOCK + X * (sx * 0.046)
        ball(f'boss{sx}', k, 1.0, 0.020, 0.036, 0.036)
        ring(f'ring{sx}', k + X * (sx * 0.008), X, 0.028, 0.0048)
    horn('spur', HOCK + back * 0.035, back + Vector((0, 0, 0.9)), X, 0.11, 0.020, curl=0.9)
    tube('heelcrest', [HOCK + back * (0.040 + 0.004 * sn(i / 16)) + Vector((0, 0, 0.03 - 0.06 * i / 16)) for i in range(17)],
         [0.004 + 0.004 * sn(i / 16) for i in range(17)])
    finish('hock', 'foot.l|hock', 2500)

# ---------------------------------------------------------------- metatarsal: a long thin bony cannon
if 'cannon' in PARTS:
    drop(['foot.l|cannon', 'foot.r|cannon']); clear_work()
    F = BoneFrame(HOCK, TOE)
    prof = lambda t: math.exp(-((t - 0.15) / 0.40) ** 2)
    rf = lambda t: 0.032 + 0.010 * prof(t)
    rs = lambda t: 0.036 + 0.008 * prof(t)
    A0, A1 = D(-170), D(170)
    T0 = lambda ph: 0.10
    T1 = lambda ph: 0.82 - 0.06 * (1 + math.cos(ph)) * 0.5
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, rf, rs, 0.009, nu=44, nv=48)
    edge_lips(P, N, 0.0045, n=60, which=('u0', 'u1'))
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.12 + 0.68 * i / 40 for i in range(41)]
    tube('crest', [on(t, 0, 0.003) for t in S], [0.003 + 0.005 * bell((t - 0.45) / 0.4) for t in S])
    for t in (0.30, 0.50, 0.70):
        ring(f'band{t}', F.h + F.u * (F.L * t), F.u, rf(t) + 0.004, 0.0042)
    finish('cannon', 'foot.l|cannon', 3500)

# ---------------------------------------------------------------- toes: three splayed bony toes, curled talons, a dewclaw
if 'toes' in PARTS:
    drop(['foot.l|toes', 'foot.r|toes']); clear_work()
    base = TOE + Vector((0, 0, 0.008))
    ball('ball', base + Vector((0, -0.012, 0.008)), 1.0, 0.048, 0.050, 0.034)
    for i, sx in enumerate((-1, 0, 1)):
        root = base + Vector((sx * 0.050, -0.135 - 0.02 * (sx == 0), -0.008))
        st = base + Vector((sx * 0.015, -0.01, 0.012))
        R = [j / 20 for j in range(21)]
        cen = [st.lerp(root, u) + Vector((0, 0, 0.018 * sn(u))) for u in R]
        rr = [0.030 - 0.012 * u for u in R]
        tube(f'toe{i}', cen, rr, segs=14)
        tube(f'toeridge{i}', [c + Vector((0, 0, r - 0.002)) for c, r in zip(cen, rr)][2:-2], [0.0035 + 0.0025 * sn(u) for u in R][2:-2], segs=8)
        ball(f'kn{i}', root + Vector((0, 0, 0.006)), 0.021)
        horn(f'talon{i}', root + Vector((0, -0.012, 0.004)), Vector((sx * 0.4, -1, 0.15)), X, 0.085 if sx == 0 else 0.07, 0.016, curl=1.0)
    horn('dewclaw', base + Vector((0.035, 0.03, 0.05)), Vector((0.3, 0.6, -0.3)), X, 0.05, 0.010, curl=-0.8)
    finish('toes', 'foot.l|toes', 4000, flatten=0.0)

# ---------------------------------------------------------------- pistons: an Achilles ram behind the tibia, one down the cannon
if 'pistons' in PARTS:
    drop(['shin.l|piston', 'shin.r|piston', 'shin.l|rod', 'shin.r|rod', 'foot.l|piston', 'foot.r|piston', 'foot.l|rod', 'foot.r|rod'])
    for bone, F, ph, t0, t1, t2, r, off in (('shin', BoneFrame(KNEE, HOCK), D(150), 0.14, 0.62, 0.86, 0.020, 0.068),
                                            ('foot', BoneFrame(HOCK, TOE), D(-25), 0.16, 0.52, 0.78, 0.014, 0.046)):
        clear_work()
        top = F.at(t0, ph, off, off); bot = F.at(t1, ph, off * 0.85, off * 0.85); rodend = F.at(t2, ph, off * 0.6, off * 0.6)
        n = 20; ax = (bot - top).normalized()
        tube('body', [top.lerp(bot, i / n) for i in range(n + 1)], [r * (1.0 - 0.15 * (i / n)) for i in range(n + 1)], segs=14)
        for k in range(3):
            ring(f'rib{k}', top.lerp(bot, 0.2 + 0.25 * k), ax, r * (1.02 - 0.03 * k), 0.0045)
        ball('mount', top - ax * 0.008, r * 1.25)
        ball('gland', bot, r * 0.8)
        finish(bone + 'piston', f'{bone}.l|piston', 1400, material='iron')
        rod = tube('rod', [bot.lerp(rodend, i / 8) for i in range(9)], [r * 0.4] * 9, segs=10)
        plain_part(rod, 'chrome', f'{bone}.l|rod')

# ---------------------------------------------------------------- wires: coloured cables wound round the leg (the reference figure)
if 'wires' in PARTS:
    drop(['thigh.l|wire', 'thigh.r|wire', 'shin.l|wire', 'shin.r|wire'])
    clear_work()
    F = BoneFrame(HIP, KNEE)
    prof = lambda t: math.exp(-((t - 0.40) / 0.36) ** 2)
    w = tube('w', helix(F, 0.30, 0.82, 0.9, lambda t: 0.058 + 0.026 * prof(t), lambda t: 0.062 + 0.018 * prof(t), 0.009, phase=D(40)), [0.0055] * 121, segs=8)
    plain_part(w, 'yellow', 'thigh.l|wireY')
    F = BoneFrame(KNEE, HOCK)
    prof = lambda t: math.exp(-((t - 0.22) / 0.34) ** 2)
    w = tube('w', helix(F, 0.16, 0.80, 1.3, lambda t: 0.040 + 0.020 * prof(t), lambda t: 0.046 + 0.014 * prof(t), 0.008, phase=D(200)), [0.005] * 121, segs=8)
    plain_part(w, 'blue', 'shin.l|wireB')
    w = tube('w', helix(F, 0.10, 0.55, 0.7, lambda t: 0.040 + 0.020 * prof(t), lambda t: 0.046 + 0.014 * prof(t), 0.008, phase=D(20)), [0.0045] * 121, segs=8)
    plain_part(w, 'yellow', 'shin.l|wireY')
