# Gorehound kit: shared joints and helpers. exec() after ../twinhead-kit/kit_sculpt.py, before a make_*.py.
# The helpers below `bell` are the butcher's (assets-source/butcher-kit/butcher_common.py, PR goblincore/blud#54).
# Joints are gorehound.blob's rest skeleton in blob coords (refresh from a buildBody dump if the skeleton moves:
# the bone heads/tails printed by `npx tsx` over build-body). The skin seen from above is skin.json
# (scripts/gorehound-skin.ts): use skin_y(x, z) to seat anything on the back or the head.
import bpy, math, json, os
from mathutils import Vector

J = {
    # hind leg: hip, stifle, hock, toe (the butcher's dog leg)
    'hip': (0.170, 0.840, 0.000), 'knee': (0.184, 0.572, 0.209), 'hock': (0.184, 0.352, -0.036), 'toe': (0.184, 0.036, 0.020),
    # foreleg: shoulder, elbow (points BACK), wrist, paw tip
    'shoulder': (0.154, 0.835, 0.552), 'elbow': (0.174, 0.554, 0.401), 'wrist': (0.174, 0.248, 0.525), 'paw': (0.174, 0.033, 0.763),
    # the back line and the head
    'pelvis': (0.0, 0.740, 0.0), 'hips': (0.0, 0.840, 0.0), 'withers': (0.0, 1.019, 0.552), 'neckBase': (0.0, 0.935, 0.733),
    'atlas': (0.0, 0.921, 0.892), 'muzzle': (0.0, 0.862, 1.227), 'chin': (0.0, 0.808, 1.170),
}
JV = {k: bv(*v) for k, v in J.items()}

_SKIN = json.load(open(os.path.join(KIT_DIR, 'skin.json')))


def skin_y(x, z):
    """The marched torso+head skin's height (blob y) above blob (x, z), bilinear on skin.json; None off the body."""
    xs, zs, st = _SKIN['xs'], _SKIN['zs'], _SKIN['step']
    fx = (x - xs[0]) / st; fz = (z - zs[0]) / st
    i = max(0, min(len(xs) - 2, int(math.floor(fx)))); k = max(0, min(len(zs) - 2, int(math.floor(fz))))
    a = fx - i; b = fz - k
    Y = _SKIN['Y']
    c = [Y[i][k], Y[i + 1][k], Y[i][k + 1], Y[i + 1][k + 1]]
    if any(v is None for v in c): return None
    return (c[0] * (1 - a) + c[1] * a) * (1 - b) + (c[2] * (1 - a) + c[3] * a) * b


def on_skin(x, z, lift=0.0):
    """Blender point on the back's skin at blob (x, z), `lift` metres up. Off the body's edge (no sample) the
    height is the nearest skin walking in toward the back's centre line, so a plate's rim drapes, never fails."""
    y = skin_y(x, z)
    k = 1.0
    while y is None and k > 0:
        k -= 0.05
        y = skin_y(x * k, 0.4 + (z - 0.4) * k)
    return bv(x, (y if y is not None else 1.0) + lift, z)


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


def thicken(name, a, b, k, k_along=1.0, about=None):
    """Scale a finished mech part RADIALLY about the bone axis a -> b by k (and by k_along along it, about `about`,
    default a). The butcher's leg sculpts are sized for a slim zombie; the gorehound wants the pinky's weight, so
    its legs are the same sculpts made fatter after the fact (AO colours ride the vertices)."""
    o = bpy.data.objects.get(name)
    if o is None: return
    u = (b - a).normalized(); p0 = about if about is not None else a
    for v in o.data.vertices:
        d = v.co - p0; t = d.dot(u)
        v.co = p0 + u * (t * k_along) + (d - u * t) * k
    o.data.update()
