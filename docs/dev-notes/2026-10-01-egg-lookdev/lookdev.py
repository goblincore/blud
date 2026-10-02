# Egg look-dev (2026-10-01): a candled inner egg + outer-flesh variants, Cycles, in the control-room blockout.
# The reference for spec 2026-10-01-egg-candled-caul-design.md; plan work ports the caul generator into build_train_kit.py.
# Run from the repo root (Metal GPU, ~15-30 s a frame at 640x480):
#   CAUL_LEVEL=3 blender --background --factory-startup docs/dev-notes/2026-09-30-egg-ending/controlroom_blockout.blend \
#       --python docs/dev-notes/2026-10-01-egg-lookdev/lookdev.py -- OUTDIR [shot ...]
# Shots: light_bottom light_core light_both egg_near flesh_sac flesh_caul flesh_nest caul_near nest_near.
# CAUL_LEVEL (the round-2 levers, cumulative): 0 plain torn caul, 1 + thinning peeled lips, 2 + torn film, 3 + strands, drips, pool.
# Contact sheets: python3 sheet.py OUT.png COLS "label=path" ...
import bpy, bmesh, math, random, sys
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/egglook'
SHOTS = argv[1:] or ['light_bottom', 'light_core', 'light_both', 'flesh_sac', 'flesh_caul', 'flesh_nest']
random.seed(7)

sc = bpy.context.scene
EGG_C = Vector((0.0, 6.3, 1.5))          # blockout coords: x right, -y toward the door, z up
IN_A, IN_B, TAPER = 0.6, 0.82, 0.12      # inner (candled) egg: 1.2 m wide, 1.64 m tall

# ---------- render setup ----------
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed', e)
sc.cycles.samples = 96
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 10
sc.cycles.transmission_bounces = 10
sc.cycles.transparent_max_bounces = 16
sc.cycles.volume_bounces = 2
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = 640, 480
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'

for o in list(bpy.data.objects):
    if o.name.startswith('egg_'):
        o.hide_render = True; o.hide_viewport = True

# ---------- node helpers ----------
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out

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
        if isinstance(src, (int, float)): dst.default_value = src
        elif isinstance(src, tuple): dst.default_value = src
        else: link(nt, src, dst)
    return sock(n, 'Result', out=True)

def obj_coord(nt):
    return nt.nodes.new('ShaderNodeTexCoord').outputs['Object']

def warped(nt, co, amount, scale):
    nz = node(nt, 'ShaderNodeTexNoise', Scale=scale, Detail=4.0)
    link(nt, co, nz.inputs['Vector'])
    sub = node(nt, 'ShaderNodeVectorMath', _operation='SUBTRACT')
    link(nt, nz.outputs['Color'], sub.inputs[0]); sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    sc_ = node(nt, 'ShaderNodeVectorMath', _operation='SCALE'); sc_.inputs['Scale'].default_value = amount
    link(nt, sub.outputs[0], sc_.inputs[0])
    add = node(nt, 'ShaderNodeVectorMath', _operation='ADD')
    link(nt, co, add.inputs[0]); link(nt, sc_.outputs[0], add.inputs[1])
    return add.outputs[0]

def vein_mask(nt, co, scale, width, warp=0.35):
    v = node(nt, 'ShaderNodeTexVoronoi', _feature='DISTANCE_TO_EDGE', Scale=scale)
    link(nt, warped(nt, co, warp, 2.5), v.inputs['Vector'])
    mr = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': width, 'To Min': 1.0, 'To Max': 0.0})
    link(nt, v.outputs['Distance'], mr.inputs['Value'])
    return mr.outputs['Result']

def maxf(nt, a, b):
    n = node(nt, 'ShaderNodeMath', _operation='MAXIMUM'); link(nt, a, n.inputs[0]); link(nt, b, n.inputs[1]); return n.outputs[0]

def mulf(nt, a, b):
    n = node(nt, 'ShaderNodeMath', _operation='MULTIPLY')
    link(nt, a, n.inputs[0])
    if isinstance(b, float): n.inputs[1].default_value = b
    else: link(nt, b, n.inputs[1])
    return n.outputs[0]

# ---------- materials ----------
def candled_shell():
    m, nt, out = mat('EGG_candled')
    co = obj_coord(nt)
    mott = node(nt, 'ShaderNodeTexNoise', Scale=6.0, Detail=10.0, Roughness=0.65)
    link(nt, co, mott.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.72, 0.62, 0.52, 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (1.0, 0.95, 0.88, 1)
    link(nt, mott.outputs['Fac'], ramp.inputs['Fac'])
    # The vascular net, densest round the figure (front, a little low): a big and a fine Voronoi net.
    region = node(nt, 'ShaderNodeVectorMath', _operation='DISTANCE')
    link(nt, co, region.inputs[0]); region.inputs[1].default_value = (0.0, -0.45, -0.05)
    rr = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.25, 'From Max': 0.95, 'To Min': 1.0, 'To Max': 0.0})
    link(nt, region.outputs['Value'], rr.inputs['Value'])
    veins = maxf(nt, vein_mask(nt, co, 2.2, 0.035), mulf(nt, vein_mask(nt, co, 7.0, 0.02, 0.2), 0.7))
    veins = mulf(nt, mulf(nt, veins, rr.outputs['Result']), 0.0)
    glow = mix_rgb(nt, veins, ramp.outputs['Color'], (0.18, 0.015, 0.01, 1))
    tint = node(nt, 'ShaderNodeMix'); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'
    sock(tint, 'Factor').default_value = 1.0
    link(nt, glow, sock(tint, 'A')); sock(tint, 'B').default_value = (1.0, 0.7, 0.42, 1)
    trans = nt.nodes.new('ShaderNodeBsdfTranslucent'); link(nt, sock(tint, 'Result', True), trans.inputs['Color'])
    surf = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.42, **{'Coat Weight': 0.8, 'Coat Roughness': 0.06, 'Specular IOR Level': 0.6})
    link(nt, mix_rgb(nt, mulf(nt, veins, 0.6), ramp.outputs['Color'], (0.4, 0.08, 0.05, 1)), surf.inputs['Base Color'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.25, Distance=0.02)
    pores = node(nt, 'ShaderNodeTexNoise', Scale=90.0, Detail=2.0); link(nt, co, pores.inputs['Vector'])
    link(nt, pores.outputs['Fac'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], surf.inputs['Normal'])
    mix = node(nt, 'ShaderNodeMixShader', Fac=0.7)
    link(nt, surf.outputs[0], mix.inputs[1]); link(nt, trans.outputs[0], mix.inputs[2])
    link(nt, mix.outputs[0], out.inputs['Surface'])
    vol = node(nt, 'ShaderNodeVolumePrincipled', Density=0.12, Anisotropy=0.5, Color=(1.0, 0.78, 0.55, 1))
    link(nt, vol.outputs[0], out.inputs['Volume'])
    return m

def ridge_mask(nt, co, scale, width, warp):
    nz = node(nt, 'ShaderNodeTexNoise', Scale=scale, Detail=3.0, Roughness=0.5)
    link(nt, warped(nt, co, warp, scale * 0.4), nz.inputs['Vector'])
    sub = node(nt, 'ShaderNodeMath', _operation='SUBTRACT'); link(nt, nz.outputs['Fac'], sub.inputs[0]); sub.inputs[1].default_value = 0.5
    ab = node(nt, 'ShaderNodeMath', _operation='ABSOLUTE'); link(nt, sub.outputs[0], ab.inputs[0])
    mr = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': width, 'To Min': 1.0, 'To Max': 0.0})
    link(nt, ab.outputs[0], mr.inputs['Value'])
    return mr.outputs['Result']

def flesh():
    m, nt, out = mat('EGG_flesh')
    co = obj_coord(nt)
    base_n = node(nt, 'ShaderNodeTexNoise', Scale=2.6, Detail=10.0, Roughness=0.62)
    link(nt, warped(nt, co, 0.6, 1.2), base_n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.3; cr.elements[0].color = (0.05, 0.006, 0.012, 1)    # clotted, near black
    cr.elements[1].position = 0.74; cr.elements[1].color = (0.62, 0.42, 0.24, 1)    # yellow fat
    for pos, c in ((0.42, (0.22, 0.015, 0.02)), (0.53, (0.42, 0.05, 0.05)), (0.62, (0.6, 0.2, 0.18)), (0.68, (0.25, 0.07, 0.14))):
        e = cr.elements.new(pos); e.color = (*c, 1)
    link(nt, base_n.outputs['Fac'], ramp.inputs['Fac'])
    veins = maxf(nt, ridge_mask(nt, co, 2.2, 0.03, 0.5), mulf(nt, ridge_mask(nt, co, 6.0, 0.02, 0.3), 0.7))
    col = mix_rgb(nt, mulf(nt, veins, 0.85), ramp.outputs['Color'], (0.06, 0.02, 0.1, 1))
    p = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.45, **{
        'Subsurface Weight': 1.0, 'Subsurface Radius': (1.0, 0.15, 0.06), 'Subsurface Scale': 0.025,
        'Coat Weight': 1.0, 'Coat Roughness': 0.02, 'Coat IOR': 1.5, 'Specular IOR Level': 0.8})
    link(nt, col, p.inputs['Base Color'])
    lump = node(nt, 'ShaderNodeTexNoise', Scale=6.0, Detail=6.0); link(nt, co, lump.inputs['Vector'])
    pore = node(nt, 'ShaderNodeTexVoronoi', Scale=90.0); link(nt, co, pore.inputs['Vector'])
    h = node(nt, 'ShaderNodeMath', _operation='ADD'); link(nt, mulf(nt, veins, 0.7), h.inputs[0]); link(nt, mulf(nt, lump.outputs['Fac'], 1.0), h.inputs[1])
    h2 = node(nt, 'ShaderNodeMath', _operation='ADD'); link(nt, h.outputs[0], h2.inputs[0]); link(nt, mulf(nt, pore.outputs['Distance'], 0.3), h2.inputs[1])
    bump = node(nt, 'ShaderNodeBump', Strength=0.8, Distance=0.025)
    link(nt, h2.outputs[0], bump.inputs['Height']); link(nt, bump.outputs['Normal'], p.inputs['Normal'])
    thin = node(nt, 'ShaderNodeTexNoise', Scale=2.2, Detail=3.0); link(nt, co, thin.inputs['Vector'])
    tm = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.55, 'From Max': 0.72, 'To Min': 0.0, 'To Max': 0.3})
    link(nt, thin.outputs['Fac'], tm.inputs['Value'])
    tr = node(nt, 'ShaderNodeBsdfTranslucent', Color=(0.55, 0.04, 0.02, 1))
    mx = nt.nodes.new('ShaderNodeMixShader')
    link(nt, tm.outputs['Result'], mx.inputs['Fac']); link(nt, p.outputs[0], mx.inputs[1]); link(nt, tr.outputs[0], mx.inputs[2])
    link(nt, mx.outputs[0], out.inputs['Surface'])
    return m

def simple(name, color, rough=0.5, metal=0.0, coat=0.0, trans=0.0, ior=1.45, sss=0.0):
    m, nt, out = mat(name)
    p = node(nt, 'ShaderNodeBsdfPrincipled', **{'Base Color': color, 'Roughness': rough, 'Metallic': metal,
        'Coat Weight': coat, 'Coat Roughness': 0.03, 'Transmission Weight': trans, 'IOR': ior,
        'Subsurface Weight': sss, 'Subsurface Radius': (1.0, 0.2, 0.1), 'Subsurface Scale': 0.02})
    link(nt, p.outputs[0], out.inputs['Surface'])
    return m

M_SHELL = candled_shell()
M_FLESH = flesh()
M_FIG = simple('EGG_figure', (0.02, 0.003, 0.003, 1), rough=0.6)
M_MUCUS = simple('EGG_mucus', (0.92, 0.8, 0.55, 1), rough=0.02, coat=1.0, trans=0.35, ior=1.45, sss=0.8)
M_POOL = simple('EGG_pool', (0.32, 0.03, 0.02, 1), rough=0.02, coat=1.0, trans=0.3, ior=1.4)
M_CABLE = simple('EGG_cable', (0.02, 0.02, 0.022, 1), rough=0.28, coat=0.6)
M_RUST = simple('EGG_rust', (0.22, 0.09, 0.04, 1), rough=0.55, metal=0.6)

# ---------- geometry helpers ----------
def egg_bm(a, b, taper, segs=128, rings=96, disp=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        s = a * (1.0 - taper * z)
        p = Vector((x * s, y * s, z * b))
        if disp:
            p = p + Vector((x, y, z)).normalized() * disp(p)
        v.co = p
    return bm

def bm_object(name, bm, material, collection=None, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for poly in me.polygons: poly.use_smooth = smooth
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material)
    (collection or sc.collection).objects.link(ob)
    return ob

def fbm(p, octaves=4):
    v, amp, f = 0.0, 0.5, 1.0
    for _ in range(octaves):
        v += amp * noise.noise(p * f); amp *= 0.5; f *= 2.0
    return v

def tube(name, pts, radii, material, coll=None, res=6):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1); sp.use_endpoint_u = True; sp.order_u = min(4, len(pts))
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (p[0], p[1], p[2], 1.0); sp.points[i].radius = r
    ob = bpy.data.objects.new(name, cu); ob.data.materials.append(material)
    (coll or sc.collection).objects.link(ob)
    return ob

def collection(name):
    c = bpy.data.collections.new(name); sc.collection.children.link(c); return c

# ---------- the inner (candled) egg, shared ----------
C_INNER = collection('inner')
inner = bm_object('inner_egg', egg_bm(IN_A, IN_B, TAPER), M_SHELL, C_INNER)
inner.location = EGG_C

mb = bpy.data.metaballs.new('figure'); mb.resolution = 0.02; mb.render_resolution = 0.012; mb.threshold = 0.6
fig = bpy.data.objects.new('figure', mb); C_INNER.objects.link(fig); fig.data.materials.append(M_FIG)
fig.location = EGG_C + Vector((0.0, -0.36, -0.04)); fig.scale = (1.55, 1.0, 1.45)
for (x, y, z), r, s in [((0.0, 0.0, 0.26), 0.21, (1.0, 1.0, 1.0)),        # head, big
                         ((0.04, 0.02, 0.0), 0.22, (0.85, 0.75, 1.25)),    # curled body
                         ((0.10, -0.04, -0.20), 0.13, (1.0, 1.0, 1.0)),    # haunch
                         ((0.02, -0.12, 0.08), 0.09, (1.0, 1.0, 1.6)),     # arm bud
                         ((-0.10, -0.06, -0.24), 0.10, (1.0, 1.0, 1.0)),   # leg
                         ((-0.06, 0.04, -0.33), 0.07, (1.0, 1.0, 1.0)),    # tail curl
                         ((0.14, 0.0, 0.12), 0.10, (1.0, 1.0, 1.0))]:      # hump
    el = mb.elements.new(); el.type = 'ELLIPSOID' if s != (1.0, 1.0, 1.0) else 'BALL'
    el.co = (x, y, z); el.radius = r
    if el.type == 'ELLIPSOID': el.size_x, el.size_y, el.size_z = [r * k for k in s]

M_VESSEL = simple('EGG_vessel', (0.4, 0.02, 0.015, 1), rough=0.5)
M_OVESSEL = simple('EGG_ovessel', (0.09, 0.03, 0.12, 1), rough=0.25, coat=1.0, sss=0.6)
def on_shell(p, inset=0.985):
    # project a point (egg-local) onto the inner egg's surface, scaled in a little
    x, y, z = p
    for _ in range(3):
        zn = max(-0.999, min(0.999, z / IN_B))
        s_ = IN_A * (1 - TAPER * zn)
        q = Vector((x / s_, y / s_, z / IN_B))
        q.normalize()
        x, y, z = q.x * IN_A * (1 - TAPER * q.z), q.y * IN_A * (1 - TAPER * q.z), q.z * IN_B
    return Vector((x, y, z)) * inset

def grow(p, d, r, depth, out):
    pts, rad = [p], [r]
    steps = int(10 + 8 * random.random())
    for i in range(steps):
        n = p.normalized()
        d = (d - n * d.dot(n)).normalized()
        turn = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * 0.55
        d = (d + turn - n * turn.dot(n)).normalized()
        p = on_shell(p + d * 0.055)
        r *= 0.93
        pts.append(p); rad.append(r)
        if depth < 3 and random.random() < 0.22:
            side = n.cross(d) * (1 if random.random() < 0.5 else -1)
            grow(p, (d + side * 1.2).normalized(), r * 0.7, depth + 1, out)
    out.append((pts, rad))

C_VES = collection('vessels')
random.seed(11)
root = on_shell(Vector((0.05, -0.6, -0.12)))
paths = []
for k in range(7):
    ang = k / 7 * math.tau + random.uniform(-0.3, 0.3)
    n = root.normalized(); t1 = n.cross(Vector((0, 0, 1))).normalized(); t2 = n.cross(t1)
    grow(root, (t1 * math.cos(ang) + t2 * math.sin(ang)).normalized(), 0.012, 0, paths)
for i, (pts, rad) in enumerate(paths):
    if len(pts) > 2: tube(f'vessel{i}', [EGG_C + q for q in pts], rad, M_VESSEL, C_VES, res=3)
# the stalk from the figure to the vessel root
tube('stalk', [fig.location + Vector((0.02, -0.12, -0.05)), EGG_C + root * 0.9 + Vector((0, 0.04, 0)), EGG_C + root], [0.03, 0.022, 0.016], M_VESSEL, C_VES)

def point_light(name, loc, energy, color, radius, coll):
    L = bpy.data.lights.new(name, 'POINT'); L.energy = energy; L.color = color; L.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, L); ob.location = loc; coll.objects.link(ob); return ob

C_LB = collection('light_bottom'); point_light('egg_bottom', EGG_C + Vector((0, 0, -IN_B + 0.1)), 170.0, (1.0, 0.62, 0.32), 0.12, C_LB)
C_LC = collection('light_core'); point_light('egg_core', EGG_C + Vector((0, 0.26, 0.02)), 70.0, (1.0, 0.7, 0.42), 0.1, C_LC)
# The room needs the egg's warm spill too: a broad light just outside the inner egg, below its equator.
C_SPILL = collection('spill')
for sx in (-1, 1): point_light(f'egg_spill{sx}', EGG_C + Vector((sx * 1.05, -0.25, -0.7)), 90.0, (1.0, 0.5, 0.22), 0.25, C_SPILL)

# ---------- outer flesh variants ----------
def sac_disp(p):
    sag = 0.10 * max(0.0, -p.z / OUT_B) ** 2                    # the weight of it, sagging over the plinth
    fold = 0.035 * abs(noise.noise(Vector((p.x * 3.0, p.y * 3.0, p.z * 0.8)) + Vector((1.7, 0, 0))))   # vertical folds
    return 0.07 * fbm(p * 1.6 + Vector((3.1, 0.2, 7.7)), 4) + 0.02 * fbm(p * 5.0, 3) + sag - fold

OUT_A, OUT_B = 0.88, 1.18

C_SAC = collection('flesh_sac')
sac = bm_object('sac', egg_bm(OUT_A, OUT_B, 0.08, disp=sac_disp), M_FLESH, C_SAC)
sac.location = EGG_C + Vector((0, 0, 0.02))
sm = sac.modifiers.new('solid', 'SOLIDIFY'); sm.thickness = 0.03; sm.offset = 0.0

C_CAUL = collection('flesh_caul')
import os, heapq
CAUL_LEVEL = int(os.environ.get('CAUL_LEVEL', '3'))
for o in bpy.data.objects:
    if o.name.startswith('clamp_'): o.hide_render = True
plinth_top = max([max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in bpy.data.objects
                  if 'plinth' in o.name.lower() and o.type == 'MESH'] or [0.35])
print('PLINTH_TOP', plinth_top)

def tear(c):
    n = fbm(c * 1.25 + Vector((11.0, 2.0, 5.0)), 4)
    front = max(0.0, -c.y / OUT_A)                     # holes open mostly toward the door
    return n + 0.22 * front - 0.08 * max(0.0, -c.z) - 0.12   # > 0: torn away

def caul_material():
    # The flesh, plus: where the caul thins toward a tear it lets the egg's light through, deep red.
    m = M_FLESH.copy(); m.name = 'EGG_flesh_caul'; nt = m.node_tree
    mapr = [n for n in nt.nodes if n.type == 'MAP_RANGE' and abs(n.inputs['To Max'].default_value - 0.3) < 1e-6][0]
    mixs = [n for n in nt.nodes if n.type == 'MIX_SHADER'][0]
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'thick'
    inv = nt.nodes.new('ShaderNodeMapRange'); inv.inputs['From Min'].default_value = 0.1; inv.inputs['From Max'].default_value = 0.7
    inv.inputs['To Min'].default_value = 0.75; inv.inputs['To Max'].default_value = 0.0
    nt.links.new(attr.outputs['Fac'], inv.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    nt.links.new(mapr.outputs['Result'], mx.inputs[0]); nt.links.new(inv.outputs['Result'], mx.inputs[1])
    nt.links.new(mx.outputs[0], mixs.inputs['Fac'])
    tr = [n for n in nt.nodes if n.type == 'BSDF_TRANSLUCENT'][0]; tr.inputs['Color'].default_value = (0.95, 0.12, 0.05, 1)
    return m

M_FILM = simple('EGG_film', (0.95, 0.7, 0.6, 1), rough=0.04, coat=1.0, trans=0.85, ior=1.38)

bm = egg_bm(OUT_A, OUT_B, 0.08, segs=320, rings=240, disp=sac_disp)
film_faces = []
kill = []
for f in bm.faces:
    c = f.calc_center_median(); t = tear(c)
    if t > 0:
        kill.append(f)
        if CAUL_LEVEL >= 2 and t < 0.09 and noise.noise(c * 3.0 + Vector((4.0, 1.0, 9.0))) > -0.05:
            film_faces.append([v.co.copy() for v in f.verts])
bmesh.ops.delete(bm, geom=kill, context='FACES')
for _ in range(4):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.verts.ensure_lookup_table(); bm.verts.index_update()
boundary = [v.co.copy() for v in bm.verts if v.is_boundary]

# Distance from the tear along the surface (Dijkstra over edges).
dist = [1e9] * len(bm.verts); heap = []
for v in bm.verts:
    if v.is_boundary: dist[v.index] = 0.0; heap.append((0.0, v.index))
heapq.heapify(heap)
while heap:
    d, i = heapq.heappop(heap)
    if d > dist[i] or d > 0.2: continue
    v = bm.verts[i]
    for e in v.link_edges:
        o = e.other_vert(v); nd = d + e.calc_length()
        if nd < dist[o.index]: dist[o.index] = nd; heapq.heappush(heap, (nd, o.index))
weights = []
for v in bm.verts:
    w = min(1.0, dist[v.index] / 0.11); w = w * w * (3 - 2 * w)
    weights.append(0.1 + 0.9 * w)
    if CAUL_LEVEL >= 1:                                   # the lips peel outward as they thin
        v.co = v.co + v.co.normalized() * 0.035 * (1.0 - w) ** 2

caul = bm_object('caul', bm, M_FLESH if CAUL_LEVEL < 1 else caul_material(), C_CAUL)
caul.location = EGG_C + Vector((0, 0, 0.02))
vg = caul.vertex_groups.new(name='thick')
for i, w in enumerate(weights): vg.add([i], w if CAUL_LEVEL >= 1 else 1.0, 'REPLACE')
sm = caul.modifiers.new('solid', 'SOLIDIFY'); sm.offset = -0.5; sm.use_rim = True
if CAUL_LEVEL >= 1:
    sm.thickness = 0.075; sm.vertex_group = 'thick'; sm.thickness_vertex_group = 0.0
else:
    sm.thickness = 0.06
ss = caul.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 1

if CAUL_LEVEL >= 2:   # amniotic film inside the caul, showing across the tears, itself torn
    fm, fnt, fout = mat('EGG_film_masked')
    fco = obj_coord(fnt)
    fz = node(fnt, 'ShaderNodeTexNoise', Scale=2.4, Detail=6.0, Roughness=0.6); link(fnt, warped(fnt, fco, 0.3, 3.0), fz.inputs['Vector'])
    fmr = node(fnt, 'ShaderNodeMapRange', **{'From Min': 0.47, 'From Max': 0.5, 'To Min': 0.0, 'To Max': 1.0}); link(fnt, fz.outputs['Fac'], fmr.inputs['Value'])
    fp = node(fnt, 'ShaderNodeBsdfPrincipled', **{'Base Color': (0.95, 0.72, 0.6, 1), 'Roughness': 0.05, 'Coat Weight': 1.0, 'Coat Roughness': 0.02,
        'Transmission Weight': 0.8, 'IOR': 1.38})
    fv = ridge_mask(fnt, fco, 4.0, 0.025, 0.4)
    link(fnt, mix_rgb(fnt, mulf(fnt, fv, 0.7), (0.95, 0.72, 0.6, 1), (0.5, 0.05, 0.05, 1)), fp.inputs['Base Color'])
    ft = fnt.nodes.new('ShaderNodeBsdfTransparent'); fmx = fnt.nodes.new('ShaderNodeMixShader')
    link(fnt, fmr.outputs['Result'], fmx.inputs['Fac']); link(fnt, ft.outputs[0], fmx.inputs[1]); link(fnt, fp.outputs[0], fmx.inputs[2])
    link(fnt, fmx.outputs[0], fout.inputs['Surface'])
    film = bm_object('film', egg_bm(OUT_A * 0.955, OUT_B * 0.965, 0.08, disp=lambda p_: 0.6 * sac_disp(p_)), fm, C_CAUL)
    film.location = caul.location

def gloop(name, pts, r_end, r_mid, coll):
    # a sagging strand: thick where it leaves the flesh, thin in the span, a bead gathered at the lowest point
    n = len(pts); low = min(range(n), key=lambda i: pts[i].z)
    rad = []
    for i in range(n):
        t = min(i, n - 1 - i) / ((n - 1) / 2)
        r = r_end + (r_mid - r_end) * min(1.0, t * 1.6)
        if i == low: r *= 1.9
        rad.append(r)
    return tube(name, pts, rad, M_MUCUS, coll)

if CAUL_LEVEL >= 3:
    random.seed(31); random.shuffle(boundary)
    made = 0
    for i, a_ in enumerate(boundary):
        if made >= 18: break
        for b_ in boundary[i + 1:i + 200]:
            d = (a_ - b_).length
            mid = (a_ + b_) / 2
            if 0.12 < d < 0.5 and mid.y < 0.15 and tear(mid * (a_.length / max(mid.length, 1e-4))) > 0.03:
                sag = Vector((0, 0, -0.05 - 0.16 * d))
                pts = [a_ + (b_ - a_) * t + mid.normalized() * 0.02 * math.sin(t * math.pi) + sag * math.sin(t * math.pi) for t in [k / 6 for k in range(7)]]
                gloop(f'strand{made}', [EGG_C + q for q in pts], 0.028, 0.008, C_CAUL); made += 1; break
    # strands from the lips back to the egg: it is stuck in it
    for k, a_ in enumerate([v for v in boundary if v.y < 0.0][:9]):
        e = on_shell(a_ * 0.8, 1.0)
        pts = [a_.lerp(e, t) + Vector((0, 0, -0.09 * math.sin(t * math.pi))) for t in [j / 6 for j in range(7)]]
        gloop(f'tether{k}', [EGG_C + q for q in pts], 0.02, 0.006, C_CAUL)
    # drips with a bead on the end, from the lower lips
    lows = sorted([v for v in boundary if v.y < 0.15 and -0.8 < v.z < 0.3], key=lambda v: v.z)[:40]
    random.shuffle(lows)
    for i, v in enumerate(lows[:12]):
        L = 0.06 + 0.22 * random.random(); top = EGG_C + v
        tube(f'drip{i}', [top, top + Vector((0, -0.006, -L * 0.5)), top + Vector((0, -0.01, -L))], [0.011, 0.004, 0.006], M_MUCUS, C_CAUL)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012 + 0.012 * random.random(), location=top + Vector((0, -0.01, -L - 0.012)))
        bead = bpy.context.active_object; bead.scale.z = 1.35; bead.data.materials.append(M_MUCUS)
        for c_ in bead.users_collection: c_.objects.unlink(bead)
        C_CAUL.objects.link(bead); bpy.ops.object.shade_smooth()
    # a slick pooled under it
    mbp = bpy.data.metaballs.new('pool'); mbp.resolution = 0.03; mbp.render_resolution = 0.015; mbp.threshold = 0.6
    pool = bpy.data.objects.new('pool', mbp); C_CAUL.objects.link(pool); pool.data.materials.append(M_POOL)
    pool.location = Vector((EGG_C.x, EGG_C.y, plinth_top)); pool.scale = (1.0, 1.0, 0.18)
    for k in range(26):
        ang = random.random() * math.tau; rr = 0.35 + 0.6 * random.random()
        el = mbp.elements.new(); el.co = (math.cos(ang) * rr, math.sin(ang) * rr - 0.15, 0.0); el.radius = 0.14 + 0.12 * random.random()

C_NEST = collection('flesh_nest')
mb2 = bpy.data.metaballs.new('nest'); mb2.resolution = 0.05; mb2.render_resolution = 0.025; mb2.threshold = 0.6
nest = bpy.data.objects.new('nest', mb2); C_NEST.objects.link(nest); nest.data.materials.append(M_FLESH)
nest.location = EGG_C
for k in range(70):
    ang = random.random() * math.tau
    z = -IN_B * (0.55 + 0.5 * random.random()) + 0.05
    zn = max(-1.0, min(1.0, z / IN_B))
    rr = IN_A * (1.0 - TAPER * zn) * math.sqrt(max(0.0, 1.0 - zn * zn)) + 0.04 + 0.12 * random.random()
    el = mb2.elements.new(); el.co = (math.cos(ang) * rr, math.sin(ang) * rr, z)
    el.radius = 0.16 + 0.16 * random.random()
# Fingers of flesh climbing the egg.
for k in range(9):
    ang = k / 9 * math.tau + random.uniform(-0.25, 0.25)
    pts, rad = [], []
    for j in range(8):
        t = j / 7
        zn = -0.55 + t * (0.4 + 0.75 * random.random())
        zn = min(zn, 0.85)
        r = IN_A * (1.0 - TAPER * zn) * math.sqrt(max(0.0, 1.0 - zn * zn)) + 0.035 * (1 - t) + 0.012
        a2 = ang + 0.35 * math.sin(t * 3.0 + k)
        pts.append(EGG_C + Vector((math.cos(a2) * r, math.sin(a2) * r, zn * IN_B)))
        rad.append(0.075 * (1 - t) ** 1.3 + 0.008)
    tube(f'finger{k}', pts, rad, M_FLESH, C_NEST, res=8)

# Tetsuo: cables and pipes driven into the flesh, shared by the three variants.
C_CABLES = collection('cables')
for k in range(7):
    side = -1 if k % 2 else 1
    start = Vector((side * random.uniform(1.6, 3.2), 6.3 + random.uniform(-1.8, 2.2), 0.02))
    end = EGG_C + Vector((side * 0.55, random.uniform(-0.3, 0.4), random.uniform(-0.75, -0.2)))
    mid = (start + end) / 2 + Vector((0, 0, -0.1))
    mid.z = 0.05
    tube(f'cable{k}', [start, start.lerp(mid, 0.6), mid, mid.lerp(end, 0.5) + Vector((0, 0, 0.12)), end],
         [0.035 + 0.02 * (k % 3)] * 5, M_CABLE if k % 3 else M_RUST, C_CABLES)
for k in range(3):                      # from the ceiling into the top
    ang = k / 3 * math.tau + 0.4
    top = EGG_C + Vector((math.cos(ang) * 0.25, math.sin(ang) * 0.25, IN_B * 0.95))
    tube(f'hang{k}', [Vector((top.x * 3, top.y + (top.y - 6.3) * 2, 3.4)), Vector((top.x * 1.6, top.y, 2.9)), top + Vector((0, 0, 0.25)), top],
         [0.03] * 4, M_CABLE, C_CABLES)


# Raised vessels over the sac, and flesh collars where the cables go in (the Tetsuo join).
def on_sac(p):
    x, y, z = p
    for _ in range(3):
        zn = max(-0.999, min(0.999, z / OUT_B)); s_ = OUT_A * (1 - 0.08 * zn)
        q = Vector((x / s_, y / s_, z / OUT_B)).normalized()
        base = Vector((q.x * OUT_A * (1 - 0.08 * q.z), q.y * OUT_A * (1 - 0.08 * q.z), q.z * OUT_B))
        x, y, z = base + q * sac_disp(base)
    return Vector((x, y, z)) + Vector((x, y, z)).normalized() * 0.012

def grow_on(surf, p, d, r, depth, out, step=0.07):
    pts, rad = [p], [r]
    for i in range(int(8 + 8 * random.random())):
        n = p.normalized(); d = (d - n * d.dot(n)).normalized()
        turn = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * 0.45
        d = (d + turn - n * turn.dot(n)).normalized()
        p = surf(p + d * step); r *= 0.92; pts.append(p); rad.append(r)
        if depth < 2 and random.random() < 0.2:
            grow_on(surf, p, (d + n.cross(d) * (1.3 if random.random() < 0.5 else -1.3)).normalized(), r * 0.7, depth + 1, out, step)
    out.append((pts, rad))

random.seed(23)
opaths = []
for k in range(9):
    start = on_sac(Vector((math.cos(k * 2.4) * 0.5, -0.4 + 0.3 * math.sin(k * 1.3), -0.9 + 0.1 * k)))
    grow_on(on_sac, start, Vector((random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), 1.0)).normalized(), 0.022, 0, opaths)
for i, (pts, rad) in enumerate(opaths):
    if len(pts) > 2: tube(f'ovessel{i}', [EGG_C + Vector((0, 0, 0.02)) + q for q in pts], rad, M_OVESSEL, C_SAC, res=4)

random.seed(5)
for k in range(10):
    side = -1 if k % 2 else 1
    start = Vector((side * random.uniform(1.4, 3.3), 6.3 + random.uniform(-2.2, 2.6), 0.03))
    tip = on_sac(Vector((side * 0.6, random.uniform(-0.45, 0.5), random.uniform(-0.95, 0.2))))
    end = EGG_C + Vector((0, 0, 0.02)) + tip
    mid = (start + end) / 2; mid.z = 0.06
    r = random.choice((0.03, 0.045, 0.065))
    inside = EGG_C + tip * 0.85
    tube(f'tcable{k}', [start, start.lerp(mid, 0.6), mid, mid.lerp(end, 0.5) + Vector((0, 0, 0.15)), end, inside],
         [r] * 6, M_RUST if k % 3 == 0 else M_CABLE, C_CABLES)
    # a swollen collar of flesh round the entry
    n = tip.normalized(); t1 = n.cross(Vector((0, 0, 1))).normalized(); t2 = n.cross(t1)
    ring = [end + (t1 * math.cos(a) + t2 * math.sin(a)) * (r * 1.6) + n * 0.01 for a in [i / 10 * math.tau for i in range(11)]]
    tube(f'collar{k}', ring, [r * 0.9 * (1 + 0.3 * math.sin(i * 1.7)) for i in range(11)], M_FLESH, C_CABLES, res=6)

# ---------- cameras ----------
def camera(name, loc, target, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    ob = bpy.data.objects.new(name, cd); ob.location = loc; sc.collection.objects.link(ob)
    ob.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler()
    return ob

CAM_FRONT = camera('ld_front', Vector((0.0, 3.0, 1.3)), EGG_C + Vector((0, 0, 0.05)), 32)
CAM_NEAR = camera('ld_near', Vector((-1.15, 4.75, 1.05)), EGG_C + Vector((0.1, 0, 0.12)), 26)

SETS = {
    'light_bottom': (['light_bottom', 'spill'], [], CAM_FRONT),
    'light_core':   (['light_core', 'spill'], [], CAM_FRONT),
    'light_both':   (['light_bottom', 'light_core', 'spill'], [], CAM_FRONT),
    'flesh_sac':    (['light_bottom', 'light_core', 'spill'], ['flesh_sac', 'cables'], CAM_FRONT),
    'flesh_caul':   (['light_bottom', 'light_core', 'spill'], ['flesh_caul', 'cables'], CAM_FRONT),
    'flesh_nest':   (['light_bottom', 'light_core', 'spill'], ['flesh_nest', 'cables'], CAM_FRONT),
    'caul_near':    (['light_bottom', 'light_core', 'spill'], ['flesh_caul', 'cables'], CAM_NEAR),
    'egg_near':     (['light_bottom', 'light_core', 'spill'], [], CAM_NEAR),
    'nest_near':    (['light_bottom', 'light_core', 'spill'], ['flesh_nest', 'cables'], CAM_NEAR),
}
ALL = ['vessels', 'light_bottom', 'light_core', 'spill', 'flesh_sac', 'flesh_caul', 'flesh_nest', 'cables']

for shot in SHOTS:
    lights, flesh_on, cam = SETS[shot]
    for name in ALL:
        c = bpy.data.collections[name]
        c.hide_render = name not in lights and name not in flesh_on and name != 'vessels'
    sc.camera = cam
    sc.render.filepath = f'{OUT}/{shot}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', shot)
