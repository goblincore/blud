# Tallow: the BOILER in his back. His fat is rendered here before it goes down the arms to the cannons: a swollen
# bone-metal sac SUNK into the fat of his back (Cronenberg: the meat has grown round it; tallow.blob's rim prims swell
# over its edge), a crest down its middle with chevron ribs raking off it, two curled chimney horns, and a slit through
# which the fire shows (the imp's lesson: a glowing part needs a reason, and shows through a slit). Under it a smaller
# lobe, the manifold. The first pass's clamping talons and crest spines read as a spiked ball strapped on: gone.
#   boiler  chest|boiler  the sac, manifold, crest, ribs and chimneys (impmetal, glows round the slit)
#   fire    chest|fire    the fire seen through the slit (ventglow)
#   gore    chest|gore    torn meat and blood all round where the sac goes into his back (gore)
# One part on the centreline, not mirrored. PARTS selects a subset.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'boiler', 'fire', 'gore'}

BACK = 180
Y0 = 1.36                       # the sac's centre height (blob y): between the shoulder blades
C = tp(Y0, BACK, 0.045)         # its centre, only 4.5 cm off the skin: two thirds of it is in his back
NB = tn(Y0, BACK)               # out of his back (blender)
UP = Vector((0, 0, 1)); SIDE = UP.cross(NB).normalized()   # his left
AX, AZ, AN = 0.235, 0.215, 0.150                            # half-width, half-height, half-depth


def sac(lat, lon, off=0.0):
    """Point on the sac: lat -90 (bottom) .. 90 (top), lon 0 = straight out of his back, 90 = his left."""
    la, lo = math.radians(lat), math.radians(lon)
    d = SIDE * (math.cos(la) * math.sin(lo)) + NB * (math.cos(la) * math.cos(lo)) + UP * math.sin(la)
    p = C + SIDE * (AX * d.dot(SIDE)) + NB * (AN * d.dot(NB)) + UP * (AZ * d.dot(UP))
    n = (SIDE * (d.dot(SIDE) / AX) + NB * (d.dot(NB) / AN) + UP * (d.dot(UP) / AZ)).normalized()
    return p + n * off


MAN = tp(1.12, BACK, 0.020)     # the manifold lobe, half sunk
SLIT = [sac(lat, 0, 0.0) for lat in (-34, 30)]
FIRE = sac(-2, 0, -0.030)
LIGHT = [(FIRE, 0.035, 1.0)]

if 'boiler' in PARTS:
    drop(['chest|boiler']); clear_work()
    ball('sac', C, 1.0, 1.0, 1.0, 1.0)
    o = bpy.data.objects['sac']
    for v in o.data.vertices:
        d = v.co - C
        v.co = C + SIDE * (AX * d.dot(SIDE)) + NB * (AN * d.dot(NB)) + UP * (AZ * d.dot(UP))
    ball('man', MAN, 0.105, 1.5, 1.0, 1.0)
    # The neck between sac and manifold.
    tube('neck', [sac(-80, 0, -0.03).lerp(MAN, i / 8) for i in range(9)], [0.070 - 0.012 * sn(i / 8) for i in range(9)], segs=14)
    # The crest: a double ridge over the top and down the middle, broken by the slit.
    for nm, (a, b) in (('top', (150, 38)), ('bot', (-42, -86))):
        L = [a + (b - a) * i / 30 for i in range(31)]
        P_ = lambda lat: sac(lat if lat <= 90 else 180 - lat, 0 if lat <= 90 else 180)
        tube(f'crest{nm}', [P_(l) + NB * 0.004 for l in L], [0.012 + 0.012 * sn(i / 30) for i in range(31)])
        tube(f'crest2{nm}', [sac(min(l, 90), 0, 0.030 * sn(i / 30) + 0.010) if l <= 90 else P_(l) for i, l in enumerate(L)],
             [0.005 + 0.007 * sn(i / 30) for i in range(31)])
    # The slit: two rolled lips, an almond between them.
    for sgn in (-1, 1):
        L = [-36 + 68 * i / 24 for i in range(25)]
        tube(f'lip{sgn}', [sac(l, sgn * 13 * sn(i / 24) ** 0.8, 0.004) for i, l in enumerate(L)],
             [0.006 + 0.010 * sn(i / 24) for i in range(25)], segs=12)
    # Chevron ribs raking out and DOWN from the crest on both sides.
    for lat0 in (62, 34, 6, -22, -50):
        R = [i / 26 for i in range(27)]
        for sgn in (-1, 1):
            tube(f'rib{lat0}{sgn}', [sac(lat0 - 30 * u, sgn * (16 + 80 * u ** 0.9), 0.003) for u in R],
                 [0.005 + 0.011 * sn(0.06 + u * 0.94) for u in R], segs=10)
    # Exhaust stacks: two heavy pipes off the top corners with a flange, a band and a flared cap (the third pass:
    # industrial, not the curled chimney horns the owner read as florid).
    for sgn in (-1, 1):
        base = sac(46, sgn * 62, -0.02); sd = (UP * 1.0 + SIDE * sgn * 0.45 + NB * 0.15).normalized()
        prism(f'stack{sgn}', base, base + sd * 0.17, 0.036, 12)
        prism(f'stackf{sgn}', base + sd * 0.01, base + sd * 0.03, 0.054, 12)
        prism(f'stackb{sgn}', base + sd * 0.10, base + sd * 0.115, 0.042, 12)
        prism(f'stackc{sgn}', base + sd * 0.16, base + sd * 0.19, 0.046, 12)
        for k in range(4):
            e1, e2, _ = basis(sd); a = k * math.pi / 2 + math.pi / 4
            bolt(f'sbt{sgn}{k}', base + sd * 0.03 + (e1 * math.cos(a) + e2 * math.sin(a)) * 0.045, sd, r=0.007, h=0.008)
    sut = [zigzag(lambda s, sg=sg: sac(60 - 110 * s, sg * 48), 0.007, 8, lambda s: UP) for sg in (-1, 1)]
    finish('boiler', 'chest|boiler', 14000, mirror=False, material='impmetal', lines=sut, glow=(LIGHT, 0.085, 2.0, 0.3),
           voxel=0.0042, smooth=(0.5, 3), noise=0.0045, noise_scale=0.07)

if 'fire' in PARTS:
    drop(['chest|fire']); clear_work()
    # A flattened almond just under the lips' crest, standing out of the sac's skin so the lips frame it.
    o = ball('fire', Vector(), 1.0, 0.020, 0.012, 0.090)
    M = Matrix((SIDE, NB, UP)).transposed().to_4x4()
    o.data.transform(M); o.data.transform(Matrix.Translation(sac(-3, 0, 0.004)))
    plain_part(o, 'ventglow', 'chest|fire', mirror=False)

if 'gore' in PARTS:
    drop(['chest|gore']); clear_work()
    # Round the sac where it comes out of the fat (tallow.blob's rim prims rise ~2 cm past the skin there): lumps on
    # the sac's surface at that depth, lying back against it, and blood running down off the bottom.
    import random
    rng = random.Random(4)
    q = 0.14; qq = math.sqrt(1 - q * q)
    for k in range(26):
        ph = 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / 26
        d = SIDE * (math.cos(ph) * qq) + UP * (math.sin(ph) * qq) + NB * q
        p = C + SIDE * (AX * d.dot(SIDE)) + NB * (AN * d.dot(NB)) + UP * (AZ * d.dot(UP))
        n = (SIDE * (d.dot(SIDE) / AX) + NB * (d.dot(NB) / AN) + UP * (d.dot(UP) / AZ)).normalized()
        lump(f'bg{k}', p, (n + NB * 0.6), rng.uniform(0.018, 0.034), flat=0.55, stretch=rng.uniform(1.0, 1.7), spin=rng.uniform(0, math.pi))
    for j, ph in enumerate((-1.30, -1.62, -1.95)):
        d = SIDE * (math.cos(ph) * qq) + UP * (math.sin(ph) * qq) + NB * q
        p = C + SIDE * (AX * d.dot(SIDE)) + NB * (AN * d.dot(NB)) + UP * (AZ * d.dot(UP))
        drip(f'bd{j}', p, rng.uniform(0.05, 0.11), rng.uniform(0.006, 0.008))
    finish_gore('bgore', 'chest|gore', 3500, mirror=False)
