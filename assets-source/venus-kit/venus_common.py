# Venus kit: shared surface data and helpers. exec() after ../twinhead-kit/kit_sculpt.py, before a make_*.py.
# The skin comes from surface.json (scripts/venus-surface.ts: re-run it whenever venus.blob's masses move): the cage,
# spine and collar are laid ON her probed surface, because a heavy body is nothing like a cylinder round a bone.
# drop / edge_lips / finish / wear_colours are the butcher's (butcher_common.py, PR goblincore/blud#54).
import bpy, json, math, os
from mathutils import Vector

SURF = json.load(open(os.path.join(KIT_DIR, 'surface.json')))
BONE = {n: (bv(*b['head']), bv(*b['tail'])) for n, b in SURF['bones'].items()}
bell = lambda x, w=1.0: max(0.0, 1 - (x / w) ** 2)
sn = lambda t: math.sin(math.pi * min(1.0, max(0.0, t)))


def waist_pt(y, ang):
    """Skin point on the waist at height y (blob) and angle ang (rad; 0 front, +pi/2 her left), from the probed rings,
    interpolated in angle and height. Returns (blender point, outward unit normal in the horizontal plane)."""
    ys = sorted(float(k) for k in SURF['waist'])
    y = min(max(y, ys[0]), ys[-1])
    hi = next((i for i, v in enumerate(ys) if v >= y), len(ys) - 1); lo = max(0, hi - 1)
    f = 0.0 if ys[hi] == ys[lo] else (y - ys[lo]) / (ys[hi] - ys[lo])

    def on_ring(yk):
        R = SURF['waist'][f'{yk:.2f}']; n = len(R)
        a = (ang / (2 * math.pi) * n) % n; i0 = int(a); w = a - i0
        p0 = Vector(R[i0]); p1 = Vector(R[(i0 + 1) % n])
        return p0.lerp(p1, w)
    p = on_ring(ys[lo]).lerp(on_ring(ys[hi]), f)
    p.y = y
    nrm = Vector((math.sin(ang), 0, math.cos(ang)))
    return bv(*p), bv(*nrm)


def polyline(pts, n):
    """Resample a list of blender points to n+1 evenly spaced points."""
    L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    out = []
    for k in range(n + 1):
        s = L[-1] * k / n
        j = next((i for i in range(1, len(L)) if L[i] >= s), len(L) - 1)
        w = 0 if L[j] == L[j - 1] else (s - L[j - 1]) / (L[j] - L[j - 1])
        out.append(pts[j - 1].lerp(pts[j], w))
    return out


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


def finish(name, kit, tris, mirror=True, material='skullmetal', lines=(), **fk):
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    decimate(o, tris)
    bake_ao(o, material)
    install(o, kit)
    if mirror:
        b, _, n = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + n)
    clear_work()
    return o


def wear_colours(o, base, rust, blood, axis_from, axis_to, rust_at=(0.35, 0.65), blood_at=(0.6, 0.85), seed_scale=40.0):
    """Steel -> rust -> dried blood along an axis (make_spike.py's recipe), as vertex colours."""
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
        kr = sm(rust_at[0], rust_at[1], t + n * 0.15)
        kb = sm(blood_at[0], blood_at[1], t + n * 0.12)
        pit = 0.82 + 0.18 * (0.5 + 0.5 * noise.noise(v.co * 300.0))
        c = base.lerp(rust, kr * 0.8).lerp(blood, kb) * pit
        ca.data[v.index].color = (c.x, c.y, c.z, 1.0)
