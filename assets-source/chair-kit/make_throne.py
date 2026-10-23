# The chair's furniture (biomech-style.md): a throne of bone and bone-metal grown round a seated man. Run with
# ../gorehound-kit/build.py on chair-kit.blend:
#   Blender -b assets-source/chair-kit/chair-kit.blend --python assets-source/gorehound-kit/build.py -- \
#       make_legs.py make_throne.py --export
# Bone-metal (skullmetal) for the plates, bare bone (tooth) for what grew out of him: the column, the ribs, the talons.
#   seat     the pan he sits in and the skirt hanging round it, the skirt's edge drawn down to a keel point in the
#            middle of each side (a pelvis's crest, not a plank) and lifted at the four corners where the legs leave
#   back     the backrest: a tall bone-metal panel, concave round him, arched at the top, horned finials at the corners
#   spine    bare bone up the back of the panel: a vertebral column with spinous spikes, and ribs raking out and down
#            from it, the upper ones curling forward round the panel's edges into a wingback's wings
#   arms     the armrests: troughs his forearms lie in, shackled at two points, on bony turned posts; his fingers have
#            grown out into talons that curl down over each armrest's end
#   crown    a bone-metal band round his head, spined, bolted into his temples (it rides the skull, so it turns with him)
#   upper    the back legs' femur carapaces (the gibbet's)
#   studs    brass buttons tufting his skin where it has spread over the seat and back as a chesterfield cushion
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'seat', 'back', 'spine', 'arms', 'crown', 'upper', 'studs'}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0)); FWD = Vector((0, -1, 0))
IVORY = (1.0, 0.96, 0.88)
sm = lambda e0, e1, x: (lambda c: c * c * (3 - 2 * c))(max(0.0, min(1.0, (x - e0) / (e1 - e0))))


def finish_t(name, kit, tris, material='skullmetal', tint=(1.0, 0.985, 0.96), lines=(), **fk):
    """hound_common.finish without the mirror, with a tint on the baked AO (bone wants a warmer cast)."""
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    decimate(o, tris)
    bake_ao(o, material, tint=tint)
    install(o, kit)
    clear_work()
    return o


# ---------------------------------------------------------------- seat: pan + skirt
# The pan's outline is a superellipse (n 6: a rounded rectangle) in blob x/z; he sits on its back two-thirds.
# The pan stops just behind his knees (0.417) so they overhang its front edge and his shins drop clear in front of
# the skirt: run under them, it hid the shins and the knees read as stumps.
HW, Z0, Z1, YT = 0.275, -0.125, 0.365, 0.565
ZC, HZ = (Z0 + Z1) / 2, (Z1 - Z0) / 2
sgnp = lambda a, e: math.copysign(abs(a) ** e, a)


def outline(th, k=1.0):
    """Blob (x, z) of the pan's edge at angle th (0 = his right... +x, 90 deg = front), scaled k toward the centre."""
    return HW * k * sgnp(math.cos(th), 1 / 3), ZC + HZ * k * sgnp(math.sin(th), 1 / 3)


def out_n(th):
    """Outward horizontal normal (blender) of the outline at th."""
    e = 1e-3
    x0, z0 = outline(th - e); x1, z1 = outline(th + e)
    n = bv(x1 - x0, 0, z1 - z0).normalized().cross(UP).normalized()
    x, z = outline(th)
    return n if n.dot(bv(x, 0, z - ZC)) > 0 else -n


def op(th, y, k=1.0):
    """Blender point on the outline at angle th, height y."""
    x, z = outline(th, k)
    return bv(x, y, z)


# the skirt's lower edge: corners (|cos 2th| = 0) lifted to 0.50 where the legs leave, a keel point mid-side
skirt_y = lambda th: 0.505 - 0.10 * abs(math.cos(2 * th)) ** 4

if 'seat' in PARTS:
    drop(['spine|seat']); clear_work()
    def P(u, v):
        x, z = outline(2 * math.pi * v, u)
        return bv(x, YT - 0.014 * bell(x / HW) * bell((z - 0.12) / 0.30), z)
    surface_solid('pan', P, lambda u, v: UP, 24, 96, 0.050, closed_v=True)
    def S(u, v):
        th = 2 * math.pi * v; x, z = outline(th)
        y = YT - 0.01 + (skirt_y(th) - (YT - 0.01)) * u
        return bv(x, y, z) + out_n(th) * (0.006 * sn(u))          # a slight belly to the skirt
    surface_solid('skirt', S, lambda u, v: out_n(2 * math.pi * v), 16, 160, 0.020, closed_v=True)
    # rolled lips: round the pan's top edge and along the skirt's hem
    tube('toplip', [op(2 * math.pi * i / 160, YT - 0.004) + out_n(2 * math.pi * i / 160) * 0.004 for i in range(162)], [0.011] * 162, segs=10)
    tube('hem', [op(2 * math.pi * i / 200, skirt_y(2 * math.pi * i / 200)) for i in range(202)], [0.009] * 202, segs=10)
    # chevron ribs down the skirt, raking from the top lip toward each keel point
    for side in range(4):
        thm = side * math.pi / 2                                   # mid-side
        for k in (-3, -2, -1, 1, 2, 3):
            th0 = thm + k * 0.13
            R = [i / 14 for i in range(15)]
            pts = []
            for r_ in R:
                th = th0 - k * 0.035 * r_
                x, z = outline(th)
                pts.append(bv(x, YT - 0.02 - (YT - 0.02 - skirt_y(th) - 0.012) * r_ * 0.85, z) + out_n(th) * 0.004)
            tube(f'chev{side}{k}', pts, [0.0025 + 0.004 * sn(0.1 + r_ * 0.9) for r_ in R], segs=8)
        # a keel horn hanging off each mid-side point, curling under
        x, z = outline(thm); n = out_n(thm)
        horn(f'keel{side}', bv(x, skirt_y(thm) + 0.01, z), -UP + n * 0.4, n.cross(UP).normalized(), 0.07, 0.016, curl=-0.9)
    # corner blocks: bony knuckles where the legs come out
    for th in (D(45), D(135), D(225), D(315)):
        x, z = outline(th)
        ball(f'corner{th:.2f}', bv(x * 0.97, 0.53, z * 0.97 + ZC * 0.03), 1.0, 0.036, 0.036, 0.040)
    # the front's carving: a skull boss under his knees, two horns sweeping out from it along the skirt
    fc = op(D(90), 0.475) + FWD * 0.012
    ball('boss', fc, 1.0, 0.050, 0.030, 0.042)
    ball('brow', fc + UP * 0.022 + FWD * 0.004, 1.0, 0.062, 0.020, 0.016)
    for sx in (-1, 1):
        horn(f'bosshorn{sx}', fc + X * (sx * 0.035) + UP * 0.01, X * sx + UP * 0.15, FWD, 0.12, 0.014, curl=sx * -0.9)
    sut = [zigzag(lambda s: op(D(-60) + D(300) * s, YT + 0.001, 0.55), 0.005, 18, lambda s: UP.cross(out_n(D(-60) + D(300) * s)))]
    finish_t('seat', 'spine|seat', 16000, lines=sut)

# ---------------------------------------------------------------- backrest panel
# Its front sits 2.5 cm behind the back of the skin membrane he is sunk into (chair.blob's three back ellipsoids,
# whose back faces are at z -0.09 at y 0.80, -0.06 at 1.05 and -0.027 at 1.30): flush with it, the ellipsoids'
# blend and the skin noise pushed flesh THROUGH the 4 cm panel and out of its back. Its edges wrap forward round
# him (concave), past the membrane's edges, and hide the gap.
BY0, BY1 = 0.54, 1.50
zf = lambda y: -0.120 + 0.035 * sm(0.70, 1.05, y) + 0.033 * sm(1.05, 1.32, y)
bhw = lambda y: 0.255 + 0.025 * bell((y - 1.22) / 0.30)          # broader across his shoulders and head
btop = lambda x: BY1 + 0.10 * bell(x / 0.17) ** 1.5 - 0.06 * (x / 0.28) ** 2   # a pointed arch


def bp(xn, y, out=0.0):
    """Blob-point on the panel's front at x = xn * half-width(y), pushed `out` along its forward normal."""
    x = xn * bhw(y)
    return bv(x, y, zf(y) + 0.075 * xn ** 2 + out)


if 'back' in PARTS:
    drop(['spine|back']); clear_work()
    def P(u, v):
        xn = 2 * u - 1
        y = BY0 + (btop(xn * bhw(1.4)) - BY0) * v
        return bp(xn, y)
    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, min(1, v + e)) - P(u, max(0, v - e))
        n = du.cross(dv).normalized()
        return n if n.dot(FWD) > 0 else -n
    surface_solid('panel', P, N, 48, 64, 0.045)
    # rolled lips up both edges and over the arch
    tube('liptop', [P(i / 80, 1) + N(i / 80, 1) * -0.012 for i in range(81)], [0.012] * 81, segs=10)
    for u in (0, 1):
        tube(f'lipside{u}', [P(u, i / 60) + N(u, i / 60) * -0.012 for i in range(61)], [0.012] * 61, segs=10)
    # finials: horns at the top corners, raking up and out and curling back
    for sx in (-1, 1):
        base = P(0.5 + sx * 0.5, 1) + N(0.5 + sx * 0.5, 1) * -0.02
        horn(f'finial{sx}', base, UP + X * (sx * 0.35), X * -sx, 0.24, 0.030, curl=1.5)
        horn(f'finial2{sx}', P(0.5 + sx * 0.32, 1) + N(0.5 + sx * 0.32, 1) * -0.02, UP + X * (sx * 0.15) + BACK * 0.3, X * -sx, 0.13, 0.018, curl=1.1)
    # a crest of spines along the arch's peak
    for k in range(-3, 4):
        u = 0.5 + k * 0.045
        horn(f'crest{k}', P(u, 1) + N(u, 1) * -0.02, UP + BACK * 0.5 + X * (k * 0.05), X, 0.10 - 0.012 * abs(k), 0.014, curl=0.7)
    # sutures across the panel's front, where it shows round him
    sut = [zigzag(lambda s: bp(-0.85 + 1.7 * s, 1.33, 0.001), 0.005, 14, lambda s: UP),
           zigzag(lambda s: bp(0.80, 0.70 + 0.55 * s, 0.001), 0.005, 9, lambda s: X),
           zigzag(lambda s: bp(-0.80, 0.70 + 0.55 * s, 0.001), 0.005, 9, lambda s: X)]
    finish_t('back', 'spine|back', 16000, lines=sut)

# ---------------------------------------------------------------- bare bone up the back: column and ribs
if 'spine' in PARTS:
    drop(['spine|bone']); clear_work()
    zb = lambda y: zf(y) - 0.045                                      # the panel's back face on the centre line
    Y = [0.56 + 0.075 * k for k in range(13)]                         # 13 vertebrae to just under the arch
    for k, y in enumerate(Y):
        c = bv(0, y, zb(y) - 0.022)
        ball(f'v{k}', c, 1.0, 0.040, 0.030, 0.026)                     # the body of the vertebra
        horn(f'sp{k}', c + BACK * 0.02, BACK + -UP * 0.6, X, 0.050 + 0.015 * sn(k / 12), 0.014, curl=0.4)  # spinous spike
        for sx in (-1, 1):
            horn(f'tp{k}{sx}', c + X * (sx * 0.02), X * sx + BACK * 0.3 - UP * 0.2, UP, 0.045, 0.011, curl=0.2 * sx)
    tube('cord', [bv(0, 0.54 + 0.98 * i / 40, zb(0.54 + 0.98 * i / 40) - 0.012) for i in range(41)], [0.016] * 41)
    # ribs: out from the column along the back face, raking down, and clawing round the panel's edge onto its front
    for k, y in enumerate((0.78, 0.88, 0.98, 1.08, 1.18, 1.28, 1.38)):
        wing = max(0, k - 3)                                          # 0 low .. 3 at the top
        for sx in (-1, 1):
            R = [i / 30 for i in range(31)]
            pts = []
            for r_ in R:
                yy = y - 0.10 * r_ ** 1.3
                if r_ < 0.75:                                         # across the back face, out to the edge
                    xn = r_ / 0.75 * 1.04
                    p = bp(sx * xn, yy, -0.045 - 0.010) if xn <= 1 else bp(sx, yy, -0.045)
                else:                                                 # round the edge and forward
                    a = (r_ - 0.75) / 0.25
                    # tight round the edge lip (sticking out sideways they read as pegs through the panel)
                    p = bp(sx, yy) + X * (sx * (0.014 - 0.006 * a)) + FWD * (a * (0.012 + 0.012 * wing)) + BACK * 0.02 * (1 - a)
                pts.append(p)
            tube(f'rib{k}{sx}', pts, [0.010 + 0.006 * sn(0.15 + r_ * 0.8) for r_ in R], segs=10)
    finish_t('bone', 'spine|bone', 14000, material='tooth', tint=IVORY)

# ---------------------------------------------------------------- armrests
if 'arms' in PARTS:
    drop(['spine|arms', 'spine|talons']); clear_work()
    for sx in (-1, 1):
        a = bv(sx * ARM_X, ARM_Y, -0.128); b = bv(sx * ARM_X, ARM_Y, ARM_Z1 + 0.030)
        F = BoneFrame(a, b, fwd=UP)                                   # ph 0 = up, 180 = under him
        r0 = ARM_R + 0.014
        _, P, N = bone_shell('trough', F, 0.0, lambda ph: 0.96 - 0.05 * (1 + math.cos(ph)) * 0.5, D(70), D(290),
                             lambda t: r0, lambda t: r0 + 0.004, 0.014, nu=40, nv=40)
        edge_lips(P, N, 0.0055, n=50, which=('v0', 'v1'))
        on = lambda t, ph, off=0.0: F.at(t, ph, r0 + off, r0 + 0.004 + off)
        S = [0.04 + 0.9 * i / 40 for i in range(41)]
        tube('keel', [on(t, D(180), 0.003) for t in S], [0.005 + 0.005 * sn(t) for t in S])
        for t0 in (0.18, 0.40, 0.62):
            for side in (-1, 1):
                R_ = [k / 12 for k in range(13)]
                tube(f'arib{t0}{side}', [on(t0 + 0.08 * r_, D(180) + side * (D(15) + D(80) * r_), 0.001) for r_ in R_],
                     [0.0018 + 0.003 * sn(0.1 + r_ * 0.9) for r_ in R_], segs=8)
        # shackles round his forearm, with a rivet each side
        for t in (0.42, 0.78):
            ring(f'shackle{t}', F.h + F.u * (F.L * t), F.u, ARM_R + 0.010, 0.009)
            for side in (-1, 1):
                ball(f'rivet{t}{side}', F.at(t, D(90 * side), ARM_R + 0.018, ARM_R + 0.018), 0.008)
        # the post: a turned bone baluster from under the armrest's front down into the seat
        top = bv(sx * ARM_X, ARM_Y - r0 + 0.004, 0.205); bot = bv(sx * (ARM_X + 0.02), YT - 0.01, 0.235)
        n = 30
        prof = lambda u: 0.020 + 0.010 * bell((u - 0.35) / 0.25) + 0.006 * bell((u - 0.8) / 0.12)
        tube('post', [top.lerp(bot, i / n) + FWD * 0.012 * sn(i / n) for i in range(n + 1)], [prof(i / n) for i in range(n + 1)], segs=14)
        for u in (0.12, 0.6, 0.92):
            ring(f'pring{u}', top.lerp(bot, u) + FWD * 0.012 * sn(u), (bot - top).normalized(), prof(u) + 0.003, 0.004)
    finish_t('arms', 'spine|arms', 12000)
    # his fingers, grown into talons that hook down over the armrest's front end
    for sx in (-1, 1):
        hand = bv(sx * ARM_X, ARM_Y, ARM_Z1)
        for i, dx in enumerate((-0.027, -0.009, 0.009, 0.027)):
            horn(f'f{sx}{i}', hand + X * dx + FWD * 0.030 + UP * 0.008, FWD + UP * 0.1, X, 0.10 - 0.012 * abs(dx) / 0.009, 0.013, curl=2.6)
        horn(f'thumb{sx}', hand + X * (-sx * 0.035) + FWD * 0.012, FWD * 0.6 - X * sx * 0.6 - UP * 0.3, UP, 0.06, 0.012, curl=-1.0 * sx)
    finish_t('talons', 'spine|talons', 4000, material='tooth', tint=IVORY, noise=0.0008)

# ---------------------------------------------------------------- crown: bolted into his temples
if 'crown' in PARTS:
    drop(['skull|crown']); clear_work()
    hc = JV['headC']; ax_, ay_, az_ = HEAD_R
    band_y = 0.072                                                    # above the brow, round the cranium
    k = math.sqrt(1 - (band_y / ay_) ** 2)
    def bandp(th, off=0.0):
        """Point on the band at angle th (0 = his right, 90 deg = front), tipped down at the front."""
        x = (ax_ * k + 0.010 + off) * math.cos(th); z = (az_ * k + 0.010 + off) * math.sin(th)
        return hc + bv(x, band_y - 0.022 * max(0.0, math.sin(th)), z)
    tube('band', [bandp(2 * math.pi * i / 80) for i in range(82)], [0.011] * 82, segs=10)
    tube('band2', [bandp(2 * math.pi * i / 80, 0.004) + UP * 0.012 for i in range(82)], [0.005] * 82, segs=8)
    for j in range(11):
        th = D(90) + D(360) * j / 11
        h = 0.075 + 0.045 * max(0.0, math.sin(th))                    # tallest over his brow
        base = bandp(th)
        out = (base - hc); out.z = 0; out.normalize()
        horn(f'spike{j}', base + UP * 0.006, UP + out * 0.35, out.cross(UP).normalized(), h, 0.012, curl=-0.4)
    for sx in (-1, 1):
        # above and in front of the pointed ears' roots, on the skin (x 0.063 there) and a touch proud
        bolt = hc + bv(sx * 0.066, 0.035, 0.040)
        ball(f'bolt{sx}', bolt, 0.016)
        ring(f'boltring{sx}', bolt + X * (sx * 0.004), X, 0.017, 0.004)
        tube(f'prong{sx}', [bandp(D(0 if sx > 0 else 180)).lerp(bolt, i / 10) + X * (sx * 0.008 * sn(i / 10)) for i in range(11)], [0.008] * 11)
    finish_t('crown', 'skull|crown', 5000)

# ---------------------------------------------------------------- back legs' femurs (the gibbet's carapace)
if 'upper' in PARTS:
    drop(['thigh.l|carapace', 'thigh.r|carapace']); clear_work()
    F = BoneFrame(JV['hip'], JV['knee'])
    prof = lambda t: math.exp(-((t - 0.35) / 0.40) ** 2)
    rf = lambda t: 0.034 + 0.014 * prof(t)
    rs = lambda t: 0.036 + 0.010 * prof(t)
    _, P, N = bone_shell('plate', F, 0.12, lambda ph: 0.88 + 0.07 * math.exp(-(ph / D(35)) ** 2), D(-165), D(165), rf, rs, 0.009, nu=44, nv=48)
    edge_lips(P, N, 0.0045, n=60, which=('u0', 'u1'))
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.14 + 0.78 * i / 40 for i in range(41)]
    tube('crest', [on(t, D(180), 0.003) for t in S], [0.004 + 0.006 * sn(t) for t in S])
    for t0 in (0.30, 0.55):
        for side in (-1, 1):
            R_ = [k / 16 for k in range(17)]
            tube(f'rib{t0}{side}', [on(t0 + 0.10 * r_, D(180) + side * (D(10) + D(90) * r_), 0.001) for r_ in R_],
                 [0.0016 + 0.003 * sn(0.1 + r_ * 0.9) for r_ in R_], segs=8)
    horn('spur', on(0.35, D(180), 0.006), -F.f + F.u * 0.6, F.s, 0.06, 0.011, curl=-0.7)
    finish('carapace', 'thigh.l|carapace', 3000)

# ---------------------------------------------------------------- studs: buttons tufting the flesh cushions
# The cushions are chair.blob's three `rigid` ellipsoids (blob centre, semi-axes); a stud sits on their union's
# surface on a diamond lattice, its dome standing 8-10 mm proud of the ellipsoid (sunk, or only 4 mm out, the blend and the skin
# noise buried them). Studs he covers are inside him and never show.
CUSHIONS = {'back': [((0, 0.800, -0.065), (0.200, 0.200, 0.025)), ((0, 1.050, -0.035), (0.210, 0.2205, 0.0252)),
                     ((0, 1.300, -0.002), (0.190, 0.1805, 0.0257))],
            'seat': [((0, 0.580, 0.110), (0.236, 0.020, 0.225))]}


def ell_out(c, r, a, b, axis):
    """Height along `axis` (1 = y, 2 = z) of an ellipsoid's surface over the other two coords (a, b), or None."""
    if axis == 2: q = 1 - ((a - c[0]) / r[0]) ** 2 - ((b - c[1]) / r[1]) ** 2; return None if q <= 0.05 else c[2] + r[2] * math.sqrt(q)
    q = 1 - ((a - c[0]) / r[0]) ** 2 - ((b - c[2]) / r[2]) ** 2
    return None if q <= 0.05 else c[1] + r[1] * math.sqrt(q)


if 'studs' in PARTS:
    drop(['spine|studs']); clear_work()
    for j in range(-1, 9):
        y = 0.68 + 0.085 * j
        for i in range(-4, 5):
            x = 0.05 * i + (0.025 if j % 2 else 0)
            zs = [ell_out(c, r, x, y, 2) for c, r in CUSHIONS['back']]
            zs = [z for z in zs if z is not None]
            if not zs: continue
            p = bv(x, y, max(zs) + 0.010)
            ball(f'b{i}{j}', p, 1.0, 0.012, 0.007, 0.012); ring(f'br{i}{j}', p + FWD * 0.001, FWD, 0.011, 0.0025, segs=16)
    for j in range(-1, 6):
        z = -0.08 + 0.085 * j
        for i in range(-4, 5):
            x = 0.055 * i + (0.0275 if j % 2 else 0)
            y = ell_out(*CUSHIONS['seat'][0], x, z, 1)
            if y is None: continue
            p = bv(x, y + 0.008, z)
            ball(f's{i}{j}', p, 1.0, 0.012, 0.012, 0.007); ring(f'sr{i}{j}', p + UP * 0.001, UP, 0.011, 0.0025, segs=16)
    finish_t('studs', 'spine|studs', 6000, material='brass', noise=0.0)
