# The Flat, take 2: castle stone (the bones), Giger industrial decay (the veins), Tokyo otaku clutter (the stuff),
# with the machine at its last stage, the "Giger iMac", on a kotatsu, and the SDF goblin at it in vest and shorts.
# Run: blender --background --factory-startup --python room.py -- OUTDIR [shot ...]
# Env: TEX (textures.py output), GOBLIN_DIR (goblin-kotatsu.ply, bones-kotatsu.json), REPO (repo root, for the baked
# rock), RT94=1|0 (the 90s ray tracer, default on), SAMPLES, RES_X, RES_Y.
import bpy, bmesh, math, random, sys, os, json
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/room'
SHOTS = argv[1:] or ['wide', 'shoulder', 'imac']
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.environ.get('TEX', os.path.join(HERE, 'tex'))
REPO = os.environ.get('REPO', os.getcwd())
GOB = os.environ.get('GOBLIN_DIR', HERE)
RES = (int(os.environ.get('RES_X', '800')), int(os.environ.get('RES_Y', '600')))
SAMPLES = int(os.environ.get('SAMPLES', '64'))
RT94 = os.environ.get('RT94', '1') == '1'
random.seed(11)

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
sc.cycles.max_bounces = 8; sc.cycles.transmission_bounces = 8; sc.cycles.transparent_max_bounces = 16
sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.image_settings.file_format = 'PNG'
if RT94:
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.view_settings.exposure = float(os.environ.get('EXPOSURE', '0.0'))
    sc.cycles.diffuse_bounces = 0; sc.cycles.glossy_bounces = 2; sc.cycles.volume_bounces = 0
    sc.cycles.filter_width = 0.6
else:
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = float(os.environ.get('EXPOSURE', '0.0'))
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.45, 0.6, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

# ======================================================================== helpers
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

def put(nt, src, dst):
    if isinstance(src, (int, float, tuple)): dst.default_value = src
    else: link(nt, src, dst)

def mix_rgb(nt, fac, a, b, blend='MIX'):
    n = nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend
    put(nt, fac, sock(n, 'Factor')); put(nt, a, sock(n, 'A')); put(nt, b, sock(n, 'B'))
    return sock(n, 'Result', out=True)

def math_(nt, op, a, b=0.0):
    n = node(nt, 'ShaderNodeMath', _operation=op)
    put(nt, a, n.inputs[0]); put(nt, b, n.inputs[1])
    return n.outputs[0]

def maprange(nt, v, a, b, c, d, clamp=True):
    n = node(nt, 'ShaderNodeMapRange', **{'From Min': a, 'From Max': b, 'To Min': c, 'To Max': d}); n.clamp = clamp
    put(nt, v, n.inputs['Value']); return n.outputs['Result']

def principled(name, color, rough=0.5, metal=0.0, coat=0.0, trans=0.0, ior=1.45, sss=0.0, noise_scale=0.0,
               noise_amt=0.0, emit=None, emit_str=0.0, sheen=0.0, bump=0.0, bump_scale=60.0, alpha=1.0):
    m, nt, out = mat(name)
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': color, 'Roughness': rough, 'Metallic': metal,
        'Coat Weight': coat, 'Coat Roughness': 0.04, 'Transmission Weight': trans, 'IOR': ior,
        'Subsurface Weight': sss, 'Subsurface Radius': (1.0, 0.3, 0.15), 'Subsurface Scale': 0.02,
        'Sheen Weight': sheen, 'Sheen Roughness': 0.4, 'Alpha': alpha})
    if emit is not None:
        p.inputs['Emission Color'].default_value = emit; p.inputs['Emission Strength'].default_value = emit_str
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if noise_amt > 0:
        nz = node(nt, 'ShaderNodeTexNoise', Scale=noise_scale, Detail=8.0); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
        dark = tuple(c * (1 - noise_amt) for c in color[:3]) + (1,)
        link(nt, mix_rgb(nt, nz.outputs['Fac'], dark, color), p.inputs['Base Color'])
    if bump > 0:
        bz = node(nt, 'ShaderNodeTexNoise', Scale=bump_scale, Detail=6.0); link(nt, tc.outputs['Object'], bz.inputs['Vector'])
        b = node(nt, 'ShaderNodeBump', Strength=bump, Distance=0.002); link(nt, bz.outputs['Fac'], b.inputs['Height'])
        link(nt, b.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

def image(nt, path, noncolor=False, ext='REPEAT'):
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path, check_existing=True); t.extension = ext
    if noncolor: t.image.colorspace_settings.name = 'Non-Color'
    return t

def obj_from_bm(name, bm, mats, smooth=False, bevel=0.0, segs=2):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]): me.materials.append(m)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = segs; b.limit_method = 'ANGLE'
    return o

def bm_cube(bm, c, s, rot=None, layer=None, val=0.0, mi=0):
    M = Matrix.Translation(Vector(c)) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4)) @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mi
        if layer is not None: f[layer] = val
    return r['verts']

def box(name, c, s, m, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3; b.limit_method = 'ANGLE'
    return o

def cyl(name, c, r, d, m, rot=(0, 0, 0), verts=24, r2=None, smooth=True):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=c, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=c, rotation=rot, vertices=verts)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m)
    if smooth: bpy.ops.object.shade_smooth()
    return o

def sphere(name, c, r, m, scale=(1, 1, 1), seg=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=c, segments=seg, ring_count=seg // 2, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = scale; o.data.materials.append(m); bpy.ops.object.shade_smooth()
    return o

def torus(name, c, R, r, m, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=c, rotation=rot, major_segments=32, minor_segments=12)
    o = bpy.context.active_object; o.name = name; o.scale = scale; o.data.materials.append(m); bpy.ops.object.shade_smooth()
    return o

def tube(name, pts, radii, material, res=4, cyclic=False):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = res; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1); sp.use_endpoint_u = not cyclic; sp.use_cyclic_u = cyclic
    sp.order_u = min(4, len(pts))
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (p[0], p[1], p[2], 1.0); sp.points[i].radius = r
    ob = bpy.data.objects.new(name, cu); ob.data.materials.append(material); sc.collection.objects.link(ob)
    return ob

def catmull(pts, n_per=12):
    """Sample a Catmull-Rom spline through pts: returns [(pos, tangent)]."""
    P = [Vector(p) for p in pts]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n_per):
            t = k / n_per
            pos = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
            tan = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t)
            out.append((pos, tan.normalized()))
    out.append((P[-2], (P[-2] - P[-3]).normalized()))
    return out

def resample(samples, step):
    """Even arc-length spacing along sampled spline points."""
    res = [samples[0]]; acc = 0.0
    for (a, ta), (b, tb) in zip(samples, samples[1:]):
        seg = (b - a).length; acc += seg
        while acc >= step:
            acc -= step; t = 1 - acc / seg if seg > 0 else 1
            res.append((a.lerp(b, t), ta.lerp(tb, t).normalized()))
    return res

def point_light(name, loc, energy, color, radius=0.02):
    radius = min(radius, 0.01) if RT94 else radius
    L = bpy.data.lights.new(name, 'POINT'); L.energy = energy; L.color = color; L.shadow_soft_size = radius
    o = bpy.data.objects.new(name, L); o.location = loc; sc.collection.objects.link(o); o.visible_camera = False; return o

def area_light(name, loc, rot, energy, color, size, size_y=None, soft=False):
    if RT94 and not soft: size = min(size, 0.08); size_y = min(size_y, 0.08) if size_y else None
    L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = color
    if size_y: L.shape = 'RECTANGLE'; L.size = size; L.size_y = size_y
    else: L.size = size
    o = bpy.data.objects.new(name, L); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o); o.visible_camera = False; return o

def camera(name, loc, target, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_width = 36; cd.clip_start = 0.02
    o = bpy.data.objects.new(name, cd); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

# ======================================================================== the room's frame
# 6 tatami: x -1.35..1.35 (2.7 m), y 0..3.6 (north = the window), z up. A segmental barrel vault along y.
X0, X1, Y0, Y1 = -1.35, 1.35, 0.0, 3.6
SPRING = 1.95                       # the vault springs from the side walls here
RV = 1.8; CZ = SPRING - math.sqrt(RV * RV - X1 * X1)     # vault circle centre height
def vault_z(x): return CZ + math.sqrt(max(0.0, RV * RV - x * x))
CROWN = vault_z(0.0)
# The window: a round-arched opening in the north wall, deep in a castle-thick wall.
WX, WH, WS, WSP, WDEPTH = 0.12, 0.36, 0.62, 1.42, 0.62   # centre x, half width, sill z, springing z, wall thickness
KX, KY, KTOP = 0.12, 2.36, 0.44     # the kotatsu: centre and board top
GX, GY = 0.12, 1.47                 # the goblin's pelvis on its zabuton

# ======================================================================== materials
ROCK = os.path.join(REPO, 'assets-source/levels/kit-textures/rock-color.png')
import numpy as np
def stain_map(name, w_m, h_m, sources, ppm=200, seed=0):
    """Wet and rust runs down a wall, painted with numpy: sources are (u, z, spread, length, strength) in metres along the
    wall. Returns a Blender image (R = wet dark, G = rust)."""
    W, H = int(w_m * ppm), int(h_m * ppm); img = np.zeros((H, W, 4), np.float32); rnd = np.random.default_rng(seed)
    for (u, z, spread, length, strength) in sources:
        for k in range(int(40 * spread / 0.1) + 8):
            x = int((u + rnd.normal(0, spread)) * ppm); top = int((z + rnd.normal(0, 0.03)) * ppm)
            L = int(length * ppm * rnd.uniform(0.3, 1.0)); wpx = rnd.integers(1, 4); rust = rnd.uniform(0.0, 1.0)
            for yy in range(max(0, top - L), min(H, top)):
                t = (top - yy) / max(L, 1)
                a = strength * (1 - t) ** 1.5 * rnd.uniform(0.6, 1.0)
                x0, x1 = max(0, x - wpx), min(W, x + wpx)
                if x0 < x1:
                    img[yy, x0:x1, 0] = np.maximum(img[yy, x0:x1, 0], a)
                    img[yy, x0:x1, 1] = np.maximum(img[yy, x0:x1, 1], a * rust)
                x += int(rnd.integers(-1, 2)) if rnd.random() < 0.08 else 0
        # a damp halo round the source
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.sqrt(((xx / ppm - u) / (spread * 2.5)) ** 2 + ((yy / ppm - z) / (spread * 2.0)) ** 2)
        img[..., 0] = np.maximum(img[..., 0], strength * 0.6 * np.clip(1 - d, 0, 1))
    k = 3   # soften
    for c in (0, 1):
        ch = img[..., c]; cs = np.cumsum(np.pad(ch, ((0, 0), (k, k)), mode='edge'), axis=1); img[..., c] = (cs[:, 2 * k:] - cs[:, :-2 * k]) / (2 * k)
    img[..., 3] = 1.0
    im = bpy.data.images.new(name, W, H, float_buffer=True); im.pixels.foreach_set(img.ravel()); im.colorspace_settings.name = 'Non-Color'
    return im

def stone_material(name, tint=(1.0, 1.0, 1.0), courses=None, scale=1.0, damp=True, stain=None):
    """The castle stone: the baked Bryce rock (box-projected, 1 tile = 1 m) with its luminance as the bump, a per-block
    tint from the 'rand' face attribute, damp and green-black toward the floor. courses=(w, h) adds mortar lines (brick
    texture in UV) for surfaces that are not built from blocks (the vault, the soffit)."""
    m, nt, out = mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vec = node(nt, 'ShaderNodeVectorMath', _operation='SCALE'); link(nt, tc.outputs['Object'], vec.inputs[0]); vec.inputs['Scale'].default_value = scale
    t = image(nt, ROCK); t.projection = 'BOX'; t.projection_blend = 0.3; link(nt, vec.outputs[0], t.inputs['Vector'])
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'rand'
    tintf = maprange(nt, attr.outputs['Fac'], 0.0, 1.0, 0.6, 1.3)
    col = mix_rgb(nt, 1.0, t.outputs['Color'], (tint[0], tint[1], tint[2], 1), 'MULTIPLY')
    col = mix_rgb(nt, 1.0, col, (1.6, 1.55, 1.45, 1), 'MULTIPLY')        # the baked rock is dark; castle stone a step lighter
    vm = node(nt, 'ShaderNodeCombineColor'); link(nt, tintf, vm.inputs[0]); link(nt, tintf, vm.inputs[1]); link(nt, tintf, vm.inputs[2])
    col = mix_rgb(nt, 1.0, col, vm.outputs[0], 'MULTIPLY')
    height = t.outputs['Color']
    rough = 0.82
    if courses:
        uv = nt.nodes.new('ShaderNodeUVMap')
        br = node(nt, 'ShaderNodeTexBrick', Scale=1.0, **{'Mortar Size': 0.012, 'Brick Width': courses[0], 'Row Height': courses[1],
            'Color1': (1, 1, 1, 1), 'Color2': (0.75, 0.75, 0.75, 1), 'Mortar': (0, 0, 0, 1), 'Mortar Smooth': 0.2})
        br.offset = 0.5; link(nt, uv.outputs['UV'], br.inputs['Vector'])
        col = mix_rgb(nt, 1.0, col, br.outputs['Color'], 'MULTIPLY')
        col = mix_rgb(nt, maprange(nt, br.outputs['Fac'], 0.0, 0.5, 0.0, 1.0), col, (0.03, 0.028, 0.025, 1))
        height = mix_rgb(nt, 0.5, t.outputs['Color'], br.outputs['Color'])
    if damp:
        sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
        dz = maprange(nt, sep.outputs['Z'], 0.05, 0.55, 0.75, 0.0)
        nz = node(nt, 'ShaderNodeTexNoise', Scale=3.0, Detail=6.0); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
        dz = math_(nt, 'MULTIPLY', dz, maprange(nt, nz.outputs['Fac'], 0.35, 0.65, 0.3, 1.0))
        col = mix_rgb(nt, dz, col, (0.025, 0.032, 0.018, 1))
    bump = node(nt, 'ShaderNodeBump', Strength=0.55, Distance=0.02); link(nt, height, bump.inputs['Height'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=rough, **{'Specular IOR Level': 0.35})
    if stain:   # (image, axis, u0, wall width, wall height): wet runs darken and gloss the stone, some go to rust
        im, axis, u0, wm, hm = stain
        sp = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sp.inputs[0])
        uu = maprange(nt, sp.outputs['X' if axis == 'x' else 'Y'], u0, u0 + wm, 0.0, 1.0, clamp=False)
        vv = maprange(nt, sp.outputs['Z'], 0.0, hm, 0.0, 1.0, clamp=False)
        cv = node(nt, 'ShaderNodeCombineXYZ'); link(nt, uu, cv.inputs['X']); link(nt, vv, cv.inputs['Y'])
        st = nt.nodes.new('ShaderNodeTexImage'); st.image = im; st.extension = 'CLIP'; link(nt, cv.outputs[0], st.inputs['Vector'])
        ss = node(nt, 'ShaderNodeSeparateColor'); link(nt, st.outputs['Color'], ss.inputs[0])
        col = mix_rgb(nt, ss.outputs['Green'], col, (0.2, 0.075, 0.02, 1))
        col = mix_rgb(nt, math_(nt, 'MULTIPLY', ss.outputs['Red'], 0.85), col, (0.018, 0.016, 0.01, 1))
        link(nt, maprange(nt, ss.outputs['Red'], 0.0, 0.6, rough, 0.18), p.inputs['Roughness'])
    link(nt, col, p.inputs['Base Color']); link(nt, bump.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

M_STONE = stone_material('stone')
M_STONE_DARK = stone_material('stone_dark', tint=(0.8, 0.78, 0.74))
M_VAULT = stone_material('vault', courses=(0.42, 0.24), tint=(0.95, 0.93, 0.9), damp=False)
M_FLAG = stone_material('flagstone', courses=(0.6, 0.45), tint=(0.85, 0.85, 0.85))
M_MORTAR = principled('mortar', (0.05, 0.045, 0.04, 1), rough=0.95, noise_scale=20.0, noise_amt=0.5)
M_OAK = principled('oak', (0.12, 0.065, 0.03, 1), rough=0.6, noise_scale=4.0, noise_amt=0.5, bump=0.25, bump_scale=30.0)
M_IRON = principled('iron', (0.05, 0.045, 0.04, 1), rough=0.55, metal=0.85, noise_scale=12.0, noise_amt=0.6)

def gunmetal(name='gunmetal', base=(0.06, 0.065, 0.07, 1)):
    """Giger's material: oily gunmetal, near black, with a wet sheen and a green-bronze bloom in the hollows."""
    m, nt, out = mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = node(nt, 'ShaderNodeTexNoise', Scale=18.0, Detail=10.0, Roughness=0.7); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
    col = mix_rgb(nt, maprange(nt, nz.outputs['Fac'], 0.35, 0.7, 0.0, 1.0), (0.05, 0.06, 0.045, 1), base)
    p = node(nt, 'ShaderNodeBsdfPrincipled', Metallic=0.85, **{'Coat Weight': 0.6, 'Coat Roughness': 0.08})
    link(nt, col, p.inputs['Base Color']); link(nt, maprange(nt, nz.outputs['Fac'], 0.3, 0.7, 0.45, 0.22), p.inputs['Roughness'])
    b = node(nt, 'ShaderNodeBump', Strength=0.25, Distance=0.002); link(nt, nz.outputs['Fac'], b.inputs['Height']); link(nt, b.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

M_GUN = gunmetal()
M_BONE = principled('bone', (0.58, 0.52, 0.40, 1), rough=0.38, coat=0.35, noise_scale=14.0, noise_amt=0.3, bump=0.1, bump_scale=90.0)
M_GASKET = principled('gasket', (0.42, 0.10, 0.09, 1), rough=0.25, coat=1.0, sss=0.5, noise_scale=10.0, noise_amt=0.4)
M_WET = principled('wet', (0.02, 0.018, 0.012, 1), rough=0.08, coat=1.0)

def tatami_material():
    """Aged igusa straw: fine weave lines across the mat, faded green-gold, darker where feet go."""
    m, nt, out = mat('tatami')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['UV'], sep.inputs[0])
    wave = node(nt, 'ShaderNodeTexWave', Scale=1.0, Distortion=0.4, Detail=2.0); wave.wave_type = 'BANDS'; wave.bands_direction = 'X'
    vx = node(nt, 'ShaderNodeCombineXYZ'); link(nt, math_(nt, 'MULTIPLY', sep.outputs['X'], 160.0), vx.inputs['X']); link(nt, sep.outputs['Y'], vx.inputs['Y'])
    link(nt, vx.outputs[0], wave.inputs['Vector'])
    nz = node(nt, 'ShaderNodeTexNoise', Scale=2.5, Detail=6.0); link(nt, tc.outputs['Object'], nz.inputs['Vector'])
    col = mix_rgb(nt, nz.outputs['Fac'], (0.24, 0.20, 0.08, 1), (0.42, 0.40, 0.18, 1))
    col = mix_rgb(nt, mulw(nt, wave.outputs['Fac']), col, (0.16, 0.13, 0.05, 1))
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.62, **{'Specular IOR Level': 0.45})
    link(nt, col, p.inputs['Base Color'])
    b = node(nt, 'ShaderNodeBump', Strength=0.35, Distance=0.001); link(nt, wave.outputs['Fac'], b.inputs['Height']); link(nt, b.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

def mulw(nt, v): return math_(nt, 'MULTIPLY', v, 0.35)

M_TATAMI = tatami_material()
M_HERI = principled('heri', (0.02, 0.03, 0.025, 1), rough=0.7, noise_scale=40.0, noise_amt=0.3)

def image_material(name, path, rough=0.5, emit=0.0, alpha=False, coat=0.0, sheen=0.0, scale=None, uvmap=True):
    m, nt, out = mat(name)
    t = image(nt, path)
    if scale:
        tc = nt.nodes.new('ShaderNodeTexCoord'); mp = node(nt, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale
        link(nt, tc.outputs['UV'], mp.inputs['Vector']); link(nt, mp.outputs[0], t.inputs['Vector'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=rough, **{'Coat Weight': coat, 'Sheen Weight': sheen})
    link(nt, t.outputs['Color'], p.inputs['Base Color'])
    if alpha: link(nt, t.outputs['Alpha'], p.inputs['Alpha'])
    if emit > 0:
        link(nt, t.outputs['Color'], p.inputs['Emission Color']); p.inputs['Emission Strength'].default_value = emit
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

M_QUILT = image_material('quilt', os.path.join(TEX, 'quilt.png'), rough=0.9, sheen=0.6, scale=(3.0, 3.0, 1))
M_POSTERS = {k: image_material('poster_' + k, os.path.join(TEX, f'poster-{k}.png'), rough=0.35, coat=0.2) for k in ('gobchan', 'eyes', 'blood')}
M_STICKER = image_material('sticker', os.path.join(TEX, 'sticker.png'), rough=0.3, alpha=True, coat=0.5)
M_PAD = image_material('mousepad', os.path.join(TEX, 'mousepad.png'), rough=0.7)

def plush(name, color): return principled(name, color, rough=0.95, sheen=1.0, noise_scale=80.0, noise_amt=0.12)
def plastic(name, color, rough=0.25): return principled(name, color, rough=rough, coat=0.5)

# ======================================================================== the walls: ashlar
def wall_hole_for(regions):
    """regions: functions z -> forbidden half-interval (lo, hi) along the wall or None. Returns, for a row spanning
    [za, zb], the forbidden intervals (sampled over the row's height)."""
    def holes(za, zb):
        res = []
        for f in regions:
            lo, hi = 1e9, -1e9
            for k in range(7):
                iv = f(za + (zb - za) * k / 6)
                if iv: lo, hi = min(lo, iv[0]), max(hi, iv[1])
            if lo < hi: res.append((lo, hi))
        return res
    return holes

def subtract(a, b, holes):
    segs = [(a, b)]
    for lo, hi in holes:
        nxt = []
        for s0, s1 in segs:
            if hi <= s0 or lo >= s1: nxt.append((s0, s1)); continue
            if lo > s0: nxt.append((s0, lo))
            if hi < s1: nxt.append((hi, s1))
        segs = nxt
    return segs

def ashlar(name, axis, plane, inward, u0, u1, z0, z1, top=None, holes=None, depth=0.16, seed=1, mat_=None, hole_rect=None):
    """Blocks on one wall. axis 'x': the wall runs along x at y=plane; 'y': along y at x=plane. inward: +-1, the room
    side along the wall normal. top(u): the highest z at u (an end wall under the vault)."""
    rnd = random.Random(seed)
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand')
    gap = 0.011
    z = z0
    while z < z1 - 0.05:
        h = rnd.uniform(0.17, 0.34)
        if z + h > z1 - 0.06: h = z1 - z
        u = u0 - rnd.uniform(0.0, 0.35)
        while u < u1:
            L = rnd.uniform(0.24, 0.7)
            a, b = max(u, u0), min(u + L, u1)
            u += L
            if b - a < 0.06: continue
            for s0, s1 in subtract(a, b, holes(z, z + h) if holes else []):
                if s1 - s0 < 0.07: continue
                hh = h
                if top:
                    tmax = min(top(s0), top(s1), top((s0 + s1) / 2))
                    if z + 0.07 > tmax: continue
                    hh = min(h, tmax - z + 0.08)          # let the top course run up into the vault
                prot = rnd.uniform(-0.008, 0.026)
                n = plane + inward * (prot - depth / 2)
                c = ((s0 + s1) / 2, n, z + hh / 2) if axis == 'x' else (n, (s0 + s1) / 2, z + hh / 2)
                s = (s1 - s0 - gap, depth, hh - gap) if axis == 'x' else (depth, s1 - s0 - gap, hh - gap)
                rot = Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Z' if axis == 'x' else 'Y') @ Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Y' if axis == 'x' else 'X')
                bm_cube(bm, c, s, rot, lay, rnd.random())
        z += h
    o = obj_from_bm(name, bm, mat_ or M_STONE, bevel=0.022, segs=3)
    # mortar behind the blocks, around one rectangular hole (the window, the niche)
    zt = (top(0.0) + 0.4) if top else z1 + 0.1
    rects = [(u0 - 0.1, u1 + 0.1, z0, zt)]
    if hole_rect:
        a, b, c, d = hole_rect
        rects = [(u0 - 0.1, a, z0, zt), (b, u1 + 0.1, z0, zt), (a, b, z0, c), (a, b, d, zt)]
    for k, (a, b, c, d) in enumerate(rects):
        if axis == 'x': box(f'{name}_mortar{k}', ((a + b) / 2, plane - inward * 0.05, (c + d) / 2), (b - a, 0.04, d - c), M_MORTAR)
        else: box(f'{name}_mortar{k}', (plane - inward * 0.05, (a + b) / 2, (c + d) / 2), (0.04, b - a, d - c), M_MORTAR)
    return o

NWALL_W, WALL_H = X1 - X0 + 0.2, 2.7
M_STONE_N = stone_material('stone_n', stain=(stain_map('stain_n', NWALL_W, WALL_H, [
    (WX - 0.32 - X0 + 0.1, WS - 0.08, 0.05, 0.55, 0.9), (WX + 0.32 - X0 + 0.1, WS - 0.08, 0.05, 0.5, 0.8),   # the sill weeps
    (-1.0 - X0 + 0.1, 1.6, 0.06, 0.75, 0.9),             # the fridge conduit's collar
    (0.74 - X0 + 0.1, 0.5, 0.04, 0.4, 0.8),              # the umbilicus's socket
    (X1 - 0.12 - X0 + 0.1, 2.2, 0.08, 1.5, 1.0),         # the corner duct
    (0.0 - X0 + 0.1, 2.42, 0.1, 1.0, 0.9)], seed=1), 'x', X0 - 0.1, NWALL_W, WALL_H))
M_STONE_E = stone_material('stone_e', stain=(stain_map('stain_e', Y1 + 0.2, WALL_H, [
    (3.3 + 0.1, 1.15, 0.07, 0.4, 1.0), (3.2 + 0.1, 1.9, 0.05, 0.6, 0.8), (Y1 - 0.12 + 0.1, 2.0, 0.07, 1.4, 1.0), (0.5 + 0.1, 1.9, 0.05, 0.9, 0.6)], seed=2),
    'y', Y0 - 0.1, Y1 + 0.2, WALL_H))
M_STONE_W = stone_material('stone_w', stain=(stain_map('stain_w', Y1 + 0.2, WALL_H, [
    (2.3 + 0.1, 1.8, 0.06, 1.7, 1.0), (2.77 + 0.1, 0.88, 0.1, 0.5, 0.6), (1.0 + 0.1, 1.9, 0.05, 0.8, 0.5)], seed=3),
    'y', Y0 - 0.1, Y1 + 0.2, WALL_H))
# The window's quoin band and voussoir ring keep regular courses away from the opening.
QB, VB = 0.26, 0.24
def window_region(z):
    if WS - 0.14 <= z <= WSP: return (WX - WH - QB, WX + WH + QB)
    if WSP < z <= WSP + WH + VB:
        hw = math.sqrt(max(0.0, (WH + VB) ** 2 - (z - WSP) ** 2))
        hw = max(hw, WH + QB) if z < WSP + 0.12 else hw
        return (WX - hw, WX + hw)
    return None
NICHE = (2.42, 3.12, 0.92, 1.62)      # the west wall niche: y0, y1, z0, z1 (a round arch on top)
def niche_region(z):
    y0, y1, z0, z1 = NICHE
    if z0 - 0.04 <= z <= z1 + 0.04: return (y0 - 0.02, y1 + 0.02)
    return None

ashlar('wall_w', 'y', X0, +1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, holes=wall_hole_for([niche_region]), seed=2, mat_=M_STONE_W, hole_rect=(NICHE[0], NICHE[1], NICHE[2], NICHE[3]))
ashlar('wall_e', 'y', X1, -1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, seed=3, mat_=M_STONE_E)
ashlar('wall_n', 'x', Y1, -1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, top=vault_z, holes=wall_hole_for([window_region]), seed=4, mat_=M_STONE_N, hole_rect=(WX - WH, WX + WH, WS - 0.1, WSP + WH))
ashlar('wall_s', 'x', Y0, +1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, top=vault_z, seed=5)

# The impost: a moulded string course where the vault springs, along both side walls.
for sx, nm in ((-1, 'w'), (1, 'e')):
    box(f'impost_{nm}', (sx * (X1 - 0.03), Y1 / 2, SPRING - 0.045), (0.12, Y1 + 0.2, 0.09), M_STONE_DARK, bevel=0.02)
    box(f'impost2_{nm}', (sx * (X1 - 0.01), Y1 / 2, SPRING - 0.11), (0.07, Y1 + 0.2, 0.05), M_STONE_DARK, bevel=0.012)

# The vault: a segmental barrel, coursed stone (UV in metres).
def vault():
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    nx, ny = 64, 40
    a0 = math.asin((X1 + 0.08) / RV)
    grid = []
    for j in range(ny + 1):
        y = Y0 - 0.12 + (Y1 - Y0 + 0.24) * j / ny; row = []
        for i in range(nx + 1):
            a = -a0 + 2 * a0 * i / nx
            row.append(bm.verts.new((RV * math.sin(a), y, CZ + RV * math.cos(a))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                a = -a0 + 2 * a0 * ii / nx
                l[uvl].uv = (RV * a, Y0 - 0.12 + (Y1 - Y0 + 0.24) * jj / ny)
    o = obj_from_bm('vault', bm, M_VAULT, smooth=True)
    return o
vault()

# Transverse ribs (stone arches) across the vault, on corbels.
def rib(y, w=0.17, d=0.11, n=11, seed=0):
    rnd = random.Random(seed)
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand')
    a0 = math.asin((X1 - 0.02) / RV)
    for k in range(n):
        a = -a0 + 2 * a0 * (k + 0.5) / n
        L = 2 * a0 / n * (RV - d / 2) - 0.012
        c = (math.sin(a) * (RV - d / 2), y, CZ + math.cos(a) * (RV - d / 2))
        rot = Matrix.Rotation(a, 3, 'Y')
        bm_cube(bm, c, (L, w, d), rot, lay, rnd.random())
    obj_from_bm(f'rib_{y:.1f}', bm, M_STONE_DARK, bevel=0.012)
    for sx in (-1, 1):   # corbels: three stepped stones
        for k, (wd, ht, z) in enumerate(((0.12, 0.07, SPRING - 0.2), (0.09, 0.06, SPRING - 0.27), (0.06, 0.05, SPRING - 0.33))):
            box(f'corbel_{y:.1f}_{sx}_{k}', (sx * (X1 - wd / 2), y, z), (wd, w + 0.02 - k * 0.03, ht), M_STONE_DARK, bevel=0.01)
RIBS = (0.9, 1.8, 2.7)
for i, y in enumerate(RIBS):
    if y != 1.8: rib(y, seed=10 + i)
def giger_rib(y):
    """The gothic rib turned Giger's: the same arch, made of vertebrae, spines hanging into the room."""
    a0 = math.asin((X1 - 0.03) / RV)
    pts = [(math.sin(a) * (RV - 0.07), y, CZ + math.cos(a) * (RV - 0.07)) for a in [-a0 + 2 * a0 * k / 12 for k in range(13)]]
    vertebral(f'giger_rib_{y}', pts, 0.05, lambda p: Vector((-p.x, 0, -(p.z - CZ))).normalized(), ring_every=0.05, spine_every=2)
    for sx in (-1, 1):
        sphere(f'bone_corbel{sx}', (sx * (X1 - 0.07), y, SPRING - 0.2), 0.09, M_BONE, scale=(0.9, 1.0, 1.25))
        cyl(f'bone_corbel_hook{sx}', (sx * (X1 - 0.13), y, SPRING - 0.32), 0.03, 0.14, M_BONE, r2=0.0, rot=(0, math.radians(sx * -150), 0), verts=12)

# ======================================================================== the window
def voussoirs():
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(9)
    n = 9; r0, r1 = WH, WH + VB; yA, yB = Y1 - 0.02, Y1 + 0.17
    for k in range(n):
        a0 = math.pi * k / n + 0.006; a1 = math.pi * (k + 1) / n - 0.006
        rr = r1 + rnd.uniform(-0.03, 0.02)
        pts = [(WX + math.cos(a) * r, WSP + math.sin(a) * r) for a, r in ((a0, r0), (a1, r0), (a1, rr), (a0, rr))]
        vs = [bm.verts.new((x, yA, z)) for x, z in pts] + [bm.verts.new((x, yB, z)) for x, z in pts]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        rv = rnd.random()
        for f in faces:
            ff = bm.faces.new([vs[i] for i in f]); ff[lay] = rv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj_from_bm('voussoirs', bm, M_STONE_N, bevel=0.012)
voussoirs()

def quoins():
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(12)
    for sx in (-1, 1):
        z = WS - 0.12
        while z < WSP - 0.02:
            h = min(rnd.uniform(0.2, 0.27), WSP - z)
            c = (WX + sx * (WH + QB / 2), Y1 + 0.09, z + h / 2)
            bm_cube(bm, c, (QB - 0.012, 0.2, h - 0.012), None, lay, rnd.random())
            z += h
    obj_from_bm('quoins', bm, M_STONE_N, bevel=0.012)
quoins()
box('sill', (WX, Y1 + 0.29, WS - 0.05), (2 * WH + 0.16, 0.66, 0.1), M_STONE_DARK, bevel=0.015)
box('sill_lip', (WX, Y1 - 0.06, WS - 0.075), (2 * WH + 0.24, 0.1, 0.07), M_STONE_DARK, bevel=0.015)
for sx in (-1, 1):  # the embrasure's reveals
    box(f'reveal{sx}', (WX + sx * (WH + 0.1), Y1 + WDEPTH / 2, (WS + WSP) / 2), (0.2, WDEPTH, WSP - WS + 0.02), M_VAULT)

def soffit():
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    n = 24; rows = []
    for yy in (Y1 - 0.02, Y1 + WDEPTH):
        rows.append([bm.verts.new((WX + math.cos(math.pi * k / n) * WH, yy, WSP + math.sin(math.pi * k / n) * WH)) for k in range(n + 1)])
    for k in range(n):
        f = bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
        for l, (kk, jj) in zip(f.loops, ((k, 0), (k, 1), (k + 1, 1), (k + 1, 0))):
            l[uvl].uv = (WH * math.pi * kk / n, jj * WDEPTH)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.normal_flip()
    obj_from_bm('soffit', bm, M_VAULT, smooth=True)
soffit()

def in_opening(x, z, pad=0.0):
    if WS - pad <= z <= WSP: return abs(x - WX) <= WH - pad
    if z > WSP: return (x - WX) ** 2 + (z - WSP) ** 2 <= (WH - pad) ** 2
    return False

def lattice(yy=Y1 + 0.42, step=0.115, bar=0.011):
    """A diamond lattice of iron bars clipped to the arch (leaded-window lines with the glass gone)."""
    bm = bmesh.new()
    for dirn in (1, -1):
        for k in range(-14, 15):
            # line: z = WS + dirn * (x - WX) + k * step * sqrt2
            off = k * step * math.sqrt(2)
            inside, start = False, None
            xs = [WX - WH - 0.05 + i * 0.004 for i in range(int((2 * WH + 0.1) / 0.004) + 1)]
            for x in xs + [None]:
                ok = x is not None and in_opening(x, WS + dirn * (x - WX) + off + WH, pad=0.004)
                if ok and not inside: start = x; inside = True
                if not ok and inside:
                    x1 = x - 0.004 if x is not None else xs[-1]
                    a = Vector((start, yy, WS + dirn * (start - WX) + off + WH)); b = Vector((x1, yy, WS + dirn * (x1 - WX) + off + WH))
                    L = (b - a).length
                    if L > 0.01:
                        bm_cube(bm, (a + b) / 2, (L, bar, bar), Matrix.Rotation(-math.atan2(b.z - a.z, b.x - a.x), 3, 'Y'))
                    inside = False
    obj_from_bm('lattice', bm, M_IRON)
    # the frame strap round the opening
    pts = [(WX - WH + 0.005, yy, WS)] + [(WX + math.cos(math.pi - math.pi * k / 16) * (WH - 0.005), yy, WSP + math.sin(math.pi * k / 16) * (WH - 0.005)) for k in range(17)] + [(WX + WH - 0.005, yy, WS)]
    tube('lattice_frame', pts, [0.012] * len(pts), M_IRON)
lattice()

# ======================================================================== the floor: flagstones and six tatami
box('flagstones', (0, Y1 / 2, -0.05), (X1 - X0 + 0.3, Y1 + 0.3, 0.1), M_FLAG)
def tatami(name, x0, x1, y0, y1, long_axis):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, 0.0275))
    o = bpy.context.active_object; o.name = name; o.scale = (x1 - x0 - 0.004, y1 - y0 - 0.004, 0.055)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.uv.cube_project(cube_size=1.0); bpy.ops.object.mode_set(mode='OBJECT')
    if long_axis == 'x':   # weave lines run across the long axis: rotate the UVs
        for l in o.data.uv_layers.active.data: l.uv = (l.uv[1], l.uv[0])
    o.data.materials.append(M_TATAMI)
    b = o.modifiers.new('bev', 'BEVEL'); b.width = 0.006; b.segments = 2
    # heri: the cloth borders along the long edges
    if long_axis == 'y':
        for x in (x0 + 0.02, x1 - 0.02): box(name + f'_heri{x:.2f}', (x, (y0 + y1) / 2, 0.056), (0.034, y1 - y0 - 0.01, 0.004), M_HERI)
    else:
        for y in (y0 + 0.02, y1 - 0.02): box(name + f'_heri{y:.2f}', ((x0 + x1) / 2, y, 0.056), (x1 - x0 - 0.01, 0.034, 0.004), M_HERI)
tatami('tat_a', -1.35, -0.45, 0.0, 1.8, 'y')
tatami('tat_b', -1.35, -0.45, 1.8, 3.6, 'y')
tatami('tat_c', -0.45, 1.35, 0.0, 0.9, 'x')
tatami('tat_d', -0.45, 0.62, 2.7, 3.6, 'x')        # cut short: the kitchen's stone floor shows past it
tatami('tat_e', -0.45, 0.45, 0.9, 2.7, 'y')
tatami('tat_f', 0.45, 1.35, 0.9, 2.7, 'y')
FLOOR = 0.055

# ======================================================================== Giger: vertebral conduits
def vertebral(name, pts, r, away, ring_every=0.045, spine_every=3, collar=None, mat_core=None, mat_ring=None, spines=True):
    """A ribbed conduit: a gunmetal core with vertebra rings every ring_every m and dorsal spines pointing away from
    the surface it clings to (away: a vector, or a function of the position)."""
    samples = resample(catmull(pts, 16), ring_every)
    tube(name, [p for p, _ in catmull(pts, 4)], [r] * len(catmull(pts, 4)), mat_core or M_GUN, res=3)
    bm = bmesh.new(); bm2 = bmesh.new()
    for k, (p, t) in enumerate(samples[1:-1]):
        q = t.to_track_quat('Z', 'Y').to_matrix()
        M = Matrix.Translation(p) @ q.to_4x4()
        ringr = r * (1.42 if k % 2 == 0 else 1.25)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=ringr, radius2=ringr * 0.92, depth=r * 0.55, matrix=M)
        if spines and k % spine_every == 0:
            a = away(p) if callable(away) else Vector(away)
            a = (a - t * a.dot(t)).normalized()
            base = p + a * ringr * 0.85
            q2 = a.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            L = r * random.uniform(1.4, 2.3)
            bmesh.ops.create_cone(bm2, cap_ends=True, segments=8, radius1=r * 0.45, radius2=0.0005, depth=L,
                                  matrix=Matrix.Translation(base + a * L / 2) @ q2)
    o = obj_from_bm(name + '_rings', bm, mat_ring or M_BONE, smooth=True)
    if spines: obj_from_bm(name + '_spines', bm2, mat_ring or M_BONE, smooth=True)
    if collar:   # the fleshy grommet where it enters the stone
        p, n = Vector(collar[0]), Vector(collar[1])
        q = n.to_track_quat('Z', 'Y').to_euler()
        torus(name + '_collar', p, r * 1.55, r * 0.55, M_GASKET, rot=q, scale=(1, 1, 0.7))
    return o

DOWN = (0, 0, -1)
for sx, x in ((-1, -0.62), (1, 0.58)):
    z = vault_z(x) - 0.09
    pts = [(x, -0.1, z), (x, 0.45, z)]
    for y in RIBS: pts += [(x, y, z - 0.075), (x, y + 0.45, z)]
    pts[-1] = (x, Y1 + 0.1, z)
    vertebral(f'vault_conduit{sx}', pts, 0.032, lambda p: Vector((0, 0, -1)))
    for y in RIBS:     # bone clamps where they pass under the ribs
        torus(f'clamp{sx}_{y}', (x, y, z - 0.075), 0.05, 0.016, M_BONE, rot=(math.pi / 2, 0, 0))
giger_rib(1.8)
for k, dx in enumerate((-0.085, 0.0, 0.085)):      # a bundle of three along the crown, sagging between the ribs
    x = dx; z = vault_z(x) - 0.06 - 0.01 * k
    pts = [(x, -0.1, z)]
    for y0_, y1_ in zip((0.0, 0.9, 1.8, 2.7), (0.9, 1.8, 2.7, 3.6)):
        pts += [((x * 1.4), (y0_ + y1_) / 2, z - 0.12 - 0.03 * k), (x, y1_, z - 0.02)]
    pts[-1] = (x, Y1 + 0.1, z)
    vertebral(f'crown_bundle{k}', pts, 0.022 + 0.005 * (k == 1), lambda p: Vector((0, 0, -1)), ring_every=0.04, spine_every=4)
for y in (0.0 + 0.03, Y1 - 0.03):
    torus(f'crown_collar{int(y * 100)}', (0, y, vault_z(0) - 0.09), 0.13, 0.04, M_GASKET, rot=(math.pi / 2, 0, 0), scale=(1.1, 0.8, 1))
vertebral('ne_duct', [(X1 - 0.12, Y1 - 0.12, vault_z(X1 - 0.12) - 0.05), (X1 - 0.11, Y1 - 0.11, 1.5), (X1 - 0.1, Y1 - 0.11, 1.0), (X1 - 0.13, Y1 - 0.1, 0.84)], 0.065,
          lambda p: Vector((-1, -1, 0)), ring_every=0.07, spine_every=2, collar=((X1 - 0.12, Y1 - 0.12, vault_z(X1 - 0.12) - 0.08), (0, 0, -1)))
# One drops from the vault down the east wall into the boiler.
vertebral('to_boiler', [(0.58, 2.95, vault_z(0.58) - 0.13), (0.95, 3.12, vault_z(0.95) - 0.1), (1.24, 3.22, 1.86), (1.24, 3.25, 1.66)], 0.03,
          lambda p: Vector((-1, 0, -0.3)))
# One down the west wall into the floor behind the futon.
vertebral('west_drop', [(-1.29, 2.3, SPRING - 0.12), (-1.27, 2.28, 1.3), (-1.29, 2.32, 0.5), (-1.25, 2.36, 0.08), (-1.15, 2.38, FLOOR + 0.02)], 0.036,
          lambda p: Vector((1, 0, 0)), collar=((-1.29, 2.3, SPRING - 0.15), (0, 0, -1)))
# One down the north wall into the fridge.
vertebral('to_fridge', [(-1.0, Y1 - 0.06, CROWN - 0.3), (-1.02, Y1 - 0.07, 1.4), (-1.0, Y1 - 0.09, 0.98)], 0.028,
          lambda p: Vector((0, -1, 0)), collar=((-1.0, Y1 - 0.04, 1.62), (0, -1, 0)))

# The boiler: a ribbed lung on the east wall over the stone sink.
def boiler(c):
    x, y, z = c
    for k in range(13):
        zz = z - 0.26 + k * 0.042
        rr = 0.13 + 0.02 * math.sin(k / 12 * math.pi)
        torus(f'boiler_rib{k}', (x, y, zz), rr, 0.016, M_GUN)
    cyl('boiler_core', (x, y, z), 0.13, 0.56, M_GUN)
    sphere('boiler_top', (x, y, z + 0.28), 0.13, M_BONE, scale=(1, 1, 0.55))
    sphere('boiler_bot', (x, y, z - 0.28), 0.12, M_GUN, scale=(1, 1, 0.5))
    vertebral('boiler_out', [(x, y, z - 0.33), (x - 0.04, y - 0.02, z - 0.48), (x - 0.18, y - 0.08, 0.86)], 0.022, lambda p: Vector((-1, 0, 0)))
    # rust and wet streaks run down the stone below it
boiler((1.2, 3.3, 1.38))

# ======================================================================== the kitchenette (NE): a castle sink in a stone counter
box('counter', (1.07, 3.33, 0.39), (0.56, 0.52, 0.78), M_STONE_DARK, bevel=0.02)
box('counter_top', (1.07, 3.31, 0.80), (0.6, 0.58, 0.05), M_STONE, bevel=0.015)
cyl('basin', (0.98, 3.33, 0.79), 0.15, 0.06, M_WET, verts=32)

# ======================================================================== the kotatsu
M_KOTATSU = principled('kotatsu_board', (0.32, 0.17, 0.08, 1), rough=0.3, coat=0.6, noise_scale=8.0, noise_amt=0.35)
box('kotatsu_board', (KX, KY, KTOP - 0.0125), (0.82, 0.82, 0.025), M_KOTATSU, bevel=0.006)

BONES = json.load(open(os.path.join(GOB, 'bones-kotatsu.json')))['posed']
def gb(p):   # game frame (x, y up, +z forward) at the goblin's root -> Blender world (facing +y)
    return Vector((GX - p[0], GY + p[2], p[1] + GOB_DZ))
GOB_DZ = 0.0   # set once the mesh is placed

def kotatsu_quilt(legs):
    """The kotatsu-buton: a 1.9 m square heightfield, flat on the frame under the board, dropping steeply at the table
    edge, lying out on the tatami in soft folds, and riding up over the goblin's thighs where they go in."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    n = 120; S = 1.9; grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = i / n, j / n
            x, y = KX + (u - 0.5) * S, KY + (v - 0.5) * S
            dx, dy = abs(x - KX) - 0.41, abs(y - KY) - 0.41
            d = max(dx, dy) if max(dx, dy) > 0 else max(dx, dy)
            top = KTOP - 0.03
            if d <= 0: h = top - 0.005 * (1 - math.exp(d * 30))
            else:
                ang = math.atan2(y - KY, x - KX)
                fold = 0.012 * math.sin(ang * 14 + 1.3) + 0.008 * noise.noise(Vector((x * 6, y * 6, 0)))
                drop = top * (1 - smoothstep(0.0, 0.16, d))
                h = max(FLOOR + 0.012 + max(0.0, fold) * smoothstep(0.1, 0.3, d), drop + fold * smoothstep(0.0, 0.08, d))
            p = Vector((x, y, 0))
            for a, b, r in legs:    # ride over the thighs
                ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)) if ab.length_squared > 0 else 0
                q = a + ab * t; dd = Vector((p.x - q.x, p.y - q.y, 0)).length
                if dd < r + 0.07:
                    cap = q.z + math.sqrt(max(0.0, (r + 0.025) ** 2 - dd * dd)) if dd < r + 0.025 else q.z + 0.0
                    lift = q.z + r + 0.025 - (dd - r - 0.025) * 0.9 if dd >= r + 0.025 else cap
                    h = max(h, lift)
            row.append(bm.verts.new((x, y, h)))
        grid.append(row)
    for j in range(n):
        for i in range(n):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (ii / n, jj / n)
    o = obj_from_bm('kotatsu_quilt', bm, M_QUILT, smooth=True)
    s = o.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.02; s.offset = -1

# ======================================================================== the goblin, in vest and shorts
def goblin_material():
    m, nt, out = mat('goblin_sdf')
    vc = nt.nodes.new('ShaderNodeVertexColor'); tc = nt.nodes.new('ShaderNodeTexCoord')
    BASE, MOTTLE, CHAR = (0.22, 0.55, 0.025, 1), (0.05, 0.085, 0.008, 1), (0.012, 0.018, 0.006, 1)
    mz = node(nt, 'ShaderNodeTexNoise', Scale=7.0, Detail=4.0, Roughness=0.55); link(nt, tc.outputs['Object'], mz.inputs['Vector'])
    skin = mix_rgb(nt, maprange(nt, mz.outputs['Fac'], 0.45, 0.6, 0.0, 0.8), BASE, MOTTLE)
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.05
    skin = mix_rgb(nt, maprange(nt, ao.outputs['AO'], 0.35, 1.0, 0.85, 0.0), skin, CHAR)
    dv = node(nt, 'ShaderNodeVectorMath', _operation='DISTANCE'); link(nt, vc.outputs['Color'], dv.inputs[0]); dv.inputs[1].default_value = (0.34, 0.44, 0.19)
    col = mix_rgb(nt, maprange(nt, dv.outputs['Value'], 0.05, 0.12, 0.0, 1.0), skin, vc.outputs['Color'])
    pits = node(nt, 'ShaderNodeTexVoronoi', Scale=420.0); link(nt, tc.outputs['Object'], pits.inputs['Vector'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Coat Weight': 0.45, 'Coat Roughness': 0.22, 'Subsurface Weight': 0.3,
        'Subsurface Radius': (1.0, 0.35, 0.15), 'Subsurface Scale': 0.02, 'Specular IOR Level': 0.6})
    link(nt, col, p.inputs['Base Color']); link(nt, maprange(nt, pits.outputs['Distance'], 0.0, 0.35, 0.8, 0.3), p.inputs['Roughness'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.3, Distance=0.002); link(nt, pits.outputs['Distance'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

def vest_material():
    """A ribbed cotton singlet, once white: yellowed, sweat-stained under the arms and down the front, a few drips."""
    m, nt, out = mat('vest')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
    rib = node(nt, 'ShaderNodeTexWave', Scale=1.0, Distortion=0.0); rib.wave_type = 'BANDS'; rib.bands_direction = 'X'
    vx = node(nt, 'ShaderNodeCombineXYZ'); link(nt, math_(nt, 'MULTIPLY', sep.outputs['X'], 260.0), vx.inputs['X'])
    link(nt, vx.outputs[0], rib.inputs['Vector'])
    st = node(nt, 'ShaderNodeTexNoise', Scale=9.0, Detail=8.0, Roughness=0.6); link(nt, tc.outputs['Object'], st.inputs['Vector'])
    stain = maprange(nt, st.outputs['Fac'], 0.52, 0.62, 0.0, 0.85)
    col = mix_rgb(nt, stain, (0.9, 0.88, 0.8, 1), (0.6, 0.48, 0.22, 1))
    sp = node(nt, 'ShaderNodeTexVoronoi', Scale=30.0); link(nt, tc.outputs['Object'], sp.inputs['Vector'])
    col = mix_rgb(nt, maprange(nt, sp.outputs['Distance'], 0.0, 0.08, 0.7, 0.0), col, (0.25, 0.05, 0.03, 1))   # a few dark spots
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.9, **{'Sheen Weight': 0.5})
    link(nt, col, p.inputs['Base Color'])
    b = node(nt, 'ShaderNodeBump', Strength=0.4, Distance=0.001); link(nt, rib.outputs['Fac'], b.inputs['Height']); link(nt, b.outputs['Normal'], p.inputs['Normal'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

def shorts_material():
    """Boxer shorts, faded sky blue with white polka dots (bought because they were cute)."""
    m, nt, out = mat('shorts')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vo = node(nt, 'ShaderNodeTexVoronoi', Scale=38.0); vo.feature = 'F1'; vo.inputs['Randomness'].default_value = 0.0
    link(nt, tc.outputs['Object'], vo.inputs['Vector'])
    dots = maprange(nt, vo.outputs['Distance'], 0.16, 0.2, 1.0, 0.0)
    col = mix_rgb(nt, dots, (0.30, 0.52, 0.72, 1), (0.92, 0.92, 0.88, 1))
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.85, **{'Sheen Weight': 0.4}); link(nt, col, p.inputs['Base Color'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

M_GOBLIN = goblin_material(); M_VEST = vest_material(); M_SHORTS = shorts_material()

def seg_dist(p, a, d, L):
    t = max(0.0, min(L, (p - a).dot(d))); return (p - (a + d * t)).length, t / L if L > 0 else 0

def goblin():
    global GOB_DZ
    bpy.ops.wm.ply_import(filepath=os.path.join(GOB, 'goblin-kotatsu.ply'))
    o = bpy.context.active_object; o.name = 'goblin'; o.data.materials.append(M_GOBLIN)
    # Seat it: the lowest point of the butt (game y < 0.75, near the root) rests on the zabuton.
    seat = min(v.co.y for v in o.data.vertices if v.co.y < 0.75 and abs(v.co.z) < 0.15 and abs(v.co.x) < 0.15)
    SEAT_TOP = FLOOR + 0.075
    GOB_DZ = SEAT_TOP + 0.01 - seat
    o.rotation_euler = (math.radians(90), 0, math.radians(180))
    o.location = (GX, GY, GOB_DZ)
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons: p.use_smooth = True
    # Bones -> world.
    H, Dd, L = BONES['heads'], BONES['dirs'], BONES['lengths']
    segs = {}
    for k in H:
        b = k.split('.')[0]
        a = gb(H[k]); dv = Vector((-Dd[k][0], Dd[k][2], Dd[k][1])).normalized()
        segs[k] = (a, dv, L.get(b, 0.1))
    # Classify vertices by nearest bone: the vest (torso), the shorts (pelvis and the top of the thighs).
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table(); bm.normal_update()
    vest, shorts = set(), set(); sgn = [0, 0]
    chest_top = segs['chest'][0] + segs['chest'][1] * segs['chest'][2]
    for v in bm.verts:
        best, bk, bt = 9, None, 0
        for k, (a, dv, Lb) in segs.items():
            if k in ('skull', 'neck') or k.startswith(('hand', 'foot', 'forearm', 'shin')): pass
            dd, t = seg_dist(v.co, a, dv, Lb)
            if dd < best: best, bk, bt, bq = dd, k, t, a + dv * (t * Lb)
        if bk is None: continue
        sgn[v.normal.dot(v.co - bq) > 0] += 1
        root = bk.split('.')[0]
        if root in ('spine1', 'chest', 'pelvis'):
            if root == 'pelvis' and bt < 0.45 and v.co.z < segs['pelvis'][0].z + 0.03: shorts.add(v.index); continue
            # the singlet's scoop neck and its straps
            if root == 'chest' and bt > 0.72:
                lx = abs(v.co.x - GX)
                if not (0.03 < lx < 0.075): continue
                if (v.co - chest_top).length < 0.05: continue
            vest.add(v.index)
        elif root == 'clavicle' and v.co.z > segs[bk][0].z - 0.005:
            vest.add(v.index)                                  # the straps over the shoulders
        elif root == 'thigh' and bt < 0.42:
            shorts.add(v.index)
    print('CLOTH vest', len(vest), 'shorts', len(shorts), 'normals in/out', sgn)
    if sgn[0] > sgn[1]: off_sign = -1.0
    else: off_sign = 1.0
    def shell(name, keep, off, m):
        b2 = bm.copy(); b2.verts.ensure_lookup_table()
        kill = [b2.verts[i] for i in range(len(b2.verts)) if i not in keep]
        bmesh.ops.delete(b2, geom=kill, context='VERTS')
        b2.normal_update()
        for v in b2.verts: v.co += v.normal * off * off_sign
        for _ in range(2):
            bmesh.ops.smooth_vert(b2, verts=[v for v in b2.verts if v.is_boundary], factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        so = obj_from_bm(name, b2, m, smooth=True)
        sm = so.modifiers.new('sol', 'SOLIDIFY'); sm.thickness = 0.003; sm.offset = 1
        return so
    shell('vest', vest, 0.006, M_VEST)
    shell('shorts', shorts, 0.012, M_SHORTS)
    bm.free()
    return segs

M_ZABUTON = principled('zabuton', (0.10, 0.12, 0.30, 1), rough=0.85, sheen=0.6, noise_scale=30.0, noise_amt=0.2)
z = box('zabuton', (GX, GY + 0.02, FLOOR + 0.035), (0.5, 0.52, 0.07), M_ZABUTON, bevel=0.03)
SEGS = goblin()
legs = []
for s in ('.l', '.r'):
    a, dv, L = SEGS['thigh' + s]; legs.append((a, a + dv * L, 0.06))
    a2, dv2, L2 = SEGS['shin' + s]; legs.append((a2, a2 + dv2 * L2, 0.05))
kotatsu_quilt(legs)
HANDS = [SEGS['hand' + s][0] + SEGS['hand' + s][1] * SEGS['hand' + s][2] for s in ('.l', '.r')]
print('hands', HANDS, 'goblin dz', GOB_DZ)

# ======================================================================== the Giger iMac (machine stage 3)
IM_FRONT = KY - 0.06                 # the face's plane (y)
IM_Z = KTOP + 0.235                  # the face's centre height
IM_LEN = 0.56                        # front face to the tip of the cranium
IM_W, IM_H = 0.185, 0.18             # half width, half height at the face

def im_profile(s):
    """Along the body (s 0 = face, 1 = the cranium's tip): half width, top and bottom (relative to IM_Z), exponent."""
    edge = 0.86 + 0.14 * math.sqrt(min(1.0, s / 0.05))                 # the face's rounded rim
    hw = IM_W * edge * (math.sqrt(max(0.0, 1 - ((s - 0.28) / 0.72) ** 2)) if s > 0.28 else 1.0)
    top = IM_H * edge * (math.sqrt(max(0.0, 1 - ((s - 0.22) / 0.78) ** 2)) if s > 0.22 else 1.0)
    top += 0.022 * math.exp(-((s - 0.42) / 0.16) ** 2)                 # the cranium swells behind the face
    bot = -IM_H * edge * (math.sqrt(max(0.0, 1 - ((s - 0.12) / 0.88) ** 2)) if s > 0.12 else 1.0)
    bot = bot * (1 - 0.35 * s) + 0.05 * s                                # the tip lifts: a teardrop that sweeps back and up
    return max(hw, 0.0005), top, min(bot, top - 0.001), 3.4 - 1.5 * s

def im_point(s, a, inset=0.0):
    hw, top, bot, e = im_profile(s)
    zc, hz = (top + bot) / 2, (top - bot) / 2
    ca, sa = math.cos(a), math.sin(a)
    f = lambda c: math.copysign(abs(c) ** (2 / e), c)
    return Vector((KX + f(ca) * (hw - inset), IM_FRONT + s * IM_LEN, IM_Z + zc + f(sa) * max(hz - inset, 0.0)))

def giger_shell_material():
    """Translucent 'bile amber' skin over the guts: veins in it, wet; lit from inside it shows the machine and the
    creature as shadows (the candled egg's rule). The iMac G3's translucent plastic, become a xenomorph's dome."""
    m, nt, out = mat('giger_shell')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vz = node(nt, 'ShaderNodeTexNoise', Scale=7.0, Detail=3.0); link(nt, tc.outputs['Object'], vz.inputs['Vector'])
    vein = maprange(nt, math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', vz.outputs['Fac'], 0.5)), 0.0, 0.018, 1.0, 0.0)
    vz2 = node(nt, 'ShaderNodeTexNoise', Scale=19.0, Detail=2.0); link(nt, tc.outputs['Object'], vz2.inputs['Vector'])
    vein2 = maprange(nt, math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', vz2.outputs['Fac'], 0.5)), 0.0, 0.01, 0.8, 0.0)
    veins = math_(nt, 'MAXIMUM', vein, vein2)
    th = node(nt, 'ShaderNodeTexNoise', Scale=4.0, Detail=4.0); link(nt, tc.outputs['Object'], th.inputs['Vector'])
    glow = mix_rgb(nt, th.outputs['Fac'], (1.0, 0.40, 0.12, 1), (1.0, 0.70, 0.36, 1))
    glow = mix_rgb(nt, veins, glow, (0.28, 0.02, 0.02, 1))
    tr = node(nt, 'ShaderNodeBsdfTranslucent'); link(nt, glow, tr.inputs['Color'])
    # frosted, coloured plastic (the G3's): mostly transmission, so the guts show through, blurred
    surf = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.14, IOR=1.3, **{'Transmission Weight': 1.0, 'Coat Weight': 1.0, 'Coat Roughness': 0.02})
    link(nt, mix_rgb(nt, veins, (1.0, 0.55, 0.22, 1), (0.35, 0.03, 0.03, 1)), surf.inputs['Base Color'])
    tp = node(nt, 'ShaderNodeBsdfTransparent', Color=(1.0, 0.62, 0.3, 1))
    m1 = node(nt, 'ShaderNodeMixShader', Fac=0.35); link(nt, surf.outputs[0], m1.inputs[1]); link(nt, tr.outputs[0], m1.inputs[2])
    m2 = node(nt, 'ShaderNodeMixShader', Fac=0.3); link(nt, m1.outputs[0], m2.inputs[1]); link(nt, tp.outputs[0], m2.inputs[2])
    link(nt, m2.outputs[0], out.inputs['Surface'])
    return m

M_SHELL = giger_shell_material()
M_FLESH = principled('flesh', (0.75, 0.32, 0.26, 1), rough=0.3, coat=0.8, sss=0.5)
M_LIPS = principled('lips', (0.55, 0.10, 0.13, 1), rough=0.15, coat=1.0, sss=0.6, noise_scale=30.0, noise_amt=0.3)
M_TONGUE = principled('tongue', (0.62, 0.16, 0.2, 1), rough=0.12, coat=1.0, sss=0.7, bump=0.4, bump_scale=160.0)
M_DARKGLASS = principled('darkglass', (0.01, 0.01, 0.012, 1), rough=0.08, coat=1.0)
M_BEZEL = principled('bezel', (0.03, 0.03, 0.035, 1), rough=0.35, coat=0.4)
M_CD = principled('cd', (0.75, 0.75, 0.78, 1), rough=0.08, metal=1.0)
try:
    M_CD.node_tree.nodes['Principled BSDF'].inputs['Thin Film Thickness'].default_value = 520.0
except Exception: pass
M_MUCUS = principled('mucus', (0.9, 0.82, 0.6, 1), rough=0.02, coat=1.0, trans=0.2, sss=0.6)

def screen_material():
    m, nt, out = mat('screen')
    uv = nt.nodes.new('ShaderNodeUVMap')
    t = image(nt, os.path.join(TEX, 'screen.png'), ext='CLIP'); link(nt, uv.outputs['UV'], t.inputs['Vector'])
    sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, uv.outputs['UV'], sep.inputs[0])
    lines = math_(nt, 'SINE', math_(nt, 'MULTIPLY', sep.outputs['Y'], 1300.0))
    lm = maprange(nt, lines, -1.0, 1.0, 0.55, 1.0)
    em = node(nt, 'ShaderNodeEmission'); link(nt, mix_rgb(nt, 1.0, t.outputs['Color'], math_(nt, 'MULTIPLY', lm, 1.0), 'MULTIPLY'), em.inputs['Color'])
    em.inputs['Strength'].default_value = 2.6
    gl = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.0, 0.0, 0.0, 1), 'Roughness': 0.02, 'Coat Weight': 1.0})
    add = nt.nodes.new('ShaderNodeAddShader'); link(nt, em.outputs[0], add.inputs[0]); link(nt, gl.outputs[0], add.inputs[1])
    link(nt, add.outputs[0], out.inputs['Surface'])
    return m
M_SCREEN = screen_material()

def rounded_rect(w, h, r, n=6):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts

def plate(name, outer, inner, thick, at, m):
    """A flat plate (rounded rect with holes) facing -y, its front at 'at'."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'; cu.extrude = thick / 2
    cu.bevel_depth = 0.004; cu.bevel_resolution = 2
    for poly in [outer] + inner:
        sp = cu.splines.new('POLY'); sp.points.add(len(poly) - 1); sp.use_cyclic_u = True
        for i, (x, y) in enumerate(poly): sp.points[i].co = (x, y, 0, 1)
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o); o.data.materials.append(m)
    o.rotation_euler = (math.radians(90), 0, 0); o.location = at
    return o

def giger_imac():
    # The shell: rings along the body, a superellipse in section, closed at the face and at the tip.
    bm = bmesh.new(); NS, NA = 90, 72; rings = []
    for i in range(NS + 1):
        s = (i / NS) ** 1.15
        ring = []
        for j in range(NA):
            a = j / NA * math.tau; p = im_point(s, a)
            p += Vector((0, 0, 0)) if s < 0.02 else Vector((0, 0, 0.004 * noise.noise(p * 15.0)))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(NS):
        for j in range(NA):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % NA], rings[i + 1][(j + 1) % NA], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    tip = bm.verts.new(im_point(1.0, 0.0) + Vector((0, 0.004, 0)))
    for j in range(NA): bm.faces.new((rings[NS][j], rings[NS][(j + 1) % NA], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj_from_bm('imac_shell', bm, M_SHELL, smooth=True)
    front_y = IM_FRONT - 0.002
    c = Vector((KX, IM_FRONT, IM_Z))
    # The face: a bone surround (the G3's front), the screen sunk in a black bezel, the chin with the mouth.
    SWD, SHT, SCZ = 0.25, 0.19, 0.045
    plate('imac_face', rounded_rect(0.335, 0.325, 0.075), [[(x, y + SCZ) for x, y in rounded_rect(SWD + 0.04, SHT + 0.04, 0.03)],
                                                          [(x, y - 0.118) for x, y in rounded_rect(0.13, 0.028, 0.013)]], 0.016, (c.x, front_y, c.z), M_SHELL)
    plate('imac_bezel', rounded_rect(SWD + 0.04, SHT + 0.04, 0.03), [rounded_rect(SWD, SHT, 0.016)], 0.01, (c.x, front_y + 0.008, c.z + SCZ), M_BEZEL)
    lip = rounded_rect(SWD + 0.05, SHT + 0.05, 0.034, 8)
    tube('imac_screenlip', [(c.x + x, front_y - 0.011, c.z + y + SCZ) for x, y in lip], [0.009] * len(lip), M_BONE, cyclic=True)
    for k in range(24):   # small bone teeth along the lip, Giger's repeated studs
        x, y = lip[int(k / 24 * len(lip))]
        sphere(f'imac_stud{k}', (c.x + x * 1.045, front_y - 0.012, c.z + y * 1.06 + SCZ), 0.006, M_BONE, scale=(1, 1.4, 1), seg=10)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); nu, nv = 24, 18; grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u, v = i / nu - 0.5, j / nv - 0.5
            bulge = 0.012 * (1 - (2 * u) ** 2) * (1 - (2 * v) ** 2)
            row.append(bm.verts.new((c.x + u * SWD, front_y + 0.012 - bulge, c.z + SCZ + v * SHT)))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l[uvl].uv = (ii / nu, jj / nv)
    obj_from_bm('imac_screen', bm, M_SCREEN, smooth=True)
    # The mouth (the CD slot): swollen lips, the tray out like a tongue with a disc on it, drool to the board.
    mo = rounded_rect(0.135, 0.032, 0.015, 6)
    tube('imac_lips', [(c.x + x, front_y - 0.009, c.z + y - 0.118) for x, y in mo], [0.009] * len(mo), M_LIPS, cyclic=True)
    box('imac_slot', (c.x, front_y + 0.01, c.z - 0.118), (0.12, 0.03, 0.018), M_DARKGLASS)
    sphere('imac_tongue', (c.x, front_y - 0.05, c.z - 0.124), 0.06, M_TONGUE, scale=(0.95, 1.0, 0.12))
    cyl('imac_cd', (c.x, front_y - 0.06, c.z - 0.114), 0.042, 0.0015, M_CD, verts=48)
    gloop_strand('imac_drool', Vector((c.x - 0.035, front_y - 0.095, c.z - 0.126)), Vector((c.x - 0.032, front_y - 0.1, KTOP + 0.002)), 0.003)
    for sx in (-1, 1):    # gill slits for the speakers
        for k in range(3):
            g = box(f'imac_gill{sx}{k}', (c.x + sx * (0.112 - k * 0.013), front_y - 0.009, c.z - 0.11 + k * 0.004), (0.006, 0.012, 0.042), M_DARKGLASS)
            g.rotation_euler = (0, math.radians(sx * (25 + k * 6)), 0)
    for k, (x, z, r, ang) in enumerate(((-0.128, 0.13, 0.026, -8), (0.14, -0.135, 0.019, 12))):   # stickers: it is loved
        bpy.ops.mesh.primitive_plane_add(size=2 * r, location=(c.x + x, front_y - 0.0135, c.z + z), rotation=(math.radians(90), 0, math.radians(ang)))
        st = bpy.context.active_object; st.name = f'sticker{k}'; st.data.materials.append(M_STICKER)
    # Inside: a gunmetal skull-frame (hoops and a keel) that reads through the dome, the tube's neck, the creature.
    for k, s in enumerate((0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.86)):
        pts = [im_point(s, j / 28 * math.tau, inset=0.016) for j in range(28)]
        tube(f'imac_hoop{k}', pts, [0.008] * len(pts), M_BONE, cyclic=True)
    keel = [im_point(s, math.pi / 2, inset=0.02) for s in (0.1, 0.3, 0.5, 0.7, 0.85, 0.95)]
    vertebral('imac_keel', keel, 0.009, lambda p: Vector((0, 0, -1)), ring_every=0.018, spine_every=1)
    cyl('imac_neck', (c.x, c.y + 0.12, c.z + 0.03), 0.105, 0.2, M_DARKGLASS, rot=(math.radians(-90), 0, 0), r2=0.025)
    mb = bpy.data.metaballs.new('creature'); mb.resolution = 0.01; mb.render_resolution = 0.004; mb.threshold = 0.6
    cr = bpy.data.objects.new('creature', mb); sc.collection.objects.link(cr); cr.data.materials.append(M_FLESH)
    VIS = 1 / 0.575
    def vb(p, r):
        el = mb.elements.new(); el.co = p; el.radius = r * VIS
    cc = Vector((c.x, c.y + 0.3, c.z + 0.0))
    head = cc + Vector((-0.06, -0.02, 0.05)); vb(head, 0.058)                 # the big head, near the dome's crown
    for k in range(10):      # the body curls round the tube's neck and back toward the tip
        a = math.radians(-20 + k * 30)
        vb(cc + Vector((math.cos(a) * 0.075, 0.02 + k * 0.009, -0.01 + math.sin(a) * 0.06)), 0.03 - k * 0.002)
    for k in range(5): vb(head.lerp(cc + Vector((0.07, 0.02, -0.01)), k / 4), 0.017)
    for sx in (-1, 1): vb(head + Vector((sx * 0.03, -0.04, -0.035)), 0.012); vb(head + Vector((sx * 0.04, -0.055, -0.055)), 0.009)
    for k in range(7):       # vessels along the inside of the dome
        rnd = random.Random(40 + k); a0 = rnd.uniform(0, math.tau)
        pts = [im_point(0.05 + 0.13 * i, a0 + 0.25 * math.sin(i * 1.3 + k), inset=0.006) for i in range(7)]
        tube(f'imac_vessel{k}', pts, [0.0045] * len(pts), M_FLESH)
    # The handle (the G3's cut-out, here a loop of vertebrae) and a bone crest down the cranium.
    hs = (0.4, 0.46, 0.53, 0.6)
    hp = [im_point(hs[0], math.pi / 2) + Vector((0, 0, -0.005))] + [im_point(s, math.pi / 2) + Vector((0, 0, 0.055 * math.sin((s - 0.4) / 0.2 * math.pi))) for s in hs[1:-1]] + [im_point(hs[-1], math.pi / 2) + Vector((0, 0, -0.005))]
    vertebral('imac_handle', hp, 0.012, lambda p: Vector((0, 0, 1)), ring_every=0.016, spine_every=2)
    crest = [im_point(s, math.pi / 2) + Vector((0, 0, 0.004)) for s in (0.64, 0.72, 0.8, 0.88, 0.95, 0.99)]
    vertebral('imac_crest', crest, 0.007, lambda p: Vector((0, 0.3, 1)), ring_every=0.016, spine_every=1)
    # Six beetle legs under the front half.
    for sx in (-1, 1):
        for k, s in enumerate((0.06, 0.24, 0.42)):
            hp_ = im_point(s, -math.pi / 2 + sx * 0.5, inset=0.01)
            hip = Vector((hp_.x, hp_.y, hp_.z))
            knee = hip + Vector((sx * 0.07, (s - 0.24) * 0.12, 0.03))
            foot = Vector((hip.x + sx * 0.12, hip.y + (s - 0.24) * 0.25, KTOP + 0.004))
            tube(f'imac_leg{sx}{k}a', [hip, hip.lerp(knee, 0.5) + Vector((0, 0, 0.012)), knee], [0.01, 0.009, 0.007], M_GUN)
            tube(f'imac_leg{sx}{k}b', [knee, knee.lerp(foot, 0.5) + Vector((sx * 0.012, 0, 0)), foot], [0.007, 0.005, 0.0022], M_BONE)
            sphere(f'imac_knee{sx}{k}', knee, 0.012, M_BONE)
    # The umbilicus out of the tip, two lesser hoses: off the board, across the floor, into the wall by the window.
    tipp = im_point(0.97, 0.0)
    vertebral('umbilicus', [tipp, tipp + Vector((0.0, 0.06, -0.06)), Vector((KX + 0.06, KY + 0.46, KTOP - 0.08)),
                            Vector((KX + 0.2, KY + 0.62, FLOOR + 0.035)), Vector((0.5, 3.3, FLOOR + 0.035)), Vector((0.72, Y1 - 0.08, 0.22)), Vector((0.74, Y1 - 0.05, 0.42))],
               0.026, lambda p: Vector((0, 0, 1)), collar=((0.74, Y1 - 0.03, 0.46), (0, -1, 0.3)))
    for k, (sx, end) in enumerate(((-1, Vector((-0.35, 3.2, FLOOR + 0.02))), (1, Vector((0.6, 2.75, FLOOR + 0.02))))):
        a0 = im_point(0.8, -math.pi / 2 + sx * 0.6)
        tube(f'imac_hose{k}', [a0, a0 + Vector((sx * 0.06, 0.03, -0.06)), Vector((a0.x + sx * 0.12, a0.y + 0.12, KTOP - 0.05)), end.lerp(a0, 0.3), end],
             [0.012, 0.012, 0.011, 0.011, 0.01], M_GUN)
    # Light: the screen into the room; a lamp in the guts behind the creature.
    area_light('imac_screen_light', (c.x, front_y - 0.03, c.z + SCZ), (math.radians(-90), 0, 0), 5.0, (0.75, 0.8, 1.0), SWD, SHT)
    point_light('imac_guts', Vector((c.x + 0.03, c.y + 0.36, c.z - 0.06)), 14.0, (1.0, 0.5, 0.2), 0.015)
    point_light('imac_guts2', Vector((c.x - 0.04, c.y + 0.14, c.z - 0.1)), 6.0, (1.0, 0.45, 0.2), 0.015)
    return front_y

def gloop_strand(name, a, b, r):
    pts = [a.lerp(b, t) + Vector((0, -0.004 * math.sin(t * math.pi), 0)) for t in (0, 0.3, 0.6, 1)]
    tube(name, pts, [r, r * 0.6, r * 0.5, r * 1.6], M_MUCUS)

FRONT_Y = giger_imac()

# The keyboard: a translucent amber slab with bone keys like teeth; the beetle mouse on Gob-chan.
kb_y = (HANDS[0].y + HANDS[1].y) / 2 - 0.02
box('keyboard', (KX, kb_y, KTOP + 0.008), (0.3, 0.11, 0.014), M_SHELL, bevel=0.007).rotation_euler = (math.radians(4), 0, 0)
for i in range(13):
    for j in range(4):
        sphere(f'key{i}{j}', (KX - 0.132 + i * 0.022, kb_y - 0.036 + j * 0.024, KTOP + 0.02 + j * 0.0015), 0.0095, M_BONE, scale=(1, 0.95, 1.1), seg=10)
box('mousepad', (KX + 0.27, kb_y + 0.03, KTOP + 0.002), (0.16, 0.13, 0.004), M_PAD)
sphere('mouse', (KX + 0.27, kb_y + 0.03, KTOP + 0.012), 0.032, M_SHELL, scale=(0.85, 1.15, 0.55))
for sx in (-1, 1):
    for k in range(3):
        tube(f'mouse_leg{sx}{k}', [Vector((KX + 0.27 + sx * 0.022, kb_y + 0.0 + k * 0.025, KTOP + 0.012)), Vector((KX + 0.27 + sx * 0.04, kb_y + 0.005 + k * 0.027, KTOP + 0.016)),
                                   Vector((KX + 0.27 + sx * 0.05, kb_y + 0.0 + k * 0.03, KTOP + 0.003))], [0.003, 0.0025, 0.0012], M_GUN)

# ======================================================================== the clutter on the kotatsu
M_MIKAN = principled('mikan', (0.9, 0.32, 0.02, 1), rough=0.45, bump=0.3, bump_scale=200.0, coat=0.2)
M_BOWL = plastic('bowl', (0.75, 0.75, 0.72, 1), rough=0.2)
cyl('mikan_bowl', (KX - 0.3, KY + 0.06, KTOP + 0.03), 0.09, 0.06, M_BOWL, r2=0.065, verts=32)
for k, (dx, dy, dz) in enumerate(((0, 0, 0.07), (0.04, 0.03, 0.065), (-0.035, 0.025, 0.066), (0.0, -0.04, 0.066), (0.005, 0.005, 0.105))):
    sphere(f'mikan{k}', (KX - 0.3 + dx, KY + 0.06 + dy, KTOP + dz), 0.03, M_MIKAN, scale=(1, 1, 0.82))
sphere('mikan_peeled', (KX - 0.24, KY - 0.2, KTOP + 0.022), 0.026, principled('mikan_in', (0.95, 0.55, 0.15, 1), rough=0.3, sss=0.5), scale=(1, 1, 0.8))
M_CUP = principled('cupnoodle', (0.92, 0.9, 0.85, 1), rough=0.6)
M_CUPRED = principled('cupred', (0.75, 0.05, 0.05, 1), rough=0.4)
M_FOIL = principled('foil', (0.8, 0.78, 0.7, 1), rough=0.2, metal=1.0)
def cupnoodle(name, c, tipped=False):
    rot = (math.radians(90), 0, math.radians(random.uniform(0, 360))) if tipped else (0, 0, 0)
    o = cyl(name, c, 0.047, 0.1, M_CUP, rot=rot, r2=0.04, verts=24)
    cyl(name + '_band', c, 0.0455, 0.035, M_CUPRED, rot=rot, r2=0.042, verts=24)
    if not tipped: cyl(name + '_lid', (c[0], c[1], c[2] + 0.051), 0.05, 0.003, M_FOIL)
cupnoodle('cup_k', (KX + 0.3, KY - 0.08, KTOP + 0.05))
tube('chopsticks', [Vector((KX + 0.29, KY - 0.08, KTOP + 0.07)), Vector((KX + 0.36, KY - 0.03, KTOP + 0.2))], [0.004, 0.003], M_OAK)
def can(name, c, col, tipped=False, crushed=False):
    rot = (math.radians(90), 0, math.radians(random.uniform(0, 360))) if tipped else (0, 0, random.uniform(0, 6))
    o = cyl(name, c, 0.033, 0.12, principled(name + 'm', col, rough=0.3, metal=0.7), rot=rot)
    if crushed: o.scale = (1.0, 0.55, 0.7)
    return o
can('can_k1', (KX + 0.33, KY + 0.2, KTOP + 0.06), (0.15, 0.85, 0.2, 1))
can('can_k2', (KX - 0.32, KY - 0.25, KTOP + 0.06), (0.9, 0.35, 0.6, 1))

# ======================================================================== the futon, plushies (west)
M_FUTON = principled('futon', (0.88, 0.86, 0.8, 1), rough=0.9, sheen=0.5, noise_scale=6.0, noise_amt=0.1)
M_DUVET = principled('duvet', (0.98, 0.88, 0.55, 1), rough=0.9, sheen=0.6, noise_scale=4.0, noise_amt=0.15)
box('futon', (-0.9, 1.25, FLOOR + 0.045), (0.85, 1.9, 0.09), M_FUTON, bevel=0.04)
def duvet():
    bm = bmesh.new(); n = 40; grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = i / n, j / n
            x, y = -1.32 + u * 0.98, 0.32 + v * 1.25
            h = FLOOR + 0.1 + 0.07 * (0.5 + noise.noise(Vector((x * 3, y * 3, 0.5)))) + 0.05 * smoothstep(0.6, 1.0, v) * math.sin(u * math.pi)
            row.append(bm.verts.new((x, y, h)))
        grid.append(row)
    for j in range(n):
        for i in range(n): bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    o = obj_from_bm('duvet', bm, M_DUVET, smooth=True)
    s = o.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.05; s.offset = -1
duvet()
box('pillow', (-0.9, 2.0, FLOOR + 0.13), (0.42, 0.24, 0.1), principled('pillow', (0.6, 0.85, 0.85, 1), rough=0.9, sheen=0.6), bevel=0.04)

def gobchan_plush(name, c, r, col, rot_z=0.0, tilt=0.0):
    m = plush(name + 'm', col)
    sphere(name, c, r, m, scale=(1.12, 0.95, 0.92), rot=(tilt, 0, rot_z))
    fwd = Vector((math.sin(rot_z), -math.cos(rot_z), 0))   # faces -y rotated
    side = Vector((math.cos(rot_z), math.sin(rot_z), 0))
    for sx in (-1, 1):
        ear = side * sx * r * 0.9 + Vector((0, 0, r * 0.55))
        cyl(name + f'ear{sx}', Vector(c) + ear, r * 0.35, r * 0.6, m, r2=0.002,
            rot=(0, math.radians(sx * 55), rot_z), verts=12)
        sphere(name + f'eye{sx}', Vector(c) + fwd * r * 0.9 + side * sx * r * 0.36 + Vector((0, 0, r * 0.05)), r * 0.1, M_DARKGLASS, seg=12)
        sphere(name + f'blush{sx}', Vector(c) + fwd * r * 0.82 + side * sx * r * 0.62 + Vector((0, 0, -r * 0.2)), r * 0.13,
               principled('blush', (1.0, 0.45, 0.55, 1), rough=0.9), scale=(1, 0.4, 0.6), seg=12)
PASTELS = [(0.95, 0.95, 0.93, 1), (1.0, 0.62, 0.75, 1), (0.6, 0.92, 0.82, 1), (0.78, 0.68, 0.98, 1), (1.0, 0.9, 0.5, 1), (0.6, 0.8, 1.0, 1)]
for k, (x, y, r) in enumerate(((-1.12, 2.05, 0.15), (-0.82, 2.12, 0.09), (-1.2, 1.7, 0.1), (-0.6, 1.95, 0.07), (-1.0, 0.7, 0.11), (-1.25, 0.35, 0.08))):
    gobchan_plush(f'plush{k}', (x, y, FLOOR + 0.13 + r * 0.8), r, PASTELS[k % len(PASTELS)], rot_z=random.uniform(-0.6, 0.6) + (0.4 if x < -1 else 0))
gobchan_plush('plush_big', (-0.48, 1.3, FLOOR + 0.17), 0.16, PASTELS[1], rot_z=-0.5)        # the big one, sat beside it

# ======================================================================== the niche (west wall): figures, a beckoning cat, capsules
y0n, y1n, z0n, z1n = NICHE
NDEP = 0.3
box('niche_back', (X0 - NDEP - 0.02, (y0n + y1n) / 2, (z0n + z1n) / 2 + 0.1), (0.04, y1n - y0n + 0.1, z1n - z0n + 0.4), M_STONE_DARK)
for sy, yy in ((-1, y0n), (1, y1n)):
    box(f'niche_side{sy}', (X0 - NDEP / 2, yy + sy * 0.02, (z0n + z1n) / 2), (NDEP + 0.04, 0.04, z1n - z0n), M_STONE_DARK, bevel=0.01)
box('niche_floor', (X0 - NDEP / 2 + 0.03, (y0n + y1n) / 2, z0n - 0.03), (NDEP + 0.1, y1n - y0n + 0.04, 0.06), M_STONE, bevel=0.01)
box('niche_lintel', (X0 - NDEP / 2, (y0n + y1n) / 2, z1n + 0.06), (NDEP + 0.04, y1n - y0n + 0.12, 0.12), M_STONE, bevel=0.012)
def figure(name, c, s, hair, outfit):
    """A tiny anime figure: a clear base, a body, a big head, spiky hair, round eyes."""
    x, y, z = c
    cyl(name + '_base', (x, y, z + 0.003), 0.03 * s, 0.006, principled('clear', (0.8, 0.9, 1.0, 1), rough=0.05, trans=0.9), verts=24)
    cyl(name + '_legs', (x, y, z + 0.035 * s), 0.008 * s, 0.06 * s, principled('skinf', (1.0, 0.85, 0.75, 1), rough=0.3, coat=0.5))
    cyl(name + '_dress', (x, y, z + 0.06 * s), 0.025 * s, 0.05 * s, plastic(name + 'o', outfit), r2=0.012 * s)
    sphere(name + '_head', (x, y, z + 0.11 * s), 0.026 * s, principled('skinf2', (1.0, 0.86, 0.76, 1), rough=0.3, coat=0.5))
    hm = plastic(name + 'h', hair)
    sphere(name + '_hair', (x + 0.004 * s, y, z + 0.117 * s), 0.029 * s, hm, scale=(1, 1.02, 0.92))
    for k in range(5):
        a = k / 5 * math.tau
        cyl(name + f'_spike{k}', (x + math.cos(a) * 0.022 * s, y + math.sin(a) * 0.022 * s, z + 0.13 * s), 0.009 * s, 0.03 * s, hm, r2=0.0, rot=(math.cos(a) * 0.9, -math.sin(a) * 0.9, 0), verts=8)
    for sy in (-1, 1):
        sphere(name + f'_eye{sy}', (x + 0.024 * s, y + sy * 0.009 * s, z + 0.108 * s), 0.0055 * s, plastic('eyeblue', (0.2, 0.4, 1.0, 1)), seg=10)
FIG = [((1.0, 0.4, 0.7, 1), (0.2, 0.2, 0.5, 1)), ((0.3, 0.8, 1.0, 1), (0.9, 0.9, 0.95, 1)), ((1.0, 0.85, 0.2, 1), (0.85, 0.1, 0.15, 1)), ((0.55, 0.3, 0.9, 1), (0.1, 0.1, 0.1, 1))]
for k in range(4):
    figure(f'fig{k}', (X0 - 0.12 - 0.06 * (k % 2), y0n + 0.1 + k * 0.15, z0n), 1.25, *FIG[k])
def maneki(name, c, s=1.0):
    x, y, z = c
    W = plastic('neko', (0.97, 0.96, 0.92, 1), rough=0.15)
    sphere(name + '_body', (x, y, z + 0.05 * s), 0.05 * s, W, scale=(0.9, 1.0, 1.1))
    sphere(name + '_head', (x + 0.005, y, z + 0.125 * s), 0.042 * s, W, scale=(0.95, 1.05, 0.9))
    for sy in (-1, 1):
        cyl(name + f'_ear{sy}', (x, y + sy * 0.025 * s, z + 0.16 * s), 0.014 * s, 0.025 * s, W, r2=0.0, rot=(sy * 0.4, 0, 0), verts=10)
        sphere(name + f'_eye{sy}', (x + 0.038 * s, y + sy * 0.016 * s, z + 0.13 * s), 0.006 * s, M_DARKGLASS, seg=10)
    cyl(name + '_paw', (x + 0.02 * s, y - 0.045 * s, z + 0.13 * s), 0.013 * s, 0.06 * s, W)
    torus(name + '_collar', (x, y, z + 0.09 * s), 0.035 * s, 0.006 * s, plastic('red', (0.8, 0.05, 0.05, 1)))
    sphere(name + '_bell', (x + 0.035 * s, y, z + 0.08 * s), 0.009 * s, principled('gold', (0.9, 0.7, 0.2, 1), rough=0.2, metal=1.0))
maneki('maneki', (X0 - 0.14, y1n - 0.12, z0n), 1.3)
for k in range(9):   # gashapon capsules
    rr = random.Random(70 + k)
    p = Vector((X0 - rr.uniform(0.06, 0.24), rr.uniform(y0n + 0.06, y1n - 0.08), z0n + 0.022))
    sphere(f'gacha{k}a', p, 0.022, principled('capsule', PASTELS[k % 6][:3] + (1,), rough=0.05, trans=0.6, coat=1.0), scale=(1, 1, 1))
    sphere(f'gacha{k}b', p - Vector((0, 0, 0.002)), 0.0215, plastic('capw', (0.95, 0.95, 0.95, 1)), scale=(1, 1, 0.98))

# ======================================================================== manga: a shelf (east) and floor stacks
M_SHELFOAK = M_OAK
SH_X0, SH_Y0, SH_Y1, SH_H = X1 - 0.27, 1.55, 2.95, 1.55
for k in range(5):
    box(f'shelf_board{k}', (SH_X0 + 0.13, (SH_Y0 + SH_Y1) / 2, 0.02 + k * 0.36), (0.26, SH_Y1 - SH_Y0, 0.025), M_OAK)
for yy in (SH_Y0, SH_Y1):
    box(f'shelf_side{yy}', (SH_X0 + 0.13, yy, SH_H / 2), (0.26, 0.025, SH_H), M_OAK)
SPINES = [(0.85, 0.1, 0.15), (0.1, 0.25, 0.7), (0.95, 0.8, 0.2), (0.15, 0.6, 0.35), (0.95, 0.95, 0.92), (0.1, 0.1, 0.12), (0.9, 0.45, 0.65), (0.4, 0.75, 0.95), (0.6, 0.2, 0.7)]
def manga_row(bm, lay, x, y0, y1, z, rnd):
    y = y0 + 0.01
    run = rnd.choice(SPINES); count = 0
    while y < y1 - 0.02:
        t = rnd.uniform(0.014, 0.019); h = rnd.choice((0.177, 0.177, 0.182, 0.21))
        if count > rnd.randint(6, 18): run = rnd.choice(SPINES); count = 0
        count += 1
        idx = SPINES.index(run)
        bm_cube(bm, (x, y + t / 2, z + h / 2), (0.125, t - 0.0015, h), Matrix.Rotation(rnd.uniform(-0.03, 0.03), 3, 'X'), lay, idx / len(SPINES) + rnd.uniform(0, 0.02))
        y += t
def manga_material():
    m, nt, out = mat('manga')
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'rand'
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
    els = ramp.color_ramp.elements
    els[0].position = 0.0; els[0].color = SPINES[0] + (1,)
    els[1].position = 1 / len(SPINES); els[1].color = SPINES[1] + (1,)
    for i in range(2, len(SPINES)):
        e = els.new(i / len(SPINES)); e.color = SPINES[i] + (1,)
    link(nt, attr.outputs['Fac'], ramp.inputs['Fac'])
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
    band = maprange(nt, math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', math_(nt, 'FRACT', math_(nt, 'MULTIPLY', sep.outputs['Z'], 2.78)), 0.72)), 0.03, 0.04, 1.0, 0.0)
    col = mix_rgb(nt, band, ramp.outputs['Color'], (0.97, 0.96, 0.9, 1))
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.35, **{'Coat Weight': 0.3}); link(nt, col, p.inputs['Base Color'])
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m
M_MANGA = manga_material()
bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(31)
for k in range(4):
    manga_row(bm, lay, SH_X0 + 0.1, SH_Y0, SH_Y1, 0.033 + k * 0.36, rnd)
# floor stacks (lying flat)
for k, (x, y, n) in enumerate(((0.95, 0.55, 14), (1.12, 0.62, 9), (-0.35, 3.2, 17), (-0.58, 3.32, 11), (0.85, 1.0, 6), (-1.15, 3.0, 5))):
    zz = FLOOR
    for i in range(n):
        t = rnd.uniform(0.014, 0.02)
        rot = Matrix.Rotation(rnd.uniform(-0.25, 0.25), 3, 'Z') @ Matrix.Rotation(math.pi / 2, 3, 'Y')
        bm_cube(bm, (x + rnd.uniform(-0.012, 0.012), y + rnd.uniform(-0.012, 0.012), zz + t / 2), (t, 0.125, 0.177), rot, lay, rnd.randint(0, 8) / len(SPINES) + 0.01)
        zz += t
mg = obj_from_bm('manga', bm, M_MANGA, bevel=0.002, segs=1)

# figure boxes and capsules on the top shelf, a row of game cases on the second
for k in range(3):
    box(f'figbox{k}', (SH_X0 + 0.13, SH_Y0 + 0.2 + k * 0.45, 4 * 0.36 + 0.2), (0.2, 0.18, 0.3 - k * 0.04), plastic(f'figbox{k}', PASTELS[k + 1], rough=0.4), bevel=0.004)

# ======================================================================== the fridge (NW), the radiator (under the window), posters
M_FRIDGE = plastic('fridge', (0.62, 0.86, 0.80, 1), rough=0.22)
box('fridge', (-1.04, 3.3, FLOOR + 0.43), (0.5, 0.52, 0.86), M_FRIDGE, bevel=0.035)
box('fridge_handle', (-0.82, 3.035, FLOOR + 0.62), (0.03, 0.02, 0.2), M_BONE, bevel=0.008)
for k, (x, z, r) in enumerate(((-1.18, 0.65, 0.04), (-0.92, 0.42, 0.032), (-1.1, 0.28, 0.03))):
    bpy.ops.mesh.primitive_plane_add(size=2 * r, location=(x, 3.038, FLOOR + z), rotation=(math.radians(90), 0, math.radians(k * 20 - 10)))
    s = bpy.context.active_object; s.name = f'fsticker{k}'; s.data.materials.append(M_STICKER)
gobchan_plush('plush_fridge', (-1.08, 3.28, FLOOR + 0.98), 0.1, PASTELS[2], rot_z=0.2)

def radiator():
    """A ribcage under the window: bone ribs off a vertebral bar, socks drying on it."""
    bar = [Vector((WX - 0.32, Y1 - 0.07, 0.42)), Vector((WX, Y1 - 0.08, 0.43)), Vector((WX + 0.32, Y1 - 0.07, 0.42))]
    vertebral('radiator_spine', bar, 0.02, lambda p: Vector((0, -1, 0.4)), ring_every=0.03, spine_every=2)
    for k in range(9):
        x = WX - 0.28 + k * 0.07
        pts = [Vector((x, Y1 - 0.07, 0.42)), Vector((x, Y1 - 0.2, 0.36)), Vector((x, Y1 - 0.2, 0.2)), Vector((x, Y1 - 0.08, 0.12))]
        tube(f'radiator_rib{k}', pts, [0.014, 0.012, 0.012, 0.01], M_BONE)
    for k, (x, col) in enumerate(((WX - 0.12, (1.0, 0.55, 0.7, 1)), (WX + 0.14, (0.95, 0.95, 0.9, 1)))):
        sock_m = principled(f'sock{k}', col, rough=0.95, sheen=0.6)
        tube(f'sock{k}', [Vector((x, Y1 - 0.12, 0.47)), Vector((x, Y1 - 0.205, 0.43)), Vector((x + 0.01, Y1 - 0.225, 0.32)), Vector((x + 0.04, Y1 - 0.215, 0.27))],
             [0.022, 0.025, 0.024, 0.028], sock_m)
radiator()

def poster(name, key, c, rot, w, h):
    bpy.ops.mesh.primitive_plane_add(size=1, location=c, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = (w, h, 1); o.data.materials.append(M_POSTERS[key])
    return o
poster('poster_gobchan', 'gobchan', (X0 + 0.022, 1.25, 1.28), (math.radians(90), 0, math.radians(90)), 0.42, 0.59)
poster('poster_blood', 'blood', (-0.85, Y1 - 0.022, 1.38), (math.radians(90), 0, 0), 0.38, 0.53)
poster('poster_eyes', 'eyes', (X1 - 0.03, 1.08, 1.28), (math.radians(90), 0, math.radians(-90)), 0.42, 0.59)

# ======================================================================== the kitchen's things
M_RICE = plastic('ricecooker', (0.95, 0.93, 0.9, 1), rough=0.2)
cyl('ricecooker', (1.2, 3.42, 0.9), 0.11, 0.16, M_RICE, verts=32)
sphere('ricecooker_lid', (1.2, 3.42, 0.98), 0.11, M_RICE, scale=(1, 1, 0.35))
sphere('ricecooker_flower', (1.2, 3.31, 0.9), 0.022, plastic('pinkf', (1.0, 0.5, 0.7, 1)), scale=(1, 0.3, 1))
for k in range(5): cupnoodle(f'cuptower{k}', (0.92, 3.2, 0.875 + k * 0.1))
for k in range(6):
    can(f'canfloor{k}', (random.uniform(-0.2, 1.1), random.uniform(0.3, 1.0), FLOOR + 0.035), random.choice(PASTELS), tipped=True, crushed=k % 2 == 0)
for k in range(3): cupnoodle(f'cupfloor{k}', (random.uniform(0.6, 1.1), random.uniform(1.0, 2.4), FLOOR + 0.05), tipped=k == 1)
for k in range(5):     # game cases scattered by the kotatsu
    o = box(f'case{k}', (random.uniform(-0.4, 0.8), random.uniform(1.0, 1.8), FLOOR + 0.006), (0.142, 0.125, 0.01), M_DARKGLASS, rot=(0, 0, random.uniform(0, 3)))

cyl('bucket', (0.02, 0.42, FLOOR + 0.09), 0.1, 0.18, M_IRON, r2=0.12, verts=28)
cyl('bucket_water', (0.02, 0.42, FLOOR + 0.15), 0.112, 0.004, M_WET, verts=28)
# ======================================================================== the laundry line: the goblin's identical vests
tube('laundry_line', [Vector((-0.1, 0.62, 1.8)), Vector((0.6, 0.62, 1.74)), Vector((X1, 0.62, 1.8))], [0.004] * 3, M_IRON)
def hung_vest(name, x, m):
    bm = bmesh.new(); n = 12; grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = i / n - 0.5, j / n
            wv = 0.17 if v > 0.25 else 0.17 - (0.25 - v) * 0.0
            if v < 0.3: wv = 0.12 + 0.05 * (v / 0.3)
            xx = x + u * 2 * wv
            row.append(bm.verts.new((xx, 0.62 + 0.015 * math.sin(u * 6 + v * 3), 1.76 - v * 0.42 - 0.03 * abs(u))))
        grid.append(row)
    for j in range(n):
        for i in range(n): bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    o = obj_from_bm(name, bm, m, smooth=True)
    s = o.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.004
hung_vest('hung_vest1', 1.08, M_VEST); hung_vest('hung_vest2', 0.74, M_VEST); hung_vest('hung_vest3', 0.4, M_VEST)

# ======================================================================== lights: the lantern, fairy lights, a candle
def paper_material():
    """Red washi lit from inside: translucent, so the bulb inside lights it (and the room through it)."""
    m, nt, out = mat('lantern_paper')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
    ribs = maprange(nt, math_(nt, 'ABSOLUTE', math_(nt, 'SINE', math_(nt, 'MULTIPLY', sep.outputs['Z'], 140.0))), 0.9, 1.0, 0.0, 1.0)
    col = mix_rgb(nt, ribs, (0.9, 0.12, 0.05, 1), (0.25, 0.02, 0.01, 1))
    tr = node(nt, 'ShaderNodeBsdfTranslucent'); link(nt, col, tr.inputs['Color'])
    em = node(nt, 'ShaderNodeEmission', Strength=0.6); link(nt, col, em.inputs['Color'])
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.5, 0.05, 0.03, 1), 'Roughness': 0.5})
    m1 = node(nt, 'ShaderNodeMixShader', Fac=0.7); link(nt, p.outputs[0], m1.inputs[1]); link(nt, tr.outputs[0], m1.inputs[2])
    add = nt.nodes.new('ShaderNodeAddShader'); link(nt, m1.outputs[0], add.inputs[0]); link(nt, em.outputs[0], add.inputs[1])
    link(nt, add.outputs[0], out.inputs['Surface'])
    return m
M_PAPER = paper_material()
LZ = CROWN - 0.62
tube('lantern_chain', [Vector((0.0, 1.05, CROWN)), Vector((0.0, 1.05, LZ + 0.18))], [0.004, 0.004], M_IRON)
sphere('lantern', (0.0, 1.05, LZ), 0.13, M_PAPER, scale=(1, 1, 1.25)).visible_shadow = False
for dz in (0.16, -0.16):
    cyl(f'lantern_rim{dz}', (0.0, 1.05, LZ + dz), 0.075, 0.03, principled('lacquer', (0.02, 0.02, 0.02, 1), rough=0.2, coat=1.0))
point_light('lantern_light', (0.0, 1.05, LZ), 5.0, (1.0, 0.36, 0.2), 0.06)

M_BULBS = [principled(f'bulb{k}', c, emit=c, emit_str=8.0) for k, c in enumerate(((1, 0.6, 0.8, 1), (0.6, 0.9, 1, 1), (1, 0.9, 0.5, 1), (0.7, 1, 0.7, 1)))]
for sx in (-1, 1):
    x = sx * 0.92
    a, b = Vector((x, 0.2, vault_z(x) - 0.05)), Vector((x, 3.4, vault_z(x) - 0.05))
    seg_pts = [0.2] + list(RIBS) + [3.4]
    allp = []
    for s0, s1 in zip(seg_pts, seg_pts[1:]):
        for t in [i / 6 for i in range(6)]:
            y = s0 + (s1 - s0) * t
            allp.append(Vector((x, y, vault_z(x) - 0.06 - 0.12 * math.sin(t * math.pi))))
    allp.append(Vector((x, 3.4, vault_z(x) - 0.06)))
    tube(f'fairy_wire{sx}', allp, [0.002] * len(allp), M_IRON)
    for k, p in enumerate(allp[1:-1]):
        sphere(f'fairy{sx}_{k}', p + Vector((0, 0, -0.015)), 0.011, M_BULBS[k % 4], seg=10)
    for k, y in enumerate((0.7, 1.6, 2.5, 3.2)):
        point_light(f'fairy_l{sx}{k}', (x, y, vault_z(x) - 0.2), 0.8, (1.0, 0.75, 0.85) if k % 2 else (0.7, 0.85, 1.0), 0.02)
# a candle in an iron sconce on the west wall
tube('sconce', [Vector((X0, 2.05, 1.35)), Vector((X0 + 0.08, 2.05, 1.33)), Vector((X0 + 0.12, 2.05, 1.4))], [0.008] * 3, M_IRON)
cyl('candle', (X0 + 0.12, 2.05, 1.45), 0.018, 0.09, principled('wax', (0.92, 0.88, 0.75, 1), rough=0.5, sss=0.5))
sphere('flame', (X0 + 0.12, 2.05, 1.51), 0.008, principled('flame', (1, 0.8, 0.4, 1), emit=(1.0, 0.7, 0.3, 1), emit_str=30.0), scale=(1, 1, 1.8))
point_light('candle_light', (X0 + 0.14, 2.05, 1.53), 1.5, (1.0, 0.65, 0.35), 0.01)

# ======================================================================== outside: the Bryce view, the sun, the sky in the window
VIEW = os.path.join(REPO, 'docs/dev-notes/2026-10-01-flat-emergence-lookdev/view-bryce-moody.png')
def backdrop(cam_loc, yb=Y1 + 3.0, u_c=0.55, v_c=0.56, fu=0.42):
    """An emissive image plane outside, sized so the window, seen from cam_loc, frames a chosen part of the view."""
    corners = [(WX - WH, WS), (WX + WH, WS), (WX - WH, WSP + WH), (WX + WH, WSP + WH)]
    C = Vector(cam_loc); xs, zs = [], []
    for x, z in corners:
        p = Vector((x, Y1 + WDEPTH * 0.7, z)); d = p - C; t = (yb - C.y) / d.y; q = C + d * t; xs.append(q.x); zs.append(q.z)
    w, h = max(xs) - min(xs), max(zs) - min(zs)
    pw = w / fu; ph = pw * 0.75
    cx = (min(xs) + max(xs)) / 2 - (u_c - 0.5) * pw; cz = (min(zs) + max(zs)) / 2 - (v_c - 0.5) * ph
    m, nt, out = mat('view')
    t = image(nt, VIEW, ext='EXTEND'); em = node(nt, 'ShaderNodeEmission', Strength=1.0); link(nt, t.outputs['Color'], em.inputs['Color'])
    link(nt, em.outputs[0], out.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, yb, cz), rotation=(math.radians(90), 0, 0))
    o = bpy.context.active_object; o.name = 'view'; o.scale = (pw * 1.6, ph * 1.6, 1); o.data.materials.append(m)
    # stretch UVs so the 1.6x plane still maps the image to the inner pw x ph
    for l in o.data.uv_layers.active.data: l.uv = ((l.uv[0] - 0.5) * 1.6 + 0.5, (l.uv[1] - 0.5) * 1.6 + 0.5)
    o.visible_shadow = False
    return o

sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.5; sun.color = (1.0, 0.86, 0.72); sun.angle = math.radians(0.6)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
so.rotation_euler = (Vector((0.25, -1.0, -0.42))).to_track_quat('-Z', 'Y').to_euler()
area_light('window_sky', (WX, Y1 + 0.05, (WS + WSP + WH) / 2), (math.radians(-90), 0, 0), 26.0, (0.62, 0.74, 0.9), 2 * WH, WSP + WH - WS, soft=True)
area_light('fill', (0.0, 1.6, CROWN - 0.15), (0, 0, 0), 6.0, (0.55, 0.52, 0.6), 2.2, 3.0, soft=True)

# ======================================================================== shots
CAMS = {
    'wide':     ((-1.12, 0.17, 1.72), (0.4, 2.8, 0.45), 16, 0.6),
    'shoulder': ((-0.32, 0.92, 1.02), (0.16, 2.48, 0.62), 26, 0.3),
    'imac':     ((0.8, 1.5, 0.82), (0.08, 2.55, 0.62), 34, 0.6),
    'skull':    ((-0.62, 2.12, 0.74), (0.14, 2.58, 0.64), 32, 0.45),
}
os.makedirs(OUT, exist_ok=True)
for name in ([] if os.environ.get('NORENDER') else SHOTS):
    loc, tgt, lens, uc = CAMS[name]
    for o in [o for o in bpy.data.objects if o.name.startswith('view')]: bpy.data.objects.remove(o, do_unlink=True)
    backdrop(loc, u_c=uc)
    cam = camera('cam_' + name, loc, tgt, lens); sc.camera = cam
    sc.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', sc.render.filepath)
if os.environ.get('SAVE_BLEND'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'room.blend'))
if os.environ.get('NORENDER'):
    for n in ('goblin', 'vest', 'shorts'):
        ob = bpy.data.objects[n]; vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
        print('BBOX', n, len(vs), [round(min(v[i] for v in vs), 3) for i in range(3)], [round(max(v[i] for v in vs), 3) for i in range(3)])
    print('SEGS', {k: [round(x, 3) for x in v[0]] for k, v in SEGS.items() if '.' not in k or k.endswith('.l')})
