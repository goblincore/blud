# Tallow: the VOLLEY ROCKET (owner, 2026-11-15: the procedural rocket "has like floating fins and in general looks basic
# - you can build one in blender"). Not a kit part: a loose static mesh the game draws for every volley shot
# (src/lab/sdf-zombie/webgpu/rocket-view.ts), exported on its own to public/assets/lab/tallow-rocket.glb.
# Built nose UP along +Z with the nozzle mouth at z 0 (glTF's +Y up turns that into three's +Y, the rocket view's
# flight axis). Industrial like the cannons: a riveted iron tube, a bolted collar, a blunt rusted warhead with a
# fuse cap, four swept fins WELDED to the tube (their roots run inside it and the voxel fuse joins them), a flared nozzle bell sooted
# black inside. Unlit in the game (the effects overlay has no lights), so the shading is baked into the vertex
# colours: AO, a soft key from above-front, and the tint.
# Run through build.py (kit helpers and materials): Blender -b tallow-kit.blend --python build.py -- make_rocket.py
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

R = 0.050            # tube radius
Z0, Z1 = 0.035, 0.330  # the tube, behind the collar
L_NOSE = 0.125
OUT = os.path.join(KIT_DIR, '..', '..', 'public', 'assets', 'lab', 'tallow-rocket.glb')
UP = Vector((0, 0, 1))

clear_work()
bv_ = lambda z: Vector((0, 0, z))

# The tube, very slightly waisted, and the bolted collar where the warhead screws on.
tube('body', [bv_(Z0), bv_(0.18), bv_(Z1)], [R * 0.97, R * 0.985, R], segs=24)
prism('collar', bv_(Z1 - 0.004), bv_(Z1 + 0.022), R * 1.10, 12, math.pi / 12)
for k in range(12):
    a = 2 * math.pi * k / 12
    d = Vector((math.cos(a), math.sin(a), 0))
    bolt(f'cb{k}', bv_(Z1 + 0.009) + d * R * 1.10 * math.cos(math.pi / 12), d, r=0.0055, h=0.005)
# Two rivet bands down the tube.
for j, z in enumerate((0.105, 0.245)):
    ring(f'band{j}', bv_(z), UP, R + 0.001, 0.0045, segs=48)
    for k in range(10):
        a = 2 * math.pi * (k + 0.5 * j) / 10
        d = Vector((math.cos(a), math.sin(a), 0))
        ball(f'rv{j}{k}', bv_(z) + d * (R + 0.003), 0.0042)
# The warhead: a blunt ogive off the collar, and a fuse cap on its tip.
nose_pts, nose_r = [], []
for i in range(13):
    t = i / 12
    nose_pts.append(bv_(Z1 + 0.020 + L_NOSE * t))
    nose_r.append(max(0.012, R * 1.02 * math.sqrt(max(0.0, 1 - t ** 1.6))))
tube('nose', nose_pts, nose_r, segs=24)
prism('fuse', bv_(Z1 + 0.020 + L_NOSE - 0.010), bv_(Z1 + 0.020 + L_NOSE + 0.012), 0.016, 8, math.pi / 8)
ball('fusecap', bv_(Z1 + 0.020 + L_NOSE + 0.012), 0.013, 1, 1, 0.6)
# The nozzle bell: a flared skirt behind the tube (solid; its mouth is sooted black in the tint).
# Flat-ended rings, not a capped tube (its end caps came to a cone point).
prism('bell0', bv_(-0.012), bv_(0.004), R * 0.88, 24)
prism('bell1', bv_(0.004), bv_(Z0 + 0.004), R * 0.74, 24)
ring('bellrim', bv_(-0.010), UP, R * 0.86, 0.005, segs=40)


def fin(name, a):
    """A swept fin on its root strap: a thin plate whose ROOT runs 6 mm inside the tube (the fuse welds it), its
    leading edge swept back, its tip chord shorter than its root, and a strap wrapped round the tube under it."""
    d = Vector((math.cos(a), math.sin(a), 0)); s = UP.cross(d)
    zr0, zr1 = 0.010, 0.150          # root chord (tail to front)
    span, sweep, tipc = 0.052, 0.080, 0.045
    th = 0.0035
    root_in = R - 0.006
    pts = [
        d * root_in + UP * zr0,
        d * root_in + UP * zr1,
        d * (R + span) + UP * (zr1 - sweep),
        d * (R + span) + UP * (zr1 - sweep - tipc),
    ]
    bm = bmesh.new()
    fr = [bm.verts.new(p + s * th) for p in pts]
    bk = [bm.verts.new(p - s * th) for p in pts]
    bm.faces.new(fr); bm.faces.new(list(reversed(bk)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((fr[i], bk[i], bk[j], fr[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mkobj(name, bm)


for k in range(4):
    fin(f'fin{k}', math.pi / 4 + k * math.pi / 2)

o = fuse('tallow-rocket', voxel=0.0016, smooth=(0.45, 2), noise=0.0006, noise_scale=0.02)
decimate(o, 3200)
bake_ao(o, 'impmetal', gain=1.25, gamma=1.3, ao_dist=0.02)
sm = lambda t: (lambda x: x * x * (3 - 2 * x))(min(1.0, max(0.0, t)))


def rtint(co):
    """Iron tube, rusted warhead, sooted tail; a baked key light from above-front (the overlay is unlit)."""
    z = co.z; r = math.hypot(co.x, co.y)
    mot = 0.5 + 0.5 * math.sin(co.x * 211.0 + math.sin(co.z * 157.0) * 2.0 + co.y * 173.0)
    # LINEAR values (the glTF export writes sRGB bytes: a 0.30 iron came out pale grey).
    iron = (0.075, 0.070, 0.066)
    rust = mix3((0.16, 0.045, 0.018), (0.26, 0.085, 0.030), mot)
    c = mix3(iron, rust, sm((z - (Z1 + 0.025)) / 0.03) * (0.75 + 0.25 * mot))
    c = mix3(c, (0.17, 0.165, 0.16), sm((z - (Z1 + 0.020 + L_NOSE)) / 0.006))          # bare-steel fuse cap
    c = mix3(c, (0.012, 0.011, 0.010), sm((0.035 - z) / 0.03) * (0.6 + 0.4 * mot))       # soot round the bell
    if z < -0.004 and r < R * 0.72: c = (0.003, 0.003, 0.003)                          # the nozzle mouth
    return c


ca = o.data.color_attributes['Col']
L = Vector((0.35, -0.55, 0.75)).normalized()
o.data.calc_normals_split() if hasattr(o.data, 'calc_normals_split') else None
for v, c in zip(o.data.vertices, ca.data):
    t = rtint(v.co); a = c.color
    key = 0.45 + 0.95 * max(0.0, v.normal.dot(L)) + 0.20 * max(0.0, v.normal.z)
    c.color = (a[0] * t[0] * key, a[1] * t[1] * key, a[2] * t[2] * key, 1.0)

for x in bpy.context.view_layer.objects: x.select_set(False)
o.hide_set(False); o.select_set(True); bpy.context.view_layer.objects.active = o
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_vertex_color='ACTIVE',
                          export_apply=True, export_materials='NONE')
tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
print('ROCKET', tris, 'tris ->', os.path.abspath(OUT))
bpy.data.objects.remove(o)
