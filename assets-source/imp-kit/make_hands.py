# Imp: the HANDS. It has no fingers (the house rule), so each hand is a BURNING SOCKET caged by fused talons: a
# skullmetal cup flaring open at the end of the hand bone with the fire sitting deep in it, and five long curled talons
# rising off its rim and hooking in over the mouth, like a claw closed round a coal. The fireball is born in this
# socket at the wind-up and leaves from it at the throw (MotionProfile.spit from handTipR), so the hand reads as the
# weapon from across a room: an orange point between dark claws.
#   socket  hand.l|socket  the cup, its rolled rim, a crest and chevron ribs down the outer side (impmetal, glows)
#   talons  hand.l|talons  five curled keratin talons off the rim, near-black at the root (impclaw, glows)
#   ember   hand.l|ember   the coal itself (ventglow: emissive, no light thrown)
# Each is built on the left and mirrored to the right. PARTS selects a subset.
# NOTE: on this DOWN-pointing bone BoneFrame's s = u x f points INWARD (-x on .l), so the OUTER side is ph -90.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'socket', 'talons', 'ember'}

HA0, HA1 = BONE['hand.l']
F = BoneFrame(HA0, HA1)
# The fist: a bony knuckled carapace that swells over the knuckles and flares into the socket's mouth past the bone's
# tail. The first pass was a straight flared tube and read as a plastic drum: now it is short, bulges, and its mouth
# is a crown of five POINTS (the talons spring from them) with notches between.
CUP0, CUP1 = 0.30, 1.10
TALON_PH = (D(-90), D(-18), D(54), D(126), D(198))
cup_r = lambda t: 0.040 + 0.010 * bell((t - 0.55) / 0.35) + 0.018 * max(0.0, (t - 0.78) / (CUP1 - 0.78)) ** 1.6
crown = lambda ph: max(math.exp(-((((ph - a + math.pi) % (2 * math.pi)) - math.pi) / D(16)) ** 2) for a in TALON_PH)
RIM = lambda ph: CUP1 - 0.10 + 0.13 * crown(ph)
# The coal: deep in the socket, so from the front it is a burning disc inside the crown and from the side it is hidden
# behind the metal. Its light (the `_glow` bake) is what shows from the side.
EMBER = F.at(0.96, 0, 0, 0)
EMBER_R = 0.027
LIGHT = [(EMBER, EMBER_R, 1.0)]
on = lambda t, ph, off=0.0: F.at(t, ph, cup_r(t) + off, cup_r(t) + off)

if 'socket' in PARTS:
    drop(['hand.l|socket', 'hand.r|socket']); clear_work()
    _, P, N = bone_shell('cup', F, CUP0, RIM, -math.pi, math.pi, cup_r, cup_r, 0.007, nu=40, nv=96)
    # Rolled lip round the crown, thick like the bone round an eye socket.
    edge_lips(P, N, 0.0050, n=160, which=('u1',), inset=0.003)
    # The back of the fist: a rounded knuckle boss closing the base, and four knuckles across the back (outer, ph -90
    # on .l) where a hand's knuckles would be, each a bony boss with a ring ridge.
    ball('boss', F.at(CUP0 + 0.04, 0, 0, 0), 1.0, 0.043, 0.043, 0.050)
    # Ridges, not balls: round bosses read as a row of marbles (first look).
    for k, ph in enumerate((D(-150), D(-110), D(-70), D(-30))):
        R = [i / 16 for i in range(17)]
        tube(f'kn{k}', [on(0.44 + 0.30 * u, ph, 0.001) for u in R], [0.002 + 0.0075 * sn(u) ** 0.7 for u in R], segs=12)
    # A double crest from the wrist down the outer side to the outer talon's point, and chevron ribs raking off it.
    S = [CUP0 + (RIM(D(-90)) - 0.02 - CUP0) * i / 40 for i in range(41)]
    cb = lambda t: bell((t - 0.72) / 0.45)
    tube('crest', [on(t, D(-90), 0.002) for t in S], [0.003 + 0.005 * cb(t) for t in S])
    tube('crest2', [on(t, D(-90), 0.009 * cb(t) ** 0.5) for t in S], [0.001 + 0.003 * cb(t) for t in S])
    for t0 in (0.72, 0.88):
        R = [i / 20 for i in range(21)]
        for sgn in (-1, 1):
            tube(f'rib{t0}{sgn}', [on(t0 + 0.10 * u, D(-90) + sgn * D(70) * u ** 0.8, 0.001) for u in R],
                 [0.0014 + 0.0026 * sn(0.1 + u * 0.9) for u in R], segs=8)
    # The graft collar where the flesh wrist goes into the metal.
    ring('collar', F.at(CUP0 - 0.02, 0, 0, 0), F.u, cup_r(CUP0) + 0.002, 0.005, segs=48)
    sut = [zigzag(lambda s: on(0.62 + 0.3 * s, D(60)), 0.003, 5, lambda s: F.u)]
    finish('socket', 'hand.l|socket', 5000, material='impmetal', lines=sut, glow=(LIGHT, 0.09, 1.6, 0.5), voxel=0.0016)

if 'talons' in PARTS:
    drop(['hand.l|talons', 'hand.r|talons']); clear_work()
    # One talon from each point of the crown, leaving along the hand and a little out, then curling hard back IN over
    # the socket's mouth (round radial x u, which turns u toward -radial): a claw closed round a coal. The inner one
    # (ph 198, the thumb's place) is the shortest and thickest. The first pass (curl ~1.35, splayed 0.55) hung open.
    roots = []
    for k, (ph, L, r0, curl) in enumerate(zip(TALON_PH, (0.19, 0.20, 0.18, 0.17, 0.14),
                                              (0.013, 0.0135, 0.0125, 0.012, 0.0155), (1.75, 1.70, 1.80, 1.80, 1.95))):
        rad = (F.f * math.cos(ph) + F.s * math.sin(ph)).normalized()
        t = RIM(ph) - 0.03
        root = F.at(t, ph, cup_r(t) + 0.002, cup_r(t) + 0.002)
        ring(f'knr{k}', root, F.u + rad * 0.3, r0 * 1.15, 0.0028)
        horn(f'talon{k}', root - F.u * 0.01, F.u + rad * 0.40, rad.cross(F.u).normalized(), L, r0, curl=curl)
        roots.append(root)
    o = fuse('talons', voxel=0.0013, smooth=(0.5, 3), noise=0.0008, noise_scale=0.02)
    decimate(o, 6000)
    bake_ao(o, material='impclaw', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    # Keratin: near-black at the crown, a dull bone-grey toward the tips (distance from the nearest root).
    tint_ao(o, lambda co: (lambda u: (0.05 + 0.42 * u, 0.04 + 0.36 * u, 0.035 + 0.29 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.15)))
    glow_bake(o, LIGHT, 0.12, 1.6, 0.5)
    install(o, 'hand.l|talons'); mirror_to_r(o, 'hand.r|talons'); clear_work()

if 'ember' in PARTS:
    drop(['hand.l|ember', 'hand.r|ember']); clear_work()
    o = ball('ember', EMBER, 1.0, EMBER_R, EMBER_R, EMBER_R)
    plain_part(o, 'ventglow', 'hand.l|ember')
