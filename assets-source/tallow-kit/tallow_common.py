# Tallow kit: shared skin data, materials and helpers. exec() after ../twinhead-kit/kit_sculpt.py, before a make_*.py
# (build.py does both). The skeleton and the probed torso skin come from surface.json (scripts/tallow-surface.ts:
# re-run it whenever tallow.blob's torso or head moves). drop / edge_lips / colour_by / tint_ao / glow_bake / finish
# are the imp's (imp_common.py); tp / tn / catmull / hose are this kit's.
import bpy, bmesh, json, math, os, random
from mathutils import Vector, Matrix

SURF = json.load(open(os.path.join(KIT_DIR, 'surface.json')))
BONE = {n: (bv(*b['head']), bv(*b['tail'])) for n, b in SURF['bones'].items()}
bell = lambda x, w=1.0: max(0.0, 1 - (x / w) ** 2)
sn = lambda t: math.sin(math.pi * min(1.0, max(0.0, t)))
sm = lambda t: (lambda x: x * x * (3 - 2 * x))(min(1.0, max(0.0, t)))

# Base colours (LINEAR; biomech-style.md: a fresh material exports white and renders as chrome). The look of each is
# kit-overlay.ts LOOK by name. `impmetal` is skullmetal's look whose baked `_glow` burns fire orange
# (GLOW_FROM_ATTRIBUTE): the cannons and the boiler are lit by their own fire. `gore` is white so its vertex colours
# (blood) are the albedo.
MATS = {'skullmetal': (0.30, 0.31, 0.33), 'impmetal': (0.30, 0.31, 0.33), 'iron': (0.055, 0.058, 0.065),
        'hose': (0.22, 0.045, 0.045), 'brass': (0.32, 0.20, 0.07), 'void': (0.01, 0.008, 0.008),
        'ventglow': (1.0, 0.45, 0.04), 'gore': (1.0, 1.0, 1.0)}
for _n, _c in MATS.items():
    m = bpy.data.materials.get(_n) or bpy.data.materials.new(_n)
    m.use_fake_user = True; m.diffuse_color = (*_c, 1.0); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf: bsdf.inputs['Base Color'].default_value = (*_c, 1.0)
if 'mech' not in bpy.data.collections:
    bpy.context.scene.collection.children.link(bpy.data.collections.new('mech'))

_T = SURF['torso']


def _rad(y, ang):
    ys, angs, R = _T['ys'], _T['angs'], _T['R']
    fy = (y - ys[0]) / (ys[1] - ys[0]); j = max(0, min(len(ys) - 2, int(math.floor(fy)))); wy = min(1.0, max(0.0, fy - j))
    step = angs[1] - angs[0]; fa = (ang % 360.0) / step; i = int(math.floor(fa)) % len(angs); wa = fa - math.floor(fa)
    i2 = (i + 1) % len(angs)
    return (R[j][i] * (1 - wa) + R[j][i2] * wa) * (1 - wy) + (R[j + 1][i] * (1 - wa) + R[j + 1][i2] * wa) * wy


def _tb(y, ang, off=0.0):
    a = math.radians(ang); r = _rad(y, ang) + off
    return Vector((math.sin(a) * r, y, _T['zc'] + math.cos(a) * r))   # BLOB coords


def tn(y, ang):
    """Outward skin normal (blender) at torso height y, angle ang (deg; 0 = front, 90 = his left)."""
    da = _tb(y, ang + 2) - _tb(y, ang - 2); dy = _tb(y + 0.01, ang) - _tb(y - 0.01, ang)
    n = da.cross(dy)
    a = math.radians(ang); out = Vector((math.sin(a), 0, math.cos(a)))
    n = n.normalized() if n.length > 1e-9 else out
    if n.dot(out) < 0: n = -n
    return bv(*n)


def tp(y, ang, off=0.0):
    """Probed torso/head skin point (blender) at height y, angle ang, pushed `off` metres out along the normal."""
    p = bv(*_tb(y, ang))
    return p + tn(y, ang) * off if off else p


def drop(prefixes):
    """Remove mech parts whose name starts with any of `prefixes` (e.g. 'forearm.l|')."""
    for o in list(bpy.data.collections['mech'].all_objects):
        if any(o.name.startswith(p) for p in prefixes):
            bpy.data.objects.remove(o, do_unlink=True)


def edge_lips(P, N, r, n=60, which=('v0', 'v1', 'u0', 'u1'), inset=0.004, fade=None):
    for w in which:
        pts = []; rad = []
        for i in range(n + 1):
            s = i / n
            u, v = {'v0': (s, 0), 'v1': (s, 1), 'u0': (0, s), 'u1': (1, s)}[w]
            pts.append(P(u, v) - N(u, v) * inset); rad.append(r * (fade(s) if fade else 1.0))
        tube(f'lip{w}', pts, rad, segs=10)


def tint_ao(o, fn):
    """Multiply an AO bake already in Col by a position-dependent tint fn(co) -> (r, g, b)."""
    ca = o.data.color_attributes['Col']
    for v, c in zip(o.data.vertices, ca.data):
        t = fn(v.co); a = c.color
        c.color = (a[0] * t[0], a[1] * t[1], a[2] * t[2], 1.0)


def glow_bake(o, srcs, reach, power=2.0, facing=0.35):
    """Bake light from glowing balls [(centre, radius, strength)] (blender coords) onto o's `_glow`: a steep falloff
    over `reach`, times how much each vertex faces the source."""
    me = o.data
    if '_glow' in me.attributes: me.attributes.remove(me.attributes['_glow'])
    ga = me.attributes.new('_glow', 'FLOAT', 'POINT')
    for v, g in zip(me.vertices, ga.data):
        val = 0.0
        for src, r0, k in srcs:
            d = src - v.co; dist = max(0.0, d.length - r0)
            f = max(0.0, 1 - dist / reach) ** power
            face = max(0.0, v.normal.dot(d.normalized())) if d.length > 1e-6 else 1.0
            val += k * f * (facing + (1 - facing) * face)
        g.value = min(1.0, val)


def _mirror_name(kit):
    b, _, n = kit.partition('|')
    return b.replace('.l', '.r') + '|' + (n[:-1] + 'R' if n.endswith('L') else n)


def finish(name, kit, tris, mirror=True, material='skullmetal', lines=(), glow=None, tint=None, ao=(1.5, 1.6), **fk):
    """Fuse the work collection into one part, press sutures, decimate, bake AO (and glow), install as `kit`, and
    mirror it to the right. A part on a centre bone whose name ends in `L` mirrors to the same bone, ending `R`."""
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    decimate(o, tris)
    bake_ao(o, material, gain=ao[0], gamma=ao[1])
    if tint: tint_ao(o, tint)
    if glow: glow_bake(o, *glow)
    install(o, kit)
    if mirror: mirror_to_r(o, _mirror_name(kit))
    clear_work()
    return o


def plain_part(o, material, kit, mirror=True):
    plain(o, material); install(o, kit)
    if mirror: mirror_to_r(o, _mirror_name(kit))
    clear_work()


def catmull(ctrl, n=10):
    out = []
    P = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(ctrl[-1].copy())
    return out


def hose_run(name, ctrl, r, rib_every=0.030):
    """A corrugated hose through the control points (blender), left in the work collection: a tube with a rib ring
    every `rib_every` metres. Returns the sampled path."""
    pts = catmull(ctrl, 12)
    tube(name, pts, [r] * len(pts), segs=14)
    S = [0.0]
    for i in range(1, len(pts)): S.append(S[-1] + (pts[i] - pts[i - 1]).length)
    k = 1
    while k * rib_every < S[-1] - rib_every * 0.4:
        s = k * rib_every; j = next(i for i in range(1, len(S)) if S[i] >= s); w = (s - S[j - 1]) / max(1e-9, S[j] - S[j - 1])
        ring(f'{name}r{k}', pts[j - 1].lerp(pts[j], w), (pts[j] - pts[j - 1]).normalized(), r * 1.04, r * 0.22, segs=18)
        k += 1
    return pts


def port(name, at, axis, r):
    """A flanged bony port (work collection): a boss, a rolled flange, and four bolt knuckles round it."""
    axis = axis.normalized()
    ball(f'{name}b', at, r * 1.25)
    ring(f'{name}f', at + axis * r * 0.25, axis, r * 1.55, r * 0.34, segs=28)
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    e1 = (ref - axis * ref.dot(axis)).normalized(); e2 = axis.cross(e1)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        ball(f'{name}k{k}', at + (e1 * math.cos(a) + e2 * math.sin(a)) * r * 1.55 + axis * r * 0.3, r * 0.36)


# ---------- HEAVY PARTS AND GORE (the third pass, owner 2026-11-14: "more heavy and industrial ... more embedded in the
# flesh, more like bloody decals where the metal flesh interfaces") ----------

def basis(n):
    """Two unit vectors perpendicular to n, and n: the frame `prism` and `lump` build in."""
    n = n.normalized(); ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    e1 = (ref - n * ref.dot(n)).normalized()
    return e1, n.cross(e1), n


def prism(name, a, b, r, segs=8, rot=0.0):
    """A flat-capped prism from a to b (segs 6: a hex bolt; 8: an octagonal block). The voxel fuse rounds its edges a
    little, which is the industrial bevel. Its k-th flat faces direction rot + (2k + 1) pi / segs in basis(b - a)."""
    e1, e2, _ = basis(b - a)
    bm = bmesh.new()
    ring_ = lambda c: [bm.verts.new(c + (e1 * math.cos(rot + 2 * math.pi * k / segs) + e2 * math.sin(rot + 2 * math.pi * k / segs)) * r)
                       for k in range(segs)]
    ra, rb = ring_(a), ring_(b)
    for k in range(segs):
        bm.faces.new((ra[k], ra[(k + 1) % segs], rb[(k + 1) % segs], rb[k]))
    bm.faces.new(list(reversed(ra))); bm.faces.new(rb)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def bolt(name, p, n, r=0.011, h=0.012):
    """A hex bolt head on a washer, standing out of a surface at p along n."""
    n = n.normalized()
    prism(f'{name}w', p - n * 0.004, p + n * 0.004, r * 1.35, segs=12)
    prism(f'{name}h', p, p + n * h, r, segs=6)


def lump(name, p, n, r, flat=0.55, stretch=1.0, spin=0.0):
    """A clot or a lump of torn meat: an ellipsoid at p, flattened along n (it lies ON the surface)."""
    e1, e2, nn = basis(n)
    c, s_ = math.cos(spin), math.sin(spin)
    e1, e2 = e1 * c + e2 * s_, e2 * c - e1 * s_
    o = ball(name, Vector(), 1.0)
    o.data.transform(Matrix((e1 * r * stretch, e2 * r, nn * r * flat)).transposed().to_4x4())
    o.data.transform(Matrix.Translation(p))
    return o


def drip(name, p, length, r):
    """Blood hanging from p straight down (blender -z): thin in the middle, a bead at the end."""
    pts = [p + Vector((0, 0, -length * i / 10)) for i in range(11)]
    tube(name, pts, [r * (1.0 - 0.45 * math.sin(math.pi * i / 10)) for i in range(11)], segs=8)
    ball(f'{name}b', pts[-1], r * 1.35)


def gore_ring(name, centre, axis, radius, n, rmin, rmax, drips=0, dlen=(0.03, 0.08), out=None, seed=1, axial=None):
    """Torn meat and clotted blood round a place where metal goes into flesh: about `n` lumps on a ring of `radius`
    round `axis` through `centre`, each lying against the joint (normal between the ring's outward and `out`), and
    `drips` hanging from the lowest of them. IRREGULAR on purpose: an even ring of even lumps read as a row of red beads,
    a sweatband (owner, third look). So a quarter are skipped (gaps), one in five is a big clot, they wander along the
    axis by `axial` (default a third of rmax... of radius x 0.12), and they clump in pairs."""
    rng = random.Random(seed); e1, e2, ax = basis(axis); out = (out or ax).normalized()
    axial = radius * 0.12 if axial is None else axial
    for k in range(n):
        if rng.random() < 0.25: continue
        for c in range(2 if rng.random() < 0.35 else 1):
            a = 2 * math.pi * (k + rng.uniform(-0.45, 0.45)) / n
            rd = e1 * math.cos(a) + e2 * math.sin(a)
            r = rng.uniform(rmin, rmax) * (1.7 if rng.random() < 0.2 else 1.0)
            lump(f'{name}{k}_{c}', centre + rd * radius * rng.uniform(0.94, 1.06) + ax * rng.uniform(-axial, axial),
                 (rd * 0.5 + out * 0.85), r, flat=rng.uniform(0.35, 0.65), stretch=rng.uniform(1.0, 2.2), spin=rng.uniform(0, math.pi))
    pts = sorted((centre + (e1 * math.cos(2 * math.pi * k / n) + e2 * math.sin(2 * math.pi * k / n)) * radius for k in range(n)),
                 key=lambda p: p.z)
    for j, p in enumerate(pts[:drips]):
        drip(f'{name}d{j}', p, rng.uniform(*dlen), rng.uniform(0.005, 0.008))


def blood(co):
    """Gore's vertex colour (LINEAR): dark clot to fresh wet red, mottled by position."""
    h = 0.5 + 0.5 * math.sin(co.x * 61.0 + math.sin(co.z * 47.0) * 2.0 + co.y * 53.0)
    h = h * h   # mostly dark clot (0.14+ linear read as bright paint-red on the third look)
    return (0.06 + 0.17 * h, 0.006 + 0.014 * h, 0.006 + 0.012 * h)


BLOOD_ON_METAL = (0.85, 0.07, 0.055)   # a factor on the metal's 0.30 grey albedo: a dark wet red smear (at 0.62 it
                                       # vanished into the gunmetal on the third look)


def mix3(a, b, w):
    return tuple(x + (y - x) * w for x, y in zip(a, b))


def finish_gore(name, kit, tris=2500, mirror=True):
    """Fuse the work collection's lumps and drips into one gore part (white `gore`, the blood in vertex colours)."""
    return finish(name, kit, tris, mirror=mirror, material='gore', tint=blood, ao=(1.1, 1.2),
                  voxel=0.0022, smooth=(0.5, 2), noise=0.0012, noise_scale=0.02)
