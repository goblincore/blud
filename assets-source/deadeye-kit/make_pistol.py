# The deadeye's pistol: a HELD PROP (public/assets/lab/deadeye-pistol.glb), not kit, so it follows the carry's aim
# and drops when he dies (held-prop.ts, prop-drop.ts). Run after kit_sculpt.py + butcher_common.py
# (../butcher-kit/build.py); it builds into its own `pistol` collection and exports itself.
#
# GUN-LOCAL FRAME (carry.ts GUN_GRIP; glTF +y up, +z out of the muzzle; `bv` maps it to Blender exactly as it maps
# blob coords): the hand holds Grip_Hand (0, -0.074, -0.074), the shared contract every held gun keeps; the bore runs
# along y 0; the muzzle is at (0, 0, 0.112), which motion-profile.ts DEADEYE_PROFILE passes as prop.muzzle.
# A little gun in a big fist: ~0.21 m long, a bony slide with a crest and chevron ribs, a brass muzzle ring and
# bands, a curled-horn hammer and trigger guard, a knuckled grip ending in a pommel spur.
import bpy, math, os
from mathutils import Vector

MUZ = 0.112
col = bpy.data.collections.get('pistol') or bpy.data.collections.new('pistol')
if col.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(col)
for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)


def into_pistol(o):
    for c in list(o.users_collection): c.objects.unlink(o)
    col.objects.link(o)
    return o


clear_work()
S = [i / 40 for i in range(41)]
# slide: a tapered bony tube along the bore, flattened a little across
z0, z1 = -0.082, MUZ - 0.004
sl = tube('slide', [bv(0, 0.002, z0 + (z1 - z0) * s) for s in S], [0.020 - 0.004 * s + 0.003 * math.exp(-((s - 0.1) / 0.12) ** 2) for s in S], segs=20)
sl.scale = (0.85, 1.0, 1.0)
bpy.context.view_layer.objects.active = sl
for o in bpy.context.selected_objects: o.select_set(False)
sl.select_set(True); bpy.ops.object.transform_apply(scale=True)
tube('crest', [bv(0, 0.020 - 0.004 * s, z0 + 0.01 + (z1 - z0 - 0.03) * s) for s in S], [0.0025 + 0.004 * sn(s) for s in S])
for side in (1, -1):
    for k, zz in enumerate((-0.05, -0.02, 0.01, 0.04)):
        R = [i / 12 for i in range(13)]
        tube(f'rib{side}{k}', [bv(side * (0.012 + 0.004 * u), 0.016 - 0.020 * u, zz - 0.014 * u) for u in R], [0.0016 + 0.0018 * sn(u) for u in R], segs=6)
# frame under the slide and the trigger guard, a curled horn
tube('frame', [bv(0, -0.018, -0.060 + 0.11 * s) for s in S], [0.011 - 0.003 * s for s in S], segs=12)
horn('guard', bv(0, -0.024, 0.040), bv(0, -1, -0.2), bv(1, 0, 0), 0.05, 0.005, curl=2.6)
horn('trigger', bv(0, -0.024, 0.010), bv(0, -1, 0.3), bv(1, 0, 0), 0.020, 0.004, curl=-0.6)
# the grip: raked down and back through the hand's point, knuckled
G0, G1 = Vector((0, -0.022, -0.052)), Vector((0, -0.118, -0.090))
tube('grip', [bv(*(G0.lerp(G1, s))) for s in S], [0.0135 + 0.002 * sn(s) for s in S], segs=16)
for k, s in enumerate((0.3, 0.5, 0.7)):
    ball(f'knuckle{k}', bv(*(G0.lerp(G1, s) + Vector((0, 0.002, 0.012)))), 1.0, 0.010, 0.006, 0.006)
horn('pommel', bv(*G1), bv(0, -0.6, -1), bv(1, 0, 0), 0.03, 0.009, curl=0.6)
# the hammer: a curled horn at the back of the slide
horn('hammer', bv(0, 0.010, z0 + 0.004), bv(0, 0.5, -1), bv(1, 0, 0), 0.03, 0.007, curl=-1.4)
o = fuse('pistolbody', voxel=0.0009, smooth=(0.4, 2), noise=0.0004, noise_scale=0.012)
decimate(o, 6000); bake_ao(o, 'skullmetal', ao_dist=0.02)
o.name = 'pistolbody'; o.data.name = 'pistolbody'
into_pistol(o); clear_work()
# brass: the muzzle ring and two bands; the bore a black disc just inside the ring
for k, (zz, r) in enumerate(((MUZ - 0.006, 0.0175), (-0.030, 0.0195), (0.045, 0.0185))):
    b = ring('b', bv(0, 0.002, zz), bv(0, 0, 1), r, 0.0032, segs=28)
    plain(b, 'brass'); b.name = f'brass{k}'; into_pistol(b)
bore = ball('bore', bv(0, 0.002, MUZ - 0.002), 1.0, 0.0075, 0.0075, 0.003)
plain(bore, 'black'); bore.name = 'bore'; into_pistol(bore)
clear_work()

# the locators (documentation for the gun-local contract; held-prop.ts reads the shared constants)
root = bpy.data.objects.new('GunRoot', None); col.objects.link(root)
for name, p in (('Grip_Hand', (0, -0.074, -0.074)), ('Muzzle', (0, 0.002, MUZ)), ('Fore_Hand', (0, -0.045, 0.155))):
    e = bpy.data.objects.new(name, None); e.location = bv(*p); col.objects.link(e); e.parent = root
for o in col.objects:
    if o.type == 'MESH': o.parent = root

for o in bpy.context.view_layer.objects: o.select_set(False)
for o in col.objects: o.hide_set(False); o.select_set(True)
out = os.path.join(KIT_DIR, '..', '..', 'public', 'assets', 'lab', 'deadeye-pistol.glb')
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), use_selection=True, export_format='GLB',
                          export_vertex_color='ACTIVE', export_attributes=True, export_apply=True)
print('PISTOL', os.path.abspath(out), sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in col.objects if o.type == 'MESH'), 'tris')
