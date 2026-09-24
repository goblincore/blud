"""Build the bride's static, low-poly hand-and-a-half longsword.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 -P scripts/model-bride-sword.py
Template: scripts/model-cultist-smg.py (same helpers, same GUN_GRIP frame).
All authored measurements use the runtime frame: X right, Y up, Z forward
(the blade direction). The hands keep the shared GUN_GRIP contract (carry.ts):
Grip_Hand and Fore_Hand are unchanged, and the whole hilt is built along the
line through them, so both fists land on the leather grip. Muzzle is the
blade's point on that same axis. The runtime scales the prop by
MotionProfile.prop.scale.
"""
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "public/assets/lab/bride-sword.glb")
PREVIEW = os.path.join(ROOT, "docs/dev-notes/2026-09-24-bride/sword-model.png")

GRIP_HAND = (0, -.074, -.074)
FORE_HAND = (0, -.045, .155)
# The sword axis: Grip_Hand -> Fore_Hand, about 7 degrees nose-up.
_d = [f-g for f, g in zip(FORE_HAND, GRIP_HAND)]
_n = math.sqrt(sum(c*c for c in _d))
AXIS = tuple(c/_n for c in _d)                 # s: along the sword
UP = (0, AXIS[2], -AXIS[1])                    # v: perpendicular, in the Y-Z plane
TIP_S = 1.33


def at(s, x=0.0, v=0.0):
    """Runtime-frame point `s` metres along the sword axis from Grip_Hand,
    `x` across (blade width / guard span), `v` out of the blade flat."""
    return tuple(g + s*a + v*u + (x if i == 0 else 0)
                 for i, (g, a, u) in enumerate(zip(GRIP_HAND, AXIS, UP)))


LOCATORS = {"Grip_Hand": GRIP_HAND, "Fore_Hand": FORE_HAND,
            "Muzzle": tuple(round(c, 6) for c in at(TIP_S))}
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


# Dull steel, only half metallic: the held-prop env map (held-prop.ts) turns a
# high metallic into bright chrome in the game. The hilt iron is darker, the
# grip is near-black leather.
steel = material("Bride sword | dull steel", (.26, .27, .29), .45, .48)
iron = material("Bride sword | hilt iron", (.13, .125, .12), .45, .5)
leather = material("Bride sword | grip leather", (.045, .028, .020), .02, .75)


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


def loft(name, rings, mat, cap_start=True, tip=None, bevel=0):
    """Skin equal-length rings of runtime points; cap the start, and either cap
    the end or close it to a single `tip` point."""
    n = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = [(r*n+i, r*n+(i+1) % n, (r+1)*n+(i+1) % n, (r+1)*n+i)
             for r in range(len(rings)-1) for i in range(n)]
    if cap_start:
        faces.append(tuple(range(n-1, -1, -1)))
    last = (len(rings)-1)*n
    if tip is None:
        faces.append(tuple(range(last, last+n)))
    else:
        verts.append(tip)
        t = len(verts)-1
        faces += [(last+i, last+(i+1) % n, t) for i in range(n)]
    return mesh(name, verts, faces, mat, bevel)


def section_ring(s, poly):
    """A cross-section polygon [(x, v)] placed at axis distance s."""
    return [at(s, x, v) for x, v in poly]


# WHEEL POMMEL: a flat disc with its faces parallel to the blade flat, centred
# at s -.06, radius .03, with a raised boss and the peened tang button.
def wheel(name, s0, radius, half, mat, sides=16):
    rings = []
    for v in (-half, half):
        rings.append([at(s0 + radius*math.sin(i*math.tau/sides),
                         radius*math.cos(i*math.tau/sides), v) for i in range(sides)])
    return loft(name, rings, mat)


wheel("Wheel pommel", -.06, .030, .012, iron)
wheel("Pommel boss", -.06, .016, .017, iron, sides=10)
oct8 = [(math.cos(i*math.tau/8 + math.pi/8), math.sin(i*math.tau/8 + math.pi/8))
        for i in range(8)]
loft("Tang peen", [section_ring(-.094, [(x*.006, v*.006) for x, v in oct8]),
                   section_ring(-.086, [(x*.006, v*.006) for x, v in oct8])], iron)

# GRIP: dark leather octagon, s -.03 -> .26, both hands on it. A slight
# swell in the middle; iron ferrules at both ends.
grip_rings = [section_ring(s, [(x*r, v*r) for x, v in oct8])
              for s, r in ((-.03, .015), (.05, .0165), (.115, .0175),
                           (.19, .0165), (.26, .015))]
loft("Leather grip", grip_rings, leather)
for s0, s1 in ((-.034, -.022), (.250, .262)):
    loft("Grip ferrule", [section_ring(s, [(x*.0185, v*.0185) for x, v in oct8])
                          for s in (s0, s1)], iron)

# CROSS-GUARD at s .27: .26 m across X, .02 thick along the axis, the ends
# drooping ~1.4 cm toward the blade, with small flared terminals and a centre
# block (ecusson) where it meets the blade.
SPAN, DROOP = .13, .014
xs = [-1, -.8, -.55, -.3, 0, .3, .55, .8, 1]
guard_rings = []
for k in xs:
    x = k*SPAN
    ds = DROOP*abs(k)**2.2
    hs = .010 if abs(k) < .95 else .012       # axial half-thickness, flared tip
    hv = .011 if abs(k) < .95 else .013
    s = .27 + ds
    guard_rings.append([at(s-hs, x, -hv), at(s+hs, x, -hv),
                        at(s+hs, x, hv), at(s-hs, x, hv)])
# Rings run along X, so the loft's ring order is the bar's length.
loft("Cross-guard", guard_rings, iron, bevel=.002)
loft("Guard ecusson", [section_ring(.262, [(x*.022, v*.015) for x, v in
                                           ((1, 0), (.5, 1), (-.5, 1), (-1, 0),
                                            (-.5, -1), (.5, -1))]),
                       section_ring(.292, [(x*.014, v*.009) for x, v in
                                           ((1, 0), (.5, 1), (-.5, 1), (-1, 0),
                                            (-.5, -1), (.5, -1))])], iron)


# BLADE: s .28 -> point at 1.33. Width .05 at the base tapering to .03, then
# the point. Lenticular section with a fuller down the first two-thirds,
# fading out into a flat diamond before the point.
def blade_section(w, t, fuller):
    """8-point section: edges at +-w/2, shoulders at +-fw, the fuller groove
    sinking the centre from t/2 toward t*.18 as `fuller` goes 0 -> 1."""
    fw = w*.22
    c = t*(.5 - .32*fuller)
    return [(w/2, 0), (fw, t/2), (0, c), (-fw, t/2),
            (-w/2, 0), (-fw, -t/2), (0, -c), (-fw, -t/2)]


blade_rows = [  # s, width, thickness, fuller depth
    (.280, .050, .0085, 0.0),
    (.300, .050, .0085, 1.0),
    (.600, .045, .0075, 1.0),
    (.900, .040, .0065, 1.0),
    (1.02, .037, .0060, 0.0),
    (1.20, .030, .0052, 0.0),
    (1.29, .016, .0040, 0.0),
]
loft("Blade", [section_ring(s, blade_section(w, t, f)) for s, w, t, f in blade_rows],
     steel, tip=at(TIP_S))

# Join disconnected solids into ONE draw mesh with three material groups.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
sword = bpy.context.object
sword.name = "BrideSword"
sword.data.name = "BrideSwordGeometry"
root = bpy.data.objects.new("GunRoot", None)
bpy.context.collection.objects.link(root)
sword.parent = root
for name, pos in LOCATORS.items():
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.location = coord(pos)
    empty.parent = root
    empty.empty_display_size = .012

bpy.ops.object.select_all(action="DESELECT")
for obj in (sword, root, *root.children):
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
    pos = [doc["accessors"][p["attributes"]["POSITION"]]
           for m in doc["meshes"] for p in m["primitives"]]
    lo = [min(a["min"][i] for a in pos) for i in range(3)]
    hi = [max(a["max"][i] for a in pos) for i in range(3)]
    return doc, {"bytes": len(data), "triangles": tris,
                 "meshes": len(doc["meshes"]),
                 "primitives": sum(len(m["primitives"]) for m in doc["meshes"]),
                 "bounds_min": [round(c, 4) for c in lo],
                 "bounds_max": [round(c, 4) for c in hi]}


doc, stats = glb_info(OUTPUT)
assert stats["triangles"] <= 1500, stats
assert stats["meshes"] == 1 and stats["primitives"] == 3, stats
assert not doc.get("animations") and not doc.get("skins")
nodes = {n["name"]: n for n in doc["nodes"]}
for name, expected in LOCATORS.items():
    actual = nodes[name].get("translation", [0, 0, 0])
    assert all(abs(a-b) < 1e-6 for a, b in zip(actual, expected)), (name, actual)
# The point is the far end of the mesh along +Z.
assert abs(stats["bounds_max"][2] - LOCATORS["Muzzle"][2]) < 1e-3, stats
print("BRIDE_SWORD", json.dumps(stats), json.dumps(LOCATORS))

# Reproducible three-quarter QA image, camera and lighting excluded from GLB.
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1400
scene.render.resolution_y = 780
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new("Preview world")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.055, .065, .085, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .5
scene.view_settings.view_transform = "AgX"
center = Vector(coord(at(.62)))
for name, pos, energy, size in [("Key", (.9, 1.0, .9), 16, 1.2),
                                ("Rim", (-.6, .6, -.2), 18, 1.0),
                                ("Fill", (.5, -.4, .6), 8, 1.0)]:
    lamp = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
    bpy.context.collection.objects.link(lamp)
    lamp.location = center + Vector(coord(pos))
    lamp.rotation_euler = (center-lamp.location).to_track_quat("-Z", "Y").to_euler()
    lamp.data.energy, lamp.data.size = energy, size
camera = bpy.data.objects.new("Preview camera", bpy.data.cameras.new("Preview camera"))
bpy.context.collection.objects.link(camera)
camera.location = center+Vector(coord((.35, 1.0, .12)))
camera.rotation_euler = (center-camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 1.6
scene.camera = camera
os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)
print("PREVIEW", PREVIEW)
