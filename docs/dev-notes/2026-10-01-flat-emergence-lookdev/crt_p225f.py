# A 22-inch flat-face CRT after the ViewSonic P225f (owner's reference, 2026-10-01): a light-grey front frame with a
# sloped inner bevel down to the glass, a deep chin with a groove and a row of buttons, a dark-grey rear housing that
# tapers a long way back, side vents, and a round swivel pedestal. Blender blockout; x right, -y toward the viewer, z up.
# Run: blender --background --factory-startup --python crt_p225f.py -- OUT.png [SCREEN.png]
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/crt.png'
IMG = argv[1] if len(argv) > 1 else ''

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
sc.cycles.samples = 64; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1000, 900
sc.view_settings.view_transform = 'Standard'

# Overall: front 0.50 wide x 0.47 high, 0.47 deep; screen (viewable 20") 0.406 x 0.305, its centre 0.11 + 0.1525 up.
FW, FH, FD = 0.50, 0.47, 0.065          # the front frame
SW, SH = 0.406, 0.305
CHIN, TOP = 0.11, FH - 0.11 - SH       # 0.11 below the glass, 0.055 above
SCZ = CHIN + SH / 2                    # screen centre height (z), x = 0
BASE_Z = 0.07                          # the frame's bottom sits this high on the pedestal

def mat(name, color, rough=0.45, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1); p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = strength
    return m

M_FRONT = mat('front', (0.58, 0.59, 0.58), 0.5)
M_BACK = mat('back', (0.24, 0.25, 0.26), 0.5)
M_BTN = mat('button', (0.52, 0.53, 0.52), 0.4)
M_LED = mat('led', (0.1, 0.8, 0.3), 0.3, (0.1, 1.0, 0.3), 6.0)
M_GLASS = mat('glass', (0.02, 0.025, 0.03), 0.08)

def rrect(w, h, r, n=6, cx=0.0, cz=0.0):
    """Rounded rectangle, counter-clockwise from the right edge's middle, 4*(n+1) points."""
    pts = []
    for qx, qz, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccz = cx + qx * (w / 2 - r), cz + qz * (h / 2 - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((ccx + r * math.cos(a), ccz + r * math.sin(a)))
    return pts

def loft(name, rings, material, cap_first=False, cap_last=False, flip=False):
    """rings: [(y, [(x, z), ...]), ...], all the same length. Bridged in order."""
    bm = bmesh.new()
    vr = [[bm.verts.new((x, y, z)) for (x, z) in pts] for y, pts in rings]
    n = len(vr[0])
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            q = [a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]
            bm.faces.new(q[::-1] if flip else q)
    if cap_first: bm.faces.new(vr[0][::-1] if not flip else vr[0])
    if cap_last: bm.faces.new(vr[-1] if not flip else vr[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); o.data.materials.append(material); sc.collection.objects.link(o)
    o.location.z = BASE_Z
    return o

N = 6
# The front frame: outer face ring -> inner bevel lip -> down the bevel to the glass, and the outer side band.
outer = rrect(FW, FH, 0.022, N, 0, FH / 2)
lip = rrect(SW + 0.05, SH + 0.045, 0.012, N, 0, SCZ)
glass_edge = rrect(SW + 0.004, SH + 0.004, 0.006, N, 0, SCZ)
loft('frame_face', [(-FD, outer), (-FD, lip), (-FD + 0.028, glass_edge)], M_FRONT)
loft('frame_band', [(-FD, outer), (0.0, rrect(FW - 0.004, FH - 0.004, 0.02, N, 0, FH / 2))], M_FRONT)
# The rear housing: from just inside the frame, swelling a little, then tapering a long way back to a rounded cap.
rings = []
for y, w, h, zc, r in ((0.0, FW - 0.012, FH - 0.012, FH / 2, 0.02), (0.06, FW - 0.02, FH - 0.03, FH / 2 + 0.005, 0.03),
                       (0.2, 0.44, 0.40, FH / 2 + 0.01, 0.06), (0.34, 0.36, 0.32, FH / 2 + 0.01, 0.07), (0.44, 0.28, 0.24, FH / 2, 0.06),
                       (0.47, 0.24, 0.2, FH / 2, 0.05)):
    rings.append((y, rrect(w, h, r, N, 0, zc)))
loft('housing', rings, M_BACK, cap_last=True)
# The glass: flat (the "f" in P225f), set back at the bottom of the bevel.
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -FD + 0.03, BASE_Z + SCZ), rotation=(math.radians(90), 0, 0))
g = bpy.context.active_object; g.scale = (SW, SH, 1); g.name = 'glass'
if IMG:
    m = bpy.data.materials.new('screen'); m.use_nodes = True; nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(IMG)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.4
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    gl = nt.nodes['Principled BSDF']; gl.inputs['Base Color'].default_value = (0, 0, 0, 1); gl.inputs['Roughness'].default_value = 0.05
    add = nt.nodes.new('ShaderNodeAddShader'); nt.links.new(em.outputs[0], add.inputs[0]); nt.links.new(gl.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    g.data.materials.append(m)
else:
    g.data.materials.append(M_GLASS)
# The chin: a groove across it and the button row (menu, 1, down, up, 2, then the LED and the power button).
def box(name, c, s, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c); o = bpy.context.active_object; o.name = name; o.scale = s
    o.data.materials.append(m)
    b = o.modifiers.new('b', 'BEVEL'); b.width = 0.002; b.segments = 2
    return o
box('groove', (0, -FD - 0.001, BASE_Z + 0.035), (FW - 0.06, 0.004, 0.004), M_BACK)
for i, x in enumerate((-0.08, 0.03, 0.065, 0.1, 0.135)):
    box(f'btn{i}', (x, -FD - 0.002, BASE_Z + 0.028), (0.03 if i == 0 else 0.03, 0.006, 0.012), M_BTN)
box('power', (0.205, -FD - 0.002, BASE_Z + 0.028), (0.035, 0.006, 0.012), M_BTN)
box('led', (0.175, -FD - 0.003, BASE_Z + 0.03), (0.005, 0.004, 0.003), M_LED)
# Side vents on the housing's flanks.
for side in (-1, 1):
    for k in range(9):
        box(f'vent{side}{k}', (side * 0.215, 0.1 + k * 0.012, BASE_Z + 0.06), (0.012, 0.004, 0.06), M_BACK)
# The swivel pedestal.
bpy.ops.mesh.primitive_cylinder_add(radius=0.17, depth=0.025, location=(0, 0.12, 0.0125), vertices=64)
b = bpy.context.active_object; b.data.materials.append(M_BACK); b.scale = (1, 0.92, 1)
bv = b.modifiers.new('b', 'BEVEL'); bv.width = 0.01; bv.segments = 4; bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_cylinder_add(radius=0.1, depth=0.05, location=(0, 0.12, 0.045), vertices=48)
nk = bpy.context.active_object; nk.data.materials.append(M_FRONT); bpy.ops.object.shade_smooth()

# A product-shot set: white sweep, a soft key from the front-left, rim from behind.
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.9, 0.9, 0.9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
def area(loc, rot, e, s):
    L = bpy.data.lights.new('a', 'AREA'); L.energy = e; L.size = s
    o = bpy.data.objects.new('a', L); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o)
area((-1.2, -1.4, 1.2), (math.radians(55), 0, math.radians(-40)), 70, 1.2)
area((1.2, 0.8, 1.0), (math.radians(-60), 0, math.radians(140)), 60, 0.8)
def cam(name, loc, tgt, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    o = bpy.data.objects.new(name, cd); o.location = loc; sc.collection.objects.link(o)
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); return o
for name, loc in (('front34', (-0.95, -1.35, 0.55)), ('side', (1.6, 0.05, 0.4))):
    sc.camera = cam(name, loc, (0, 0.1, 0.27), 50)
    sc.render.filepath = OUT.replace('.png', f'-{name}.png'); bpy.ops.render.render(write_still=True)
print('DONE')
