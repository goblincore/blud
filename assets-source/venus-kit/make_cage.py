# Venus: the CAGE — a bone-metal spine down her back whose ribs wrap her waist like a corset grown into her, a busk
# down the front of the belly where they close, and the collar at the neck. Demon-skull style (biomech-style.md):
# crests, chevron ribs, rolled lips, knuckle bosses, raked spines, sutures. Everything is laid on the PROBED skin
# (surface.json) and sunk a few millimetres into it: the cage bites, and the .blob's raw lumps swell over it.
# PARTS: corset (spine1), spine (chest), collar (spine2).
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'corset', 'spine', 'collar'}


def spine_pt(y, out=0.0):
    """The back's centreline at height y (blob), pushed `out` metres behind the skin."""
    S = SURF['spine']
    y = min(max(y, S[0][1]), S[-1][1])
    j = next(i for i in range(1, len(S)) if S[i][1] >= y)
    w = (y - S[j - 1][1]) / (S[j][1] - S[j - 1][1])
    z = S[j - 1][2] + (S[j][2] - S[j - 1][2]) * w
    return bv(0, y, z - out)


def vertebrae(y0, y1, n, size, tag, trans=1.5):
    """A run of vertebrae on the back's centreline: centra half-sunk in the skin, a cord through them, spinous
    processes raking down and back, short curled transverse processes."""
    ys = [y0 + (y1 - y0) * i / (n - 1) for i in range(n)]
    cord = [spine_pt(y0 + (y1 - y0) * i / 40, 0.004) for i in range(41)]
    tube(f'{tag}cord', cord, [size * 0.42] * 41)
    for i, y in enumerate(ys):
        c = spine_pt(y, size * 0.25)
        ball(f'{tag}c{i}', c, 1.0, size * 1.25, size * 0.75, size * 0.62)
        ring(f'{tag}r{i}', c, Vector((0, 0, 1)), size * 0.95, size * 0.16)
        horn(f'{tag}sp{i}', c + Vector((0, size * 0.55, 0)), Vector((0, 1, -0.75)), Vector((1, 0, 0)), size * 1.9, size * 0.42, curl=0.55)
        for sx in (-1, 1):
            horn(f'{tag}tr{i}{sx}', c + Vector((sx * size * 0.8, size * 0.15, 0)), Vector((sx, 0.3, -0.25)), Vector((0, 1, 0)) * sx,
                 size * trans, size * 0.32, curl=0.7)


# ---------------------------------------------------------------- corset: three chevron ribs a side, busk, lumbar spine
if 'corset' in PARTS:
    drop(['spine1|']); clear_work()
    BITE = 0.004              # the band's axis sits this far INSIDE the probed skin: it bites, flesh swells round it
    RIBS = ((1.190, 0.0115), (1.145, 0.0125), (1.100, 0.0115))   # back height, band radius
    RAKE = 0.030              # each rib drops this much from the spine to the busk: chevrons, not barrel hoops
    for k, (yb, rr) in enumerate(RIBS):
        for sx in (-1, 1):
            # A flat BAND, not a hoop (round tubes read as barrel hoops): a strip on the skin, tallest over the flank,
            # coming to a point at the busk and rounding off at the spine, with rolled lips and a crest along it.
            HALF = 0.021 * (rr / 0.012)

            def P(u, v, yb=yb, sx=sx, HALF=HALF):
                ang = sx * (math.pi - (math.pi - 0.05) * u)
                h = HALF * (0.55 + 0.45 * sn(0.1 + 0.8 * u)) * (1 - max(0.0, u - 0.82) / 0.18 * 0.85)
                p, nr = waist_pt(yb - RAKE * u ** 1.3 + (v - 0.5) * 2 * h, ang)
                bow = 0.003 * math.cos(math.pi * (v - 0.5))           # convex across the band
                return p + nr * (bow + 0.002)

            def N(u, v, sx=sx, yb=yb):
                ang = sx * (math.pi - (math.pi - 0.05) * u)
                return waist_pt(yb, ang)[1]
            surface_solid(f'band{k}{sx}', P, N, 80, 8, 0.010)
            for w in (0.0, 1.0):
                tube(f'lip{k}{sx}{w}', [P(i / 80, w) - N(i / 80, w) * 0.004 for i in range(81)], [0.0035] * 81, segs=8)
            tube(f'crest{k}{sx}', [P(i / 80, 0.5) + N(i / 80, 0.5) * 0.004 for i in range(4, 77)],
                 [0.0022 + 0.0030 * sn((i - 4) / 72) for i in range(4, 77)], segs=8)
            for j in range(2, 9):                                       # chevron ribs raking down off the crest
                u0 = j / 10
                R = [q / 12 for q in range(13)]
                tube(f'chev{k}{sx}{j}', [P(u0 + 0.025 * q, 0.5 - 0.42 * q) + N(u0, 0.5) * 0.002 for q in R],
                     [0.0016 + 0.0016 * sn(q) for q in R], segs=6)
            for j in range(1, 4):                                         # knuckle bosses along the flank
                u = j / 4.4
                ang = sx * (math.pi - (math.pi - 0.05) * u)
                p, nr = waist_pt(yb - RAKE * u ** 1.3, ang)
                ball(f'kn{k}{sx}{j}', p + nr * 0.004, 1.0, 0.012, 0.012, 0.010)
    # BUSK: a bony bar down the belly's front where the ribs close, knuckles at the joins, a chin-like point at each end.
    yt, ybt = RIBS[0][0] - RAKE + 0.02, RIBS[-1][0] - RAKE - 0.025
    busk = []
    for i in range(41):
        y = yt + (ybt - yt) * i / 40
        p, nr = waist_pt(y, 0.0)
        busk.append(p + nr * 0.002)
    tube('busk', busk, [0.006 + 0.010 * sn(0.05 + 0.9 * i / 40) for i in range(41)], segs=14)
    for k, (yb, rr) in enumerate(RIBS):
        p, nr = waist_pt(yb - RAKE, 0.0)
        ball(f'buskk{k}', p + nr * 0.006, 1.0, 0.021, 0.016, 0.014)
        ring(f'buskr{k}', p + nr * 0.004, Vector((0, -1, 0)), 0.017, 0.0035)
    # The LUMBAR SPINE the ribs hang from: pelvis top to the chest bone.
    vertebrae(1.03, 1.19, 4, 0.023, 'lv')
    sut = []
    for k, (yb, rr) in enumerate(RIBS):
        for sx in (-1, 1):
            path = lambda s, yb=yb, sx=sx: waist_pt(yb - RAKE * (0.25 + 0.5 * s) ** 1.3, sx * (math.pi - (math.pi - 0.05) * (0.25 + 0.5 * s)))[0]
            sut.append(zigzag(path, 0.004, 9, lambda s: Vector((0, 0, 1))))
    finish('corset', 'spine1|corset', 9000, mirror=False, lines=sut)

# ---------------------------------------------------------------- thoracic spine up the back (chest bone)
if 'spine' in PARTS:
    drop(['chest|']); clear_work()
    vertebrae(1.205, 1.365, 5, 0.025, 'tv', trans=0.9)
    # (Scapular hook brackets were tried here and read as a cross from behind; the column alone is cleaner.)
    finish('spine', 'chest|spine', 5000, mirror=False)

# ---------------------------------------------------------------- collar on the neck base (spine2)
if 'collar' in PARTS:
    drop(['spine2|']); clear_work()
    cy, cz, ax, az = 1.500, -0.004, 0.072, 0.074   # an ellipse snug round the neck, sunk into the traps at the sides
    n = 96
    def cp(i, out=0.0, dy=0.0):
        a = 2 * math.pi * i / n
        return bv(math.sin(a) * (ax + out), cy + dy - 0.012 * math.cos(a), cz + math.cos(a) * (az + out))
    tube('band', [cp(i) for i in range(n + 2)], [0.013 + 0.003 * math.cos(4 * math.pi * i / n) for i in range(n + 2)], segs=14)
    tube('lipT', [cp(i, 0.004, 0.012) for i in range(n + 2)], [0.0045] * (n + 2), segs=8)
    tube('lipB', [cp(i, 0.006, -0.012) for i in range(n + 2)], [0.005] * (n + 2), segs=8)
    for k in range(-2, 3):                               # three raked spines up the back of the collar
        i = n // 2 + k * 5
        if k in (-2, 2):
            ball(f'boss{k}', cp(i, 0.010), 0.011)
            continue
        horn(f'sp{k}', cp(i, 0.010, 0.004), Vector((k * 0.25, 1.0, 1.1)), Vector((1, 0, 0)), 0.065 - 0.012 * abs(k), 0.012, curl=-0.7)
    # The throat clasp: a bony beak at the front, pointing down.
    horn('clasp', cp(0, 0.010, 0.008), Vector((0, -0.45, -1)), Vector((1, 0, 0)), 0.04, 0.013, curl=0.6)
    finish('collar', 'spine2|collar', 3500, mirror=False)
