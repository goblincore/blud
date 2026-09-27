# scripts/model_flail.py — the spike flail (morning star), replacing the
# scrapped censer (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md).
#
# A classic ball-and-spike flail: a banded wooden haft with a pommel knob and
# an iron cap + eye bolt at the top, a short chain, and a spiked iron ball on
# a ring. Exports public/assets/lab/flail.glb with the nodes game-flail.ts
# reads: Haft (grip at origin), ChainAnchor (empty under Haft, the eye bolt),
# Ball (ball centred on its origin, ring up), ChainLink (one link). Renders
# docs/dev-notes/2026-09-26-flail/flail-model.png and re-imports the GLB to
# assert the node contract.
#
# Structure, helpers (mat/assign/smooth/join/lathe/torus/cone), the EEVEE
# three-point preview rig and the export + re-import verification are ported
# from the censer's script (git show 8219a903:scripts/model_censer.py) — that
# weapon was scrapped but the rig it worked out (Workbench ignores node
# materials so EEVEE is required for the preview to show real colors, and
# these light energies avoid blow-out) still applies here.
#
# Run:  blender -b --factory-startup -P scripts/model_flail.py
# Metres. Blender space: Z up (glTF export turns it into +Y up).
import bpy, bmesh, math, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "flail.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-26-flail")
os.makedirs(NOTES_DIR, exist_ok=True)

BALL_R = 0.06
REQUIRED = {"Haft", "ChainAnchor", "Ball", "ChainLink"}
MAX_TRIS = 6000

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metal, rough):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    # Workbench's MATERIAL color mode (used for the preview renders if EEVEE
    # falls back) reads diffuse_color, not the Principled BSDF nodes — set
    # both so the preview actually shows wood/iron instead of flat gray.
    m.diffuse_color = (*color, 1)
    m.metallic = metal
    m.roughness = rough
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


WOOD = mat("Wood", (0.12, 0.075, 0.045), 0.0, 0.85)
IRON = mat("Iron", (0.045, 0.045, 0.05), 0.8, 0.5)
IRON_WORN = mat("IronWorn", (0.42, 0.40, 0.37), 0.85, 0.32)   # lighter edge wear, spike tips


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def smooth(o, angle_deg=40):
    # Shade curved surfaces smooth while keeping hard edges (band collars,
    # spike facets, cap rims) crisp — split by face angle, not a blanket smooth.
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    return o


def cone(name, r1, r2, depth, z, verts=16, m=IRON, loc_xy=(0.0, 0.0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                    location=(loc_xy[0], loc_xy[1], z), rotation=rot)
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def torus(name, major, minor, z, m=IRON, rot=(0, 0, 0), segs=20, loc_xy=(0.0, 0.0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segs,
                                     minor_segments=8, location=(loc_xy[0], loc_xy[1], z), rotation=rot)
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def lathe(name, profile, segments=16, m=WOOD):
    """Revolve a (r, z) polyline profile (bottom -> top) around Z into a solid
    of revolution — how a real turned haft is actually made. Any r=0 end
    collapses to a single point (self-capping); a genuinely open ring
    (nonzero r at an end) is filled so the mesh stays closed."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    for i in range(len(verts) - 1):
        bm.edges.new((verts[i], verts[i + 1]))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), axis=(0, 0, 1),
                   angle=math.radians(360), steps=segments, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    boundary = [e for e in bm.edges if e.is_boundary]
    if boundary:
        bmesh.ops.edgeloop_fill(bm, edges=boundary)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    assign(o, m)
    return o


# ================================================================================
# --- The haft: lathe-turned wood + 3 iron bands, pommel knob, cap + eye bolt ----
# ================================================================================
def build_haft(haft_name="Haft", anchor_name="ChainAnchor"):
    # Grip origin at z=0 with ~0.12 of haft below it. Radius ~0.016, swelling
    # to 0.019 at the grip. Bottom end left open (nonzero radius) for the
    # pommel knob to cap; top end tapers down for the iron cap to slip over.
    profile = [
        (0.0130, -0.100),
        (0.0145, -0.070),
        (0.0155, -0.040),
        (0.0160, -0.010),
        (0.0190, 0.000),   # grip swell
        (0.0175, 0.020),
        (0.0160, 0.060),
        (0.0160, 0.150),
        (0.0160, 0.250),
        (0.0165, 0.300),
        (0.0160, 0.340),
        (0.0155, 0.370),
        (0.0150, 0.395),
    ]
    wood = lathe(haft_name + "_wood", profile, segments=16, m=WOOD)

    # 3 iron band rings at 0.08 / 0.2 / 0.34, sitting just outside the wood.
    bands = [
        torus(f"{haft_name}_band0", 0.0175, 0.003, 0.08, m=IRON),
        torus(f"{haft_name}_band1", 0.0175, 0.003, 0.20, m=IRON),
        torus(f"{haft_name}_band2", 0.0180, 0.003, 0.34, m=IRON),
    ]

    # Iron pommel knob at the bottom, capping the wood's open lower end.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=0.022, location=(0, 0, -0.12))
    pommel = bpy.context.object
    pommel.name = haft_name + "_pommel"
    pommel.scale = (1.0, 1.0, 0.85)
    assign(pommel, IRON)

    # Iron cap over the tapered top of the wood, then an eye bolt above it.
    cap = cone(haft_name + "_cap", 0.019, 0.017, 0.03, 0.415, verts=16, m=IRON)
    eyebolt = torus(haft_name + "_eyebolt", 0.012, 0.003, 0.445, m=IRON, rot=(math.pi / 2, 0, 0))

    haft = join(haft_name, [wood, pommel, cap, eyebolt] + bands)
    smooth(haft)
    anchor = bpy.data.objects.new(anchor_name, None)
    bpy.context.collection.objects.link(anchor)
    anchor.parent = haft
    anchor.location = (0, 0, 0.445)
    return haft, anchor


haft, anchor = build_haft("Haft", "ChainAnchor")

# ================================================================================
# --- The ball: spiked iron sphere on a ring, stored beside the haft ------------
# ================================================================================
BALL_LOC = (0.3, 0, 0)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=BALL_R, location=BALL_LOC)
core = bpy.context.object
core.name = "b_core"
assign(core, IRON)

# 12 icosahedron vertex directions give an even spread of spike positions;
# skip the one nearest +Z (Blender space; +Y in glTF) since that's where the
# ring goes, leaving ~12 spikes around the rest of the ball.
PHI = (1 + 5 ** 0.5) / 2
RAW_DIRS = [
    (-1, PHI, 0), (1, PHI, 0), (-1, -PHI, 0), (1, -PHI, 0),
    (0, -1, PHI), (0, 1, PHI), (0, -1, -PHI), (0, 1, -PHI),
    (PHI, 0, -1), (PHI, 0, 1), (-PHI, 0, -1), (-PHI, 0, 1),
]
DIRS = [Vector(v).normalized() for v in RAW_DIRS]
skip_i = max(range(len(DIRS)), key=lambda i: DIRS[i].z)
spike_dirs = [d for i, d in enumerate(DIRS) if i != skip_i]

spikes = []
for i, d in enumerate(spike_dirs):
    base = Vector(BALL_LOC) + d * BALL_R
    quat = d.to_track_quat('Z', 'Y')
    # Two-part spike: an Iron base frustum and an IronWorn tip cone, so the
    # spike tips read as worn/lighter iron per the node contract. Chunky
    # (base radius 0.016) so they read at first-person distance.
    base_len, tip_len = 0.025, 0.020
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.016, radius2=0.009, depth=base_len,
                                    location=base + d * (base_len / 2))
    b = bpy.context.object
    b.rotation_euler = quat.to_euler()
    b.name = f"spike_{i}_base"
    assign(b, IRON)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.009, radius2=0.0, depth=tip_len,
                                    location=base + d * (base_len + tip_len / 2))
    t = bpy.context.object
    t.rotation_euler = quat.to_euler()
    t.name = f"spike_{i}_tip"
    assign(t, IRON_WORN)
    spikes += [b, t]

# A short iron collar seats the ring onto the ball (instead of floating over
# it) so the two read as one forged piece.
collar = cone("b_collar", 0.012, 0.012, 0.013, 0.0615, verts=12, m=IRON, loc_xy=(BALL_LOC[0], BALL_LOC[1]))

# Top ring toward +Z (Blender) / +Y (glTF) — where a chain link hooks through.
# Standing vertical (plane containing Z); its bottom passes through the
# collar (collar spans 0.055-0.068) and its top sits at ~0.09.
ring = torus("b_ring", 0.014, 0.0035, 0.076, m=IRON, rot=(math.pi / 2, 0, 0), loc_xy=(BALL_LOC[0], BALL_LOC[1]))

ball = join("Ball", [core, collar, ring] + spikes)
smooth(ball)
ball.location = BALL_LOC   # beside the haft in the file; the runtime zeroes it

# --- One chain link: an oval ring, long axis +Z here (+Y in glTF) -------------
bpy.ops.mesh.primitive_torus_add(major_radius=0.009, minor_radius=0.0022, major_segments=12,
                                 minor_segments=6, location=(0.5, 0, 0), rotation=(math.pi / 2, 0, 0))
link = bpy.context.object
link.name = "ChainLink"
link.scale = (1.0, 1.6, 1.0)
assign(link, IRON)
bpy.ops.object.select_all(action='DESELECT')
link.select_set(True)
bpy.context.view_layer.objects.active = link
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
print(f"[flail] ChainLink bbox dims (Blender space, Z=long axis): {tuple(round(d, 5) for d in link.dimensions)}")
smooth(link)

# --- Preview render: real materials (EEVEE), workbench only as a fallback ------
WORLD = bpy.data.worlds.new("PreviewWorld")
WORLD.use_nodes = True
WORLD.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.03, 1)
WORLD.node_tree.nodes["Background"].inputs[1].default_value = 1.0
bpy.context.scene.world = WORLD


def light_rig(target):
    # Simple three-point rig (key / fill / rim) around the subject. Energies
    # tuned (via the censer script) to avoid blow-out on metal.
    specs = [
        ("key", 4.5, (1.0, 0.97, 0.9), (target[0] + 0.22, target[1] - 0.30, target[2] + 0.28)),
        ("fill", 1.8, (0.75, 0.8, 0.95), (target[0] - 0.28, target[1] - 0.18, target[2] + 0.10)),
        ("rim", 2.8, (1.0, 0.55, 0.25), (target[0] - 0.05, target[1] + 0.32, target[2] + 0.22)),
    ]
    lights = []
    for name, power, color, loc in specs:
        ld = bpy.data.lights.new(name, type='POINT')
        ld.energy = power
        ld.color = color
        ld.shadow_soft_size = 0.05
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.collection.objects.link(lo)
        lights.append(lo)
    return lights


def render(path, loc, target, res=(1200, 900), ortho=False, ortho_scale=0.4, lens=50):
    # Aim the camera at `target` exactly via look-at math — direction is
    # target minus camera location, camera -Z looks forward, +Y is up.
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.data.lens = lens
    direction = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = cam
    lights = light_rig(target)
    bpy.context.scene.render.resolution_x = res[0]
    bpy.context.scene.render.resolution_y = res[1]
    bpy.context.scene.render.filepath = path
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
        bpy.context.scene.eevee.taa_render_samples = 32
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        print(f"[flail] EEVEE render failed ({e}); falling back to Workbench.")
        bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
        bpy.context.scene.display.shading.color_type = 'MATERIAL'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for lo in lights:
        bpy.data.objects.remove(lo, do_unlink=True)


render(os.path.join(NOTES_DIR, "flail-model.png"), (0.55, -1.5, 0.16), target=(0.2, 0, 0.14), lens=35)

# --- Export + verify -------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True)
size = os.path.getsize(OUT_GLB)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OUT_GLB)
new = [o for o in bpy.data.objects if o not in before]
names = {o.name.split('.')[0] for o in new}
tris = 0
for o in new:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
missing = sorted(REQUIRED - names)
print(f"[flail] exported {OUT_GLB} ({size} bytes, {tris} tris); nodes {sorted(names)}")
if missing:
    raise SystemExit(f"[flail] FAIL: missing nodes {missing}")
if tris > MAX_TRIS:
    raise SystemExit(f"[flail] FAIL: {tris} tris > {MAX_TRIS}")
print("[flail] PASS")
