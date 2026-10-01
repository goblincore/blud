# The Flat + the screen emergence: blockout and animatic key frames (Cycles).
# Run: blender --background --factory-startup --python flat_lookdev.py -- OUTDIR SCREEN_IMAGE [frame ...]
# Env: GOBLIN_DIR (the PLYs and bones JSON from blob-mesh.ts / blob-bones.ts), RT94=1 (a 90s ray tracer: direct light only,
# hard shadows, clipped highlights), KIT=1 (the goblin's armour kit posed to the same bones), CLIP=1 (the clip frames),
# SAMPLES, RES_X, RES_Y.
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Quaternion, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/flat'
IMG = argv[1] if len(argv) > 1 else ''
FRAMES = argv[2:] or ['f1_screen', 'f2_over', 'f3_wide', 'f4_bulge', 'f5_stretch', 'f6_crown', 'f7_out', 'f8_settle']
RES = (int(os.environ.get('RES_X', '640')), int(os.environ.get('RES_Y', '480')))
if os.environ.get('CLIP'): FRAMES = []
SAMPLES = int(os.environ.get('SAMPLES', '96'))
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
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8; sc.cycles.transmission_bounces = 8; sc.cycles.transparent_max_bounces = 12
sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
RT94 = bool(os.environ.get('RT94'))
if RT94:
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.view_settings.exposure = 0.4
    sc.cycles.diffuse_bounces = 0; sc.cycles.glossy_bounces = 3; sc.cycles.volume_bounces = 0
    sc.cycles.filter_width = 0.6
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.03, 0.035, 1) if RT94 else (0.004, 0.005, 0.008, 1)

# ---------- helpers ----------
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')

def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'): setattr(n, k[1:], v)
        else: n.inputs[k].default_value = v
    return n

def link(nt, a, b): nt.links.new(a, b)

def sock(n, name, out=False):
    for s in (n.outputs if out else n.inputs):
        if s.name == name and s.enabled: return s
    raise KeyError(name)

def mix_rgb(nt, fac, a, b):
    n = nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'
    for src, dst in ((fac, sock(n, 'Factor')), (a, sock(n, 'A')), (b, sock(n, 'B'))):
        if isinstance(src, (int, float, tuple)): dst.default_value = src
        else: link(nt, src, dst)
    return sock(n, 'Result', out=True)

def mulf(nt, a, b):
    n = node(nt, 'ShaderNodeMath', _operation='MULTIPLY')
    for s, v in ((n.inputs[0], a), (n.inputs[1], b)):
        if isinstance(v, float): s.default_value = v
        else: link(nt, v, s)
    return n.outputs[0]

def principled(name, color, rough=0.5, metal=0.0, coat=0.0, trans=0.0, ior=1.45, sss=0.0, noise_scale=0.0, noise_amt=0.0, emit=None, emit_str=0.0):
    m, nt, out = mat(name)
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': color, 'Roughness': rough, 'Metallic': metal,
        'Coat Weight': coat, 'Coat Roughness': 0.03, 'Transmission Weight': trans, 'IOR': ior,
        'Subsurface Weight': sss, 'Subsurface Radius': (1.0, 0.25, 0.12), 'Subsurface Scale': 0.02})
    if emit is not None:
        p.inputs['Emission Color'].default_value = emit; p.inputs['Emission Strength'].default_value = emit_str
    if noise_amt > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = node(nt, 'ShaderNodeTexNoise', Scale=noise_scale, Detail=8.0)
        link(nt, tc.outputs['Object'], nz.inputs['Vector'])
        dark = tuple(c * (1 - noise_amt) for c in color[:3]) + (1,)
        link(nt, mix_rgb(nt, nz.outputs['Fac'], dark, color), p.inputs['Base Color'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

def box(name, c, s, m, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object; o.name = name; o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3
        bpy.ops.object.shade_smooth()
    return o

def cyl(name, c, r, d, m, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=c, rotation=rot, vertices=verts)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m); bpy.ops.object.shade_smooth(); return o

def tube(name, pts, radii, material, res=6):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = res; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1); sp.use_endpoint_u = True; sp.order_u = min(4, len(pts))
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (p[0], p[1], p[2], 1.0); sp.points[i].radius = r
    ob = bpy.data.objects.new(name, cu); ob.data.materials.append(material); sc.collection.objects.link(ob)
    return ob

def gloop(name, a, b, sag, r_end, r_mid, material, n=9, bead=True):
    pts, rad = [], []
    for i in range(n):
        t = i / (n - 1); s = math.sin(t * math.pi)
        pts.append(a.lerp(b, t) + Vector((0, 0, -sag * s)))
        e = min(t, 1 - t) * 2
        rad.append(r_end + (r_mid - r_end) * min(1.0, e * 1.7))
    if bead: rad[n // 2] *= 2.0
    return tube(name, pts, rad, material)

def point_light(name, loc, energy, color, radius):
    radius = min(radius, 0.01) if RT94 else radius
    L = bpy.data.lights.new(name, 'POINT'); L.energy = energy; L.color = color; L.shadow_soft_size = radius
    o = bpy.data.objects.new(name, L); o.location = loc; sc.collection.objects.link(o); return o

def area_light(name, loc, rot, energy, color, size):
    size = min(size, 0.08) if RT94 else size
    L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = color; L.size = size
    o = bpy.data.objects.new(name, L); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o); return o

def camera(name, loc, target, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_width = 36
    o = bpy.data.objects.new(name, cd); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

def smax(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return max(a, b) + h * h * k * 0.25

# ---------- materials ----------
M_WALL = principled('wall', (0.30, 0.33, 0.27, 1), rough=0.85, noise_scale=3.0, noise_amt=0.45)
M_FLOOR = principled('floor', (0.20, 0.12, 0.07, 1), rough=0.35, coat=0.3, noise_scale=1.5, noise_amt=0.5)
M_CEIL = principled('ceil', (0.25, 0.25, 0.23, 1), rough=0.9, noise_scale=2.0, noise_amt=0.5)
M_BEIGE = principled('beige', (0.62, 0.56, 0.42, 1), rough=0.42, coat=0.25, noise_scale=8.0, noise_amt=0.12)
M_DARKPL = principled('darkplastic', (0.05, 0.05, 0.05, 1), rough=0.3, coat=0.4)
M_WOOD = principled('wood', (0.24, 0.13, 0.06, 1), rough=0.45, coat=0.4, noise_scale=6.0, noise_amt=0.35)
M_METAL = principled('pipe', (0.35, 0.18, 0.1, 1), rough=0.35, metal=0.9, noise_scale=5.0, noise_amt=0.5)
M_VINYL = principled('vinyl', (0.09, 0.04, 0.03, 1), rough=0.22, coat=0.7)
M_FABRIC = principled('mattress', (0.42, 0.38, 0.30, 1), rough=0.95, noise_scale=2.5, noise_amt=0.55)
M_LAMPSHADE = principled('lampshade', (0.05, 0.25, 0.1, 1), rough=0.25, metal=0.5, coat=0.6)
M_BULB = principled('bulb', (1, 0.85, 0.6, 1), emit=(1.0, 0.75, 0.45, 1), emit_str=12.0)
M_CAN = principled('can', (0.6, 0.05, 0.05, 1), rough=0.25, metal=0.8)
M_SKIN = principled('goblinskin', (0.20, 0.24, 0.13, 1), rough=0.42, coat=0.35, sss=0.25, noise_scale=12.0, noise_amt=0.35)
M_WINDOW = principled('window', (0.05, 0.06, 0.08, 1), rough=0.05, emit=(0.25, 0.32, 0.5, 1), emit_str=0.6)
M_CD = principled('cd', (0.02, 0.02, 0.025, 1), rough=0.15, coat=0.8)
M_MUCUS = principled('mucus', (0.9, 0.8, 0.58, 1), rough=0.02, coat=1.0, trans=0.15, ior=1.45, sss=0.7)
M_RIM = principled('rim', (0.62, 0.16, 0.14, 1), rough=0.25, coat=1.0, sss=0.6)
M_POOL = principled('pool', (0.55, 0.42, 0.22, 1), rough=0.02, coat=1.0, trans=0.5, ior=1.4)

def screen_material(thin_attr='thin'):
    """The CRT image as a membrane: the picture glows where the glass is whole; as it stretches it
    goes dim, pink and translucent (it was skin all along), lit from behind by whatever pushes."""
    m, nt, out = mat('screen')
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    tex = nt.nodes.new('ShaderNodeTexImage')
    if IMG:
        tex.image = bpy.data.images.load(IMG)
    link(nt, uv.outputs['UV'], tex.inputs['Vector'])
    # Scanlines and a phosphor grain over the picture.
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); link(nt, uv.outputs['UV'], sep.inputs[0])
    lines = node(nt, 'ShaderNodeMath', _operation='SINE'); link(nt, mulf(nt, sep.outputs['Y'], 900.0), lines.inputs[0])
    lm = node(nt, 'ShaderNodeMapRange', **{'From Min': -1.0, 'From Max': 1.0, 'To Min': 0.55, 'To Max': 1.0}); link(nt, lines.outputs[0], lm.inputs['Value'])
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = thin_attr
    thin = attr.outputs['Fac']
    keep = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.6, 'To Min': 1.0, 'To Max': 0.08}); link(nt, thin, keep.inputs['Value'])
    picture = mix_rgb(nt, 1.0, tex.outputs['Color'], (0, 0, 0, 1))
    em = node(nt, 'ShaderNodeEmission')
    pic = node(nt, 'ShaderNodeMix'); pic.data_type = 'RGBA'; pic.blend_type = 'MULTIPLY'; sock(pic, 'Factor').default_value = 1.0
    link(nt, tex.outputs['Color'], sock(pic, 'A')); link(nt, mulf(nt, lm.outputs['Result'], keep.outputs['Result']), sock(pic, 'B'))
    link(nt, sock(pic, 'Result', True), em.inputs['Color']); em.inputs['Strength'].default_value = 2.2
    # The membrane: wet glass/skin, a clear coat over a translucent pink that shows the egg behind.
    vz = node(nt, 'ShaderNodeTexNoise', Scale=9.0, Detail=3.0); link(nt, uv.outputs['UV'], vz.inputs['Vector'])
    vs = node(nt, 'ShaderNodeMath', _operation='SUBTRACT'); link(nt, vz.outputs['Fac'], vs.inputs[0]); vs.inputs[1].default_value = 0.5
    va = node(nt, 'ShaderNodeMath', _operation='ABSOLUTE'); link(nt, vs.outputs[0], va.inputs[0])
    vm = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.025, 'To Min': 1.0, 'To Max': 0.0}); link(nt, va.outputs[0], vm.inputs['Value'])
    fcol = mix_rgb(nt, vm.outputs['Result'], (0.75, 0.3, 0.26, 1), (0.3, 0.02, 0.03, 1))
    flesh = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.7, 0.25, 0.22, 1), 'Roughness': 0.35,
        'Coat Weight': 1.0, 'Coat Roughness': 0.015, 'Subsurface Weight': 0.6, 'Subsurface Radius': (1.0, 0.3, 0.15), 'Subsurface Scale': 0.01})
    link(nt, fcol, flesh.inputs['Base Color'])
    tr = node(nt, 'ShaderNodeBsdfTranslucent', Color=(1.0, 0.45, 0.32, 1))
    link(nt, mix_rgb(nt, vm.outputs['Result'], (1.0, 0.45, 0.32, 1), (0.25, 0.02, 0.02, 1)), tr.inputs['Color'])
    fm = nt.nodes.new('ShaderNodeMixShader'); fm.inputs['Fac'].default_value = 0.5
    link(nt, flesh.outputs[0], fm.inputs[1]); link(nt, tr.outputs[0], fm.inputs[2])
    glass = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.01, 0.01, 0.012, 1), 'Roughness': 0.03, 'Coat Weight': 1.0, 'Coat Roughness': 0.01})
    sm = nt.nodes.new('ShaderNodeMixShader'); link(nt, thin, sm.inputs['Fac']); link(nt, glass.outputs[0], sm.inputs[1]); link(nt, fm.outputs[0], sm.inputs[2])
    add = nt.nodes.new('ShaderNodeAddShader'); link(nt, em.outputs[0], add.inputs[0]); link(nt, sm.outputs[0], add.inputs[1])
    link(nt, add.outputs[0], out.inputs['Surface'])
    return m

def candled_egg():
    m, nt, out = mat('egg')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = node(nt, 'ShaderNodeTexNoise', Scale=30.0, Detail=10.0, Roughness=0.65); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.72, 0.6, 0.48, 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (1.0, 0.94, 0.86, 1)
    link(nt, nz.outputs['Fac'], ramp.inputs['Fac'])
    tint = node(nt, 'ShaderNodeMix'); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; sock(tint, 'Factor').default_value = 1.0
    link(nt, ramp.outputs['Color'], sock(tint, 'A')); sock(tint, 'B').default_value = (1.0, 0.7, 0.42, 1)
    vz = node(nt, 'ShaderNodeTexNoise', Scale=6.0, Detail=3.0); link(nt, tc.outputs['Object'], vz.inputs['Vector'])
    vs = node(nt, 'ShaderNodeMath', _operation='SUBTRACT'); link(nt, vz.outputs['Fac'], vs.inputs[0]); vs.inputs[1].default_value = 0.5
    va = node(nt, 'ShaderNodeMath', _operation='ABSOLUTE'); link(nt, vs.outputs[0], va.inputs[0])
    vm = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.02, 'To Min': 1.0, 'To Max': 0.0}); link(nt, va.outputs[0], vm.inputs['Value'])
    shell = mix_rgb(nt, vm.outputs['Result'], sock(tint, 'Result', True), (0.3, 0.02, 0.015, 1))
    trans = nt.nodes.new('ShaderNodeBsdfTranslucent'); link(nt, shell, trans.inputs['Color'])
    surf = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.3, **{'Coat Weight': 1.0, 'Coat Roughness': 0.02, 'Specular IOR Level': 0.7})
    link(nt, mix_rgb(nt, mulf(nt, vm.outputs['Result'], 0.6), ramp.outputs['Color'], (0.45, 0.08, 0.05, 1)), surf.inputs['Base Color'])
    mix = node(nt, 'ShaderNodeMixShader', Fac=0.42); link(nt, surf.outputs[0], mix.inputs[1]); link(nt, trans.outputs[0], mix.inputs[2])
    link(nt, mix.outputs[0], out.inputs['Surface'])
    return m

M_SCREEN = screen_material()
M_EGG = candled_egg()
M_VESSEL = principled('vessel', (0.4, 0.02, 0.015, 1), rough=0.5)

# ---------- the Flat (blockout): 4 x 5 m, 2.4 m ceiling; x east, y north, z up; the desk on the north wall ----------
W, D, H = 4.0, 5.0, 2.4
box('floor', (0, D / 2, -0.05), (W, D, 0.1), M_FLOOR)
box('ceiling', (0, D / 2, H + 0.05), (W, D, 0.1), M_CEIL)
box('wall_n', (0, D + 0.05, H / 2), (W, 0.1, H), M_WALL)
box('wall_s', (0, -0.05, H / 2), (W, 0.1, H), M_WALL)
box('wall_w', (-W / 2 - 0.05, D / 2, H / 2), (0.1, D, H), M_WALL)
box('wall_e', (W / 2 + 0.05, D / 2, H / 2), (0.1, D, H), M_WALL)
box('skirting', (0, D - 0.01, 0.06), (W, 0.03, 0.12), M_WOOD)
# The high window (only feet pass): a slot in the north wall west of the desk, glowing streetlight blue.
box('window', (-1.1, D - 0.005, 2.05), (0.9, 0.02, 0.35), M_WINDOW)
box('window_frame', (-1.1, D - 0.03, 2.05), (0.98, 0.04, 0.43), M_WOOD)
# Pipes under the ceiling, carrying the music.
for i, (x, r) in enumerate(((-1.5, 0.05), (-1.32, 0.035), (1.7, 0.06))):
    cyl(f'pipe{i}', (x, D / 2, H - 0.12 - i * 0.03), r, D, M_METAL, rot=(math.pi / 2, 0, 0))
cyl('pipe_x', (0, D - 0.15, H - 0.1), 0.045, W, M_METAL, rot=(0, math.pi / 2, 0))
# Door (south), mattress (north-west), CD shelf (west), bucket under a drip.
box('door', (1.2, 0.03, 1.0), (0.85, 0.06, 2.0), M_WOOD)
box('mattress', (-1.35, 3.6, 0.1), (1.1, 1.9, 0.2), M_FABRIC, bevel=0.05)
box('shelf', (-1.85, 1.9, 0.6), (0.25, 0.9, 1.2), M_WOOD)
for k in range(9):
    box(f'cd{k}', (-1.8, 1.55 + k * 0.025, 0.95), (0.13, 0.012, 0.14), M_CD)
cyl('bucket', (1.55, 2.2, 0.14), 0.13, 0.28, M_METAL)

# The desk: goblin-sized (top at 0.6 m), against the north wall.
DX, DY, DTOP = 0.55, 4.62, 0.6
box('desk_top', (DX, DY, DTOP - 0.02), (1.3, 0.62, 0.04), M_WOOD, bevel=0.005)
for sx in (-1, 1):
    box(f'desk_leg{sx}', (DX + sx * 0.6, DY, (DTOP - 0.04) / 2), (0.05, 0.56, DTOP - 0.04), M_WOOD)
# The CRT: a beige 15-inch monitor, screen facing south (-y).
CX, CZ = DX - 0.05, DTOP + 0.25           # screen centre x, z
CRT_FRONT = 4.47
SW, SH = 0.30, 0.225                     # visible screen
box('crt_body', (CX, CRT_FRONT + 0.03 + 0.22, CZ + 0.01), (0.44, 0.44, 0.42), M_BEIGE, bevel=0.02)
box('crt_tube', (CX, CRT_FRONT + 0.035, CZ), (SW + 0.01, 0.01, SH + 0.01), M_DARKPL)
box('crt_back', (CX, CRT_FRONT + 0.5, CZ), (0.32, 0.2, 0.3), M_BEIGE, bevel=0.03)
SCREEN_Y = CRT_FRONT + 0.028             # the glass, recessed behind the bezel's front
bez = 0.035
box('bezel_top', (CX, CRT_FRONT + 0.015, CZ + SH / 2 + bez / 2), (SW + 2 * bez, 0.03, bez), M_BEIGE, bevel=0.006)
box('bezel_bot', (CX, CRT_FRONT + 0.015, CZ - SH / 2 - bez / 2 - 0.01), (SW + 2 * bez, 0.03, bez + 0.02), M_BEIGE, bevel=0.006)
box('bezel_l', (CX - SW / 2 - bez / 2, CRT_FRONT + 0.015, CZ), (bez, 0.03, SH), M_BEIGE, bevel=0.006)
box('bezel_r', (CX + SW / 2 + bez / 2, CRT_FRONT + 0.015, CZ), (bez, 0.03, SH), M_BEIGE, bevel=0.006)
box('crt_stand', (CX, CRT_FRONT + 0.22, DTOP + 0.02), (0.26, 0.26, 0.04), M_BEIGE)
box('pc_tower', (DX + 0.48, DY + 0.05, DTOP + 0.2), (0.2, 0.44, 0.4), M_BEIGE, bevel=0.01)
box('pc_tray', (DX + 0.48, DY - 0.175, DTOP + 0.33), (0.15, 0.01, 0.03), M_DARKPL)
box('keyboard', (CX, 4.27, DTOP + 0.015), (0.42, 0.15, 0.03), M_BEIGE, bevel=0.004)
box('mouse', (CX + 0.3, 4.27, DTOP + 0.015), (0.06, 0.1, 0.03), M_BEIGE, bevel=0.01)
for k, (x, y) in enumerate(((DX - 0.5, 4.45), (DX - 0.42, 4.38), (DX + 0.32, 4.45))):
    cyl(f'can{k}', (x, y, DTOP + 0.06), 0.032, 0.12, M_CAN)
# The desk lamp (a green banker's lamp, low on the desk's west end), the room's warm light.
cyl('lamp_base', (DX - 0.5, 4.75, DTOP + 0.01), 0.07, 0.02, M_METAL)
cyl('lamp_stem', (DX - 0.5, 4.75, DTOP + 0.15), 0.01, 0.28, M_METAL)
cyl('lamp_shade', (DX - 0.5, 4.68, DTOP + 0.3), 0.07, 0.18, M_LAMPSHADE, rot=(math.pi / 2, 0, 0))
cyl('lamp_bulb', (DX - 0.5, 4.68, DTOP + 0.27), 0.02, 0.12, M_BULB, rot=(math.pi / 2, 0, 0))
point_light('lamp_light', (DX - 0.5, 4.66, DTOP + 0.23), 32.0, (1.0, 0.62, 0.32), 0.04)
# The chair: a tall office chair, too big for a goblin.
CHX, CHY = CX, 3.82
box('chair_seat', (CHX, CHY, 0.46), (0.5, 0.48, 0.08), M_VINYL, bevel=0.03)
box('chair_back', (CHX, CHY - 0.26, 0.66), (0.46, 0.07, 0.26), M_VINYL, bevel=0.03)
box('chair_spine', (CHX, CHY - 0.27, 0.52), (0.06, 0.04, 0.12), M_METAL)
cyl('chair_post', (CHX, CHY, 0.24), 0.03, 0.4, M_METAL)
for k in range(5):
    a = k / 5 * math.tau
    box(f'chair_foot{k}', (CHX + math.cos(a) * 0.17, CHY + math.sin(a) * 0.17, 0.04), (0.34 if k % 2 else 0.05, 0.05 if k % 2 else 0.34, 0.03), M_METAL)
# Room light: a cold streetlight from the high window, and the screen.
area_light('street', (-1.1, D - 0.08, 2.05), (math.radians(-125), 0, 0), 45.0, (0.45, 0.55, 0.8), 0.8)
area_light('fill', (0.0, 2.0, H - 0.05), (0, 0, 0), 18.0, (0.5, 0.45, 0.5), 2.5)
SCREEN_LIGHT = area_light('screen_light', (CX, CRT_FRONT - 0.01, CZ), (math.radians(-90), 0, 0), 4.0, (0.75, 0.7, 0.85), 0.28)

# ---------- the goblin (a metaball stand-in), seen from behind ----------
def capsule(mb, a, b, r):
    a, b = Vector(a), Vector(b)
    el = mb.elements.new(); el.type = 'CAPSULE'; el.co = (a + b) / 2; el.radius = r
    el.size_x = (b - a).length / 2
    el.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
    return el

def ball(mb, c, r, s=None):
    el = mb.elements.new(); el.co = c; el.radius = r
    if s:
        el.type = 'ELLIPSOID'; el.size_x, el.size_y, el.size_z = s
    return el

GOBLIN = []
M_SKIN2 = None
def skin():
    m, nt, out = mat('goblinskin2')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = node(nt, 'ShaderNodeTexNoise', Scale=14.0, Detail=8.0); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
    col = mix_rgb(nt, nz.outputs['Fac'], (0.05, 0.065, 0.03, 1), (0.16, 0.19, 0.09, 1))
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.4, **{'Coat Weight': 0.5, 'Coat Roughness': 0.08,
        'Subsurface Weight': 0.5, 'Subsurface Radius': (1.0, 0.3, 0.15), 'Subsurface Scale': 0.03})
    link(nt, col, p.inputs['Base Color'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.12, Distance=0.004); vo = node(nt, 'ShaderNodeTexVoronoi', Scale=140.0)
    link(nt, tc.outputs['Object'], vo.inputs['Vector']); link(nt, vo.outputs['Distance'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], p.inputs['Normal'])
    tr = node(nt, 'ShaderNodeBsdfTranslucent', Color=(0.8, 0.12, 0.05, 1))
    mx = node(nt, 'ShaderNodeMixShader', Fac=0.18); link(nt, p.outputs[0], mx.inputs[1]); link(nt, tr.outputs[0], mx.inputs[2])
    link(nt, mx.outputs[0], out.inputs['Surface'])
    return m
M_SKIN2 = skin()

VIS = 1.0 / 0.575    # a metaball ball of radius R shows a surface of radius ~0.575 R at threshold 0.6

def vball(mb, c, v, rel=None):
    """A ball showing a visible radius v (m); rel scales it per axis (relative)."""
    el = mb.elements.new(); el.co = tuple(c); el.radius = v * VIS
    if rel: el.type = 'ELLIPSOID'; el.size_x, el.size_y, el.size_z = rel
    return el

def vcap(mb, a, b, v):
    a, b = Vector(a), Vector(b)
    el = mb.elements.new(); el.type = 'CAPSULE'; el.co = (a + b) / 2; el.radius = v * VIS
    el.size_x = (b - a).length / 2
    el.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
    return el

def goblin_metaball(pose):
    for o in GOBLIN: bpy.data.objects.remove(o, do_unlink=True)
    GOBLIN.clear()
    mb = bpy.data.metaballs.new('goblin'); mb.resolution = 0.02; mb.render_resolution = 0.006; mb.threshold = 0.6
    ob = bpy.data.objects.new('goblin', mb); sc.collection.objects.link(ob); ob.data.materials.append(M_SKIN2)
    ob.location = (CHX, CHY, 0.0); GOBLIN.append(ob)
    rc = pose == 'recoil'
    by = -0.1 if rc else 0.0                       # thrown back into the chair
    V = lambda x, y, z: Vector((x, y, z))
    pelvis, low, hump, upper = V(0, 0.0, 0.57), V(0, -0.02 + by * 0.5, 0.68), V(0, -0.05 + by, 0.8), V(0, 0.02 + by, 0.9)
    neck0, neck1 = V(0, 0.06 + by, 0.93), V(0, (0.18 if not rc else 0.0), (0.97 if not rc else 1.03))
    head = V(0, (0.24 if not rc else 0.04), (1.0 if not rc else 1.08))
    vball(mb, pelvis, 0.12, (1.15, 0.95, 0.8)); vball(mb, low, 0.115); vball(mb, hump, 0.13, (1.0, 0.9, 1.05))
    vball(mb, upper, 0.115, (1.2, 0.85, 0.8))
    for k in range(6):                              # vertebrae knuckling through the hunched back
        t = k / 5
        p = low.lerp(hump, min(1.0, t * 1.6)) if t < 0.6 else hump.lerp(upper, (t - 0.6) / 0.4)
        vball(mb, p + V(0, -0.105 - 0.015 * math.sin(t * math.pi), 0.0), 0.022)
    vcap(mb, neck0, neck1, 0.048)
    vball(mb, head, 0.105, (1.0, 1.12, 0.95)); vball(mb, head + V(0, -0.04, 0.03), 0.08)
    for sx in (-1, 1):
        sh = upper + V(sx * 0.12, 0.02, -0.01)
        vball(mb, sh, 0.065)
        if not rc:
            el, hd = V(sx * 0.2, 0.17, 0.72), V(sx * 0.1, 0.45, 0.645)
        else:
            el, hd = V(sx * 0.21, 0.02, 0.86), V(sx * 0.09, 0.16, 1.04)
        vcap(mb, sh, el, 0.042); vcap(mb, el, hd, 0.034); vball(mb, hd, 0.04, (0.9, 1.2, 0.6))
        fwd = (hd - el).normalized()
        for f in range(4):                          # long knuckly fingers
            side = V(sx, 0, 0).cross(fwd).normalized() if not rc else V(1, 0, 0)
            fa = hd + fwd * 0.02 + V(sx * 0.012 * (f - 1.5), 0, 0)
            vcap(mb, fa, fa + fwd * 0.07 + V(sx * 0.006 * (f - 1.5), 0, -0.012), 0.011)
        kn = V(sx * 0.13, 0.3, 0.62); ft = V(sx * 0.13, 0.34, 0.31)
        vcap(mb, pelvis + V(sx * 0.07, 0.02, 0), kn, 0.065); vcap(mb, kn, ft, 0.045)
    for sx in (-1, 1):                              # ears: thin leaf blades, out, back and up, faces to the back
        base = V(CHX, CHY, 0) + head + V(sx * 0.085, -0.02, 0.02)
        d = V(sx * 0.85, -0.35, 0.4).normalized(); L = 0.24
        tip = base + d * L
        bpy.ops.mesh.primitive_cone_add(radius1=0.05, radius2=0.002, depth=L, vertices=32, location=(base + tip) / 2)
        ear = bpy.context.active_object; ear.name = f'ear{sx}'
        z = d; xb = V(0, -1, 0.35); x = (xb - z * z.dot(xb)).normalized(); y = z.cross(x)
        from mathutils import Matrix
        ear.rotation_mode = 'QUATERNION'; ear.rotation_quaternion = Matrix((x, y, z)).transposed().to_quaternion()
        ear.scale = (0.22, 1.0, 1.0)
        ear.data.materials.append(M_SKIN2); bpy.ops.object.shade_smooth()
        sub = ear.modifiers.new('s', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
        GOBLIN.append(ear)

SDF_MESH = os.environ.get('GOBLIN_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sdfmesh'))
def goblin_material():
    """goblin.blob's palette (the lab look): a saturated yellow-green, hand-span patches of browner mottle, the char
    colour in the creases, clammy (spec roughness 0.42, wetness 0.55), translucency 0.3, and a field of fine pits.
    Prims with their own colour (eyes, nails) keep the colour the mesher wrote."""
    m, nt, out = mat('goblin_sdf')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    BASE, MOTTLE, CHAR = (0.22, 0.55, 0.025, 1), (0.05, 0.085, 0.008, 1), (0.012, 0.018, 0.006, 1)
    mz = node(nt, 'ShaderNodeTexNoise', Scale=7.0, Detail=4.0, Roughness=0.55); link(nt, tc.outputs['Object'], mz.inputs['Vector'])
    mm = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.45, 'From Max': 0.6, 'To Min': 0.0, 'To Max': 0.8}); link(nt, mz.outputs['Fac'], mm.inputs['Value'])
    skin = mix_rgb(nt, mm.outputs['Result'], BASE, MOTTLE)
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.05
    am = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.35, 'From Max': 1.0, 'To Min': 0.85, 'To Max': 0.0}); link(nt, ao.outputs['AO'], am.inputs['Value'])
    skin = mix_rgb(nt, am.outputs['Result'], skin, CHAR)
    # Own-coloured prims: where the vertex colour is far from the palette base (as the mesher wrote it, sRGB), keep it.
    dv = node(nt, 'ShaderNodeVectorMath', _operation='DISTANCE'); link(nt, vc.outputs['Color'], dv.inputs[0])
    dv.inputs[1].default_value = (0.34, 0.44, 0.19)
    own = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.05, 'From Max': 0.12, 'To Min': 0.0, 'To Max': 1.0}); link(nt, dv.outputs['Value'], own.inputs['Value'])
    col = mix_rgb(nt, own.outputs['Result'], skin, vc.outputs['Color'])
    pits = node(nt, 'ShaderNodeTexVoronoi', Scale=420.0); link(nt, tc.outputs['Object'], pits.inputs['Vector'])
    pr = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.35, 'To Min': 0.8, 'To Max': 0.3}); link(nt, pits.outputs['Distance'], pr.inputs['Value'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Coat Weight': 0.45, 'Coat Roughness': 0.22,
        'Subsurface Weight': 0.3, 'Subsurface Radius': (1.0, 0.35, 0.15), 'Subsurface Scale': 0.02, 'Specular IOR Level': 0.6})
    link(nt, col, p.inputs['Base Color']); link(nt, pr.outputs['Result'], p.inputs['Roughness'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.3, Distance=0.002)
    link(nt, pits.outputs['Distance'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m
M_GOBLIN = goblin_material()

KIT = bool(os.environ.get('KIT'))
import sys as _sys
_sys.path.insert(0, SDF_MESH)
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # kit_pose.py sits beside this script

def goblin(pose):
    """The game's own SDF goblin (goblin.blob), meshed from its CPU field in a held pose (sdfmesh/blob-mesh.ts)."""
    for o in GOBLIN: bpy.data.objects.remove(o, do_unlink=True)
    GOBLIN.clear()
    bpy.ops.wm.ply_import(filepath=os.path.join(SDF_MESH, f'goblin-{pose}.ply'))
    o = bpy.context.active_object; o.name = 'goblin'
    o.data.materials.append(M_GOBLIN)
    o.rotation_euler = (math.radians(90), 0, math.radians(180))     # game y-up, +z forward -> Blender z-up, facing +y
    o.location = (CHX, CHY - 0.04, -0.06)
    bpy.ops.object.shade_smooth()
    GOBLIN.append(o)
    if KIT:                                   # its armour kit (goblin-kit.gltf), posed to the same bone angles
        from kit_pose import pose_kit
        tops, arm = pose_kit(os.environ.get('KIT_GLTF', 'public/assets/lab/goblin-kit.gltf'), os.path.join(SDF_MESH, f'bones-{pose}.json'))
        for t in tops: t.rotation_euler = (0, 0, math.radians(180)); t.location = o.location
        for ob in bpy.data.objects:
            if ob.parent in tops or ob in tops: GOBLIN.append(ob)

# ---------- the membrane ----------
EGG_AX = (0.075, 0.075, 0.10)   # the egg's semi-axes across, out of the screen, up

def membrane(p, tear=0.0, sag=0.0, ripple=0.0, settle=0.0, nu=150, nv=112):
    """The screen as a sheet pinned to the bezel. p: the egg centre's distance out of the glass (m, negative =
    still inside the tube). tear 0..1 opens the sheet over the egg; sag droops the torn lips; settle wrinkles a
    healed sheet. Returns the object; writes the 'thin' attribute (0 glass .. 1 stretched to skin)."""
    for o in [o for o in bpy.data.objects if o.name.startswith('membrane')]: bpy.data.objects.remove(o, do_unlink=True)
    ex, ey, ez = EGG_AX
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    grid, hgt = {}, {}
    for j in range(nv + 1):
        for i in range(nu + 1):
            u = (i / nu - 0.5) * SW; v = (j / nv - 0.5) * SH
            h0 = 0.012 * (1 - (2 * u / SW) ** 2) * (1 - (2 * v / SH) ** 2)          # the tube's convex glass
            q = 1 - (u / ex) ** 2 - (v / ez) ** 2
            he = p + ey * math.sqrt(q) + 0.003 if q > 0 else p - 1.0
            k = 0.015 + 0.55 * max(0.0, p + ey)                                     # the tent widens as it pushes
            h = smax(h0, he, k)
            edge = min(SW / 2 - abs(u), SH / 2 - abs(v))
            h = h0 + (h - h0) * smoothstep(0.0, 0.03, edge)
            tent = max(0.0, h - h0)
            fp = (u / ex) ** 2 + (v / ez) ** 2
            if tent > 0.002 and fp > 1.0:          # radial folds where the sheet is dragged into the tent
                ang = math.atan2(v / ez, u / ex)
                h += 0.16 * min(tent, 0.05) * math.sin(ang * 15 + 2.5 * math.sin(ang * 3)) * min(1.0, (fp - 1.0) * 1.5) * math.exp(-(fp - 1.0) * 0.6)
            r = math.hypot(u, v)
            h += ripple * math.sin(r * 140.0 - 2.0) * math.exp(-r * 9.0) * smoothstep(0.0, 0.03, edge)
            if settle > 0:
                h += settle * (0.012 * noise.noise(Vector((u * 18, v * 18, 0.5))) + 0.004 * noise.noise(Vector((u * 60, v * 60, 3.1)))) * smoothstep(0.0, 0.04, edge)
            if sag > 0:                                                              # the torn lips hang out and down
                rr = (u / (ex * 1.05)) ** 2 + (v / (ez * 1.05)) ** 2
                lip = math.exp(-max(0.0, rr - 1.0) * 2.5)
                h += sag * 0.06 * lip
                v -= sag * 0.05 * lip * (1 - v / SH)
            vert = bm.verts.new((CX + u, SCREEN_Y - h, CZ + v))
            grid[(i, j)] = vert; hgt[(i, j)] = h
    bm.verts.ensure_lookup_table()
    for j in range(nv):
        for i in range(nu):
            u = ((i + 0.5) / nu - 0.5) * SW; v = ((j + 0.5) / nv - 0.5) * SH
            if tear > 0:
                rr = (u / (ex * tear)) ** 2 + (v / (ez * tear)) ** 2
                rag = 0.18 * noise.noise(Vector((u * 40, v * 40, 7.0)))
                if rr < 1.0 + rag: continue
            f = bm.faces.new([grid[(i, j)], grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)]])
            for loop, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uvl].uv = (a / nu, b / nv)
    # Stretch: the sheet's area against the flat glass, per vertex.
    du, dv = SW / nu, SH / nv
    thin = {}
    for (i, j), h in hgt.items():
        hu = (hgt.get((i + 1, j), h) - hgt.get((i - 1, j), h)) / (2 * du)
        hv = (hgt.get((i, j + 1), h) - hgt.get((i, j - 1), h)) / (2 * dv)
        thin[(i, j)] = min(1.0, max(0.0, (math.sqrt(1 + hu * hu + hv * hv) - 1.0) / 1.5 + max(0.0, h - 0.012) * 9.0))
    me = bpy.data.meshes.new('membrane'); bm.to_mesh(me)
    idx = {v.index: key for key, v in grid.items()}
    at = me.attributes.new('thin', 'FLOAT', 'POINT')
    for v in me.vertices: at.data[v.index].value = max(thin[idx[v.index]], settle * 0.25)
    for poly in me.polygons: poly.use_smooth = True
    bm.free()
    ob = bpy.data.objects.new('membrane', me); ob.data.materials.append(M_SCREEN); sc.collection.objects.link(ob)
    sol = ob.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.002
    return ob

EGG_OBJ = []
def egg(at, glow=1.0, tilt=0.0):
    for o in EGG_OBJ: bpy.data.objects.remove(o, do_unlink=True)
    EGG_OBJ.clear()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=48, radius=1.0, location=at)
    o = bpy.context.active_object; o.name = 'egg'
    for v in o.data.vertices:
        z = v.co.z; s = 1 - 0.1 * z
        v.co = Vector((v.co.x * EGG_AX[0] * s, v.co.y * EGG_AX[1] * s, z * EGG_AX[2]))
    o.rotation_euler = (tilt, 0, 0)
    o.data.materials.append(M_EGG); bpy.ops.object.shade_smooth(); EGG_OBJ.append(o)
    L = point_light('egg_light', Vector(at) + Vector((0, 0.01, -0.03)), 1.3 * glow, (1.0, 0.6, 0.3), 0.02); EGG_OBJ.append(L)
    # A dark curled figure against the light, and a few vessels on the inside of the shell.
    mb = bpy.data.metaballs.new('fig'); mb.resolution = 0.006; mb.render_resolution = 0.004
    f = bpy.data.objects.new('fig', mb); f.location = Vector(at) + Vector((0, -0.035, 0.0)); sc.collection.objects.link(f)
    f.data.materials.append(principled('fig', (0.02, 0.003, 0.003, 1), rough=0.6)); EGG_OBJ.append(f)
    vball(mb, (0, 0, 0.03), 0.026); vball(mb, (0.005, 0.0, -0.012), 0.026, (0.8, 0.7, 1.3)); vball(mb, (0.014, 0, -0.045), 0.016)
    return o

GOO = []
def goo_clear():
    for o in GOO: bpy.data.objects.remove(o, do_unlink=True)
    GOO.clear()

def shine(name, loc, r):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object; o.name = name; o.scale.z = 1.3; o.data.materials.append(M_MUCUS); bpy.ops.object.shade_smooth()
    GOO.append(o); return o

def puddle(name, centre, rx, ry, blobs=14, mat_=None):
    mb = bpy.data.metaballs.new(name); mb.resolution = 0.01; mb.render_resolution = 0.006; mb.threshold = 0.6
    o = bpy.data.objects.new(name, mb); o.location = centre; o.scale = (1, 1, 0.12); sc.collection.objects.link(o)
    o.data.materials.append(mat_ or M_POOL); GOO.append(o)
    for k in range(blobs):
        a = random.random() * math.tau; rr = random.random() ** 0.6
        ball(mb, (math.cos(a) * rx * rr, math.sin(a) * ry * rr, 0), 0.03 + 0.03 * random.random())
    return o

# ---------- cameras ----------
CAMS = {
    'screen': camera('c_screen', (CX, CRT_FRONT - 0.24, CZ), (CX, SCREEN_Y, CZ), 24.0),
    'over':   camera('c_over', (CX + 0.4, CHY - 0.95, 1.4), (CX - 0.07, SCREEN_Y, CZ + 0.03), 34.0),
    'side':   camera('c_side', (CX - 0.42, 3.15, 1.3), (CX + 0.04, 4.42, 0.74), 30.0),
    'wide':   camera('c_wide', (-1.05, 2.75, 1.85), (0.45, 4.5, 0.72), 22.0),
    'detail': camera('c_detail', (CX + 0.36, CRT_FRONT - 0.42, CZ - 0.07), (CX - 0.02, SCREEN_Y - 0.04, CZ + 0.01), 30.0),
    'desk':   camera('c_desk', (CX - 0.42, 4.08, DTOP + 0.16), (CX + 0.02, 4.42, DTOP + 0.15), 26.0),
}

def render(name, cam):
    sc.camera = CAMS[cam]
    sc.render.filepath = f'{OUT}/{name}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)

# ---------- the frames ----------
SEQ = {
    #            pose      egg centre p (m out of the glass)  membrane kwargs                         camera
    'f1_screen':  ('type',  None,  dict(p=-0.3),                              'screen'),
    'f2_over':    ('type',  None,  dict(p=-0.3),                              'over'),
    'f3_wide':    ('type',  None,  dict(p=-0.3),                              'wide'),
    'f4_bulge':   ('type',  -0.02, dict(p=-0.02, ripple=0.004),               'detail'),
    'f5_stretch': ('type',  0.03,  dict(p=0.03),                              'detail'),
    'f6_crown':   ('recoil', 0.075, dict(p=0.075, tear=0.95),                 'detail'),
    'f7_out':     ('recoil', 'desk', dict(p=-0.3, tear=0.9, sag=1.0),         'side'),
    'f8_settle':  ('recoil', 'desk', dict(p=-0.3, settle=1.0),                'desk'),
}
for fr in FRAMES:
    pose, ep, mk, cam = SEQ[fr]
    goo_clear()
    if cam in ('detail', 'desk'):
        for o in GOBLIN: bpy.data.objects.remove(o, do_unlink=True)
        GOBLIN.clear()
    else:
        goblin(pose)
    m = membrane(**mk)
    for o in EGG_OBJ: bpy.data.objects.remove(o, do_unlink=True)
    EGG_OBJ.clear()
    SCREEN_LIGHT.data.energy = 4.0 if ep is None or ep == 'desk' else 2.0
    if isinstance(ep, float):
        egg((CX, SCREEN_Y - ep, CZ), glow=1.0 if ep < 0.05 else 0.45)
    if fr == 'f6_crown':                       # strands from the torn rim over the egg's face
        ex, ey, ez = EGG_AX
        ring = []
        for k in range(41):
            a = k / 40 * math.tau
            w = 1.0 + 0.08 * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 1.3)))
            ring.append(Vector((CX + math.cos(a) * ex * 0.97 * w, SCREEN_Y - (0.075 + 0.3 * ey + 0.006), CZ + math.sin(a) * ez * 0.97 * w)))
        GOO.append(tube('lip', ring, [0.007 + 0.004 * noise.noise(Vector((k * 0.4, 0.2, 0.0))) for k in range(41)], M_RIM))
        for k in range(9):
            a = k / 9 * math.tau + 0.3
            rim = Vector((CX + math.cos(a) * ex * 1.02, SCREEN_Y - 0.075 - 0.004, CZ + math.sin(a) * ez * 1.02))
            b_ = Vector((CX + math.cos(a + 2.4) * ex * 0.5, SCREEN_Y - 0.075 - ey * 0.78 - 0.008, CZ + math.sin(a + 2.4) * ez * 0.5))
            GOO.append(gloop(f'cs{k}', rim, b_, 0.014, 0.007, 0.0032, M_MUCUS, bead=False))
        for k in range(5):
            x = CX + random.uniform(-0.06, 0.06)
            top = Vector((x, SCREEN_Y - 0.03, CZ - 0.09))
            L = 0.03 + 0.06 * random.random()
            GOO.append(tube(f'cd{k}', [top, top + Vector((0, -0.003, -L * 0.5)), top + Vector((0, -0.004, -L))], [0.0045, 0.0018, 0.0022], M_MUCUS))
            shine(f'cb{k}', top + Vector((0, -0.004, -L - 0.004)), 0.0045)
    if ep == 'desk':
        at = (CX - 0.02, 4.37, DTOP + EGG_AX[2] * 0.82)
        egg(at, glow=0.9, tilt=-1.2 if fr == 'f7_out' else -1.35)
        puddle('slick', (CX, 4.38, DTOP + 0.002), 0.17, 0.08)
        if fr == 'f7_out':
            ex, ey, ez = EGG_AX
            for k in range(4):          # strands still tying the egg to the torn screen
                a = k / 4 * math.tau + 0.6
                rim = Vector((CX + math.cos(a) * ex, SCREEN_Y - 0.05, CZ + math.sin(a) * ez * 0.9 - 0.02))
                tgt = Vector(at) + Vector((math.cos(a) * 0.03, 0.03, math.sin(a) * 0.02 + 0.02))
                GOO.append(gloop(f'tie{k}', rim, tgt, 0.07, 0.005, 0.0016, M_MUCUS, bead=k % 2 == 0))
        for k in range(6):              # drips off the bezel's lower lip
            x = CX + random.uniform(-0.13, 0.13); top = Vector((x, CRT_FRONT - 0.012, CZ - SH / 2 - 0.03))
            L = 0.03 + 0.08 * random.random()
            GOO.append(tube(f'dr{k}', [top, top + Vector((0, -0.002, -L * 0.5)), top + Vector((0, -0.003, -L))], [0.004, 0.0016, 0.002], M_MUCUS))
            shine(f'bead{k}', top + Vector((0, -0.003, -L - 0.004)), 0.0045)
        if fr == 'f8_settle':
            puddle('film', (CX, SCREEN_Y - 0.006, CZ - 0.06), 0.1, 0.04, blobs=6, mat_=M_MUCUS)
    render(fr, cam)

if os.environ.get('CLIP'):
    def lerpcam(c0, c1, t, lens0, lens1):
        cam = CAMS['clip'] if 'clip' in CAMS else None
        if cam is None:
            cd = bpy.data.cameras.new('clip'); cam = bpy.data.objects.new('clip', cd); sc.collection.objects.link(cam); CAMS['clip'] = cam
        cam.matrix_world = c0.matrix_world.copy()
        q = c0.matrix_world.to_quaternion().slerp(c1.matrix_world.to_quaternion(), t)
        cam.location = c0.location.lerp(c1.location, t); cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = q
        cam.data.lens = lens0 + (lens1 - lens0) * t; cam.data.sensor_width = 36
        return cam
    ease = lambda t: t * t * (3 - 2 * t)
    n = 0
    goblin('type')
    membrane(p=-0.3)  # (clip)
    for i in range(30):                                   # A: the pull-back out of the screen
        t = ease(i / 29)
        sc.camera = lerpcam(CAMS['screen'], CAMS['over'], t, 24.0, 34.0)
        sc.render.filepath = f'{OUT}/clip_{n:03d}.png'; bpy.ops.render.render(write_still=True); n += 1
    for o in GOBLIN: bpy.data.objects.remove(o, do_unlink=True)
    GOBLIN.clear()
    sc.camera = CAMS['detail']
    for i in range(48):                                   # B: the push, ending in the crown
        t = i / 47
        p_ = -0.12 + 0.195 * (t ** 1.6)
        tear = 0.0 if t < 0.8 else 0.95 * ease((t - 0.8) / 0.2)
        goo_clear()
        membrane(p=p_, tear=tear, ripple=0.004 * max(0.0, 1 - t * 2.5) * math.sin(i * 0.9))
        for o in EGG_OBJ: bpy.data.objects.remove(o, do_unlink=True)
        EGG_OBJ.clear()
        egg((CX, SCREEN_Y - p_, CZ), glow=1.0 if p_ < 0.05 else 0.45)
        SCREEN_LIGHT.data.energy = 4.0 - 2.0 * t
        sc.render.filepath = f'{OUT}/clip_{n:03d}.png'; bpy.ops.render.render(write_still=True); n += 1
    print('CLIP', n)
