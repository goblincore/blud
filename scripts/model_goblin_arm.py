# scripts/model_goblin_arm.py: builds the FPV goblin arms and exports
# public/assets/lab/goblin-arm.glb. Run headless:
#
#   /opt/homebrew/bin/blender -b -noaudio -P scripts/model_goblin_arm.py
#
# Prints "[goblin-arm] OK" or "[goblin-arm] FAIL: ..." and exits 1 on failure.
# Same pattern as model_grapeshot_shorty.py: build, export, RE-IMPORT and
# verify the runtime contract, gate, then render evidence. Writes only to
# docs/dev-notes/2026-09-04-fpv-goblin-arms/ (no tracked file elsewhere).
#
# FRAME (Blender space, before export): the hand centre is the origin and the
# arm runs along +Z toward the elbow. glTF Y-up export maps Blender +Z to glTF
# +Y, which is the local +Y game-arms.ts aims at the elbow anchor. Dorsal --
# the back of the hand, knuckles, rivets, watch -- is Blender -Y, which lands
# on Three +Z: the side armBasis() turns toward the camera.
#
# The left arm is authored; the right is the same build with x negated
# (build_arm(sx=-1)) so nothing is mirrored by a negative scale, which flips
# winding on export. The watch exists on the left only.
import bpy, bmesh, math, sys, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB   = os.path.join(REPO_ROOT, "public", "assets", "lab", "goblin-arm.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-04-fpv-goblin-arms")
os.makedirs(NOTES_DIR, exist_ok=True)

# ---- numbers ---------------------------------------------------------------
HAND_R   = 0.046          # == GOBLIN_SKIN.handRadius; loadHold() depends on it
WRIST_Z, ELBOW_Z = 0.055, 0.235
WRIST_R, FORE_R0, FORE_R1, ELBOW_R = 0.034, 0.036, 0.042, 0.046
# THE UPPER ARM is its own node (Upper_L/R) rooted at the elbow and aimed by
# the runtime at a shoulder anchor behind the camera -- a two-bone arm, like
# every FPV rig (owner: "most FPV rigs are full upper arm / lower arm and
# hand"). The one-piece stick it replaces showed its far end at extreme view
# pitch. UPPER_IK_LEN is what the IK uses; the MESH overshoots it so that,
# straight or bent, it always runs past the shoulder and out of frame.
UPPER_IK_LEN, UPPER_MESH_LEN = 0.30, 0.46
UPPER_R0, UPPER_R1, SHOULDER_R = 0.042, 0.052, 0.060
BRACER_Z0, BRACER_Z1 = 0.075, 0.180
STRAP_Z = (0.100, 0.155)
TILE_M   = 0.060          # one tile of the generated skin maps per 60 mm of arm
TRI_CAP  = 14000

REQUIRED_NODES = ["Arm_L", "Arm_R", "Hand_L", "Hand_R", "Wrist_L", "Wrist_R",
                  "Elbow_L", "Elbow_R", "Upper_L", "Upper_R", "Shoulder_L", "Shoulder_R",
                  "Watch_Screen"]

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new('Arm'); bpy.context.scene.collection.children.link(col)

def M(n, base, met, rough):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = met
    b.inputs["Roughness"].default_value = rough
    return m
MATS = {
    'Skin':      M('Skin',      (0.34, 0.44, 0.19, 1),   0.0, 0.42),   # goblin.blob palette
    'Leather':   M('Leather',   (0.14, 0.09, 0.06, 1),   0.0, 0.75),
    'Steel':     M('Steel',     (0.205, 0.215, 0.245, 1), 1.0, 0.22),  # == model_grapeshot_shorty.py
    'Brass':     M('Brass',     (0.62, 0.44, 0.16, 1),   1.0, 0.28),   # == model_grapeshot_shorty.py
    'Band':      M('Band',      (0.035, 0.035, 0.04, 1), 0.0, 0.60),
    'WatchBody': M('WatchBody', (0.06, 0.06, 0.07, 1),   0.6, 0.35),
    'Screen':    M('Screen',    (0.02, 0.03, 0.04, 1),   0.0, 0.20),
}

# ---- mesh helpers ---------------------------------------------------------
def sphere(r, segs=24, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free(); return me

def frustum(r0, r1, d, segs=24):
    """r0 at -d/2, r1 at +d/2, along local Z, capped."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r0, radius2=r1, depth=d)
    me = bpy.data.meshes.new('f'); bm.to_mesh(me); bm.free(); return me

def lathe(profile, segs=28, name='lathe'):
    """A closed (r, z) polygon spun about local Z. Outer edge listed going up,
    inner edge coming back down gives a hollow band WITH thickness -- the
    cuff, straps, lip plate and watch band are all this."""
    bm = bmesh.new(); rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs),
                                    r * math.sin(2 * math.pi * i / segs), z))
                      for i in range(segs)])
    n = len(profile)
    for j in range(n):
        a, b = rings[j], rings[(j + 1) % n]
        for i in range(segs):
            k = (i + 1) % segs
            bm.faces.new((a[i], a[k], b[k], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me

def box(sx, sy, sz):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    me = bpy.data.meshes.new('b'); bm.to_mesh(me); bm.free(); return me

def plane_uv(w, h):
    """One quad in the XZ plane facing -Y (dorsal), UVs 0..1 -- the watch
    screen. game-arms.ts maps a canvas straight onto it."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    v = [bm.verts.new(p) for p in ((-w/2, 0, -h/2), (w/2, 0, -h/2), (w/2, 0, h/2), (-w/2, 0, h/2))]
    f = bm.faces.new(v)
    for l, st in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = st
    bm.normal_update()
    if f.normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    me = bpy.data.meshes.new('screen'); bm.to_mesh(me); bm.free(); return me

def cyl_uv(obj, tile=TILE_M):
    """Cylindrical UVs about local Z: u around, v along, one tile per `tile`
    metres. The wrap seam is fixed PER FACE (a quad may not span u 0.98 ->
    0.02, or the whole map streaks backward across it). The generated maps
    tile, so the seam itself is invisible. A skin mesh WITHOUT UVs samples one
    texel -- flat green, the thing this asset exists to remove -- and the gate
    below rejects it."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        us = []
        for l in f.loops:
            x, y, z = l.vert.co
            us.append((math.atan2(y, x) / (2 * math.pi)) % 1.0)
            l[uv].uv = (0.0, z / tile)
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for l, u in zip(f.loops, us):
            l[uv].uv = (u, l[uv].uv.y)
    bm.to_mesh(obj.data); bm.free()

def put(me, name, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, segs=2,
        smooth=True, uv=False):
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    o.location = loc; o.rotation_euler = rot; o.parent = parent
    bpy.context.view_layer.objects.active = o
    if bevel:
        b = o.modifiers.new('bv', 'BEVEL'); b.width = bevel; b.segments = segs
        b.limit_method = 'ANGLE'; b.angle_limit = math.radians(32)
        bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(MATS[mat])
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if uv:
        cyl_uv(o)
    return o

def locator(name, parent, loc):
    e = bpy.data.objects.new(name, None); col.objects.link(e)
    e.location = loc; e.empty_display_size = 0.01; e.parent = parent
    return e

# ---- the arm ----------------------------------------------------------------
def fore_r(z):
    """Forearm radius at height z: a taper from the wrist to the elbow."""
    return FORE_R0 + (FORE_R1 - FORE_R0) * (z - WRIST_Z) / (ELBOW_Z - WRIST_Z)

def build_arm(sx, tag, watch):
    root = bpy.data.objects.new(f'Arm_{tag}', None); col.objects.link(root)
    P = lambda x, y, z: (sx * x, y, z)

    # SKIN. Ball joints on purpose (the blob's stylisation: "a shaft alone
    # reads as a pipe"), radii up from the blob's 0.028 shaft per the owner.
    put(sphere(HAND_R, 24, 16), f'hand_{tag}', 'Skin', root, uv=True)
    # Three knuckle nubs on the back of the fist (dorsal = -Y).
    for i, (x, y, z) in enumerate(((-0.018, -0.036, 0.012), (0.0, -0.040, 0.016), (0.018, -0.036, 0.012))):
        put(sphere(0.011, 12, 8), f'knuckle{i}_{tag}', 'Skin', root, loc=P(x, y, z), uv=True)
    put(sphere(WRIST_R, 16, 12), f'wrist_{tag}', 'Skin', root, loc=(0, 0, WRIST_Z), uv=True)
    put(frustum(FORE_R0, FORE_R1, ELBOW_Z - WRIST_Z, 24), f'forearm_{tag}', 'Skin', root,
        loc=(0, 0, (WRIST_Z + ELBOW_Z) / 2), uv=True)
    put(sphere(ELBOW_R, 16, 12), f'elbow_{tag}', 'Skin', root, loc=(0, 0, ELBOW_Z), uv=True)
    # UPPER ARM: a child node at the elbow, mesh along its local +Z, with a
    # shoulder ball at the far end. The runtime aims this node at the
    # shoulder anchor; the elbow ball above covers the joint at any bend.
    upper = bpy.data.objects.new(f'Upper_{tag}', None); col.objects.link(upper)
    upper.location = (0, 0, ELBOW_Z); upper.parent = root
    put(frustum(UPPER_R0, UPPER_R1, UPPER_MESH_LEN, 20), f'upperarm_{tag}', 'Skin', upper,
        loc=(0, 0, UPPER_MESH_LEN / 2), uv=True)
    put(sphere(SHOULDER_R, 16, 12), f'shoulder_{tag}', 'Skin', upper, loc=(0, 0, UPPER_MESH_LEN), uv=True)
    locator(f'Shoulder_{tag}', upper, (0, 0, UPPER_IK_LEN))
    for i, (x, y, z, r) in enumerate(((-0.030, -0.036, 0.070, 0.0038), (0.026, -0.042, 0.150, 0.0034))):
        put(sphere(r, 8, 6), f'uwart{i}_{tag}', 'Skin', upper, loc=P(x, y, z), uv=True)
    # Warts: on the hand, the wrist, and between bracer and elbow -- never
    # under the cuff, where they would be hidden geometry for nothing.
    # WARTS -- on the ARM, not the fist (owner: "warts are cool but make more
    # sense on the arm than the hand"): one above the band, three between
    # bracer and elbow, and two on the upper arm (in the Upper node's frame,
    # placed after it exists below).
    for i, (x, y, z, r) in enumerate(((0.024, -0.026, 0.066, 0.0032),
                                      (-0.031, 0.016, 0.192, 0.0040), (0.014, -0.043, 0.212, 0.0036),
                                      (0.036, 0.020, 0.224, 0.0030))):
        put(sphere(r, 8, 6), f'wart{i}_{tag}', 'Skin', root, loc=P(x, y, z), uv=True)

    # BRACER: leather cuff, steel lip at the wrist end, two straps with brass
    # buckles on the OUTER face (-X for the left arm; sx mirrors it), six
    # brass rivets along the dorsal ridge.
    z0, z1 = BRACER_Z0, BRACER_Z1
    cuff = [(fore_r(z0) + 0.007, z0), (fore_r(0.100) + 0.008, 0.100), (fore_r(0.130) + 0.009, 0.130),
            (fore_r(0.155) + 0.009, 0.155), (fore_r(z1) + 0.008, z1),
            (fore_r(z1) + 0.001, z1), (fore_r(z0) + 0.001, z0)]
    put(lathe(cuff, 28, 'cuff'), f'bracer_{tag}', 'Leather', root)
    lr = fore_r(z0)
    put(lathe([(lr + 0.009, z0 - 0.001), (lr + 0.009, z0 + 0.003), (lr + 0.001, z0 + 0.003), (lr + 0.001, z0 - 0.001)],
              28, 'lip'), f'lip_{tag}', 'Steel', root)
    for k, zs in enumerate(STRAP_Z):
        r = fore_r(zs) + 0.008
        put(lathe([(r + 0.0035, zs - 0.006), (r + 0.0035, zs + 0.006), (r - 0.001, zs + 0.006), (r - 0.001, zs - 0.006)],
                  28, 'strap'), f'strap{k}_{tag}', 'Leather', root)
        put(box(0.003, 0.012, 0.008), f'buckle{k}_{tag}', 'Brass', root, loc=P(-(r + 0.005), 0, zs),
            bevel=0.0006, smooth=False)
        put(box(0.0045, 0.0015, 0.010), f'pin{k}_{tag}', 'Brass', root, loc=P(-(r + 0.006), 0, zs),
            bevel=0, smooth=False)
    # CHROME SPIKE STUDS (owner: "instead of small brass dots maybe chrome
    # spikes"): three rows -- the dorsal ridge and +-32 deg either side --
    # of four steel cones each, between the two straps, base on the cuff,
    # tips 10 mm proud. A cone's local +Z is rotated onto the outward radial.
    SPIKE_H, SPIKE_R = 0.010, 0.0035
    for row, ang in enumerate((-32, 0, 32)):
        t = math.radians(-90 + ang)          # -90 deg = dorsal (-Y)
        ox, oy = math.cos(t), math.sin(t)    # outward unit radial in XY
        for k, zs in enumerate((0.112, 0.124, 0.136, 0.148)):
            rc = fore_r(zs) + 0.009 + SPIKE_H / 2
            put(frustum(SPIKE_R, 0.0006, SPIKE_H, 10), f'spike{row}{k}_{tag}', 'Steel', root,
                loc=P(ox * rc, oy * rc, zs), rot=(math.radians(90), 0, t + math.radians(90)),
                bevel=0, smooth=True)

    # SMARTWATCH, left wrist only: silicone band round the wrist ball, a
    # rounded-square body on the dorsal side, the screen a separate quad with
    # clean 0..1 UVs so a canvas maps onto it straight.
    if watch:
        zb = 0.050
        rb = math.sqrt(WRIST_R ** 2 - (zb - WRIST_Z) ** 2) + 0.0005   # on the wrist ball's surface
        put(lathe([(rb, zb - 0.004), (rb + 0.003, zb - 0.004), (rb + 0.003, zb + 0.004), (rb, zb + 0.004)],
                  28, 'band'), f'band_{tag}', 'Band', root)
        body_y = -(rb + 0.003 + 0.003)
        put(box(0.030, 0.006, 0.026), f'watchbody_{tag}', 'WatchBody', root, loc=(0, body_y, zb),
            bevel=0.0025, segs=3, smooth=False)
        put(plane_uv(0.024, 0.020), 'Watch_Screen', 'Screen', root, loc=(0, body_y - 0.0031, zb), smooth=False)

    locator(f'Hand_{tag}',  root, (0, 0, 0))
    locator(f'Wrist_{tag}', root, (0, 0, WRIST_Z))
    locator(f'Elbow_{tag}', root, (0, 0, ELBOW_Z))
    return root

ARM_L = build_arm(-1, 'L', watch=True)
ARM_R = build_arm(+1, 'R', watch=False)
bpy.context.view_layer.update()

# ---- export + verify ---------------------------------------------------------
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True,
                              export_yup=True, export_extras=False)
    return os.path.getsize(path)

def verify_glb(path):
    """Re-import and assert the runtime contract game-arms.ts relies on."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    base = lambda o: o.name.split('.')[0]
    names = {base(o) for o in new}
    tris = 0; no_uv = []; hand_dim = None
    def under(o, root):
        p = o.parent
        while p is not None:
            if base(p) == root: return True
            p = p.parent
        return False
    for o in new:
        if o.type != 'MESH': continue
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
        mats = {m.name.split('.')[0] for m in o.data.materials if m}
        if 'Skin' in mats and not o.data.uv_layers:
            no_uv.append(o.name)
        if base(o) == 'hand_L':
            hand_dim = max(o.dimensions)
    screen = next((o for o in new if base(o) == 'Watch_Screen'), None)
    return {
        'tris': tris,
        'missing_nodes': sorted(set(REQUIRED_NODES) - names),
        'skin_without_uv': no_uv,
        'hand_dim': hand_dim,
        'screen_under_arm_l': bool(screen and under(screen, 'Arm_L')),
    }

size = export_glb(OUT_GLB)
info = verify_glb(OUT_GLB)
print(f"[goblin-arm] exported {OUT_GLB} ({size} bytes)")
print(f"[goblin-arm] verify: {info}")
ok = True
if size > 1024 * 1024:
    print(f"[goblin-arm] FAIL: glb {size} bytes over 1 MB", file=sys.stderr); ok = False
if info['tris'] > TRI_CAP:
    print(f"[goblin-arm] FAIL: {info['tris']} tris over {TRI_CAP}", file=sys.stderr); ok = False
if info['missing_nodes']:
    print(f"[goblin-arm] FAIL: missing nodes {info['missing_nodes']}", file=sys.stderr); ok = False
if info['skin_without_uv']:
    print(f"[goblin-arm] FAIL: skin meshes without UVs {info['skin_without_uv']} -- "
          f"they would sample one texel and read flat", file=sys.stderr); ok = False
if info['hand_dim'] is None or abs(info['hand_dim'] - 2 * HAND_R) > 0.002:
    print(f"[goblin-arm] FAIL: hand diameter {info['hand_dim']} != {2 * HAND_R} "
          f"(GOBLIN_SKIN.handRadius; loadHold depends on it)", file=sys.stderr); ok = False
if not info['screen_under_arm_l']:
    print("[goblin-arm] FAIL: Watch_Screen is not under Arm_L", file=sys.stderr); ok = False

# ---- render: a four-angle turntable of the LEFT arm --------------------------
# The imported copy is deleted first so the render shows the authored scene.
for o in list(bpy.data.objects):
    if o.name not in {ob.name for ob in col.objects}:
        bpy.data.objects.remove(o, do_unlink=True)
ARM_R.hide_render = True
for o in col.objects:
    if o.parent is ARM_R or (o.parent and o.parent.parent is ARM_R): o.hide_render = True
w = bpy.context.scene.world = bpy.data.worlds.new('W'); w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.16, 0.17, 0.19, 1)
sun = bpy.data.objects.new('S', bpy.data.lights.new('S', 'SUN')); sun.data.energy = 3.5
sun.rotation_euler = (math.radians(52), 0, math.radians(38)); bpy.context.collection.objects.link(sun)
rim = bpy.data.objects.new('R', bpy.data.lights.new('R', 'AREA')); rim.data.energy = 260; rim.data.size = 2.0
rim.location = (-1.2, 1.1, 0.9); rim.rotation_euler = (math.radians(60), 0, math.radians(-135))
bpy.context.collection.objects.link(rim)
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = 64
sc.render.resolution_x = 860; sc.render.resolution_y = 640
ctr = Vector((0, 0, 0.12)); R = 0.55
for n, (az, el) in enumerate(((-90, 10), (-30, 20), (40, 15), (150, 25))):
    a = math.radians(az); e = math.radians(el)
    cam.location = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * R
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(NOTES_DIR, f'turntable-{n}.png')
    bpy.ops.render.render(write_still=True)

if not ok:
    sys.exit(1)
print("[goblin-arm] OK")
