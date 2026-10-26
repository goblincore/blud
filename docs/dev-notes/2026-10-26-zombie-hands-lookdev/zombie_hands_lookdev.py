# docs/dev-notes/2026-10-26-zombie-hands-lookdev/zombie_hands_lookdev.py
#
# LOOK-DEV ONLY (owner, 2026-10-26: "curious what hands would look like for the zombie"). Three zombie hand concepts
# built in the goblin hand's language (scripts/model_goblin_arm.py build_hand: tapered shafts between knuckle BALLS
# fatter than the shafts), at human scale and in the zombie's flesh colour (material.ts henenlotter-latex). Renders
# only; nothing is exported or wired into the game. Run headless:
#
#   /opt/homebrew/bin/blender -b -noaudio -P docs/dev-notes/2026-10-26-zombie-hands-lookdev/zombie_hands_lookdev.py
#
# Frame per hand (as the goblin's): origin at the palm centre, fingers toward -Z, palmar +Y, thumb toward +X.
import bpy, bmesh, math, os
from mathutils import Vector, Quaternion, Matrix

OUT = os.path.dirname(os.path.abspath(__file__))
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new('Z'); bpy.context.scene.collection.children.link(col)

def M(n, base, rough, met=0.0, emit=None):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = met
    if "Subsurface Weight" in b.inputs:
        b.inputs["Subsurface Weight"].default_value = 0.15
    return m
MAT = {
    'Flesh': M('Flesh', (0.82, 0.44, 0.46), 0.38),     # henenlotter-latex baseColor
    'Rot':   M('Rot',   (0.42, 0.05, 0.07), 0.22),     # its deepColor, wet
    'Bone':  M('Bone',  (0.86, 0.82, 0.70), 0.45),
    'Nail':  M('Nail',  (0.42, 0.36, 0.22), 0.30),     # yellowed, cracked horn
}

def sphere(r, segs=14, rings=10):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free(); return me

def frustum(r0, r1, d, segs=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=d)
    me = bpy.data.meshes.new('f'); bm.to_mesh(me); bm.free(); return me

def put(me, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    o = bpy.data.objects.new('p', me); col.objects.link(o)
    o.location = loc; o.rotation_euler = rot; o.scale = scale; o.parent = parent
    o.data.materials.append(MAT[mat])
    for p in o.data.polygons: p.use_smooth = True
    return o

def seg(parent, p0, p1, r0, r1, mat='Flesh', segs=12):
    a, b = Vector(p0), Vector(p1); d = b - a
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    return put(frustum(r0, r1, d.length, segs), mat, parent, loc=(a + b) / 2, rot=rot)

def hand(root, palm, fingers, thumb, digit_r, joint_r, tip='nail', palm_lumps=()):
    """fingers: (x at the knuckle, splay deg, lengths, curls, segments that exist (3 = whole, 2 = rotted short))."""
    put(sphere(1.0, 20, 14), 'Flesh', root, scale=palm)
    for (x, y, z, r) in palm_lumps:                      # swellings, so the palm is not a clean egg
        put(sphere(r, 12, 8), 'Flesh', root, loc=(x, y, z))
    for (kx, splay, lens, curls, n) in fingers:
        p = Vector((kx, -0.003, -palm[2] * 0.86))
        q = Quaternion((0, 1, 0), math.radians(-splay)); lateral = q @ Vector((1, 0, 0))
        put(sphere(joint_r[0]), 'Flesh', root, loc=p)
        # Metacarpal ridge: a bone under the skin from the wrist end of the palm to this knuckle (the bony back).
        seg(root, Vector((kx * 0.5, -palm[1] * 0.8, palm[2] * 0.55)), p + Vector((0, -0.003, 0)), digit_r[0] * 0.5, digit_r[0] * 0.7, 'Flesh', 8)
        for j in range(n):
            q = Quaternion(lateral, math.radians(curls[j])) @ q
            nxt = p + q @ Vector((0, 0, -lens[j]))
            bone_tip = tip == 'bone' and j == n - 1
            if bone_tip:
                # The flesh has rotted back off the last joint: a ragged red collar, then bare bone, thinner.
                put(frustum(digit_r[j] * 1.45, digit_r[j] * 1.10, 0.009), 'Rot', root, loc=p,
                    rot=Vector((0, 0, 1)).rotation_difference((nxt - p).normalized()).to_euler())
                nxt = p + (nxt - p) * 1.15                 # bare bone reads a touch longer than the flesh it lost
                seg(root, p, nxt, digit_r[j] * 0.70, digit_r[j] * 0.48, 'Bone', 10)
                put(sphere(digit_r[j] * 0.62, 10, 8), 'Bone', root, loc=nxt)
            else:
                seg(root, p, nxt, digit_r[j], digit_r[j + 1])
                if j < n - 1:
                    put(sphere(joint_r[j + 1]), 'Flesh', root, loc=nxt)
            p = nxt
        if n < 3:                                         # a rotted stump: a wet red cap where the finger ends
            put(sphere(digit_r[n] * 1.05, 10, 8), 'Rot', root, loc=p)
        elif tip == 'nail':                               # a cracked dark nail on the back of the tip
            put(sphere(digit_r[3] * 1.35, 10, 8), 'Nail', root, loc=p + q @ Vector((0, -digit_r[3] * 0.6, 0.002)),
                scale=(1.0, 0.45, 1.5))
    # Thumb: two segments from the thumbward edge.
    t0 = Vector((palm[0] * 0.80, 0.008, 0.012)); put(sphere(joint_r[0] * 1.1), 'Flesh', root, loc=t0)
    t1 = t0 + Vector(thumb[0]).normalized() * 0.038; seg(root, t0, t1, digit_r[0] * 1.15, digit_r[1] * 1.1)
    put(sphere(joint_r[1] * 1.05), 'Flesh', root, loc=t1)
    t2 = t1 + Vector(thumb[1]).normalized() * 0.030
    if tip == 'bone':
        put(frustum(digit_r[1] * 1.45, digit_r[1] * 1.10, 0.009), 'Rot', root, loc=t1,
            rot=Vector((0, 0, 1)).rotation_difference((t2 - t1).normalized()).to_euler())
        seg(root, t1, t2, digit_r[1] * 0.72, digit_r[2] * 0.50, 'Bone', 10)
        put(sphere(digit_r[2] * 0.62, 10, 8), 'Bone', root, loc=t2)
    else:
        seg(root, t1, t2, digit_r[1] * 1.05, digit_r[3] * 1.1)
        if tip == 'nail':
            put(sphere(digit_r[3] * 1.2, 8, 6), 'Nail', root, loc=t2 + Vector((0, -digit_r[3] * 0.6, 0)), scale=(1, 0.45, 1.3))

ROOTS = []
def root_at(x):
    r = bpy.data.objects.new('H', None); col.objects.link(r); r.location = (x, 0, 0); ROOTS.append(r); return r

# A: THE GRABBER -- splayed, hooked fingers reaching, swollen knuckles, cracked dark nails.
hand(root_at(-0.24), (0.040, 0.016, 0.054),
     [(+0.031, +14, (0.046, 0.028, 0.022), (12, 48, 34), 3),
      (+0.010, +4,  (0.050, 0.031, 0.023), (10, 50, 36), 3),
      (-0.011, -6,  (0.047, 0.029, 0.022), (14, 52, 38), 3),
      (-0.031, -18, (0.038, 0.023, 0.019), (18, 56, 40), 3)],
     ((0.80, 0.30, -0.52), (0.55, 0.55, -0.62)),
     (0.0095, 0.0082, 0.0072, 0.0062), (0.0125, 0.0108, 0.0092),
     palm_lumps=((0.018, -0.012, 0.010, 0.016), (-0.022, -0.010, -0.014, 0.014)))

# B: THE BLOATER -- fat sausage fingers bunched together, the ring finger rotted down to a stump.
hand(root_at(0.0), (0.045, 0.021, 0.054),
     [(+0.032, +4,  (0.042, 0.027, 0.022), (22, 32, 24), 3),
      (+0.011, +1,  (0.046, 0.029, 0.023), (20, 30, 22), 3),
      (-0.011, -2,  (0.043, 0.027, 0.022), (24, 34, 26), 2),
      (-0.032, -5,  (0.035, 0.022, 0.018), (28, 38, 30), 3)],
     ((0.70, 0.40, -0.60), (0.40, 0.60, -0.70)),
     (0.0135, 0.0128, 0.0120, 0.0108), (0.0150, 0.0142, 0.0132),
     tip='round', palm_lumps=((0.020, 0.010, 0.016, 0.022), (-0.018, -0.014, -0.008, 0.020), (0.0, 0.016, -0.026, 0.018)))

# C: BONE TIPS -- the flesh rotted back off the last joint; bare finger bones poke out of ragged collars.
hand(root_at(0.24), (0.039, 0.015, 0.053),
     [(+0.030, +10, (0.046, 0.028, 0.024), (16, 44, 30), 3),
      (+0.010, +3,  (0.050, 0.031, 0.026), (14, 46, 32), 3),
      (-0.010, -5,  (0.047, 0.029, 0.024), (18, 48, 34), 3),
      (-0.030, -14, (0.038, 0.023, 0.021), (22, 52, 36), 3)],
     ((0.80, 0.30, -0.52), (0.55, 0.55, -0.62)),
     (0.0092, 0.0080, 0.0070, 0.0060), (0.0120, 0.0104, 0.0090),
     tip='bone', palm_lumps=((0.016, -0.012, 0.012, 0.015),))

# Render: back of the hands, three-quarter, and the palms.
w = bpy.context.scene.world = bpy.data.worlds.new('W'); w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.10, 0.10, 0.11, 1)
sun = bpy.data.objects.new('S', bpy.data.lights.new('S', 'SUN')); sun.data.energy = 3.2
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); bpy.context.collection.objects.link(sun)
rim = bpy.data.objects.new('R', bpy.data.lights.new('R', 'AREA')); rim.data.energy = 120; rim.data.size = 1.5
rim.location = (-0.6, 0.8, 0.6); rim.rotation_euler = (math.radians(60), 0, math.radians(-140))
bpy.context.collection.objects.link(rim)
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); bpy.context.collection.objects.link(cam)
cam.data.lens = 70; bpy.context.scene.camera = cam
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.eevee.taa_render_samples = 64
sc.render.resolution_x = 1500; sc.render.resolution_y = 620
# One camera per hand, three views each; zombie-hands-sheet.png is the 3 x 3 contact sheet.
sc.render.resolution_x = 700; sc.render.resolution_y = 620; cam.data.lens = 50
VIEWS = {'back': (-20, 55), 'side': (-95, 8), 'palm': (165, 25)}
shots = []
for k, x in enumerate((-0.24, 0.0, 0.24)):
    for i, r in enumerate(ROOTS):                         # one hand at a time, so no other blocks the side view
        for o in col.objects:
            if o.parent is r: o.hide_render = i != k
    ctr = Vector((x, 0.012, -0.045))
    for name, (az, el) in VIEWS.items():
        a, e = math.radians(az), math.radians(el)
        cam.location = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * 0.42
        cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, f'_{k}-{name}.png')
        bpy.ops.render.render(write_still=True); shots.append(sc.render.filepath)
print('[zombie-hands] rendered', len(shots), 'views to', OUT)
