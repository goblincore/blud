# scripts/levels/build_night_train.py
"""Night Train's first slice (carriage kit spec docs/superpowers/specs/2026-09-25-train-carriage-kit-design.md §4).

    blender --background --factory-startup --python scripts/levels/build_night_train.py

Builds assets-source/levels/night-train.blend from the CARRIAGES table: four art-shelled
carriages (1 the guard's van, 3 the dining car, 5 the party carriage, 8 the cab) toward -z,
1.2 m vestibules between them, every piece a collection instance linked from kit.blend, and
a furniture box for every prop that stands on the floor. After the first run the .blend is
the source of truth; refine it in Blender.

Game space (x, y, z), y up, the train runs toward -z; Blender gets (x, -z, y).
"""
import math
import os
import sys

import bpy

ROOT = os.path.abspath("assets-source/levels")
KIT = os.path.join(ROOT, "kit.blend")
OUT = os.path.join(ROOT, "night-train.blend")
BAY, W, VESTIBULE = 1.9, 1.5, 1.2
PI = math.pi

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC["level_id"] = "night-train"
SC["level_name"] = "Night Train"
SC["ammo"] = "finite"
SC["loadout"] = "melee"

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



# id, name, length (m), ceiling (m), recipe
CARRIAGES = [
    (1, "guards-van", 16.0, 2.6, "van"),
    (3, "dining-car", 18.0, 2.6, "dining"),
    (5, "party-carriage", 20.0, 3.2, "party"),
    (8, "cab", 8.0, 2.6, "cab"),
]
WARM = (1.0, 0.72, 0.45)

with bpy.data.libraries.load(KIT, link=True, relative=True) as (src, dst):
    dst.collections = list(src.collections)
PIECES = {c.name: c for c in dst.collections}
COUNT = {}


def put(piece, x, y, z, yaw=0.0, zscale=1.0):
    """A linked kit piece at game (x, y, z); yaw PI turns it to face the other way."""
    COUNT[piece] = COUNT.get(piece, 0) + 1
    e = bpy.data.objects.new(f"{piece}:{COUNT[piece]}", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = PIECES[piece]
    e.location = (x, -z, y)
    e.rotation_euler = (0.0, 0.0, yaw)
    e.scale = (1.0, zscale, 1.0)
    coll("dressing").objects.link(e)
    return e


def furn(name, x0, x1, z0, z1, h):
    gbox("furniture", name, (x0, 0, z0), (x1, h, z1))


def walls(kind_w, kind_e, zs, length):
    """A wall segment on both sides from zs toward -z; the east side is the west piece turned."""
    k = length / BAY
    put(f"bay-wall-{kind_w}", 0, 0, zs, 0.0, k)
    put(f"bay-wall-{kind_e}", 0, 0, zs - length, PI, k)


def carriage(rid, name, length, ceiling, recipe, max_z):
    min_z = max_z - length
    room = gbox("rooms", f"room:{rid}:{name}", (-W, 0, min_z), (W, ceiling, max_z), wire=True)
    room["shell"] = "art"
    for i in range(max(1, round(length / 8))):
        glight(f"lamp:{rid}:{i}", (0, ceiling - 0.4, max_z - length * (i + 0.5) / max(1, round(length / 8))), WARM, 3)
    if recipe == "cab":
        put("cab-shell", 0, 0, max_z)
        furn(f"backhead:{rid}", -W, W, min_z, min_z + 0.4, 2.4)
        glight(f"firebox:{rid}", (0, 1.0, min_z + 1.0), (1.0, 0.42, 0.12), 4)
        return min_z
    bays = int(length // BAY)
    pad = (length - bays * BAY) / 2
    ceil_piece = "bay-ceiling-32" if ceiling > 3.0 else "bay-ceiling-26"
    floor_piece = "bay-floor-planks" if recipe == "van" else "bay-floor-runner"
    # End pads: plain wall, ceiling and floor scaled to the pad length.
    for zs in (max_z, min_z + pad):
        walls("plain", "plain", zs, pad)
        put(ceil_piece, 0, 0, zs, 0.0, pad / BAY)
        put(floor_piece, 0, 0, zs, 0.0, pad / BAY)
    for b in range(bays):
        zs = max_z - pad - b * BAY
        mid = zs - BAY / 2
        windowed = recipe != "van" or b in (1, 4)
        walls("window" if windowed else "plain", "window" if windowed else "plain", zs, BAY)
        put(ceil_piece, 0, 0, zs)
        put(floor_piece, 0, 0, zs)
        put("bay-pillar", 0, 0, zs)
        put("bay-pillar", 0, 0, zs, PI)
        if windowed and recipe != "van":
            put("curtain", -W, 1.9, zs - 0.4)
            put("curtain", W, 1.9, zs - 1.5, PI)
        if recipe == "van":
            if b % 2 == 0:
                put("luggage-rack", -W, 0, zs)
                put("luggage-rack", W, 0, zs - BAY, PI)
            put("trunk", -1.2, 0, mid)
            furn(f"trunk:{rid}:{b}", -1.45, -0.95, mid - 0.45, mid + 0.45, 0.5)
            if b in (2, 5):
                put("coffin", 1.15, 0, mid)
                furn(f"coffin:{rid}:{b}", 0.85, 1.45, mid - 1.0, mid + 1.0, 0.5)
        elif recipe == "dining":
            buffet = b >= bays - 2
            sides = (1,) if buffet else (-1, 1)
            for side in sides:
                x = side * 1.15
                put("dining-table", x, 0, mid)
                put("dining-chair", x, 0, mid + 0.65)
                put("dining-chair", x, 0, mid - 0.65, PI)
                furn(f"table:{rid}:{b}:{side}", min(x - 0.35, x + 0.35), max(x - 0.35, x + 0.35), mid - 0.9, mid + 0.9, 0.95)
        elif recipe == "party":
            if b < 3:
                put("favour-table", -1.15, 0, mid)
                furn(f"favours:{rid}:{b}", -1.5, -0.79, mid - 0.81, mid + 0.81, 0.76)
            if b % 2 == 0:
                put("lamp-hanging", 0, ceiling, zs)
    if recipe == "dining":
        put("buffet-counter", -W, 0, min_z + pad + 3.0)
        furn(f"buffet:{rid}", -W, -W + 0.62, min_z + pad, min_z + pad + 3.0, 1.03)
    if recipe == "party":
        put("jukebox", 1.1, 0, min_z + pad + 0.4)
        furn(f"jukebox:{rid}", 0.7, 1.5, min_z + pad + 0.15, min_z + pad + 0.65, 1.5)
    end = "end-wall-door-32" if ceiling > 3.0 else "end-wall-door"
    put(end, 0, 0, max_z)
    put(end, 0, 0, min_z, PI)
    return min_z


z = 0.0
prev = None
for rid, name, length, ceiling, recipe in CARRIAGES:
    if prev is not None:
        # The vestibule between the previous carriage (south) and this one: a 1.4 m tunnel.
        put("vestibule", 0, 0, z + VESTIBULE)
        gbox("tunnels", f"tunnel:{prev}:{rid}", (-0.7, 0, z), (0.7, 2.1, z + VESTIBULE), wire=True)
    min_z = carriage(rid, name, length, ceiling, recipe, z)
    prev = rid
    z = min_z - VESTIBULE

gempty("start", (0, 0, -1.0), 0.0)
bpy.ops.wm.save_as_mainfile(filepath=OUT, relative_remap=True)
print(f"saved {OUT}: {sum(COUNT.values())} kit pieces")
