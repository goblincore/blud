# Turnaround of goblin body variants: each PLY in a row, rendered from three yaws in the 90s ray-tracer look.
# blender --background --factory-startup --python turn.py -- OUTDIR a.ply b.ply ...
import bpy, math, sys, os
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
OUT, PLYS = argv[0], argv[1:]
YAWS = [int(y) for y in os.environ.get('YAWS', '20,90,160').split(',')]
SP = float(os.environ.get('SPACING', '0.8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
    for d in pr.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print(e)
sc.cycles.samples = int(os.environ.get('SAMPLES', '32')); sc.cycles.use_denoising = True
sc.cycles.diffuse_bounces = 0; sc.cycles.glossy_bounces = 2
sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = 0.0
sc.render.resolution_x = int(os.environ.get('RES_X', str(int(440 * len(PLYS))))); sc.render.resolution_y = int(os.environ.get('RES_Y', '620'))
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.2, 0.21, 0.23, 1)

def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')
def node(nt, kind, **k):
    n = nt.nodes.new(kind)
    for a, v in k.items():
        if a.startswith('_'): setattr(n, a[1:], v)
        else: n.inputs[a].default_value = v
    return n
def L(nt, a, b): nt.links.new(a, b)
def mr(nt, v, a, b, c, d):
    n = node(nt, 'ShaderNodeMapRange', **{'From Min': a, 'From Max': b, 'To Min': c, 'To Max': d}); L(nt, v, n.inputs['Value']); return n.outputs['Result']
def mix(nt, f, a, b):
    n = nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'
    for s, v in ((n.inputs[0], f), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(v, tuple): s.default_value = v
        else: L(nt, v, s)
    return n.outputs[2]

def goblin_material():
    m, nt, out = mat('goblin')
    vc = nt.nodes.new('ShaderNodeVertexColor'); tc = nt.nodes.new('ShaderNodeTexCoord')
    BASE, MOTTLE, CHAR = (0.22, 0.55, 0.025, 1), (0.05, 0.085, 0.008, 1), (0.012, 0.018, 0.006, 1)
    mz = node(nt, 'ShaderNodeTexNoise', Scale=7.0, Detail=4.0, Roughness=0.55); L(nt, tc.outputs['Object'], mz.inputs['Vector'])
    skin = mix(nt, mr(nt, mz.outputs['Fac'], 0.45, 0.6, 0.0, 0.8), BASE, MOTTLE)
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.05
    skin = mix(nt, mr(nt, ao.outputs['AO'], 0.35, 1.0, 0.85, 0.0), skin, CHAR)
    dv = node(nt, 'ShaderNodeVectorMath', _operation='DISTANCE'); L(nt, vc.outputs['Color'], dv.inputs[0]); dv.inputs[1].default_value = (0.34, 0.44, 0.19)
    col = mix(nt, mr(nt, dv.outputs['Value'], 0.05, 0.12, 0.0, 1.0), skin, vc.outputs['Color'])
    pits = node(nt, 'ShaderNodeTexVoronoi', Scale=420.0); L(nt, tc.outputs['Object'], pits.inputs['Vector'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Coat Weight': 0.45, 'Coat Roughness': 0.22, 'Subsurface Weight': 0.3,
        'Subsurface Radius': (1.0, 0.35, 0.15), 'Subsurface Scale': 0.02, 'Specular IOR Level': 0.6})
    L(nt, col, p.inputs['Base Color']); L(nt, mr(nt, pits.outputs['Distance'], 0.0, 0.35, 0.8, 0.3), p.inputs['Roughness'])
    b = node(nt, 'ShaderNodeBump', Strength=0.3, Distance=0.002); L(nt, pits.outputs['Distance'], b.inputs['Height']); L(nt, b.outputs['Normal'], p.inputs['Normal'])
    L(nt, p.outputs[0], out.inputs['Surface'])
    return m
M = goblin_material()
bm_, nt, out = mat('floor'); L(nt, node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.32, 0.32, 0.34, 1), 'Roughness': 0.7}).outputs[0], out.inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0)); bpy.context.active_object.data.materials.append(bm_)

objs = []
for i, p in enumerate(PLYS):
    bpy.ops.wm.ply_import(filepath=p)
    o = bpy.context.active_object; o.data.materials.append(M)
    for poly in o.data.polygons: poly.use_smooth = True
    o.rotation_mode = 'XYZ'
    o.location = ((i - (len(PLYS) - 1) / 2) * SP, 0, 0)
    objs.append(o)

def light(kind, loc, rot, energy, color, size=0.05):
    Ld = bpy.data.lights.new(kind + str(len(bpy.data.lights)), kind); Ld.energy = energy; Ld.color = color
    if kind == 'AREA': Ld.size = size
    if kind == 'SUN': Ld.angle = math.radians(1.0)
    o = bpy.data.objects.new(Ld.name, Ld); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o)
sun_dir = Vector((-0.5, 0.8, -0.6)).normalized()
light('SUN', (0, 0, 5), sun_dir.to_track_quat('-Z', 'Y').to_euler(), 3.2, (1.0, 0.93, 0.85))
light('AREA', (3, -4, 2.5), Vector((-3, 4, -1.8)).to_track_quat('-Z', 'Y').to_euler(), 260.0, (0.6, 0.7, 0.9), 3.0)
light('AREA', (-1, 4, 2.2), Vector((1, -4, -1.2)).to_track_quat('-Z', 'Y').to_euler(), 220.0, (0.9, 0.85, 1.0), 2.0)

cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = SP * len(PLYS) * 1.02
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, -8, 0.72); cam.rotation_euler = (math.radians(90), 0, 0)
os.makedirs(OUT, exist_ok=True)
for yaw in YAWS:
    for o in objs:   # PLY: game y-up, +z forward -> Blender z-up facing -y (toward the camera), then the yaw
        o.rotation_euler = (math.radians(90), 0, math.radians(yaw))
    sc.render.filepath = os.path.join(OUT, f'yaw{yaw:03d}.png'); bpy.ops.render.render(write_still=True); print('RENDERED', yaw)
