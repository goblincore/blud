# Twinhead's impaling spike (hand.l): a fluted, barbed bone-steel spike, light steel at the root going to rust and
# then dried blood toward the tip, as vertex colours. Run inside Blender after kit_sculpt.py.
# The .blob keeps only a short hidden SDF core (its spike prim, from the hand).
import bpy, bmesh, math, random
from mathutils import Vector, noise

A = bv(0.470, 1.184, 0.358); B = bv(0.490, 0.784, 0.978)   # the old SDF spike, root -> tip (blob rest coords)
ax = (B - A).normalized(); L = (B - A).length
e1 = (Vector((1, 0, 0)) - ax * ax.x).normalized(); e2 = ax.cross(e1)
clear_work()
for o in list(bpy.data.collections['mech'].all_objects):
    if o.name == 'hand.l|spike': bpy.data.objects.remove(o, do_unlink=True)

# fluted loft: three deep flutes twisting a little toward the tip, a swollen bony root
bm = bmesh.new(); NS, NA = 90, 36; rings = []
for i in range(NS + 1):
    t = i / NS
    r = 0.060 * (1 - t) ** 0.85 + 0.010 * math.exp(-((t - 0.06) / 0.05) ** 2)
    tw = 0.9 * t
    loop = []
    for k in range(NA):
        a = 2 * math.pi * k / NA
        fl = 1 - 0.22 * (0.5 + 0.5 * math.cos(3 * (a + tw))) ** 2
        p = A + ax * (L * t) + (e1 * math.cos(a) + e2 * math.sin(a)) * (r * fl)
        loop.append(bm.verts.new(p))
    rings.append(loop)
for i in range(NS):
    for k in range(NA):
        bm.faces.new((rings[i][k], rings[i][(k + 1) % NA], rings[i + 1][(k + 1) % NA], rings[i + 1][k]))
c0 = bm.verts.new(A - ax * 0.01)
for k in range(NA): bm.faces.new((rings[0][(k + 1) % NA], rings[0][k], c0))
tip = bm.verts.new(B + ax * 0.004)
for k in range(NA): bm.faces.new((rings[-1][k], rings[-1][(k + 1) % NA], tip))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mkobj('shaft', bm)
# bony rings at the root, barbs raking back along the ridges
for j, (t, r) in enumerate(((0.10, 0.060), (0.16, 0.054))):
    ring(f'r{j}', A + ax * (L * t), ax, r, 0.008)
for j, (t, a, Lb) in enumerate(((0.42, 0.2, 0.06), (0.52, 2.3, 0.055), (0.62, 4.4, 0.05), (0.33, 3.3, 0.05))):
    rr = 0.060 * (1 - t) ** 0.85
    out = e1 * math.cos(a + 0.9 * t) + e2 * math.sin(a + 0.9 * t)
    horn(f'barb{j}', A + ax * (L * t) + out * (rr * 0.7), out - ax * 0.9, out.cross(ax), Lb, 0.011, curl=0.5)
o = fuse('spike', voxel=0.0016, smooth=(0.5, 3), noise=0.0012, noise_scale=0.02)
decimate(o, 4500)
# colours: steel -> rust -> dried blood, with ragged drips running back from the tip
me = o.data
me.materials.clear(); me.materials.append(bpy.data.materials['plate'])
for a_ in list(me.color_attributes): me.color_attributes.remove(a_)
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
steel = Vector((0.78, 0.77, 0.74)); rust = Vector((0.42, 0.21, 0.10)); blood = Vector((0.30, 0.025, 0.02))
sm = lambda e0, e1_, x: max(0.0, min(1.0, (x - e0) / (e1_ - e0))) ** 2 * (3 - 2 * max(0.0, min(1.0, (x - e0) / (e1_ - e0))))
for v in me.vertices:
    t = (v.co - A).dot(ax) / L
    q = v.co - A - ax * ((v.co - A).dot(ax)); ang = math.atan2(q.dot(e2), q.dot(e1))
    n = noise.noise(v.co * 40.0) * 0.5 + noise.noise(v.co * 110.0) * 0.25
    drip = 0.10 * max(0.0, math.sin(5 * ang + 1.3)) ** 6          # streaks running back down the flutes
    k_rust = sm(0.38, 0.62, t + n * 0.12)
    k_blood = sm(0.62, 0.80, t + n * 0.10 + drip)
    pit = 0.85 + 0.15 * (0.5 + 0.5 * noise.noise(v.co * 300.0))
    c = steel.lerp(rust, k_rust * 0.85).lerp(blood, k_blood) * pit
    ca.data[v.index].color = (c.x, c.y, c.z, 1.0)
install(o, 'hand.l|spike')
clear_work()
