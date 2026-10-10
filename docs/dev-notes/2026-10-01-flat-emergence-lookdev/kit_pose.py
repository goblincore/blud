# Pose the goblin's polygon kit (goblin-kit.gltf, skinned to a skeleton that mirrors goblin.blob) to a .blob pose
# dumped by blob-bones.ts. Each bone gets the minimal rotation from its .blob rest direction to its posed direction,
# about its posed head. Returns the kit's top objects (the armature and its meshes).
import bpy, json
from mathutils import Matrix, Vector

KIT_MAP = {'hips': 'pelvis', 'spine1': 'spine1', 'chest': 'chest', 'neck': 'neck', 'skull': 'skull'}
for side in ('l', 'r'):
    for b in ('clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'):
        KIT_MAP[f'{b}.{side}'] = f'{b}.{side}'

def conv(v):                      # game (x, y up, +z forward) -> the kit's Blender space (z up, -y forward)
    return Vector((v[0], -v[2], v[1]))

def pose_kit(kit_path, bones_json):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=kit_path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == 'MESH' and o.name.startswith('Icosphere')]:
        bpy.data.objects.remove(o, do_unlink=True); new.remove(o)       # the glTF's bone-display helper
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    for o in new: o.rotation_mode = 'XYZ'      # the glTF importer leaves quaternion mode, which ignores rotation_euler
    data = json.load(open(bones_json)); rest, posed = data['rest'], data['posed']
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    order = []
    def walk(b):
        order.append(b)
        for c in b.children: walk(c)
    for b in arm.data.bones:
        if b.parent is None: walk(b)
    for b in order:
        key = KIT_MAP.get(b.name)
        if not key or key not in rest['dirs']: continue
        pb = arm.pose.bones[b.name]
        R = conv(rest['dirs'][key]).normalized().rotation_difference(conv(posed['dirs'][key]).normalized()).to_matrix().to_4x4()
        h0, h1 = conv(rest['heads'][key]), conv(posed['heads'][key])
        pb.matrix = Matrix.Translation(h1) @ R @ Matrix.Translation(-h0) @ b.matrix_local
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    return [o for o in new if o.parent is None], arm
