# assets-source/zombie-kit/make_hands.py
#
# THE ZOMBIE'S GRABBER HANDS as its kit (owner, 2026-10-26: "take A (the grabber) further and put it on the zombie in
# game"). The hand is the look-dev's concept A (docs/dev-notes/2026-10-26-zombie-hands-lookdev/): splayed, hooked
# fingers with swollen knuckles and cracked nails, in the goblin hand's digit language. The zombie has NO hand bone --
# its arm ended in a fist orb on the forearm's tail -- so each hand rides `foreArm.l` / `foreArm.r` rigidly
# (scripts/blender-kit.ts contract: a mesh node `<bone>|<part>`, geometry in the .blob's rest frame), hung below the
# wrist with the palm toward the thigh and the thumb forward. `zombieskin` is FLESH: in the game it is redrawn with the
# flesh shader's own lighting in the zombie's own flesh (kit-flesh.ts); `zombienail` keeps a standard look.
#
#   /opt/homebrew/bin/blender -b -noaudio -P assets-source/zombie-kit/make_hands.py
#   npx tsx scripts/blender-kit.ts zombie assets-source/zombie-kit/zombie-parts.glb
import bpy, bmesh, math, os
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(HERE, 'zombie-parts.glb')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new('mech'); bpy.context.scene.collection.children.link(col)

def M(n, base, rough):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    return m
_SKIN = M('zombieskin', (0.82, 0.44, 0.46), 0.38)   # henenlotter-latex baseColor (the game swaps in its own flesh)
_NAIL = M('zombienail', (0.42, 0.36, 0.22), 0.30)   # yellowed, cracked horn
# ONE material object per name: two `M('zombieskin', ...)` calls would make Blender rename the second `zombieskin.001`,
# and blender-kit.ts / kit-flesh.ts match materials by name. Rot and Bone are unused by the grabber (hand() is the
# look-dev's verbatim), so they alias these.
MAT = {'Flesh': _SKIN, 'Rot': _SKIN, 'Bone': _NAIL, 'Nail': _NAIL}
PARTS = []

def sphere(r, segs=9, rings=6):     # crowd-cheap: the zombie is the horde enemy (look-dev used 14 x 10)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free(); return me

def frustum(r0, r1, d, segs=7):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=d)
    me = bpy.data.meshes.new('f'); bm.to_mesh(me); bm.free(); return me

def put(me, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    o = bpy.data.objects.new('p', me); col.objects.link(o); PARTS.append(o)
    o.location = loc; o.rotation_euler = rot; o.scale = scale; o.parent = parent
    o.data.materials.append(MAT[mat])
    for p in o.data.polygons: p.use_smooth = True
    return o

def seg(parent, p0, p1, r0, r1, mat='Flesh', segs=7):
    a, b = Vector(p0), Vector(p1); d = b - a
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    return put(frustum(r0, r1, d.length, segs), mat, parent, loc=(a + b) / 2, rot=rot)

def hand(root, palm, fingers, thumb, digit_r, joint_r, tip='nail', palm_lumps=()):
    """fingers: (x at the knuckle, splay deg, lengths, curls, segments that exist (3 = whole, 2 = rotted short))."""
    put(sphere(1.0, 14, 9), 'Flesh', root, scale=palm)
    for (x, y, z, r) in palm_lumps:                      # swellings, so the palm is not a clean egg
        put(sphere(r, 9, 6), 'Flesh', root, loc=(x, y, z))
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


# ---- the rest frame -----------------------------------------------------------
# zombie.blob's forearm TAIL (the wrist), from buildBody: (+-0.3011, 0.8121, 0.0703) in the .blob's Y-up, +Z-forward
# frame, which the glTF exporter makes from Blender's Z-up (x, -z, y). The hand's own frame (fingers -Z, palmar +Y,
# thumb +X) is turned about Blender Z so the palm faces the thigh and the thumb points forward (Blender -Y).
WRIST = (0.3011, -0.0703, 0.8121)          # Blender coordinates, left side (+x)
HANG = 0.062                               # palm centre below the wrist: the palm's half-length plus a little

def build_side(sx, bone):
    global PARTS
    PARTS = []
    root = bpy.data.objects.new(f'{bone}-root', None); col.objects.link(root)
    # sx -1 (left, +x side): thumb toward local -X, which must face forward -Y: rotate +90 deg about Z. Right: -90.
    root.rotation_euler = (0, 0, math.radians(90 if sx < 0 else -90))
    root.location = (WRIST[0] * (-sx), WRIST[1], WRIST[2] - HANG)
    grabber(root, sx)
    bpy.context.view_layer.update()
    # One mesh per side: join every part into the palm.
    target = PARTS[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=PARTS, selected_editable_objects=PARTS):
        bpy.ops.object.join()
    mw = target.matrix_world.copy()
    target.parent = None; target.matrix_world = mw
    target.name = f'{bone}|hand'
    return target

def grabber(root, sx):
    # Concept A, mirrored for the left hand by flipping x on every authored point (the look-dev authored a right hand).
    m = Matrix.Diagonal((sx, 1, 1, 1)) if sx < 0 else Matrix.Identity(4)
    hand(root, (0.040, 0.016, 0.054),
         [(+0.031, +14, (0.046, 0.028, 0.022), (12, 48, 34), 3),
          (+0.010, +4,  (0.050, 0.031, 0.023), (10, 50, 36), 3),
          (-0.011, -6,  (0.047, 0.029, 0.022), (14, 52, 38), 3),
          (-0.031, -18, (0.038, 0.023, 0.019), (18, 56, 40), 3)],
         ((0.80, 0.30, -0.52), (0.55, 0.55, -0.62)),
         (0.0095, 0.0082, 0.0072, 0.0062), (0.0125, 0.0108, 0.0092),
         palm_lumps=((0.018, -0.012, 0.010, 0.016), (-0.022, -0.010, -0.014, 0.014)))
    if sx < 0:   # mirror the authored right hand into a left one (and fix the winding a negative scale flips)
        for o in PARTS:
            o.data.transform(Matrix.Translation(o.location) @ o.rotation_euler.to_matrix().to_4x4() @ Matrix.Diagonal((*o.scale, 1)))
            o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)
            o.data.transform(m); o.data.flip_normals()

left = build_side(-1, 'foreArm.l')
right = build_side(+1, 'foreArm.r')
for o in list(col.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
left.select_set(True); right.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True,
                          export_extras=False, use_selection=True)
print('[zombie-kit] hands ->', OUT_GLB, 'tris',
      sum(len(o.data.polygons) for o in (left, right)))
