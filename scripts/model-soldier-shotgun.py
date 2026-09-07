"""Build the soldier's static, low-poly semiautomatic shotgun.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 -P scripts/model-soldier-shotgun.py
All authored measurements below use the runtime frame: X right, Y up, Z forward.
The origin is the receiver bore; the barrel ends at Muzzle, Z=.410 metres.
No textures, skeleton, animated parts, or FPV-only mechanisms are exported.
"""
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "public/assets/lab/soldier-shotgun.glb")
PREVIEW = os.path.join(ROOT, "docs/dev-notes/2026-09-06-soldier-bulk/model.png")
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


steel = material("Soldier gun | satin steel", (.255, .285, .31), .62, .38)
olive = material("Soldier gun | olive furniture", (.235, .255, .145), .05, .7)
dark = material("Soldier gun | rubber and recesses", (.033, .039, .042), .1, .8)


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


# Exaggerated furniture and bore thickness improve the game-distance read.
# Hand attachments stay fixed; only the muzzle and short stock extend.
# A single bore, visibly open at the muzzle; lower tube ends behind the barrel.
tube("Single barrel", .045, .410, 0, .019, steel, inner=.0138)
tube("Dark bore stop", .366, .367, 0, .0137, dark)
tube("Muzzle collar", .389, .410, 0, .022, steel, inner=.019)
tube("Magazine tube", .036, .346, -.043, .0145, steel)
tube("Magazine end cap", .339, .358, -.043, .017, dark)
box("Barrel magazine clamp", (0, -.022, .325), (.030, .046, .014), dark)
box("Front sight", (0, .026, .379), (.008, .015, .021), steel)

profile("Receiver", [(-.101,-.034), (-.108,.010), (-.092,.029), (.053,.029),
                     (.074,.014), (.074,-.034), (.052,-.045), (-.081,-.045)],
        .059, steel, .004)
# An inset-looking dark ejection port and steel bolt plate on the right side.
box("Ejection port", (.030, -.003, .014), (.002, .030, .064), dark, .0025)
box("Bolt exposed through port", (.031, -.007, .009), (.002, .016, .047), steel, .0007)
box("Charging handle", (.042, -.002, -.002), (.028, .010, .013), dark, .0015)
box("Receiver top rib", (0, .033, -.012), (.019, .008, .111), dark)
box("Rear sight", (0, .043, -.045), (.030, .012, .018), steel)

# Fixed support furniture: no pump joint or animation required.
profile("Fixed olive fore-end", [(.076,-.022), (.225,-.022), (.241,-.039),
                                 (.231,-.069), (.084,-.069), (.071,-.055)],
        .063, olive, .004)
for z in (.096, .121, .146, .171, .196, .221):
    box("Fore-end traction band", (0, -.059, z), (.064, .015, .004), dark, 0)

# Hand locator is inside the rounded slab grip; guard is forward of its strap.
profile("Pistol grip", [(-.084,-.026), (-.047,-.031), (-.062,-.104),
                        (-.096,-.107), (-.11,-.096)], .042, olive, .004)
profile("Grip heel", [(-.065,-.101), (-.096,-.104), (-.108,-.096),
                       (-.107,-.108), (-.095,-.113), (-.066,-.111)], .045, dark, .0015)
# Closed strap with genuinely empty guard interior, rather than a solid slab.
guard = [(-.042,-.031), (.013,-.031), (.026,-.041), (.024,-.062),
         (.013,-.072), (-.032,-.072), (-.045,-.063)]
for i, (z, y) in enumerate(guard):
    z2, y2 = guard[(i+1) % len(guard)]
    dz, dy = z2-z, y2-y
    length = math.hypot(dz, dy)
    nz, ny = -dy/length*.002, dz/length*.002
    profile("Trigger guard strap", [(z+nz,y+ny), (z2+nz,y2+ny),
                                    (z2-nz,y2-ny), (z-nz,y-ny)], .009, dark, 0)
profile("Hanging curved trigger", [(-.012,-.031), (-.006,-.033), (-.009,-.048),
                                   (-.019,-.057), (-.024,-.055), (-.014,-.045)],
        .005, steel, .0005)

# A short conventional shoulder stock seats at bore height at the upper butt.
profile("Compact shoulder stock", [(-.096,.015), (-.151,.008), (-.266,.017),
                                    (-.275,.007), (-.272,-.085), (-.251,-.090),
                                    (-.159,-.057), (-.105,-.047)], .051, olive, .004)
profile("Rubber shoulder pad", [(-.267,.018), (-.280,.012), (-.280,-.086),
                               (-.269,-.092)], .056, dark, .0015)
box("Stock cheek strip", (0, .014, -.205), (.036, .007, .095), dark, .0015)

# Join disconnected solids into ONE draw mesh with only three material groups.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
gun = bpy.context.object
gun.name = "SoldierShotgun"
gun.data.name = "SoldierShotgunGeometry"
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
assert stats["triangles"] <= 2500, stats
assert stats["meshes"] == 1 and stats["primitives"] == 3, stats
assert not doc.get("animations") and not doc.get("skins")
nodes = {n["name"]: n for n in doc["nodes"]}
for name, expected in LOCATORS.items():
    actual = nodes[name].get("translation", [0, 0, 0])
    assert all(abs(a-b) < 1e-6 for a, b in zip(actual, expected)), (name, actual)
print("SOLDIER_SHOTGUN", json.dumps(stats))
print("SHORTY_DOUBLE", json.dumps(glb_info(os.path.join(ROOT, "public/assets/lab/shorty-double.glb"))[1]))

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
camera.data.ortho_scale = .80
scene.camera = camera
os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)
print("PREVIEW", PREVIEW)
