# The teratoma's kit (characters/teratoma.blob): teeth, the eye, talons, shackles and chains, and the strogg conversion
# (crest-plate with horns, eye socket, mandible and jaw pistons, hover keel, cables and hoses), at the bottom.
# Run `npx tsx scripts/teratoma-skin.ts` first after any torso edit: the conversion seats on skin.json.
# Run inside Blender, with assets-source/teratoma-kit/teratoma-kit.blend open:
#   exec(open('<repo>/assets-source/twinhead-kit/kit_sculpt.py').read())
#   exec(open('<repo>/assets-source/teratoma-kit/make_teratoma.py').read())
# PARTS picks a subset to iterate on one part (set it before the exec, e.g. PARTS = {'teeth'}).
# Then export the `mech` collection to teratoma-parts.glb (export_vertex_color='ACTIVE', export_attributes=True) and
#   npx tsx scripts/blender-kit.ts teratoma assets-source/teratoma-kit/teratoma-parts.glb
#
# COLOURS ARE LINEAR (Blender FLOAT_COLOR and glTF COLOR_0): a 'near-black' 0.10 is sRGB ~0.35 and the first horns
# rendered mid-grey. Dark keratin is ~0.02-0.05 linear.
#
# Coordinates: every number below is a blob REST position (metres, y up, +z forward) through `bv`. They come from
# `npx tsx scripts/blob-inspect.ts teratoma` (prim ends) and the bone heads/tails buildBody prints.
#
# THE STYLE (.claude/skills/authoring-sdf-characters/biomech-style.md), applied to bone and keratin rather than
# machinery: nothing is a plain cone or cylinder. Horns are ringed and curled; teeth are flattened, curved, uneven,
# some chipped; talons hook; the cuffs have rolled lips, a hinge knuckle and a lock lug, and the chain ends in a
# broken link. Colour is where the story is: yellowed teeth darkening to rotten brown at the gum, rust on the iron.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    # The shipped kit. 'horns' and 'spurs' (keratin horns, bone crown spurs) are the FIRST pass, superseded by the
    # strogg conversion's skullmetal horns on the crest-plate ('cap'); kept buildable for comparison, not installed.
    PARTS = {'teeth', 'eye', 'talons', 'shackles', 'cap', 'orbit', 'jaw', 'keel', 'wires'}

R = random.Random(7)


def lerp3(a, b, t):
    return a + (b - a) * t


def colour_by(o, fn, glow=None):
    """Vertex colours (and optionally a `_glow` point attribute) from fn(world co, normal)."""
    me = o.data
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    for v, c in zip(me.vertices, ca.data):
        r, g, b = fn(v.co, v.normal); c.color = (r, g, b, 1.0)
    if glow:
        if '_glow' in me.attributes: me.attributes.remove(me.attributes['_glow'])
        ga = me.attributes.new('_glow', 'FLOAT', 'POINT')
        for v, g in zip(me.vertices, ga.data): g.value = glow(v.co, v.normal)


def tint_ao(o, fn):
    """Multiply an AO bake already in Col by a position-dependent tint fn(co) -> (r, g, b)."""
    ca = o.data.color_attributes['Col']
    for v, c in zip(o.data.vertices, ca.data):
        t = fn(v.co); a = c.color
        c.color = (a[0] * t[0], a[1] * t[1], a[2] * t[2], 1.0)


def horn_path(base, d0, curl_axis, L, r0, curl, n=28, taper=1.15):
    pts, rad = [], []; p = base.copy(); d = d0.normalized()
    for i in range(n + 1):
        u = i / n; pts.append(p.copy()); rad.append(r0 * (1 - u) ** taper)
        d = (Matrix.Rotation(curl / n, 3, curl_axis) @ d).normalized(); p = p + d * (L / n)
    return pts, rad


def ringed_horn(name, base, d0, toward, L, r0, curl, rings=7, ring_from=0.08, ring_to=0.7):
    """A horn that curls from d0 toward `toward`, with keratin growth rings round its lower part."""
    axis = d0.normalized().cross(toward.normalized()).normalized()
    pts, rad = horn_path(base, d0, axis, L, r0, curl)
    tube(name, pts, rad, segs=16)
    n = len(pts) - 1
    for k in range(rings):
        u = ring_from + (ring_to - ring_from) * k / max(1, rings - 1)
        i = min(n - 1, int(u * n)); t = (pts[i + 1] - pts[i]).normalized()
        ring(f'{name}_r{k}', pts[i], t, rad[i] * 1.0, rad[i] * 0.13 + 0.002, segs=28)
    return pts, rad


# ======================================================================================================================
# HORNS — two big ones off the crown, up and out, the tips hooking forward and in (the cacodemon's). Dark keratin with
# growth rings; the bases sink 4-5 cm into the flesh so the SDF closes round them.
# ======================================================================================================================
if 'horns' in PARTS:
    clear_work()
    for s in (1,):
        base = bv(0.27 * s, 1.86, 0.02)
        # r0 0.10 x L 0.56: the first pass (0.078 x 0.46) read as two thin pins on a big ball; the plate's horns are
        # as thick at the root as the eye is wide.
        ringed_horn('hornL', base, Vector((0.55 * s, -0.10, 1.0)), Vector((-0.25 * s, -0.75, 0.55)), 0.56, 0.100, 1.45)
    o = fuse('pelvis|hornL', voxel=0.0022, smooth=(0.5, 3), noise=0.0018, noise_scale=0.03)
    # Fine lengthwise striations: score shallow lines down the horn (keratin grain), pressed, not booleaned.
    decimate(o, 14000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    # Near-black at the root, warming to a dull brown-grey toward the tip (the plate's dark horns catch light on top).
    b0 = bv(0.27, 1.86, 0.02)
    tint_ao(o, lambda co: (lambda u: (0.022 + 0.10 * u, 0.017 + 0.065 * u, 0.016 + 0.040 * u))(min(1.0, max(0.0, (co - b0).length / 0.50))))
    install(o, 'pelvis|hornL')
    mirror_to_r(o, 'pelvis|hornR')

# ======================================================================================================================
# CROWN SPURS — a few pale bone cones breaking the skin of the crown, raked back. Small, uneven (the plate's lone cone).
# ======================================================================================================================
if 'spurs' in PARTS:
    clear_work()
    for i, (x, y, z, dx, dz, L, r0) in enumerate([
        (0.08, 1.93, 0.18, 0.05, 0.25, 0.12, 0.026),
        (-0.06, 1.95, 0.02, -0.08, -0.25, 0.09, 0.020),
        (0.16, 1.88, -0.22, 0.15, -0.55, 0.08, 0.018),
        (-0.20, 1.87, -0.26, -0.25, -0.55, 0.07, 0.016),
    ]):
        d0 = Vector((dx, -dz, 1.0))
        pts, rad = horn_path(bv(x, y, z), d0, d0.cross(Vector((0, 1, 0))).normalized(), L, r0, -0.5)
        tube(f'spur{i}', pts, rad, segs=12)
    o = fuse('pelvis|spurs', voxel=0.0016, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 4000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (0.55, 0.43, 0.26))
    install(o, 'pelvis|spurs')

# ======================================================================================================================
# TEETH — two rows rooted in the lips. The lips are `bar`s from the mouth's middle to its corners (blob-inspect):
#   upper  a (0, 1.44, 0.50) -> b (+-0.39, 1.32, 0.33), r 0.095, bend (0.01, 0.03, 0.08)
#   lower  a (0, 1.03, 0.49) -> b (+-0.39, 1.32, 0.33), r 0.105, bend (0.01, -0.05, 0.08)
# A tooth's root sits 2 cm inside the lip's inner edge (the SDF hides it); the upper row hangs, the lower row stands,
# both raking slightly inward like fangs. Long and UNEVEN: lengths, widths, lean and spacing all vary, two are broken.
# ======================================================================================================================
def lip(a, b, bend, r, s):
    """A point on a lip's centreline at s in -1..1 (sign = side), and its inner edge's offset."""
    side = 1 if s >= 0 else -1; t = abs(s)
    A = Vector(a); B = Vector((b[0] * side, b[1], b[2])); bd = Vector((bend[0] * side, bend[1], bend[2]))
    return lerp3(A, B, t) + bd * (4 * t * (1 - t))


def tooth(name, root, down, L, w, flat=0.62, hook=0.25, broken=False):
    """A flattened, slightly hooked tooth from `root` along `down` (blob coords), tip rakes back into the mouth."""
    n = 14; pts = []; rad = []
    back = Vector((0, 0, -1))
    for i in range(n + 1):
        u = i / n
        if broken and u > 0.62: break
        p = root + down * (L * u) + back * (hook * L * u * u)
        pts.append(bv(*p)); rad.append(w * (1 - u) ** 0.9 + 0.0012)
    o = tube(name, pts, rad, segs=10)
    # flatten across the mouth (blender x), keep the width along the lip
    for v in o.data.vertices:
        c = pts[0]; v.co.y = c.y + (v.co.y - c.y) * flat
    return o


if 'teeth' in PARTS:
    clear_work()
    # The ORIGINAL lips (teratoma.blob). Two filler-lip passes (2026-10-22) were tried and rejected by the owner:
    # "the original ones were best; these are too smooth, too red".
    UP = ((0, 1.44, 0.50), (0.39, 1.32, 0.33), (0.01, 0.03, 0.05), 0.068)
    LO = ((0, 1.07, 0.49), (0.39, 1.32, 0.33), (0.01, -0.05, 0.05), 0.076)
    # (s along the lip, length, width, broken) — upper: big canines either side of the middle, smaller toward corners.
    upper = [(-0.86, 0.075, 0.016, False), (-0.68, 0.115, 0.021, False), (-0.50, 0.150, 0.026, False),
             (-0.33, 0.105, 0.020, True), (-0.15, 0.135, 0.024, False), (0.02, 0.120, 0.022, False),
             (0.19, 0.160, 0.027, False), (0.37, 0.100, 0.019, False), (0.54, 0.140, 0.025, False),
             (0.72, 0.090, 0.018, False), (0.88, 0.065, 0.015, False)]
    lower = [(-0.80, 0.070, 0.017, False), (-0.60, 0.110, 0.022, False), (-0.40, 0.085, 0.019, False),
             (-0.22, 0.125, 0.024, False), (-0.05, 0.095, 0.020, True), (0.12, 0.130, 0.025, False),
             (0.30, 0.090, 0.019, False), (0.47, 0.120, 0.023, False), (0.66, 0.080, 0.018, False),
             (0.84, 0.060, 0.015, False)]
    for k, (s, L, w, br) in enumerate(upper):
        c = lip(*UP[:3], UP[3], s)
        root = c + Vector((0, -UP[3] * 0.55, -0.02))
        lean = Vector((R.uniform(-0.12, 0.12), -1, R.uniform(-0.05, 0.10))).normalized()
        tooth(f'tu{k}', root, lean, L * 1.25 + 0.03, w * 1.1, hook=R.uniform(0.15, 0.35), broken=br)
    for k, (s, L, w, br) in enumerate(lower):
        c = lip(*LO[:3], LO[3], s)
        root = c + Vector((0, LO[3] * 0.55, -0.02))
        lean = Vector((R.uniform(-0.12, 0.12), 1, R.uniform(-0.05, 0.10))).normalized()
        tooth(f'tl{k}', root, lean, L * 1.2 + 0.03, w * 1.1, hook=R.uniform(0.10, 0.30), broken=br)
    o = fuse('pelvis|teeth', voxel=0.0011, smooth=(0.5, 2), noise=0.0006, noise_scale=0.012)
    decimate(o, 16000)
    bake_ao(o, material='tooth', gain=1.0, gamma=1.0, tint=(1.0, 1.0, 1.0), ao_dist=0.03)
    # Yellowed enamel; rotten brown toward the gums (the lip lines), a dirty band at the root.
    def stain(co):
        b = Vector((co.x, co.z, -co.y))  # blender -> blob
        dy = min(abs(b.y - 1.40 + 0.25 * abs(b.x)), abs(b.y - 1.12 - 0.40 * abs(b.x) ** 1.5))
        g = max(0.0, min(1.0, dy / 0.07))
        return (0.36 + 0.52 * g, 0.24 + 0.50 * g, 0.12 + 0.28 * g)
    tint_ao(o, stain)
    install(o, 'pelvis|teeth')

# ======================================================================================================================
# THE EYE — the one great yellow eye, a ball in the socket under the brow: centre (0, 1.625, 0.40), r 0.135 (front
# z 0.535, its top tucked under the brow, its bottom under the upper lip like a lower lid). Material `cacoeye`: GLOW_FROM_ATTRIBUTE in kit-overlay.ts makes its `_glow`
# attribute emission, so the IRIS burns yellow (bright at the pupil's rim, dimmer at its edge), the bloodshot sclera
# barely glows and the SLIT pupil is black and dead. No light is added: the glow is the eye's own.
# ======================================================================================================================
# r 0.135, up from 0.115: the plate's eye is as wide as a third of the face; the first one read as a coin.
EYE_C, EYE_R = (0.0, 1.625, 0.40), 0.135
if 'eye' in PARTS:
    clear_work()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=64, radius=EYE_R, matrix=Matrix.Translation(bv(*EYE_C)))
    o = mkobj('eye', bm)
    plain(o, 'cacoeye')
    C = bv(*EYE_C)

    def eyepart(co):
        d = (co - C).normalized()          # blender: forward is -y
        fwd = -d.y
        ang = math.degrees(math.acos(max(-1, min(1, fwd))))
        x, z = d.x, d.z                    # across, up
        iris = ang < 40
        slit = iris and abs(x) < 0.075 * max(0.0, 1 - (z / 0.55) ** 2) + 0.004
        return ang, iris, slit, x, z

    def col(co, n):
        ang, iris, slit, x, z = eyepart(co)
        if slit: return (0.02, 0.01, 0.0)
        if iris:
            k = ang / 40
            return (1.0, 0.45 - 0.22 * k, 0.015)
        # sclera: sick yellow-white, veins of red toward the back
        vein = 0.5 + 0.5 * math.sin(x * 60 + z * 23) * math.sin(z * 41 - x * 17)
        k = min(1.0, (ang - 40) / 50)
        r = 0.62; g = 0.42 - 0.30 * k * vein; b = 0.14 - 0.10 * k * vein
        return (r, g, b)

    def glow(co, n):
        ang, iris, slit, x, z = eyepart(co)
        if slit: return 0.0
        if iris: return 1.0 - 0.45 * (ang / 40) ** 2
        return max(0.0, 0.25 - 0.25 * (ang - 40) / 25)
    colour_by(o, col, glow)
    install(o, 'pelvis|eye')

# ======================================================================================================================
# TALONS — three hooked claws per hand, curling down off the palm (hand.l (0.602, 1.106, 0.410) -> (0.602, 1.071,
# 0.471), palm blob r 0.032 at t 0.4). Withered fingers are all claw: keratin like the horns, yellowed at the points.
# ======================================================================================================================
if 'talons' in PARTS:
    clear_work()
    H0, H1 = Vector((0.602, 1.106, 0.410)), Vector((0.602, 1.071, 0.471))
    hd = (H1 - H0).normalized()
    for i, (dx, L, r0) in enumerate([(-0.022, 0.085, 0.0105), (0.0, 0.100, 0.0115), (0.024, 0.080, 0.010)]):
        base = lerp3(H0, H1, 0.55) + Vector((dx, -0.004, 0))
        d = (hd + Vector((dx * 4, 0.05, 0))).normalized()
        db = bv(*d) - bv(0, 0, 0)
        pts, rad = horn_path(bv(*base), db, db.cross(Vector((0, 0, -1))).normalized(), L, r0, 1.6, taper=1.0)
        tube(f'talon{i}', pts, rad, segs=10)
    o = fuse('hand.l|talons', voxel=0.0011, smooth=(0.5, 2), noise=0.0005, noise_scale=0.01)
    decimate(o, 5000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.1, tint=(1.0, 1.0, 1.0), ao_dist=0.03)
    hb = bv(*lerp3(H0, H1, 0.55))
    tint_ao(o, lambda co: (lambda u: (0.03 + 0.40 * u, 0.022 + 0.30 * u, 0.016 + 0.12 * u))(min(1.0, (co - hb).length / 0.09)))
    install(o, 'hand.l|talons')
    mirror_to_r(o, 'hand.r|talons')

# ======================================================================================================================
# SHACKLES AND CHAINS — an iron cuff on each wrist (foreArm.l (0.594, 1.149, 0.277) -> (0.602, 1.106, 0.410), flesh
# r 0.034 -> 0.028), its rolled lips, a hinge knuckle on the outside and a lock lug underneath with a staple; from the
# staple a chain of seven links hangs straight down (it rides the forearm rigidly) and ends in a broken link.
# ======================================================================================================================
def link(name, c, axis_long, axis_n, L, W, wire, broken=False):
    """An oval chain link centred c, long along axis_long, its plane normal axis_n."""
    e1 = axis_long.normalized(); e2 = axis_n.normalized().cross(e1).normalized()
    pts = []; n = 40
    for k in range(n + 1 if broken else n + 3):
        a = 2 * math.pi * k / n
        if broken and 0.30 * n < k < 0.42 * n: continue
        x = math.cos(a); y = math.sin(a)
        # stadium: straight sides
        px = (L / 2 - W / 2) * (1 if x >= 0 else -1) + (W / 2) * x
        pts.append(c + e1 * px + e2 * (W / 2) * y)
    if broken:
        gap = [i for i in range(len(pts) - 1) if (pts[i + 1] - pts[i]).length > 0.01]
        if gap:
            g = gap[0]; pts = pts[g + 1:] + pts[:g + 1]
    return tube(name, pts, [wire] * len(pts), segs=10)


if 'shackles' in PARTS:
    clear_work()
    F0, F1 = Vector((0.594, 1.149, 0.277)), Vector((0.602, 1.106, 0.410))
    fa = bv(*F1) - bv(*F0); L = fa.length
    Fr = BoneFrame(bv(*F0), bv(*F1), fwd=Vector((0, 0, -1)))   # f = down: the lug hangs under the wrist
    t0, t1 = 0.62, 0.92
    rin = 0.034 + (0.028 - 0.034) * (t0 + t1) / 2 + 0.003
    shell, P, N = bone_shell('cuff', Fr, t0, t1, 0, 2 * math.pi, lambda t: rin + 0.011, lambda t: rin + 0.011, 0.011,
                             nu=12, nv=48, bulge=lambda t, ph: 0.002 * math.sin(math.pi * (t - t0) / (t1 - t0)))
    for t in (t0 + 0.012, t1 - 0.012):
        ring(f'lip{t}', Fr.at(t, 0, 0, 0), Fr.u, rin + 0.011, 0.0055, segs=40)
    # hinge knuckle on the outside (+s), lock lug underneath (+f) with a staple for the chain
    ball('knuckle', Fr.at((t0 + t1) / 2, math.pi / 2, rin + 0.015, rin + 0.015), 0.011, 1.0, 1.0, 1.0)
    tube('pin', [Fr.at(t0 - 0.02, math.pi / 2, rin + 0.015, rin + 0.015), Fr.at(t1 + 0.02, math.pi / 2, rin + 0.015, rin + 0.015)], [0.005, 0.005], segs=10)
    lug_c = Fr.at((t0 + t1) / 2, 0, rin + 0.020, rin + 0.020)
    ball('lug', lug_c, 0.016, 1.3, 1.3, 0.9)
    o = fuse('foreArm.l|shackle', voxel=0.0010, smooth=(0.5, 2), noise=0.0007, noise_scale=0.015)
    decimate(o, 9000)
    bake_ao(o, material='iron', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0), ao_dist=0.02)
    tint_ao(o, lambda co: (0.30, 0.11, 0.04) if (math.sin(co.x * 180) * math.sin(co.z * 210 + co.y * 90)) > 0.1 else (0.20, 0.19, 0.18))
    install(o, 'foreArm.l|shackle')
    mirror_to_r(o, 'foreArm.r|shackle')

    clear_work()
    staple = lug_c + Vector((0, 0, -0.022))
    ring('staple', staple + Vector((0, 0, 0.006)), Fr.u, 0.010, 0.0035, segs=24)
    p = staple + Vector((0, 0, -0.012)); down = Vector((0, 0, -1))
    LL, WW, wire = 0.050, 0.028, 0.0052
    for k in range(7):
        c = p + down * (LL / 2 - wire)
        n_ax = Fr.u if k % 2 == 0 else Fr.u.cross(down)
        link(f'link{k}', c, down, n_ax, LL, WW, wire, broken=(k == 6))
        p = p + down * (LL - 2.2 * wire)
    o = fuse('foreArm.l|chain', voxel=0.0009, smooth=(0.4, 1), noise=0.0004, noise_scale=0.01)
    decimate(o, 12000)
    bake_ao(o, material='chain', gain=1.0, gamma=1.1, tint=(1.0, 1.0, 1.0), ao_dist=0.02)
    tint_ao(o, lambda co: (0.32, 0.12, 0.05) if math.sin(co.z * 140 + co.x * 60) > 0.2 else (0.24, 0.23, 0.22))
    install(o, 'foreArm.l|chain')
    mirror_to_r(o, 'foreArm.r|chain')

clear_work()


# ======================================================================================================================
# THE STROGG CONVERSION (owner, 2026-10-22: "too on the nose; more like the dual-headed strogg stylistically"). The
# flesh ball is the demon; the machinery grafted onto it, in the twinhead's demon-skull style, keeps it alive and aloft:
#   cap     a skullmetal carapace over the crown and back, sagittal crest, chevron ribs, rolled lip, sutures, and the
#           horns growing OUT of it as curled skullmetal (they replace the keratin horns and crown spurs);
#   orbit   a demon-skull eye socket grafted round the eye: heavy brow, cheekbones sweeping down-back to points; it
#           takes the eye's yellow glow, baked (`_glow`, material `orbitmetal`);
#   jaw     a metal mandible plate under the lower lip with ribbed pneumatic pistons from its corners up the cheeks;
#   keel    the hover organ: a ribbed bony keel under the ball with glowing vents. It is why the thing floats.
# Every piece is seated on the marched skin through skin.json (scripts/teratoma-skin.ts), not a guessed ellipsoid.
# ======================================================================================================================
import json, os

# Base colours (glTF baseColorFactor; the vertex colours multiply them). Copied from the twinhead kit so the metal is
# the same metal: a fresh Blender material is white, and the first conversion pass rendered as polished chrome.
for _n, _c in {'skullmetal': (0.30, 0.31, 0.33), 'orbitmetal': (0.30, 0.31, 0.33), 'chrome': (0.42, 0.44, 0.48),
               'ventglow': (1.0, 0.45, 0.04)}.items():
    _m = bpy.data.materials.get(_n) or bpy.data.materials.new(_n); _m.use_nodes = True
    _m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*_c, 1.0)
    _m.diffuse_color = (*_c, 1.0)
_SK = json.load(open(os.path.join(os.path.dirname(bpy.data.filepath), 'skin.json')))
_C = Vector(_SK['centre'])


def skin(lat, lon):
    """Blob-coords skin point and normal at (lat, lon) deg round the ball's centre (bilinear on the grid)."""
    st = _SK['step']; nl = len(_SK['lon'])
    lat = max(-90.0, min(90.0, lat)); lon = ((lon + 180.0) % 360.0) - 180.0
    fi = (lat + 90) / st; fj = (lon + 180) / st
    i0 = min(int(fi), len(_SK['lat']) - 2); j0 = min(int(fj), nl - 2); a = fi - i0; b = fj - j0
    def g(arr, i, j): return Vector(arr[i * nl + j])
    p = (g(_SK['P'], i0, j0) * (1 - a) * (1 - b) + g(_SK['P'], i0 + 1, j0) * a * (1 - b)
         + g(_SK['P'], i0, j0 + 1) * (1 - a) * b + g(_SK['P'], i0 + 1, j0 + 1) * a * b)
    n = (g(_SK['N'], i0, j0) * (1 - a) * (1 - b) + g(_SK['N'], i0 + 1, j0) * a * (1 - b)
         + g(_SK['N'], i0, j0 + 1) * (1 - a) * b + g(_SK['N'], i0 + 1, j0 + 1) * a * b).normalized()
    return p, n


def sk(lat, lon, off=0.0):
    """Blender-coords point `off` metres out from the skin at (lat, lon)."""
    p, n = skin(lat, lon); q = p + n * off
    return bv(q.x, q.y, q.z)


def skn(lat, lon):
    p, n = skin(lat, lon); return bv(n.x, n.y, n.z) - bv(0, 0, 0)


def cap_dir(rho, phi, pole=(48.0, 180.0)):
    """(lat, lon) at angular distance rho (deg) from the cap's pole along bearing phi (0 = toward the front)."""
    la0, lo0 = map(math.radians, pole); r = math.radians(rho)
    # bearing 0 points from the pole toward the face (+z), i.e. over the crown
    la = math.asin(math.sin(la0) * math.cos(r) + math.cos(la0) * math.sin(r) * math.cos(phi))
    lo = lo0 + math.atan2(math.sin(phi) * math.sin(r) * math.cos(la0), math.cos(r) - math.sin(la0) * math.sin(la))
    return math.degrees(la), math.degrees(lo)


def glow_bake(o, src, r0, reach, power=2.0, facing=0.4):
    """Bake light from a glowing ball (centre src, radius r0, blender coords) onto o's `_glow`: steep falloff over
    `reach`, times how much each vertex faces the source."""
    me = o.data
    if '_glow' in me.attributes: me.attributes.remove(me.attributes['_glow'])
    ga = me.attributes.new('_glow', 'FLOAT', 'POINT')
    for v, g in zip(me.vertices, ga.data):
        d = src - v.co; dist = max(0.0, d.length - r0)
        f = max(0.0, 1 - dist / reach) ** power
        face = max(0.0, v.normal.dot(d.normalized()))
        g.value = f * (facing + (1 - facing) * face)


# The cap's edge outline: a CREST-PLATE, not a helmet. The first pass (rho ~62 deg, a smooth bowl over the whole crown
# and back) read as a motorcycle helmet. Now ~36 deg with five raked POINTS (front toward the eye socket, two at the
# horns, two down the back), so it reads as a bony graft with meat swelling round it. phi 0 = front.
CAP_POINTS = (0.0, 1.05, -1.05, 2.45, -2.45)
CAP_RHO = lambda phi: 30 + sum(16 * math.exp(-(((phi - a + math.pi) % (2 * math.pi) - math.pi) / 0.22) ** 2) for a in CAP_POINTS)

if 'cap' in PARTS:
    clear_work()
    OFF, TH = 0.006, 0.016
    P = lambda u, v: sk(*cap_dir(u * CAP_RHO(2 * math.pi * v), 2 * math.pi * v), OFF + 0.006 * (1 - u * u))
    N = lambda u, v: skn(*cap_dir(u * CAP_RHO(2 * math.pi * v), 2 * math.pi * v))
    surface_solid('shell', P, N, 40, 180, TH, closed_v=True)
    # rolled lip round the free edge
    tube('lip', [P(0.985, k / 360) for k in range(361)], [0.0085] * 361, segs=10)
    # sagittal crest: a base and a blade on top, front to back over the pole, fading at both ends
    path = [(r, 0.0) for r in range(42, -1, -3)] + [(r, math.pi) for r in range(3, 44, 3)]
    S = [sk(*cap_dir(r, ph), OFF + TH * 0.2) for r, ph in path]
    W = [math.sin(math.pi * (i + 0.5) / len(S)) for i in range(len(S))]
    tube('crest', S, [0.008 + 0.016 * w for w in W])
    tube('crest2', [s + (skn(*cap_dir(r, ph))) * (0.032 * w) for s, (r, ph), w in zip(S, path, W)], [0.002 + 0.009 * w for w in W])
    # raked spines along the crest's back half, like the twinhead's shin
    for k, r in enumerate((14, 24, 34)):
        c = sk(*cap_dir(r, math.pi), OFF + 0.03); n = skn(*cap_dir(r, math.pi))
        back = (sk(*cap_dir(r + 5, math.pi)) - sk(*cap_dir(r, math.pi))).normalized()
        horn(f'cspine{k}', c, n + back * 1.2, n.cross(back).normalized(), 0.07 - 0.012 * k, 0.014, curl=0.7)
    # chevron ribs raking down and back from the crest on both flanks
    for side in (1, -1):
        for r0 in (30, 20, 10):
            R = [i / 24 for i in range(25)]
            tube(f'rib{side}{r0}', [sk(*cap_dir(r0 + 14 * u, side * (0.25 + 1.0 * u ** 0.8)), OFF + TH * 0.6) for u in R],
                 [0.003 + 0.008 * math.sin(math.pi * (0.1 + 0.9 * u)) for u in R], segs=8)
        for k, rr in enumerate((22, 34)):
            ball(f'knob{side}{k}', sk(*cap_dir(rr, side * 1.9), OFF + TH * 0.6), 0.012)
    # the HORNS grow out of the cap: skullmetal, curling forward and in, ringed at the root like the twinhead's knee horn
    for side in (1, -1):
        la, lo = 50, side * 52
        base = sk(la, lo, -0.03)
        ringed_horn(f'horn{side}', base, Vector((0.55 * side, -0.10, 1.0)), Vector((-0.25 * side, -0.75, 0.55)), 0.56, 0.095, 1.45,
                    rings=4, ring_from=0.10, ring_to=0.35)
        ring(f'collar{side}', sk(la, lo, 0.012), skn(la, lo), 0.10, 0.012, segs=40)
    o = fuse('cap', voxel=0.0024, smooth=(0.55, 3), noise=0.0022, noise_scale=0.035)
    sut = [zigzag(lambda s, side=side: sk(*cap_dir(18 + 36 * s, side * 1.5), OFF + TH),
                  0.006, 9, lambda s, side=side: (sk(*cap_dir(18 + 36 * s, side * 1.62), OFF + TH) - sk(*cap_dir(18 + 36 * s, side * 1.5), OFF + TH)).normalized())
           for side in (1, -1)]
    press_lines(o, sut, width=0.004, depth=0.003)
    decimate(o, 26000)
    # gain 1.5: at 1.0 x base 0.30 the plate rendered near-black against the meat (first conversion look)
    bake_ao(o, 'skullmetal', gain=1.5, gamma=1.6)
    install(o, 'pelvis|cap')
    for nm in ('pelvis|hornL', 'pelvis|hornR', 'pelvis|spurs'):
        if bpy.data.objects.get(nm): bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)

if 'orbit' in PARTS:
    clear_work()
    E = bv(*EYE_C); ax = Vector((0, -1, 0))               # the eye looks down blender -y
    up = Vector((0, 0, 1)); rt = Vector((1, 0, 0))
    def rim(a, r=EYE_R + 0.022, fwd=0.040):
        """The socket's rim at angle a (0 = top, +90 = the body's left)."""
        return E + up * (r * math.cos(a)) + rt * (r * math.sin(a)) + ax * fwd
    A = [2 * math.pi * k / 96 for k in range(97)]
    # thick at the brow, thinner at the cheek, rolled like a skull's orbit
    tube('orbit', [rim(a) for a in A], [0.016 + 0.020 * max(0, math.cos(a)) ** 1.5 for a in A], segs=12)
    # the brow: a heavy shelf over the socket, overhanging it, with a crest and two raked spines
    tube('brow', [rim(a, EYE_R + 0.05, 0.03) + up * 0.02 for a in [math.radians(x) for x in range(-80, 81, 8)]],
         [0.012 + 0.016 * math.cos(math.radians(x)) ** 2 for x in range(-80, 81, 8)], segs=12)
    for side in (1, -1):
        horn(f'browspine{side}', rim(side * math.radians(40), EYE_R + 0.06, 0.02) + up * 0.03,
             Vector((side * 0.5, 0.6, 0.6)), Vector((0, 0, 1)).cross(Vector((side, 0, 0))) * -1, 0.09, 0.012, curl=0.8)
        # cheekbones: sweep down and back from the lower outer rim to a point over the jowl
        C0 = rim(side * math.radians(115))
        pts = [C0 + rt * (side * 0.12 * u) + up * (-0.06 * u - 0.03 * u * u) + ax * (-0.10 * u) for u in [i / 20 for i in range(21)]]
        tube(f'cheek{side}', pts, [0.020 * (1 - i / 20) ** 0.9 + 0.003 for i in range(21)], segs=12)
    # a short graft plate running up from the brow into the cap's front point, so it reads as one skull
    tube('bridge', [rim(0, EYE_R + 0.05, 0.03) + up * (0.03 + 0.10 * u) + ax * (-0.06 * u) for u in [i / 10 for i in range(11)]],
         [0.022 - 0.008 * i / 10 for i in range(11)], segs=12)
    o = fuse('orbit', voxel=0.0018, smooth=(0.55, 3), noise=0.0018, noise_scale=0.03)
    decimate(o, 14000)
    bake_ao(o, 'orbitmetal')
    glow_bake(o, E, EYE_R, 0.10, power=2.2)
    install(o, 'pelvis|orbit')

if 'jaw' in PARTS:
    clear_work()
    # mandible plate: wraps the chin UNDER the lower lip, lat -72..-42, lon -54..54, its lower edge coming to a chin
    # point. The first pass reached lat -24 and its top edge cut through the lower lip and the lower teeth.
    LA0 = lambda v: -72 - 8 * math.exp(-((v - 0.5) / 0.12) ** 2)
    LA1 = lambda v: -42 - 6 * abs(v - 0.5)
    P = lambda u, v: sk(LA0(v) + (LA1(v) - LA0(v)) * u, -54 + 108 * v, 0.006)
    N = lambda u, v: skn(LA0(v) + (LA1(v) - LA0(v)) * u, -54 + 108 * v)
    surface_solid('mandible', P, N, 24, 80, 0.015)
    edge_pts = [P(1, k / 80) for k in range(81)]; tube('jlip', edge_pts, [0.007] * 81, segs=10)
    tube('jlip2', [P(0, k / 80) for k in range(81)], [0.0075] * 81, segs=10)
    tube('chincrest', [P(u / 12, 0.5) + skn(LA0(0.5), 0) * 0.012 for u in range(13)], [0.006 + 0.004 * math.sin(math.pi * u / 12) for u in range(13)])
    for side in (1, -1):
        for k, v in enumerate((0.30, 0.18)):
            vv = 0.5 + side * (0.5 - v)
            R = [i / 16 for i in range(17)]
            tube(f'jrib{side}{k}', [P(0.15 + 0.7 * u, vv - side * 0.05 * u) + N(0.5, vv) * 0.016 for u in R], [0.002 + 0.004 * math.sin(math.pi * u) for u in R], segs=8)
        # the pneumatic piston: from a mount at the mandible's corner up the cheek to a mount under the cap's temple
        a = sk(-44, side * 56, 0.02); b = sk(18, side * 84, 0.02)
        d = (b - a).normalized(); L = (b - a).length
        ball(f'mA{side}', a, 0.022); ball(f'mB{side}', b, 0.020)
        ring(f'mAr{side}', a, d, 0.022, 0.005)
        tube(f'cyl{side}', [a + d * (0.02 + 0.5 * L * i / 10) for i in range(11)], [0.016] * 11, segs=16)
        for k in range(5):
            ring(f'cylrib{side}{k}', a + d * (0.04 + 0.09 * L * k), d, 0.017, 0.004, segs=24)
        ring(f'gland{side}', a + d * (0.02 + 0.5 * L), d, 0.014, 0.006, segs=24)
    o = fuse('jaw', voxel=0.0018, smooth=(0.5, 3), noise=0.0015, noise_scale=0.03)
    decimate(o, 14000)
    bake_ao(o, 'skullmetal', gain=1.5, gamma=1.6)
    install(o, 'pelvis|jaw')
    # the piston RODS are chrome, separate so they keep their own look
    clear_work()
    for side in (1, -1):
        a = sk(-44, side * 56, 0.02); b = sk(18, side * 84, 0.02); d = (b - a).normalized(); L = (b - a).length
        tube(f'rod{side}', [a + d * (0.02 + 0.5 * L + (L * 0.48 - 0.02) * i / 6) for i in range(7)], [0.007] * 7, segs=12)
    o = fuse('rods', voxel=0.0012, smooth=(0.4, 1), noise=0.0)
    decimate(o, 3000)
    plain(o, 'chrome')
    install(o, 'pelvis|rods')

if 'keel' in PARTS:
    clear_work()
    # the hover organ: a bony keel under the ball, front to back, built from cascading vertebral lames over a spine
    spine = [sk(-90 + 3 * abs(t), 0 if t >= 0 else 180, 0.0) for t in [x / 2 for x in range(-50, 51, 4)]]
    # lame k: a chevron-shaped shell across the keel at lat (-90 + |t|), along lon 0 (front) / 180 (back)
    def lame(name, t, w, h):
        lo = 0 if t >= 0 else 180; la = -90 + abs(t)
        c = sk(la, lo, 0.0); n = skn(la, lo)
        fwd = Vector((0, -1, 0)) if t >= 0 else Vector((0, 1, 0))
        side = n.cross(fwd).normalized()
        pts = []; rad = []
        for i in range(21):
            s = (i / 20) * 2 - 1
            pts.append(c + side * (w * s) + n * (-0.01 + h * (1 - s * s)) + fwd * (0.03 * abs(s)))
            rad.append(0.010 + 0.012 * (1 - s * s))
        tube(name, pts, rad, segs=10)
    for k, t in enumerate(range(-32, 33, 8)):
        f = 1 - (t / 40) ** 2
        lame(f'lame{k}', t, 0.10 * f + 0.03, 0.05 * f + 0.02)
    tube('keelspine', [sk(-90 + abs(t), 0 if t >= 0 else 180, 0.07 * (1 - (t / 40) ** 2) + 0.01) for t in range(-36, 37, 3)],
         [0.014 + 0.012 * (1 - (t / 40) ** 2) for t in range(-36, 37, 3)], segs=12)
    for k, t in enumerate((-20, 0, 20)):    # vent housings: rolled rings round each glowing vent
        c = sk(-90 + abs(t), 0 if t >= 0 else 180, 0.085 * (1 - (t / 40) ** 2) + 0.01); n = skn(-90 + abs(t), 0 if t >= 0 else 180)
        ring(f'vent{k}', c, n, 0.028, 0.008, segs=32)
    for side in (1, -1):    # raked spines off the keel's flanks
        for k, t in enumerate((-24, 0, 24)):
            c = sk(-90 + abs(t), 0 if t >= 0 else 180, 0.04)
            horn(f'kspine{side}{k}', c + Vector((side * 0.08, 0, 0)), Vector((side * 0.7, 0.2 if t < 0 else -0.2, -0.6)), Vector((0, 1, 0)), 0.08, 0.012, curl=0.7)
    o = fuse('keel', voxel=0.0022, smooth=(0.55, 3), noise=0.0018, noise_scale=0.03)
    decimate(o, 18000)
    bake_ao(o, 'skullmetal', gain=1.5, gamma=1.6)
    install(o, 'pelvis|keel')
    clear_work()
    for k, t in enumerate((-20, 0, 20)):    # the vents' glowing cores (eyeglow: hot, no light thrown)
        c = sk(-90 + abs(t), 0 if t >= 0 else 180, 0.085 * (1 - (t / 40) ** 2) + 0.004)
        ball(f'core{k}', c, 0.022, 1.0, 1.0, 0.5)
    o = fuse('vents', voxel=0.0015, smooth=(0.4, 1), noise=0.0)
    plain(o, 'ventglow')
    install(o, 'pelvis|vents')

clear_work()


# ======================================================================================================================
# WIRES AND TUBES (owner, 2026-10-22: "more wires and tubes going in and out of the flesh"). Each run is a list of
# (lat, lon, off) controls: `off` > 0 arches the run OUT of the skin, < 0 dives it UNDER (the SDF hides it), so a run
# stitches in and out of the meat. Where a run dives in, `entries` collects the skin point: those are the raw flesh
# lips in teratoma.blob (# CABLE ENTRY prims), so a tube goes INTO a wound, never just into skin.
#   cables  black rubber (`cable`), twisted bundles off the crest-plate and the jaw;
#   hoses   fat dull-red feed hoses (`hose`) down the flanks, diving under the skin and back out, into the keel.
# ======================================================================================================================
for _n, _c in {'cable': (0.05, 0.05, 0.055), 'hose': (0.30, 0.07, 0.06), 'brass': (0.32, 0.20, 0.07)}.items():
    _m = bpy.data.materials.get(_n) or bpy.data.materials.new(_n); _m.use_nodes = True
    _m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*_c, 1.0)

ENTRIES = []


def _smooth(c, s):
    """Cosine-blend the controls c (list of tuples) at s in 0..1."""
    n = len(c) - 1; x = min(n - 1e-6, s * n); i = int(x); f = (1 - math.cos(math.pi * (x - i))) / 2
    return tuple(a + (b - a) * f for a, b in zip(c[i], c[i + 1]))


def run_path(ctrl, n=60):
    return [sk(*_smooth(ctrl, k / n)) for k in range(n + 1)]


def note_entries(ctrl, n=60):
    prev = None
    for k in range(n + 1):
        la, lo, off = _smooth(ctrl, k / n)
        if prev is not None and (prev > 0) != (off > 0):
            p, _ = skin(la, lo); ENTRIES.append((round(p.x, 3), round(p.y, 3), round(p.z, 3)))
        prev = off


def bundle(name, ctrl, r, strands=3, twist=5.0, spread=None):
    """A twisted bundle of `strands` cables of radius r round the run's centreline."""
    C = run_path(ctrl, 90); spread = spread or r * 1.25
    for j in range(strands):
        pts = []
        for k, c in enumerate(C):
            t = (C[min(k + 1, len(C) - 1)] - C[max(k - 1, 0)]).normalized()
            a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            e1 = (a - t * a.dot(t)).normalized(); e2 = t.cross(e1)
            ph = 2 * math.pi * (j / strands + twist * k / len(C))
            pts.append(c + (e1 * math.cos(ph) + e2 * math.sin(ph)) * spread)
        tube(f'{name}{j}', pts, [r] * len(pts), segs=8)


if 'wires' in PARTS:
    ENTRIES.clear()
    clear_work()
    BUNDLES = [
        # off the back of the crest-plate, down the back into the meat (two bundles, uneven)
        [(44, 172, 0.006), (28, 170, 0.045), (14, 166, 0.05), (2, 162, 0.02), (-8, 160, -0.04)],
        [(40, -150, 0.006), (24, -146, 0.04), (8, -140, 0.045), (-6, -136, -0.04)],
        # under the jaw plate back to the keel's nose
        [(-70, 8, 0.0), (-78, 6, 0.06), (-84, 10, 0.05), (-88, 40, 0.0)],
    ]
    for i, c in enumerate(BUNDLES):
        bundle(f'b{i}', c, 0.0055); note_entries(c)
    for side in (1, -1):
        # from the eye socket's temple up to the horn collar
        c = [(18, side * 30, 0.0), (30, side * 40, 0.035), (42, side * 48, 0.03), (50, side * 52, 0.0)]
        bundle(f't{side}', c, 0.0045, strands=2, twist=3.0)
        # stitch loops on the cheeks, in and out of the meat
        for k, (la, lo) in enumerate(((22, 70), (12, 74), (2, 78))):
            c = [(la, side * lo, -0.02), (la + 2, side * (lo + 4), 0.03), (la + 4, side * (lo + 8), -0.02)]
            tube(f's{side}{k}', run_path(c, 24), [0.005] * 25, segs=8)
    o = fuse('cables', voxel=0.0012, smooth=(0.4, 1), noise=0.0004, noise_scale=0.01)
    decimate(o, 16000)
    bake_ao(o, 'cable', ao_dist=0.03)
    install(o, 'pelvis|cables')

    clear_work()
    for side in (1, -1):
        # the feed hoses: out from under the crest-plate's side, down the flank, UNDER the skin, out again, into the keel
        c = [(34, side * 112, 0.0), (18, side * 116, 0.055), (2, side * 118, -0.03), (-14, side * 122, -0.03),
             (-26, side * 124, 0.05), (-46, side * 130, 0.06), (-66, side * 140, 0.0)]
        P = run_path(c, 90)
        tube(f'h{side}', P, [0.014] * len(P), segs=14)
        for k in range(8, 90, 6):     # corrugation rings along the hose
            t = (P[k + 1] - P[k - 1]).normalized()
            ring(f'hr{side}{k}', P[k], t, 0.0145, 0.0032, segs=20)
        note_entries(c)
        # a second, thinner hose from the cap's back corner into the flank
        c = [(30, side * 140, 0.0), (14, side * 142, 0.04), (0, side * 140, -0.03)]
        P = run_path(c, 40); tube(f'h2{side}', P, [0.009] * len(P), segs=12); note_entries(c)
    o = fuse('hoses', voxel=0.0016, smooth=(0.4, 2), noise=0.0006, noise_scale=0.015)
    decimate(o, 14000)
    bake_ao(o, 'hose', ao_dist=0.03)
    install(o, 'pelvis|hoses')

    clear_work()
    for side in (1, -1):     # brass ferrules where the hoses leave the metal
        for (la, lo) in ((34, 112), (-66, 140), (30, 140)):
            ring(f'f{side}{la}', sk(la, side * lo, 0.012), skn(la, side * lo), 0.019, 0.006, segs=24)
    o = fuse('ferrules', voxel=0.0012, smooth=(0.4, 1), noise=0.0)
    decimate(o, 3000)
    bake_ao(o, 'brass', ao_dist=0.02)
    install(o, 'pelvis|ferrules')
    clear_work()
