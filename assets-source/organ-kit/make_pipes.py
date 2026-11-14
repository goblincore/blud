# The organ's pipes (organ.blob's header). Run with ../gorehound-kit/build.py on organ-kit.blend (common.py has the
# command). Everything rides `spine` (rigid), so the whole organ bobs and rolls with the bellows' back.
#   saddle    the windchest: a bone-metal saddle laid on the bellows' top (probed, skin.json), a crest down its middle,
#             chevron ribs raking down its flanks, rolled lips. The pipes stand in it.
#   pipes     two ranks of FLUE PIPES, one each side of the crest, an arched facade (tallest mid-back). Each is a bone:
#             a conical foot, a shaft fluted with four ridges and banded twice, the organ pipe's MOUTH (a dark slot
#             under an arched upper lip) facing forward and out, a rolled rim crowned with five small curled points
#             and a dark bore. Not plain cylinders (biomech-style.md: no drums).
#   brace     a bar through each rank at knee height, a knuckle where it meets each pipe (a facade's rail).
#   chamade   TRUMPETS EN CHAMADE: three horizontal reed pipes each side, fanned forward off the front of the saddle
#             over the shoulders, flaring into bells. The wail leaves from their bells (MotionProfile.spit).
#   voids     the dark of every bore, mouth and bell, one `void` part.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'saddle', 'pipes', 'brace', 'chamade'}
X = Vector((1, 0, 0)); UP = Vector((0, 0, 1)); FWD = Vector((0, -1, 0))   # FWD: blob +z
SADDLE_LIFT = 0.012          # plates flush with the skin vanish under its noise (biomech-style.md): lift ~1 cm
SADDLE_T = 0.016             # the saddle's thickness
Z0, Z1 = 0.04, 0.86          # the saddle runs from over the hips to the withers (blob z)
smooth = lambda c: (lambda x: x * x * (3 - 2 * x))(max(0.0, min(1.0, c)))
VOIDS = []                   # (centre, r, sx, sy, sz) blender: the dark of every bore and mouth, built last


def saddle_w(u):
    """Half-width (blob x) of the saddle at u along it (0 hips .. 1 withers): rounded, pointed ends."""
    return 0.16 * math.sin(math.pi * min(1.0, max(0.0, u))) ** 0.35


def saddle_top(x, z):
    """Blender point on the saddle's top surface at blob (x, z)."""
    return on_skin(x, z, SADDLE_LIFT + SADDLE_T)


# ---------------------------------------------------------------- saddle (the windchest)
if 'saddle' in PARTS:
    drop(['spine|saddle']); clear_work()
    P = lambda u, v: on_skin((2 * v - 1) * saddle_w(u), Z0 + (Z1 - Z0) * u, SADDLE_LIFT + SADDLE_T)
    N = lambda u, v: UP
    surface_solid('plate', P, N, 64, 24, SADDLE_T)
    edge_lips(P, N, 0.007, n=90, which=('v0', 'v1'), inset=0.003)
    S = [0.02 + 0.96 * i / 80 for i in range(81)]
    tube('crest', [P(u, 0.5) + UP * 0.004 for u in S], [0.006 + 0.006 * sn(u) for u in S])
    tube('crest2', [P(u, 0.5) + UP * (0.014 * sn(u) ** 0.5) for u in S][4:-4], [0.002 + 0.0045 * sn(u) for u in S][4:-4])
    for i, u0 in enumerate([0.08 + 0.105 * k for k in range(9)]):        # chevron ribs raking down and back
        for side in (0, 1):
            R = [k / 14 for k in range(15)]
            v = lambda r_: 0.5 + (0.46 if side else -0.46) * r_
            tube(f'rib{i}{side}', [P(max(0.0, u0 - 0.06 * r_), v(r_)) + UP * 0.001 for r_ in R],
                 [0.0018 + 0.0035 * sn(0.1 + r_ * 0.9) for r_ in R], segs=8)
    sut = [zigzag(lambda s: P(0.08 + 0.84 * s, 0.30), 0.004, 14, lambda s: UP),
           zigzag(lambda s: P(0.08 + 0.84 * s, 0.70), 0.004, 14, lambda s: UP)]
    finish('saddle', 'spine|saddle', 9000, mirror=False, lines=sut)


# ---------------------------------------------------------------- one flue pipe
def flue_pipe(name, base, ax, h, r, md):
    """A fluted bone pipe from `base` along unit `ax`, `h` tall, shaft radius `r`, its mouth facing `md` (unit,
    perpendicular-ish to ax). Leaves its dark bits in VOIDS."""
    md = (md - ax * md.dot(ax)).normalized(); side = ax.cross(md)
    n = 44
    U = [i / n for i in range(n + 1)]
    top = h - 0.035
    rad = lambda u: r * (0.50 + 0.55 * smooth(u / 0.14)) if u < 0.14 else r * (1.0 + 0.05 * math.sin(math.pi * (u - 0.14) / 0.86))
    tube('shaft', [base + ax * (top * u) for u in U], [rad(u) for u in U], segs=20)
    ring('collar', base + ax * 0.012, ax, r * 0.62, r * 0.16)
    # four flutes: bony ridges down the shaft, kept off the mouth's face
    for k in range(4):
        ph = math.pi / 4 + k * math.pi / 2
        e = md * math.cos(ph) + side * math.sin(ph)
        F_ = [0.18 + 0.78 * i / 30 for i in range(31)]
        tube(f'flute{k}', [base + ax * (h * u) + e * (rad(u) * 0.97) for u in F_], [r * 0.14 * (0.4 + 0.6 * sn((u - 0.18) / 0.78)) for u in F_], segs=8)
    for u in (0.46, 0.74):
        ring(f'band{u}', base + ax * (h * u), ax, rad(u) * 1.01, r * 0.17)
    # the MOUTH: a dark slot on the md face, an arched upper lip over it, a flat lower lip under it
    mh = 0.20 * h
    VOIDS.append((base + ax * mh + md * (r * 0.78), r * 0.62, 1.0, 1.0, 0.42))
    arc = lambda hh, rr, span, lift: [base + ax * (hh + lift * math.cos(a)) + (md * math.cos(a) + side * math.sin(a)) * rr
                                       for a in [span * (2 * i / 16 - 1) for i in range(17)]]
    tube('ulip', arc(mh + r * 0.35, r * 1.04, 1.0, r * 0.35), [r * 0.13] * 17, segs=8)
    tube('llip', arc(mh - r * 0.38, r * 1.04, 0.9, 0.0), [r * 0.11] * 17, segs=8)
    # the rim: a rolled lip, a crown of five small points curling out, and the dark bore inside
    ring('rim', base + ax * (h - 0.012), ax, r * 1.02, r * 0.20)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        e = md * math.cos(a) + side * math.sin(a)
        horn(f'pt{k}', base + ax * (h - 0.006) + e * (r * 1.0), ax + e * 0.5, ax.cross(e), 0.022 + r * 0.6, r * 0.20, curl=-1.3)
    VOIDS.append((base + ax * (h - 0.016), r * 0.86, 1.0, 1.0, 0.25))


# the facade's layout, shared with `brace`: rank side, index -> (base, axis, height, radius, mouth dir)
NP = 8


def pipe_layout(sx, i):
    u = (i + 0.5) / NP
    z = 0.10 + 0.70 * u
    x = sx * 0.072
    # An arch peaking a little behind the middle, 0.24-0.68 m (0.78 at first: a 2 m figure, mostly pipe).
    h = 0.24 + 0.44 * math.sin(math.pi * (0.10 + 0.85 * u)) ** 0.8
    r = 0.020 + 0.016 * math.sin(math.pi * u)
    # Fanned out a little, more at the front. 5-9 deg read as a V from the front (two fans, not one facade).
    lean = math.radians(2 + 3 * u)
    ax = (UP * math.cos(lean) + X * (sx * math.sin(lean))).normalized()
    base = saddle_top(x, z) - ax * 0.010                                 # the foot sinks into the saddle
    md = (FWD * 0.75 + X * (sx * 0.65)).normalized()
    return base, ax, h, r, md


if 'pipes' in PARTS:
    drop(['spine|pipe'])
    for sx, tag in ((1, 'L'), (-1, 'R')):
        for i in range(NP):
            clear_work()
            flue_pipe('p', *pipe_layout(sx, i))
            finish(f'pipe{tag}{i}', f'spine|pipe{tag}{i}', 1500, mirror=False)
    tallest = max(range(NP), key=lambda i: pipe_layout(1, i)[2])
    b, ax, h, r, md = pipe_layout(1, tallest)
    t = b + ax * h
    print('PIPE_TOP (blob x,y,z)', round(t.x, 3), round(t.z, 3), round(-t.y, 3))

if 'brace' in PARTS:
    drop(['spine|brace'])
    for sx, tag in ((1, 'L'), (-1, 'R')):
        clear_work()
        pts = []
        for i in range(NP):
            b, ax, h, r, md = pipe_layout(sx, i)
            p = b + ax * 0.13
            pts.append(p)
            ball(f'kn{i}', p, r * 1.35, 1.0, 1.0, 0.8)
            ring(f'kr{i}', p, ax, r * 1.25, r * 0.18)
        a = pts[0] + (pts[0] - pts[1]) * 0.5; z = pts[-1] + (pts[-1] - pts[-2]) * 0.5
        rail = [a] + pts + [z]
        tube('rail', rail, [0.006] + [0.010] * NP + [0.006], segs=12)
        finish(f'brace{tag}', f'spine|brace{tag}', 3000, mirror=False)


# ---------------------------------------------------------------- trumpets en chamade
NC = 3


def chamade_layout(sx, k):
    """Root, unit axis, length, root radius of the k-th trumpet on side sx: fanned forward, out and up."""
    out = math.radians(10 + 13 * k); up = math.radians(8 + 5 * k)
    d = (FWD * math.cos(out) * math.cos(up) + X * (sx * math.sin(out) * math.cos(up)) + UP * math.sin(up)).normalized()
    root = saddle_top(sx * (0.035 + 0.035 * k), Z1 - 0.10) + UP * (0.030 + 0.034 * k)
    return root, d, 0.34 - 0.04 * k, 0.016 - 0.002 * k


if 'chamade' in PARTS:
    drop(['spine|chamade'])
    for sx, tag in ((1, 'L'), (-1, 'R')):
        clear_work()
        for k in range(NC):
            root, d, L, r0 = chamade_layout(sx, k)
            n = 40; U = [i / n for i in range(n + 1)]
            rr = lambda u: r0 * (1.0 + 2.6 * u ** 5)                    # the reed's bell flares at the very end
            tube(f'tr{k}', [root + d * (L * u) for u in U], [rr(u) for u in U], segs=20)
            ring(f'bell{k}', root + d * L, d, rr(1.0) * 1.0, r0 * 0.30)
            ring(f'b1{k}', root + d * (L * 0.30), d, r0 * 1.05, r0 * 0.22)
            ring(f'b2{k}', root + d * (L * 0.62), d, r0 * 1.10, r0 * 0.22)
            ball(f'boot{k}', root, r0 * 1.7, 1.0, 1.0, 1.0)              # the reed's boot, where it leaves the chest
            e = d.cross(UP).normalized()
            for j in range(6):                                          # the bell's crown of points, curling back
                a = 2 * math.pi * j / 6
                ee = (e * math.cos(a) + d.cross(e) * math.sin(a))
                horn(f'bp{k}{j}', root + d * (L - 0.004) + ee * rr(1.0), d + ee * 0.7, d.cross(ee), 0.03, r0 * 0.35, curl=-1.4)
            # A DISC deep in the bell, facing forward (the trumpet points along blender -y): a full sphere of the bell's
            # radius read as a black cannonball sitting in it.
            VOIDS.append((root + d * (L - 0.030), rr(1.0) * 0.80, 1.0, 0.25, 1.0))
        finish(f'chamade{tag}', f'spine|chamade{tag}', 6000, mirror=False)
    root, d, L, r0 = chamade_layout(1, 1)
    m = root + d * L
    print('CHAMADE_BELL (blob x,y,z)', round(m.x, 3), round(m.z, 3), round(-m.y, 3))

# ---------------------------------------------------------------- the dark of every bore, mouth and bell
if VOIDS:
    drop(['spine|voids']); clear_work()
    for k, (c, r, sx_, sy_, sz_) in enumerate(VOIDS):
        ball(f'v{k}', c, r, sx_, sy_, sz_)
    o = fuse('voids', voxel=0.0018, noise=0.0)
    decimate(o, 6000); plain(o, 'void'); install(o, 'spine|voids'); clear_work()
