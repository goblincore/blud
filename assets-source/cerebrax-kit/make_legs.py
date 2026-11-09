# Cerebrax legs, all four (the same leg run on the hind and fore joints; every part is built on .l and mirrored).
# Run after kit_sculpt.py, butcher_common.py and this kit's common.py (build.py does that). PARTS picks a subset:
#   strut  the upper leg, socket -> high knee: a tapered skullmetal beam, a double crest along its top, chevron ribs
#          raking back from it, a cranial suture down its flank, and a hydraulic ram slung under it (iron cylinder,
#          chrome rod): the reference's second strut, sculpted
#   knee   the black joint cap (the reference's caps) as a demon-skull knuckle: a domed cap on the bend's bisector, a
#          crest over it, ringed bosses on the hinge axis, and a horn curling up and back off its crown: the highest
#          point of the silhouette, so it carries the biggest shape
#   shin   the long leg: a smooth silver bone-metal tube (polished chrome rendered black) in two sculpted collars, a raked blade with spines
#          down its outer back, and a ring band every third of the way
#   foot   a black ankle knuckle and a curled talon taking the floor at its point (the gibbet's spike, TOE_STYLE)
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'strut', 'knee', 'shin', 'foot'}
try:
    LIMBS
except NameError:
    LIMBS = {'hind', 'fore'}
UPZ = Vector((0, 0, 1))


def spider_leg(H, K, A, T, up, mid, low):
    hinge = (K - H).cross(A - K).normalized()          # the knee's hinge axis (both bones lie in its plane)
    # ------------------------------------------------------------------------------------------- the upper strut
    if 'strut' in PARTS:
        drop([f'{up}.l|strut', f'{up}.r|strut', f'{up}.l|rod', f'{up}.r|rod']); clear_work()
        F = BoneFrame(H, K, fwd=UPZ)                    # ph 0 = the beam's top (toward the sky), ph 90 = its outer side
        prof = lambda t: math.exp(-((t - 0.30) / 0.30) ** 2)
        rf = lambda t: 0.070 + 0.035 * prof(t) - 0.012 * t
        rs = lambda t: 0.060 + 0.020 * prof(t) - 0.010 * t
        # The ends come to points: the top runs on past the bottom at both ends, like a skull's cheek sweep.
        T0 = lambda ph: 0.05 + 0.04 * (1 - math.cos(ph)) * 0.5
        T1 = lambda ph: 0.95 - 0.05 * (1 - math.cos(ph)) * 0.5
        _, P, N = bone_shell('beam', F, T0, T1, D(-178), D(178), rf, rs, 0.022, nu=70, nv=48)
        edge_lips(P, N, 0.010, n=80, which=('u0', 'u1'))
        on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
        S = [0.08 + 0.84 * i / 60 for i in range(61)]
        cb = lambda t: bell((t - 0.48) / 0.46)
        tube('crest', [on(t, 0, 0.004) for t in S], [0.007 + 0.012 * cb(t) for t in S])
        tube('crest2', [on(t, 0, 0.024 * cb(t) ** 0.5) for t in S], [0.002 + 0.006 * cb(t) for t in S])
        # Chevron ribs raking BACK (toward the socket) and down from the crest on both flanks.
        for side in (-1, 1):
            R = [i / 24 for i in range(25)]
            for t0 in (0.22, 0.38, 0.54, 0.70):
                tube(f'rib{side}{t0}', [on(t0 - 0.10 * u, side * (D(8) + D(95) * u ** 0.8), 0.002) for u in R],
                     [0.003 + 0.0065 * sn(0.1 + u * 0.9) for u in R], segs=8)
        # Spines raking back along the crest's top.
        for i, t in enumerate((0.30, 0.50, 0.70)):
            horn(f'sp{i}', on(t, 0, 0.020), F.f * 1.0 - F.u * 0.9, F.s, 0.07 + 0.03 * sn((t - 0.2) / 0.6), 0.013, curl=-0.6)
        sut = [zigzag(lambda s: on(0.18 + 0.62 * s, D(70)), 0.008, 10, lambda s: (on(0.18 + 0.62 * s, D(78)) - on(0.18 + 0.62 * s, D(70))).normalized())]
        finish_part('strut', f'{up}.l|strut', 9000, mirror=True, lines=sut, voxel=0.0045, noise=0.004, noise_scale=0.06)
        # The ram under the beam: an iron cylinder from near the socket, a chrome rod into a lug under the knee.
        clear_work()
        top = F.at(0.14, D(180), rf(0.14) + 0.050, rs(0.14) + 0.050)
        bot = F.at(0.62, D(180), rf(0.62) + 0.045, rs(0.62) + 0.045)
        end = F.at(0.90, D(180), rf(0.90) + 0.030, rs(0.90) + 0.030)
        ax = (bot - top).normalized(); n = 20
        tube('body', [top.lerp(bot, i / n) for i in range(n + 1)], [0.034 * (1.0 - 0.12 * i / n) for i in range(n + 1)], segs=16)
        for k in range(4): ring(f'rr{k}', top.lerp(bot, 0.15 + 0.22 * k), ax, 0.035 - 0.002 * k, 0.006)
        ball('mount', top - ax * 0.012, 0.040)
        ball('gland', bot, 0.028)
        ball('lug', end, 0.030)
        tube('web', [top, F.at(0.14, D(180), rf(0.14) - 0.01, rs(0.14) - 0.01)], [0.020, 0.020], segs=10)
        tube('web2', [end, F.at(0.90, D(180), rf(0.90) - 0.01, rs(0.90) - 0.01)], [0.018, 0.018], segs=10)
        finish_part('ram', f'{up}.l|ram', 3000, material='iron', mirror=True, voxel=0.004, noise=0.0015)
        rod = tube('rod', [bot.lerp(end, i / 8) for i in range(9)], [0.015] * 9, segs=14)
        plain_part(rod, 'chrome', f'{up}.l|rod')

    # ------------------------------------------------------------------------------------------- the knee cap
    if 'knee' in PARTS:
        drop([f'{mid}.l|knee', f'{mid}.r|knee']); clear_work()
        u_in = (K - H).normalized(); u_out = (A - K).normalized()
        point = (u_in - u_out).normalized()             # the knee's point: bisects the strut in and the shin out
        side = hinge if hinge.dot(Vector((K.x, 0, 0))) > 0 else -hinge   # the hinge axis, pointing outboard
        cap = K + point * 0.050
        ball('cap', cap, 1.0, 0.125, 0.125, 0.125)
        ball('capfront', cap + point * 0.06 + u_in * 0.02, 1.0, 0.085, 0.085, 0.085)
        ar = point.cross(side).normalized()
        tube('capcrest', [cap + point * (0.118 + 0.02 * bell(s)) + ar * (0.16 * s) for s in [i / 15 - 0.5 for i in range(31)][::2]],
             [0.006 + 0.012 * bell(s * 2) for s in [i / 15 - 0.5 for i in range(31)][::2]])
        for sx in (-1, 1):
            k = K + side * (sx * 0.100)
            ball(f'boss{sx}', k, 1.0, 0.075, 0.075, 0.075)
            ring(f'bring{sx}', k + side * (sx * 0.030), side, 0.062, 0.012)
            ring(f'bring2{sx}', k + side * (sx * 0.052), side, 0.040, 0.009)
        # The horn off the crown, curling up and back over the knee: the silhouette's high point.
        horn('kneehorn', cap + point * 0.09, point + UPZ * 0.6 - u_out * 0.2, side, 0.30, 0.042, curl=-1.5)
        horn('kneespur', cap + point * 0.06 - u_in * 0.06, point - u_in * 0.8, side, 0.13, 0.020, curl=0.9)
        finish_part('knee', f'{mid}.l|knee', 6000, material='black', mirror=True, voxel=0.0045, noise=0.003, ao=(1.6, 1.2))

    # ------------------------------------------------------------------------------------------- the chrome shin
    if 'shin' in PARTS:
        drop([f'{mid}.l|tube', f'{mid}.r|tube', f'{mid}.l|collar', f'{mid}.r|collar']); clear_work()
        F = BoneFrame(K, A, fwd=Vector((K.x, K.y, 0)).normalized())   # ph 0 = outboard
        rad = lambda t: 0.060 - 0.016 * t + 0.010 * math.exp(-((t - 0.10) / 0.10) ** 2)
        S = [0.05 + 0.95 * i / 60 for i in range(61)]   # into the ankle ball: 0.93 left a gap over the foot
        # Silver bone-metal, not plain chrome: polished chrome reflects the dark level and rendered as a black rod
        # (first engine look), while the caps should be the dark parts (the reference's black joint caps).
        tube('tube', [F.h + F.u * (F.L * s) for s in S], [rad(s) for s in S], segs=28)
        finish_part('tube', f'{mid}.l|tube', 3000, mirror=True, voxel=0.004, noise=0.0015, noise_scale=0.08, ao=(1.3, 1.3))
        rf = lambda t: rad(t) + 0.016
        # The top collar: a sleeve with a pointed lower edge running down the outer side.
        T0 = lambda ph: 0.03
        T1 = lambda ph: 0.17 + 0.07 * (0.5 + 0.5 * math.cos(ph)) ** 3
        _, P, N = bone_shell('collar', F, T0, T1, D(-178), D(178), rf, rf, 0.016, nu=30, nv=48)
        edge_lips(P, N, 0.009, n=60, which=('u0', 'u1'))
        # The bottom collar: a cuff over the ankle's top.
        _, P2, N2 = bone_shell('cuff', F, 0.86, 0.985, D(-178), D(178), lambda t: rad(t) + 0.020, lambda t: rad(t) + 0.020, 0.016, nu=16, nv=48)
        edge_lips(P2, N2, 0.009, n=60, which=('u0',))
        for tt in (0.38, 0.62):
            ring(f'band{tt}', F.h + F.u * (F.L * tt), F.u, rad(tt) + 0.010, 0.010)
        # The blade: a raked fin down the outer back of the shin's top half, spines off its edge.
        on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rf(t) + off)
        B = [0.12 + 0.36 * i / 40 for i in range(41)]
        bh = lambda t: 0.055 * sn((t - 0.12) / 0.36)
        for j in range(5):
            tube(f'fin{j}', [on(t, D(20), 0.004 + bh(t) * j / 4) for t in B], [0.008 - 0.001 * j + 0.004 * sn((t - 0.12) / 0.36) for t in B], segs=8)
        for i, tt in enumerate((0.18, 0.28, 0.38)):
            horn(f'sp{i}', on(tt, D(20), bh(tt) + 0.004), F.at(0, D(20), 1, 1) - F.h + F.u * 0.8, F.f.cross(F.u), 0.09, 0.012, curl=-0.5)
        finish_part('collar', f'{mid}.l|collar', 7000, mirror=True, voxel=0.004, noise=0.003)

    # ------------------------------------------------------------------------------------------- the foot
    if 'foot' in PARTS:
        drop([f'{low}.l|foot', f'{low}.r|foot']); clear_work()
        Fm = BoneFrame(A, T)
        ball('ankle', A, 1.0, 0.080, 0.080, 0.080)
        ring('collar', A + Fm.u * 0.06, Fm.u, 0.066, 0.012)
        out = Vector((A.x, A.y, 0)).normalized()
        # The talon: from the ankle down, curling outward so its point takes the floor ~2 cm past the toe joint.
        horn('talon', A + Fm.u * 0.04, Fm.u + out * 0.15, out.cross(Fm.u).normalized(), 0.26, 0.060, curl=0.5)
        horn('spur', A - out * 0.05 + UPZ * 0.02, -out + UPZ * 0.3, out.cross(UPZ).normalized(), 0.11, 0.022, curl=-0.7)
        finish_part('foot', f'{low}.l|foot', 4000, material='black', mirror=True, voxel=0.004, noise=0.002, ao=(1.6, 1.2), flatten=0.0)


if 'hind' in LIMBS: spider_leg(JV['hip'], JV['knee'], JV['hock'], JV['toe'], 'thigh', 'shin', 'foot')
if 'fore' in LIMBS: spider_leg(JV['shoulder'], JV['elbow'], JV['wrist'], JV['paw'], 'upperarm', 'forearm', 'hand')
