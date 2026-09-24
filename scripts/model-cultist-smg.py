"""Build the cultist's static, low-poly Thompson-style SMG (tommy gun).

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 -P scripts/model-cultist-smg.py
Template: scripts/model-soldier-shotgun.py (same helpers, same GUN_GRIP frame).
All authored measurements use the runtime frame: X right, Y up, Z forward.
The origin is the receiver bore; the compensator ends at Muzzle, Z=.410 m.
The runtime scales the whole prop by MotionProfile.prop.scale.
"""
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "public/assets/lab/cultist-smg.glb")
PREVIEW = os.path.join(ROOT, "docs/dev-notes/2026-09-23-cultist/smg-model.png")
LOCATORS = {"Grip_Hand": (0, -.074, -.074),
            "Fore_Hand": (0, -.045, .155), "Muzzle": (0, 0, .410)}
bpy.ops.wm.read_factory_settings(use_empty=True)
parts = []


def coord(p):
    """Blender Z up -> glTF Y up is (x, z, -y)."""
    return (p[0], -p[2], p[1])


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


# Blued steel: dark and only half metallic — the held-prop env map (held-prop.ts)
# turned a .70 metallic into bright silver in the game. Walnut is the read.
steel = material("Cultist SMG | blued steel", (.075, .080, .092), .45, .45)
olive = material("Cultist SMG | walnut", (.34, .16, .07), .02, .55)
dark = material("Cultist SMG | recesses", (.030, .032, .036), .1, .8)


def mesh(name, vertices, faces, mat, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([coord(v) for v in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    if bevel:
        modifier = obj.modifiers.new("Single chamfer for readable edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    parts.append(obj)
    return obj


def profile(name, outline, width, mat, bevel=.002):
    """Side outline in (forward Z, height Y), extruded across X."""
    n = len(outline)
    verts = [(x, y, z) for x in (-width/2, width/2) for z, y in outline]
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, n*2))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, mat, bevel)


def box(name, center, size, mat, bevel=.001):
    x, y, z = center
    sx, sy, sz = (v/2 for v in size)
    verts = [(x+dx*sx, y+dy*sy, z+dz*sz)
             for dx, dy, dz in ((-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
                               (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1))]
    faces = [(0,3,2,1), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)]
    return mesh(name, verts, faces, mat, bevel)


def tube(name, z0, z1, y, radius, mat, inner=0, sides=12):
    rings = [(z0, radius), (z1, radius)]
    if inner:
        rings += [(z1, inner), (z0, inner)]
    verts = [(r*math.cos(i*math.tau/sides), y+r*math.sin(i*math.tau/sides), z)
             for z, r in rings for i in range(sides)]
    faces = []
    for ring in range(len(rings) if inner else 1):
        nxt = (ring+1) % len(rings)
        faces += [(ring*sides+i, ring*sides+(i+1) % sides,
                   nxt*sides+(i+1) % sides, nxt*sides+i) for i in range(sides)]
    if not inner:
        faces += [tuple(range(sides-1, -1, -1)), tuple(range(sides, sides*2))]
    obj = mesh(name, verts, faces, mat)
    if inner:
        obj.data.materials.append(dark)
        for face in obj.data.polygons[2*sides:3*sides]:
            face.material_index = 1
    return obj




def drum(name, z, y, radius, width, mat, sides=20):
    """A cylinder whose axis runs ACROSS the gun (X): the drum magazine."""
    verts = [(x, y+radius*math.sin(i*math.tau/sides), z+radius*math.cos(i*math.tau/sides))
             for x in (-width/2, width/2) for i in range(sides)]
    faces = [tuple(range(sides-1, -1, -1)), tuple(range(sides, sides*2))]
    faces += [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)]
    return mesh(name, verts, faces, mat, .003)


# THE CULTIST'S SMG — a Thompson-lineage "tommy gun" (owner, 2026-09-23:
# "a gun type weapon, something resembling a thompson or mp44"). Blood's
# cultists carried the tommy gun, so it wins: finned barrel, Cutts
# compensator, 50-round drum, vertical foregrip, walnut furniture.
# Built around the SHARED hand locators (carry.ts GUN_GRIP): the rear pistol
# grip holds Grip_Hand, the vertical foregrip's top holds Fore_Hand, and the
# compensator ends at Muzzle z .410. Exaggerated for the game-distance read.

# Barrel, cooling fins and the Cutts compensator.
tube("Barrel", .085, .365, 0, .0115, steel, inner=.0072)
for i in range(11):
    z = .098 + i*.0125
    tube("Cooling fin", z, z+.0045, 0, .0205, steel)
tube("Cutts compensator", .352, .410, 0, .0175, steel, inner=.0085)
box("Compensator slot", (0, .016, .388), (.022, .004, .026), dark, 0)
box("Front sight blade", (0, .027, .398), (.005, .016, .012), steel)

# Receiver: a long flat-sided box, the Thompson's slab silhouette.
profile("Receiver", [(-.105,-.030), (-.110,.018), (-.098,.031), (.080,.031),
                     (.092,.018), (.092,-.030), (.070,-.040), (-.085,-.040)],
        .050, steel, .004)
box("Cocking knob", (0, .040, .030), (.012, .016, .018), steel, .002)
box("Top rib", (0, .033, -.010), (.016, .006, .150), dark, 0)
box("Rear sight", (0, .044, -.070), (.026, .016, .016), steel)
box("Ejection port", (.026, .004, .020), (.002, .022, .058), dark, .002)
box("Selector levers", (-.026, -.010, -.030), (.004, .012, .040), dark, .001)

# DRUM MAGAZINE, forward of the trigger group, hanging below the bore.
drum("Drum magazine", .038, -.098, .066, .044, steel)
drum("Drum face plate", .038, -.098, .050, .048, dark)
box("Drum key", (.027, -.098, .038), (.006, .012, .030), steel, .001)
box("Magazine well", (0, -.046, .038), (.040, .024, .044), steel, .002)

# Rear pistol grip — Grip_Hand (0,-.074,-.074) sits inside it.
profile("Pistol grip", [(-.060,-.036), (-.030,-.036), (-.052,-.120),
                        (-.086,-.126), (-.100,-.112)], .036, olive, .004)
guard = [(-.030,-.038), (.004,-.038), (.014,-.050), (.010,-.064),
         (-.004,-.070), (-.034,-.070), (-.044,-.058)]
for i, (z, y) in enumerate(guard):
    z2, y2 = guard[(i+1) % len(guard)]
    dz, dy = z2-z, y2-y
    length = math.hypot(dz, dy)
    nz, ny = -dy/length*.002, dz/length*.002
    profile("Trigger guard strap", [(z+nz,y+ny), (z2+nz,y2+ny),
                                    (z2-nz,y2-ny), (z-nz,y-ny)], .008, dark, 0)
profile("Trigger", [(-.014,-.038), (-.008,-.040), (-.012,-.056), (-.020,-.060),
                    (-.024,-.056)], .005, steel, .0005)

# VERTICAL FOREGRIP under the barrel — Fore_Hand (0,-.045,.155) is its top,
# where the left palm wraps it. Finger grooves as dark bands.
box("Foregrip mount", (0, -.020, .155), (.022, .018, .050), steel, .002)
profile("Vertical foregrip", [(.132,-.028), (.178,-.028), (.182,-.050),
                              (.176,-.118), (.160,-.126), (.138,-.120), (.130,-.050)],
        .038, olive, .005)
for y in (-.060, -.078, -.096):
    box("Finger groove", (0, y, .180), (.040, .006, .006), dark, 0)

# Walnut buttstock, the long Thompson drop.
profile("Buttstock", [(-.108,.014), (-.160,.010), (-.330,-.010), (-.345,-.020),
                      (-.342,-.112), (-.320,-.118), (-.170,-.060), (-.112,-.040)],
        .044, olive, .004)
profile("Butt plate", [(-.342,-.012), (-.352,-.018), (-.350,-.116), (-.340,-.121)],
        .048, dark, .0015)

# Join disconnected solids into ONE draw mesh with only three material groups.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
gun = bpy.context.object
gun.name = "CultistSMG"
gun.data.name = "CultistSMGGeometry"
root = bpy.data.objects.new("GunRoot", None)
bpy.context.collection.objects.link(root)
gun.parent = root
for name, pos in LOCATORS.items():
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.location = coord(pos)
    empty.parent = root
    empty.empty_display_size = .012

bpy.ops.object.select_all(action="DESELECT")
for obj in (gun, root, *root.children):
    obj.select_set(True)
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False)


def glb_info(path):
    with open(path, "rb") as f:
        data = f.read()
    json_size = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20+json_size])
    tris = sum(doc["accessors"][p["indices"]]["count"]//3
               for m in doc["meshes"] for p in m["primitives"])
    return doc, {"bytes": len(data), "triangles": tris,
                 "meshes": len(doc["meshes"]),
                 "primitives": sum(len(m["primitives"]) for m in doc["meshes"])}


doc, stats = glb_info(OUTPUT)
assert stats["triangles"] <= 4000, stats
assert stats["meshes"] == 1 and stats["primitives"] == 3, stats
assert not doc.get("animations") and not doc.get("skins")
nodes = {n["name"]: n for n in doc["nodes"]}
for name, expected in LOCATORS.items():
    actual = nodes[name].get("translation", [0, 0, 0])
    assert all(abs(a-b) < 1e-6 for a, b in zip(actual, expected)), (name, actual)
print("CULTIST_SMG", json.dumps(stats))
# Reproducible three-quarter QA image, camera and lighting excluded from GLB.
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1400
scene.render.resolution_y = 780
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new("Preview world")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.055,.065,.085,1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .5
scene.view_settings.view_transform = "AgX"
center = Vector(coord((0, -.028, .025)))
for name, pos, energy, size in [("Key", (.7,.8,.4), 9, .7),
                                ("Rim", (-.4,.5,-.1), 12, .55),
                                ("Fill", (.4,-.3,.4), 3, .5)]:
    lamp = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
    bpy.context.collection.objects.link(lamp)
    lamp.location = coord(pos)
    lamp.rotation_euler = (center-lamp.location).to_track_quat("-Z", "Y").to_euler()
    lamp.data.energy, lamp.data.size = energy, size
camera = bpy.data.objects.new("Preview camera", bpy.data.cameras.new("Preview camera"))
bpy.context.collection.objects.link(camera)
camera.location = center+Vector(coord((.9,.35,.4)))
camera.rotation_euler = (center-camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = .95
scene.camera = camera
os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)
print("PREVIEW", PREVIEW)
