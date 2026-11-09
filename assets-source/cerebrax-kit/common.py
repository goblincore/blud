# Cerebrax kit: joints, skin seating and shared helpers. exec()'d by ../butcher-kit/build.py after kit_sculpt.py and
# butcher_common.py (drop, edge_lips, finish, plain_part, helix, wear_colours), so make_*.py can use all three:
#   Blender -b assets-source/cerebrax-kit/cerebrax-kit.blend --python assets-source/butcher-kit/build.py -- \
#       make_harness.py make_legs.py make_head.py make_gun.py --export --preview .lab-tmp/kitpv
#   npx tsx scripts/blender-kit.ts cerebrax assets-source/cerebrax-kit/cerebrax-parts.glb
#
# EVERY NUMBER IS COMPILED METRES. cerebrax.blob is `scale 1.60`, and scripts/blender-kit.ts skins the kit to the BUILT
# body, so the joints below are a buildBody dump (biomech-style.md, the gamer: "a scaled body's kit is in COMPILED
# metres"). Re-dump them if the skeleton moves. The brain is seated through skin.json (scripts/cerebrax-skin.ts):
# re-run that after any edit to the brain's prims.
#
# COLOURS ARE LINEAR (the teratoma's lesson): a near-black is 0.02-0.05.
import bpy, json, os, math
from mathutils import Vector, Matrix

J = {
    # the frame
    'hips': (0.0, 1.504, 0.0), 'withers': (0.0, 1.504, 0.800), 'centre': (0.0, 1.888, 0.400),
    # hind leg (.l): hip socket -> the high knee -> the ankle cap -> the toe's point on the floor
    'hip': (0.480, 1.504, 0.000), 'knee': (1.280, 2.752, -0.720), 'hock': (1.728, 0.208, -1.280), 'toe': (1.758, -0.004, -1.310),
    # fore leg (.l): the same leg on the front diagonal
    'shoulder': (0.480, 1.504, 0.800), 'elbow': (1.280, 2.752, 1.520), 'wrist': (1.728, 0.208, 2.080), 'paw': (1.758, -0.004, 2.110),
}
JV = {k: bv(*v) for k, v in J.items()}

# Materials this kit adds beside the gibbet's (skullmetal, chrome, black, iron, brass, cable, eyeglow, tooth): the
# tendrils' dull red rubber (kit-overlay.ts `hose`). A fresh Blender material exports white, so set the base colour.
for _n, _c in {'hose': (0.22, 0.045, 0.045), 'chrome': (0.42, 0.44, 0.48), 'black': (0.02, 0.02, 0.022),
               'skullmetal': (0.30, 0.31, 0.33), 'eyeglow': (1.0, 0.12, 0.04), 'tooth': (0.62, 0.55, 0.40)}.items():
    _m = bpy.data.materials.get(_n) or bpy.data.materials.new(_n); _m.use_nodes = True; _m.use_fake_user = True
    _m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*_c, 1.0)
    _m.diffuse_color = (*_c, 1.0)

_SK = json.load(open(os.path.join(KIT_DIR, 'skin.json')))
_C = Vector(_SK['centre'])


def skin(lat, lon):
    """Blob-coords brain skin point and normal at (lat, lon) deg round the brain's centre (bilinear on the grid;
    lon 0 faces the front, +90 the body's left)."""
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
    """Blender-coords point `off` metres out from the brain's skin at (lat, lon)."""
    p, n = skin(lat, lon); q = p + n * off
    return bv(q.x, q.y, q.z)


def skn(lat, lon):
    p, n = skin(lat, lon); return bv(n.x, n.y, n.z) - bv(0, 0, 0)


def brain_radius_at(lon, y):
    """The brain's horizontal radius (from its vertical axis) at blob height y along bearing lon: the outermost skin
    sample at that height. Below the brain's bottom, the radius at its lowest sample on that bearing."""
    best = None; lowest = None
    for i in range(0, 121):
        lat = -90 + i * 1.0
        p, _ = skin(lat, lon)
        if lowest is None or p.y < lowest[0]: lowest = (p.y, p)
        if abs(p.y - y) < 0.012:
            r = math.hypot(p.x - _C.x, p.z - _C.z)
            best = r if best is None else max(best, r)
    if best is None:
        # Below the brain on this bearing (under the tilted face's chin): the widest skin just above, so the band
        # passes UNDER the overhang instead of pinching in toward the axis.
        near = [math.hypot(p.x - _C.x, p.z - _C.z) for p in (skin(-90 + i * 1.0, lon)[0] for i in range(121)) if p.y < y + 0.10]
        best = max(near) if near else 0.30
    return best


# THE BRAIN'S TILT (cerebrax.blob, THE BRAIN): the brain is authored upright and rotated 25 deg face-down about its
# centre. Kit seated on the face is placed in the UPRIGHT brain's (lat, lon) and mapped through tilted().
TILT = 25.0


def tilted(lat, lon):
    """(lat, lon) on the upright brain -> the same point on the tilted one (rotation about x, +z toward -y)."""
    la, lo, t = math.radians(lat), math.radians(lon), math.radians(TILT)
    x, y, z = math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)
    y, z = y * math.cos(t) - z * math.sin(t), y * math.sin(t) + z * math.cos(t)
    return math.degrees(math.asin(max(-1.0, min(1.0, y)))), math.degrees(math.atan2(x, z))


def curl_path(p0, d0, axis, L, curl, n=40, twist=None):
    """Points of a curling run from p0 leaving along d0, turning `curl` rad about `axis` over length L (blender)."""
    pts = [p0.copy()]; p = p0.copy(); d = d0.normalized()
    for i in range(n):
        d = (Matrix.Rotation(curl / n, 3, axis) @ d).normalized()
        if twist is not None: d = (Matrix.Rotation(twist / n, 3, Vector((0, 0, 1))) @ d).normalized()
        p = p + d * (L / n); pts.append(p.copy())
    return pts


def resample(pts, step):
    """Resample a polyline every `step` metres of arclength."""
    L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    n = max(2, int(L[-1] / step)); out = []; k = 0
    for s in range(n + 1):
        at = L[-1] * s / n
        while k + 1 < len(L) - 1 and L[k + 1] < at: k += 1
        u = (at - L[k]) / max(1e-9, L[k + 1] - L[k])
        out.append(pts[k].lerp(pts[k + 1], u))
    return out


def glow_bake(o, srcs, reach, power=2.0, facing=0.35):
    """Bake light from glowing balls [(centre, radius, strength)] (blender coords) onto o's `_glow` (imp_common.py's
    recipe): a steep falloff over `reach`, times how much each vertex faces the source."""
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


def finish_part(name, kit, tris, material='skullmetal', mirror=False, lines=(), glow=None, ao=(1.0, 1.3), flatten=None, nrm=True, **fk):
    """fuse -> sutures -> keep the high -> decimate -> AO -> normal map -> optional glow -> install (and mirror a .l part to .r)."""
    o = fuse(name, **fk)
    if lines: press_lines(o, lines)
    if flatten is not None:
        for v in o.data.vertices:
            if v.co.z < flatten: v.co.z = flatten
        o.data.update()
    hi = keep_high(o) if nrm else None
    decimate(o, tris)
    bake_ao(o, material, gain=ao[0], gamma=ao[1])
    # The detail the decimation smeared comes back as a normal map baked from the high (kit_sculpt.py bake_normal).
    if hi: bake_normal(o, hi, kit, extrusion=max(0.006, 3 * fk.get('voxel', 0.0022)))
    if glow: glow_bake(o, *glow)
    install(o, kit)
    if mirror:
        b, _, nm = kit.partition('|')
        mirror_to_r(o, b.replace('.l', '.r') + '|' + nm)
    clear_work()
    return o


def join_work():
    """Join everything in the work collection into one object and return it. DESELECT FIRST (the imp's lesson): a
    part's install leaves it selected, and join() swallows every selected object, so the first cerebrax build lost
    its gun into the barrels and its feed hose into the eyes."""
    for o in bpy.context.view_layer.objects:
        if o: o.select_set(False)   # None: an object just removed (bake_normal's high copy) the layer still lists
    objs = list(work_coll().objects)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    return bpy.context.view_layer.objects.active
