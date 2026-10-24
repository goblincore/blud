# Imp kit: shared skin data, materials and helpers. exec() after ../twinhead-kit/kit_sculpt.py, before a make_*.py
# (build.py does both). The skeleton and the probed skin come from skin.json (scripts/imp-skin.ts: re-run it whenever
# imp.blob's head or torso moves). drop / edge_lips / finish are the butcher's (butcher_common.py, PR goblincore/blud#54);
# colour_by / tint_ao / glow_bake are the teratoma's (make_teratoma.py).
import bpy, json, math, os
from mathutils import Vector

SKIN = json.load(open(os.path.join(KIT_DIR, 'skin.json')))
BONE = {n: (bv(*b['head']), bv(*b['tail'])) for n, b in SKIN['bones'].items()}
bell = lambda x, w=1.0: max(0.0, 1 - (x / w) ** 2)
sn = lambda t: math.sin(math.pi * min(1.0, max(0.0, t)))

# Base colours (LINEAR; biomech-style.md: a fresh material exports white and renders as chrome). The look of each is
# kit-overlay.ts LOOK by name; `impmetal` and `impclaw` also burn orange from their baked `_glow` (GLOW_FROM_ATTRIBUTE).
MATS = {'skullmetal': (0.30, 0.31, 0.33), 'impmetal': (0.30, 0.31, 0.33), 'chrome': (0.42, 0.44, 0.48),
        'iron': (0.055, 0.058, 0.065), 'horn': (1.0, 1.0, 1.0), 'impclaw': (1.0, 1.0, 1.0), 'tooth': (1.0, 1.0, 1.0),
        'void': (0.01, 0.008, 0.008), 'black': (0.02, 0.02, 0.022), 'ventglow': (1.0, 0.45, 0.04), 'eyeglow': (1.0, 0.10, 0.03)}
for _n, _c in MATS.items():
    m = bpy.data.materials.get(_n) or bpy.data.materials.new(_n)
    m.use_fake_user = True; m.diffuse_color = (*_c, 1.0); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf: bsdf.inputs['Base Color'].default_value = (*_c, 1.0)
if 'mech' not in bpy.data.collections:
    bpy.context.scene.collection.children.link(bpy.data.collections.new('mech'))


def skin(where, limb, x, y):
    """Probed skin point and normal at (x, y) (blob) from skin.json's `front`/`back` grid, bilinear over the hits
    (nearest hit where a corner missed). Returns blender (point, normal)."""
    g = SKIN[where][limb]; xs, ys = g['xs'], g['ys']
    fx = (x - xs[0]) / (xs[1] - xs[0]); fy = (y - ys[0]) / (ys[1] - ys[0])
    i0 = max(0, min(len(xs) - 2, int(fx))); j0 = max(0, min(len(ys) - 2, int(fy)))
    wx = min(1.0, max(0.0, fx - i0)); wy = min(1.0, max(0.0, fy - j0))
    acc = Vector(); nacc = Vector(); wsum = 0.0
    for dj, wj in ((0, 1 - wy), (1, wy)):
        for di, wi in ((0, 1 - wx), (1, wx)):
            p = g['P'][j0 + dj][i0 + di]
            if p is None or wi * wj == 0: continue
            acc += Vector(p) * (wi * wj); nacc += Vector(g['N'][j0 + dj][i0 + di]) * (wi * wj); wsum += wi * wj
    if wsum == 0:
        best = None
        for j, row in enumerate(g['P']):
            for i, p in enumerate(row):
                if p is None: continue
                d = (xs[i] - x) ** 2 + (ys[j] - y) ** 2
                if best is None or d < best[0]: best = (d, Vector(p), Vector(g['N'][j][i]))
        return bv(*best[1]), bv(*best[2]).normalized()
    p = acc / wsum; n = (nacc / wsum).normalized()
    return bv(*p), bv(*n)


def drop(prefixes):
    """Remove mech parts whose name starts with any of `prefixes` (e.g. 'hand.l|')."""
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


def colour_by(o, fn):
    """Vertex colours from fn(co, normal) -> (r, g, b)."""
    me = o.data
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    for v, c in zip(me.vertices, ca.data):
        r, g, b = fn(v.co, v.normal); c.color = (r, g, b, 1.0)


def tint_ao(o, fn):
    """Multiply an AO bake already in Col by a position-dependent tint fn(co) -> (r, g, b)."""
    ca = o.data.color_attributes['Col']
    for v, c in zip(o.data.vertices, ca.data):
        t = fn(v.co); a = c.color
        c.color = (a[0] * t[0], a[1] * t[1], a[2] * t[2], 1.0)


def glow_bake(o, srcs, reach, power=2.0, facing=0.35):
    """Bake light from glowing balls [(centre, radius, strength)] (blender coords) onto o's `_glow`: a steep falloff
    over `reach`, times how much each vertex faces the source. The fire's light on the metal and keratin round it."""
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


def finish(name, kit, tris, mirror=True, material='skullmetal', lines=(), glow=None, tint=None, ao=(1.0, 1.3), **fk):
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    decimate(o, tris)
    bake_ao(o, material, gain=ao[0], gamma=ao[1])
    if tint: tint_ao(o, tint)
    if glow: glow_bake(o, *glow)
    install(o, kit)
    if mirror:
        b, _, n = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + n)
    clear_work()
    return o


def plain_part(o, material, kit, mirror=True):
    plain(o, material); install(o, kit)
    if mirror:
        b, _, n = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + n)
    clear_work()


# Keratin: near-black at the root, a dull bone-grey toward the tip (the teratoma's horn ramp, paler for a pale hide).
def keratin(root, tip):
    ax = tip - root; L = ax.length; ax = ax / L
    return lambda co: (lambda u: (0.05 + 0.40 * u, 0.04 + 0.34 * u, 0.035 + 0.27 * u))(min(1.0, max(0.0, (co - root).dot(ax) / L)))
