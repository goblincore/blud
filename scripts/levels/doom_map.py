#!/usr/bin/env python3
"""Convert a Doom map from a WAD into a Blud sector level.

    python3 scripts/levels/doom_map.py <wad> E1M1 [--units-per-m 35] [--out public/assets/levels] [--svg .lab-tmp/doom]

Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §5. Reads the vanilla map
lumps (VERTEXES, LINEDEFS, SIDEDEFS, SECTORS, THINGS; no BSP). Writes <out>/doom-<map>.level.json.
The output is derived from id Software's data: a dev placeholder, never committed (.gitignore).

Plan 1 writes geometry, zones, fill lights and the player start. Door sectors (manual or remotely
tagged) are written OPEN (the ceiling at Doom's open height) and remote floor-lowers LOWERED. A door
sector shaped like a doorway (two parallel two-sided faces of one length, squared ends) also becomes a
DOOR ENTITY in `doors` (sector-def.ts SectorDoorDef: its faces, centre line a -> b, width, depth,
height, the zones it joins, speed, wait, key): the game closes it with sliding leaves that open on
approach. Any other door sector stays an open hole and is listed in the summary. Plan 3a writes
monsters (spawns), pickups and an exit trigger in front of each exit switch. Plan 3b writes Doom's
exploding barrels as our toxic drums (`barrels`, on every skill: they are scenery; multiplayer-only
ones are still left out). Other things (decorations, keys, ...) are skipped and counted.

Hand-written edits (ours, committed): scripts/levels/overrides/<map>.json is applied when it exists
(`--overrides PATH` picks another, `--no-overrides` skips it); format in doom_overrides.py. Sector
patches land before lights and things are placed; override spawns are added after Doom's.

World scale (`--units-per-m`, default UNITS_PER_M): every Doom length becomes metres by it (vertices,
heights, things, the exit box's span, lights). What stays in metres whatever the scale is what is
sized for a BODY (the player and the characters are not scaled): the exit box's depth and height, a
light's height over the floor or under the ceiling (CEIL_DROP_M, EMITTER_LIGHT_MAX_Y_M, the pool
light's 0.6 m). What follows the WORLD is every decision about the map's structure: the zone split /
merge areas, the area that earns a fill, pool or emitter light, how far an emitter light stands out
from its wall and the emitter lights' spacing are written in metres at REFERENCE_UNITS_PER_M (the old
32) and read against the map at that scale, so a rescale gives the same zones and the same lights at
the same Doom spots. Light powers stay per real m^2 (a smaller room has
nearer walls: less power for the same look). The overrides file carries its own `unitsPerM`.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import doom_overrides  # noqa: E402
from doom_tables import (  # noqa: E402
    BLAZE_DOOR_SPECIALS, DOOR_KEY_SPECIALS, DOOR_SPECIALS, EMITTER_FAMILIES, EXIT_SPECIALS, FLOOR_LOWER_SPECIALS, GLOW_MATERIALS, MULTIPLAYER_ONLY, REMOTE_DOOR_SPECIALS,
    SKILL_BITS, THING_BARRELS, THING_PICKUPS, THING_SPAWNS, ZOMBIEMAN, ZOMBIEMAN_VARIANTS,
    material_for_flat, material_for_texture, sector_special,
)

MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SECTORS")
STANDARD_MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS", "REJECT", "BLOCKMAP")
PLAYER1_START = 1
# 35 Doom units per metre (owner 2026-10-27: at 32 the characters read a little small in E1M1's
# rooms; the world shrinks, the bodies do not). The ceiling on it is E1M1's lowest needed opening: its
# doors open to 68 units (72 - DOOR_OPEN_GAP_UNITS), which must stay over SECTOR_HEADROOM_M 1.9
# (sector-def.ts): 1.94 m at 35, 1.89 m at 36 (shut). Doom's 56-unit player is 1.6 m at 35, our eye.
# Steps get easier (the 24-unit stairs 0.69 m against SECTOR_STEP_M 0.75) but none newly climbable:
# the next step up, 28 units (the start room's goo pit to its window sills), is 0.8 m.
UNITS_PER_M = 35.0
REFERENCE_UNITS_PER_M = 32.0      # the scale the *_M2 / spacing constants below were tuned at
DOOR_OPEN_GAP_UNITS = 4          # Doom: a door opens to 4 units below the lowest neighbouring ceiling
DOOR_SPEED_M_S = 3.0             # leaf travel (game time, not world scale: the leaves are body-sized timing)
DOOR_BLAZE_SPEED_M_S = 6.0       # Doom's fast doors
DOOR_WAIT_S = 4.0                # Doom waits 150 tics (4.3 s)
DOOR_SHAPE_TOL_M = 0.01          # how far a door sector may be off a rectangle and still be a doorway
# The *_M2 areas and the EMITTER_LIGHT_*_M spacings are map structure: metres at REFERENCE_UNITS_PER_M.
ZONE_SPLIT_M2 = 600.0            # a zone whose floor area is over this splits (spec §6.5)
ZONE_MIN_M2 = 50.0               # a smaller zone merges into a neighbour
LIGHT_MIN_ZONE_M2 = 150.0        # a zone gets a fill light from this area up
MAX_LIGHTS = 10
MAX_POOL_LIGHTS = 8             # pool lights do not count toward MAX_LIGHTS
POOL_MIN_M2 = 4.0
POOL_COLOURS = {"nukage": [0.35, 1.0, 0.3], "lava": [1.0, 0.45, 0.12], "acid": [0.75, 1.0, 0.25]}
# Emitter lights (hand-off item 2g, part B1): the strongest self-lit surfaces get a real coloured light
# in the zone of the sector they face into, so bodies are lit by them. Cheap tier (mood "glow",
# level-tier.ts isLevelCheap): the list node shades it for the level, ~free next to a full-tier light.
# Per family: colour, power = min(cap, base + per_m2 * area), the smallest area that earns one, how far
# out from the wall it stands (a ceiling's hangs CEIL_DROP_M under it), and a ranking weight.
# The colours follow emitter-layout.ts: screens 60 % green / 40 % amber, lit as a teal-green (the amber
# share would make it yellow-green; teal reads as screens on a body),
# the viewscreen's dark glass a dim blue, troffers FLUORO_RGB, signs SIGN_RGB.
EMITTER_LIGHTS = {
    "screen-bank": {"color": [0.35, 1.0, 0.5], "base": 3.0, "per_m2": 0.06, "cap": 10.0, "min_m2": 6.0, "out_m": 1.0, "weight": 1.0},
    "viewscreen": {"color": [0.35, 0.55, 1.0], "base": 1.0, "per_m2": 0.03, "cap": 4.0, "min_m2": 16.0, "out_m": 1.2, "weight": 0.5},
    "fluorescent": {"color": [0.8, 0.9, 1.0], "base": 2.5, "per_m2": 0.15, "cap": 8.0, "min_m2": 6.0, "out_m": 0.8, "weight": 1.0},
    "exit-sign": {"color": [1.0, 0.12, 0.06], "base": 1.5, "per_m2": 0.0, "cap": 1.5, "min_m2": 0.5, "out_m": 0.5, "weight": 30.0},
}
MAX_EMITTER_LIGHTS = 12          # not counted toward MAX_LIGHTS (the shared list holds 32, light-list.ts LIST_CAP)
MAX_EMITTER_LIGHTS_PER_ZONE = 4  # a zone's cheap list loops over at most 8 (level-tier.ts LEVEL_PICKS), pools included
EMITTER_LIGHT_SPACING_M = 6.0    # two lights of one family stand at least this far apart
EMITTER_LIGHT_MIN_GAP_M = 2.5    # and any two emitter lights this far (the alcove's screens and strips: one light)
CEIL_DROP_M = 0.35
EMITTER_LIGHT_MAX_Y_M = 2.4
# Emitter PUSH (owner 2026-10-29, after the B1 sheet: "push the screens and exit signs harder"). Two of the
# runtime's ?emitpush= steps are placement, so the converter writes the lights for every on/off combination of
# them and tags a light that is not in all four with `push`: the combos it is in (PUSH_COMBOS names). The game
# keeps a tagged light only when its combo is listed (level-json.ts, emit-push.ts), so ?emitpush=none boots
# exactly the B1 lights. The third step (key) is runtime only.
#  - spill: screen banks get one light per (sector, facing) wall group, not one per sector at the area-weighted
#    middle of a whole room's walls (E1M1's computer room: one light 6 m from every bank), for each group of at
#    least SPILL_GROUP_MIN_M2 (a sector with none keeps its one light), at a higher power (SPILL_SCREEN_LIGHT);
#    spacing is judged within a zone only (lights never cross zones, so two lights either side of a zone line
#    do not double up). The per-zone cap stays MAX_EMITTER_LIGHTS_PER_ZONE; the total cap is
#    MAX_EMITTER_LIGHTS_PUSH with either step on.
#  - exit: each exit sign's light hangs low in front of it (a wall sign: EXIT_OUT_M out; a hanging box: its
#    sector's fill point), EXIT_DROP_M below its bottom edge and at least EXIT_MIN_Y_M over the floor, at
#    EXIT_POWER; signs skip the min gap (a sign next to a troffer keeps both) and any fluorescent light within
#    EXIT_DIM_M of a sign in its zone runs at EXIT_FLUORO_DIM.
PUSH_COMBOS = ("none", "spill", "exit", "spill+exit")
SPILL_SCREEN_LIGHT = {"base": 8.0, "per_m2": 0.2, "cap": 30.0}
SPILL_GROUP_MIN_M2 = 20.0        # a facing group this big (reference scale) earns its own light
MAX_EMITTER_LIGHTS_PUSH = 15     # spill + exit on E1M1: 15 (the shared list holds 32, light-list.ts LIST_CAP: 13 fill / pool + 15)
EXIT_POWER = 50.0
EXIT_OUT_M = 0.6
EXIT_DROP_M = 0.5
EXIT_MIN_Y_M = 1.2
EXIT_DIM_M = 6.0
EXIT_FLUORO_DIM = 0.7
EXIT_DEPTH_M = 0.8               # the exit trigger reaches this far in front of the switch line
EXIT_HEIGHT_M = 2.0


def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def _name8(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("ascii", "replace").upper()


def read_wad(data: bytes) -> list[tuple[str, bytes]]:
    magic, count, table = struct.unpack_from("<4sii", data, 0)
    if magic not in (b"IWAD", b"PWAD"):
        raise ValueError("not a WAD")
    out = []
    for i in range(count):
        pos, size, raw = struct.unpack_from("<ii8s", data, table + 16 * i)
        out.append((_name8(raw), data[pos:pos + size]))
    return out


def map_lumps(entries: list[tuple[str, bytes]], name: str) -> dict[str, bytes]:
    for i, (n, _) in enumerate(entries):
        if n == name.upper():
            found = {}
            for n2, d in entries[i + 1:]:
                if n2 not in STANDARD_MAP_LUMPS:
                    break
                found[n2] = d
            missing = [k for k in MAP_LUMPS if k not in found]
            if missing:
                raise ValueError(f"{name}: missing lumps {missing}")
            return found
    raise ValueError(f"map {name} not in the WAD")


def parse_map(l: dict[str, bytes]):
    verts = [struct.unpack_from("<hh", l["VERTEXES"], i) for i in range(0, len(l["VERTEXES"]), 4)]
    sectors = []
    for i in range(0, len(l["SECTORS"]), 26):
        fh, ch, ft, ct, light, special, tag = struct.unpack_from("<hh8s8shhh", l["SECTORS"], i)
        sectors.append(dict(floor=fh, ceil=ch, floor_tex=_name8(ft), ceil_tex=_name8(ct), light=light, special=special, tag=tag))
    sides = []
    for i in range(0, len(l["SIDEDEFS"]), 30):
        _, _, up, lo, mid, sec = struct.unpack_from("<hh8s8s8sH", l["SIDEDEFS"], i)
        if sec >= len(sectors):
            raise ValueError(f"sidedef {i // 30} names sector {sec}, the map has {len(sectors)}")
        sides.append(dict(upper=_name8(up), lower=_name8(lo), middle=_name8(mid), sector=sec))
    lines = []
    for i in range(0, len(l["LINEDEFS"]), 14):
        v1, v2, flags, special, tag, right, left = struct.unpack_from("<HHhhhHH", l["LINEDEFS"], i)
        if right >= len(sides):
            raise ValueError(f"linedef {i // 14} has a bad right sidedef ({right} of {len(sides)})")
        if left != 0xFFFF and left >= len(sides):
            raise ValueError(f"linedef {i // 14} has a bad left sidedef ({left} of {len(sides)})")
        if v1 >= len(verts) or v2 >= len(verts):
            raise ValueError(f"linedef {i // 14} names a vertex past the {len(verts)} in the map")
        lines.append(dict(v1=v1, v2=v2, special=special, tag=tag, right=right, left=None if left == 0xFFFF else left))
    things = []
    for i in range(0, len(l["THINGS"]), 10):
        x, y, angle, kind, flags = struct.unpack_from("<hhhhh", l["THINGS"], i)
        things.append(dict(x=x, y=y, angle=angle, type=kind, flags=flags))
    return verts, sectors, sides, lines, things


# Python copies of the sector rules in src/lab/sdf-zombie/webgpu/sector-edges.ts (pointInEdges,
# sectorEdges); keep the two in step.
def _inside(px: float, pz: float, segs) -> bool:
    """Even-odd test against a list of ((ax, az), (bx, bz)) segments."""
    odd = False
    for (ax, az), (bx, bz) in segs:
        if (az > pz) != (bz > pz) and px < ax + (pz - az) * (bx - ax) / (bz - az):
            odd = not odd
    return odd


def _sector_at(x: float, y: float, verts, lines, sides, sector: int) -> bool:
    segs = []
    for ln in lines:
        f = sides[ln["right"]]["sector"]
        b = sides[ln["left"]]["sector"] if ln["left"] is not None else None
        if f != b and sector in (f, b):
            segs.append((verts[ln["v1"]], verts[ln["v2"]]))
    return _inside(x, y, segs)


def _seg_dist(px: float, pz: float, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = 0.0 if dx == dz == 0 else max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


class _Union:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def join(self, a: int, b: int) -> None:
        self.p[self.find(a)] = self.find(b)


def _components(members: set[int], adj: dict[int, set[int]]) -> list[list[int]]:
    seen: set[int] = set()
    out = []
    for s in sorted(members):
        if s in seen:
            continue
        comp, stack = [], [s]
        seen.add(s)
        while stack:
            n = stack.pop()
            comp.append(n)
            for o in sorted(adj[n] & members):
                if o not in seen:
                    seen.add(o)
                    stack.append(o)
        out.append(sorted(comp))
    return out


def _zones(n_sectors: int, pairs: list[tuple[int, int]], doors: set[int], area: list[float], bbox) -> list[int]:
    """Spec §6.5: sectors joined by lines that touch no door; a door joins its first neighbour.
    A zone whose real area is over ZONE_SPLIT_M2 splits along its longer axis, keeping each part
    connected; a zone under ZONE_MIN_M2 merges into the neighbour it shares most lines with."""
    adj: dict[int, set[int]] = {s: set() for s in range(n_sectors)}
    for a, b in pairs:
        if a != b:
            adj[a].add(b)
            adj[b].add(a)
    u = _Union(n_sectors)
    for a, b in pairs:
        if a not in doors and b not in doors:
            u.join(a, b)
    for d in sorted(doors):
        if adj[d]:
            u.join(d, min(adj[d]))
    groups: dict[int, list[int]] = {}
    for s in range(n_sectors):
        groups.setdefault(u.find(s), []).append(s)

    def total(g) -> float:
        return sum(area[s] for s in g)

    def split(group: list[int]) -> list[list[int]]:
        if len(group) < 2 or total(group) <= ZONE_SPLIT_M2:
            return [group]
        members = set(group)
        x0 = min(bbox[s][0] for s in group); x1 = max(bbox[s][2] for s in group)
        z0 = min(bbox[s][1] for s in group); z1 = max(bbox[s][3] for s in group)
        axis = 0 if x1 - x0 >= z1 - z0 else 1
        key = lambda s: (bbox[s][axis] + bbox[s][axis + 2]) / 2  # noqa: E731
        # Flood from the low end, always taking the frontier sector furthest along the low side:
        # every taken sector touches an earlier one, so the first half stays connected.
        start = min(group, key=lambda s: (key(s), s))
        taken, frontier, acc = [], {start}, 0.0
        while frontier and len(taken) < len(group) - 1 and acc < total(group) / 2:
            n = min(frontier, key=lambda s: (key(s), s))
            frontier.discard(n)
            taken.append(n)
            acc += area[n]
            frontier |= {o for o in adj[n] & members if o not in taken}
        rest = members - set(taken)
        parts = [taken] + _components(rest, adj)
        if len(parts) == 1:
            return parts
        return [q for part in parts for q in split(part)]

    zones: list[list[int]] = []
    for root in sorted(groups, key=lambda r: min(groups[r])):
        zones.extend(split(groups[root]))

    zone_of = [0] * n_sectors
    for z, part in enumerate(zones):
        for s in part:
            zone_of[s] = z
    # Merge the small ones, smallest first.
    while True:
        areas: dict[int, float] = {}
        for s in range(n_sectors):
            areas[zone_of[s]] = areas.get(zone_of[s], 0.0) + area[s]
        small = sorted((a, z) for z, a in areas.items() if a < ZONE_MIN_M2)
        merged = False
        for _, z in small:
            shared: dict[int, int] = {}
            for a, b in pairs:
                if zone_of[a] != zone_of[b] and z in (zone_of[a], zone_of[b]):
                    o = zone_of[b] if zone_of[a] == z else zone_of[a]
                    shared[o] = shared.get(o, 0) + 1
            if shared:
                into = max(sorted(shared), key=lambda o: shared[o])
                zone_of = [into if v == z else v for v in zone_of]
                merged = True
                break
        if not merged:
            break
    order = {z: i for i, z in enumerate(sorted(set(zone_of), key=lambda z: min(s for s in range(n_sectors) if zone_of[s] == z)))}
    return [order[z] for z in zone_of]


def _fill_point(segs, box) -> tuple[float, float] | None:
    """The point of a 32 x 32 grid over the box that lies inside the segments' shape and furthest from their lines."""
    x0, z0, x1, z1 = box
    best, best_d = None, 0.0
    n = 32
    for i in range(n):
        for j in range(n):
            px = x0 + (x1 - x0) * (i + 0.5) / n
            pz = z0 + (z1 - z0) * (j + 0.5) / n
            if not _inside(px, pz, segs):
                continue
            d = min(_seg_dist(px, pz, a, b) for a, b in segs)
            # Ties (a symmetric room: two arms equally far from the walls) go to the first grid point,
            # not to the vertices' 0.1 mm rounding noise, so the pick is the same at every world scale.
            if d > best_d + 1e-3:
                best, best_d = (px, pz), d
    return best


def convert(wad_path: Path, map_name: str, units_per_m: float = UNITS_PER_M, skill: int = 4, zombieman: str = "mix",
            overrides: dict | None = None) -> tuple[dict, dict]:
    """Returns (level, stats): the level is the JSON to write, stats only feed the summary line.
    `skill` is Doom's 1..5 (things without that skill's flag bit are left out); `zombieman` is
    "mix" (a variant per spawn by FNV-1a of its id) or one of ZOMBIEMAN_VARIANTS. `overrides` is a
    loaded doom_overrides file (None: none); a bad one raises doom_overrides.OverrideError."""
    if not (math.isfinite(units_per_m) and units_per_m > 0):
        raise ValueError(f"units_per_m must be a positive number, not {units_per_m}")
    if overrides is not None:
        doom_overrides.check_top(overrides, map_name)
        overrides = doom_overrides.rescaled(overrides, units_per_m)
    if skill not in SKILL_BITS:
        raise ValueError(f"skill must be one of {sorted(SKILL_BITS)}")
    if zombieman != "mix" and zombieman not in ZOMBIEMAN_VARIANTS:
        raise ValueError(f"zombieman must be mix or one of {ZOMBIEMAN_VARIANTS}")
    verts, sectors, sides, lines, things = parse_map(map_lumps(read_wad(Path(wad_path).read_bytes()), map_name))
    start = next((t for t in things if t["type"] == PLAYER1_START), None)
    if start is None:
        raise ValueError(f"{map_name}: no player 1 start")
    start_sector = next((s for s in range(len(sectors)) if _sector_at(start["x"], start["y"], verts, lines, sides, s)), 0)
    sx, sy, base = start["x"], start["y"], sectors[start_sector]["floor"]
    m = float(units_per_m)
    X = lambda x: round((x - sx) / m, 4)    # noqa: E731
    Z = lambda y: round(-(y - sy) / m, 4)   # noqa: E731  Doom +y is our -z
    H = lambda h: round((h - base) / m, 4)  # noqa: E731

    pairs = []
    neighbours: dict[int, set[int]] = {i: set() for i in range(len(sectors))}
    for ln in lines:
        if ln["left"] is not None:
            a, b = sides[ln["right"]]["sector"], sides[ln["left"]]["sector"]
            pairs.append((a, b))
            if a != b:
                neighbours[a].add(b)
                neighbours[b].add(a)

    # Which sectors move: manual doors (the back side of the line), and sectors a tagged line targets.
    # door_by: the specials that open each door sector (its speed and key come from them).
    door_by: dict[int, set[int]] = {}
    for ln in lines:
        if ln["special"] in DOOR_SPECIALS and ln["left"] is not None:
            door_by.setdefault(sides[ln["left"]]["sector"], set()).add(ln["special"])
    doors = set(door_by)
    lowered: set[int] = set()
    for ln in lines:
        if ln["tag"] == 0:
            continue
        targets = [i for i, s in enumerate(sectors) if s["tag"] == ln["tag"]]
        if ln["special"] in REMOTE_DOOR_SPECIALS:
            doors.update(targets)
            for t in targets:
                door_by.setdefault(t, set()).add(ln["special"])
        elif ln["special"] in FLOOR_LOWER_SPECIALS:
            lowered.update(targets)
    floor = {i: s["floor"] for i, s in enumerate(sectors)}
    ceil = {i: s["ceil"] for i, s in enumerate(sectors)}
    for i in sorted(lowered):
        if neighbours[i]:
            floor[i] = min(floor[i], min(sectors[n]["floor"] for n in neighbours[i]))
    for d in sorted(doors):
        if neighbours[d]:
            ceil[d] = min(sectors[n]["ceil"] for n in neighbours[d]) - DOOR_OPEN_GAP_UNITS
    for i in range(len(sectors)):
        if ceil[i] <= floor[i]:
            raise ValueError(f"{map_name}: sector {i} (tag {sectors[i]['tag']}) has ceiling {ceil[i]} <= floor {floor[i]} "
                             "and no door or floor-lower special opens it")

    # Each sector's wall material: the most common texture on the line sides facing into it.
    faces: dict[int, dict[str, int]] = {}
    for ln in lines:
        for side in (ln["right"], ln["left"]):
            if side is None:
                continue
            sd = sides[side]
            for tex in (sd["middle"], sd["upper"], sd["lower"]):
                if tex and tex != "-":
                    f = faces.setdefault(sd["sector"], {})
                    f[tex] = f.get(tex, 0) + 1

    kept = [ln for ln in lines if verts[ln["v1"]] != verts[ln["v2"]]]    # the parser rejects zero-length lines
    dropped = len(lines) - len(kept)

    # Real area (m^2) per sector from its directed edges (the sector is on the left), and the lines around it.
    n = len(sectors)
    area = [0.0] * n
    bbox = {}
    sector_segs: list[list] = [[] for _ in range(n)]
    for ln in kept:
        a, b = (X(verts[ln["v1"]][0]), Z(verts[ln["v1"]][1])), (X(verts[ln["v2"]][0]), Z(verts[ln["v2"]][1]))
        cross = (a[0] * b[1] - b[0] * a[1]) / 2
        f = sides[ln["right"]]["sector"]
        bk = sides[ln["left"]]["sector"] if ln["left"] is not None else None
        if f == bk:
            continue
        area[f] += cross
        sector_segs[f].append((a, b))
        if bk is not None:
            area[bk] -= cross
            sector_segs[bk].append((a, b))
    for i in range(n):
        pts = [p for seg in sector_segs[i] for p in seg] or [(0.0, 0.0)]
        bbox[i] = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    # Structural decisions (zones, which zones / pools / emitters earn a light) read the area at
    # REFERENCE_UNITS_PER_M, so the world scale does not change them; powers read the real area.
    area_ref = [a * (m / REFERENCE_UNITS_PER_M) ** 2 for a in area]
    zone_of = _zones(n, pairs, doors, area_ref, bbox)

    out_sectors = []
    for i, s in enumerate(sectors):
        special, hurt = sector_special(s["special"])
        floor_mat = material_for_flat(s["floor_tex"])
        wall_tex = max(faces.get(i, {"-": 1}).items(), key=lambda kv: kv[1])[0]
        sec = {
            "floor": H(floor[i]), "ceil": H(ceil[i]), "light": round(max(0, min(255, s["light"])) / 255, 3),
            "zone": zone_of[i],
            "materials": {"floor": floor_mat, "ceil": material_for_flat(s["ceil_tex"]), "wall": material_for_texture(wall_tex)},
        }
        if special != "none":
            sec["special"] = special
        if hurt:
            sec["hurtPerSec"] = hurt
        if floor_mat in GLOW_MATERIALS:
            sec["glow"] = floor_mat
        out_sectors.append(sec)
    # Hand-written sector patches, before anything reads the sectors (lines' wall fallbacks, lights, things).
    sector_patches = doom_overrides.apply_sectors(overrides, out_sectors, sector_segs) if overrides is not None else []

    out_lines = []
    for ln in kept:
        rec = {"v": [ln["v1"], ln["v2"]], "front": sides[ln["right"]]["sector"]}
        if ln["left"] is not None:
            rec["back"] = sides[ln["left"]]["sector"]
        if ln["special"] in EXIT_SPECIALS:
            rec["exit"] = True
        walls = _line_walls(ln, sides, out_sectors)
        if walls:
            rec["walls"] = walls
        out_lines.append(rec)

    verts_m = [[X(x), Z(y)] for x, y in verts]
    door_entities, doors_left_open = _door_entities(doors, door_by, out_lines, verts_m, out_sectors)

    # Fill lights: one per zone of real area >= LIGHT_MIN_ZONE_M2 (the biggest MAX_LIGHTS), at a point
    # confirmed inside the zone's biggest sector, as far from its walls as the grid finds.
    zone_area: dict[int, float] = {}
    for i in range(n):
        zone_area[zone_of[i]] = zone_area.get(zone_of[i], 0.0) + area_ref[i]
    big_zones = sorted((z for z, a in zone_area.items() if a >= LIGHT_MIN_ZONE_M2), key=lambda z: (-zone_area[z], z))[:MAX_LIGHTS]
    lights = []
    for zone in sorted(big_zones):
        members = [i for i in range(n) if zone_of[i] == zone]
        mean = sum(out_sectors[i]["light"] for i in members) / len(members)
        for i in sorted(members, key=lambda i: (-area[i], i)):
            pt = _fill_point(sector_segs[i], bbox[i]) if area[i] > 0 else None
            if pt is None:
                continue
            f, c = out_sectors[i]["floor"], out_sectors[i]["ceil"]
            lights.append({"pos": [round(pt[0], 3), round(min(c - 0.4, f + 0.75 * (c - f)), 3), round(pt[1], 3)],
                           "color": [1.0, 0.92, 0.82], "power": round(3 + 9 * mean, 2), "fixture": "none"})
            break

    # Pool lights: connected glow sectors of one kind form a pool; each of at least POOL_MIN_M2 gets a
    # cheap 'fire' light (liquid flicker) just above the floor of its biggest sector.
    glow = {i: out_sectors[i]["glow"] for i in range(n) if "glow" in out_sectors[i]}
    pu = _Union(n)
    for a, b in pairs:
        if a != b and a in glow and glow.get(a) == glow.get(b):
            pu.join(a, b)
    pools: dict[int, list[int]] = {}
    for i in glow:
        pools.setdefault(pu.find(i), []).append(i)
    ranked = sorted(((sum(area[i] for i in g), min(g), g) for g in pools.values() if sum(area_ref[i] for i in g) >= POOL_MIN_M2),
                    key=lambda t: (-t[0], t[1]))[:MAX_POOL_LIGHTS]
    for total_area, _, g in ranked:
        for i in sorted(g, key=lambda i: (-area[i], i)):
            pt = _fill_point(sector_segs[i], bbox[i]) if area[i] > 0 else None
            if pt is None:
                continue
            lights.append({"pos": [round(pt[0], 3), round(out_sectors[i]["floor"] + 0.6, 3), round(pt[1], 3)],
                           "color": list(POOL_COLOURS[glow[i]]), "power": round(min(14, 4 + 0.15 * total_area), 2),
                           "mood": "fire", "fixture": "none"})
            break
    pool_lights = sum(1 for li in lights if li.get("mood") == "fire")
    push_sets = {c: _emitter_lights(out_sectors, out_lines, verts_m, sector_segs, bbox, area, m / REFERENCE_UNITS_PER_M,
                                    spill="spill" in c.split("+"), exit_push="exit" in c.split("+")) for c in PUSH_COMBOS}
    emitter_lights = push_sets["none"]
    lights.extend(_merge_push(push_sets))

    # Things: monsters, pickups and barrels at their sector's floor; ids from the THINGS index, so stable.
    skill_bit = SKILL_BITS[skill]
    spawns, pickups, barrels = [], [], []
    skipped: dict[int, int] = {}
    in_no_sector = not_this_skill = multiplayer_only = 0
    for ti, t in enumerate(things):
        if t["type"] == PLAYER1_START:
            continue
        is_barrel = t["type"] in THING_BARRELS
        if t["flags"] & MULTIPLAYER_ONLY:
            multiplayer_only += 1
            continue
        if not is_barrel and not t["flags"] & skill_bit:     # barrels are scenery: every skill
            not_this_skill += 1
            continue
        is_spawn = t["type"] == ZOMBIEMAN or t["type"] in THING_SPAWNS
        if not is_spawn and not is_barrel and t["type"] not in THING_PICKUPS:
            skipped[t["type"]] = skipped.get(t["type"], 0) + 1
            continue
        sec = next((s for s in range(n) if _sector_at(t["x"], t["y"], verts, lines, sides, s)), None)
        if sec is None:
            in_no_sector += 1
            continue
        pos = [X(t["x"]), out_sectors[sec]["floor"], Z(t["y"])]
        if is_barrel:
            barrels.append({"id": f"b{ti}", "pos": pos})
            continue
        if is_spawn:
            sid = f"s{ti}"
            if t["type"] == ZOMBIEMAN:
                kind = ZOMBIEMAN_VARIANTS[fnv1a32(sid) % len(ZOMBIEMAN_VARIANTS)] if zombieman == "mix" else zombieman
            else:
                kind = THING_SPAWNS[t["type"]]
            spawns.append({"id": sid, "kind": kind, "pos": pos, "yaw": round(math.radians(90 - t["angle"]), 6)})
        else:
            pickups.append({"id": f"p{ti}", "item": THING_PICKUPS[t["type"]], "pos": pos})

    override_spawns = []
    if overrides is not None:
        used = {s["id"] for s in spawns} | {p["id"] for p in pickups} | {b["id"] for b in barrels}
        override_spawns = doom_overrides.apply_spawns(overrides, spawns, used, verts_m, out_lines, out_sectors, sector_segs)

    # The exit: walking into the switch ends the level. A box on the line's front side (left of
    # v0 -> v1 in our x/z), EXIT_DEPTH_M deep, spanning the line, floor to floor + EXIT_HEIGHT_M.
    triggers = []
    for ln in kept:
        if ln["special"] not in EXIT_SPECIALS:
            continue
        f = sides[ln["right"]]["sector"]
        (ax, az), (bx, bz) = (X(verts[ln["v1"]][0]), Z(verts[ln["v1"]][1])), (X(verts[ln["v2"]][0]), Z(verts[ln["v2"]][1]))
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz)
        nx, nz = -dz / length * EXIT_DEPTH_M, dx / length * EXIT_DEPTH_M
        xs = (ax, bx, ax + nx, bx + nx)
        zs = (az, bz, az + nz, bz + nz)
        fl = out_sectors[f]["floor"]
        triggers.append({"id": "exit" if not triggers else f"exit-{len(triggers) + 1}", "event": "level.end", "once": True,
                         "min": [round(min(xs), 4), fl, round(min(zs), 4)],
                         "max": [round(max(xs), 4), round(fl + EXIT_HEIGHT_M, 4), round(max(zs), 4)]})

    level = {
        "version": 1, "id": f"doom-{map_name.lower()}", "name": f"Doom {map_name.upper()} (dev placeholder)",
        "geometry": "sectors", "unitsPerM": m, "ammo": "infinite", "loadout": ["melee", "shotgun", "dynamite", "flare"],
        "vertices": [[X(x), Z(y)] for x, y in verts],
        "sectors": out_sectors, "lines": out_lines,
        "start": {"pos": [0.0, 0.0, 0.0], "yaw": round(math.radians(90 - start["angle"]), 6)},
        "lights": lights,
        "spawns": spawns, "pickups": pickups, "triggers": triggers,
    }
    if triggers:
        level["completeOn"] = "level.end"
    if door_entities:
        level["doors"] = door_entities
    if barrels:
        level["barrels"] = barrels

    def count(items, key):
        out: dict[str, int] = {}
        for it in items:
            out[it[key]] = out.get(it[key], 0) + 1
        return out

    stats = {"dropped_zero_length_lines": dropped, "doors_opened": sorted(doors), "doors_left_open": doors_left_open,
             "floors_lowered": sorted(lowered), "pool_lights": pool_lights,
             "emitter_lights": len(emitter_lights),
             "emitter_lights_by_push": {c: len(v) for c, v in push_sets.items()},
             "spawns_by_kind": count(spawns, "kind"), "pickups_by_item": count(pickups, "item"), "skipped_types": skipped, "barrels": len(barrels),
             "in_no_sector": in_no_sector, "not_this_skill": not_this_skill, "multiplayer_only": multiplayer_only,
             "override_sectors": sector_patches, "override_spawns": override_spawns}
    return level, stats


def _door_entities(doors: set[int], door_by: dict[int, set[int]], out_lines, verts_m, out_sectors) -> tuple[list[dict], list[int]]:
    """The door sectors shaped like a doorway as door entities (sector-def.ts SectorDoorDef), and the
    others (left open holes). A doorway: exactly two two-sided lines between the sector and another
    (its faces), the same length, parallel, their ends joined square (a rectangle, the jambs being
    one-sided track walls). `a` -> `b` runs between the faces' matching ends; the leaves stand on the
    sector floor up to its (open) ceiling."""
    out, left_open = [], []
    for d in sorted(doors):
        faces = [k for k, ln in enumerate(out_lines)
                 if "back" in ln and ln["front"] != ln["back"] and d in (ln["front"], ln["back"])]
        if len(faces) != 2:
            left_open.append(d)
            continue
        (p0, p1), (q0, q1) = [(verts_m[out_lines[k]["v"][0]], verts_m[out_lines[k]["v"][1]]) for k in faces]
        dist = lambda u, v: math.hypot(u[0] - v[0], u[1] - v[1])  # noqa: E731
        if dist(p0, q0) + dist(p1, q1) > dist(p0, q1) + dist(p1, q0):
            q0, q1 = q1, q0
        a = [round((p0[0] + q0[0]) / 2, 4), round((p0[1] + q0[1]) / 2, 4)]
        b = [round((p1[0] + q1[0]) / 2, 4), round((p1[1] + q1[1]) / 2, 4)]
        width = math.hypot(b[0] - a[0], b[1] - a[1])
        tx, tz = ((b[0] - a[0]) / width, (b[1] - a[1]) / width) if width > 0 else (0.0, 0.0)
        # Square: both faces as long as the doorway, and each jamb (p0 -> q0, p1 -> q1) across it.
        square = width > 0 and abs(dist(p0, p1) - width) < DOOR_SHAPE_TOL_M and abs(dist(q0, q1) - width) < DOOR_SHAPE_TOL_M \
            and all(abs((q[0] - p[0]) * tx + (q[1] - p[1]) * tz) < DOOR_SHAPE_TOL_M for p, q in ((p0, q0), (p1, q1)))
        if not square:
            left_open.append(d)
            continue
        depth = dist(p0, q0)
        beyond = [out_lines[k]["back"] if out_lines[k]["front"] == d else out_lines[k]["front"] for k in faces]
        by = door_by.get(d, set())
        rec = {"id": f"door-{d}", "sector": d, "faces": faces, "a": a, "b": b,
               "width": round(width, 4), "depth": round(depth, 4),
               "height": round(out_sectors[d]["ceil"] - out_sectors[d]["floor"], 4),
               "zones": [out_sectors[s]["zone"] for s in beyond], "style": "split",
               "speed": DOOR_BLAZE_SPEED_M_S if by & BLAZE_DOOR_SPECIALS else DOOR_SPEED_M_S, "wait": DOOR_WAIT_S}
        keys = sorted({DOOR_KEY_SPECIALS[sp] for sp in by if sp in DOOR_KEY_SPECIALS})
        if keys:
            rec["key"] = keys[0]
        out.append(rec)
    return out, left_open


def _emitter_walls(out_sectors, out_lines, verts_m):
    """Every emitter wall quad as (family, sector, a, b, y0, y1), a -> b with the sector on the left: the
    Python copy of sector-geometry.ts wallQuads' parts and families (a part's own family, else the sector's
    materials.wall). Keep the two in step."""
    out = []
    for ln in out_lines:
        va, vb = verts_m[ln["v"][0]], verts_m[ln["v"][1]]
        walls = ln.get("walls", {})

        def push(y0, y1, sec, part):
            if y1 - y0 < 1e-4:
                return
            front = sec == ln["front"]
            fam = walls.get("front" if front else "back", {}).get(part, out_sectors[sec]["materials"]["wall"])
            if fam in EMITTER_FAMILIES:
                out.append((fam, sec, va if front else vb, vb if front else va, y0, y1))
        f = out_sectors[ln["front"]]
        back = ln.get("back", -1)
        if back < 0:
            push(f["floor"], f["ceil"], ln["front"], "mid")
            continue
        if back == ln["front"]:
            continue
        k = out_sectors[back]
        if f["floor"] != k["floor"]:
            push(min(f["floor"], k["floor"]), max(f["floor"], k["floor"]), ln["front"] if f["floor"] < k["floor"] else back, "lower")
        if f["ceil"] != k["ceil"] and not (f["materials"]["ceil"] == "sky" and k["materials"]["ceil"] == "sky"):
            push(min(f["ceil"], k["ceil"]), max(f["ceil"], k["ceil"]), ln["front"] if f["ceil"] > k["ceil"] else back, "upper")
    return out


def _facing_group(fam: str, a, b, spill: bool) -> int:
    """The wall group key's facing part: one group per sector and family (-1), or with the spill push a screen
    bank's walls grouped by which of 8 compass directions they face (a U of banks: three lights, not one in the
    room's middle)."""
    if not (spill and fam == "screen-bank"):
        return -1
    dx, dz = b[0] - a[0], b[1] - a[1]
    return int(round(math.atan2(dx, -dz) / (math.pi / 4))) % 8


def _spill_groups(groups: dict, to_ref: float) -> dict:
    """The spill push's screen-bank groups: a sector's facing groups of at least SPILL_GROUP_MIN_M2 (at the
    reference scale) each earn a candidate; the smaller ones earn none (the baked bounce still lights from
    them). A sector with no group that big keeps its one per-sector group, as without the push."""
    def area(quads):
        return sum(math.hypot(b[0] - a[0], b[1] - a[1]) * (y1 - y0) for a, b, y0, y1 in quads) * to_ref ** 2
    out: dict = {}
    by_sector: dict[int, list] = {}
    for key, quads in groups.items():
        if key[2] < 0:
            out[key] = quads
        else:
            by_sector.setdefault(key[0], []).append((key, quads))
    for sec, items in by_sector.items():
        big = [(k, q) for k, q in items if area(q) >= SPILL_GROUP_MIN_M2]
        if big:
            out.update(big)
        else:
            out[(sec, items[0][0][1], -1)] = [q for _, qs in items for q in qs]
    return out


def _sector_of_point(px: float, pz: float, sector_segs, bbox) -> int:
    for i, segs in enumerate(sector_segs):
        x0, z0, x1, z1 = bbox[i]
        if x0 <= px <= x1 and z0 <= pz <= z1 and _inside(px, pz, segs):
            return i
    return -1


def _emitter_lights(out_sectors, out_lines, verts_m, sector_segs, bbox, area, to_ref: float = 1.0,
                    spill: bool = False, exit_push: bool = False) -> list[dict]:
    """Cheap coloured lights for the strongest emitter surfaces (EMITTER_LIGHTS): one candidate per
    (sector, family) of wall quads, standing out_m in front of their area-weighted middle at their mean
    height, and one per fluorescent ceiling, CEIL_DROP_M under it; ranked by area x weight, at most
    MAX_EMITTER_LIGHTS, MAX_EMITTER_LIGHTS_PER_ZONE per zone, EMITTER_LIGHT_SPACING_M apart per family.
    `to_ref` turns real metres into metres at REFERENCE_UNITS_PER_M: min_m2, out_m and the spacings are
    read there (the same picks at the same Doom spots at any world scale); the heights over the floor
    (bodies' scale) and the powers (real area) stay real. `spill` and `exit_push` are the PUSH steps
    (PUSH_COMBOS, above)."""
    groups: dict[tuple[int, str, int], list] = {}
    for fam, sec, a, b, y0, y1 in _emitter_walls(out_sectors, out_lines, verts_m):
        groups.setdefault((sec, fam, _facing_group(fam, a, b, spill)), []).append((a, b, y0, y1))
    if spill:
        groups = _spill_groups(groups, to_ref)
    cands = []
    for (sec, fam, _), quads in groups.items():
        spec = EMITTER_LIGHTS[fam]
        tot = cx = cz = cy = nx = nz = 0.0
        ylo = math.inf
        for a, b, y0, y1 in quads:
            dx, dz = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dz)
            w = ln * (y1 - y0)
            tot += w
            cx += w * (a[0] + b[0]) / 2
            cz += w * (a[1] + b[1]) / 2
            cy += w * (y0 + y1) / 2
            nx += w * -dz / ln
            nz += w * dx / ln
            ylo = min(ylo, y0)
        if tot * to_ref ** 2 < spec["min_m2"]:
            continue
        cx, cz, cy = cx / tot, cz / tot, cy / tot
        nl = math.hypot(nx, nz)
        s = out_sectors[sec]
        if exit_push and fam == "exit-sign":
            # Low and in front of the sign: a wall sign, EXIT_OUT_M out from its middle; a hanging box (its faces
            # face every way, the normals cancel) at its sector's fill point (the box is often a door's lintel:
            # under its middle the light would sit against the door). Whatever sector that point is in.
            if nl > 0.5 * tot:
                k = EXIT_OUT_M / to_ref
                pt2 = (cx + nx / nl * k, cz + nz / nl * k)
            else:
                pt2 = _fill_point(sector_segs[sec], bbox[sec]) if area[sec] > 0 else None
            under = _sector_of_point(pt2[0], pt2[1], sector_segs, bbox) if pt2 else -1
            if under >= 0:
                px, pz = pt2
                u = out_sectors[under]
                y = max(u["floor"] + EXIT_MIN_Y_M, min(ylo - EXIT_DROP_M, u["ceil"] - 0.2))
                # Ranked as before (signs first: weight 30); the placement sector is the one it hangs in.
                cands.append((round(tot * to_ref ** 2 * spec["weight"], 1), under, fam, tot, (px, y, pz)))
                continue
        pt = None
        # Out from the walls along their mean normal (none for a room lined with them: the middle itself).
        for k in ((1.0, 0.6, 0.3, 0.0) if nl > 1e-6 else (0.0,)):
            px = cx + (nx / nl * spec["out_m"] / to_ref * k if nl > 1e-6 else 0.0)
            pz = cz + (nz / nl * spec["out_m"] / to_ref * k if nl > 1e-6 else 0.0)
            if _inside(px, pz, sector_segs[sec]):
                pt = (px, pz)
                break
        if pt is None:
            pt = _fill_point(sector_segs[sec], bbox[sec]) if area[sec] > 0 else None
        if pt is None:
            continue
        # At the surfaces' mean height, but no higher than EMITTER_LIGHT_MAX_Y_M over the floor: the light is for bodies.
        y = min(s["ceil"] - 0.3, s["floor"] + EMITTER_LIGHT_MAX_Y_M, max(s["floor"] + 0.5, cy))
        # Ranked by the area at the reference scale, rounded to 0.1: vertices rounded to 0.1 mm at a scale that is not
        # a power of two make equal Doom areas differ in the last digits, which would break ties by noise.
        cands.append((round(tot * to_ref ** 2 * spec["weight"], 1), sec, fam, tot, (pt[0], y, pt[1])))
    for sec, s in enumerate(out_sectors):
        if s["materials"]["ceil"] != "fluorescent" or area[sec] * to_ref ** 2 < EMITTER_LIGHTS["fluorescent"]["min_m2"]:
            continue
        pt = _fill_point(sector_segs[sec], bbox[sec])
        if pt is None:
            continue
        cands.append((round(area[sec] * to_ref ** 2 * EMITTER_LIGHTS["fluorescent"]["weight"], 1), sec, "fluorescent", area[sec], (pt[0], s["ceil"] - CEIL_DROP_M, pt[1])))
    cands.sort(key=lambda c: (-c[0], c[1], c[2]))
    picked: list[dict] = []
    per_zone: dict[int, int] = {}
    placed: list[tuple[str, tuple, int]] = []
    cap = MAX_EMITTER_LIGHTS_PUSH if (spill or exit_push) else MAX_EMITTER_LIGHTS
    for _, sec, fam, tot, pos in cands:
        if len(picked) >= cap:
            break
        zone = out_sectors[sec]["zone"]
        if per_zone.get(zone, 0) >= MAX_EMITTER_LIGHTS_PER_ZONE:
            continue

        def clash(f, p, z):
            if spill and z != zone:
                return False
            if exit_push and f != fam and "exit-sign" in (f, fam):
                return False
            gap = EMITTER_LIGHT_SPACING_M if f == fam else EMITTER_LIGHT_MIN_GAP_M
            return math.hypot(p[0] - pos[0], p[2] - pos[2]) * to_ref < gap
        if any(clash(f, p, z) for f, p, z in placed):
            continue
        spec = EMITTER_LIGHTS[fam]
        if spill and fam == "screen-bank":
            spec = {**spec, **SPILL_SCREEN_LIGHT}
        if exit_push and fam == "exit-sign":
            spec = {**spec, "base": EXIT_POWER, "per_m2": 0.0, "cap": EXIT_POWER}
        picked.append({"pos": [round(pos[0], 3), round(pos[1], 3), round(pos[2], 3)], "color": list(spec["color"]),
                       "power": round(min(spec["cap"], spec["base"] + spec["per_m2"] * tot), 2), "mood": "glow", "fixture": "none"})
        per_zone[zone] = per_zone.get(zone, 0) + 1
        placed.append((fam, pos, zone))
    if exit_push:
        signs = [(p, z) for f, p, z in placed if f == "exit-sign"]
        for li, (f, p, z) in zip(picked, placed):
            if f == "fluorescent" and any(sz == z and math.hypot(sp[0] - p[0], sp[2] - p[2]) * to_ref < EXIT_DIM_M for sp, sz in signs):
                li["power"] = round(li["power"] * EXIT_FLUORO_DIM, 2)
    return picked


def _merge_push(sets: dict[str, list[dict]]) -> list[dict]:
    """One light list from the per-combo ones (PUSH_COMBOS order, each light where it first appears): a light in
    every combo as it was, any other tagged `push` with the combos it is in."""
    order: list[str] = []
    seen: dict[str, tuple[dict, list[str]]] = {}
    for combo in PUSH_COMBOS:
        for li in sets[combo]:
            key = json.dumps(li, sort_keys=True)
            if key not in seen:
                seen[key] = (li, [])
                order.append(key)
            seen[key][1].append(combo)
    out = []
    for key in order:
        li, combos = seen[key]
        out.append(dict(li) if len(combos) == len(PUSH_COMBOS) else {**li, "push": combos})
    return out


def _line_walls(ln, sides, out_sectors) -> dict:
    """Per-side wall families for the parts the renderer draws: a one-sided line's middle, a two-sided
    line's upper and lower on each side (each side's sidedef faces its own sector). A part whose family
    equals that sector's `materials.wall`, or whose texture is missing ("-"), is left out (the fallback)."""
    out = {}
    parts = (("mid", "middle"),) if ln["left"] is None else (("upper", "upper"), ("lower", "lower"))
    for side_name, side in (("front", ln["right"]), ("back", ln["left"])):
        if side is None:
            continue
        sd = sides[side]
        fallback = out_sectors[sd["sector"]]["materials"]["wall"]
        fams = {}
        for part, key in parts:
            tex = sd[key]
            if tex and tex != "-":
                fam = material_for_texture(tex)
                if fam != fallback:
                    fams[part] = fam
        if fams:
            out[side_name] = fams
    return out


def write_svg(level: dict, path: Path) -> None:
    """Top-down plan for picking waypoints: lines grey (two-sided) / white (walls), zone numbers, the start."""
    vs = level["vertices"]
    x0 = min(v[0] for v in vs); x1 = max(v[0] for v in vs); z0 = min(v[1] for v in vs); z1 = max(v[1] for v in vs)
    s = 12
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 * s - 20} {z0 * s - 20} {(x1 - x0) * s + 40} {(z1 - z0) * s + 40}" style="background:#111">']
    faces = {f for d in level.get("doors", []) for f in d["faces"]}
    for i, ln in enumerate(level["lines"]):
        (ax, az), (bx, bz) = vs[ln["v"][0]], vs[ln["v"][1]]
        colour = "#c33" if i in faces else "#666" if "back" in ln else "#eee"
        parts.append(f'<line x1="{ax * s}" y1="{az * s}" x2="{bx * s}" y2="{bz * s}" stroke="{colour}" stroke-width="1.5"/>')
    spots: dict[int, list[list[float]]] = {}
    for ln in level["lines"]:
        spots.setdefault(level["sectors"][ln["front"]]["zone"], []).extend(vs[v] for v in ln["v"])
    for zone, pts in sorted(spots.items()):
        cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
        cz = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
        parts.append(f'<text x="{cx * s}" y="{cz * s}" fill="#fc6" font-size="10">z{zone}</text>')
    for li in level["lights"]:
        parts.append(f'<circle cx="{li["pos"][0] * s}" cy="{li["pos"][2] * s}" r="2" fill="#6cf"/>')
    for k in range(int(x0 // 10) * 10, int(x1) + 1, 10):
        parts.append(f'<text x="{k * s}" y="{z0 * s - 6}" fill="#888" font-size="8">x{k}</text>')
    for k in range(int(z0 // 10) * 10, int(z1) + 1, 10):
        parts.append(f'<text x="{x0 * s - 18}" y="{k * s}" fill="#888" font-size="8">z{k}</text>')
    parts.append('<circle cx="0" cy="0" r="5" fill="#3c3"/></svg>')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wad", type=Path)
    ap.add_argument("map")
    ap.add_argument("--units-per-m", type=float, default=UNITS_PER_M,
                    help=f"world scale, Doom units per metre (default {UNITS_PER_M:g}; the bodies are not scaled)")
    ap.add_argument("--out", type=Path, default=Path("public/assets/levels"))
    ap.add_argument("--svg", type=Path, default=None, help="directory for a <MAP>.svg plan (keep it in .lab-tmp/)")
    ap.add_argument("--skill", type=int, choices=sorted(SKILL_BITS), default=4, help="Doom skill 1..5 (default 4, Ultra-Violence's things)")
    ap.add_argument("--zombieman", choices=("mix",) + ZOMBIEMAN_VARIANTS, default="mix", help="what zombiemen become (default: a mix)")
    ap.add_argument("--overrides", type=Path, default=None, help="hand-written edits (default scripts/levels/overrides/<map>.json if it exists)")
    ap.add_argument("--no-overrides", action="store_true", help="convert the WAD only")
    a = ap.parse_args()
    ov_path = None if a.no_overrides else a.overrides or doom_overrides.default_path(a.map)
    if a.overrides and not a.overrides.exists():
        ap.error(f"--overrides {a.overrides}: no such file")
    overrides = doom_overrides.load(ov_path) if ov_path is not None and ov_path.exists() else None
    try:
        level, stats = convert(a.wad, a.map, a.units_per_m, skill=a.skill, zombieman=a.zombieman, overrides=overrides)
    except doom_overrides.OverrideError as e:
        sys.exit(f"{ov_path}: {e}")
    a.out.mkdir(parents=True, exist_ok=True)
    path = a.out / f"{level['id']}.level.json"
    dropped = stats["dropped_zero_length_lines"]
    path.write_text(json.dumps(level, indent=1))
    zones = len({s["zone"] for s in level["sectors"]})
    doors = level.get("doors", [])
    print(f"{path}: {len(level['sectors'])} sectors, {len(level['lines'])} lines, {zones} zones, {len(doors)} doors"
          f" (sectors {[d['sector'] for d in doors]}; left open: {stats['doors_left_open']}), {len(level['lights'])} lights ({stats['pool_lights']} pool, {stats['emitter_lights']} emitter; by push combo {stats['emitter_lights_by_push']})"
          + (f", dropped {dropped} zero-length lines" if dropped else ""))
    print(f"things: spawns {stats['spawns_by_kind']}, pickups {stats['pickups_by_item']}, {stats['barrels']} barrels, {len(level['triggers'])} exit triggers"
          + (f" {[[t['min'], t['max']] for t in level['triggers']]}" if level["triggers"] else "")
          + f"; skipped types {dict(sorted(stats['skipped_types'].items()))}, {stats['in_no_sector']} in no sector,"
          f" {stats['not_this_skill']} not on skill {a.skill}, {stats['multiplayer_only']} multiplayer-only")
    if overrides is not None:
        patched = ", ".join(f"{p['sector']} {sorted(p['set'])}" for p in stats["override_sectors"]) or "none"
        added = ", ".join(f"{s['id']} ({s['kind']}, sector {s['sector']})" for s in stats["override_spawns"]) or "none"
        print(f"overrides {ov_path}: sectors patched: {patched}; spawns added: {added}")
    if a.svg:
        write_svg(level, a.svg / f"{a.map.upper()}.svg")
        print(f"plan: {a.svg / (a.map.upper() + '.svg')}")


if __name__ == "__main__":
    main()
