# TORN MEAT CHUNKS: the ragged gibs a gun crater throws (game-meat-gib.ts; owner 2026-10-24: the SDF flesh bits
# "tend to form round globules rather than the more ragged chunks I'm looking for"). An SDF bit is a blend of rounded
# prims and can only ever be a globule; a torn chunk is mesh, like every other ragged or detailed part of the house
# style (.claude/skills/authoring-sdf-characters/biomech-style.md).
#
# Run inside Blender (a fresh file is fine):
#   exec(open('<repo>/assets-source/meat-chunks/make_meat_chunks.py').read())
# It builds N chunks into the `meat` collection, named Meat0..N-1, ~1 unit across (the game scales them), with
# vertex colours, then exports public/assets/lab/meat-chunks.glb.
#
# THE SHAPE of a torn chunk, and how each is made:
#   * a slab, not a ball: torn flesh is flatter than it is wide (a lump squashed to ~0.45 of its width);
#   * a RAGGED outline: the slab's rim is chewed by a strong low-frequency noise, so it comes to points and bites;
#   * a SKIN side (the top: smoother, the hide's pink-brown, a flap that overhangs) and a RAW side (the bottom and
#     the torn rim: deep red, stringy, with muscle-fibre grooves raking across it and yellow fat beads);
#   * a few have a tendon or a strand of fibre trailing off them.
# Colours are LINEAR (biomech-style.md): raw meat ~(0.25, 0.02, 0.02), hide ~(0.45, 0.22, 0.18), fat ~(0.6, 0.45, 0.15).
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise

R = random.Random(11)
N = 8
OUT = bpy.path.abspath('//') if bpy.data.filepath else None


def coll(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def clear(c):
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def _ellipsoid(bm, c, r, sc):
    m = Matrix.Translation(c) @ Matrix.Diagonal((r * sc[0], r * sc[1], r * sc[2], 1.0))
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0, matrix=m)


def _strand(bm, start, dirv, L, r0, rr):
    """A limp fibre strand: a thin wobbling tube that sags as it trails off."""
    rings = []
    side = dirv.cross(Vector((0, 0, 1))).normalized() if abs(dirv.z) < 0.9 else Vector((1, 0, 0))
    up = side.cross(dirv).normalized()
    ph = rr.uniform(0, 6.28)
    for k in range(13):
        t = k / 12
        c = start + dirv * L * t + Vector((0, 0, -0.25 * L * t * t)) + side * 0.03 * math.sin(ph + t * 9) * t
        rad = r0 * (1 - 0.75 * t) * (0.85 + 0.3 * rr.random())
        rings.append([bm.verts.new(c + (side * math.cos(a) + up * math.sin(a)) * rad) for a in [j * math.pi / 3 for j in range(6)]])
    for k in range(12):
        for j in range(6):
            bm.faces.new((rings[k][j], rings[k][(j + 1) % 6], rings[k + 1][(j + 1) % 6], rings[k + 1][j]))


def chunk(i, seed):
    rr = random.Random(seed)
    off = Vector((rr.uniform(-50, 50), rr.uniform(-50, 50), rr.uniform(-50, 50)))
    # 1. LOBES: an irregular cluster, not one ellipsoid, flattened into a slab and stretched along x
    bm = bmesh.new()
    for k in range(rr.randint(3, 6)):
        c = Vector((rr.uniform(-0.32, 0.32), rr.uniform(-0.2, 0.2), rr.uniform(-0.06, 0.06)))
        _ellipsoid(bm, c, rr.uniform(0.16, 0.3), (rr.uniform(1.0, 1.5), rr.uniform(0.7, 1.1), rr.uniform(0.45, 0.65)))
    me = bpy.data.meshes.new(f'Meat{i}'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(f'Meat{i}', me); coll('meat').objects.link(o)
    for x in bpy.context.scene.objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    o.data.remesh_voxel_size = 0.022; bpy.ops.object.voxel_remesh()
    # 2. TEAR: one or two plane cuts leave flat torn faces (filled), the rest is the chunk's outside
    bm = bmesh.new(); bm.from_mesh(o.data)
    cuts = []
    # 2-3 tears, close to the middle: the torn faces must make up much of the chunk, or the rounded lobes win (the
    # first pass, 1-2 shallow cuts, still read as lumpy pillows with frayed ends)
    for k in range(rr.randint(2, 3)):
        n = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-0.5, 0.5))).normalized()
        d = rr.uniform(0.0, 0.12)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=n * d, plane_no=n, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            try: bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            except Exception: pass
        cuts.append((n, d))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free()
    o.data.remesh_voxel_size = 0.018; bpy.ops.object.voxel_remesh()
    # 3. ROUGHEN: hard-edged turbulence everywhere (bites and knuckles in the outline), and on the torn faces fibre
    #    striations raking along one direction (muscle grain), pulled outward into ragged strings
    grain = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), 0)).normalized()
    for v in o.data.vertices:
        p = v.co.copy(); nrm = v.normal.copy()
        torn = max((1.0 - min(1.0, abs(p.dot(n) - d) / 0.05)) for n, d in cuts) if cuts else 0.0
        turb = noise.turbulence(p * 2.6 + off, 3, True)
        turb2 = noise.turbulence(p * 7.0 + off * 1.3, 2, True)
        p += nrm * (0.15 * turb - 0.075 + 0.04 * turb2 - 0.02)
        if torn > 0:
            along = p.dot(grain)
            fib = math.sin(along * 70 + noise.noise(p * 8 + off) * 4)
            p += nrm * (0.03 * torn * max(0.0, fib)) + nrm * 0.04 * torn * noise.turbulence(p * 9 + off, 2, True)
        v.co = p
    o.data.update()
    # 4. STRANDS: limp fibres trailing off a torn face
    if cuts and rr.random() < 0.75:
        n, d = cuts[0]
        bm = bmesh.new(); bm.from_mesh(o.data)
        for k in range(rr.randint(1, 3)):
            start = n * (d - 0.01) + Vector((rr.uniform(-0.12, 0.12), rr.uniform(-0.12, 0.12), rr.uniform(-0.05, 0.05)))
            dirv = (n + Vector((rr.uniform(-0.4, 0.4), rr.uniform(-0.4, 0.4), rr.uniform(-0.3, 0.1)))).normalized()
            _strand(bm, start, dirv, rr.uniform(0.18, 0.4), rr.uniform(0.012, 0.022), rr)
        bm.to_mesh(o.data); bm.free()
    # 5. budget and shading
    dc = o.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, 900 / max(1, len(o.data.polygons)))
    bpy.ops.object.modifier_apply(modifier='dc')
    for pl in o.data.polygons: pl.use_smooth = True
    # 6. colours: hide on the outside's top, raw wet meat on the torn faces and underneath, fat beads, dark grain
    me = o.data
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    for v, c in zip(me.vertices, ca.data):
        p = v.co
        torn = max((1.0 - min(1.0, abs(p.dot(n) - d) / 0.06)) for n, d in cuts) if cuts else 0.0
        fat = noise.noise(p * 7 + off) > 0.38
        k = noise.noise(p * 14 + off) * 0.5 + 0.5
        if torn > 0.3 or v.normal.z < -0.2:
            col = (0.55, 0.40, 0.13) if fat and torn < 0.6 else (0.13 + 0.14 * k, 0.008 + 0.012 * k, 0.01 + 0.01 * k)
        else:
            col = (0.30 + 0.08 * k, 0.11 + 0.04 * k, 0.085 + 0.03 * k)   # the teratoma's hide, warmer pink-brown
        c.color = (*col, 1.0)
    mat = bpy.data.materials.get('meat') or bpy.data.materials.new('meat')
    me.materials.clear(); me.materials.append(mat)
    return o


c = coll('meat')
clear(c)
objs = [chunk(i, 1000 + i * 37) for i in range(N)]
for i, o in enumerate(objs):
    o.location = Vector(((i % 4) * 1.4, (i // 4) * 1.4, 0))
result = {'chunks': [(o.name, len(o.data.polygons)) for o in objs]}
