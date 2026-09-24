# scripts/levels/render_level_views.py
"""Render review views of a level from its .blend (guide §6: screenshots for review).

    npx tsx scripts/levels/level_surfaces.ts public/assets/levels/<id>.level.json > .lab-tmp/<id>.surfaces.json
    blender --background assets-source/levels/<id>.blend --python scripts/levels/render_level_views.py -- \
        .lab-tmp/<id>.surfaces.json <views.json> <out-dir>

The walls, floors and ceilings are the GAME's own generated surfaces (spec
§6.3, dumped by level_surfaces.ts), so openings and headers match what
plays; the solids themselves are hidden and the `dressing` collection stands
in for them. Lights come from the .blend's `lights` collection, plus a weak
moon and a night-sky world. Nothing is saved back into the .blend.

views.json: [{"name": "01-start", "pos": [x, z], "yaw": 0.0, "pitch": 0.0}, ...,
             {"name": "00-top", "top": true}]  (game space; eyes at 1.62 m)
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SURF = json.load(open(argv[0]))
VIEWS = json.load(open(argv[1]))
OUT = argv[2]
EYE = 1.62


def B(p):
    return Vector((p[0], -p[2], p[1]))


sc = bpy.context.scene
for name in ("rooms", "tunnels", "solids", "furniture", "gates", "triggers", "windows", "markers"):
    c = bpy.data.collections.get(name)
    if c:
        c.hide_render = True

prev = bpy.data.collections.new("preview")
sc.collection.children.link(prev)
MATS = {}


def mat(rgb, emit=None, strength=1.0):
    key = (tuple(round(v, 3) for v in rgb), emit)
    if key not in MATS:
        m = bpy.data.materials.new(f"preview.{len(MATS)}")
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 0.9
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
            bsdf.inputs["Emission Strength"].default_value = strength
        MATS[key] = m
    return MATS[key]


def quad(name, p, material):
    mn, mx, axis = p["min"], p["max"], p["axis"]
    if axis == 1:
        pts = [(mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mn[1], mx[2]), (mn[0], mn[1], mx[2])]
    elif axis == 0:
        pts = [(mn[0], mn[1], mn[2]), (mn[0], mn[1], mx[2]), (mn[0], mx[1], mx[2]), (mn[0], mx[1], mn[2])]
    else:
        pts = [(mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mx[1], mn[2]), (mn[0], mx[1], mn[2])]
    bm = bmesh.new()
    vs = [bm.verts.new(B(q)) for q in pts]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    prev.objects.link(o)


# Brighten the game's palette a little: it is tuned for the game's own rig.
for i, p in enumerate(SURF["planes"]):
    quad(f"plane.{i}", p, mat([min(1.0, c * 1.6) for c in p["color"]]))
for w in SURF["windows"]:
    glow = (0.42, 0.23, 0.10) if w["view"] == "train-waiting" else (0.06, 0.09, 0.16)
    quad(f"window.{w['id']}", w["plane"], mat((0, 0, 0), emit=glow, strength=3.0))

# Lights: the level's point lights, stronger for Eevee; a weak moon; night world.
lights = bpy.data.collections.get("lights")
if lights:
    for o in lights.objects:
        if o.type == "LIGHT":
            o.data.energy = float(o.get("power", 8)) * 40.0
            o.data.shadow_soft_size = 0.2
moon = bpy.data.lights.new("preview.moon", "SUN")
moon.energy = 0.25
moon.color = (0.55, 0.65, 1.0)
mo = bpy.data.objects.new("preview.moon", moon)
mo.rotation_euler = (math.radians(55), 0, math.radians(35))
prev.objects.link(mo)
world = bpy.data.worlds.new("preview.night")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.016, 0.03, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
sc.world = world

sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "AgX"
sc.view_settings.exposure = 0.6

cam_data = bpy.data.cameras.new("preview.cam")
cam = bpy.data.objects.new("preview.cam", cam_data)
prev.objects.link(cam)
sc.camera = cam

xs = [c for r in SURF["rooms"] for c in (r["min"][0], r["max"][0])]
zs = [c for r in SURF["rooms"] for c in (r["min"][1], r["max"][1])]
for v in VIEWS:
    if v.get("top"):
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = max(max(xs) - min(xs), max(zs) - min(zs)) + 4
        cam.location = B(((min(xs) + max(xs)) / 2, 60, (min(zs) + max(zs)) / 2))
        cam.rotation_euler = (0, 0, 0)
        sc.render.resolution_x, sc.render.resolution_y = 540, 1080
        # hide ceilings from above: planes facing down
        for o in prev.objects:
            if o.name.startswith("plane."):
                idx = int(o.name.split(".")[1])
                p = SURF["planes"][idx]
                o.hide_render = p["axis"] == 1 and p["facing"] < 0
    else:
        cam_data.type = "PERSP"
        cam_data.lens = 18
        x, z = v["pos"]
        cam.location = B((x, EYE, z))
        cam.rotation_euler = (math.pi / 2 + v.get("pitch", 0.0), 0, -v.get("yaw", 0.0))
        sc.render.resolution_x, sc.render.resolution_y = 960, 540
        for o in prev.objects:
            o.hide_render = False
    sc.render.filepath = f"{OUT}/{v['name']}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)
