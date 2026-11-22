# Headless build of the imp kit (the shared Blender window may belong to another session). Adapted from the
# butcher's build.py (PR goblincore/blud#54):
#   Blender -b assets-source/imp-kit/imp-kit.blend --python assets-source/imp-kit/build.py -- \
#       [make_hands.py[:part,part] ...] [--export] [--preview OUTDIR] [--focus=x,y,z,size]
# Runs ../twinhead-kit/kit_sculpt.py + imp_common.py, then each make script (optionally with a PARTS subset), saves
# the .blend, optionally exports `mech` to imp-parts.glb (vertex colours + attributes, as biomech-style.md says) and
# renders workbench previews (front, side, back, three-quarter) of the whole kit or a focus box.
# Then: npx tsx scripts/blender-kit.ts imp assets-source/imp-kit/imp-parts.glb
import bpy, sys, os, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(bpy.data.filepath)
KIT_NAME = os.path.basename(bpy.data.filepath).replace('-kit.blend', '')


def find(script):
    for d in (KIT, HERE):
        if os.path.exists(os.path.join(d, script)): return os.path.join(d, script)
    raise FileNotFoundError(script)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
G = {'__name__': '__main__', 'find': find, 'KIT_DIR': KIT}
exec(open(os.path.join(HERE, '../twinhead-kit/kit_sculpt.py')).read(), G)
exec(open(os.path.join(HERE, 'imp_common.py')).read(), G)

for c in bpy.data.collections: c.hide_render = False   # a preview hides all but `mech`; bake_ao needs them
export = False; preview = None; focus = None
i = 0
while i < len(argv):
    a = argv[i]
    if a == '--export': export = True
    elif a == '--preview': preview = argv[i + 1]; i += 1
    elif a.startswith('--focus='): focus = [float(x) for x in a[8:].split(',')]   # blender coords, then size
    else:
        script, _, parts = a.partition(':')
        G.pop('PARTS', None)
        if parts: G['PARTS'] = set(parts.split(','))
        exec(open(find(script)).read(), G)
        print('BUILT', a)
    i += 1

bpy.ops.wm.save_mainfile()
mech = bpy.data.collections['mech']
print('PARTS', sorted(o.name for o in mech.all_objects))
print('TRIS', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in mech.all_objects if o.type == 'MESH'))

if export:
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in mech.all_objects: o.hide_set(False); o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(KIT, f'{KIT_NAME}-parts.glb'), use_selection=True, export_format='GLB',
                              export_vertex_color='ACTIVE', export_attributes=True, export_apply=True)
    print('EXPORTED')

if preview:
    os.makedirs(preview, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading; sh.light = 'MATCAP'; sh.color_type = 'VERTEX'
    sc.render.resolution_x = 700; sc.render.resolution_y = 900
    sc.world.color = (0.08, 0.07, 0.08)
    for c in bpy.data.collections:
        if c.name != 'mech': c.hide_render = True
    if focus:
        cen = Vector(focus[:3]); size = focus[3]
    else:
        mn = Vector((1e9,) * 3); mx = -mn
        for o in mech.all_objects:
            for v in o.bound_box:
                w = o.matrix_world @ Vector(v); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
        cen = (mn + mx) / 2; size = max(mx - mn) * 1.05
    cam = bpy.data.objects.get('pvcam') or bpy.data.objects.new('pvcam', bpy.data.cameras.new('pvcam'))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = size; sc.camera = cam
    for label, yaw in (('front', 0), ('side', 90), ('back', 180), ('q', 45), ('qback', 225)):
        a = math.radians(yaw)
        d = Vector((math.sin(a), -math.cos(a), 0.15)).normalized()   # blob +z (front) is blender -y
        cam.location = cen + d * 5
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(preview, f'{label}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for c in bpy.data.collections: c.hide_render = False
    bpy.ops.wm.save_mainfile()
    print('PREVIEW', preview)
