# Butcher kit: shared joints and helpers. exec() after ../twinhead-kit/kit_sculpt.py, before a make_*.py.
# Joints are butcher.blob's rest skeleton (blob coords; `npx tsx` a buildBody dump to refresh them if the
# skeleton moves). Everything else follows make_body_armour.py's conventions.
import bpy, math
from mathutils import Vector

J = {
    'hip': (0.110, 1.140, 0.000), 'knee': (0.110, 0.812, 0.229), 'hock': (0.110, 0.418, -0.078), 'toe': (0.110, 0.032, 0.025),
    'pelvis': (0.0, 1.000, 0.0), 'chest': (0.0, 1.475, 0.058), 'neckTop': (0.0, 1.623, 0.118), 'skullTip': (0.0, 1.781, 0.146),
    'shoulderR': (-0.210, 1.475, 0.058), 'elbowR': (-0.306, 1.181, 0.079), 'wristR': (-0.321, 0.888, 0.142),
    'shoulderL': (0.210, 1.475, 0.058), 'elbowL': (0.306, 1.181, 0.079), 'wristL': (0.321, 0.888, 0.142),
}
JV = {k: bv(*v) for k, v in J.items()}
bell = lambda x, w=1.0: max(0.0, 1 - (x / w) ** 2)
sn = lambda t: math.sin(math.pi * min(1.0, max(0.0, t)))


def drop(prefixes):
    """Remove mech parts whose name starts with any of `prefixes` (e.g. 'thigh.l|')."""
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


def plain_part(o, material, kit, mirror=True):
    plain(o, material); install(o, kit)
    if mirror:
        b, _, n = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + n)
    clear_work()


def helix(F, t0, t1, turns, rf, rs, off, n=120, phase=0.0):
    """Points of a wire wound round a bone frame from t0 to t1."""
    pts = []
    for i in range(n + 1):
        u = i / n; t = t0 + (t1 - t0) * u; ph = phase + 2 * math.pi * turns * u
        pts.append(F.at(t, ph, rf(t) + off, rs(t) + off))
    return pts


def wear_colours(o, base, rust, blood, axis_from, axis_to, rust_at=(0.35, 0.65), blood_at=(0.6, 0.85), edge=None, seed_scale=40.0):
    """Steel -> rust -> dried blood along an axis (make_spike.py's recipe), optionally bloodier near `edge(v)` (0..1)."""
    from mathutils import noise
    me = o.data
    for a_ in list(me.color_attributes): me.color_attributes.remove(a_)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    ax = (axis_to - axis_from); L = ax.length; ax.normalize()
    sm = lambda e0, e1_, x: (lambda c: c * c * (3 - 2 * c))(max(0.0, min(1.0, (x - e0) / (e1_ - e0))))
    for v in me.vertices:
        t = (v.co - axis_from).dot(ax) / L
        n = noise.noise(v.co * seed_scale) * 0.5 + noise.noise(v.co * seed_scale * 2.7) * 0.25
        e = edge(v) if edge else 0.0
        kr = sm(rust_at[0], rust_at[1], t + n * 0.15)
        kb = sm(blood_at[0], blood_at[1], t + n * 0.12 + 0.45 * e)
        pit = 0.82 + 0.18 * (0.5 + 0.5 * noise.noise(v.co * 300.0))
        c = base.lerp(rust, kr * 0.8).lerp(blood, kb) * pit
        ca.data[v.index].color = (c.x, c.y, c.z, 1.0)
