# Twinhead left pauldron: a bony shell in the demon skull's style, built in Blender.
# Run inside Blender: exec(open('<repo>/assets-source/twinhead-kit/make_pauldron.py').read())
# Parametric ellipsoid shells (cap + two cascading lames) with rolled lips, a sagittal crest, ribs, raked
# horn spines and knobs, fused by a voxel remesh, smoothed, noised, sutures pressed in, decimated.
# Leaves `pauld_raw` (game res) and hidden `pauld_hi` in the `pauldwork` collection.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

# clavicle.l end / upperarm.l head in blob rest coords (0.316, 1.769, 0.138) -> blender (x, -z, y)
C = Vector((0.316, -0.138, 1.769))
t = math.radians(32)  # tilt the shell's "up" outward
ux = Vector((math.cos(t), 0, -math.sin(t))); uy = Vector((0, 1, 0)); uz = Vector((math.sin(t), 0, math.cos(t)))
D = math.radians

work = bpy.data.collections.get('pauldwork') or bpy.data.collections.new('pauldwork')
if work.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(work)
for o in list(work.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def mkobj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); work.objects.link(o); return o


def ell(cen, a, b, c, th, ph):
    return cen + ux * (a * math.sin(th) * math.cos(ph)) + uy * (b * math.sin(th) * math.sin(ph)) + uz * (c * math.cos(th))


def ellN(a, b, c, th, ph):
    return (ux * (math.sin(th) * math.cos(ph) / a) + uy * (math.sin(th) * math.sin(ph) / b) + uz * (math.cos(th) / c)).normalized()


def shell(name, cen, a, b, c, th0, th1, ph0, ph1, thick, nt=40, nph=96):
    """Closed solid: the ellipsoid band th0(ph)..th1(ph) over ph0..ph1, `thick` deep."""
    bm = bmesh.new(); rows = []
    for layer in (0, 1):
        grid = []
        for j in range(nph + 1):
            ph = ph0 + (ph1 - ph0) * j / nph; col = []
            for i in range(nt + 1):
                th = th0(ph) + (th1(ph) - th0(ph)) * i / nt
                p = ell(cen, a, b, c, th, ph)
                if layer: p = p - ellN(a, b, c, th, ph) * thick
                col.append(bm.verts.new(p))
            grid.append(col)
        rows.append(grid)
    O, I = rows
    for j in range(nph):
        for i in range(nt):
            bm.faces.new((O[j][i], O[j + 1][i], O[j + 1][i + 1], O[j][i + 1]))
            bm.faces.new((I[j][i + 1], I[j + 1][i + 1], I[j + 1][i], I[j][i]))
    for j in range(nph):
        bm.faces.new((O[j][nt], O[j + 1][nt], I[j + 1][nt], I[j][nt]))
        bm.faces.new((I[j][0], I[j + 1][0], O[j + 1][0], O[j][0]))
    for i in range(nt):
        bm.faces.new((O[0][i + 1], I[0][i + 1], I[0][i], O[0][i]))
        bm.faces.new((O[nph][i], I[nph][i], I[nph][i + 1], O[nph][i + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def tube(name, pts, rad, segs=12):
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


def ballo(name, p, r):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r, matrix=Matrix.Translation(p))
    return mkobj(name, bm)


g = lambda x, w: math.exp(-(x / w) ** 2)
taper = lambda ph, m: max(0.0, min(1.0, (m - abs(ph)) / D(30)))
bell = lambda s, w=1.0: max(0.0, 1 - (s / w) ** 2)


# cap edge: lower on the outside, swept down to a point at the front (ph<0 is -y, the front) and the back,
# scalloped between, like the skull's cheekbone points
def th1(ph):
    return (D(58) + D(16) * math.cos(ph) + D(12) * g(ph + D(68), D(16)) + D(9) * g(ph - D(72), D(15))
            - D(5) * g(ph + D(25), D(12)) - D(5) * g(ph - D(28), D(12)))


lbase = lambda ph: D(58) + D(16) * math.cos(ph)

capC = C + uz * 0.052; A, B, Cc = 0.160, 0.175, 0.105
shell('cap', capC, A, B, Cc, lambda ph: 0.0, th1, -math.pi, math.pi, 0.014, nt=40, nph=160)
lames = []
for k in (1, 2):
    cen = C + uz * (0.052 - 0.022 * k) + ux * 0.011 * k
    a, b, c = A + 0.011 * k, B + 0.005 * k, Cc + 0.011 * k; m = D(105 - 8 * k)
    hi = lambda ph, k=k, m=m: min(D(96), lbase(ph) + D(14) + D(11) * (k - 1) - D(12) * (1 - taper(ph, m)) + D(5) * g(ph, D(30)))
    # the band closes to a sliver at its ends instead of a square end wall; its top tucks well under the edge above
    lo = lambda ph, k=k, m=m, hi=hi: hi(ph) - max(D(1.5), (D(24) + D(10) * (k == 1)) * taper(ph, m) ** 0.6)
    shell(f'lame{k}', cen, a, b, c, lo, hi, -m, m, 0.010, nt=20, nph=100)
    lames.append((cen, a, b, c, hi, m))


def lip(name, cen, a, b, c, thf, ph0, ph1, r, fade=None, n=80):
    pts = []; rad = []
    for j in range(n + 1):
        ph = ph0 + (ph1 - ph0) * j / n; th = thf(ph)
        pts.append(ell(cen, a, b, c, th, ph) - ellN(a, b, c, th, ph) * 0.0055)
        rad.append(r * (fade(ph) if fade else 1.0))
    return tube(name, pts, rad, segs=10)


lip('caplip', capC, A, B, Cc, th1, -math.pi * 0.995, math.pi * 0.995, 0.0078, n=220)
for k, (cen, a, b, c, hi, m) in enumerate(lames, 1):
    lip(f'lip{k}', cen, a, b, c, hi, -m, m, 0.0068, fade=lambda ph, m=m: 0.3 + 0.7 * taper(ph, m), n=120)


def merid(s, off, xo=0.0):
    k = math.sqrt(max(0.0, 1 - (xo / A) ** 2))
    p = capC + ux * xo + uy * (B * k * math.sin(s)) + uz * (Cc * k * math.cos(s))
    n = (ux * (xo / A ** 2) + uy * (B * k * math.sin(s) / B ** 2) + uz * (Cc * k * math.cos(s) / Cc ** 2)).normalized()
    return p + n * off, n


S = [-1.05 + 2.1 * i / 70 for i in range(71)]
tube('crestbase', [merid(s, 0.003, 0.01)[0] for s in S], [0.004 + 0.011 * bell(s, 1.05) for s in S])
tube('cresttop', [merid(s, 0.016 * bell(s, 1.1) ** 0.5, 0.01)[0] for s in S], [0.0015 + 0.006 * bell(s, 1.1) for s in S])
# ribs: bony ridges running from the crest down the outer face, raking back like cheekbones
def onsurf(x, y, off):
    q = max(1e-4, 1 - (x / A) ** 2 - (y / B) ** 2)
    z = Cc * math.sqrt(q)
    n = (ux * (x / A ** 2) + uy * (y / B ** 2) + uz * (z / Cc ** 2)).normalized()
    return capC + ux * x + uy * y + uz * z + n * off


for y0, w in ((-0.11, 0.8), (-0.045, 1.0), (0.025, 1.0), (0.095, 0.85)):
    pts = []; rad = []
    for i in range(31):
        u = i / 30; y = y0 + 0.05 * u * u
        xmax = A * math.sin(D(66)) * math.sqrt(max(0.0, 1 - (y / B) ** 2))
        pts.append(onsurf(0.02 + (xmax - 0.02) * u, y, 0.0005))
        rad.append(w * (0.002 + 0.0042 * math.sin(math.pi * min(1.0, 0.15 + u * 0.95))))
    tube(f'rib{y0}', pts, rad, segs=8)
# raked spines along the crest, curling back (+y) like the skull's horns
for s0, L, r0 in ((-0.35, 0.04, 0.009), (0.05, 0.085, 0.014), (0.45, 0.065, 0.012)):
    sb, n = merid(s0, 0.012, 0.01); pts = []; rad = []
    for i in range(29):
        u = i / 28
        pts.append(sb + n * (L * u * (1 - 0.35 * u)) + uy * (L * 0.95 * u * u) + ux * (0.012 * u * u))
        rad.append(r0 * (1 - u) ** 1.2)
    tube(f'spine{s0}', pts, rad)
for ph in (-1.35, -0.6, 0.45, 1.25):
    th = th1(ph); ballo(f'knobc{ph}', ell(capC, A, B, Cc, th, ph) + ellN(A, B, Cc, th, ph) * 0.003, 0.0080)
for k, (cen, a, b, c, hi, m) in enumerate(lames, 1):
    for ph in ((-0.95, -0.15, 0.75) if k == 1 else (-0.55, 0.4)):
        th = hi(ph); ballo(f'knob{k}{ph}', ell(cen, a, b, c, th, ph) + ellN(a, b, c, th, ph) * 0.001, 0.0072)

# fuse
for o in bpy.context.selected_objects: o.select_set(False)
objs = list(work.objects)
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
o = bpy.context.view_layer.objects.active; o.name = 'pauld_raw'
o.data.remesh_voxel_size = 0.002; o.data.remesh_voxel_adaptivity = 0.0
bpy.ops.object.voxel_remesh()
tex = bpy.data.textures.get('pauldnoise') or bpy.data.textures.new('pauldnoise', 'CLOUDS')
tex.noise_scale = 0.035; tex.noise_depth = 3
m = o.modifiers.new('sm', 'SMOOTH'); m.factor = 0.7; m.iterations = 5
d = o.modifiers.new('dn', 'DISPLACE'); d.texture = tex; d.strength = 0.003; d.texture_coords = 'GLOBAL'
m2 = o.modifiers.new('sm2', 'SMOOTH'); m2.factor = 0.5; m2.iterations = 2
for mod in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)


# cranial sutures: zigzag grooves pressed in (vertex push; an EXACT boolean collapses this mesh)
def surf(s, yoff):
    k = math.sqrt(max(0, 1 - (yoff / B) ** 2))
    return capC + uy * yoff + ux * (A * k * math.sin(s)) + uz * (Cc * k * math.cos(s))


seg = []
for (s0, s1, y0, N) in ((0.2, 1.05, -0.035, 12), (-0.6, -0.2, -0.035, 6), (0.3, 0.95, 0.11, 8)):
    pts = []
    for i in range(N * 4 + 1):
        u = i / (N * 4); s = s0 + (s1 - s0) * u
        pts.append(surf(s, y0 + 0.005 * (1 if (i // 2) % 2 else -1) * (1 if i % 2 else 0.4)))
    for i in range(len(pts) - 1):
        for q in range(6): seg.append(pts[i].lerp(pts[i + 1], q / 6))
kd = KDTree(len(seg))
for i, p in enumerate(seg): kd.insert(p, i)
kd.balance()
me = o.data
for v in me.vertices:
    co, _, dist = kd.find(v.co)
    if dist < 0.0035 and (v.co - capC).length > 0.10:
        v.co = v.co - v.normal * 0.0025 * (1 - dist / 0.0035) ** 2
me.update()
bk = o.copy(); bk.data = o.data.copy(); bk.name = 'pauld_hi'; work.objects.link(bk); bk.hide_set(True); bk.hide_render = True
for target in (30000, 12000):
    dc = o.modifiers.new('dc', 'DECIMATE'); dc.ratio = target / len(o.data.polygons)
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dc')
for p in o.data.polygons: p.use_smooth = True

# material + baked AO into vertex colours (deepened, darkened to sit with the skull's tones)
me = o.data
me.materials.clear(); me.materials.append(bpy.data.materials['skullmetal'])
for a in list(me.color_attributes): me.color_attributes.remove(a)
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
sc = bpy.context.scene; prev = sc.render.engine
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.device = 'CPU'
for x in bpy.context.selected_objects: x.select_set(False)
o.select_set(True); bpy.context.view_layer.objects.active = o
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
sc.render.engine = prev
# the bake is noisy at 64 samples and the tone curve amplifies it: average over edge neighbours first
ao = [v.color[0] for v in ca.data]
nbr = [[] for _ in ao]
for e in me.edges:
    a_, b_ = e.vertices; nbr[a_].append(b_); nbr[b_].append(a_)
for _ in range(3):
    ao = [(ao[i] * 2 + sum(ao[j] for j in nbr[i])) / (2 + len(nbr[i])) for i in range(len(ao))]
for v, a_ in zip(ca.data, ao):
    c = 0.92 * a_ ** 2.2
    v.color = (c, c * 0.985, c * 0.96, 1.0)
old = bpy.data.objects.get('clavicle.l|pauldron')
if old: bpy.data.objects.remove(old, do_unlink=True)
o.name = 'clavicle.l|pauldron'; o.data.name = 'clavicle.l|pauldron'
for col in list(o.users_collection): col.objects.unlink(o)
bpy.data.collections['mech'].objects.link(o)
