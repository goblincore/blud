# scripts/levels/build_the_wake_blockout.py
"""Blockout of level 0, The Wake, as a .blend (layout draft 1, approved).

    blender --background --factory-startup \
        --python scripts/levels/build_the_wake_blockout.py -- assets-source/levels/the-wake.blend

Tables are GAME space (x, y, z), y up, player walks toward -z.
Blender gets (x, -z, y). Layout: docs/game/levels/00-the-wake/layout.md
After the first run the .blend is the source of truth; edit it in Blender.
"""
import math
import sys

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC["level_id"] = "the-wake"
SC["level_name"] = "The Wake"
SC["ammo"] = "finite"
SC["loadout"] = "melee"
SC["complete_on"] = "pickup.cd"
SC["skyline"] = "treeline"  # Outdoor v1

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


FACE_SOUTH = math.pi  # facing +z, toward the approaching player
FACE_NORTH = 0.0

# ---- ROOMS: (id, name, (minX, minZ), (maxX, maxZ), height, sky) -------------
# Game space, -z north. Tables match layout.md §1-§3.
ROOMS = [
    (1, "gates",     (-17.5, -10),  (-5.5, 0),     5.0, "night"),
    (2, "lane",      (-14, -26),    (-9, -10.6),   4.0, "night"),
    (3, "graveyard", (-16, -58),    (16, -26.6),   8.5, "night"),
    (4, "crypt",     (7, -76),      (13, -62),     2.8, None),
    (5, "ossuary",   (13.6, -74),   (21, -64),     2.6, None),
    (6, "vestibule", (6, -86),      (14, -80),     3.0, None),
    (7, "parlour",   (0, -110),     (20, -86.6),   6.0, None),
    (8, "secret",    (18, -44),     (22, -37),     2.5, None),
]
# Outdoor v1 (spec 2026-09-23-outdoor-v1-design.md §9): ground, and the visible
# edge of each open room (collision still reaches the full height).
OUTDOOR = {
    "gates": {"ground": "gravel", "edge_style": "wall", "edge_height": 2.4},
    "lane": {"ground": "gravel", "edge_style": "hedge", "edge_height": 2.6},
    "graveyard": {"ground": "grass", "edge_style": "wall", "edge_height": 2.2},
    "crypt": {"ground": "flagstone"},
    "ossuary": {"ground": "flagstone"},
}
for rid, name, (x0, z0), (x1, z1), h, sky in ROOMS:
    o = gbox("rooms", f"room:{rid}:{name}", (x0, 0, z0), (x1, h, z1), wire=True)
    if sky:
        o["sky"] = sky
    for k, v in OUTDOOR.get(name, {}).items():
        o[k] = v

# Path strips (graveyard, room 3): gravel from the lych gate past the open grave,
# east between the headstone rows, north to the slab portal; dirt round the grave.
# Strips never overlap (both are drawn just above the floor).
PATHS = [
    ("gravel", (-13, -28), (-10, -26.6)),
    ("dirt", (-13.6, -32.2), (-9.4, -28)),
    ("gravel", (-12.5, -34.2), (-10.5, -32.2)),
    ("gravel", (-12.5, -36.8), (10.55, -34.2)),
    ("gravel", (9.45, -58), (10.55, -36.8)),
]
for i, (ground, (x0, z0), (x1, z1)) in enumerate(PATHS):
    gbox("paths", f"path:{ground}:3", (x0, 0, z0), (x1, 0.05, z1), wire=True)

# ---- CORRIDORS: (a, b, (minX, minZ), (maxX, maxZ), height) ------------------
# 0.6 m "door" tunnels join rooms whose walls sit back to back.
TUNNELS = [
    (1, 2, (-13, -10.6), (-10, -10), 3.5),       # the iron gates
    (2, 3, (-13, -26.6), (-10, -26), 3.5),       # lych gate, graveyard's SW corner
    (3, 4, (8.8, -62), (11.2, -58), 2.6),        # crypt stairs (slab) in the manor's foundations, NE
    (4, 5, (13, -66.4), (13.6, -64.8), 2.2),     # ossuary door A
    (4, 5, (13, -73), (13.6, -71.4), 2.2),       # ossuary door B (the crypt loop)
    (4, 6, (9, -80), (11, -76), 2.4),            # stairs up into the manor
    (6, 7, (8.5, -86.6), (11.5, -86), 2.8),      # parlour doors
    (3, 8, (16, -41.4), (18, -40), 2.0),         # fence gap (1.4 m, goblin route)
]
for a, b, (x0, z0), (x1, z1), h in TUNNELS:
    gbox("tunnels", f"tunnel:{a}:{b}", (x0, 0, z0), (x1, h, z1), wire=True)

S = []
# gates: gatehouse, gate posts either side of the iron gates
S += [((-9, 0, -8), (-6, 3, -4)), ((-13.8, 0, -9.9), (-13, 3.2, -9.1)), ((-10, 0, -9.9), (-9.2, 3.2, -9.1))]
# lane: hedges are the walls; two low tombs as cover
S += [((-14, 0, -21), (-12.8, 0.9, -19.6)), ((-10.2, 0, -24.5), (-9, 0.9, -23.1))]
# graveyard: open grave lip right past the lych gate
S += [((-12.6, 0, -31.2), (-12.3, 0.35, -28.8)), ((-10.7, 0, -31.2), (-10.4, 0.35, -28.8)),
      ((-12, 0, -31.6), (-11, 1.0, -31.3))]
# the bell tower: base, four pillars, roof. The loop runs all the way round it.
S.append(((-3, 0, -45), (3, 5, -39)))
for px, pz in [(-3, -45), (2.7, -45), (-3, -39.3), (2.7, -39.3)]:
    S.append(((px, 5, pz), (px + 0.3, 7.6, pz + 0.3)))
S.append(((-3.2, 7.6, -45.2), (3.2, 8.0, -38.8)))
# the mausoleum (NW), a landmark and cover
S.append(((-14, 0, -56), (-9, 4, -51)))
# headstones in rows (0.7 x 0.2 x 0.9), aisles >= 1.4 m; the SW entry and the
# approach to the slab (NE) stay clear
def row(z, xs):
    for x in xs:
        S.append(((x - 0.35, 0, z - 0.1), (x + 0.35, 0.9, z + 0.1)))
row(-34, [-5, -3, 3, 5, 7, 9, 11, 13])
row(-37, [-14, -12, -9, -5, 9, 11, 13])
row(-43, [-14, -12, -9, 9, 12, 14])
row(-47, [-14, -12, -9, 9, 12, 14])
row(-50, [-6, -4, 4, 6, 13, 15])
row(-54, [-6, -4, 3, 5])
# fence-gap hint: two broken posts either side of the gap
S += [((15.6, 0, -42.0), (16, 1.4, -41.4)), ((15.6, 0, -40.0), (16, 1.4, -39.4))]
# crypt: sarcophagi on the west wall (the east wall has the ossuary doors);
# the ossuary pillar the loop turns on
S += [((7, 0, -68), (8, 0.8, -66)), ((7, 0, -73), (8, 0.8, -71))]
S += [((16.5, 0, -70.5), (18, 1.8, -67.5))]
# parlour: pews (two blocks per row, 1.6 m side aisles, 2.4 m centre aisle),
# the coffin on its stand, the organ
for z in (-94, -97, -100, -103):
    S += [((1.6, 0, z - 0.25), (8.8, 0.9, z + 0.25)), ((11.2, 0, z - 0.25), (18.4, 0.9, z + 0.25))]
S += [((9, 0, -107), (11, 0.9, -105)), ((16, 0, -110), (19.5, 3, -107.5))]
for i, (mn, mx) in enumerate(S):
    gbox("solids", f"solid.{i:03d}", mn, mx)

gbox("gates", "gate:bell.toll.1:crypt-slab", (8.8, 0, -59), (11.2, 2.6, -58.6))
gbox("triggers", "trigger:wave.0:grave-rise", (-13.5, 0, -31.6), (-9.5, 2, -28.2), wire=True)
gbox("triggers", "trigger:alert.room.7:parlour-turn", (0, 0, -91), (20, 3, -89), wire=True)
# The glimpse (design §1): behind the coffin, the train waiting.
gbox("windows", "window:train-waiting:parlour-window", (7.5, 1.0, -110.05), (12.5, 4.5, -109.95))

glight("lamp.gates", (-15.5, 2.5, -6), (0.9, 0.55, 0.25), 10)
glight("lantern.lane", (-11.5, 2.5, -18), (0.9, 0.55, 0.25), 7)
glight("fire.belltower", (0, 5.6, -42), (1.0, 0.4, 0.15), 12)
glight("moon.graveyard", (10, 4, -30), (0.35, 0.45, 0.9), 12)
glight("lamp.manor-door", (10, 3.2, -57), (1.0, 0.55, 0.25), 8)
glight("glow.crypt", (10, 1.2, -69), (0.3, 0.9, 0.35), 7)
glight("candles.ossuary", (19, 1.2, -73), (1.0, 0.5, 0.2), 6)
glight("lamp.vestibule", (7, 2.2, -83), (1.0, 0.6, 0.3), 6)
glight("candles.coffin", (10, 1.4, -108), (1.0, 0.5, 0.2), 10)
glight("candles.organ", (17.5, 3.3, -108.5), (1.0, 0.5, 0.2), 8)
glight("red.secret", (20, 1.0, -40.5), (0.9, 0.2, 0.1), 6)

gempty("start", (-11.5, 0, -1.5), FACE_NORTH)
Z = []
Z += [("lane-1", (-11.5, 0, -17), FACE_SOUTH), ("lane-2", (-13, 0, -24.5), FACE_SOUTH)]
Z += [("yard-1", (-3, 0, -30.5), FACE_SOUTH), ("yard-2", (11, 0, -38.5), FACE_SOUTH),
      ("yard-3", (-11, 0, -45), FACE_SOUTH), ("yard-4", (6, 0, -52), FACE_SOUTH),
      ("yard-5", (13, 0, -56), FACE_SOUTH)]
Z += [("crypt-1", (10, 0, -70), FACE_SOUTH)]
Z += [("ossuary-1", (15, 0, -66), FACE_SOUTH), ("ossuary-2", (19.5, 0, -66), FACE_SOUTH),
      ("ossuary-3", (15, 0, -72.5), FACE_SOUTH), ("ossuary-4", (19.5, 0, -72.5), FACE_SOUTH)]
for i, (x, z) in enumerate([(5.2, -95.5), (7.6, -95.5), (12.4, -95.5), (14.8, -95.5),
                            (4, -98.5), (7, -98.5), (13, -98.5), (16, -98.5)]):
    Z.append((f"mourner-{i + 1}", (x, 0, z), FACE_NORTH))
for sid, pos, yaw in Z:
    gempty(f"spawn:zombie:{sid}", pos, yaw)

# Waves come from every side of the tower, so the loop is the answer to them.
GRAVES = {
    0: [(-14.5, -33), (-8.5, -33)],
    1: [(-12, -40), (12, -41), (0, -49)],
    2: [(4, -30.5), (12, -30.5), (-13, -48.5), (13, -45)],
    3: [(-6, -41), (6, -41), (-7.5, -57), (5, -57), (0, -36)],
}
for wave, points in GRAVES.items():
    for i, (x, z) in enumerate(points):
        gempty(f"grave:{wave}:w{wave}-{i + 1}", (x, 0, z), FACE_SOUTH)

PICKUPS = [
    ("shotgun", "sawn-off", (-11.5, 0.3, -30)),
    ("shells", "shells-grave", (-9.9, 0.2, -28)),
    ("shells", "shells-yard-w", (-14.5, 0.2, -40)), ("shells", "shells-yard-e", (14.5, 0.2, -49)),
    ("shells", "shells-crypt", (10, 0.2, -64)),
    ("dynamite", "crypt-dynamite", (20.3, 0.2, -69)),
    ("shells", "shells-ossuary", (14.3, 0.2, -69)),
    ("health", "health-vestibule", (13, 0.2, -84)), ("shells", "shells-vestibule", (7, 0.2, -84.5)),
    ("health", "health-secret", (21, 0.2, -38)), ("shells", "shells-secret", (21, 0.2, -43)),
    ("cd", "the-wake-cd", (10, 1.0, -106)),
]
for item, pid, pos in PICKUPS:
    gempty(f"pickup:{item}:{pid}", pos)

gempty("bell:funeral-bell", (0, 6.3, -42), radius=0.8)

argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "assets-source/levels/the-wake.blend"
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(out))
print(f"saved {out}")
