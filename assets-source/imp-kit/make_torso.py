# Imp: the TORSO's hard parts.
#   heart     spine|heart      THE FORGE-HEART in the chest wound: a skullmetal housing (an ellipsoid shell, crested top
#                              and bottom, vent ribs on its flanks) split down the front in a burning almond slit, half
#                              buried in the meat (impmetal, lit from inside)
#   ember     spine|ember      the fire inside it, seen through the slit (ventglow)
#   ribs      spine|ribs       the ribcage PRISED OPEN round it: four broken ribs a side breaking out of the wound's
#                              edges and reaching in over the housing like fingers gripping the heart, bloody at the
#                              root, bone at the tip (impclaw, lit by the heart)
#   spines    spine|spines     a row of bony spines raking back and up along the upper back (keratin)
#   spikes    clavicle.l|spikes  two spikes off each shoulder, raked back (keratin)
# The heart is the SOURCE of the imp's fire: make_conduits.py runs glowing fuel lines from its flanks over the
# shoulders and down the arms into the burning fists. (The first chest, a cage of bars over a glowing orb between two
# hooked spreader blades, read as an afterthought: owner, 2026-10-24.)
# The wound and the back sit on the probed skin (skin.json, scripts/imp-skin.ts).
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'heart', 'ember', 'ribs', 'spines', 'spikes'}

UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0))
WY = 1.33 - LOWER                                   # the wound's centre height (imp.blob: spine at=0.62): the heart sits IN it, meat showing all round
W, WN = skin('front', 'torso', 0.0, WY)
# The heart's frame: fw out of the wound, hu up the chest, hs across it (toward the body's left, blender +x).
fw = WN.normalized(); hu = (UP - fw * UP.dot(fw)).normalized(); hs = hu.cross(fw).normalized()
HC = W - fw * 0.014                         # its centre, sunk so the meat swells round its back half
HA, HB, HCZ = 0.042, 0.058, 0.034           # semi-axes across, up and out
EMBER_R = (0.022, 0.044, 0.022)
LIGHT = [(HC + fw * 0.010, 0.022, 1.0)]


def heart_pt(phi, th, grow=0.0):
    """A point on the heart's ellipsoid: phi from the front pole (0) back, th round it (0 = up, +90 toward hs)."""
    return HC + fw * ((HCZ + grow) * math.cos(phi)) + (hu * ((HB + grow) * math.cos(th)) + hs * ((HA + grow) * math.sin(th))) * math.sin(phi)


# The slit: open widest at its top and bottom points, an almond standing up the chest.
SLIT = lambda th: 0.38 + 0.26 * math.cos(th) ** 2   # waist 0.26 here pinched it into a peanut (the axes are unequal)

if 'heart' in PARTS:
    drop(['spine|spreader', 'spine|furnace', 'spine|heart']); clear_work()
    P = lambda u, v: heart_pt(SLIT(2 * math.pi * v) + (1.95 - SLIT(2 * math.pi * v)) * u, 2 * math.pi * v)
    def N(u, v):
        p = P(u, v); d = p - HC
        n = Vector((d.dot(hs) / HA ** 2, d.dot(hu) / HB ** 2, d.dot(fw) / HCZ ** 2))
        return (hs * n.x + hu * n.y + fw * n.z).normalized()
    surface_solid('shell', P, N, 28, 96, 0.006, closed_v=True)
    # Rolled lips round the slit, thick like bone round an eye.
    tube('lip', [P(0, k / 192) + N(0, k / 192) * 0.001 for k in range(193)], [0.0045] * 193, segs=10)
    # A crest up the top and down the bottom from the slit's points, fading round the back: a base and a blade.
    for ci, th in enumerate((0.0, math.pi)):   # names stay integral: Blender reads 'crest3.14159...' as a .NNN suffix and aborts
        S = [SLIT(th) + (1.7 - SLIT(th)) * i / 30 for i in range(31)]
        W_ = [math.sin(math.pi * i / 30) for i in range(31)]
        tube(f'crest{ci}', [heart_pt(ph, th, 0.002) for ph in S], [0.003 + 0.006 * w for w in W_])
        tube(f'crestb{ci}', [heart_pt(ph, th, 0.002 + 0.010 * w) for ph, w in zip(S, W_)], [0.001 + 0.003 * w for w in W_])
    # Vent ribs on the flanks: chevrons raking back from the slit's edge.
    for sgn in (1, -1):
        for k, th0 in enumerate((55, 90, 125)):
            R = [i / 16 for i in range(17)]
            tube(f'vent{sgn}{k}', [heart_pt(SLIT(math.radians(sgn * th0)) + 0.15 + 0.85 * u, math.radians(sgn * (th0 + 18 * u)), 0.003) for u in R],
                 [0.0015 + 0.0030 * sn(0.1 + 0.9 * u) for u in R], segs=8)
    # A tight glow, at the slit's lips only: at reach 0.07 the whole housing burned orange and lost its metal.
    finish('heart', 'spine|heart', 6000, mirror=False, material='impmetal', glow=(LIGHT, 0.032, 2.0, 0.3), voxel=0.0013)

if 'ember' in PARTS:
    drop(['spine|ember']); clear_work()
    o = ball('ember', Vector(), 1.0, 1.0, 1.0, 1.0)
    for v in o.data.vertices:
        c = v.co.copy(); v.co = HC + fw * 0.004 + hs * (c.x * EMBER_R[0]) + hu * (c.z * EMBER_R[1]) + fw * (c.y * EMBER_R[2])
    plain_part(o, 'ventglow', 'spine|ember', mirror=False)

if 'ribs' in PARTS:
    drop(['spine|ribs']); clear_work()
    roots = []
    for sx in (1, -1):
        out = hs * sx
        # Traced ALONG the probed skin: each breaks out of the meat at the wound's outer edge, arches over the skin and
        # reaches in to hook onto the housing's flank, bone fingers gripping the heart. Bursting straight forward they
        # showed as stubs and pegs; a straight horn across the chest's curve buried itself and left only its tip. The
        # gap at the middle lets the conduit through.
        for k, (y, y1, x0) in enumerate(((1.402, 1.372, 0.098), (1.366, 1.350, 0.108), (1.296, 1.310, 0.108), (1.258, 1.286, 0.098))):
            N_ = 24; pts = []; rad = []
            for i_ in range(N_ + 1):
                u = i_ / N_
                x = x0 + (0.033 - x0) * u; yy = y + (y1 - y) * u
                sp, sn_ = skin('front', 'torso', sx * x, yy - LOWER)
                # Under the skin at the root only, then held clear all the way onto the housing. Shallow at the root showed a rounded
                # sausage end; an arch that dived again at the tip left detached worms that never reached the heart.
                e = min(1.0, u / 0.35); off = -0.012 + 0.026 * e * e * (3 - 2 * e)
                pts.append(sp + sn_ * off); rad.append(0.0085 * (1 - u) ** 0.7 + 0.0012)
            tube(f'rib{sx}{k}', pts, rad, segs=12)
            roots.append(pts[0])
    o = fuse('ribs', voxel=0.0013, smooth=(0.5, 3), noise=0.0008, noise_scale=0.02)
    decimate(o, 3500)
    bake_ao(o, material='impclaw', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    # Bloody where they tear out of the meat, old bone toward the broken tips.
    tint_ao(o, lambda co: (lambda u: (0.28 + 0.40 * u, 0.05 + 0.52 * u, 0.05 + 0.40 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.06)))
    glow_bake(o, LIGHT, 0.045, 2.0, 0.4)
    install(o, 'spine|ribs'); clear_work()

if 'spines' in PARTS:
    drop(['spine|spines']); clear_work()
    roots = []
    # The ridge: down the middle of the upper back, longest between the shoulder blades; a shorter row either side.
    for x, y, L, r0 in ((0, 1.30, 0.06, 0.013), (0, 1.36, 0.08, 0.016), (0, 1.42, 0.09, 0.017), (0, 1.48, 0.07, 0.014),
                        (0.05, 1.38, 0.045, 0.011), (-0.05, 1.38, 0.045, 0.011),
                        (0.055, 1.45, 0.05, 0.012), (-0.055, 1.45, 0.05, 0.012)):
        p, n = skin('back', 'torso', x, y - LOWER)
        base = p - n * 0.008
        d0 = (n + UP * 0.9).normalized()
        horn(f'sp{x}{y}', base, d0, Vector((-1, 0, 0)), L + 0.008, r0, curl=0.7)
        roots.append(p)
    o = fuse('spines', voxel=0.0016, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 4000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.07 + 0.42 * u, 0.06 + 0.36 * u, 0.05 + 0.29 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.08)))
    install(o, 'spine|spines'); clear_work()

if 'spikes' in PARTS:
    drop(['clavicle.l|spikes', 'clavicle.r|spikes']); clear_work()
    roots = []
    # Off the top of the deltoid (imp.blob: clavicle at=0.95, r 0.070), raked up, out and back.
    for base_b, dir_b, L, r0 in (((0.195, 1.495, 0.130), (0.45, 1.0, -0.65), 0.085, 0.015),
                                 ((0.165, 1.505, 0.105), (0.25, 1.0, -0.85), 0.060, 0.012)):
        base = bv(base_b[0], base_b[1] - LOWER, base_b[2]); d0 = bv(*dir_b).normalized()
        horn(f'spk{L}', base, d0, d0.cross(BACK).normalized(), L, r0, curl=0.7)
        roots.append(base)
    o = fuse('spikes', voxel=0.0016, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 2500)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.07 + 0.42 * u, 0.06 + 0.36 * u, 0.05 + 0.29 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.08)))
    install(o, 'clavicle.l|spikes'); mirror_to_r(o, 'clavicle.r|spikes'); clear_work()
