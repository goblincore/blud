# The idyll outside the goblin's window, done the way Terragen and Bryce did it: ridged multifractal mountains rising out
# of a glassy sea, height-banded meadow / rock / snow, a sun low on the horizon, a deck of sunset cloud, aerial haze, and
# the Line on slender pylons climbing away through it. Run: blender -b --factory-startup --python terragen.py -- OUTPREFIX
import bpy, math, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/terragen'
random.seed(3)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed', e)
sc.cycles.samples = 96; sc.cycles.use_denoising = True; sc.cycles.volume_bounces = 0; sc.cycles.volume_step_rate = 8.0
sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 1
sc.render.resolution_x, sc.render.resolution_y = 960, 720
sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = -0.2

SUN_EL, SUN_AZ = 7.0, 195.0      # degrees; the sun sits low, straight ahead (-y)
H = 230.0                         # the window above the sea

world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True; nt = world.node_tree
_sd = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL))))
tcw = nt.nodes.new('ShaderNodeTexCoord')
sepw = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tcw.outputs['Generated'], sepw.inputs[0])
grad = nt.nodes.new('ShaderNodeValToRGB'); g = grad.color_ramp
g.elements[0].position = 0.0; g.elements[0].color = (0.9, 0.45, 0.25, 1)          # horizon (and below)
g.elements[1].position = 0.6; g.elements[1].color = (0.05, 0.12, 0.35, 1)         # zenith
e = g.elements.new(0.06); e.color = (1.0, 0.62, 0.38, 1)
e = g.elements.new(0.2); e.color = (0.55, 0.42, 0.55, 1)
e = g.elements.new(0.35); e.color = (0.18, 0.25, 0.5, 1)
nt.links.new(sepw.outputs['Z'], grad.inputs['Fac'])
dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; nt.links.new(tcw.outputs['Generated'], dot.inputs[0]); dot.inputs[1].default_value = tuple(_sd)
glow = nt.nodes.new('ShaderNodeMapRange'); glow.inputs['From Min'].default_value = 0.9; glow.inputs['From Max'].default_value = 1.0
glow.inputs['To Min'].default_value = 0.0; glow.inputs['To Max'].default_value = 1.0; glow.interpolation_type = 'SMOOTHERSTEP'
nt.links.new(dot.outputs['Value'], glow.inputs['Value'])
disc = nt.nodes.new('ShaderNodeMapRange'); disc.inputs['From Min'].default_value = 0.9993; disc.inputs['From Max'].default_value = 0.9996
disc.inputs['To Min'].default_value = 0.0; disc.inputs['To Max'].default_value = 25.0; nt.links.new(dot.outputs['Value'], disc.inputs['Value'])
gl = nt.nodes.new('ShaderNodeMix'); gl.data_type = 'RGBA'; gl.blend_type = 'ADD'; nt.links.new(glow.outputs['Result'], gl.inputs['Factor'])
nt.links.new(grad.outputs['Color'], gl.inputs[6]); gl.inputs[7].default_value = (1.0, 0.7, 0.35, 1)
sd_ = nt.nodes.new('ShaderNodeMix'); sd_.data_type = 'RGBA'; sd_.blend_type = 'ADD'; nt.links.new(disc.outputs['Result'], sd_.inputs['Factor'])
nt.links.new(gl.outputs[2], sd_.inputs[6]); sd_.inputs[7].default_value = (1.0, 0.85, 0.6, 1)
bg = nt.nodes['Background']; nt.links.new(sd_.outputs[2], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
sund = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL))))
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.0; sun.color = (1.0, 0.66, 0.4); sun.angle = math.radians(0.8)
so = bpy.data.objects.new('sun', sun); so.rotation_euler = (-sund).to_track_quat('-Z', 'Y').to_euler(); sc.collection.objects.link(so)

# ---------- terrain: a ridged multifractal heightfield, sinking under the sea toward the camera ----------
bpy.ops.mesh.primitive_grid_add(x_subdivisions=500, y_subdivisions=500, size=24000, location=(0, -12500, 0))
ter = bpy.context.active_object
tex = bpy.data.textures.new('ridges', 'MUSGRAVE'); tex.musgrave_type = 'RIDGED_MULTIFRACTAL'
tex.noise_scale = 2600.0; tex.octaves = 6; tex.lacunarity = 2.0; tex.dimension_max = 1.1; tex.offset = 1.0; tex.gain = 2.0
tex.noise_basis = 'IMPROVED_PERLIN'
dm = ter.modifiers.new('ridges', 'DISPLACE'); dm.texture = tex; dm.strength = 1600; dm.mid_level = 0.42; dm.texture_coords = 'GLOBAL'
# a falloff so the near water is open sea and the range stands far off: a second, broad displacement downward near us
fall = bpy.data.textures.new('fall', 'BLEND'); fall.progression = 'LINEAR'
vg = ter.vertex_groups.new(name='far')
for v in ter.data.vertices:
    y = -12500 + v.co.y      # world y
    w = min(1.0, max(0.0, (-y - 3500) / 4000.0))
    vg.add([v.index], w, 'REPLACE')
dm.vertex_group = 'far'
sub = ter.modifiers.new('drop', 'DISPLACE'); sub.strength = -60; sub.mid_level = 0.0
m = bpy.data.materials.new('terrain'); m.use_nodes = True; n = m.node_tree; p = n.nodes['Principled BSDF']
geo = n.nodes.new('ShaderNodeNewGeometry'); sepP = n.nodes.new('ShaderNodeSeparateXYZ'); n.links.new(geo.outputs['Position'], sepP.inputs[0])
sepN = n.nodes.new('ShaderNodeSeparateXYZ'); n.links.new(geo.outputs['Normal'], sepN.inputs[0])
nz = n.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.004; nz.inputs['Detail'].default_value = 8.0
n.links.new(geo.outputs['Position'], nz.inputs['Vector'])
hmix = n.nodes.new('ShaderNodeMath'); hmix.operation = 'MULTIPLY_ADD'; hmix.inputs[1].default_value = 120.0
n.links.new(nz.outputs['Fac'], hmix.inputs[0]); n.links.new(sepP.outputs['Z'], hmix.inputs[2])
ramp = n.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
cr.elements[0].position = 0.0; cr.elements[0].color = (0.75, 0.68, 0.5, 1)            # beach
cr.elements[1].position = 1.0; cr.elements[1].color = (0.95, 0.95, 1.0, 1)            # snow
for pos, col in ((0.03, (0.14, 0.32, 0.05)), (0.25, (0.1, 0.22, 0.04)), (0.45, (0.26, 0.22, 0.18)), (0.78, (0.4, 0.37, 0.34)), (0.86, (0.92, 0.92, 0.97))):
    e = cr.elements.new(pos); e.color = (*col, 1)
mr = n.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 20.0; mr.inputs['From Max'].default_value = 1200.0
n.links.new(hmix.outputs[0], mr.inputs['Value']); n.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
steep = n.nodes.new('ShaderNodeMapRange'); steep.inputs['From Min'].default_value = 0.65; steep.inputs['From Max'].default_value = 0.85
steep.inputs['To Min'].default_value = 1.0; steep.inputs['To Max'].default_value = 0.0
n.links.new(sepN.outputs['Z'], steep.inputs['Value'])
rockmix = n.nodes.new('ShaderNodeMix'); rockmix.data_type = 'RGBA'; n.links.new(steep.outputs['Result'], rockmix.inputs['Factor'])
n.links.new(ramp.outputs['Color'], rockmix.inputs[6]); rockmix.inputs[7].default_value = (0.3, 0.26, 0.22, 1)
n.links.new(rockmix.outputs[2], p.inputs['Base Color']); p.inputs['Roughness'].default_value = 0.85
ter.data.materials.append(m)
bpy.ops.object.shade_smooth()

# ---------- the sea: glassy, a long swell ----------
bpy.ops.mesh.primitive_plane_add(size=60000, location=(0, 0, 0)); sea = bpy.context.active_object
ms = bpy.data.materials.new('sea'); ms.use_nodes = True; ns = ms.node_tree; ps = ns.nodes['Principled BSDF']
ps.inputs['Base Color'].default_value = (0.005, 0.03, 0.045, 1); ps.inputs['Roughness'].default_value = 0.03
tcs = ns.nodes.new('ShaderNodeTexCoord'); wv = ns.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 0.0015
wv.inputs['Distortion'].default_value = 4.0; wv.inputs['Detail'].default_value = 6.0
ns.links.new(tcs.outputs['Object'], wv.inputs['Vector'])
bmp = ns.nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = 0.12; ns.links.new(wv.outputs['Fac'], bmp.inputs['Height'])
ns.links.new(bmp.outputs['Normal'], ps.inputs['Normal']); sea.data.materials.append(ms)

# ---------- a deck of sunset cloud, and haze ----------
def volume_box(name, loc, size, density, color, noise_scale, lo, hi, aniso=0.6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name; o.scale = size
    mv = bpy.data.materials.new(name); mv.use_nodes = True; nv = mv.node_tree; nv.nodes.remove(nv.nodes['Principled BSDF'])
    vol = nv.nodes.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (*color, 1); vol.inputs['Anisotropy'].default_value = aniso
    if noise_scale:
        tc = nv.nodes.new('ShaderNodeTexCoord'); nzv = nv.nodes.new('ShaderNodeTexNoise'); nzv.inputs['Scale'].default_value = noise_scale
        nzv.inputs['Detail'].default_value = 7.0; nzv.inputs['Roughness'].default_value = 0.62; nv.links.new(tc.outputs['Object'], nzv.inputs['Vector'])
        # thin out toward the slab's top and bottom so the deck has a soft base and a lumpy top
        sep = nv.nodes.new('ShaderNodeSeparateXYZ'); nv.links.new(tc.outputs['Object'], sep.inputs[0])
        ab = nv.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; nv.links.new(sep.outputs['Z'], ab.inputs[0])
        edge = nv.nodes.new('ShaderNodeMapRange'); edge.inputs['From Min'].default_value = 0.2; edge.inputs['From Max'].default_value = 0.5
        edge.inputs['To Min'].default_value = 0.0; edge.inputs['To Max'].default_value = 0.35; nv.links.new(ab.outputs[0], edge.inputs['Value'])
        sub_ = nv.nodes.new('ShaderNodeMath'); sub_.operation = 'SUBTRACT'; nv.links.new(nzv.outputs['Fac'], sub_.inputs[0]); nv.links.new(edge.outputs['Result'], sub_.inputs[1])
        dmr = nv.nodes.new('ShaderNodeMapRange'); dmr.inputs['From Min'].default_value = lo; dmr.inputs['From Max'].default_value = hi
        dmr.inputs['To Min'].default_value = 0.0; dmr.inputs['To Max'].default_value = density
        nv.links.new(sub_.outputs[0], dmr.inputs['Value']); nv.links.new(dmr.outputs['Result'], vol.inputs['Density'])
    else:
        vol.inputs['Density'].default_value = density
    nv.links.new(vol.outputs[0], nv.nodes['Material Output'].inputs['Volume']); o.data.materials.append(mv); return o
def cloud_layer(z, size, scale, cover, tint, strength, loc=(0, -9000)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(loc[0], loc[1], z)); o = bpy.context.active_object; o.scale = (size, size, 1)
    mc_ = bpy.data.materials.new('clouds'); mc_.use_nodes = True; n_ = mc_.node_tree; n_.nodes.remove(n_.nodes['Principled BSDF'])
    tc_ = n_.nodes.new('ShaderNodeTexCoord'); nz_ = n_.nodes.new('ShaderNodeTexNoise'); nz_.inputs['Scale'].default_value = scale
    nz_.inputs['Detail'].default_value = 9.0; nz_.inputs['Roughness'].default_value = 0.6; n_.links.new(tc_.outputs['Object'], nz_.inputs['Vector'])
    al = n_.nodes.new('ShaderNodeMapRange'); al.inputs['From Min'].default_value = 1.0 - cover; al.inputs['From Max'].default_value = 1.0 - cover + 0.18
    n_.links.new(nz_.outputs['Fac'], al.inputs['Value'])
    em = n_.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*tint, 1); em.inputs['Strength'].default_value = strength
    # a little shading: darker where the noise is thinnest, as if lit from below by the sun
    sh = n_.nodes.new('ShaderNodeMapRange'); sh.inputs['From Min'].default_value = 1.0 - cover; sh.inputs['From Max'].default_value = 1.0
    sh.inputs['To Min'].default_value = 1.2; sh.inputs['To Max'].default_value = 0.45; n_.links.new(nz_.outputs['Fac'], sh.inputs['Value'])
    n_.links.new(sh.outputs['Result'], em.inputs['Strength'])
    tr = n_.nodes.new('ShaderNodeBsdfTransparent'); mx = n_.nodes.new('ShaderNodeMixShader')
    n_.links.new(al.outputs['Result'], mx.inputs['Fac']); n_.links.new(tr.outputs[0], mx.inputs[1]); n_.links.new(em.outputs[0], mx.inputs[2])
    n_.links.new(mx.outputs[0], n_.nodes['Material Output'].inputs['Surface']); o.data.materials.append(mc_)
    o.visible_shadow = False
    return o
cloud_layer(2600, 60000, 14.0, 0.45, (1.0, 0.72, 0.58), 1.0)
cloud_layer(1500, 50000, 22.0, 0.32, (1.0, 0.62, 0.48), 1.1)

# ---------- the Line: a slender rail climbing away on pylons, and the train on it ----------
M_RAIL = bpy.data.materials.new('rail'); M_RAIL.use_nodes = True; pr = M_RAIL.node_tree.nodes['Principled BSDF']
pr.inputs['Base Color'].default_value = (0.04, 0.035, 0.03, 1); pr.inputs['Metallic'].default_value = 0.8; pr.inputs['Roughness'].default_value = 0.3
def tube(name, pts, r):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 3
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for i, q in enumerate(pts): sp.points[i].co = (*q, 1)
    o = bpy.data.objects.new(name, cu); o.data.materials.append(M_RAIL); sc.collection.objects.link(o)
path = [Vector((-260 + 2400 * t, -600 - 5200 * t, H - 30 + 2300 * t ** 2.4)) for t in [k / 80 for k in range(81)]]
tube('line', path, 2.2)
for k in range(0, 81, 4):
    q = path[k]; tube(f'pylon{k}', [q, Vector((q.x, q.y, -5))], 1.4)
mc = bpy.data.materials.new('car'); mc.use_nodes = True; pc = mc.node_tree.nodes['Principled BSDF']
pc.inputs['Base Color'].default_value = (0.15, 0.04, 0.03, 1); pc.inputs['Metallic'].default_value = 0.5; pc.inputs['Roughness'].default_value = 0.3
pc.inputs['Emission Color'].default_value = (1, 0.75, 0.4, 1); pc.inputs['Emission Strength'].default_value = 3.0
for k in range(12):
    q, r_ = path[30 - k], path[31 - k]
    bpy.ops.mesh.primitive_cube_add(size=1, location=q + Vector((0, 0, 5))); c = bpy.context.active_object
    c.scale = (5.5, 5.5, 5.5 - 0.15 * k); c.rotation_mode = 'QUATERNION'; c.rotation_quaternion = Vector((1, 0, 0)).rotation_difference((r_ - q).normalized())
    c.data.materials.append(mc)
bpy.ops.mesh.primitive_uv_sphere_add(radius=10, location=path[32] + Vector((0, 0, 8))); hd = bpy.context.active_object
hd.scale = (1.4, 1.0, 1.0); hd.data.materials.append(mc); bpy.ops.object.shade_smooth()

def cam(name, loc, tgt, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_end = 80000
    o = bpy.data.objects.new(name, cd); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); return o
sc.camera = cam('view', (0, 0, H), (300, -10000, H + 350), 24)
sc.render.filepath = f'{OUT}-view.png'; bpy.ops.render.render(write_still=True)
print('DONE')
