# Gorehound legs, all four: the butcher's dog hind leg (assets-source/butcher-kit/make_legs.py, PR goblincore/blud#54)
# in the demon skull's bone-metal (biomech-style.md), wrapped in limb() and run twice. Run inside Blender after
# kit_sculpt.py and hound_common.py; set PARTS first to rebuild a subset (and LIMBS to {'hind'} or {'fore'}).
#   hind: thigh (flesh, no carapace) -> shin = tibia raked back -> foot = metatarsal, the hock between them.
#   fore: upperarm (flesh) -> forearm = radius -> hand = the metacarpal paw. The zigzag is MIRRORED: the elbow
#         points back where the stifle points forward, so the "knee" cap becomes an elbow point with a spur raking
#         back (the shapes are built from the bend itself: cap = bisector of the two bones, so it lands outside
#         whichever way the joint folds), and the "hock" becomes the wrist knuckle.
# The femur carapace is gone: both upper limbs are the pinky's muscle, the machine starts at the middle joint.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'knee', 'tibia', 'hock', 'cannon', 'toes', 'pistons', 'wires'}
try:
    LIMBS
except NameError:
    LIMBS = {'hind', 'fore'}
try:
    TOE_STYLE                                                   # 'paw' (three toes and talons) or 'spike' (one stilt talon)
except NameError:
    TOE_STYLE = 'paw'
X = Vector((1, 0, 0))


def limb(A, B, C, T, up, mid, low):
    # ---------------------------------------------------------------- knee: skull-cap patella with a forward horn
    if 'knee' in PARTS:
        drop([f'{mid}.l|knee', f'{mid}.r|knee']); clear_work()
        F = BoneFrame(B, C)
        Ft = BoneFrame(A, B)
        fwd = (Ft.u + F.u * -1).normalized()                         # the knee's point: bisects femur-in and tibia-out
        cap = B + fwd * 0.045
        ball('cap', cap, 1.0, 0.046, 0.042, 0.042)
        tube('capcrest', [cap + fwd * 0.036 + X.cross(fwd).normalized() * (0.04 * (i / 20 - 0.5) * 2) for i in range(21)],
             [0.003 + 0.005 * bell((i / 20 - 0.5) * 2) for i in range(21)])
        horn('kneehorn', cap + fwd * 0.02, fwd + Vector((0, 0, 0.5)), X, 0.07, 0.014, curl=-1.0)
        for sx in (-1, 1):
            k = B + X * (sx * 0.058)
            ball(f'knuckle{sx}', k, 1.0, 0.024, 0.044, 0.044)
            ring(f'kring{sx}', k + X * (sx * 0.010), X, 0.036, 0.0055)
        finish('knee', f'{mid}.l|knee', 2600)

    # ---------------------------------------------------------------- tibia: a blade raked back, crest and spines behind
    if 'tibia' in PARTS:
        drop([f'{mid}.l|tibia', f'{mid}.r|tibia']); clear_work()
        F = BoneFrame(B, C)
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
        finish('tibia', f'{mid}.l|tibia', 5000, lines=sut)

    # ---------------------------------------------------------------- hock: the reverse knee, a knuckle and a curled spur
    if 'hock' in PARTS:
        drop([f'{low}.l|hock', f'{low}.r|hock']); clear_work()
        Fs = BoneFrame(B, C); Fm = BoneFrame(C, T)
        back = (Fs.u - Fm.u).normalized()                            # the point of the hock: tibia-in minus metatarsal-out
        ball('core', C + back * 0.012, 1.0, 0.042, 0.046, 0.046)
        for sx in (-1, 1):
            k = C + X * (sx * 0.046)
            ball(f'boss{sx}', k, 1.0, 0.020, 0.036, 0.036)
            ring(f'ring{sx}', k + X * (sx * 0.008), X, 0.028, 0.0048)
        horn('spur', C + back * 0.035, back + Vector((0, 0, 0.9)), X, 0.11, 0.020, curl=0.9)
        tube('heelcrest', [C + back * (0.040 + 0.004 * sn(i / 16)) + Vector((0, 0, 0.03 - 0.06 * i / 16)) for i in range(17)],
             [0.004 + 0.004 * sn(i / 16) for i in range(17)])
        finish('hock', f'{low}.l|hock', 2500)

    # ---------------------------------------------------------------- metatarsal: a long thin bony cannon
    if 'cannon' in PARTS:
        drop([f'{low}.l|cannon', f'{low}.r|cannon']); clear_work()
        F = BoneFrame(C, T)
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
        finish('cannon', f'{low}.l|cannon', 3500)

    # ---------------------------------------------------------------- toes: three splayed bony toes, curled talons, a dewclaw
    if 'toes' in PARTS and TOE_STYLE == 'spike':
        # STILT TIPS (the gibbet): no paw, the leg ends in one curled talon that takes the floor at its point, the
        # parasite's walking spikes. A knuckle at the toe joint, a collar ring, the talon curling forward and down.
        drop([f'{low}.l|toes', f'{low}.r|toes']); clear_work()
        Fm = BoneFrame(C, T)
        ball('knuckle', T, 1.0, 0.030, 0.030, 0.030)
        ring('collar', T - Fm.u * 0.025, Fm.u, 0.030, 0.006)
        horn('talon', T + Vector((0, 0, 0.004)), Fm.u + Vector((0, -0.4, 0)), X, 0.11, 0.024, curl=0.9)
        horn('spur', T - Fm.u * 0.03, -Fm.f + Vector((0, 0, 0.6)), X, 0.06, 0.010, curl=-0.6)
        finish('toes', f'{low}.l|toes', 2500)
    elif 'toes' in PARTS:
        drop([f'{low}.l|toes', f'{low}.r|toes']); clear_work()
        base = T + Vector((0, 0, 0.008))
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
        finish('toes', f'{low}.l|toes', 4000, flatten=0.0)

    # ---------------------------------------------------------------- pistons: an Achilles ram behind the tibia, one down the cannon
    if 'pistons' in PARTS:
        drop([f'{mid}.l|piston', f'{mid}.r|piston', f'{mid}.l|rod', f'{mid}.r|rod', f'{low}.l|piston', f'{low}.r|piston', f'{low}.l|rod', f'{low}.r|rod'])
        for bone, F, ph, t0, t1, t2, r, off in ((mid, BoneFrame(B, C), D(150), 0.14, 0.62, 0.86, 0.020, 0.068),
                                                (low, BoneFrame(C, T), D(-25), 0.16, 0.52, 0.78, 0.014, 0.046)):
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



if 'hind' in LIMBS: limb(JV['hip'], JV['knee'], JV['hock'], JV['toe'], 'thigh', 'shin', 'foot')
if 'fore' in LIMBS: limb(JV['shoulder'], JV['elbow'], JV['wrist'], JV['paw'], 'upperarm', 'forearm', 'hand')

# ---------------------------------------------------------------- wires: coloured cables wound round the lower legs
try:
    WIRE_MATS
except NameError:
    WIRE_MATS = ('red', 'cable')
if 'wires' in PARTS:
    for key, (B, C, mid) in {'hind': ('knee', 'hock', 'shin'), 'fore': ('elbow', 'wrist', 'forearm')}.items():
        if key not in LIMBS: continue
        drop([f'{mid}.l|wire', f'{mid}.r|wire']); clear_work()
        F = BoneFrame(JV[B], JV[C])
        prof = lambda t: math.exp(-((t - 0.22) / 0.34) ** 2)
        w = tube('w', helix(F, 0.16, 0.80, 1.3, lambda t: 0.040 + 0.020 * prof(t), lambda t: 0.046 + 0.014 * prof(t), 0.008, phase=D(200)), [0.005] * 121, segs=8)
        plain_part(w, WIRE_MATS[0], f'{mid}.l|wireA')
        w = tube('w', helix(F, 0.10, 0.55, 0.7, lambda t: 0.040 + 0.020 * prof(t), lambda t: 0.046 + 0.014 * prof(t), 0.008, phase=D(20)), [0.0045] * 121, segs=8)
        plain_part(w, WIRE_MATS[1], f'{mid}.l|wireB')

# ---------------------------------------------------------------- weight: the pinky's legs are thick
# 1.5x radially about each bone (the sculpts are the butcher's slim-zombie sizes); the joints and paws 1.35x round
# their own joint, so the talons spread wider without lifting off the floor (the toe joints sit on it).
try:
    HEAVY
except NameError:
    HEAVY = {'fore': 1.5, 'hind': 1.6}
for key, (B, C, T, mid, low) in {'hind': ('knee', 'hock', 'toe', 'shin', 'foot'),
                                  'fore': ('elbow', 'wrist', 'paw', 'forearm', 'hand')}.items():
    if key not in LIMBS: continue
    k = HEAVY[key]
    for s, sx in (('l', 1), ('r', -1)):
        P = lambda n: Vector((JV[n].x * sx, JV[n].y, JV[n].z))
        for part in ('tibia', 'piston', 'rod', 'wireA', 'wireB'):
            thicken(f'{mid}.{s}|{part}', P(B), P(C), k)
        for part in ('cannon', 'piston', 'rod'):
            thicken(f'{low}.{s}|{part}', P(C), P(T), k)
        thicken(f'{mid}.{s}|knee', P(B), P(C), k * 0.9, k * 0.9, about=P(B))
        thicken(f'{low}.{s}|hock', P(C), P(T), k * 0.9, k * 0.9, about=P(C))
        thicken(f'{low}.{s}|toes', P(C), P(T), k * 0.9, 1.0, about=P(T))
