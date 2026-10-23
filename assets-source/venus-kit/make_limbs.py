# Venus: the LIMB grafts. Demon-skull style (biomech-style.md).
#   gauntlet  forearm.l|gauntlet  a bony carapace over the lower forearm, where the flesh ends in the machine
#   talons    hand.l|talons       four long curled talons and a knuckle plate: her weapon (she rakes with them)
#   brace     thigh.l|brace, shin.l|brace, shin.l|knee, thigh.l|piston, shin.l|rod
#             the pneumatic knee brace that carries her weight: an outer thigh plate, a knuckle at the knee, a
#             greave down the shin, and a piston from thigh to shin on the outside
# Each is built on the left and mirrored to the right. PARTS selects a subset.
# NOTE: on these DOWN-pointing bones BoneFrame's s = u x f points INWARD (-x on .l), so the OUTER side is ph -90.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'gauntlet', 'talons', 'brace'}

FA0, FA1 = BONE['forearm.l']; HA0, HA1 = BONE['hand.l']
TH0, TH1 = BONE['thigh.l']; SH0, SH1 = BONE['shin.l']

# ---------------------------------------------------------------- forearm gauntlet
if 'gauntlet' in PARTS:
    drop(['forearm.l|', 'forearm.r|']); clear_work()
    F = BoneFrame(FA0, FA1)
    # Flared at the elbow end (a bell, not a can), narrowing to the wrist.
    rf = lambda t: 0.054 + 0.022 * max(0.0, 0.75 - t) ** 1.5 * 2.2
    rs = lambda t: 0.056 + 0.026 * max(0.0, 0.75 - t) ** 1.5 * 2.2
    A0, A1 = D(-165), D(165)                       # nearly closed: a slit runs up the inner (palm) side
    # The proximal edge sweeps up to a long POINT on the outer side, over the elbow (ph -90 is outward on .l).
    T0 = lambda ph: 0.46 - 0.34 * math.exp(-((ph - D(-90)) / D(32)) ** 2) + 0.05 * (1 - math.cos(ph)) * 0.5
    T1 = lambda ph: 1.06 - 0.03 * math.exp(-((ph - D(90)) / D(50)) ** 2)
    _, P, N = bone_shell('shell', F, T0, T1, A0, A1, rf, rs, 0.010, nu=48, nv=64)
    edge_lips(P, N, 0.0055, n=80)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.16 + 0.86 * i / 60 for i in range(61)]
    cb = lambda t: bell((t - 0.60) / 0.46)
    tube('crest', [on(t, D(-90), 0.003) for t in S], [0.004 + 0.008 * cb(t) for t in S])
    tube('crest2', [on(t, D(-90), 0.014 * cb(t) ** 0.5) for t in S], [0.0012 + 0.005 * cb(t) for t in S])
    for t0 in (0.55, 0.68, 0.81):                 # chevron ribs raking down off the crest, front and back
        R = [i / 24 for i in range(25)]
        for sgn in (-1, 1):
            tube(f'rib{t0}{sgn}', [on(t0 + 0.10 * u, D(-90) + sgn * D(80) * u ** 0.8, 0.001) for u in R],
                 [0.0018 + 0.0032 * sn(0.1 + u * 0.9) for u in R], segs=8)
    for i, t in enumerate((0.30, 0.46, 0.62, 0.78)):   # raked spines up the crest, pointing back at the elbow
        horn(f'sp{i}', on(t, D(-90), 0.012), -F.s - F.u * 0.9, F.f, 0.045 - 0.006 * i, 0.009, curl=0.6)
    ring('wrist', F.at(1.0, 0, 0, 0), F.u, 0.052, 0.006)  # the knuckle ring at the wrist
    sut = [zigzag(lambda s: on(0.58 + 0.38 * s, D(-20)), 0.004, 8, lambda s: F.u)]
    finish('gauntlet', 'forearm.l|gauntlet', 5000, lines=sut)

# ---------------------------------------------------------------- talons and knuckle plate (her weapon)
if 'talons' in PARTS:
    drop(['hand.l|', 'hand.r|']); clear_work()
    F = BoneFrame(HA0, HA1)
    mid = F.at(0.35, 0, 0, 0)
    # The knuckle plate: a bony mitt round the hand core, ridged across the knuckles.
    ball('mitt', mid, 1.0, 0.040, 0.050, 0.052)
    # A hanging hand's fingers line up FRONT TO BACK (palm to the thigh), so the talons spread along F.f and curl
    # INWARD (toward +s, the palm side) round F.f.
    for i, (df, L, r0) in enumerate(((0.032, 0.17, 0.010), (0.011, 0.21, 0.012), (-0.011, 0.20, 0.012), (-0.031, 0.16, 0.010))):
        root = F.at(0.70, 0, 0, 0) + F.f * df - F.s * 0.006
        ball(f'kn{i}', root, 0.016)
        ring(f'knr{i}', root + F.u * 0.006, F.u, 0.015, 0.003)
        # horn() turns d by +curl round its axis: round F.f that swings 'down' toward +x, OUTWARD on .l (the first
        # build; owner: "they point outwards"). Round -F.f they hook in toward the palm.
        horn(f'talon{i}', root + F.u * 0.006, F.u + F.f * df * 3, -F.f, L, r0, curl=1.05)
    # The thumb talon: from the inner front, hooking across.
    horn('thumb', F.at(0.25, 0, 0, 0) + F.f * 0.04 + F.s * 0.02, F.u * 0.6 + F.f * 0.5 + F.s * 0.5, -F.f, 0.11, 0.010, curl=1.2)
    o = fuse('talons', voxel=0.0016)
    decimate(o, 5000)
    # Steel at the knuckles, rust, then dried blood toward the tips (make_spike.py's wear recipe).
    wear_colours(o, Vector((0.42, 0.42, 0.43)), Vector((0.30, 0.15, 0.07)), Vector((0.20, 0.02, 0.02)),
                 F.at(0.4, 0, 0, 0), F.at(0.4, 0, 0, 0) + F.u * 0.20, rust_at=(0.35, 0.65), blood_at=(0.60, 0.92))
    o.data.materials.clear(); o.data.materials.append(bpy.data.materials['skullmetal'])
    install(o, 'hand.l|talons'); mirror_to_r(o, 'hand.r|talons'); clear_work()

# ---------------------------------------------------------------- pneumatic knee brace
if 'brace' in PARTS:
    drop(['thigh.l|', 'thigh.r|', 'shin.l|', 'shin.r|']); clear_work()
    L = SURF['legs']
    lerp_pts = lambda pts, t: Vector(pts[min(len(pts) - 2, int(t * 10))]).lerp(Vector(pts[min(len(pts) - 1, int(t * 10) + 1)]), t * 10 - min(len(pts) - 2, int(t * 10)))
    # The OUTER THIGH PLATE: a carapace on the outside of the lower thigh, sized from the probed skin.
    F = BoneFrame(TH0, TH1)
    # skin distance from the bone axis on the outer side, per t (probed), plus a 3 mm gap
    out_r = lambda t: (bv(*lerp_pts(L['thighOuter'], t)) - (TH0 + (TH1 - TH0) * t)).length + 0.003
    front_r = lambda t: (bv(*lerp_pts(L['thighFront'], t)) - (TH0 + (TH1 - TH0) * t)).length + 0.003
    A0, A1 = D(-150), D(-20)                       # the outer half, back-outer to front-outer
    T0 = lambda ph: 0.52 + 0.05 * math.cos(ph + D(85)) - 0.10 * math.exp(-((ph + D(85)) / D(25)) ** 2)
    T1 = lambda ph: 0.97
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, front_r, out_r, 0.010, nu=40, nv=48)
    edge_lips(P, N, 0.0055, n=70)
    on = lambda t, ph, off=0.0: F.at(t, ph, front_r(t) + off, out_r(t) + off)
    S = [0.50 + 0.46 * i / 40 for i in range(41)]
    tube('crest', [on(t, D(-85), 0.003) for t in S], [0.004 + 0.006 * bell((t - 0.74) / 0.25) for t in S])
    horn('hipspur', on(0.45, D(-85), 0.006), -F.s - F.u * 0.8, F.f, 0.05, 0.010, curl=0.8)
    # The piston's upper mount on the plate.
    mtop = on(0.62, D(-95), 0.016)
    ball('mount', mtop, 0.018)
    finish('thighplate', 'thigh.l|brace', 4000)
    clear_work()
    # THE KNEE KNUCKLE: a bony boss on the outside of the knee with ring ridges, and a skull-cap patella in front.
    FS = BoneFrame(SH0, SH1)
    knee_out = bv(*L['shinOuter'][0]) + Vector((0.012, 0, 0))
    ball('knuckle', knee_out, 1.0, 0.026, 0.044, 0.044)
    ring('kr1', knee_out + Vector((0.010, 0, 0)), Vector((1, 0, 0)), 0.036, 0.006)
    ring('kr2', knee_out + Vector((0.018, 0, 0)), Vector((1, 0, 0)), 0.022, 0.005)
    capc = bv(*L['shinFront'][0]) + FS.f * 0.008 + FS.u * 0.01
    ball('cap', capc, 1.0, 0.045, 0.030, 0.052)
    tube('capcrest', [capc + FS.f * 0.026 + FS.u * (0.045 * (i / 20 - 0.5) * 2) for i in range(21)],
         [0.002 + 0.005 * bell((i / 20 - 0.5) * 2) for i in range(21)])
    horn('kneehorn', capc + FS.f * 0.018 - FS.u * 0.03, FS.f - FS.u * 0.2, FS.s, 0.05, 0.012, curl=1.1)
    finish('knee', 'shin.l|knee', 2600)
    clear_work()
    # THE GREAVE down the front of the shin.
    sfr = lambda t: (bv(*lerp_pts(L['shinFront'], t)) - (SH0 + (SH1 - SH0) * t)).length + 0.003
    sor = lambda t: (bv(*lerp_pts(L['shinOuter'], t)) - (SH0 + (SH1 - SH0) * t)).length + 0.003
    A0, A1 = D(-110), D(80)
    T0 = lambda ph: 0.14 + 0.05 * (1 - math.cos(ph)) * 0.5
    T1 = lambda ph: 0.84 + 0.06 * math.exp(-(ph / D(30)) ** 2)
    _, P, N = bone_shell('greave', FS, T0, T1, A0, A1, sfr, sor, 0.010, nu=48, nv=56)
    edge_lips(P, N, 0.0055, n=80)
    on = lambda t, ph, off=0.0: FS.at(t, ph, sfr(t) + off, sor(t) + off)
    S = [0.14 + 0.76 * i / 50 for i in range(51)]
    cb = lambda t: bell((t - 0.50) / 0.40)
    tube('crest', [on(t, 0, 0.003) for t in S], [0.004 + 0.007 * cb(t) for t in S])
    tube('crest2', [on(t, 0, 0.012 * cb(t) ** 0.5) for t in S], [0.0012 + 0.004 * cb(t) for t in S])
    for i, t in enumerate((0.28, 0.44, 0.60)):
        horn(f'sp{i}', on(t, 0, 0.012), FS.f + FS.u * 0.9, -FS.s, 0.03 + 0.008 * sn((t - 0.15) / 0.6), 0.008, curl=0.6)
    for t0 in (0.25, 0.45, 0.65):
        R = [i / 24 for i in range(25)]
        tube(f'rib{t0}', [on(t0 + 0.12 * u, D(-10) - D(85) * u ** 0.8, 0.001) for u in R], [0.0016 + 0.003 * sn(0.1 + u * 0.9) for u in R], segs=8)
    mbot = on(0.42, D(-95), 0.016)
    ball('mount', mbot, 0.016)
    sut = [zigzag(lambda s: on(0.2 + 0.55 * s, D(50)), 0.004, 9, lambda s: FS.u)]
    finish('greave', 'shin.l|brace', 4500, lines=sut)
    clear_work()
    # THE PISTON: housing on the thigh (top mount to above the knee), chrome rod on the shin (into the greave).
    kneeside = knee_out + Vector((0.030, 0, 0))
    bot = mtop.lerp(kneeside, 0.78)
    ax = (bot - mtop).normalized()
    n = 20
    tube('body', [mtop.lerp(bot, i / n) for i in range(n + 1)], [0.018 * (1.0 - 0.15 * (i / n)) for i in range(n + 1)], segs=16)
    for k in range(3):
        ring(f'rib{k}', mtop.lerp(bot, 0.2 + 0.25 * k), ax, 0.018 * (1.02 - 0.04 * k), 0.004)
    ball('gland', bot, 0.014)
    finish('piston', 'thigh.l|piston', 1500, material='iron')
    clear_work()
    rod = tube('rod', [bot.lerp(mbot, i / 8) for i in range(9)], [0.007] * 9, segs=12)
    plain(rod, 'chrome'); install(rod, 'shin.l|rod'); mirror_to_r(rod, 'shin.r|rod'); clear_work()
