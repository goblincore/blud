# scripts/levels/flat/common.py
"""Blender helpers for the Flat's builders. Ported from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py 49-212.

Everything is created in the `dressing` collection (the exporter's art). One material per object (the exporter's rule).
Run inside Blender.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector  # noqa: F401  (re-exported for the builders)


def collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def dressing():
    return collection("dressing")


def use_dressing():
    """Make `dressing` the active collection so bpy.ops.mesh.primitive_* create objects in it."""
    target = dressing()

    def find(lc):
        if lc.collection is target:
            return lc
        for ch in lc.children:
            r = find(ch)
            if r:
                return r
        return None

    bpy.context.view_layer.active_layer_collection = find(bpy.context.view_layer.layer_collection)
    return target


def world_box_uv(obj, size=1.0):
    """Box-projected UVs from world positions: one tile = `size` metres (a number or an (x, y, z) tuple)."""
    bpy.context.view_layer.update()
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    sx, sy, sz = (size, size, size) if isinstance(size, (int, float)) else size
    mw = obj.matrix_world
    rot = mw.to_3x3()
    for poly in me.polygons:
        n = rot @ poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = {0: (p.y / sy, p.z / sz), 1: (p.x / sx, p.z / sz), 2: (p.x / sx, p.y / sy)}[ax]


def planar_uv(bm, axis, u0, w_m, h_m):
    """UVs for a wall built in world coordinates: u along the wall ('x' or 'y'), v up; the wall's texture covers w_m x h_m from u0 at z 0."""
    uvl = bm.loops.layers.uv.verify()
    k = 0 if axis == "x" else 1
    for f in bm.faces:
        for l in f.loops:
            p = l.vert.co
            l[uvl].uv = ((p[k] - u0) / w_m, p[2] / h_m)


def rand_uv(bm, layer, n):
    """Each face's UVs collapse to the middle of stripe int(rand * n) of an n-stripe palette (books.png)."""
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        u = (min(n - 1, int(f[layer] * n)) + 0.5) / n
        for l in f.loops:
            l[uvl].uv = (u, 0.5)


def obj_from_bm(name, bm, material, smooth=False, bevel=0.0, segs=2, uv_size=1.0):
    me = bpy.data.meshes.new(name)
    has_uv = bool(bm.loops.layers.uv)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    dressing().objects.link(o)
    me.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if not has_uv and uv_size:
        world_box_uv(o, uv_size)
    if bevel:
        b = o.modifiers.new("bev", "BEVEL")
        b.width = bevel
        b.segments = segs
        b.limit_method = "ANGLE"
    return o


def bm_cube(bm, c, s, rot=None, layer=None, val=0.0):
    M = Matrix.Translation(Vector(c)) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4)) @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    for f in {f for v in r["verts"] for f in v.link_faces}:
        if layer is not None:
            f[layer] = val
    return r["verts"]


def _finish(o, material, uv_size):
    o.data.materials.append(material)
    if uv_size:
        world_box_uv(o, uv_size)
    return o


def box(name, c, s, material, bevel=0.0, rot=(0, 0, 0), uv_size=1.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new("bev", "BEVEL")
        b.width = bevel
        b.segments = 3
        b.limit_method = "ANGLE"
    return _finish(o, material, uv_size)


def cyl(name, c, r, d, material, rot=(0, 0, 0), verts=24, r2=None, smooth=True, uv_size=1.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=c, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=c, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    if smooth:
        bpy.ops.object.shade_smooth()
    return _finish(o, material, uv_size)


def sphere(name, c, r, material, scale=(1, 1, 1), seg=24, rot=(0, 0, 0), uv_size=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=c, segments=seg, ring_count=max(3, seg // 2), rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.shade_smooth()
    return _finish(o, material, uv_size)


def torus(name, c, R, r, material, rot=(0, 0, 0), scale=(1, 1, 1), uv_size=1.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=c, rotation=rot, major_segments=32, minor_segments=12)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.shade_smooth()
    return _finish(o, material, uv_size)


def to_mesh(ob):
    """Convert a curve or metaball object (already linked into a collection) to a mesh object; returns the mesh object."""
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def tube(name, pts, radii, material, res=4, cyclic=False, res_u=12):
    """A beveled curve, converted to a mesh (the exporter only takes meshes). res: the cross-section's bevel resolution; res_u: curve points per segment."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = res
    cu.resolution_u = res_u
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    sp.use_endpoint_u = not cyclic
    sp.use_cyclic_u = cyclic
    sp.order_u = min(4, len(pts))
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        sp.points[i].radius = r
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(material)
    dressing().objects.link(ob)
    return to_mesh(ob)


def catmull(pts, n_per=12):
    """Sample a Catmull-Rom spline through pts: returns [(pos, tangent)]."""
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n_per):
            t = k / n_per
            pos = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
            tan = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t)
            out.append((pos, tan.normalized()))
    out.append((P[-2], (P[-2] - P[-3]).normalized()))
    return out


def resample(samples, step):
    """Even arc-length spacing along sampled spline points."""
    res = [samples[0]]
    acc = 0.0
    for (a, ta), (b, tb) in zip(samples, samples[1:]):
        seg = (b - a).length
        acc += seg
        while acc >= step:
            acc -= step
            t = 1 - acc / seg if seg > 0 else 1
            res.append((a.lerp(b, t), ta.lerp(tb, t).normalized()))
    return res


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
