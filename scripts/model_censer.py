# scripts/model_censer.py — the censer flail (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md §4.4).
#
# A funeral thurible knotted to a snapped brass altar candlestick. Exports
# public/assets/lab/censer.glb with the nodes game-censer.ts reads:
#   Haft (grip at origin), ChainAnchor (empty under Haft, the knot), Head (bowl
#   centred on its origin, ring up), CoalGlow (under Head), ChainLink (one link).
# Renders a preview to docs/dev-notes/2026-09-26-censer/censer-model.png and
# re-imports the GLB to assert the node contract.
#
# Run:  blender -b --factory-startup -P scripts/model_censer.py
# Metres. Blender space: Z up (glTF export turns it into +Y up).
import bpy, math, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "censer.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-26-censer")
os.makedirs(NOTES_DIR, exist_ok=True)

HAFT_TOP = 0.30
HEAD_R = 0.065
REQUIRED = {"Haft", "ChainAnchor", "Head", "CoalGlow", "ChainLink"}
MAX_TRIS = 8000

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metal, rough, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    # Workbench's MATERIAL color mode (used for the preview render) reads
    # diffuse_color, not the Principled BSDF nodes — set both so the preview
    # actually shows brass/iron/glow instead of flat gray.
    m.diffuse_color = (*(emit if emit else color), 1)
    m.metallic = metal
    m.roughness = rough
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        key = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[key].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


BRASS = mat("Brass", (0.62, 0.45, 0.18), 1.0, 0.35)
IRON = mat("Iron", (0.09, 0.085, 0.08), 0.9, 0.55)
GLOW = mat("CoalGlow", (0.05, 0.01, 0.0), 0.0, 0.9, emit=(1.0, 0.38, 0.08), strength=6.0)


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def cone(name, r1, r2, depth, z, verts=16, m=BRASS):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def torus(name, major, minor, z, m=BRASS, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=20,
                                     minor_segments=8, location=(0, 0, z), rotation=rot)
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


# --- Haft: a snapped altar candlestick, grip at the origin ---------------------
parts = [
    cone("h_foot", 0.030, 0.018, 0.020, -0.02),                 # the knob under the fist
    cone("h_shaft", 0.013, 0.011, HAFT_TOP, HAFT_TOP / 2),
    torus("h_knop1", 0.016, 0.006, 0.10),
    torus("h_knop2", 0.017, 0.007, 0.19),
    cone("h_pan", 0.012, 0.034, 0.018, HAFT_TOP - 0.02),       # the drip pan, flaring up
]
# Snapped top: four jagged teeth where the candle cup broke off.
for i in range(4):
    a = i * math.pi / 2 + 0.3
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.006, radius2=0.0, depth=0.02 + 0.008 * (i % 2),
                                    location=(math.cos(a) * 0.024, math.sin(a) * 0.024, HAFT_TOP + 0.004))
    t = bpy.context.object
    assign(t, BRASS)
    parts.append(t)
parts.append(torus("h_knot", 0.016, 0.005, HAFT_TOP - 0.045, m=IRON))   # the chain tied under the pan
haft = join("Haft", parts)

anchor = bpy.data.objects.new("ChainAnchor", None)
bpy.context.collection.objects.link(anchor)
anchor.parent = haft
anchor.location = (0, 0, HAFT_TOP - 0.045)

# --- Head: bowl + pierced lid, centred on the origin ---------------------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=HEAD_R, location=(0, 0, 0))
bowl = bpy.context.object
bowl.name = "h_bowl"
assign(bowl, BRASS)
# Eight vertical slots through the upper half, so the coals show.
cutters = []
for i in range(8):
    a = i * math.pi / 4
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * HEAD_R, math.sin(a) * HEAD_R, HEAD_R * 0.35))
    c = bpy.context.object
    c.scale = (0.03, 0.012, 0.03)
    c.rotation_euler = (0, 0, a)
    cutters.append(c)
cutter = join("h_cutter", cutters)
mod = bowl.modifiers.new("slots", 'BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.object = cutter
bpy.ops.object.select_all(action='DESELECT')
bowl.select_set(True)
bpy.context.view_layer.objects.active = bowl
bpy.ops.object.modifier_apply(modifier="slots")
bpy.data.objects.remove(cutter, do_unlink=True)

rim = torus("h_rim", HEAD_R * 0.98, 0.004, 0.0)
foot = cone("h_foot_ring", HEAD_R * 0.45, HEAD_R * 0.5, 0.012, -HEAD_R * 0.98)
finial = cone("h_finial", 0.008, 0.002, 0.03, HEAD_R + 0.012)
ring = torus("h_ring", 0.014, 0.003, HEAD_R + 0.07, rot=(math.pi / 2, 0, 0))
chains = []
for i in range(3):
    a = i * 2 * math.pi / 3
    p0 = Vector((math.cos(a) * HEAD_R * 0.95, math.sin(a) * HEAD_R * 0.95, 0.0))
    p1 = Vector((0, 0, HEAD_R + 0.058))
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0022, depth=d.length, location=(p0 + p1) / 2)
    s = bpy.context.object
    s.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(s, IRON)
    chains.append(s)
head = join("Head", [bowl, rim, foot, finial, ring] + chains)

bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=HEAD_R * 0.55, location=(0, 0, 0))
coal = bpy.context.object
coal.name = "CoalGlow"
assign(coal, GLOW)
coal.parent = head
head.location = (0.3, 0, 0)          # beside the haft in the file; the runtime zeroes it

# --- One chain link: an oval ring, long axis +Z here (+Y in glTF) ---------------
bpy.ops.mesh.primitive_torus_add(major_radius=0.010, minor_radius=0.0025, major_segments=12,
                                 minor_segments=6, location=(0.5, 0, 0), rotation=(math.pi / 2, 0, 0))
link = bpy.context.object
link.name = "ChainLink"
link.scale = (1.0, 1.6, 1.0)
assign(link, IRON)
bpy.ops.object.select_all(action='DESELECT')
link.select_set(True)
bpy.context.view_layer.objects.active = link
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# --- Preview render (workbench) -------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0.25, -0.9, 0.25)
cam.rotation_euler = (math.radians(80), 0, math.radians(0))
bpy.context.scene.camera = cam
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
bpy.context.scene.display.shading.color_type = 'MATERIAL'
bpy.context.scene.render.resolution_x = 900
bpy.context.scene.render.resolution_y = 700
bpy.context.scene.render.filepath = os.path.join(NOTES_DIR, "censer-model.png")
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(cam, do_unlink=True)

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
print(f"[censer] exported {OUT_GLB} ({size} bytes, {tris} tris); nodes {sorted(names)}")
if missing:
    raise SystemExit(f"[censer] FAIL: missing nodes {missing}")
if tris > MAX_TRIS:
    raise SystemExit(f"[censer] FAIL: {tris} tris > {MAX_TRIS}")
print("[censer] PASS")
