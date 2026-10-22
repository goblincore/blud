# Twinhead legs, pelvis and back machinery, sculpted in the demon skull's style (bony carapaces, crests, rolled
# lips, sutures, curled horns) instead of boxes. Run inside Blender after kit_sculpt.py:
#   exec(open(<dir>/kit_sculpt.py).read()); exec(open(<dir>/make_body_armour.py).read())
# Optionally set PARTS = {'thigh', ...} before running to rebuild a subset.
# Joint heads (blob rest coords, from the kit): thigh.l (0.2, 1.12, 0), shin.l (0.233, 0.652, 0.1),
# foot.l (0.25, 0.16, 0.013), chest (0, 1.337, 0.038), spine2 (0, 1.625, 0.121), pelvis (0, 1, 0).
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'thigh', 'shin', 'knee', 'ankle', 'foot', 'pistons', 'pelvis', 'spine', 'pod'}

HIP = bv(0.2, 1.12, 0); KNEE = bv(0.233, 0.652, 0.1); ANK = bv(0.25, 0.16, 0.013)
bell = lambda x, w=1.0: max(0.0, 1 - (x / w) ** 2)
sn = lambda t: math.sin(math.pi * min(1.0, max(0.0, t)))

OLD = {
    'thigh': ['thighplate', 'thighridge', 'hipflap'], 'shin': ['shinplate', 'shinridge'], 'knee': ['kneecap', 'kneedrum'],
    'ankle': ['ankle'], 'foot': ['foot', 'footcover', 'spur', 'claw'], 'pistons': ['thighpiston', 'thighrod', 'calfpiston', 'calfrod', 'calfband'],
    'pelvis': ['codpiece', 'crotch', 'cup', 'cupband', 'cuprim', 'hipcap', 'hipdrum'], 'spine': ['rack', 'vert'], 'pod': ['powerunit'],
}


def drop_old(part):
    keys = OLD[part]
    for o in list(bpy.data.collections['mech'].all_objects):
        b, _, n = o.name.partition('|')
        if b.split('.')[0] in ('thigh', 'shin', 'foot', 'pelvis', 'chest', 'spine2') and any(n.startswith(k) for k in keys):
            bpy.data.objects.remove(o, do_unlink=True)


def edge_lips(P, N, r, n=60, which=('v0', 'v1', 'u0', 'u1'), inset=0.004, fade=None):
    for w in which:
        pts = []; rad = []
        for i in range(n + 1):
            s = i / n
            u, v = {'v0': (s, 0), 'v1': (s, 1), 'u0': (0, s), 'u1': (1, s)}[w]
            pts.append(P(u, v) - N(u, v) * inset); rad.append(r * (fade(s) if fade else 1.0))
        tube(f'lip{w}', pts, rad, segs=10)


def finish(name, kit, tris, mirror=True, material='skullmetal', lines=(), flatten=None, **fk):
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    if flatten is not None:
        for v in o.data.vertices:
            if v.co.z < flatten: v.co.z = flatten
        o.data.update()
    decimate(o, tris)
    bake_ao(o, material)
    install(o, kit)
    if mirror:
        b, _, n = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + n)
    clear_work()
    return o


# ---------------------------------------------------------------- thigh carapace
def edge_t(ph, a0, a1, lo, hi, point, round_=0.08):
    """Edge outline: rounded corners near the angle limits, a point at the front (ph=0) of `point` (signed t)."""
    x = (ph - a0) / (a1 - a0)
    corner = round_ * (1 - min(1.0, min(x, 1 - x) / 0.18)) ** 2
    return lo, hi, corner, point * math.exp(-(ph / D(28)) ** 2)


if 'thigh' in PARTS:
    drop_old('thigh'); clear_work()
    F = BoneFrame(HIP, KNEE)
    prof = lambda t: math.exp(-((t - 0.36) / 0.38) ** 2)          # widest high on the thigh, tapering to the knee
    rf = lambda t: 0.086 + 0.036 * prof(t)
    rs = lambda t: 0.090 + 0.024 * prof(t)
    A0, A1 = D(-150), D(70)

    def T0(ph):
        _, _, c, pt = edge_t(ph, A0, A1, 0, 0, 0.0); return 0.08 + c + 0.04 * (1 - math.cos(ph)) * 0.5
    def T1(ph):
        _, _, c, pt = edge_t(ph, A0, A1, 0, 0, 0.07); return 0.86 - c + pt
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, rf, rs, 0.013, nu=56, nv=60)
    edge_lips(P, N, 0.0068, n=80)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.10 + 0.82 * i / 60 for i in range(61)]
    cb = lambda t: bell((t - 0.48) / 0.42)
    tube('crest', [on(t, D(-12), 0.004) for t in S], [0.005 + 0.010 * cb(t) for t in S])
    tube('crest2', [on(t, D(-12), 0.018 * cb(t) ** 0.5) for t in S], [0.0015 + 0.006 * cb(t) for t in S])
    for t0 in (0.20, 0.38, 0.56):   # chevron ribs raking down and back from the crest, both sides
        R = [i / 30 for i in range(31)]
        tube(f'ribo{t0}', [on(t0 + 0.20 * u, D(-14) - D(105) * u ** 0.8, 0.001) for u in R], [0.0022 + 0.0045 * sn(0.1 + u * 0.9) for u in R], segs=8)
        tube(f'ribi{t0}', [on(t0 + 0.14 * u, D(-10) + D(60) * u ** 0.8, 0.001) for u in R], [0.002 + 0.0035 * sn(0.1 + u * 0.9) for u in R], segs=8)
    for t in (0.25, 0.5, 0.72):
        ball(f'knob{t}', on(t, A0 + D(9), 0.002), 0.0075)
    horn('hipspur', on(0.14, D(-80), 0.004), (F.s * -1 + F.u * -0.6), F.f, 0.07, 0.013, curl=0.9)
    sut = [zigzag(lambda s: on(0.18 + 0.6 * s, D(-60)), 0.005, 11, lambda s: (on(0.18 + 0.6 * s, D(-66)) - on(0.18 + 0.6 * s, D(-60))).normalized())]
    finish('thigh', 'thigh.l|carapace', 6500, lines=sut)

# ---------------------------------------------------------------- shin greave
if 'shin' in PARTS:
    drop_old('shin'); clear_work()
    F = BoneFrame(KNEE, ANK)
    prof = lambda t: math.exp(-((t - 0.3) / 0.36) ** 2)
    rf = lambda t: 0.078 + 0.030 * prof(t)
    rs = lambda t: 0.074 + 0.016 * prof(t)
    A0, A1 = D(-128), D(108)

    def T0(ph):
        _, _, c, pt = edge_t(ph, A0, A1, 0, 0, 0.06); return 0.13 + c - pt + 0.05 * (1 - math.cos(ph)) * 0.5
    def T1(ph):
        _, _, c, pt = edge_t(ph, A0, A1, 0, 0, 0.05); return 0.86 - c + pt
    _, P, N = bone_shell('plate', F, T0, T1, A0, A1, rf, rs, 0.012, nu=56, nv=60)
    edge_lips(P, N, 0.0062, n=80)
    on = lambda t, ph, off=0.0: F.at(t, ph, rf(t) + off, rs(t) + off)
    S = [0.08 + 0.82 * i / 60 for i in range(61)]
    cb = lambda t: bell((t - 0.48) / 0.42)
    tube('crest', [on(t, 0, 0.004) for t in S], [0.005 + 0.009 * cb(t) for t in S])
    tube('crest2', [on(t, 0, 0.015 * cb(t) ** 0.5) for t in S], [0.0015 + 0.005 * cb(t) for t in S])
    for i, t in enumerate((0.24, 0.38, 0.52, 0.66)):   # raked spines down the crest
        horn(f'sp{i}', on(t, 0, 0.016), F.f + F.u * 0.9, F.s, 0.04 + 0.015 * sn((t - 0.15) / 0.6), 0.010, curl=0.6)
    for side in (-1, 1):
        R = [i / 30 for i in range(31)]
        for t0 in (0.22, 0.42, 0.62):
            tube(f'rib{side}{t0}', [on(t0 + 0.16 * u, side * (D(12) + D(85) * u ** 0.8), 0.001) for u in R], [0.0018 + 0.0038 * sn(0.1 + u * 0.9) for u in R], segs=8)
    sut = [zigzag(lambda s: on(0.2 + 0.6 * s, D(-62)), 0.0045, 10, lambda s: (on(0.2 + 0.6 * s, D(-68)) - on(0.2 + 0.6 * s, D(-62))).normalized())]
    finish('shin', 'shin.l|greave', 5500, lines=sut)

# ---------------------------------------------------------------- knee: skull-cap patella, horn, knuckles
if 'knee' in PARTS:
    drop_old('knee'); clear_work()
    F = BoneFrame(KNEE, ANK)
    cap = KNEE + F.f * 0.07 + F.u * 0.012
    ball('cap', cap, 1.0, 0.052, 0.034, 0.064)
    tube('capcrest', [cap + F.f * 0.03 + F.u * (0.05 * (i / 20 - 0.5) * 2) for i in range(21)], [0.003 + 0.006 * bell((i / 20 - 0.5) * 2) for i in range(21)])
    horn('kneehorn', cap + F.f * 0.022 - F.u * 0.04, F.f * 1 - F.u * 0.2, F.s * -1, 0.075, 0.016, curl=1.1)
    for sx in (-1, 1):
        k = KNEE + Vector((sx * 0.078, 0, 0))
        ball(f'knuckle{sx}', k, 1.0, 0.03, 0.05, 0.05)
        ring(f'kring{sx}', k + Vector((sx * 0.012, 0, 0)), Vector((1, 0, 0)), 0.04, 0.006)
    finish('knee', 'shin.l|knee', 2600)

# ---------------------------------------------------------------- ankle knuckle
if 'ankle' in PARTS:
    drop_old('ankle'); clear_work()
    ball('core', ANK + Vector((0, 0, 0.005)), 0.052)
    for sx in (-1, 1):
        k = ANK + Vector((sx * 0.055, 0, 0.0))
        ball(f'boss{sx}', k, 1.0, 0.026, 0.04, 0.04)
        ring(f'ring{sx}', k + Vector((sx * 0.01, 0, 0)), Vector((1, 0, 0)), 0.03, 0.005)
    finish('ankle', 'shin.l|ankle', 1800)

# ---------------------------------------------------------------- foot: heel and three bony toes ending in curled talons
if 'foot' in PARTS:
    drop_old('foot'); clear_work()
    cx = 0.25
    ball('heel', Vector((cx, 0.035, 0.055)), 1.0, 0.085, 0.075, 0.062)
    ball('instep', Vector((cx, -0.02, 0.085)), 1.0, 0.08, 0.07, 0.06)
    ball('sole', Vector((cx, -0.09, 0.068)), 1.0, 0.075, 0.095, 0.04)   # fills between the toes over the SDF foot core
    for i, x in enumerate((cx - 0.085, cx, cx + 0.085)):
        root = Vector((x, -0.185 - 0.02 * (i == 1), 0.042))
        st = Vector((cx + (x - cx) * 0.3, -0.01, 0.095))
        R = [j / 24 for j in range(25)]
        cen = [st.lerp(root, u) + Vector((0, 0, 0.02 * sn(u))) for u in R]
        rr = [0.047 - 0.02 * u for u in R]
        tube(f'toe{i}', cen, rr, segs=16)
        tube(f'toeridge{i}', [c + Vector((0, 0, r - 0.002)) for c, r in zip(cen, rr)][2:-2], [0.0045 + 0.003 * sn(u) for u in R][2:-2], segs=8)
        ball(f'kn{i}', root + Vector((0, 0, 0.008)), 0.03)
        L = 0.13 if i == 1 else 0.105
        horn(f'talon{i}', root + Vector((0, -0.02, 0.006)), Vector(((x - cx) * 0.5, -1, 0.08)), Vector((1, 0, 0)), L, 0.022, curl=0.95)
    horn('spur', Vector((cx, 0.095, 0.06)), Vector((0, 1, 0.35)), Vector((1, 0, 0)), 0.085, 0.018, curl=-0.8)
    finish('foot', 'foot.l|hoof', 5500, flatten=0.0)

# ---------------------------------------------------------------- pistons (pneumatics kept, sculpted)
if 'pistons' in PARTS:
    drop_old('pistons')
    for bone, top, bot, rodend, r in (('thigh', Vector((0.214, 0.075, 1.04)), Vector((0.216, 0.075, 0.80)), Vector((0.228, 0.03, 0.66)), 0.030),
                                      ('shin', Vector((0.236, 0.045, 0.62)), Vector((0.238, 0.045, 0.36)), Vector((0.247, 0.05, 0.18)), 0.028)):
        clear_work()
        n = 24
        tube('body', [top.lerp(bot, i / n) for i in range(n + 1)], [r * (1.0 - 0.15 * (i / n)) for i in range(n + 1)], segs=16)
        ax = (bot - top).normalized()
        for k in range(4):
            ring(f'rib{k}', top.lerp(bot, 0.18 + 0.2 * k), ax, r * (1.02 - 0.03 * k), 0.0055)
        ball('mount', top - ax * 0.01, r * 1.25)
        ball('gland', bot, r * 0.8)
        finish(bone + 'piston', f'{bone}.l|piston', 1600, material='iron')
        clear_work()
        rod = tube('rod', [bot.lerp(rodend, i / 8) for i in range(9)], [0.011] * 9, segs=12)
        plain(rod, 'chrome'); install(rod, f'{bone}.l|rod'); mirror_to_r(rod, f'{bone}.r|rod')
        clear_work()
        if bone == 'shin':
            band = ring('band', top.lerp(bot, 0.3), ax, r + 0.006, 0.006)
            plain(band, 'brass'); install(band, 'shin.l|band'); mirror_to_r(band, 'shin.r|band')
        clear_work()

# ---------------------------------------------------------------- pelvic girdle
if 'pelvis' in PARTS:
    drop_old('pelvis'); clear_work()
    cy = -0.02

    def top_z(ph):   # ph=0 is +x (left side); iliac wings rise at the sides, front dips, sacrum rises at the back
        return 1.13 + 0.12 * g2(ph, 0, 0.55) + 0.12 * g2(ph, math.pi, 0.55) - 0.05 * g2(ph, -math.pi / 2, 0.5) + 0.06 * g2(ph, math.pi / 2, 0.45)

    def bot_z(ph):
        return 0.975 - 0.03 * g2(ph, -math.pi / 2, 0.6) + 0.02 * g2(ph, math.pi / 2, 0.5)

    def g2(ph, c, w):
        d = math.atan2(math.sin(ph - c), math.cos(ph - c)); return math.exp(-(d / w) ** 2)

    def P(u, v):
        ph = 2 * math.pi * v; z = bot_z(ph) + (top_z(ph) - bot_z(ph)) * u
        side = abs(math.cos(ph))
        flare = max(0.0, z - 1.11) * 0.9 * side ** 2   # wings flare outward as they rise
        a = 0.292 + flare + 0.012 * math.sin(math.pi * u); b = 0.226 + 0.008 * math.sin(math.pi * u)
        return Vector((a * math.cos(ph), cy + b * math.sin(ph), z))

    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, v + e) - P(u, v - e)
        n = du.cross(dv).normalized(); p = P(u, v)
        return n if n.dot(Vector((p.x, p.y - cy, 0))) > 0 else -n
    surface_solid('girdle', P, N, 30, 160, 0.016, closed_v=True)
    for w, uu, r in (('top', 1.0, 0.0085), ('bot', 0.0, 0.0065)):
        pts = [P(uu, i / 200) - N(uu, i / 200) * 0.005 for i in range(202)]
        tube(f'lip{w}', pts, [r] * len(pts), segs=10)
    for k in range(10):   # ribs climbing the iliac wings
        ph = (-0.55 + 1.1 * k / 9) + (math.pi if k % 2 else 0)
        v = (ph / (2 * math.pi)) % 1.0
        R = [i / 20 for i in range(21)]
        tube(f'wrib{k}', [P(0.15 + 0.8 * u, v) for u in R], [0.002 + 0.0035 * sn(u) for u in R], segs=8)
    for sx in (-1, 1):   # hip knuckles over the thigh joints
        k = Vector((sx * 0.305, cy, 1.11))
        ball(f'hip{sx}', k, 1.0, 0.03, 0.06, 0.06)
        ring(f'hipr{sx}', k + Vector((sx * 0.012, 0, 0)), Vector((1, 0, 0)), 0.048, 0.007)
        ring(f'hipr2{sx}', k + Vector((sx * 0.02, 0, 0)), Vector((1, 0, 0)), 0.028, 0.006)
    # pubic shield: a tapering bony plate hanging at the front
    def Pc(u, v):
        w = 0.085 * (1 - 0.7 * u); z = 1.05 - 0.2 * u; x = (v - 0.5) * 2 * w
        return Vector((x, cy - 0.235 - 0.03 * math.cos(math.pi * (v - 0.5)) + 0.04 * u * u, z))

    def Nc(u, v):
        e = 1e-3
        n = (Pc(min(1, u + e), v) - Pc(max(0, u - e), v)).cross(Pc(u, min(1, v + e)) - Pc(u, max(0, v - e))).normalized()
        return n if n.y < 0 else -n
    surface_solid('shield', Pc, Nc, 24, 20, 0.014)
    tube('shcrest', [Pc(i / 20, 0.5) + Vector((0, -0.006, 0)) for i in range(21)], [0.003 + 0.006 * bell(i / 20 - 0.4, 0.6) for i in range(21)])
    for side in (0.0, 1.0):
        tube(f'shlip{side}', [Pc(i / 20, side) for i in range(21)], [0.006] * 21, segs=8)
    ball('crotch', Vector((0, cy + 0.01, 0.97)), 1.0, 0.09, 0.13, 0.06)
    for i in range(4):   # sacral knobs at the back
        ball(f'sac{i}', Vector((0, cy + 0.238 + 0.006 * i, 1.17 - 0.045 * i)), 0.014 - 0.002 * i)
    sut = [zigzag(lambda s, sx=sx: P(0.55, ((sx * (0.25 + 0.5 * s)) / (2 * math.pi)) % 1.0), 0.005, 9, lambda s: Vector((0, 0, 1))) for sx in (-1, 1)]
    o = finish('pelvis', 'pelvis|girdle', 9000, mirror=False, lines=sut)
    clear_work()
    pts = [P(0.42, i / 200) + N(0.42, i / 200) * 0.006 for i in range(202)]
    band = tube('band', pts, [0.0075] * len(pts), segs=10)
    plain(band, 'brass'); install(band, 'pelvis|band'); clear_work()

# ---------------------------------------------------------------- back: a bony vertebral column on the chest bone
if 'spine' in PARTS:
    drop_old('spine'); clear_work()
    zs = [1.355 + 0.065 * i for i in range(5)]
    ys = [0.150 - 0.020 * i for i in range(5)]
    tube('cord', [Vector((0, ys[0] + (ys[-1] - ys[0]) * s - 0.01, zs[0] - 0.03 + (zs[-1] - zs[0] + 0.07) * s)) for s in [i / 30 for i in range(31)]], [0.022] * 31)
    for i, (z, y) in enumerate(zip(zs, ys)):
        c = Vector((0, y, z))
        ball(f'centrum{i}', c, 1.0, 0.048, 0.032, 0.026)
        horn(f'spinous{i}', c + Vector((0, 0.025, 0)), Vector((0, 1, -0.55)), Vector((1, 0, 0)), 0.055, 0.015, curl=0.5)
        for sx in (-1, 1):
            horn(f'trans{i}{sx}', c + Vector((sx * 0.03, 0.006, 0.004)), Vector((sx, 0.35, 0.12)), Vector((0, 0, sx)), 0.06, 0.012, curl=0.55)
    finish('spine', 'chest|vertebrae', 6000, mirror=False)

# ---------------------------------------------------------------- back pod (power unit) on spine2, LEDs set in bezels
if 'pod' in PARTS:
    drop_old('pod'); clear_work()
    pc = Vector((0, 0.112, 1.685))
    ball('pod', pc, 1.0, 0.112, 0.062, 0.088)
    tube('podcrest', [pc + Vector((0, 0.058 - 0.02 * abs(s - 0.5), -0.085 + 0.17 * s)) for s in [i / 24 for i in range(25)]], [0.004 + 0.006 * bell((i / 24 - 0.5) * 2) for i in range(25)])
    for sx in (-1, 1):
        horn(f'podhorn{sx}', pc + Vector((sx * 0.085, 0.02, 0.05)), Vector((sx * 0.6, 0.5, 1)), Vector((0, 1, 0)) * -sx, 0.07, 0.014, curl=0.9)
        R = [i / 20 for i in range(21)]
        tube(f'podrib{sx}', [pc + Vector((sx * (0.03 + 0.07 * u), 0.05 - 0.03 * u * u, -0.07 + 0.02 * u)) for u in R], [0.003 + 0.003 * sn(u) for u in R], segs=8)
    for x in (-0.06, 0.0, 0.06):
        ring(f'bezel{x}', Vector((x, 0.178, 1.665)), Vector((0, 1, 0)), 0.016, 0.0045)
    finish('pod', 'spine2|pod', 3500, mirror=False)
