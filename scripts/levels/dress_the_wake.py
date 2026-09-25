# scripts/levels/dress_the_wake.py
"""Placeholder dressing for The Wake (Plan 1 Task 5d; guide §7).

    blender --background assets-source/levels/the-wake.blend \
        --python scripts/levels/dress_the_wake.py -- public/assets/levels/the-wake.level.json

Rebuilds the `dressing` collection from scratch and saves the .blend. Rough,
low-poly props modelled from primitives, each inside the collision box it
dresses (a headstone inside its solid, a pew inside its box). The exporter
ignores this collection; the game draws boxes only (spec §12). Positions are
GAME space (x, y, z), y up, -z north; Blender gets (x, -z, y).

Prints every solid it left undressed, so layout edits that add boxes show up.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

LEVEL = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/assets/levels/the-wake.level.json"
L = json.load(open(LEVEL))

# ---- collection ------------------------------------------------------------
old = bpy.data.collections.get("dressing")
if old:
    for o in list(old.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)
DRESS = bpy.data.collections.new("dressing")
bpy.context.scene.collection.children.link(DRESS)
PLACED = []  # game-space centres, for the coverage report


def B(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


# ---- materials -------------------------------------------------------------
MATS = {}


def mat(name, rgb, rough=0.85, metal=0.0, emit=None, strength=4.0):
    key = f"dress.{name}"
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.get(key) or bpy.data.materials.new(key)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*rgb, 1)
    MATS[key] = m
    return m


STONE = mat("stone", (0.32, 0.31, 0.30))
STONE_DK = mat("stone-dark", (0.16, 0.16, 0.17))
MOSS = mat("moss-stone", (0.22, 0.26, 0.20))
MARBLE = mat("marble", (0.62, 0.61, 0.58), rough=0.4)
IRON = mat("iron", (0.05, 0.05, 0.05), rough=0.5, metal=0.8)
BRONZE = mat("bronze", (0.42, 0.26, 0.10), rough=0.35, metal=1.0)
WOOD = mat("wood", (0.20, 0.11, 0.06))
WOOD_DK = mat("wood-dark", (0.09, 0.05, 0.03))
VELVET = mat("velvet", (0.28, 0.03, 0.05))
SATIN = mat("satin", (0.75, 0.70, 0.62), rough=0.3)
HEDGE = mat("hedge", (0.05, 0.12, 0.05))
DIRT = mat("dirt", (0.14, 0.09, 0.05))
BONE = mat("bone", (0.72, 0.66, 0.52))
BRASS = mat("brass", (0.55, 0.42, 0.15), rough=0.3, metal=1.0)
LILY = mat("lily", (0.85, 0.85, 0.80))
ROSE = mat("rose", (0.45, 0.02, 0.05))
FLAME = mat("flame", (1.0, 0.6, 0.2), emit=(1.0, 0.55, 0.2), strength=12)
GLOW_G = mat("glow-green", (0.3, 0.9, 0.35), emit=(0.3, 0.9, 0.35), strength=6)
GLOW_R = mat("glow-red", (0.9, 0.2, 0.1), emit=(0.9, 0.2, 0.1), strength=6)


# ---- primitives (all take GAME coordinates) ---------------------------------
def _obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    DRESS.objects.link(o)
    return o


def box(name, gmin, gmax, material, track=True):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    size = Vector(gmax) - Vector(gmin)
    c = (Vector(gmin) + Vector(gmax)) / 2
    bmesh.ops.scale(bm, vec=(size.x, size.z, size.y), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(c), verts=bm.verts)
    if track:
        PLACED.append(tuple(c))
    return _obj(name, bm, material)


def cyl(name, base, r, h, material, segs=10, r2=None, track=False):
    """Vertical cylinder/cone standing on `base` (game), radius r at the bottom, r2 at the top."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=B(base) + Vector((0, 0, h / 2)), verts=bm.verts)
    if track:
        PLACED.append((base[0], base[1] + h / 2, base[2]))
    return _obj(name, bm, material)


def ball(name, c, r, material, segs=8, squash=(1, 1, 1)):
    """Sphere at game point c; squash scales it along game (x, y, z) in the mesh itself."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=r)
    bmesh.ops.scale(bm, vec=(squash[0], squash[2], squash[1]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(c), verts=bm.verts)
    return _obj(name, bm, material)


def hull(name, pts, material):
    """Convex hull of game-space points."""
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(B(p))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    return _obj(name, bm, material)


def gable(name, x0, x1, z0, z1, y0, y1, material, ridge_along="x"):
    """A pitched roof filling the box, ridge along x or z."""
    if ridge_along == "x":
        zm = (z0 + z1) / 2
        pts = [(x0, y0, z0), (x1, y0, z0), (x0, y0, z1), (x1, y0, z1), (x0, y1, zm), (x1, y1, zm)]
    else:
        xm = (x0 + x1) / 2
        pts = [(x0, y0, z0), (x0, y0, z1), (x1, y0, z0), (x1, y0, z1), (xm, y1, z0), (xm, y1, z1)]
    return hull(name, pts, material)


def lantern(name, pos, glow=FLAME):
    x, y, z = pos
    box(f"{name}.cage", (x - 0.12, y - 0.18, z - 0.12), (x + 0.12, y + 0.18, z + 0.12), IRON, track=False)
    ball(f"{name}.flame", pos, 0.09, glow)


def candle(name, pos, h=0.25):
    cyl(f"{name}.wax", pos, 0.03, h, LILY, segs=6)
    ball(f"{name}.flame", (pos[0], pos[1] + h + 0.03, pos[2]), 0.025, FLAME, segs=6)


# ---- solids, by where they are ---------------------------------------------
SOLIDS = [(tuple(s["min"]), tuple(s["max"])) for s in L.get("solids", [])]


ROOMS = {r["name"]: r for r in L["rooms"]}


def rect(name):
    """(minX, maxX, minZ, maxZ) of a room, from the level file."""
    r = ROOMS[name]
    return r["min"][0], r["max"][0], r["min"][1], r["max"][1]


def solids_in(name):
    x0, x1, z0, z1 = rect(name)
    return [s for s in SOLIDS if x0 <= (s[0][0] + s[1][0]) / 2 <= x1 and z0 <= (s[0][2] + s[1][2]) / 2 <= z1]


def size(s):
    return tuple(s[1][i] - s[0][i] for i in range(3))


# --- 1. gates ----------------------------------------------------------------
for i, s in enumerate(solids_in("gates")):
    (x0, y0, z0), (x1, y1, z1) = s
    if size(s)[0] > 2:  # the gatehouse
        box(f"gatehouse.walls", (x0, 0, z0), (x1, 2.2, z1), STONE)
        gable("gatehouse.roof", x0 - 0.1, x1 + 0.1, z0 - 0.1, z1 + 0.1, 2.2, y1, WOOD_DK, "z")
        box("gatehouse.door", (x0 - 0.02, 0, z0 + 1.4), (x0, 1.9, z0 + 2.4), WOOD_DK, track=False)
        box("gatehouse.window", (x0 - 0.02, 1.1, z0 + 2.8), (x0, 1.7, z0 + 3.4), FLAME, track=False)
    else:  # a gate pillar with a ball cap and an open iron gate leaf against the wall
        box(f"gatepost.{i}", (x0, 0, z0), (x1, y1 - 0.4, z1), STONE)
        ball(f"gatepost.{i}.cap", ((x0 + x1) / 2, y1 - 0.2, (z0 + z1) / 2), 0.2, STONE)
        gx0, gx1, _, _ = rect("gates")
        side = -1 if (x0 + x1) / 2 < (gx0 + gx1) / 2 else 1
        gx = x0 if side < 0 else x1
        for b in range(8):  # bars swung back along the wall, just inside the pillar line
            bz = z1 + 0.05 + b * 0.18
            cyl(f"gate.{i}.bar{b}", (gx - side * 0.05, 0, bz), 0.015, 2.6, IRON, segs=4)
        box(f"gate.{i}.rail", (gx - side * 0.07, 2.2, z1), (gx - side * 0.03, 2.28, z1 + 1.5), IRON, track=False)

# --- 2. the lane: hedges on the walls, two chest tombs -------------------------
lx0, lx1, lz0, lz1 = rect("lane")
zz = lz0
while zz < lz1:
    z2 = min(lz1, zz + 2)
    box(f"hedge.w.{zz:.1f}", (lx0 - 0.25, 0, zz), (lx0 + 0.05, 2.4, z2), HEDGE, track=False)
    box(f"hedge.e.{zz:.1f}", (lx1 - 0.05, 0, zz), (lx1 + 0.25, 2.4, z2), HEDGE, track=False)
    zz = z2
for i, s in enumerate(solids_in("lane")):
    (x0, y0, z0), (x1, y1, z1) = s
    box(f"tomb.{i}.chest", (x0 + 0.05, 0, z0 + 0.05), (x1 - 0.05, y1 - 0.12, z1 - 0.05), MOSS)
    box(f"tomb.{i}.lid", (x0, y1 - 0.12, z0), (x1, y1, z1), STONE, track=False)

# --- 3. graveyard -------------------------------------------------------------
shape = 0
for i, s in enumerate(solids_in("graveyard")):
    (x0, y0, z0), (x1, y1, z1) = s
    w, h, d = size(s)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if (w, d) == (6, 6) and y0 == 0:  # bell tower base
        box("tower.base", (x0, 0, z0), (x1, y1 - 0.4, z1), STONE_DK)
        box("tower.cornice", (x0 - 0.15, y1 - 0.4, z0 - 0.15), (x1 + 0.15, y1, z1 + 0.15), STONE, track=False)
        box("tower.door", (cx - 0.7, 0, z1), (cx + 0.7, 2.2, z1 + 0.03), WOOD_DK, track=False)
        box("tower.plinth", (x0 - 0.2, 0, z0 - 0.2), (x1 + 0.2, 0.3, z1 + 0.2), STONE, track=False)
    elif y0 >= 5 and h > 1:  # belfry pillars
        box(f"tower.pillar.{i}", (x0, y0, z0), (x1, y1, z1), STONE)
    elif y0 >= 7:  # roof slab: a pyramid spire on it
        box("tower.roofslab", (x0, y0, z0), (x1, y0 + 0.15, z1), STONE_DK)
        hull("tower.spire", [(x0, y0 + 0.15, z0), (x1, y0 + 0.15, z0), (x0, y0 + 0.15, z1), (x1, y0 + 0.15, z1), (cx, y0 + 0.8, cz)], STONE_DK)
    elif w >= 4:  # the mausoleum: body, columns on its south face, pediment
        box("mausoleum.body", (x0 + 0.4, 0, z0), (x1 - 0.4, y1 - 0.8, z1 - 0.6), MARBLE)
        for k in range(4):
            px = x0 + 0.5 + k * (w - 1.0) / 3
            cyl(f"mausoleum.col{k}", (px, 0, z1 - 0.25), 0.18, y1 - 0.8, MARBLE, segs=8)
        gable("mausoleum.roof", x0, x1, z0, z1, y1 - 0.8, y1, MARBLE, "x")
        box("mausoleum.door", (cx - 0.6, 0, z1 - 0.62), (cx + 0.6, 2.2, z1 - 0.58), IRON, track=False)
        box("mausoleum.steps", (x0 + 0.4, 0, z1 - 0.6), (x1 - 0.4, 0.15, z1), STONE, track=False)
    elif h <= 0.4:  # open-grave lip: a dirt mound
        hull(f"grave.mound.{i}", [(x0, 0, z0), (x1, 0, z0), (x0, 0, z1), (x1, 0, z1), (cx, y1, z0 + 0.3), (cx, y1, z1 - 0.3)], DIRT)
        PLACED.append((cx, y1 / 2, cz))
    elif abs(w - 0.4) < 0.05 or (x0 >= 15.5 and h < 2):  # broken fence posts at the gap
        box(f"fencepost.{i}", (x0 + 0.1, 0, z0 + 0.1), (x1 - 0.1, y1, z1 - 0.1), IRON)
        box(f"fencepost.{i}.snap", (x0 - 0.3, y1 - 0.1, z0 + 0.15), (x0 + 0.1, y1 - 0.02, z1 - 0.15), IRON, track=False)
    elif w >= 0.9 and h >= 0.9:  # the open grave's headstone
        box("grave.headstone", (x0, 0, z0), (x1, y1 - 0.2, z1), MOSS)
        ball("grave.headstone.top", (cx, y1 - 0.2, cz), 0.3, MOSS)
    else:  # a headstone: three shapes in turn
        kind = shape % 3
        shape += 1
        if kind == 0:  # round-top
            box(f"stone.{i}", (x0, 0, z0), (x1, y1 - 0.3, z1), STONE)
            ball(f"stone.{i}.top", (cx, y1 - 0.3, cz), 0.35, STONE, segs=10, squash=(1, 0.86, 0.28))
        elif kind == 1:  # cross
            box(f"stone.{i}", (cx - 0.08, 0, z0), (cx + 0.08, y1, z1), MOSS)
            box(f"stone.{i}.arm", (x0 + 0.05, y1 - 0.35, z0), (x1 - 0.05, y1 - 0.22, z1), MOSS, track=False)
        else:  # leaning slab: the top tips 8 cm north, inside the solid's depth
            xa, xb, top = x0 + 0.05, x1 - 0.05, y1 - 0.05
            hull(f"stone.{i}", [(xa, 0, z0 + 0.04), (xb, 0, z0 + 0.04), (xa, 0, z1), (xb, 0, z1),
                                (xa, top, z0), (xb, top, z0), (xa, top, z1 - 0.06), (xb, top, z1 - 0.06)], STONE_DK)
            PLACED.append((cx, top / 2, cz))
        box(f"stone.{i}.base", (x0 - 0.05, 0, z0 - 0.05), (x1 + 0.05, 0.12, z1 + 0.05), STONE_DK, track=False)
# the open grave's pit, between its two dirt lips, and the bell
lips = sorted((s for s in solids_in("graveyard") if size(s)[1] <= 0.4), key=lambda s: s[0][0])
if len(lips) == 2:
    box("grave.pit", (lips[0][1][0], 0.0, lips[0][0][2]), (lips[1][0][0], 0.02, lips[1][1][2]), mat("pit", (0.01, 0.008, 0.006)), track=False)
bell = [b for b in L.get("bells", [])][0]
bx, by, bz = bell["pos"]
r = bell.get("radius", 0.8)
cyl("bell.body", (bx, by - 0.55, bz), r, 0.9, BRONZE, segs=16, r2=r * 0.55)
ball("bell.crown", (bx, by + 0.35, bz), r * 0.5, BRONZE, segs=12)
cyl("bell.lip", (bx, by - 0.62, bz), r * 1.05, 0.08, BRONZE, segs=16)
box("bell.yoke", (bx - 1.4, by + 0.7, bz - 0.1), (bx + 1.4, by + 0.9, bz + 0.1), WOOD_DK, track=False)

# --- 4, 5. crypt and ossuary ----------------------------------------------------
for i, s in enumerate(solids_in("crypt") + solids_in("ossuary")):
    (x0, y0, z0), (x1, y1, z1) = s
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if s in solids_in("crypt"):  # sarcophagus against the hall wall
        box(f"sarcophagus.{i}", (x0 + 0.05, 0, z0 + 0.05), (x1 - 0.05, y1 - 0.12, z1 - 0.05), STONE_DK)
        box(f"sarcophagus.{i}.lid", (x0, y1 - 0.12, z0), (x1, y1, z1), STONE, track=False)
        box(f"sarcophagus.{i}.effigy", (cx - 0.15, y1, z0 + 0.3), (cx + 0.15, y1 + 0.1, z1 - 0.3), STONE, track=False)
    else:  # the ossuary pillar: shelves of skulls
        box("ossuary.pillar", (x0 + 0.1, 0, z0 + 0.1), (x1 - 0.1, y1, z1 - 0.1), STONE_DK)
        for shelf in range(3):
            sy = 0.35 + shelf * 0.5
            for k in range(5):
                for sx in (x0 + 0.05, x1 - 0.05):
                    ball(f"skull.{shelf}.{k}.{sx:.0f}", (sx, sy, z0 + 0.35 + k * 0.58), 0.09, BONE, segs=6)
ox0, ox1, oz0, oz1 = rect("ossuary")
for k, cz in enumerate([oz0 + 0.6, oz1 - 0.6]):
    candle(f"ossuary.candle{k}", (ox1 - 0.6, 0, cz), 0.4)

# --- 6. vestibule ---------------------------------------------------------------
vx0, vx1, vz0, vz1 = rect("vestibule")
box("vestibule.rug", (vx0 + 2, 0, vz0 + 1), (vx1 - 2, 0.01, vz1 - 1), VELVET, track=False)

# --- 7. parlour -------------------------------------------------------------------
for i, s in enumerate(solids_in("parlour")):
    (x0, y0, z0), (x1, y1, z1) = s
    w, h, d = size(s)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if d <= 0.6:  # a pew: seat, back on its north side, end panels
        box(f"pew.{i}.seat", (x0, 0.4, z0), (x1, 0.48, z1), WOOD)
        box(f"pew.{i}.cushion", (x0 + 0.05, 0.48, z0 + 0.03), (x1 - 0.05, 0.52, z1 - 0.1), VELVET, track=False)
        box(f"pew.{i}.back", (x0, 0.48, z0), (x1, y1, z0 + 0.08), WOOD, track=False)
        for ex in (x0, x1 - 0.06):
            box(f"pew.{i}.end{ex:.1f}", (ex, 0, z0), (ex + 0.06, y1, z1), WOOD_DK, track=False)
    elif w <= 2.1:  # the coffin on its stand, lid open, flowers either side
        box("coffin.stand", (x0, 0, z0), (x1, 0.6, z1), WOOD_DK)
        box("coffin.drape", (x0 - 0.02, 0.35, z0 - 0.02), (x1 + 0.02, 0.6, z1 + 0.02), VELVET, track=False)
        hull("coffin.box", [(cx - 0.35, 0.6, z1 - 0.1), (cx + 0.35, 0.6, z1 - 0.1), (cx - 0.3, 0.6, z0 + 0.1), (cx + 0.3, 0.6, z0 + 0.1),
                            (cx - 0.42, 0.6, cz + 0.4), (cx + 0.42, 0.6, cz + 0.4),
                            (cx - 0.35, 0.9, z1 - 0.1), (cx + 0.35, 0.9, z1 - 0.1), (cx - 0.3, 0.9, z0 + 0.1), (cx + 0.3, 0.9, z0 + 0.1),
                            (cx - 0.42, 0.9, cz + 0.4), (cx + 0.42, 0.9, cz + 0.4)], WOOD)
        box("coffin.satin", (cx - 0.3, 0.88, z0 + 0.2), (cx + 0.3, 0.91, z1 - 0.2), SATIN, track=False)
        lid = box("coffin.lid", (cx - 0.02, 0.9, z0 + 0.1), (cx + 0.02, 1.6, z1 - 0.1), WOOD, track=False)
        for side in (-1, 1):
            fx = cx + side * 1.4
            cyl(f"flowers.{side}.stand", (fx, 0, cz), 0.08, 0.8, BRASS, segs=6)
            for k in range(7):
                a = k * 2.4
                ball(f"flowers.{side}.{k}", (fx + 0.18 * math.cos(a), 0.9 + 0.08 * (k % 3), cz + 0.18 * math.sin(a)), 0.07, LILY if k % 2 else ROSE, segs=6)
        for k in range(5):
            candle(f"coffin.candle{k}", (cx - 0.8 + k * 0.4, 0.0, z0 - 0.4), 1.1)
    else:  # the organ: case, keyboard, pipes
        box("organ.case", (x0, 0, z0 + 0.8), (x1, 1.4, z1), WOOD_DK)
        box("organ.keys", (x0 + 0.3, 0.8, z0 + 0.4), (x1 - 0.3, 0.9, z0 + 0.8), LILY, track=False)
        box("organ.bench", (x0 + 0.6, 0, z0), (x1 - 0.6, 0.45, z0 + 0.3), WOOD, track=False)
        n = 11
        for k in range(n):
            px = x0 + 0.2 + k * (w - 0.4) / (n - 1)
            ph = 1.4 + (1.6 * (1 - abs(k - n // 2) / (n // 2)))
            cyl(f"organ.pipe{k}", (px, 1.4, (z0 + z1) / 2 + 0.3), 0.09, min(ph, y1 - 1.4), BRASS, segs=8)
        candle("organ.candle", (x1 - 0.3, 1.4, z0 + 1.0), 0.3)
# the window frame and mullions, on the north wall
for w in L.get("windows", []):
    (x0, y0, z0), (x1, y1, z1) = w["min"], w["max"]
    for (a, b) in [((x0 - 0.15, y0 - 0.15), (x1 + 0.15, y0)), ((x0 - 0.15, y1), (x1 + 0.15, y1 + 0.15)),
                   ((x0 - 0.15, y0), (x0, y1)), ((x1, y0), (x1 + 0.15, y1)), (((x0 + x1) / 2 - 0.05, y0), ((x0 + x1) / 2 + 0.05, y1))]:
        box(f"window.frame.{a[0]:.2f}.{a[1]:.2f}", (a[0], a[1], z1), (b[0], b[1], z1 + 0.08), WOOD_DK, track=False)
    box("window.sill", (x0 - 0.2, y0 - 0.2, z1), (x1 + 0.2, y0 - 0.1, z1 + 0.25), WOOD_DK, track=False)

# --- 8. secret ---------------------------------------------------------------
sx0, sx1, sz0, sz1 = rect("secret")
box("secret.crate", (sx1 - 1.0, 0, (sz0 + sz1) / 2 - 0.4), (sx1 - 0.2, 0.6, (sz0 + sz1) / 2 + 0.4), WOOD, track=False)

# --- lanterns and lamps: one per level light, from the .blend's lights ---------
# (candle lights are drawn as candles above; the moon is not a lantern)
lights = bpy.data.collections.get("lights")
for o in (lights.objects if lights else []):
    kind = o.name.split(".")[0]
    if kind in ("lamp", "lantern", "glow", "fire", "red"):
        g = (o.location.x, o.location.z, -o.location.y)
        lantern(f"lantern.{o.name}", g, GLOW_G if kind == "glow" else GLOW_R if kind == "red" else FLAME)

# --- the manor: the funeral home, a gothic house rising behind the graveyard's
# north wall. The crypt is in its foundations (the slab portal), the vestibule
# and parlour inside it. Its mass stays ABOVE every interior ceiling and
# outside every playable room, so it never shows from inside.
gx0, gx1, gz0, gz1 = rect("graveyard")
inside = [rect(n) for n in ("crypt", "ossuary", "vestibule", "parlour")]
mx0 = min(r[0] for r in inside) - 1.0
mx1 = max(r[1] for r in inside) + 1.0
mz_front = gz0 - 0.35                       # just behind the graveyard's north wall
mz_back = min(r[2] for r in inside) - 1.0
top_in = 6.4                                # above the tallest interior (parlour, 6 m)
STONE_M = mat("manor-stone", (0.20, 0.19, 0.21))
SLATE = mat("slate", (0.07, 0.07, 0.09), rough=0.6)
LIT = mat("party-window", (1.0, 0.7, 0.35), emit=(1.0, 0.62, 0.3), strength=8)
DARKWIN = mat("dark-window", (0.02, 0.02, 0.03), rough=0.3)
# the front, open over the crypt stairs so the portal looks through to them
_t = [t for t in L["tunnels"] if t["a"] == ROOMS["graveyard"]["id"] and t["b"] == ROOMS["crypt"]["id"]]
fa, fb = (_t[0]["min"][0] - 0.3, _t[0]["max"][0] + 0.3) if _t else (mx0, mx0)
box("manor.front.w", (mx0, 0, mz_front - 0.6), (fa, 15, mz_front), STONE_M)
box("manor.front.e", (fb, 0, mz_front - 0.6), (mx1, 15, mz_front), STONE_M, track=False)
box("manor.front.over", (fa, 3.0, mz_front - 0.6), (fb, 15, mz_front), STONE_M, track=False)
box("manor.body", (mx0, top_in, mz_back), (mx1, 15, mz_front - 0.6), STONE_M, track=False)
gable("manor.roof", mx0 - 0.4, mx1 + 0.4, mz_back - 0.4, mz_front + 0.4, 15, 22, SLATE, "x")
# a steep central gable over the portal
cx_portal = 10.0
tun = [t for t in L["tunnels"] if t["a"] == ROOMS["graveyard"]["id"] and t["b"] == ROOMS["crypt"]["id"]]
if tun:
    cx_portal = (tun[0]["min"][0] + tun[0]["max"][0]) / 2
hull("manor.gable", [(cx_portal - 4, 15, mz_front), (cx_portal + 4, 15, mz_front), (cx_portal, 24, mz_front),
                     (cx_portal - 4, 15, mz_front - 3), (cx_portal + 4, 15, mz_front - 3), (cx_portal, 24, mz_front - 3)], SLATE)
# towers at the corners with needle spires
for k, tx in enumerate((mx0 + 1.6, mx1 - 1.6)):
    cyl(f"manor.tower{k}", (tx, 0, mz_front - 2.2), 1.8, 19, STONE_M, segs=12)
    cyl(f"manor.tower{k}.spire", (tx, 19, mz_front - 2.2), 2.1, 7.5, SLATE, segs=12, r2=0.05)
    for w in range(3):
        box(f"manor.tower{k}.slit{w}", (tx - 0.2, 9 + w * 3, mz_front + 0.0), (tx + 0.2, 10.4 + w * 3, mz_front + 0.05), LIT if w == 2 else DARKWIN, track=False)
# gothic windows along the upper floor, lit where the party is; a rose window in the gable
n = 7
for w in range(n):
    wx = mx0 + 3 + w * (mx1 - mx0 - 6) / (n - 1)
    if abs(wx - cx_portal) < 1.5:
        continue
    m = LIT if w % 3 != 1 else DARKWIN
    box(f"manor.win{w}", (wx - 0.45, 10, mz_front), (wx + 0.45, 12.6, mz_front + 0.05), m, track=False)
    hull(f"manor.win{w}.arch", [(wx - 0.45, 12.6, mz_front), (wx + 0.45, 12.6, mz_front), (wx, 13.4, mz_front),
                                (wx - 0.45, 12.6, mz_front + 0.05), (wx + 0.45, 12.6, mz_front + 0.05), (wx, 13.4, mz_front + 0.05)], m)
ball("manor.rose", (cx_portal, 18.5, mz_front + 0.1), 1.3, LIT, segs=16, squash=(1, 1, 0.08))
# the crypt portal: a pointed arch around the slab, on the graveyard side of the wall
if tun:
    t0, t1 = tun[0]["min"][0], tun[0]["max"][0]
    for k, (a, b) in enumerate(((t0 - 0.6, t0), (t1, t1 + 0.6))):
        box(f"portal.jamb{k}", (a, 0, gz0), (b, 3.0, gz0 + 0.2), STONE)
    hull("portal.arch", [(t0 - 0.6, 3.0, gz0), (t1 + 0.6, 3.0, gz0), (cx_portal, 4.6, gz0),
                         (t0 - 0.6, 3.0, gz0 + 0.2), (t1 + 0.6, 3.0, gz0 + 0.2), (cx_portal, 4.6, gz0 + 0.2)], STONE)
    ball("portal.skull", (cx_portal, 3.6, gz0 + 0.22), 0.22, BONE, segs=8)

# ---- coverage report ---------------------------------------------------------
missing = []
for s in SOLIDS:
    if not any(all(s[0][i] - 0.01 <= p[i] <= s[1][i] + 0.01 for i in range(3)) for p in PLACED):
        missing.append(s)
print(f"dressing: {len(DRESS.objects)} objects; {len(SOLIDS) - len(missing)}/{len(SOLIDS)} solids dressed")
for s in missing:
    print("  undressed solid", s)

bpy.ops.wm.save_mainfile()
print("saved", bpy.data.filepath)
