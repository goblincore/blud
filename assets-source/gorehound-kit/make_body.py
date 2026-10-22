# Gorehound body machinery: the conversion bolted onto the pinky's flesh (biomech-style.md). Run inside Blender after
# kit_sculpt.py and hound_common.py; set PARTS first to rebuild a subset.
#   ridge   vertebral plates down the back (chevrons raking back, a spine on each, the biggest over the hump)
#   cables  black cable runs from the ridge down the flanks, sinking into the flesh (the teratoma's in-and-out lesson)
#   sockets where the flesh upper limbs end and the machine legs begin: a stapled collar round the stump
#   brow    a partial skullmetal plate on the cranium, shield-pointed over the snout, crest, sutures, two curled horns
#   eyes    socket rims round the two embers
#   teeth   an upper arcade on the skull and a lower one on the jaw, staggered so they interlock in the open maw
#   hinge   a ram on each cheek (skull) and a hinge boss (jaw)
# Seating: everything on the back or the head reads its height from skin.json (on_skin / skin_y), never a guess.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'ridge', 'cables', 'sockets', 'brow', 'eyes', 'teeth', 'hinge'}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0))   # blender: blob +z (front) is -y


def vertebra(name, z, hw, lz, lift, spine_len, spine_r):
    """One chevron plate hugging the back at blob z: half-width hw, length lz, wings swept back, a raked spine."""
    def P(u, v):
        s = (v - 0.5) * 2
        x = s * hw * (1 - 0.25 * u)
        zz = z + lz * (0.5 - u) - 0.55 * hw * abs(s) ** 1.4      # the chevron: wings trail behind the centre
        return on_skin(x, zz, lift + 0.010 * (1 - abs(s)) * math.sin(math.pi * u))

    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, min(1, v + e)) - P(u, max(0, v - e))
        n = du.cross(dv).normalized()
        return n if n.z > 0 else -n
    surface_solid(name, P, N, 18, 24, 0.010)
    edge_lips(P, N, 0.0045, n=40)
    top = on_skin(0, z, lift + 0.012)
    if spine_len > 0:
        horn(name + 'sp', top, UP + BACK * 0.9, X, spine_len, spine_r, curl=0.7)
    for sx in (-1, 1):
        ball(name + f'k{sx}', on_skin(sx * hw * 0.55, z - 0.3 * hw, lift + 0.004), 0.011)


# ---------------------------------------------------------------- ridge: rump (pelvis), back (spine), withers (chest)
if 'ridge' in PARTS:
    for bone, zs in (('pelvis', (-0.20, -0.12, -0.04)), ('spine', (0.05, 0.14, 0.23, 0.32, 0.41, 0.50)), ('chest', (0.60, 0.69))):
        drop([f'{bone}|ridge']); clear_work()
        for i, z in enumerate(zs):
            hump = math.exp(-((z - 0.45) / 0.22) ** 2)             # biggest over the hump, small on the rump and neck
            vertebra(f'v{i}', z, 0.065 + 0.035 * hump, 0.075, 0.012, 0.05 + 0.11 * hump, 0.011 + 0.006 * hump)
        # a crest joining the plates, so the ridge reads as one spine and not as stepping stones
        S = [zs[0] - 0.03 + (zs[-1] - zs[0] + 0.06) * i / 60 for i in range(61)]
        tube('crest', [on_skin(0, z, 0.012) for z in S], [0.009] * 61, segs=10)
        finish('ridge', f'{bone}|ridge', 9000, mirror=False)

# ---------------------------------------------------------------- cables: ridge -> flank, into the flesh
if 'cables' in PARTS:
    for bone, zs in (('pelvis', (-0.10,)), ('spine', (0.10, 0.28, 0.46)), ('chest', (0.64,))):
        drop([f'{bone}|cables']); clear_work()
        for z in zs:
            for sx in (-1, 1):
                for j, (dz, reach, r) in enumerate(((0.0, 0.25, 0.0075), (0.025, 0.20, 0.0055))):
                    pts = []; n = 30
                    for i in range(n + 1):
                        u = i / n
                        x = sx * (0.02 + reach * u)
                        zz = z + dz + 0.04 * math.sin(math.pi * u) * (1 if j else -1)
                        y = skin_y(x, zz)
                        if y is None: break
                        # rides 6 mm proud, then dives 2.5 cm into the flesh over the last fifth
                        dive = max(0.0, (u - 0.8) / 0.2)
                        pts.append(bv(x, y + 0.006 - 0.025 * dive ** 1.5, zz))
                    if len(pts) > 4:
                        tube(f'c{z}{sx}{j}', pts, [r] * len(pts), segs=8)
        o = finish('cables', f'{bone}|cables', 4000, mirror=False, material='cable', noise=0.0)

# ---------------------------------------------------------------- sockets: a stapled collar where flesh meets machine
if 'sockets' in PARTS:
    for up, A, B, r in (('upperarm', 'shoulder', 'elbow', 0.088), ('thigh', 'hip', 'knee', 0.085)):
        drop([f'{up}.l|socket', f'{up}.r|socket']); clear_work()
        a, b = JV[A], JV[B]; u = (b - a).normalized()
        c = a.lerp(b, 0.86)
        ring('collar', c, u, r, 0.016)
        ring('lip', c + u * 0.018, u, r * 0.92, 0.010)
        e1 = u.cross(X).normalized() if abs(u.dot(X)) < 0.9 else u.cross(UP).normalized(); e2 = u.cross(e1)
        for k in range(8):                                       # staples biting up into the flesh
            ph = 2 * math.pi * k / 8
            d = e1 * math.cos(ph) + e2 * math.sin(ph)
            p0 = c + d * (r + 0.004) - u * 0.004
            tube(f'st{k}', [p0, p0 - u * 0.03 + d * 0.006, p0 - u * 0.045 - d * 0.004], [0.004, 0.0035, 0.003], segs=6)
        finish('socket', f'{up}.l|socket', 2500)

# ---------------------------------------------------------------- brow: a shield-pointed plate on the cranium
if 'brow' in PARTS:
    drop(['skull|brow']); clear_work()
    z0, z1 = 0.84, 1.13

    def W(u):
        return 0.155 * max(0.0, math.sin(math.pi * (0.25 + 0.75 * u))) ** 0.75

    def P(u, v):
        s = (v - 0.5) * 2
        z = z0 + (z1 - z0) * u - 0.05 * abs(s) ** 1.6              # the back edge swept into two points
        return on_skin(s * W(u), z, 0.008)

    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, min(1, v + e)) - P(u, max(0, v - e))
        n = du.cross(dv).normalized()
        return n if n.z > 0 else -n
    surface_solid('plate', P, N, 40, 40, 0.010)
    edge_lips(P, N, 0.0055, n=70)
    S = [0.04 + 0.9 * i / 50 for i in range(51)]
    cb = lambda u: bell((u - 0.45) / 0.5)
    tube('crest', [P(u, 0.5) + UP * 0.006 for u in S], [0.004 + 0.007 * cb(u) for u in S])
    tube('crest2', [P(u, 0.5) + UP * (0.010 + 0.010 * cb(u) ** 0.5) for u in S], [0.0015 + 0.004 * cb(u) for u in S])
    for u0 in (0.30, 0.48, 0.66):                                 # chevron ribs raking back off the crest
        for side in (-1, 1):
            R = [i / 20 for i in range(21)]
            tube(f'rib{u0}{side}', [P(u0 - 0.12 * r_, 0.5 + side * 0.42 * r_) + UP * 0.004 for r_ in R],
                 [0.0018 + 0.0032 * sn(0.1 + r_ * 0.9) for r_ in R], segs=8)
    for side in (-1, 1):                                          # two horns from the back points, curling back and down
        horn(f'horn{side}', P(0.04, 0.5 + side * 0.48) + UP * 0.006, BACK + UP * 0.6 + X * side * 0.5, X * side, 0.13, 0.022, curl=1.3)
    sut = [zigzag(lambda s: P(0.15 + 0.6 * s, 0.30), 0.004, 8, lambda s: X),
           zigzag(lambda s: P(0.15 + 0.6 * s, 0.70), 0.004, 8, lambda s: X)]
    finish('brow', 'skull|brow', 7000, mirror=False, lines=sut)

# ---------------------------------------------------------------- eyes: bony rims round the embers
if 'eyes' in PARTS:
    drop(['skull|sockets']); clear_work()
    for sx in (-1, 1):
        e = bv(sx * 0.124, 0.974, 1.060)
        axis = (bv(sx * 0.6, 0.15, 1.0) - bv(0, 0, 0)).normalized()
        ring(f'rim{sx}', e - axis * 0.006, axis, 0.026, 0.0065)
        horn(f'tear{sx}', e + Vector((sx * 0.028, 0, -0.016)), Vector((sx * 0.3, 0.6, -1)), X, 0.035, 0.007, curl=0.4)
    finish('sockets', 'skull|sockets', 2500, mirror=False)

# ---------------------------------------------------------------- teeth: two arcades that interlock in the open maw
if 'teeth' in PARTS:
    # Upper jaw prim: centre (0, 0.880, 1.133), semi-axes x 0.225, y 0.080, z 0.174 (gorehound.blob, round 3).
    # Mandible prim: centre (0, 0.730, 1.060), semi-axes x 0.200, y 0.0625, z 0.1625.
    for bone, cx, cy, cz, ax, ay, az, frac, dirz, n in (('skull', 0, 0.880, 1.133, 0.225, 0.080, 0.174, 0.90, -1, 15),
                                                       ('jaw', 0, 0.730, 1.060, 0.200, 0.0625, 0.1625, 0.80, 1, 14)):
        drop([f'{bone}|teeth']); clear_work()
        for i in range(n):
            a = math.radians(-105 + 210 * (i + (0.5 if dirz > 0 else 0)) / (n - (0 if dirz > 0 else 1)))
            x = cx + ax * frac * math.sin(a); z = cz + az * frac * math.cos(a)
            rr = (x / ax) ** 2 + ((z - cz) / az) ** 2
            y = cy + dirz * ay * math.sqrt(max(0.0, 1 - rr)) - dirz * 0.010    # rooted 1 cm into the gum
            front = math.cos(a)
            canine = abs(abs(math.degrees(a)) - 38) < 12
            L = (0.050 + 0.030 * front ** 2) * (1.6 if canine else 1.0) * (0.85 if dirz > 0 else 1.0)
            r0 = 0.010 + 0.005 * front + (0.004 if canine else 0)
            d = Vector((0.25 * math.sin(a) * 0.3, 0.15, dirz))           # straight down/up, a little back
            horn(f't{i}', bv(x, y, z), d, X * (1 if dirz < 0 else -1), L, r0, curl=0.35)
        finish('teeth', f'{bone}|teeth', 6000, mirror=False, material='tooth', noise=0.0012)

# ---------------------------------------------------------------- hinge: a ram on each cheek, a boss on the jaw
if 'hinge' in PARTS:
    drop(['skull|rams', 'jaw|hinge', 'skull|ramrod']); clear_work()
    for sx in (-1, 1):
        top = bv(sx * 0.215, 0.925, 0.925); bot = bv(sx * 0.225, 0.835, 0.975)
        ax = (bot - top).normalized(); n = 14
        tube(f'ram{sx}', [top.lerp(bot, i / n) for i in range(n + 1)], [0.020 - 0.004 * i / n for i in range(n + 1)], segs=14)
        for k in range(3):
            ring(f'rr{sx}{k}', top.lerp(bot, 0.2 + 0.25 * k), ax, 0.021 - 0.002 * k, 0.004)
        ball(f'mount{sx}', top - ax * 0.006, 0.026)
    finish('rams', 'skull|rams', 3000, mirror=False, material='iron')
    for sx in (-1, 1):
        bot = bv(sx * 0.225, 0.835, 0.975); top = bv(sx * 0.215, 0.925, 0.925)
        rod = tube(f'rod{sx}', [bot.lerp(bot + (bot - top).normalized() * 0.05, i / 6) for i in range(7)], [0.008] * 7, segs=10)
    o = fuse('ramrod', noise=0.0)
    plain(o, 'chrome'); install(o, 'skull|ramrod'); clear_work()
    for sx in (-1, 1):
        b = bv(sx * 0.228, 0.792, 0.985)
        ball(f'boss{sx}', b, 1.0, 0.020, 0.030, 0.030)
        ring(f'br{sx}', b + X * sx * 0.012, X, 0.026, 0.005)
    finish('hinge', 'jaw|hinge', 2000, mirror=False)
