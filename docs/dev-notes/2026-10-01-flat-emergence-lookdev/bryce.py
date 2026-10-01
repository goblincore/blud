# A Bryce scene after the owner's reference: a banded gas giant and two floating moons in a blue sky with streaky stratus,
# jagged fractal mountains in haze, a spiky rock arch, milky turquoise water with bump-mapped rock and boulders breaking
# through. Haze is done as Bryce did it: every landscape material mixes to a haze colour by view distance.
# Run: blender -b --factory-startup --python bryce.py -- OUT.png
import bpy, math, os, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/bryce.png'
random.seed(9)
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
sc.cycles.samples = 16 if os.environ.get('PREVIEW') else 96; sc.cycles.use_denoising = True; sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 1
import os
PREVIEW = bool(os.environ.get('PREVIEW'))
sc.render.resolution_x, sc.render.resolution_y = (400, 300) if PREVIEW else (1024, 768)
sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = -0.35

HAZE = (0.42, 0.52, 0.66)
FOG = (0.6, 0.71, 0.74)          # milky, a touch of the water's cyan
FOG_TOP, FOG_DIST = 15.0, 700.0

def nodes(m): return m.node_tree.nodes, m.node_tree.links

def hazed(m, color=HAZE, dist=2500.0, strength=1.0):
    """Wrap a material's surface: mix toward an emissive haze colour with view distance, as Bryce did."""
    n, l = nodes(m); out = n['Material Output']
    surf = out.inputs['Surface'].links[0].from_socket
    cam = n.new('ShaderNodeCameraData')
    div = n.new('ShaderNodeMath'); div.operation = 'DIVIDE'; l.new(cam.outputs['View Distance'], div.inputs[0]); div.inputs[1].default_value = dist
    neg = n.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; l.new(div.outputs[0], neg.inputs[0]); neg.inputs[1].default_value = -1.0
    ex = n.new('ShaderNodeMath'); ex.operation = 'EXPONENT'; l.new(neg.outputs[0], ex.inputs[0])
    fac = n.new('ShaderNodeMath'); fac.operation = 'SUBTRACT'; fac.inputs[0].default_value = 1.0; l.new(ex.outputs[0], fac.inputs[1])
    em = n.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*color, 1); em.inputs['Strength'].default_value = strength
    mx = n.new('ShaderNodeMixShader'); l.new(fac.outputs[0], mx.inputs['Fac']); l.new(surf, mx.inputs[1]); l.new(em.outputs[0], mx.inputs[2])
    # the ground fog: thick at the water, gone by FOG_TOP, and thicker with distance
    geo = n.new('ShaderNodeNewGeometry'); sz = n.new('ShaderNodeSeparateXYZ'); l.new(geo.outputs['Position'], sz.inputs[0])
    hz = n.new('ShaderNodeMapRange'); hz.interpolation_type = 'SMOOTHSTEP'; hz.inputs['From Min'].default_value = FOG_TOP; hz.inputs['From Max'].default_value = 3.0
    l.new(sz.outputs['Z'], hz.inputs['Value'])
    fd = n.new('ShaderNodeMath'); fd.operation = 'DIVIDE'; l.new(cam.outputs['View Distance'], fd.inputs[0]); fd.inputs[1].default_value = FOG_DIST
    fn = n.new('ShaderNodeMath'); fn.operation = 'MULTIPLY'; l.new(fd.outputs[0], fn.inputs[0]); fn.inputs[1].default_value = -1.0
    fe = n.new('ShaderNodeMath'); fe.operation = 'EXPONENT'; l.new(fn.outputs[0], fe.inputs[0])
    fdist = n.new('ShaderNodeMath'); fdist.operation = 'SUBTRACT'; fdist.inputs[0].default_value = 1.0; l.new(fe.outputs[0], fdist.inputs[1])
    ffac = n.new('ShaderNodeMath'); ffac.operation = 'MULTIPLY'; l.new(hz.outputs['Result'], ffac.inputs[0]); l.new(fdist.outputs[0], ffac.inputs[1])
    # a little noise so the fog lies in banks rather than a sheet
    tcf = n.new('ShaderNodeTexCoord'); nzf = n.new('ShaderNodeTexNoise'); nzf.inputs['Scale'].default_value = 0.004; nzf.inputs['Detail'].default_value = 4
    l.new(tcf.outputs['Object'], nzf.inputs['Vector']) if False else l.new(geo.outputs['Position'], nzf.inputs['Vector'])
    bank = n.new('ShaderNodeMapRange'); bank.inputs['From Min'].default_value = 0.3; bank.inputs['From Max'].default_value = 0.7
    bank.inputs['To Min'].default_value = 0.55; bank.inputs['To Max'].default_value = 1.0; l.new(nzf.outputs['Fac'], bank.inputs['Value'])
    ffac2 = n.new('ShaderNodeMath'); ffac2.operation = 'MULTIPLY'; ffac2.use_clamp = True; l.new(ffac.outputs[0], ffac2.inputs[0]); l.new(bank.outputs['Result'], ffac2.inputs[1])
    fem = n.new('ShaderNodeEmission'); fem.inputs['Color'].default_value = (*FOG, 1); fem.inputs['Strength'].default_value = 1.0
    fmx = n.new('ShaderNodeMixShader'); l.new(ffac2.outputs[0], fmx.inputs['Fac']); l.new(mx.outputs[0], fmx.inputs[1]); l.new(fem.outputs[0], fmx.inputs[2])
    l.new(fmx.outputs[0], out.inputs['Surface'])
    return m

def rock(name, c0, c1, scale=0.08, bump=1.2, rough=0.75):
    m = bpy.data.materials.new(name); m.use_nodes = True; n, l = nodes(m); p = n['Principled BSDF']
    tc = n.new('ShaderNodeTexCoord')
    nz = n.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 12.0; nz.inputs['Roughness'].default_value = 0.7
    l.new(tc.outputs['Object'], nz.inputs['Vector'])
    vo = n.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = scale * 6; l.new(tc.outputs['Object'], vo.inputs['Vector'])
    mix = n.new('ShaderNodeMix'); mix.data_type = 'RGBA'; l.new(nz.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs[6].default_value = (*c0, 1); mix.inputs[7].default_value = (*c1, 1); l.new(mix.outputs[2], p.inputs['Base Color'])
    h = n.new('ShaderNodeMath'); h.operation = 'ADD'; l.new(nz.outputs['Fac'], h.inputs[0]); l.new(vo.outputs['Distance'], h.inputs[1])
    b = n.new('ShaderNodeBump'); b.inputs['Strength'].default_value = bump; b.inputs['Distance'].default_value = 1.0
    l.new(h.outputs[0], b.inputs['Height']); l.new(b.outputs['Normal'], p.inputs['Normal']); p.inputs['Roughness'].default_value = rough
    return m

# ---------- sky: a blue gradient, a few stars, the sun ----------
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True; nt = world.node_tree
tcw = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tcw.outputs['Generated'], sep.inputs[0])
gr = nt.nodes.new('ShaderNodeValToRGB'); g = gr.color_ramp
g.elements[0].position = 0.0; g.elements[0].color = (0.68, 0.8, 0.8, 1); g.elements[1].position = 0.5; g.elements[1].color = (0.01, 0.025, 0.09, 1)
e = g.elements.new(0.05); e.color = (0.45, 0.58, 0.68, 1)
e = g.elements.new(0.2); e.color = (0.12, 0.22, 0.42, 1)
nt.links.new(sep.outputs['Z'], gr.inputs['Fac'])
st = nt.nodes.new('ShaderNodeTexVoronoi'); st.inputs['Scale'].default_value = 260.0; nt.links.new(tcw.outputs['Generated'], st.inputs['Vector'])
sm = nt.nodes.new('ShaderNodeMapRange'); sm.inputs['From Min'].default_value = 0.035; sm.inputs['From Max'].default_value = 0.0
sm.inputs['To Min'].default_value = 0.0; sm.inputs['To Max'].default_value = 3.0; nt.links.new(st.outputs['Distance'], sm.inputs['Value'])
up = nt.nodes.new('ShaderNodeMath'); up.operation = 'MULTIPLY'; nt.links.new(sm.outputs['Result'], up.inputs[0]); nt.links.new(sep.outputs['Z'], up.inputs[1])
add = nt.nodes.new('ShaderNodeMix'); add.data_type = 'RGBA'; add.blend_type = 'ADD'; nt.links.new(up.outputs[0], add.inputs['Factor'])
nt.links.new(gr.outputs['Color'], add.inputs[6]); add.inputs[7].default_value = (1, 1, 1, 1)
bg = nt.nodes['Background']; nt.links.new(add.outputs[2], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 5.0; sun.color = (1.0, 0.86, 0.68); sun.angle = math.radians(1.0)
so = bpy.data.objects.new('sun', sun); so.rotation_euler = (math.radians(78), 0, math.radians(-60)); sc.collection.objects.link(so)

# ---------- the gas giant and the moons ----------
bpy.ops.mesh.primitive_uv_sphere_add(radius=9000, location=(-14000, 30000, 6000), segments=96, ring_count=64); pl = bpy.context.active_object
pl.rotation_euler = (math.radians(15), math.radians(-25), 0)
mp = bpy.data.materials.new('planet'); mp.use_nodes = True; n, l = nodes(mp); n.remove(n['Principled BSDF'])
tc = n.new('ShaderNodeTexCoord'); wv = n.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'Z'
wv.inputs['Scale'].default_value = 3.0; wv.inputs['Distortion'].default_value = 9.0; wv.inputs['Detail'].default_value = 8.0; wv.inputs['Detail Scale'].default_value = 2.5
l.new(tc.outputs['Object'], wv.inputs['Vector'])
rp = n.new('ShaderNodeValToRGB'); r = rp.color_ramp
r.elements[0].color = (0.55, 0.25, 0.45, 1); r.elements[1].color = (0.92, 0.82, 0.9, 1)
e = r.elements.new(0.35); e.color = (0.85, 0.22, 0.3, 1); e = r.elements.new(0.55); e.color = (0.95, 0.6, 0.62, 1); e = r.elements.new(0.75); e.color = (0.45, 0.42, 0.75, 1)
l.new(wv.outputs['Fac'], rp.inputs['Fac'])
lw = n.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
rim = n.new('ShaderNodeMix'); rim.data_type = 'RGBA'; l.new(lw.outputs['Facing'], rim.inputs['Factor'])
l.new(rp.outputs['Color'], rim.inputs[6]); rim.inputs[7].default_value = (0.62, 0.72, 0.9, 1)
em = n.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.75; l.new(rim.outputs[2], em.inputs['Color'])
tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader'); mx.inputs['Fac'].default_value = 0.94
l.new(tr.outputs[0], mx.inputs[1]); l.new(em.outputs[0], mx.inputs[2]); l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
pl.data.materials.append(mp); bpy.ops.object.shade_smooth()
M_MOON = rock('moon', (0.12, 0.11, 0.1), (0.42, 0.4, 0.38), scale=0.03, bump=1.2)
for k, (loc, rad) in enumerate((((-1500, 9000, 2300), 260), ((1800, 7000, 2500), 200))):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=rad, location=loc, subdivisions=5); mo = bpy.context.active_object
    dmm = mo.modifiers.new('d', 'DISPLACE'); tx = bpy.data.textures.new(f'mn{k}', 'CLOUDS'); tx.noise_scale = 0.4; dmm.texture = tx; dmm.strength = rad * 0.12
    mo.data.materials.append(M_MOON); bpy.ops.object.shade_smooth()

# ---------- streaky stratus: a flat layer, the noise stretched along one axis ----------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 8000, 2600)); cl = bpy.context.active_object; cl.scale = (60000, 40000, 1)
mc = bpy.data.materials.new('stratus'); mc.use_nodes = True; n, l = nodes(mc); n.remove(n['Principled BSDF'])
tc = n.new('ShaderNodeTexCoord'); mp_ = n.new('ShaderNodeMapping'); mp_.inputs['Scale'].default_value = (14.0, 3.5, 1.0)
mp_.inputs['Rotation'].default_value = (0, 0, math.radians(12)); l.new(tc.outputs['Object'], mp_.inputs['Vector'])
nz = n.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.0; nz.inputs['Detail'].default_value = 10.0; nz.inputs['Roughness'].default_value = 0.62
nz.inputs['Distortion'].default_value = 0.6; l.new(mp_.outputs[0], nz.inputs['Vector'])
al = n.new('ShaderNodeMapRange'); al.inputs['From Min'].default_value = 0.42; al.inputs['From Max'].default_value = 0.66; l.new(nz.outputs['Fac'], al.inputs['Value'])
em = n.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.82, 0.86, 0.95, 1)
sh = n.new('ShaderNodeMapRange'); sh.inputs['From Min'].default_value = 0.45; sh.inputs['From Max'].default_value = 0.8; sh.inputs['To Min'].default_value = 0.25; sh.inputs['To Max'].default_value = 0.95
l.new(nz.outputs['Fac'], sh.inputs['Value']); l.new(sh.outputs['Result'], em.inputs['Strength'])
tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader'); l.new(al.outputs['Result'], mx.inputs['Fac'])
l.new(tr.outputs[0], mx.inputs[1]); l.new(em.outputs[0], mx.inputs[2]); l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
cl.data.materials.append(mc); cl.visible_shadow = False

# ---------- terrain: the near rocky shelf and the far jagged range (ridged multifractal, km-scale noise) ----------
def terrain(name, loc, size, subdiv, noise_scale, strength, mid, mat, kind='RIDGED_MULTIFRACTAL', octaves=7, gain=2.0):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=subdiv, y_subdivisions=subdiv, size=size, location=loc); o = bpy.context.active_object; o.name = name
    tx = bpy.data.textures.new(name, 'MUSGRAVE'); tx.musgrave_type = kind; tx.noise_scale = noise_scale; tx.octaves = octaves
    tx.lacunarity = 2.0; tx.dimension_max = 1.0; tx.offset = 1.0; tx.gain = gain; tx.noise_basis = 'IMPROVED_PERLIN'
    dmm = o.modifiers.new('d', 'DISPLACE'); dmm.texture = tx; dmm.strength = strength; dmm.mid_level = mid; dmm.texture_coords = 'GLOBAL'
    o.data.materials.append(mat); bpy.ops.object.shade_smooth(); return o
M_FAR = hazed(rock('far', (0.12, 0.14, 0.2), (0.4, 0.42, 0.5), scale=0.004, bump=0.6), dist=14000.0, color=(0.5, 0.62, 0.84))
M_NEAR = hazed(rock('near', (0.09, 0.07, 0.05), (0.42, 0.34, 0.25), scale=0.06, bump=1.8), dist=6000.0)
terrain('range', (0, 15500, 0), 20000, 400, 1600.0, 900, 1.2, M_FAR)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=420, y_subdivisions=420, size=3600, location=(0, 1200, 0)); shelf = bpy.context.active_object; shelf.name = 'shelf'
_tx = bpy.data.textures.new('shelfn', 'CLOUDS'); _tx.noise_scale = 70.0; _tx.noise_depth = 6; _tx.noise_basis = 'IMPROVED_PERLIN'
_d = shelf.modifiers.new('d', 'DISPLACE'); _d.texture = _tx; _d.strength = 46; _d.mid_level = 0.43; _d.texture_coords = 'GLOBAL'
shelf.data.materials.append(M_NEAR); bpy.ops.object.shade_smooth()

# ---------- the arch: an upright torus, roughened, with spikes along its back ----------
M_ARCH = hazed(rock('arch', (0.1, 0.09, 0.08), (0.32, 0.29, 0.25), scale=0.05, bump=1.4), dist=6000.0)
bpy.ops.mesh.primitive_torus_add(major_radius=95, minor_radius=34, major_segments=96, minor_segments=32, location=(330, 1050, 40),
                                 rotation=(math.radians(90), 0, math.radians(-12)))
ar = bpy.context.active_object; ar.scale = (1.15, 1.0, 1.0)
dmm = ar.modifiers.new('d', 'DISPLACE'); tx = bpy.data.textures.new('archn', 'MUSGRAVE'); tx.musgrave_type = 'RIDGED_MULTIFRACTAL'; tx.noise_scale = 0.35
dmm.texture = tx; dmm.strength = 20; ar.data.materials.append(M_ARCH); bpy.ops.object.shade_smooth()
for k in range(26):
    a = math.radians(15 + 150 * k / 25 + random.uniform(-3, 3))
    base = Vector((330 + math.cos(a) * 128 * 1.15 * math.cos(math.radians(-12)), 1050 + math.cos(a) * 128 * math.sin(math.radians(-12)), 40 + math.sin(a) * 128))
    tip = base + Vector((math.cos(a), 0, math.sin(a))) * random.uniform(15, 45) + Vector((0, 0, random.uniform(5, 25)))
    bpy.ops.mesh.primitive_cone_add(radius1=random.uniform(6, 12), radius2=0, depth=(tip - base).length, location=(base + tip) / 2, vertices=8)
    sp = bpy.context.active_object; sp.rotation_mode = 'QUATERNION'; sp.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((tip - base).normalized())
    sp.data.materials.append(M_ARCH)

# ---------- milky water, with boulders breaking through ----------
bpy.ops.mesh.primitive_plane_add(size=40000, location=(0, 0, 4.0)); wt = bpy.context.active_object
mw = bpy.data.materials.new('milk'); mw.use_nodes = True; n, l = nodes(mw); p = n['Principled BSDF']
p.inputs['Base Color'].default_value = (0.4, 0.66, 0.66, 1); p.inputs['Roughness'].default_value = 0.3; p.inputs['Coat Weight'].default_value = 0.3
p.inputs['Subsurface Weight'].default_value = 0.4; p.inputs['Subsurface Radius'].default_value = (0.6, 1.0, 1.0)
tc = n.new('ShaderNodeTexCoord'); nzw = n.new('ShaderNodeTexNoise'); nzw.inputs['Scale'].default_value = 0.08; nzw.inputs['Detail'].default_value = 8
l.new(tc.outputs['Object'], nzw.inputs['Vector'])
bw = n.new('ShaderNodeBump'); bw.inputs['Strength'].default_value = 0.35; l.new(nzw.outputs['Fac'], bw.inputs['Height']); l.new(bw.outputs['Normal'], p.inputs['Normal'])
wt.data.materials.append(hazed(mw, dist=5000.0))
M_BOULDER = hazed(rock('boulder', (0.14, 0.11, 0.08), (0.48, 0.4, 0.3), scale=0.25, bump=1.0), dist=6000.0)
for k, (x, y, rad) in enumerate(((-60, 120, 16), (25, 175, 10), (95, 140, 9), (150, 260, 13), (-130, 330, 12), (60, 420, 8), (-30, 230, 6))):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=rad, location=(x, y, 4 + rad * 0.15), subdivisions=4); b = bpy.context.active_object
    b.scale = (1.25, 1.0, 0.7)
    dmm = b.modifiers.new('d', 'DISPLACE'); tx = bpy.data.textures.new(f'bn{k}', 'CLOUDS'); tx.noise_scale = 0.6; dmm.texture = tx; dmm.strength = rad * 0.25
    b.data.materials.append(M_BOULDER); bpy.ops.object.shade_smooth()

dg = bpy.context.evaluated_depsgraph_get()
for nm in ('range', 'shelf'):
    o = bpy.data.objects[nm].evaluated_get(dg); me = o.to_mesh(); zs = [v.co.z for v in me.vertices]
    print('BOUNDS', nm, round(min(zs), 1), round(max(zs), 1), round(sorted(zs)[len(zs) // 2], 1)); o.to_mesh_clear()
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 1400, 9)); wisp = bpy.context.active_object; wisp.scale = (5000, 2600, 12)
mv = bpy.data.materials.new('wisps'); mv.use_nodes = True; nv = mv.node_tree; nv.nodes.remove(nv.nodes['Principled BSDF'])
vol = nv.nodes.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (*FOG, 1); vol.inputs['Anisotropy'].default_value = 0.3
geo = nv.nodes.new('ShaderNodeNewGeometry'); mpw = nv.nodes.new('ShaderNodeMapping'); mpw.inputs['Scale'].default_value = (0.008, 0.02, 0.15)
nv.links.new(geo.outputs['Position'], mpw.inputs['Vector'])
nzv = nv.nodes.new('ShaderNodeTexNoise'); nzv.inputs['Scale'].default_value = 1.0; nzv.inputs['Detail'].default_value = 5; nv.links.new(mpw.outputs[0], nzv.inputs['Vector'])
sepv = nv.nodes.new('ShaderNodeSeparateXYZ'); nv.links.new(geo.outputs['Position'], sepv.inputs[0])
hfall = nv.nodes.new('ShaderNodeMapRange'); hfall.inputs['From Min'].default_value = 3.0; hfall.inputs['From Max'].default_value = 14.0
hfall.inputs['To Min'].default_value = 1.0; hfall.inputs['To Max'].default_value = 0.0; nv.links.new(sepv.outputs['Z'], hfall.inputs['Value'])
dn = nv.nodes.new('ShaderNodeMapRange'); dn.inputs['From Min'].default_value = 0.42; dn.inputs['From Max'].default_value = 0.7
dn.inputs['To Min'].default_value = 0.0; dn.inputs['To Max'].default_value = 0.05; nv.links.new(nzv.outputs['Fac'], dn.inputs['Value'])
dmul = nv.nodes.new('ShaderNodeMath'); dmul.operation = 'MULTIPLY'; nv.links.new(dn.outputs['Result'], dmul.inputs[0]); nv.links.new(hfall.outputs['Result'], dmul.inputs[1])
nv.links.new(dmul.outputs[0], vol.inputs['Density']); nv.links.new(vol.outputs[0], nv.nodes['Material Output'].inputs['Volume']); wisp.data.materials.append(mv)
sc.cycles.volume_step_rate = 2.0; sc.cycles.volume_bounces = 0
cd = bpy.data.cameras.new('c'); cd.lens = 26; cd.clip_end = 100000
cam = bpy.data.objects.new('c', cd); cam.location = (0, -40, 30); sc.collection.objects.link(cam)
cam.rotation_euler = (Vector((40, 1500, 110)) - cam.location).to_track_quat('-Z', 'Y').to_euler(); sc.camera = cam
sc.render.filepath = OUT; bpy.ops.render.render(write_still=True)
print('DONE')
