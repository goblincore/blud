# The gamer's furniture (biomech-style.md): a racing-style gaming chair grown round a swollen man, plugged into him.
# Run with ../gorehound-kit/build.py on gamer-kit.blend (all coordinates are gamer.blob's COMPILED metres):
#   Blender -b assets-source/gamer-kit/gamer-kit.blend --python assets-source/gorehound-kit/build.py -- \
#       make_legs.py ../chair-kit/make_throne.py:upper make_gamer.py --export
# The product is still there (glossy black PU upholstery, the `black` look: `leather` rendered tan-brown, red stripes, bucket bolsters, a castor base) but grown in bone-metal.
#   shell    the bucket's upholstery: a racing back (waist, shoulder wings, a pinched neck, a headrest) quilted in
#            diamonds, and the seat with its thigh bolsters. Glossy `black`.
#   stripes  the red racing stripes down the back and along the seat bolsters
#   trim     bone-metal: a rim round the back, a spined crest and ribs up its back, horns off the headrest, the
#            harness-slot grommets the cables come through
#   arms     T-armrests: bone-metal posts, black pads under his elbows
#   base     the gas lift and the five-star castor base, drawn up off the floor like landing gear: vestigial
#   headset  a VR visor fused over his eyes, strapped round his head, a glowing slit (`led`), cables off the back
#   tubes    what plugs him in: an IV pole and blood bag into his arm, lines from the armrests into his forearms,
#            cables from the harness slots into his shoulders, a catheter bundle from his lap down to the gas lift
#   hose     a corrugated feed hose into the corner of his mouth (on the skull, so it stays in when he turns)
#   clamps   his prosthetic hands: a bone-metal cuff on each sawn wrist stump, a bracket, and a C-clamp screwed shut
#            round the joystick's grip; on `hem` with the stick, so they move when he works it
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'shell', 'stripes', 'trim', 'arms', 'base', 'headset', 'tubes', 'hose', 'clamps'}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0)); FWD = Vector((0, -1, 0))
sm = lambda e0, e1, x: (lambda c: c * c * (3 - 2 * c))(max(0.0, min(1.0, (x - e0) / (e1 - e0))))
V = bv


def finish_t(name, kit, tris, material='skullmetal', tint=(1.0, 0.985, 0.96), lines=(), **fk):
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    decimate(o, tris)
    bake_ao(o, material, tint=tint)
    install(o, kit)
    clear_work()
    return o


def lerp_table(tab, y):
    for (y0, v0), (y1, v1) in zip(tab, tab[1:]):
        if y <= y1:
            return v0 + (v1 - v0) * sm(y0, y1, y)
    return tab[-1][1]


def spline(pts, n=40):
    """Catmull-Rom through blender points."""
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


# ---------------------------------------------------------------- the back's shape (blob coords)
# The front surface hugs him: behind his buttocks (z -0.175 at y 0.83), his shoulder blades (-0.07 at 1.33), and
# the back of his head (+0.02 at 1.62), so the headrest takes his head. Racing bolsters wrap forward at the edges.
BY0, BY1 = 0.72, 1.96
zf = lambda y: -0.200 + 0.100 * sm(0.80, 1.35, y) + 0.105 * sm(1.38, 1.62, y)
hw = lambda y: lerp_table([(0.72, 0.36), (1.00, 0.31), (1.32, 0.37), (1.52, 0.205), (1.74, 0.235), (1.96, 0.16)], y)
wing = lambda y: 1.0 - 0.75 * sm(1.40, 1.55, y)
btop = lambda xn: BY1 - 0.10 * xn ** 4


def bp(xn, y, out=0.0):
    """Blender point on the back's front at xn (-1..1 across) and height y, `out` along +z (blob)."""
    return V(xn * hw(y), y, zf(y) + 0.20 * wing(y) * xn ** 4 + out)


def back_P(u, v):
    xn = 2 * u - 1
    return bp(xn, BY0 + (btop(xn) - BY0) * v)


def back_N(u, v):
    e = 1e-3
    du = back_P(min(1, u + e), v) - back_P(max(0, u - e), v); dv = back_P(u, min(1, v + e)) - back_P(u, max(0, v - e))
    n = du.cross(dv).normalized()
    return n if n.dot(FWD) > 0 else -n


# the seat (blob): a rounded pan, its sides rising into thigh bolsters
SHW, SZ0, SZ1, SYT = 0.36, -0.17, 0.46, 0.735
seat_y = lambda xn: SYT + 0.055 * sm(0.62, 0.95, abs(xn))


def seat_P(u, v):
    xn = 2 * u - 1; z = SZ0 + (SZ1 - SZ0) * v
    e = abs(2 * v - 1)
    return V(xn * SHW * (1 - e ** 8) ** 0.125, seat_y(xn) - 0.02 * (1 - (1 - e ** 8) ** 0.125), z)


if 'shell' in PARTS:
    drop(['spine|shell']); clear_work()
    surface_solid('back', back_P, back_N, 60, 80, 0.055)
    surface_solid('seat', seat_P, lambda u, v: UP, 50, 50, 0.070)
    # the neck pillow and the headrest's padding, the gaming chair's two pillows
    ball('neckpillow', bp(0, 1.47, 0.035), 1.0, 0.125, 0.045, 0.050)
    ball('lumbar', bp(0, 1.02, 0.030), 1.0, 0.200, 0.045, 0.085)
    # front roll of the seat
    tube('frontroll', [V(SHW * (2 * i / 40 - 1) * 0.92, SYT - 0.012, SZ1 - 0.012) for i in range(41)], [0.030] * 41)
    # diamond quilting pressed into the back's centre panel and the seat
    q = []
    for k in range(-6, 7):
        q.append([bp(max(-0.55, min(0.55, 0.11 * k + (y - 0.80) * 0.9)) , y, 0.001) for y in [0.80 + 0.66 * i / 30 for i in range(31)]])
        q.append([bp(max(-0.55, min(0.55, 0.11 * k - (y - 0.80) * 0.9)), y, 0.001) for y in [0.80 + 0.66 * i / 30 for i in range(31)]])
    for k in range(-5, 6):
        q.append([V(max(-0.2, min(0.2, 0.06 * k + (z - SZ0) * 0.6)), SYT + 0.001, z) for z in [SZ0 + 0.6 * i / 30 for i in range(31)]])
        q.append([V(max(-0.2, min(0.2, 0.06 * k - (z - SZ0) * 0.6)), SYT + 0.001, z) for z in [SZ0 + 0.6 * i / 30 for i in range(31)]])
    finish_t('shell', 'spine|shell', 22000, material='black', tint=(1, 1, 1), lines=q, noise=0.0012)

if 'stripes' in PARTS:
    drop(['spine|stripes']); clear_work()
    for sx in (-1, 1):
        Y = [0.80 + (1.86 - 0.80) * i / 60 for i in range(61)]
        tube(f'bs{sx}', [bp(sx * 0.66, y, 0.004 + 0.003 * sm(0.62, 0.95, 0.66)) for y in Y], [0.013] * len(Y), segs=10)
        Z = [SZ0 + 0.05 + (SZ1 - SZ0 - 0.1) * i / 40 for i in range(41)]
        tube(f'ss{sx}', [V(sx * SHW * 0.80, seat_y(0.80) + 0.006, z) for z in Z], [0.012] * len(Z), segs=10)
    finish_t('stripes', 'spine|stripes', 3000, material='red', tint=(1, 1, 1), noise=0.0)

if 'trim' in PARTS:
    drop(['spine|trim']); clear_work()
    # the rim: round the back's outline, on its rear edge, a rolled bone-metal lip
    rim = [back_P(0, v) for v in [i / 50 for i in range(51)]] + [back_P(u, 1) for u in [i / 60 for i in range(1, 60)]] + \
          [back_P(1, 1 - v) for v in [i / 50 for i in range(51)]]
    tube('rim', [p + BACK * 0.035 for p in rim], [0.018] * len(rim), segs=10)
    # a spined crest up the back's centre and ribs raking out from it (the chair's ribcage, in metal)
    crest = [bp(0, y, -0.060) for y in [0.78 + 1.12 * i / 60 for i in range(61)]]
    tube('crest', crest, [0.016 + 0.008 * sn(i / 60) for i in range(61)])
    for k, y in enumerate([0.85 + 0.09 * j for j in range(11)]):
        horn(f'sp{k}', bp(0, y, -0.075), BACK + -UP * 0.5, X, 0.045 + 0.02 * sn(k / 10), 0.013, curl=0.4)
        for sx in (-1, 1):
            R = [i / 20 for i in range(21)]
            tube(f'rib{k}{sx}', [bp(sx * 0.9 * r_, y - 0.06 * r_, -0.060) for r_ in R], [0.007 + 0.004 * sn(0.1 + 0.9 * r_) for r_ in R], segs=8)
    # horns off the headrest's shoulders, curling back
    for sx in (-1, 1):
        horn(f'hh{sx}', bp(sx * 0.9, 1.84, -0.03), UP + X * (sx * 0.5) + BACK * 0.3, X * -sx, 0.22, 0.026, curl=1.4)
    # the harness slots: grommets the shoulder cables come through
    for sx in (-1, 1):
        c = bp(sx * 0.52, 1.555, 0.012)
        ring(f'grommet{sx}', c, FWD, 0.034, 0.011)
    finish_t('trim', 'spine|trim', 14000)
    for sx in (-1, 1):                                               # the slots' dark mouths, behind the grommets
        ball(f'slot{sx}', bp(sx * 0.52, 1.555, 0.004), 1.0, 0.030, 0.006, 0.030)
    o = fuse('slots', noise=0.0); decimate(o, 600); plain(o, 'cable'); install(o, 'spine|slots'); clear_work()

if 'arms' in PARTS:
    drop(['spine|armrests', 'spine|pads']); clear_work()
    for sx in (-1, 1):
        top = V(sx * 0.335, 0.905, 0.110); bot = V(sx * 0.350, SYT - 0.02, 0.080)
        n = 20; ax = (top - bot).normalized()
        tube(f'post{sx}', [bot.lerp(top, i / n) for i in range(n + 1)], [0.030 - 0.006 * (i / n) for i in range(n + 1)], segs=14)
        for k in range(4):
            ring(f'prib{sx}{k}', bot.lerp(top, 0.15 + 0.2 * k), ax, 0.031 - 0.0012 * k, 0.005)
        ball(f'knuckle{sx}', bot, 0.040)
        tube(f'bracket{sx}', [top + FWD * (0.10 * (i / 10 - 0.5)) for i in range(11)], [0.018] * 11)
        horn(f'spur{sx}', top + BACK * 0.07, BACK + -UP * 0.4, X, 0.07, 0.014, curl=0.5)
    finish_t('armrests', 'spine|armrests', 6000)
    for sx in (-1, 1):
        ball(f'pad{sx}', V(sx * 0.330, 0.940, 0.120), 1.0, 0.048, 0.185, 0.030)
    finish_t('pads', 'spine|pads', 2500, material='black', tint=(1, 1, 1), noise=0.0008)

if 'base' in PARTS:
    drop(['pelvis|base', 'pelvis|lift', 'pelvis|castors']); clear_work()
    hub = V(0, 0.300, 0.130)
    # the gas-lift sleeve: ribbed bone-metal from the seat's underside down to the hub
    top = V(0, 0.660, 0.130); n = 20
    tube('sleeve', [top.lerp(hub, i / n) for i in range(n + 1)], [0.042 - 0.008 * (i / n) for i in range(n + 1)], segs=16)
    for k in range(5):
        ring(f'srib{k}', top.lerp(hub, 0.1 + 0.18 * k), UP, 0.044 - 0.002 * k, 0.006)
    ball('hubcap', hub, 1.0, 0.075, 0.075, 0.040)
    ends = []
    for j in range(5):
        a = D(90 + 72 * j); d = Vector((math.cos(a), -math.sin(a), 0))  # blob +z (front) is blender -y
        R = [i / 20 for i in range(21)]
        pts = [hub + d * (0.21 * r_) + UP * (-0.03 * r_ + 0.03 * sn(r_)) for r_ in R]
        tube(f'arm{j}', pts, [0.030 - 0.012 * r_ for r_ in R], segs=12)
        tube(f'acrest{j}', [p + UP * (0.024 - 0.008 * r_) for p, r_ in zip(pts, R)][2:-2], [0.004 + 0.004 * sn(r_) for r_ in R][2:-2], segs=8)
        ends.append((pts[-1], d))
    finish_t('base', 'pelvis|base', 7000)
    lift = tube('rod', [V(0, 0.640, 0.130).lerp(V(0, 0.500, 0.130), i / 6) for i in range(7)], [0.022] * 7, segs=16)
    plain_part(lift, 'chrome', 'pelvis|lift', mirror=False)
    for j, (e, d) in enumerate(ends):
        side = d.cross(UP).normalized()
        tube(f'yoke{j}', [e, e - UP * 0.05 + d * 0.015], [0.010, 0.008], segs=10)
        w = e - UP * 0.075 + d * 0.025
        tube(f'wheel{j}', [w - side * 0.018, w + side * 0.018], [0.030, 0.030], segs=20)
    o = fuse('castors', noise=0.0); decimate(o, 3000); plain(o, 'black'); install(o, 'pelvis|castors'); clear_work()

if 'headset' in PARTS:
    drop(['skull|headset', 'skull|visor', 'skull|hcables']); clear_work()
    hc = JV['headC']; ax_, ay_, az_ = HEAD_R
    eye = V(0, 1.645, 0.295)
    # the visor: a heavy goggle box over his eyes, its back pressed into the face
    ball('box', eye, 1.0, 0.150, 0.072, 0.066)
    ball('boxfront', eye + FWD * 0.040, 1.0, 0.140, 0.045, 0.058)
    tube('lip', [eye + FWD * 0.010 + Vector((0.155 * math.cos(2 * math.pi * i / 60), 0, 0.068 * math.sin(2 * math.pi * i / 60))) for i in range(62)], [0.009] * 62, segs=8)
    # bone-metal brow ridges over the box, and two short horns
    for sx in (-1, 1):
        horn(f'vh{sx}', eye + X * (sx * 0.12) + UP * 0.05, UP + X * (sx * 0.6) + BACK * 0.5, BACK, 0.09, 0.016, curl=-0.8 * sx)
    tube('ridge', [eye + UP * 0.060 + FWD * 0.02 + X * (0.12 * (2 * i / 30 - 1)) + UP * 0.01 * sn(i / 30) for i in range(31)], [0.008] * 31, segs=8)
    # the straps: round his head and over its crown
    band = lambda th, yo=0.020: hc + Vector((0, 0, yo)) + Vector(((ax_ + 0.008) * math.cos(th), -(az_ + 0.008) * math.sin(th), 0))
    tube('strap', [band(2 * math.pi * i / 80) for i in range(82)], [0.012] * 82, segs=10)
    tube('topstrap', [hc + Vector(((ax_ + 0.006) * math.cos(a), 0.02, (ay_ + 0.006) * math.sin(a))) for a in [D(10 + 160 * i / 40) for i in range(41)]], [0.012] * 41, segs=10)
    for sx in (-1, 1):
        ball(f'buckle{sx}', band(D(0 if sx > 0 else 180)), 1.0, 0.016, 0.026, 0.026)
    finish_t('headset', 'skull|headset', 9000, material='black', tint=(1, 1, 1), noise=0.0008)
    o = tube('slit', [eye + FWD * 0.083 + X * (0.10 * (2 * i / 20 - 1)) for i in range(21)], [0.010] * 21, segs=10)
    plain_part(o, 'led', 'skull|visor', mirror=False)
    # cables off the back of the headset, drooping into the headrest
    for k, dx in enumerate((-0.05, 0.0, 0.05)):
        a0 = band(D(-90), 0.010) + X * dx
        tube(f'hc{k}', spline([a0, a0 + BACK * 0.03 - UP * 0.05, V(dx * 1.4, 1.53, 0.030), V(dx * 1.6, 1.50, -0.005)], 12), [0.009] * 37, segs=8)
    o = fuse('hcables', noise=0.0); decimate(o, 2500); plain(o, 'cable'); install(o, 'skull|hcables'); clear_work()

if 'tubes' in PARTS:
    drop(['spine|pole', 'spine|bag', 'spine|lines', 'spine|cath', 'spine|cables']); clear_work()
    # the IV pole, grown up off the back's right edge, a hook, the bag
    p0 = V(0.40, 0.95, -0.190); p1 = V(0.42, 2.18, -0.150)
    tube('pole', [p0.lerp(p1, i / 30) for i in range(31)], [0.016] * 31, segs=10)
    for t in (0.0, 0.35):
        ring(f'clamp{t}', p0.lerp(p1, t + 0.05), (p1 - p0).normalized(), 0.021, 0.006)
    hook = p1 + UP * 0.0
    horn('hook', hook, FWD * 0.6 + X * 0.1 - UP * 0.2, X, 0.10, 0.012, curl=2.4)
    horn('top', hook, UP, X, 0.08, 0.016, curl=0.8)
    finish_t('pole', 'spine|pole', 3000)
    bagc = V(0.43, 1.98, -0.075)
    o = ball('bag', bagc, 1.0, 0.062, 0.030, 0.095)
    tube('neck', [bagc - UP * 0.09, bagc - UP * 0.13], [0.012, 0.008], segs=10)
    o = fuse('bag', noise=0.0006); decimate(o, 1500); plain(o, 'red'); install(o, 'spine|bag'); clear_work()
    # lines: the bag into his right upper arm; each armrest into a forearm
    tube('iv', spline([bagc - UP * 0.13, V(0.47, 1.70, 0.020), V(0.42, 1.30, 0.120), V(0.355, 1.18, 0.100)], 14), [0.0065] * 43, segs=8)
    for sx in (-1, 1):
        tube(f'fl{sx}', spline([V(sx * 0.330, 0.945, 0.300), V(sx * 0.30, 0.99, 0.37), V(sx * 0.215, 1.05, 0.32)], 12), [0.006] * 25, segs=8)
    o = fuse('lines', noise=0.0); decimate(o, 2000); plain(o, 'red'); install(o, 'spine|lines'); clear_work()
    # the catheter bundle: from his lap under the gut, over the seat's front roll and down to the gas lift
    for k, dx in enumerate((-0.018, 0.0, 0.018)):
        tube(f'cath{k}', spline([V(dx, 0.76, 0.300), V(dx * 1.5, 0.785, 0.430), V(dx * 2, 0.700, 0.500), V(dx * 2, 0.520, 0.360), V(dx, 0.450, 0.175)], 12), [0.008] * 49, segs=8)
    o = fuse('cath', noise=0.0); decimate(o, 2000); plain(o, 'yellow'); install(o, 'spine|cath'); clear_work()
    # cables from the harness slots, forward and down into the tops of his shoulders
    for sx in (-1, 1):
        for k, (dx, dy) in enumerate(((-0.015, 0.0), (0.012, 0.010), (0.0, -0.015))):
            a0 = bp(sx * 0.52, 1.555, -0.010) + Vector((dx, 0, dy))
            tube(f'sc{sx}{k}', spline([a0, a0 + FWD * 0.06 + UP * 0.01, V(sx * (0.16 + dx), 1.45, 0.010), V(sx * (0.15 + dx), 1.40, 0.040)], 12), [0.009] * 37, segs=8)
    o = fuse('cables', noise=0.0); decimate(o, 3000); plain(o, 'cable'); install(o, 'spine|cables'); clear_work()

if 'hose' in PARTS:
    drop(['skull|hose']); clear_work()
    path = spline([V(-0.035, 1.548, 0.288), V(-0.10, 1.47, 0.270), V(-0.20, 1.42, 0.180), V(-0.30, 1.43, 0.060), V(-0.34, 1.46, -0.020)], 16)
    tube('hose', path, [0.016] * len(path), segs=12)
    for i in range(2, len(path) - 2, 3):                            # corrugation
        d = (path[i + 1] - path[i - 1]).normalized()
        ring(f'cr{i}', path[i], d, 0.017, 0.0045, segs=20)
    finish_t('hose', 'skull|hose', 4000, material='yellow', tint=(0.55, 0.50, 0.42), noise=0.0)

# ---------------------------------------------------------------- clamps: prosthetic hands on the stick
# Owner: his flesh hands fused into the grip were "problematic ... saw his wrists off to bloody stumps and attach
# metal prosthetic c-clamp hands that go around the joystick". gamer.blob's forearms end in stumps at W (compiled);
# each cuff closes round the last 7 cm of a forearm and runs on past the cut over most of the stump's round end, so
# only a raw face shows inside its lip (stopped short of the cut, the stump read as a glossy red ball).
# A bracket runs from the cuff to a C-clamp round the grip (axis x 0, z 0.585), the two clamps at different heights,
# each open at the front and screwed shut across the gap (chrome). All on `hem`, the stick's bone.
if 'clamps' in PARTS:
    drop(['hem|clamps', 'hem|screws']); clear_work()
    GZ = 0.585
    grip_r = lambda y: 0.044 - 0.009 * (y - 1.0595) / 0.16
    screws = []
    for sx, yc in ((1, 1.112), (-1, 1.168)):
        W = V(sx * 0.1266, 1.1127, 0.4878); d = V(sx * -0.4400, 0.1788, 0.8800).normalized()
        rc = grip_r(yc) + 0.019                                     # clear of the grip's flesh (at +8 mm it sank into it)
        # the cuff: a ribbed collar round the stump, a rolled lip at its open front end
        c0 = W - d * 0.050; c1 = W + d * 0.026
        tube(f'cuff{sx}', [c0.lerp(c1, i / 12) for i in range(13)], [0.062 - 0.004 * (i / 12) for i in range(13)], segs=24)
        for k in range(3):
            ring(f'crib{sx}{k}', c0.lerp(c1, 0.2 + 0.3 * k), d, 0.063 - 0.002 * k, 0.005)
        ring(f'clip{sx}', c1, d, 0.059, 0.006)
        # the C: an arc round the grip, open at the front (blob +z is blender -y), jaws at its ends
        cen = V(0, yc, GZ)
        def arc(a):
            return cen + V(rc * math.cos(a), 0, rc * math.sin(a)) - V(0, 0, 0)
        A0, A1 = D(90 + 38), D(90 + 360 - 38)
        pts = [cen + V(rc * math.cos(A0 + (A1 - A0) * i / 40), 0, rc * math.sin(A0 + (A1 - A0) * i / 40)) - V(0, 0, 0) for i in range(41)]
        pts = [Vector((p.x, p.y, p.z)) for p in pts]
        tube(f'c{sx}', pts, [0.012] * 41, segs=12)
        tube(f'ccrest{sx}', [p + (p - cen).normalized() * 0.010 for p in pts[3:-3]], [0.0045] * 35, segs=8)
        ja = cen + V(rc * math.cos(A0), 0, rc * math.sin(A0)); jb = cen + V(rc * math.cos(A1), 0, rc * math.sin(A1))
        ja = Vector((ja.x, ja.y, ja.z)); jb = Vector((jb.x, jb.y, jb.z))
        for j, q in enumerate((ja, jb)):
            ball(f'jaw{sx}{j}', q + (q - cen).normalized() * 0.006, 1.0, 0.016, 0.014, 0.016)
        screws.append((ja + (ja - cen).normalized() * 0.008, jb + (jb - cen).normalized() * 0.008))
        # the bracket: from the cuff's inner side, bowed, to the C's outer side
        out = cen + V(sx * (rc + 0.004), 0, 0); out = Vector((out.x, out.y, out.z))
        st = W - d * 0.030 + V(-sx * 0.045, 0, 0)
        mid = st.lerp(out, 0.5) + UP * 0.020
        br = spline([st, mid, out], 14)
        tube(f'br{sx}', br, [0.013 - 0.003 * (i / (len(br) - 1)) for i in range(len(br))], segs=12)
        tube(f'brc{sx}', [q + UP * 0.010 for q in br[2:-2]], [0.004] * (len(br) - 4), segs=8)
        ball(f'knuck{sx}', out, 0.018); ball(f'knuck2{sx}', st, 0.020)
        horn(f'spur{sx}', mid + UP * 0.012, UP + V(sx * 0.4, 0, -0.3), X, 0.045, 0.009, curl=0.7)
    finish_t('clamps', 'hem|clamps', 9000)
    for k, (a, b) in enumerate(screws):
        ax = (b - a).normalized()
        tube(f'rod{k}', [a - ax * 0.012 + (b - a) * (i / 8) * (1 + 0.024 / max(1e-6, (b - a).length)) for i in range(9)], [0.0045] * 9, segs=10)
        tube(f'th{k}', [b + ax * 0.016 + UP * 0.016, b + ax * 0.016 - UP * 0.016], [0.004, 0.004], segs=8)
        ball(f'nut{k}', a - ax * 0.006, 0.008)
    o = fuse('screws', voxel=0.0010, noise=0.0); decimate(o, 2500); plain(o, 'chrome'); install(o, 'hem|screws'); clear_work()
