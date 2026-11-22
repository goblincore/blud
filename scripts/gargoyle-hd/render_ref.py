import bpy, sys, math, json, mathutils
argv = sys.argv[sys.argv.index('--')+1:]
glb, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
info={'meshes':[], 'armatures':[]}
mn=mathutils.Vector((1e9,)*3); mx=-mn
for o in meshes:
    me=o.data
    info['meshes'].append({'name':o.name,'verts':len(me.vertices),'faces':len(me.polygons),'mats':[m.name for m in me.materials if m], 'vgroups':len(o.vertex_groups)})
    for c in o.bound_box:
        w=o.matrix_world@mathutils.Vector(c)
        mn=mathutils.Vector(map(min,mn,w)); mx=mathutils.Vector(map(max,mx,w))
for a in arms: info['armatures'].append([b.name for b in a.data.bones])
info['bbox']=[list(mn),list(mx)]
print('INFO',json.dumps(info))
sc=bpy.context.scene
sc.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x=900; sc.render.resolution_y=1100
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[1].default_value=0.6
c=(mn+mx)/2; h=max(mx-mn)
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=h*1.08
L=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); L.data.energy=3; sc.collection.objects.link(L)
mode=argv[2] if len(argv)>2 else 'tex'
if mode=='clay':
    m=bpy.data.materials.new('clay'); m.use_nodes=True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.6,0.6,0.62,1)
    for o in meshes:
        o.data.materials.clear(); o.data.materials.append(m)
# glTF is Y-up -> Blender Z-up; front is -Y in blender typically
for name,yaw in [('front',0),('side',90),('back',180),('q34',35)]:
    a=math.radians(yaw); d=h*2
    cam.location=(c.x+d*math.sin(a), c.y-d*math.cos(a), c.z)
    cam.rotation_euler=(math.radians(90),0,a)
    L.rotation_euler=(math.radians(50),0,a+math.radians(30))
    sc.render.filepath=f'{out}/{mode}-{name}.png'
    bpy.ops.render.render(write_still=True)
