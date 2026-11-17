import bpy, sys, math
argv = sys.argv[sys.argv.index('--')+1:]
ply, out = argv[0], argv[1]
views = argv[2].split(',') if len(argv)>2 else ['front','q34','side','back']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.ply_import(filepath=ply, forward_axis='NEGATIVE_Z', up_axis='Y')
o=[x for x in bpy.context.scene.objects if x.type=='MESH'][0]
bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.shade_smooth()
m=bpy.data.materials.new('clay'); m.use_nodes=True
b=m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value=(0.6,0.6,0.62,1); b.inputs['Roughness'].default_value=0.6
o.data.materials.clear(); o.data.materials.append(m)
sc=bpy.context.scene; sc.render.engine='BLENDER_EEVEE'
sc.render.resolution_x=900; sc.render.resolution_y=1100
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[1].default_value=0.6
# fixed framing = reference bbox in engine frame (x -0.86..0.85, y 0..2.05, z -1.0..1.05) -> blender (x, -z, y)
cx,cy,cz=0.0,-0.02,1.025; H=2.2
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=H
L=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); L.data.energy=3; sc.collection.objects.link(L)
yaws={'front':0,'q34':35,'side':90,'back':180}
for name in views:
    a=math.radians(yaws[name]); d=4
    cam.location=(cx+d*math.sin(a), cy-d*math.cos(a), cz); cam.rotation_euler=(math.radians(90),0,a)
    L.rotation_euler=(math.radians(50),0,a+math.radians(30))
    sc.render.filepath=f'{out}-{name}.png'; bpy.ops.render.render(write_still=True)
