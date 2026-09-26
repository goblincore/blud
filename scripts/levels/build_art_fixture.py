# scripts/levels/build_art_fixture.py
"""The mesh key's fixture (spec docs/superpowers/specs/2026-09-24-level-mesh-key-design.md §6).

    blender --background --factory-startup --python scripts/levels/build_art_fixture.py

Writes two files in assets-source/levels/fixtures/:
  test-kit.blend   a collection `seat` (one orange cube), the stand-in for kit.blend
  art-shell.blend  one art-shelled 3 x 12 m carriage: a green box shell as dressing,
                   three `seat` instances linked from test-kit.blend, their furniture boxes
Game space (x, y, z), y up, -z forward; Blender gets (x, -z, y).
"""
import os

import bmesh
import bpy

HERE = os.path.abspath("assets-source/levels/fixtures")
KIT = os.path.join(HERE, "test-kit.blend")
LEVEL = os.path.join(HERE, "art-shell.blend")
os.makedirs(HERE, exist_ok=True)


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    return m


def mesh_object(name, quads, mat):
    """quads: lists of four Blender-space corners, wound so the normal faces inward."""
    bm = bmesh.new()
    for q in quads:
        bm.faces.new([bm.verts.new(v) for v in q])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return bpy.data.objects.new(name, me)


# ---- 1. the test kit ----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
seat_coll = bpy.data.collections.new("seat")
bpy.context.scene.collection.children.link(seat_coll)
x0, x1, y0, y1, z0, z1 = -0.4, 0.4, -0.5, 0.5, 0.0, 0.9
box = [
    [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],  # top
    [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)],  # bottom
    [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
    [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
    [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
    [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
]
seat_coll.objects.link(mesh_object("seat-cube", box, material("fixture.seat", (0.9, 0.35, 0.05))))
bpy.ops.wm.save_as_mainfile(filepath=KIT)
print(f"saved {KIT}")

# ---- 2. the level --------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC["level_id"] = "art-shell"
SC["level_name"] = "Art shell (fixture)"
SC["ammo"] = "infinite"

COLLS = {}


def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        SC.collection.children.link(c)
        COLLS[name] = c
    return COLLS[name]


def gbox(collection, name, gmin, gmax, wire=False):
    bmin = (gmin[0], -gmax[2], gmin[1])
    bmax = (gmax[0], -gmin[2], gmax[1])
    mesh = bpy.data.meshes.new(name)
    verts = [(x, y, z) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    if wire:
        obj.display_type = "WIRE"
    coll(collection).objects.link(obj)
    return obj


def gempty(name, pos, yaw=0.0, **props):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "ARROWS"
    obj.location = (pos[0], -pos[2], pos[1])
    obj.rotation_euler = (0.0, 0.0, -yaw)
    for k, v in props.items():
        obj[k] = v
    coll("markers").objects.link(obj)
    return obj


def glight(name, pos, color, power):
    data = bpy.data.lights.new(name, "POINT")
    data.color = color
    data.energy = power * 10.0
    obj = bpy.data.objects.new(name, data)
    obj.location = (pos[0], -pos[2], pos[1])
    obj["power"] = power
    coll("lights").objects.link(obj)


room = gbox("rooms", "room:1:car", (-1.5, 0, -12), (1.5, 2.6, 0), wire=True)
room["shell"] = "art"
gempty("start", (0, 0, -1), 0.0)

# The shell: floor, ceiling, both long walls, the far end, all facing in (Blender space:
# x -1.5..1.5, y 0..12, z 0..2.6).
X0, X1, Y0, Y1, Z0, Z1 = -1.5, 1.5, 0.0, 12.0, 0.0, 2.6
shell = [
    [(X0, Y0, Z0), (X1, Y0, Z0), (X1, Y1, Z0), (X0, Y1, Z0)],  # floor, up
    [(X0, Y0, Z1), (X0, Y1, Z1), (X1, Y1, Z1), (X1, Y0, Z1)],  # ceiling, down
    [(X0, Y0, Z0), (X0, Y1, Z0), (X0, Y1, Z1), (X0, Y0, Z1)],  # west wall, +x
    [(X1, Y0, Z0), (X1, Y0, Z1), (X1, Y1, Z1), (X1, Y1, Z0)],  # east wall, -x
    [(X0, Y1, Z0), (X1, Y1, Z0), (X1, Y1, Z1), (X0, Y1, Z1)],  # far end, -y
]
coll("dressing").objects.link(mesh_object("shell", shell, material("fixture.panel", (0.1, 0.55, 0.12))))

with bpy.data.libraries.load(KIT, link=True, relative=True) as (src, dst):
    dst.collections = ["seat"]
seat = dst.collections[0]
for i, z in enumerate((-3.5, -6.5, -9.5), start=1):
    e = bpy.data.objects.new(f"seat:{i}", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = seat
    e.location = (-1.0, -z, 0.0)
    coll("dressing").objects.link(e)
    gbox("furniture", f"seat-box:{i}", (-1.4, 0, z - 0.5), (-0.6, 0.9, z + 0.5))

bpy.ops.wm.save_as_mainfile(filepath=LEVEL, relative_remap=True)
print(f"saved {LEVEL}")
