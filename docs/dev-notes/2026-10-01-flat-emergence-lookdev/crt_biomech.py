# The CRT in three takes, from "of our world" to Garage / Giger biomechanics. Blender look-dev.
# VARIANT=p225f | grounded | creature. Run: VARIANT=... blender -b --factory-startup --python crt_biomech.py -- OUTPREFIX [SCREEN.png]
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/crt'
IMG = argv[1] if len(argv) > 1 else ''
VAR = os.environ.get('VARIANT', 'grounded')
random.seed(4)

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
sc.cycles.samples = 64; sc.cycles.use_denoising = True; sc.cycles.diffuse_bounces = 1
sc.render.resolution_x, sc.render.resolution_y = 800, 700
sc.view_settings.view_transform = 'Standard'

FW, FH, FD = 0.50, 0.47, 0.065
SW, SH = 0.406, 0.305
CHIN = 0.11
SCZ = CHIN + SH / 2
BASE_Z = 0.07
N = 6

# ---------- materials ----------
def node_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']

def plain(name, color, rough=0.45, metal=0.0, coat=0.0, emit=None, strength=0.0):
    m, nt, p = node_mat(name)
    p.inputs['Base Color'].default_value = (*color, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal; p.inputs['Coat Weight'].default_value = coat
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = strength
    return m

def textured(name, c0, c1, rough=0.35, metal=0.0, coat=0.4, scale=8.0, bump=0.3, ao_dark=None, sss=0.0):
    """Two-tone procedural noise colour, a pitted bump, crevices darkened by AO: the period-CGI material."""
    m, nt, p = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8.0
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(nz.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs[6].default_value = (*c0, 1); mix.inputs[7].default_value = (*c1, 1)
    col = mix.outputs[2]
    if ao_dark:
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.03
        m2 = nt.nodes.new('ShaderNodeMix'); m2.data_type = 'RGBA'
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(ao.outputs['AO'], inv.inputs[1]); nt.links.new(inv.outputs[0], m2.inputs['Factor'])
        nt.links.new(col, m2.inputs[6]); m2.inputs[7].default_value = (*ao_dark, 1); col = m2.outputs[2]
    nt.links.new(col, p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat; p.inputs['Coat Roughness'].default_value = 0.08
    p.inputs['Subsurface Weight'].default_value = sss
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = scale * 12
    nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
    b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = bump; b.inputs['Distance'].default_value = 0.002
    nt.links.new(vo.outputs['Distance'], b.inputs['Height']); nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    return m

if VAR == 'p225f':
    M_FACE = plain('front', (0.58, 0.59, 0.58), 0.5)
    M_SHELL = plain('back', (0.24, 0.25, 0.26), 0.5)
else:
    M_FACE = textured('bone', (0.42, 0.34, 0.2), (0.66, 0.58, 0.42), rough=0.38, coat=0.5, scale=6.0, bump=0.25, ao_dark=(0.12, 0.08, 0.04), sss=0.15)
    M_SHELL = textured('gunmetal', (0.03, 0.032, 0.035), (0.12, 0.12, 0.125), rough=0.22, metal=0.85, coat=0.6, scale=5.0, bump=0.2, ao_dark=(0.0, 0.0, 0.0))
M_RUST = textured('rust', (0.12, 0.05, 0.02), (0.32, 0.14, 0.05), rough=0.6, metal=0.3, coat=0.0, scale=14.0, bump=0.5)
M_FLESH = textured('lips', (0.25, 0.08, 0.08), (0.5, 0.25, 0.22), rough=0.3, coat=1.0, scale=9.0, bump=0.4, ao_dark=(0.05, 0.0, 0.01), sss=0.6)
M_HOSE = textured('hose', (0.02, 0.02, 0.022), (0.08, 0.075, 0.07), rough=0.3, metal=0.4, coat=0.8, scale=4.0, bump=0.1)
M_LED = plain('led', (0.1, 0.8, 0.3), 0.3, emit=(0.4, 1.0, 0.3), strength=8.0)
M_EYE = plain('eye', (0.9, 0.3, 0.1), 0.2, emit=(1.0, 0.35, 0.1), strength=10.0)

# ---------- geometry helpers ----------
def rrect(w, h, r, n=6, cx=0.0, cz=0.0):
    pts = []
    for qx, qz, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccz = cx + qx * (w / 2 - r), cz + qz * (h / 2 - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n); pts.append((ccx + r * math.cos(a), ccz + r * math.sin(a)))
    return pts

def loft(name, rings, material, cap_last=False):
    bm = bmesh.new()
    vr = [[bm.verts.new((x, y, z)) for (x, z) in pts] for y, pts in rings]
    n = len(vr[0])
    for a, b in zip(vr, vr[1:]):
        for i in range(n): bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    if cap_last: bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); o.data.materials.append(material); sc.collection.objects.link(o); o.location.z = BASE_Z
    return o

def tube(name, pts, radii, material, closed=False, res=6):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = res; cu.use_fill_caps = not closed
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1); sp.order_u = min(4, len(pts)); sp.use_cyclic_u = closed
    if not closed: sp.use_endpoint_u = True
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (p[0], p[1], p[2], 1.0); sp.points[i].radius = r
    o = bpy.data.objects.new(name, cu); o.data.materials.append(material); sc.collection.objects.link(o)
    return o

def ribbed_hose(name, path, r, material, rings=True):
    """A hose along `path` (world points) with torus ribs every ~2.5 cm: built from primitives, as a 90s modeller would."""
    tube(name, path, [r] * len(path), material)
    if not rings: return
    # sample the path piecewise-linearly
    segs = list(zip(path, path[1:])); total = sum((Vector(b) - Vector(a)).length for a, b in segs)
    k = int(total / 0.025)
    for i in range(k):
        t = (i + 0.5) / k * total; acc = 0.0
        for a, b in segs:
            L = (Vector(b) - Vector(a)).length
            if acc + L >= t:
                u = (t - acc) / L; p = Vector(a).lerp(Vector(b), u); d = (Vector(b) - Vector(a)).normalized(); break
            acc += L
        bpy.ops.mesh.primitive_torus_add(major_radius=r * 1.02, minor_radius=r * 0.28, major_segments=16, minor_segments=8, location=p)
        o = bpy.context.active_object; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        o.data.materials.append(material); bpy.ops.object.shade_smooth()

def sphere(name, c, r, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=c, segments=24, ring_count=16)
    o = bpy.context.active_object; o.name = name; o.scale = scale; o.data.materials.append(material); bpy.ops.object.shade_smooth(); return o

def cone(name, base, tip, r, material):
    base, tip = Vector(base), Vector(tip)
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0.0, depth=(tip - base).length, vertices=16, location=(base + tip) / 2)
    o = bpy.context.active_object; o.name = name; o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((tip - base).normalized())
    o.data.materials.append(material); bpy.ops.object.shade_smooth(); return o

def screen():
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -FD + 0.03, BASE_Z + SCZ), rotation=(math.radians(90), 0, 0))
    g = bpy.context.active_object; g.scale = (SW, SH, 1); g.name = 'glass'
    m = bpy.data.materials.new('screen'); m.use_nodes = True; nt = m.node_tree
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.3
    if IMG:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(IMG); nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    gl = nt.nodes['Principled BSDF']; gl.inputs['Base Color'].default_value = (0, 0, 0, 1); gl.inputs['Roughness'].default_value = 0.04
    add = nt.nodes.new('ShaderNodeAddShader'); nt.links.new(em.outputs[0], add.inputs[0]); nt.links.new(gl.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], nt.nodes['Material Output'].inputs['Surface']); g.data.materials.append(m)

# ---------- the front frame (all variants) ----------
outer = rrect(FW, FH, 0.022, N, 0, FH / 2)
lip = rrect(SW + 0.05, SH + 0.045, 0.012, N, 0, SCZ)
glass_edge = rrect(SW + 0.004, SH + 0.004, 0.006, N, 0, SCZ)
if VAR != 'creature':
    loft('frame_face', [(-FD, outer), (-FD, lip), (-FD + 0.028, glass_edge)], M_FACE)
    loft('frame_band', [(-FD, outer), (0.0, rrect(FW - 0.004, FH - 0.004, 0.02, N, 0, FH / 2))], M_FACE)
screen()
Z = lambda z: BASE_Z + z

if VAR == 'p225f':
    rings = [(y, rrect(w, h, r, N, 0, zc)) for y, w, h, zc, r in ((0.0, FW - 0.012, FH - 0.012, FH / 2, 0.02), (0.06, FW - 0.02, FH - 0.03, FH / 2 + 0.005, 0.03),
             (0.2, 0.44, 0.40, FH / 2 + 0.01, 0.06), (0.34, 0.36, 0.32, FH / 2 + 0.01, 0.07), (0.44, 0.28, 0.24, FH / 2, 0.06), (0.47, 0.24, 0.2, FH / 2, 0.05))]
    loft('housing', rings, M_SHELL, cap_last=True)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.17, depth=0.025, location=(0, 0.12, 0.0125), vertices=64)
    bpy.context.active_object.data.materials.append(M_SHELL)

if VAR == 'grounded':
    # The carapace: a recessed dark core, ribbed by gunmetal hoops that step down toward the back like vertebrae.
    prof = lambda y: (FW - 0.02 - 0.5 * y, FH - 0.03 - 0.45 * y, 0.03 + 0.08 * y)
    core = [(y, rrect(*prof(y)[:2], prof(y)[2], N, 0, FH / 2 + 0.01)) for y in (0.0, 0.1, 0.2, 0.3, 0.4, 0.47)]
    core = [(y, [(x * 0.94, FH / 2 + 0.01 + (z - FH / 2 - 0.01) * 0.94) for x, z in pts]) for y, pts in core]
    loft('core', core, M_RUST, cap_last=True)
    for k, y in enumerate([0.015 + 0.042 * i for i in range(11)]):
        w, h, r = prof(y)
        pts = [(x, y, Z(z)) for x, z in rrect(w, h, r, 4, 0, FH / 2 + 0.01)][::2]
        tube(f'rib{k}', pts, [0.013 - 0.0005 * k] * len(pts), M_SHELL, closed=True)
    # A brow ridge and cheek ridges on the bone face; nodule buttons; the LED as a lit pustule.
    tube('brow', [(-0.23, -FD - 0.004, Z(FH - 0.02)), (-0.1, -FD - 0.012, Z(FH - 0.008)), (0.1, -FD - 0.012, Z(FH - 0.008)), (0.23, -FD - 0.004, Z(FH - 0.02))],
         [0.004, 0.012, 0.012, 0.004], M_FACE)
    for sx in (-1, 1):
        tube(f'cheek{sx}', [(sx * 0.235, -FD - 0.003, Z(FH - 0.06)), (sx * 0.238, -FD - 0.008, Z(0.25)), (sx * 0.226, -FD - 0.003, Z(0.07))], [0.004, 0.009, 0.003], M_FACE)
    for i, x in enumerate((-0.08, 0.03, 0.065, 0.1, 0.135, 0.205)):
        sphere(f'nodule{i}', (x, -FD - 0.002, Z(0.03)), 0.011, M_FACE, (1.3, 0.6, 1.0))
    sphere('led', (0.175, -FD - 0.004, Z(0.032)), 0.005, M_LED)
    # A spine of hoses out of the back, into the floor.
    for k, (x, z) in enumerate(((-0.06, 0.3), (0.0, 0.33), (0.06, 0.28))):
        ribbed_hose(f'hose{k}', [(x, 0.45, Z(z)), (x * 1.5, 0.62, Z(z + 0.02)), (x * 2.5, 0.85, Z(z - 0.12)), (x * 3, 1.0, 0.03)], 0.018, M_HOSE)
    # The pedestal as a vertebra: a body, two transverse processes, a spinous process behind.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.05, location=(0, 0.14, 0.025), vertices=48)
    v = bpy.context.active_object; v.scale = (1, 0.8, 1); v.data.materials.append(M_FACE)
    bv = v.modifiers.new('b', 'BEVEL'); bv.width = 0.015; bv.segments = 4; bpy.ops.object.shade_smooth()
    for sx in (-1, 1): cone(f'process{sx}', (sx * 0.1, 0.16, 0.035), (sx * 0.3, 0.22, 0.02), 0.035, M_FACE)
    cone('spinous', (0, 0.22, 0.04), (0, 0.4, 0.015), 0.04, M_FACE)

if VAR == 'creature':
    # The cranium: a blobby skull-case built from metaballs (period CGI's favourite primitive), the screen in its socket.
    mb = bpy.data.metaballs.new('cranium'); mb.resolution = 0.02; mb.render_resolution = 0.008; mb.threshold = 0.6
    cr = bpy.data.objects.new('cranium', mb); sc.collection.objects.link(cr); cr.data.materials.append(M_SHELL)
    def ball(c, r, s=None):
        e = mb.elements.new(); e.co = c; e.radius = r / 0.575
        if s: e.type = 'ELLIPSOID'; e.size_x, e.size_y, e.size_z = s
    ball((0, 0.2, Z(0.27)), 0.24, (1.0, 1.15, 0.9)); ball((0, 0.4, Z(0.26)), 0.16)
    for sx in (-1, 1):
        ball((sx * 0.17, 0.08, Z(0.3)), 0.11); ball((sx * 0.14, 0.3, Z(0.38)), 0.1); ball((sx * 0.12, 0.05, Z(0.1)), 0.08)
    ball((0, 0.02, Z(0.42)), 0.1, (1.8, 0.6, 0.5))
    # The socket's lips: a thick wet rim round the glass, and a ridge of teeth along the chin.
    rim = [(x, -FD + 0.01, Z(z)) for x, z in rrect(SW + 0.03, SH + 0.03, 0.03, 4, 0, SCZ)][::2]
    tube('lips', rim, [0.022 + 0.006 * math.sin(i * 1.7) for i in range(len(rim))], M_FLESH, closed=True)
    for i in range(13):
        x = -0.17 + i * 0.028
        cone(f'tooth{i}', (x, -FD + 0.005, Z(CHIN - 0.03)), (x, -FD - 0.015, Z(CHIN - 0.03 + 0.03 + 0.008 * (i % 3))), 0.009, M_FACE)
    sphere('eye', (0.2, -FD + 0.02, Z(0.05)), 0.012, M_EYE)
    # A spine trailing from the back of the skull down to the floor, nerves of ribbed hose along it.
    prev = None
    for k in range(12):
        t = k / 11
        p = Vector((0.0, 0.5 + 0.55 * t, Z(0.26 - 0.3 * t * t)))
        sphere(f'vert{k}', p, 0.045 - 0.02 * t, M_FACE, (1.3, 0.8, 1.0))
        cone(f'spike{k}', p + Vector((0, 0, 0.02)), p + Vector((0, 0.02, 0.07 - 0.03 * t)), 0.015, M_FACE)
    for sx in (-1, 1):
        ribbed_hose(f'nerve{sx}', [(sx * 0.07, 0.45, Z(0.2)), (sx * 0.1, 0.7, Z(0.12)), (sx * 0.16, 0.95, 0.06), (sx * 0.3, 1.1, 0.02)], 0.014, M_HOSE)
    # Legs instead of a pedestal: three bony struts with knuckled feet.
    for k, a in enumerate((-0.6, 0.0, 0.6)):
        top = Vector((math.sin(a) * 0.1, 0.15 + math.cos(a) * 0.02, Z(0.04)))
        foot = Vector((math.sin(a) * 0.26, 0.12 + math.cos(a) * 0.1 - (0.15 if k == 1 else 0), 0.0))
        knee = (top + foot) / 2 + Vector((0, 0, 0.05))
        tube(f'leg{k}', [tuple(top), tuple(knee), tuple(foot)], [0.02, 0.016, 0.012], M_FACE)
        sphere(f'foot{k}', foot, 0.018, M_FACE)

# ---------- a period-CGI set: dark, one hard key, a rim, a floor ----------
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.018, 0.016, 1)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0.5, 0)); fl = bpy.context.active_object
fl.data.materials.append(textured('floor', (0.05, 0.04, 0.03), (0.12, 0.1, 0.08), rough=0.4, coat=0.3, scale=3.0, bump=0.1))
def spot(loc, tgt, e, size, color=(1, 0.9, 0.8)):
    L = bpy.data.lights.new('s', 'SPOT'); L.energy = e; L.spot_size = math.radians(60); L.shadow_soft_size = size; L.color = color
    o = bpy.data.objects.new('s', L); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
spot((-1.0, -1.2, 1.4), (0, 0.1, 0.3), 260, 0.02)
spot((1.2, 1.4, 1.1), (0, 0.2, 0.35), 140, 0.05, (0.6, 0.7, 1.0))
def cam(name, loc, tgt, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    o = bpy.data.objects.new(name, cd); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); return o
for name, loc, tgt in (('front34', (-0.95, -1.3, 0.62), (0.05, 0.25, 0.28)), ('side', (1.7, 0.35, 0.55), (0, 0.4, 0.25))):
    sc.camera = cam(name, loc, tgt, 45)
    sc.render.filepath = f'{OUT}-{VAR}-{name}.png'; bpy.ops.render.render(write_still=True)
print('DONE', VAR)
