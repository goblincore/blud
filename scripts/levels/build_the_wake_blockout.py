# scripts/levels/build_the_wake_blockout.py
"""First-draft blockout of level 0, The Wake, as a .blend.

    blender --background --factory-startup \
        --python scripts/levels/build_the_wake_blockout.py -- assets-source/levels/the-wake.blend

Tables are GAME space (x, y, z), y up, player walks toward -z.
Blender gets (x, -z, y). Design: docs/game/levels/00-the-wake/design.md
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

ROOMS = [
    (1, "gates", (-6, -12), (6, 0), 6.0),
    (2, "graveyard", (-14, -44), (14, -16), 8.0),
    (3, "crypt", (-8, -60), (8, -48), 2.8),
    (4, "parlour", (-9, -84), (9, -64), 4.5),
    (5, "secret", (15, -33), (19, -28), 2.5),
]
for rid, name, (x0, z0), (x1, z1), h in ROOMS:
    gbox("rooms", f"room:{rid}:{name}", (x0, 0, z0), (x1, h, z1), wire=True)

TUNNELS = [
    (1, 2, (-1, -16), (1, -12), 3.2),
    (2, 3, (-1.2, -48), (1.2, -44), 2.6),
    (3, 4, (-1, -64), (1, -60), 2.4),
    (2, 5, (14, -31.4), (15, -30.0), 2.0),
]
for a, b, (x0, z0), (x1, z1), h in TUNNELS:
    gbox("tunnels", f"tunnel:{a}:{b}", (x0, 0, z0), (x1, h, z1), wire=True)

S = []
S += [((-2.6, 0, -0.6), (-1.8, 3, -0.1)), ((1.8, 0, -0.6), (2.6, 3, -0.1)), ((3, 0, -9), (5.5, 3, -5))]
S += [((-1.1, 0, -20.4), (-0.8, 0.35, -18.0)), ((0.8, 0, -20.4), (1.1, 0.35, -18.0)),
      ((-0.5, 0, -20.8), (0.5, 1.0, -20.5))]
for cx, cz in [(-7, -20), (-4, -22.5), (5, -21), (9, -25), (-9, -27), (-2, -27), (3, -29),
               (-6, -32), (7, -32), (-11, -34), (2, -36), (10, -38), (-3, -40), (7, -43)]:
    S.append(((cx - 0.35, 0, cz - 0.1), (cx + 0.35, 0.9, cz + 0.1)))
S.append(((8, 0, -22), (12, 3.5, -18)))
S.append(((-12, 0, -43), (-8, 4, -39)))
for px, pz in [(-12, -43), (-8.3, -43), (-12, -39.3), (-8.3, -39.3)]:
    S.append(((px, 4, pz), (px + 0.3, 6.5, pz + 0.3)))
S.append(((-12.2, 6.5, -43.2), (-7.8, 6.9, -38.8)))
S += [((13.6, 0, -32.0), (14, 1.4, -31.4)), ((13.6, 0, -30.0), (14, 1.4, -29.4))]
S += [((-6, 0, -53), (-4, 0.8, -52)), ((4, 0, -55), (6, 0.8, -54)), ((-6, 0, -58), (-4, 0.8, -57))]
for z in (-69, -72, -75):
    S += [((-7.5, 0, z - 0.25), (-1.5, 0.9, z + 0.25)), ((1.5, 0, z - 0.25), (7.5, 0.9, z + 0.25))]
S += [((-1, 0, -81), (1, 0.9, -79)), ((5, 0, -84), (8.5, 2.5, -82))]
for i, (mn, mx) in enumerate(S):
    gbox("solids", f"solid.{i:03d}", mn, mx)

gbox("gates", "gate:bell.toll.1:crypt-slab", (-1.2, 0, -45), (1.2, 2.6, -44.4))
gbox("triggers", "trigger:wave.0:grave-rise", (-2, 0, -20.2), (2, 2, -17.6), wire=True)
gbox("triggers", "trigger:alert.room.4:parlour-turn", (-9, 0, -67.5), (9, 3, -65.5), wire=True)
# The glimpse (design §1): a tall window in the parlour's back (north) wall,
# looking out at the waiting train. v1 draws it as a placeholder plane.
gbox("windows", "window:train-waiting:parlour-window", (-2, 1.0, -84.05), (2, 3.8, -83.95))

glight("lamp.gates", (-4, 2.5, -6), (0.9, 0.55, 0.25), 10)
glight("moon.graveyard", (8, 2.5, -20), (0.35, 0.45, 0.9), 12)
glight("fire.belltower", (-10, 1.5, -37.5), (1.0, 0.4, 0.15), 10)
glight("glow.crypt", (0, 1.2, -54), (0.3, 0.9, 0.35), 7)
glight("candles.organ", (6, 1.3, -81), (1.0, 0.5, 0.2), 10)
glight("candles.door", (-6, 1.3, -66), (1.0, 0.5, 0.2), 8)
glight("red.secret", (17, 1.0, -30), (0.9, 0.2, 0.1), 6)

gempty("start", (0, 0, -1.5), 0.0)
for sid, pos in [("gates-1", (0, 0, -8)), ("gates-2", (-3, 0, -10.5))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("yard-1", (-10, 0, -22)), ("yard-2", (10, 0, -30)), ("yard-3", (-5, 0, -29)),
                 ("yard-4", (5, 0, -36.5)), ("yard-5", (-1, 0, -33))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("crypt-1", (-5, 0, -50.5)), ("crypt-2", (5, 0, -52)), ("crypt-3", (-3, 0, -56)),
                 ("crypt-4", (4, 0, -58))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("mourner-1", (-4, 0, -70.5)), ("mourner-2", (4, 0, -70.5)), ("mourner-3", (-5, 0, -73.5)),
                 ("mourner-4", (5, 0, -73.5)), ("mourner-5", (-3, 0, -76.5)), ("mourner-6", (3, 0, -76.5))]:
    gempty(f"spawn:zombie:{sid}", pos, 0.0)

GRAVES = {
    0: [(-2.5, -22), (2.5, -22.5)],
    1: [(-6, -24), (6, -24), (-8, -30)],
    2: [(-4, -34), (4, -34), (10, -28), (-10, -36.5)],
    3: [(0, -40), (-6, -41), (6, -41), (12, -36), (-12, -26)],
}
for wave, points in GRAVES.items():
    for i, (x, z) in enumerate(points):
        gempty(f"grave:{wave}:w{wave}-{i + 1}", (x, 0, z), FACE_SOUTH)

PICKUPS = [
    ("shotgun", "sawn-off", (0, 0.3, -19)),
    ("dynamite", "crypt-dynamite", (-6.5, 0.2, -49.5)),
    ("shells", "shells-yard-1", (-10, 0.2, -20)), ("shells", "shells-yard-2", (9, 0.2, -35)),
    ("shells", "shells-crypt", (0, 0.2, -53)), ("shells", "shells-parlour", (-8, 0.2, -66)),
    ("shells", "shells-secret", (18, 0.2, -29.5)),
    ("health", "health-crypt", (6, 0.2, -50)), ("health", "health-secret", (17, 0.2, -31)),
    ("health", "health-parlour", (-8, 0.2, -82)),
    ("cd", "the-wake-cd", (0, 1.0, -78.4)),
]
for item, pid, pos in PICKUPS:
    gempty(f"pickup:{item}:{pid}", pos)

gempty("bell:funeral-bell", (-10, 5.2, -41), radius=0.8)

argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "assets-source/levels/the-wake.blend"
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(out))
print(f"saved {out}")
