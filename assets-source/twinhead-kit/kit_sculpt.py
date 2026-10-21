# Shared helpers for the twinhead kit's sculpted (demon-skull style) parts. exec() this first, then a make_*.py.
# Everything takes BLENDER coords; blob (x, y, z) -> blender (x, -z, y) via `bv`.
# Pattern: build closed pieces (shells, tubes, balls) into a work collection, then `fuse` voxel-remeshes them into
# one organic part, smooths, adds clouds noise, decimates, and bakes AO into vertex colours (`bake_ao`).
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

D = math.radians
WORK = 'sculptwork'


def bv(x, y, z):
    return Vector((x, -z, y))


def work_coll():
    w = bpy.data.collections.get(WORK) or bpy.data.collections.new(WORK)
    if w.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(w)
    return w


def clear_work():
    for o in list(work_coll().objects):
        bpy.data.objects.remove(o, do_unlink=True)


def mkobj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); work_coll().objects.link(o); return o


def surface_solid(name, P, N, nu, nv, thick, closed_v=False):
    """Closed solid from a surface patch P(u, v) (u, v in 0..1) pushed `thick` along -N(u, v)."""
    bm = bmesh.new()
    nvv = nv if closed_v else nv + 1
    O = [[bm.verts.new(P(i / nu, j / nv)) for j in range(nvv)] for i in range(nu + 1)]
    I = [[bm.verts.new(P(i / nu, j / nv) - N(i / nu, j / nv) * thick) for j in range(nvv)] for i in range(nu + 1)]
    J = (lambda j: j % nv) if closed_v else (lambda j: j)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((O[i][J(j)], O[i + 1][J(j)], O[i + 1][J(j + 1)], O[i][J(j + 1)]))
            bm.faces.new((I[i][J(j + 1)], I[i + 1][J(j + 1)], I[i + 1][J(j)], I[i][J(j)]))
    for j in range(nv):
        bm.faces.new((O[0][J(j + 1)], I[0][J(j + 1)], I[0][J(j)], O[0][J(j)]))
        bm.faces.new((O[nu][J(j)], I[nu][J(j)], I[nu][J(j + 1)], O[nu][J(j + 1)]))
    if not closed_v:
        for i in range(nu):
            bm.faces.new((O[i][0], I[i][0], I[i + 1][0], O[i + 1][0]))
            bm.faces.new((O[i + 1][nv], I[i + 1][nv], I[i][nv], O[i][nv]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def tube(name, pts, rad, segs=12, caps=True):
    bm = bmesh.new(); n = len(pts)
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized(); rings = []
    for i in range(n):
        if i > 0: nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        bi = tans[i].cross(nrm); r = max(rad[i], 0.0004)
        rings.append([bm.verts.new(pts[i] + (nrm * math.cos(2 * math.pi * k / segs) + bi * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
    for i in range(n - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    a = bm.verts.new(pts[0] - tans[0] * rad[0] * 0.5); b = bm.verts.new(pts[-1] + tans[-1] * rad[-1] * 0.5)
    for k in range(segs):
        bm.faces.new((rings[0][(k + 1) % segs], rings[0][k], a)); bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segs], b))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def ring(name, c, axis, r, minor, segs=48):
    """A closed torus-like ring of radius r round `axis` through c."""
    axis = axis.normalized()
    ref = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
    e1 = (ref - axis * ref.dot(axis)).normalized(); e2 = axis.cross(e1)
    pts = [c + (e1 * math.cos(2 * math.pi * k / segs) + e2 * math.sin(2 * math.pi * k / segs)) * r for k in range(segs + 2)]
    return tube(name, pts, [minor] * len(pts), segs=10)


def ball(name, p, r, sx=1.0, sy=1.0, sz=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r, matrix=Matrix.Translation(p) @ Matrix.Diagonal((sx, sy, sz, 1.0)))
    return mkobj(name, bm)


def horn(name, base, d0, curl_axis, L, r0, curl=1.2, n=28):
    """A tapered horn from `base`, leaving along d0 and curling round curl_axis (the skull's horns)."""
    pts = []; rad = []; p = base.copy(); d = d0.normalized()
    for i in range(n + 1):
        u = i / n
        pts.append(p.copy()); rad.append(r0 * (1 - u) ** 1.15)
        d = (Matrix.Rotation(curl / n, 3, curl_axis) @ d).normalized()
        p = p + d * (L / n)
    return tube(name, pts, rad, segs=12)


class BoneFrame:
    """Frame along a bone: u along it (head -> tail), f toward the front (blender -y), s = u x f (outward on .l)."""
    def __init__(self, head, tail, fwd=Vector((0, -1, 0))):
        self.h = head; self.L = (tail - head).length; self.u = (tail - head).normalized()
        self.f = (fwd - self.u * fwd.dot(self.u)).normalized(); self.s = self.u.cross(self.f)

    def at(self, t, ph, rf, rs, off=Vector()):
        # ph=0 front, ph=+90 deg toward s
        return self.h + self.u * (self.L * t) + self.f * (rf * math.cos(ph)) + self.s * (rs * math.sin(ph)) + off


def bone_shell(name, F, t0, t1, ph0, ph1, rf, rs, thick, nu=40, nv=48, bulge=None):
    """Carapace wrapped round a bone: radii rf(t), rs(t) (front/side) over angles ph0..ph1; the edges t0(ph), t1(ph)
    (numbers or callables of ph) shape its top and bottom outline, so it can come to points and round its corners."""
    T0 = t0 if callable(t0) else (lambda ph: t0)
    T1 = t1 if callable(t1) else (lambda ph: t1)

    def P(u, v):
        ph = ph0 + (ph1 - ph0) * v
        t = T0(ph) + (T1(ph) - T0(ph)) * u
        b = bulge(t, ph) if bulge else 0.0
        return F.at(t, ph, rf(t) + b, rs(t) + b)

    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, min(1, v + e)) - P(u, max(0, v - e))
        n = du.cross(dv).normalized()
        p = P(u, v); axisp = F.h + F.u * F.u.dot(p - F.h)
        return n if n.dot(p - axisp) > 0 else -n
    return surface_solid(name, P, N, nu, nv, thick), P, N


def fuse(name, voxel=0.0022, smooth=(0.6, 4), noise=0.0025, noise_scale=0.035, tris=8000):
    w = work_coll(); objs = list(w.objects)
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.hide_set(False); o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name
    o.data.remesh_voxel_size = voxel; o.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    tex = bpy.data.textures.get('sculptnoise') or bpy.data.textures.new('sculptnoise', 'CLOUDS')
    tex.noise_scale = noise_scale; tex.noise_depth = 3
    m = o.modifiers.new('sm', 'SMOOTH'); m.factor, m.iterations = smooth
    if noise > 0:
        d = o.modifiers.new('dn', 'DISPLACE'); d.texture = tex; d.strength = noise; d.texture_coords = 'GLOBAL'
        m2 = o.modifiers.new('sm2', 'SMOOTH'); m2.factor = 0.5; m2.iterations = 2
    for mod in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def press_lines(o, polylines, width=0.0035, depth=0.0025, keep=lambda p: True):
    """Sutures: push vertices in along polylines (an EXACT boolean collapses voxel meshes)."""
    seg = []
    for pts in polylines:
        for i in range(len(pts) - 1):
            for q in range(6): seg.append(pts[i].lerp(pts[i + 1], q / 6))
    if not seg: return
    kd = KDTree(len(seg))
    for i, p in enumerate(seg): kd.insert(p, i)
    kd.balance()
    me = o.data
    for v in me.vertices:
        co, _, dist = kd.find(v.co)
        if dist < width and keep(v.co):
            v.co = v.co - v.normal * depth * (1 - dist / width) ** 2
    me.update()


def zigzag(path, amp, nzig, side):
    """Zigzag polyline along path(s) s in 0..1, wiggling along side(s)."""
    pts = []
    for i in range(nzig * 4 + 1):
        s = i / (nzig * 4)
        pts.append(path(s) + side(s) * amp * (1 if (i // 2) % 2 else -1) * (1 if i % 2 else 0.4))
    return pts


def decimate(o, tris):
    bpy.context.view_layer.objects.active = o
    for target in (tris * 2.5, tris):
        if len(o.data.polygons) <= target: continue
        dc = o.modifiers.new('dc', 'DECIMATE'); dc.ratio = target / len(o.data.polygons)
        bpy.ops.object.modifier_apply(modifier='dc')
    for p in o.data.polygons: p.use_smooth = True


def bake_ao(o, material='skullmetal', gain=1.0, gamma=1.3, tint=(1.0, 0.985, 0.96), ao_dist=0.05):
    me = o.data
    me.materials.clear(); me.materials.append(bpy.data.materials[material])
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    sc = bpy.context.scene; prev = sc.render.engine
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.device = 'CPU'
    # local crevice occlusion only: at the default distance neighbouring parts (girdle over thigh) black a part out
    sc.world.light_settings.distance = ao_dist
    for x in bpy.context.selected_objects: x.select_set(False)
    o.hide_set(False); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    sc.render.engine = prev
    ao = [v.color[0] for v in ca.data]
    nbr = [[] for _ in ao]
    for e in me.edges:
        a_, b_ = e.vertices; nbr[a_].append(b_); nbr[b_].append(a_)
    for _ in range(3):
        ao = [(ao[i] * 2 + sum(ao[j] for j in nbr[i])) / (2 + len(nbr[i])) for i in range(len(ao))]
    for v, a_ in zip(ca.data, ao):
        c = gain * a_ ** gamma
        v.color = (c * tint[0], c * tint[1], c * tint[2], 1.0)


def plain(o, material):
    o.data.materials.clear(); o.data.materials.append(bpy.data.materials[material])
    for p in o.data.polygons: p.use_smooth = True


def install(o, kitname):
    """Move a finished part into `mech` as `kitname`, replacing any part of that name."""
    old = bpy.data.objects.get(kitname)
    if old and old != o: bpy.data.objects.remove(old, do_unlink=True)
    o.name = kitname; o.data.name = kitname
    for col in list(o.users_collection): col.objects.unlink(o)
    bpy.data.collections['mech'].objects.link(o)
    return o


def mirror_to_r(o, kitname):
    """Copy a .l part to its .r twin (x -> -x)."""
    c = o.copy(); c.data = o.data.copy()
    bm = bmesh.new(); bm.from_mesh(c.data)
    bmesh.ops.scale(bm, vec=Vector((-1, 1, 1)), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(c.data); bm.free()
    work_coll().objects.link(c)
    return install(c, kitname)
