#!/usr/bin/env python3
"""Convert a Doom map from a WAD into a Blud sector level.

    python3 scripts/levels/doom_map.py <wad> E1M1 [--units-per-m 32] [--out public/assets/levels] [--svg .lab-tmp/doom]

Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §5. Reads the vanilla map
lumps (VERTEXES, LINEDEFS, SIDEDEFS, SECTORS, THINGS; no BSP). Writes <out>/doom-<map>.level.json.
The output is derived from id Software's data: a dev placeholder, never committed (.gitignore).

Plan 1 writes geometry, zones, fill lights and the player start. Door sectors (manual or remotely
tagged) are written OPEN and remote floor-lowers LOWERED (plan 2 makes them move). Plan 3a writes
monsters (spawns), pickups and an exit trigger in front of each exit switch. Plan 3b writes Doom's
exploding barrels as our toxic drums (`barrels`, on every skill: they are scenery; multiplayer-only
ones are still left out). Other things (decorations, keys, ...) are skipped and counted.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doom_tables import (  # noqa: E402
    DOOR_SPECIALS, EXIT_SPECIALS, FLOOR_LOWER_SPECIALS, GLOW_MATERIALS, MULTIPLAYER_ONLY, REMOTE_DOOR_SPECIALS,
    SKILL_BITS, THING_BARRELS, THING_PICKUPS, THING_SPAWNS, ZOMBIEMAN, ZOMBIEMAN_VARIANTS,
    material_for_flat, material_for_texture, sector_special,
)

MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SECTORS")
STANDARD_MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS", "REJECT", "BLOCKMAP")
PLAYER1_START = 1
DOOR_OPEN_GAP_UNITS = 4          # Doom: a door opens to 4 units below the lowest neighbouring ceiling
ZONE_SPLIT_M2 = 600.0            # a zone whose real floor area is over this splits (spec §6.5)
ZONE_MIN_M2 = 50.0               # a smaller zone merges into a neighbour
LIGHT_MIN_ZONE_M2 = 150.0        # a zone gets a fill light from this area up
MAX_LIGHTS = 10
MAX_POOL_LIGHTS = 8             # pool lights do not count toward MAX_LIGHTS
POOL_MIN_M2 = 4.0
POOL_COLOURS = {"nukage": [0.35, 1.0, 0.3], "lava": [1.0, 0.45, 0.12], "acid": [0.75, 1.0, 0.25]}
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
            if d > best_d:
                best, best_d = (px, pz), d
    return best


def convert(wad_path: Path, map_name: str, units_per_m: float = 32, skill: int = 4, zombieman: str = "mix") -> tuple[dict, dict]:
    """Returns (level, stats): the level is the JSON to write, stats only feed the summary line.
    `skill` is Doom's 1..5 (things without that skill's flag bit are left out); `zombieman` is
    "mix" (a variant per spawn by FNV-1a of its id) or one of ZOMBIEMAN_VARIANTS."""
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
    doors = {sides[ln["left"]]["sector"] for ln in lines if ln["special"] in DOOR_SPECIALS and ln["left"] is not None}
    lowered: set[int] = set()
    for ln in lines:
        if ln["tag"] == 0:
            continue
        targets = [i for i, s in enumerate(sectors) if s["tag"] == ln["tag"]]
        if ln["special"] in REMOTE_DOOR_SPECIALS:
            doors.update(targets)
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
    zone_of = _zones(n, pairs, doors, area, bbox)

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

    out_lines = []
    for ln in kept:
        rec = {"v": [ln["v1"], ln["v2"]], "front": sides[ln["right"]]["sector"]}
        if ln["left"] is not None:
            rec["back"] = sides[ln["left"]]["sector"]
            if ln["special"] in DOOR_SPECIALS:
                rec["door"] = {"sector": rec["back"]}
        if ln["special"] in EXIT_SPECIALS:
            rec["exit"] = True
        walls = _line_walls(ln, sides, out_sectors)
        if walls:
            rec["walls"] = walls
        out_lines.append(rec)

    # Fill lights: one per zone of real area >= LIGHT_MIN_ZONE_M2 (the biggest MAX_LIGHTS), at a point
    # confirmed inside the zone's biggest sector, as far from its walls as the grid finds.
    zone_area: dict[int, float] = {}
    for i in range(n):
        zone_area[zone_of[i]] = zone_area.get(zone_of[i], 0.0) + area[i]
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
    ranked = sorted(((sum(area[i] for i in g), min(g), g) for g in pools.values() if sum(area[i] for i in g) >= POOL_MIN_M2),
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
        "geometry": "sectors", "ammo": "infinite", "loadout": ["melee", "shotgun", "dynamite", "flare"],
        "vertices": [[X(x), Z(y)] for x, y in verts],
        "sectors": out_sectors, "lines": out_lines,
        "start": {"pos": [0.0, 0.0, 0.0], "yaw": round(math.radians(90 - start["angle"]), 6)},
        "lights": lights,
        "spawns": spawns, "pickups": pickups, "triggers": triggers,
    }
    if triggers:
        level["completeOn"] = "level.end"
    if barrels:
        level["barrels"] = barrels

    def count(items, key):
        out: dict[str, int] = {}
        for it in items:
            out[it[key]] = out.get(it[key], 0) + 1
        return out

    stats = {"dropped_zero_length_lines": dropped, "doors_opened": sorted(doors), "floors_lowered": sorted(lowered), "pool_lights": pool_lights,
             "spawns_by_kind": count(spawns, "kind"), "pickups_by_item": count(pickups, "item"), "skipped_types": skipped, "barrels": len(barrels),
             "in_no_sector": in_no_sector, "not_this_skill": not_this_skill, "multiplayer_only": multiplayer_only}
    return level, stats


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
    for ln in level["lines"]:
        (ax, az), (bx, bz) = vs[ln["v"][0]], vs[ln["v"][1]]
        colour = "#c33" if "door" in ln else "#666" if "back" in ln else "#eee"
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
    ap.add_argument("--units-per-m", type=float, default=32)
    ap.add_argument("--out", type=Path, default=Path("public/assets/levels"))
    ap.add_argument("--svg", type=Path, default=None, help="directory for a <MAP>.svg plan (keep it in .lab-tmp/)")
    ap.add_argument("--skill", type=int, choices=sorted(SKILL_BITS), default=4, help="Doom skill 1..5 (default 4, Ultra-Violence's things)")
    ap.add_argument("--zombieman", choices=("mix",) + ZOMBIEMAN_VARIANTS, default="mix", help="what zombiemen become (default: a mix)")
    a = ap.parse_args()
    level, stats = convert(a.wad, a.map, a.units_per_m, skill=a.skill, zombieman=a.zombieman)
    a.out.mkdir(parents=True, exist_ok=True)
    path = a.out / f"{level['id']}.level.json"
    dropped = stats["dropped_zero_length_lines"]
    path.write_text(json.dumps(level, indent=1))
    zones = len({s["zone"] for s in level["sectors"]})
    doors = sum(1 for ln in level["lines"] if "door" in ln)
    print(f"{path}: {len(level['sectors'])} sectors, {len(level['lines'])} lines, {zones} zones, {doors} door lines, {len(level['lights'])} lights ({stats['pool_lights']} pool)"
          + (f", dropped {dropped} zero-length lines" if dropped else ""))
    print(f"things: spawns {stats['spawns_by_kind']}, pickups {stats['pickups_by_item']}, {stats['barrels']} barrels, {len(level['triggers'])} exit triggers"
          + (f" {[[t['min'], t['max']] for t in level['triggers']]}" if level["triggers"] else "")
          + f"; skipped types {dict(sorted(stats['skipped_types'].items()))}, {stats['in_no_sector']} in no sector,"
          f" {stats['not_this_skill']} not on skill {a.skill}, {stats['multiplayer_only']} multiplayer-only")
    if a.svg:
        write_svg(level, a.svg / f"{a.map.upper()}.svg")
        print(f"plan: {a.svg / (a.map.upper() + '.svg')}")


if __name__ == "__main__":
    main()
