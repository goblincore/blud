# scripts/levels/build_the_void.py
"""The Void (spec docs/superpowers/specs/2026-09-24-void-portal-design.md §4) as a .blend.

    blender --background --factory-startup \
        --python scripts/levels/build_the_void.py -- assets-source/levels/the-void.blend

Game space (x, y, z), y up, player walks toward -z; Blender gets (x, -z, y).
After the first run the .blend is the source of truth; edit it in Blender.
"""
import math
import sys

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC["level_id"] = "the-void"
SC["level_name"] = "The Void"
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


# One void room, 40 x 40 m: collision bounds only, nothing drawn.
o = gbox("rooms", "room:1:void", (-20, 0, -40), (20, 8, 0), wire=True)
o["void"] = True
gempty("start", (0, 0, -6), 0.0)  # facing -z, toward the portal
# Faces +z (toward the player); the tracks run away behind it, to -z.
gempty("portal:the-wake:first", (0, 0, -18), math.pi, width=2.2, height=3.4)
glight("portal-light", (0, 1.7, -17.6), (1.0, 0.12, 0.08), 6)

argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "assets-source/levels/the-void.blend"
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(out))
print(f"saved {out}")
