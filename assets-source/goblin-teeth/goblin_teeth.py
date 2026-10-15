# The cinematic goblin's TEETH, sculpted procedurally in Blender (goblin expressions Task 17, owner 2026-10-15: "sculpt the teeth in
# Blender"; the WAM sweeps "read very meshy and simple bright", the SDF pegs before them "had a bit more character ... the color was
# a bit better"; "stouter teeth is a yes").
#
# RUN (inside Blender; it only touches the `GoblinTeeth` collection, never the rest of the scene):
#   blender --background --factory-startup --python assets-source/goblin-teeth/goblin_teeth.py -- --export
#   or, in a live Blender:  exec(open('<repo>/assets-source/goblin-teeth/goblin_teeth.py').read(), {'__name__': '__main__', 'ARGS': ['--export']})
# --export writes assets-source/goblin-teeth/goblin-teeth.glb next to this file (or --out <path>).
# The glb then goes into the kit: scripts/merge-kit-teeth.mjs (run by scripts/build-wam-kit.sh goblin-cinematic).
#
# FRAME. Every number below is in the KIT'S / .blob's frame: metres, Y up, +Z forward (the goblin faces +Z), the goblin standing at
# the origin. Blender is Z-up, so a point (x, y, z) is built at Blender (x, -z, y), which the glTF exporter (export_yup) turns back
# into (x, y, z). The layout is the SDF teeth's (goblin-cinematic.blob at 7587c2a0, resolved; the same table is in
# goblin-cinematic-blob.test.ts as SDF_TEETH): each tooth's ROOT `a` (inside the upper ridge or the jaw floor) and the point `b` its
# axis aims at. The tooth grows from `a` along a->b; `length` scales that run.
#
# A TOOTH is a loft: RINGS cross-sections along a bent centre line, SIDES points each, closed by a dome at the root (inside the gum)
# and a point (or a chip) at the tip. Per tooth: the root radius `r` (5.6-6 mm for the small ones, 8.2-8.4 the fangs; the SDF prims
# were 5-6.8 and the WAM cones ran them linearly to a point, so the STOUTNESS is in the profile: a NECK pinch at the gum (`neck`,
# default NECK), a crown SWELL (`swell` at `swellAt`) and a slow taper (`taper` < 1 stays fat longer, > 1 needles) to a blunt tip
# radius `tipR`, optionally ROUNDED off like a dome (`round` 0..1)); the cross-section's depth/width `flat` (incisors are blades,
# fangs ovals); a sabre `bend` (tip offset, fraction of the length, along the tooth's own depth axis: + back into the mouth, and
# `bendX` sideways); a `twist` (degrees, crooked); a `lean` (degrees about the depth axis: a crooked tooth leaning on its
# neighbour); a `chip` (a broken tip: the plane through the axis point at `t`, tilted `tilt` degrees about the width axis and
# `roll` about the depth axis; everything past it is cut, capped, the rim worn round and the face scooped); surface NOISE (`bump`,
# metres, kept SMALL: 0.2-0.25 mm) and vertical RIDGES (`ridge`); and a colour tweak (`yellow`, `dirt`).
#
# COLOUR: vertex colours (COLOR_0), warm dirty ivory like the SDF teeth (`e0d8c0` as lit), darker and yellower toward the gum
# (the stain), grime in the noise's hollows and on the side faces between neighbours, a slightly cleaner fresh face on a chip.
# Each tooth has its own seed (SEED, its index) for the noise, so the build is deterministic: same script, same glb bytes. No clean white anywhere. The kit material's
# base colour is white, so the vertex colour IS the albedo (three's GLTFLoader turns `vertexColors` on for a COLOR_0 primitive).
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, noise

ARGS = globals().get('ARGS') or (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
HERE = os.path.dirname(os.path.abspath(globals().get('__file__') or globals().get('SCRIPT_PATH') or '.'))
OUT = ARGS[ARGS.index('--out') + 1] if '--out' in ARGS else os.path.join(HERE, 'goblin-teeth.glb')
SEED = 17
COLL = 'GoblinTeeth'
RINGS = 12          # cross-sections from the root dome to the tip
SIDES = 12          # points per cross-section
NECK = 0.28         # how much a tooth pinches in at the gum (0 = a plain cone)

# ---- the teeth: the SDF layout (a, b) plus each tooth's character -----------------------------------------------------------
# Upper row, x from the goblin's right (-x) to its left: u0 small, u1 FANG, u2, u3, u4, u5 FANG, u6 small. Lower row l0..l3.
# The fangs are the 2nd and the 6th upper and must reach lowest (the tests pin it).
TEETH = [
    # A stubby, crooked peg leaning out.
    dict(name='tooth_u0', a=(-0.031, 1.1370, 0.0950), b=(-0.031, 1.1240, 0.0980), length=1.35, r=0.0056, flat=0.66,
         swell=0.14, swellAt=0.45, taper=0.75, tipR=0.50, bend=0.05, bendX=-0.10, twist=-14, lean=-12,
         round=0.8, chip=None, bump=0.00020, ridge=0.00012, yellow=0.10, dirt=0.40),
    # The right fang: a long, swollen sabre that curves back, a little worn at the point.
    dict(name='tooth_u1', a=(-0.021, 1.1380, 0.0990), b=(-0.021, 1.1110, 0.1040), length=1.15, r=0.0084, flat=0.80,
         swell=0.22, swellAt=0.32, taper=1.15, tipR=0.07, bend=0.18, bendX=-0.14, twist=8, lean=4,
         chip=None, bump=0.00025, ridge=0.00018, yellow=0.08, dirt=0.40),
    # A broad, twisted blade: crooked in its socket, a flat chisel end.
    dict(name='tooth_u2', a=(-0.011, 1.1380, 0.1020), b=(-0.011, 1.1210, 0.1060), length=1.3, r=0.0060, flat=0.55,
         swell=0.10, swellAt=0.45, taper=0.8, tipR=0.45, bend=0.04, bendX=0.0, twist=40, lean=10,
         round=0.6, chip=dict(t=0.86, tilt=12, roll=-15), bump=0.00022, ridge=0.00010, yellow=0.0, dirt=0.30),
    # The middle one is BROKEN: a diagonal snap across its lower third.
    dict(name='tooth_u3', a=(-0.001, 1.1380, 0.1030), b=(-0.001, 1.1230, 0.1070), length=1.4, r=0.0058, flat=0.60,
         swell=0.10, swellAt=0.42, taper=0.8, tipR=0.25, bend=0.03, bendX=0.0, twist=-6, lean=-3,
         chip=dict(t=0.62, tilt=32, roll=-40), bump=0.00022, ridge=0.00010, yellow=0.06, dirt=0.45),
    # Slim, pointed, and leaning hard on the fang beside it.
    dict(name='tooth_u4', a=(0.010, 1.1380, 0.1020), b=(0.010, 1.1190, 0.1060), length=1.05, r=0.0058, flat=0.70,
         swell=0.12, swellAt=0.40, taper=1.1, tipR=0.14, bend=0.06, bendX=0.14, twist=-18, lean=16,
         chip=None, bump=0.00020, ridge=0.00012, yellow=0.14, dirt=0.30),
    # The left fang: a little shorter and straighter than the right, its point snapped off.
    dict(name='tooth_u5', a=(0.021, 1.1380, 0.0990), b=(0.021, 1.1130, 0.1040), length=1.12, r=0.0082, flat=0.84,
         swell=0.18, swellAt=0.32, taper=1.0, tipR=0.10, bend=0.12, bendX=0.08, twist=-10, lean=-5,
         chip=dict(t=0.88, tilt=-42, roll=25), bump=0.00025, ridge=0.00016, yellow=0.04, dirt=0.40),
    # A worn, bulbous stub.
    dict(name='tooth_u6', a=(0.031, 1.1370, 0.0950), b=(0.031, 1.1250, 0.0980), length=1.2, r=0.0058, flat=0.78,
         swell=0.20, swellAt=0.5, taper=0.7, tipR=0.55, bend=0.02, bendX=-0.04, twist=12, lean=16,
         round=0.9, chip=None, bump=0.00025, ridge=0.00008, yellow=0.18, dirt=0.55),
    # Lower row: tusky pegs standing up off the floor; the outer two lean out like small tusks.
    dict(name='tooth_l0', a=(-0.026, 1.1210, 0.0851), b=(-0.026, 1.1380, 0.0901), length=1.35, r=0.0066, flat=0.78,
         swell=0.15, swellAt=0.22, taper=1.0, tipR=0.14, bend=0.10, bendX=-0.30, twist=10, lean=12,
         chip=None, bump=0.00022, ridge=0.00012, yellow=0.12, dirt=0.40),
    dict(name='tooth_l1', a=(-0.009, 1.1220, 0.0901), b=(-0.009, 1.1410, 0.0951), length=1.2, r=0.0074, flat=0.66,
         swell=0.12, swellAt=0.2, taper=0.7, tipR=0.30, bend=0.05, bendX=0.04, twist=-20, lean=-6,
         round=0.5, chip=dict(t=0.84, tilt=20, roll=30), bump=0.00025, ridge=0.00014, yellow=0.06, dirt=0.40),
    dict(name='tooth_l2', a=(0.011, 1.1220, 0.0901), b=(0.011, 1.1390, 0.0951), length=1.1, r=0.0068, flat=0.62,
         swell=0.12, swellAt=0.25, taper=0.65, tipR=0.40, bend=0.04, bendX=0.0, twist=24, lean=8,
         round=0.8, chip=None, bump=0.00022, ridge=0.00010, yellow=0.14, dirt=0.45),
    dict(name='tooth_l3', a=(0.027, 1.1210, 0.0851), b=(0.027, 1.1390, 0.0901), length=1.3, r=0.0064, flat=0.80,
         swell=0.15, swellAt=0.22, taper=1.0, tipR=0.14, bend=0.10, bendX=0.28, twist=-8, lean=-12,
         chip=None, bump=0.00022, ridge=0.00012, yellow=0.08, dirt=0.35),
]

# Colours, sRGB 0..1 (stored as byte colour, which Blender treats as sRGB; the exporter writes COLOR_0 linear). Warm dirty ivory at
# the crown, a yellow-brown stain toward the gum. Lit by the lab (kit-overlay.ts LOOK `tooth`) the crown renders about (180,157,111)
# of 255 on the grin close-up: beige, not white (the WAM teeth' #e8e2d2 rendered a near-neutral (177,172,160)).
IVORY = (0.86, 0.77, 0.58)
STAIN = (0.42, 0.31, 0.16)
GRIME = (0.26, 0.19, 0.10)
FRESH = (0.80, 0.73, 0.58)


def W(p):
    """Kit frame (x, y up, z fwd) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def build_tooth(spec, k):
    rnd = random.Random(SEED * 101 + k)
    a, b = W(spec['a']), W(spec['b'])
    run = (b - a)
    L = (run.length + 0.001) * spec['length']        # the SDF prim's length plus its 1 mm rounded end
    d = run.normalized()
    # Width axis: kit +x (Blender +x) made perpendicular to the axis; depth axis = toward the mouth's back. In Blender the goblin
    # faces -y, so "back into the mouth" is +y in Blender; w = d x u points there for an upper tooth (d down) and the other way for
    # a lower one, so fix its sign by hand.
    u = (Vector((1, 0, 0)) - d * d.x).normalized()
    w = d.cross(u).normalized()
    if w.y < 0: w = -w                                # +w = back (into the mouth) for every tooth
    # Lean: turn the whole tooth about the depth axis (a crooked tooth leaning sideways), pivoting at the root.
    rot = Matrix.Rotation(math.radians(spec['lean']), 3, w)
    d, u = (rot @ d).normalized(), (rot @ u).normalized()

    noff = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    r0, flat = spec['r'], spec['flat']

    def centre(t):
        f = max(t, 0.0) ** 2                          # the sabre: the curve grows toward the tip
        return a + d * (t * L) + w * (spec['bend'] * L * f) + u * (spec['bendX'] * L * f)

    def radius(t):
        if t < 0:                                     # into the gum: narrow back toward the dome
            return r0 * (1 - spec.get('neck', NECK)) * (0.86 + 0.14 * (1 + t / 0.12))
        taper = spec['tipR'] + (1 - spec['tipR']) * (1 - t) ** spec['taper']
        bulge = 1 + spec['swell'] * math.exp(-((t - spec['swellAt']) / 0.2) ** 2)
        # the NECK: a tooth pinches in where it leaves the gum and swells into its crown, so neighbours part at the gum line
        # and each crown reads as its own rounded shape instead of one saw-blade band of triangles
        neck = 1 - spec.get('neck', NECK) * math.exp(-(t / 0.22) ** 2)
        # a ROUNDED end (`round` 0..1): the last quarter closes like a dome instead of running out to a cone's point
        u = min(1.0, max(0.0, (t - 0.72) / 0.28))
        dome = 1 - spec.get('round', 0.0) * (1 - math.sqrt(max(0.0, 1 - u * u)))
        return r0 * taper * bulge * neck * dome

    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col')
    # one ring inside the gum, the rest to just short of the tip, closer together toward the tip (where the shape turns)
    ts = [-0.12] + [(1 - (1 - i / (RINGS - 2)) ** 1.4) * 0.97 for i in range(RINGS - 1)]
    rings, tparam, sidep = [], {}, {}
    for t in ts:
        c = centre(t)
        # local frame along the bend: the tangent by finite difference
        tan = (centre(t + 0.01) - centre(t - 0.01)).normalized()
        uu = (u - tan * tan.dot(u)).normalized()
        ww = tan.cross(uu).normalized()
        if ww.dot(w) < 0: ww = -ww
        tw = math.radians(spec['twist']) * max(t, 0)
        ring = []
        for s in range(SIDES):
            th = 2 * math.pi * s / SIDES + tw
            # a flattened, slightly pear-shaped section: fuller at the front (the labial face) than the back
            front = 1.0 + 0.10 * max(0.0, -math.sin(th))
            off = uu * (radius(t) * math.cos(th)) + ww * (radius(t) * flat * math.sin(th) * front)
            p = c + off
            # vertical ridges and fine bumps, along the surface normal, SMALL
            n = off.normalized()
            disp = spec['ridge'] * math.cos(3 * th + 0.7 * k) * smooth(0.0, 0.3, t) * (1 - smooth(0.7, 1.0, t))
            disp += spec['bump'] * noise.noise(p * 900 + noff)
            v = bm.verts.new(p + n * disp)
            tparam[v] = t
            sidep[v] = abs(math.cos(th - tw))
            ring.append(v)
        rings.append(ring)
    # root dome (in the gum) and the tip point
    root = bm.verts.new(centre(-0.17)); tparam[root] = -0.17
    tipv = bm.verts.new(centre(1.0) + (centre(1.0) - centre(0.97)).normalized() * spec['tipR'] * r0 * 0.6 * (1 - 0.6 * spec.get('round', 0.0)))
    tparam[tipv] = 1.0
    for i in range(len(rings) - 1):
        r1, r2 = rings[i], rings[i + 1]
        for s in range(SIDES):
            bm.faces.new((r1[s], r1[(s + 1) % SIDES], r2[(s + 1) % SIDES], r2[s]))
    for s in range(SIDES):
        bm.faces.new((rings[0][(s + 1) % SIDES], rings[0][s], root))
        bm.faces.new((rings[-1][s], rings[-1][(s + 1) % SIDES], tipv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    chip_faces = set()
    if spec['chip']:
        ch = spec['chip']
        c = centre(ch['t'])
        tan = (centre(ch['t'] + 0.01) - centre(ch['t'] - 0.01)).normalized()
        nrm = Matrix.Rotation(math.radians(ch['tilt']), 3, u) @ tan
        nrm = (Matrix.Rotation(math.radians(ch['roll']), 3, w) @ nrm).normalized()
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=c, plane_no=nrm, clear_outer=True)
        cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        filled = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
        new_faces = filled['faces']
        for e in cut_edges:
            for v in e.verts:
                if v not in tparam: tparam[v] = ch['t']
        # A break is not a saw cut, and a sharp rim reads as a glass shard: round the rim with a small smooth inset (worn), then
        # sink the middle a fraction of a millimetre (a shallow conchoidal scoop) with a little jitter.
        rr = radius(ch['t'])
        ins = bmesh.ops.inset_region(bm, faces=new_faces, thickness=rr * 0.28, depth=-rr * 0.10, use_even_offset=True)
        inner = [f for f in new_faces if f.is_valid]
        for v in {v for f in ins['faces'] for v in f.verts}:
            tparam.setdefault(v, ch['t'])
        for v in {v for f in inner for v in f.verts}:
            tparam[v] = ch['t']
        poked = bmesh.ops.poke(bm, faces=inner)
        for v in poked['verts']:
            v.co += nrm * -rr * rnd.uniform(0.10, 0.18)
            tparam[v] = ch['t']
        for f in poked['faces']: chip_faces.add(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # colour: stain at the gum, ivory at the crown, grime in the hollows, a cleaner fresh break
    for f in bm.faces:
        f.smooth = f not in chip_faces
        for loop in f.loops:
            v = loop.vert
            t = tparam.get(v, 0.5)
            # the stain climbs most of the way down the crown (only the lower half ever shows past the lips)
            base = lerp3(STAIN, IVORY, smooth(0.0, 0.70, t))
            base = lerp3(base, (base[0], base[1] * 0.97, base[2] * 0.82), spec['yellow'] * 4)
            g = 0.5 + 0.5 * noise.noise(v.co * 420 + noff * 2)
            grime = spec['dirt'] * smooth(0.45, 0.95, g) * 0.5
            # grime between the teeth (the side faces), so neighbours read apart even where they touch
            grime += spec['dirt'] * 0.7 * smooth(0.55, 1.0, sidep.get(v, 0.0)) * (1 - smooth(0.75, 1.0, t))
            cc = lerp3(base, GRIME, grime)
            if f in chip_faces: cc = lerp3(cc, FRESH, 0.6)
            loop[col] = (*[min(1.0, max(0.0, x)) for x in cc], 1.0)

    me = bpy.data.meshes.new(spec['name'])
    bm.to_mesh(me)
    bm.free()
    return me


def tooth_material():
    m = bpy.data.materials.get('tooth') or bpy.data.materials.new('tooth')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.38
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def build():
    coll = bpy.data.collections.get(COLL)
    if coll is None:
        coll = bpy.data.collections.new(COLL)
        bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        if o.name.startswith('tooth_'):
            me = o.data
            bpy.data.objects.remove(o)
            if me and me.users == 0: bpy.data.meshes.remove(me)
    mat = tooth_material()
    objs = []
    for k, spec in enumerate(TEETH):
        me = build_tooth(spec, k)
        me.materials.append(mat)
        ob = bpy.data.objects.new(spec['name'], me)
        coll.objects.link(ob)
        objs.append(ob)
    return objs


def export(objs, path=OUT):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_texcoords=False, export_vertex_color='ACTIVE',
                              export_materials='EXPORT', export_extras=False, export_animations=False, export_skins=False)
    return path


if __name__ == '__main__':
    objs = build()
    if '--export' in ARGS:
        print('wrote', export(objs))
