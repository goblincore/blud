# scripts/levels/build_night_train.py
"""Night Train's first slice, built from the approved layout.

    blender --background --factory-startup --python scripts/levels/build_night_train.py [-- --kit PATH --out PATH]

The layout tables (scripts/levels/night_train_layout.py, docs/game/levels/01-night-train/layout.md)
say where every carriage, partition, prop, spawn, pickup and gate goes; this script turns them
into assets-source/levels/night-train.blend: art-shelled rooms, 1.2 m vestibules, every piece a
collection instance linked from kit.blend, and a collision box (furniture or solid) for every prop
and partition. After the first run the .blend can be refined by hand, but the tables stay the
plan of record: change them and rebuild.

Game space (x, y, z), y up, the train runs toward -z; Blender gets (x, -z, y).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from night_train_layout import CARRIAGES, VESTIBULE, placed  # noqa: E402

ROOT = os.path.abspath("assets-source/levels")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


KIT = os.path.abspath(arg("--kit", os.path.join(ROOT, "kit.blend")))
OUT = os.path.abspath(arg("--out", os.path.join(ROOT, "night-train.blend")))
BAY = 1.9
PI = math.pi
WARM = (1.0, 0.72, 0.45)


def dm(v):
    return int(round(v * 10))


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


with bpy.data.libraries.load(KIT, link=True, relative=True) as (src, dst):
    dst.collections = list(src.collections)
PIECES = {c.name: c for c in dst.collections}
COUNT = {}


def put(piece, x, y, z, yaw=0.0, zscale=1.0):
    """A linked kit piece at game (x, y, z). Blender yaw: PI turns it round; -PI/2 turns a
    piece modelled along -z to run along +x. zscale stretches it along its own length."""
    COUNT[piece] = COUNT.get(piece, 0) + 1
    e = bpy.data.objects.new(f"{piece}:{COUNT[piece]}", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = PIECES[piece]
    e.location = (x, -z, y)
    e.rotation_euler = (0.0, 0.0, yaw)
    e.scale = (1.0, zscale, 1.0)
    coll("dressing").objects.link(e)
    return e


def walls(kind_w, kind_e, w2, zs, length):
    """Both side walls of one segment (from zs toward -z); the east piece is the west one turned."""
    k = length / BAY
    put(f"bay-wall-{kind_w}", -w2, 0, zs, 0.0, k)
    put(f"bay-wall-{kind_e}", w2, 0, zs - length, PI, k)


def partition(h, x0, x1, u0, u1, g):
    """A thin partition from the layout's walls table, plus its collision solid."""
    piece = f"partition-{dm(h)}"
    if (x1 - x0) >= (u1 - u0):   # runs across the carriage
        put(piece, x0, 0, g((u0 + u1) / 2), -PI / 2, x1 - x0)
    else:                        # runs along it
        put(piece, (x0 + x1) / 2, 0, g(u0), 0.0, u1 - u0)
    gbox("solids", f"partition:{COUNT[piece]}", (x0, 0, g(u1)), (x1, h, g(u0)))


def prop(label, x0, x1, u0, u1, h, g, rid, n):
    """A layout prop: its kit piece(s) and its furniture box."""
    xc, zc = (x0 + x1) / 2, g((u0 + u1) / 2)
    if label == "trunks":
        put("trunk", xc, 0, zc + 0.35)
        put("trunk", xc, 0, zc - 0.35)
        put("trunk", xc, 0.5, zc)
    elif label == "big trunk":
        put("trunk-big", xc, 0, zc)
    elif label == "table":
        put("dining-table", xc, 0, zc)
        put("dining-chair", xc, 0, zc + 0.65)
        put("dining-chair", xc, 0, zc - 0.65, PI)
    elif label != "backhead":  # the cab shell has its own backhead
        piece = {"coffin": "coffin", "desk": "desk", "stove": "stove", "buffet island": "buffet-island",
                 "stoves": "galley-stoves", "counter": "galley-counter", "bunk": "bunk", "favours": "favour-table",
                 "pillar": "pillar-round", "bar": "bar", "jukebox": "jukebox"}[label]
        put(piece, xc, 0, zc)
    gbox("furniture", f"{label}:{rid}:{n}", (x0, 0, g(u1)), (x1, h, g(u0)))


def carriage(c, zs):
    rid, name, w, L, h = c["rid"], c["name"], c["w"], c["L"], c["h"]
    w2 = w / 2
    g = lambda u: zs - u  # noqa: E731  (carriage frame u -> game z)
    room = gbox("rooms", f"room:{rid}:{name}", (-w2, 0, g(L)), (w2, h, zs), wire=True)
    room["shell"] = "art"
    lamps = max(1, round(L / 8))
    for i in range(lamps):
        glight(f"lamp:{rid}:{i}", (0, h - 0.4, g(L * (i + 0.5) / lamps)), WARM, 3)
    if name == "cab":
        put("cab-shell", 0, 0, zs)
        glight(f"firebox:{rid}", (0, 1.0, g(L - 1.0)), (1.0, 0.42, 0.12), 4)
    else:
        bays = int(L // BAY)
        pad = (L - bays * BAY) / 2
        ceil_piece, end_piece = f"bay-ceiling-{dm(w)}-{dm(h)}", f"end-wall-door-{dm(w)}-{dm(h)}"
        floor_piece = f"bay-floor-{'planks' if name == 'guards-van' else 'runner'}-{dm(w)}"
        for z0 in (zs, g(L - pad)):
            walls("plain", "plain", w2, z0, pad)
            put(ceil_piece, 0, 0, z0, 0.0, pad / BAY)
            put(floor_piece, 0, 0, z0, 0.0, pad / BAY)
        for b in range(bays):
            z0 = g(pad + b * BAY)
            windowed = name != "guards-van" or b in (1, 4)
            kind = "window" if windowed else "plain"
            walls(kind, kind, w2, z0, BAY)
            put(ceil_piece, 0, 0, z0)
            put(floor_piece, 0, 0, z0)
            put("bay-pillar", -w2, 0, z0)
            put("bay-pillar", w2, 0, z0, PI)
            if windowed and name in ("dining-car", "party-carriage", "sleeper"):
                put("curtain", -w2, 1.9, z0 - 0.4)
                put("curtain", w2, 1.9, z0 - 1.5, PI)
            if name == "guards-van" and b % 2 == 0:
                put("luggage-rack", -w2, 0, z0)
                put("luggage-rack", w2, 0, z0 - BAY, PI)
            if name == "party-carriage" and b % 2 == 0:
                put("lamp-hanging", 0, h, z0)
        put(end_piece, 0, 0, zs)
        put(end_piece, 0, 0, g(L), PI)
    for x0, x1, u0, u1 in c["walls"]:
        partition(h, x0, x1, u0, u1, g)
    for n, (label, x0, x1, u0, u1, ph) in enumerate(c["props"]):
        prop(label, x0, x1, u0, u1, ph, g, rid, n)
    for sid, kind, x, u in c["spawns"]:
        gempty(f"spawn:{kind}:{sid}", (x, 0, g(u)), PI)   # facing south, toward the player
    for pid, item, x, u in c["pickups"]:
        gempty(f"pickup:{item}:{pid}", (x, 0.3, g(u)))
    for gid, event, x0, x1, u0, u1 in c["gates"]:
        gbox("gates", f"gate:{event}:{gid}", (x0, 0, g(u1)), (x1, 2.2, g(u0)))


prev = None
for c, zs in placed():
    if prev is not None:
        # The vestibule between the previous carriage and this one: a 1.4 m tunnel.
        put("vestibule", 0, 0, zs + VESTIBULE)
        gbox("tunnels", f"tunnel:{prev}:{c['rid']}", (-0.7, 0, zs), (0.7, 2.1, zs + VESTIBULE), wire=True)
    carriage(c, zs)
    prev = c["rid"]

gempty("start", (0, 0, -1.0), 0.0)
bpy.ops.wm.save_as_mainfile(filepath=OUT, relative_remap=True)
print(f"saved {OUT}: {sum(COUNT.values())} kit pieces")
