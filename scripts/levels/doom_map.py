#!/usr/bin/env python3
"""Convert a Doom map from a WAD into a Blud sector level.

    python3 scripts/levels/doom_map.py <wad> E1M1 [--units-per-m 32] [--out public/assets/levels] [--svg .lab-tmp/doom]

Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §5. Reads the vanilla map
lumps (VERTEXES, LINEDEFS, SIDEDEFS, SECTORS, THINGS; no BSP). Writes <out>/doom-<map>.level.json.
The output is derived from id Software's data: a dev placeholder, never committed (.gitignore).

Plan 1 writes geometry, zones, one fill light per zone and the player start. Door sectors are
written OPEN (plan 2 makes them move); other things are skipped (plan 5).
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
    DOOR_SPECIALS, EXIT_SPECIALS, GLOW_MATERIALS, material_for_flat, material_for_texture, sector_special,
)

MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SECTORS")
PLAYER1_START = 1
DOOR_OPEN_GAP_UNITS = 4          # Doom: a door opens to 4 units below the lowest neighbouring ceiling
ZONE_SPLIT_M2 = 400.0            # spec §6.5


def _name8(b: bytes) -> str:
    return b.rstrip(b"\0").decode("ascii", "replace").upper()


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
            found = {n2: d for n2, d in entries[i + 1:i + 11] if n2 in MAP_LUMPS}
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
        sides.append(dict(upper=_name8(up), lower=_name8(lo), middle=_name8(mid), sector=sec))
    lines = []
    for i in range(0, len(l["LINEDEFS"]), 14):
        v1, v2, flags, special, tag, right, left = struct.unpack_from("<HHhhhHH", l["LINEDEFS"], i)
        lines.append(dict(v1=v1, v2=v2, special=special, right=right, left=None if left == 0xFFFF else left))
    things = []
    for i in range(0, len(l["THINGS"]), 10):
        x, y, angle, kind, flags = struct.unpack_from("<hhhhh", l["THINGS"], i)
        things.append(dict(x=x, y=y, angle=angle, type=kind, flags=flags))
    return verts, sectors, sides, lines, things


def _sector_at(x: float, y: float, verts, lines, sides, sector: int) -> bool:
    odd = False
    for ln in lines:
        f = sides[ln["right"]]["sector"]
        b = sides[ln["left"]]["sector"] if ln["left"] is not None else None
        if f == b or sector not in (f, b):
            continue
        (ax, ay), (bx, by) = verts[ln["v1"]], verts[ln["v2"]]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            odd = not odd
    return odd


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


def _zones(n_sectors: int, pairs: list[tuple[int, int]], doors: set[int], bbox) -> list[int]:
    """Spec §6.5: sectors joined by lines that touch no door; a door joins its first neighbour;
    a zone whose box is over ZONE_SPLIT_M2 splits at the median along its longer axis."""
    u = _Union(n_sectors)
    for a, b in pairs:
        if a not in doors and b not in doors:
            u.join(a, b)
    for d in sorted(doors):
        nb = sorted({b if a == d else a for a, b in pairs if d in (a, b) and a != b})
        if nb:
            u.join(d, nb[0])
    groups: dict[int, list[int]] = {}
    for s in range(n_sectors):
        groups.setdefault(u.find(s), []).append(s)

    def split(group: list[int]) -> list[list[int]]:
        x0 = min(bbox[s][0] for s in group); x1 = max(bbox[s][2] for s in group)
        z0 = min(bbox[s][1] for s in group); z1 = max(bbox[s][3] for s in group)
        if len(group) < 2 or (x1 - x0) * (z1 - z0) <= ZONE_SPLIT_M2:
            return [group]
        axis = 0 if x1 - x0 >= z1 - z0 else 1
        centre = lambda s: (bbox[s][axis] + bbox[s][axis + 2]) / 2  # noqa: E731
        ordered = sorted(group, key=centre)
        mid = len(ordered) // 2
        return split(ordered[:mid]) + split(ordered[mid:])

    zone_of = [0] * n_sectors
    zone = 0
    for root in sorted(groups, key=lambda r: min(groups[r])):
        for part in split(groups[root]):
            for s in part:
                zone_of[s] = zone
            zone += 1
    return zone_of


def convert(wad_path: Path, map_name: str, units_per_m: float = 32) -> dict:
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

    # Door sectors (a manual door's back side) and their open height.
    pairs = []
    for ln in lines:
        if ln["left"] is not None:
            pairs.append((sides[ln["right"]]["sector"], sides[ln["left"]]["sector"]))
    doors = {sides[ln["left"]]["sector"] for ln in lines if ln["special"] in DOOR_SPECIALS and ln["left"] is not None}
    # Doom quirk: sectors opened remotely (tagged doors, ceiling == floor) are shut. Open them the same way,
    # or the format's "ceil above floor" rule rejects the map.
    doors |= {i for i, s in enumerate(sectors) if s["ceil"] <= s["floor"]}
    ceil = {i: s["ceil"] for i, s in enumerate(sectors)}
    for d in doors:
        nb = [b if a == d else a for a, b in pairs if d in (a, b) and a != b]
        if nb:
            ceil[d] = min(sectors[n]["ceil"] for n in nb) - DOOR_OPEN_GAP_UNITS

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

    bbox = {}
    for i in range(len(sectors)):
        pts = [verts[v] for ln in lines for v in (ln["v1"], ln["v2"])
               if i in (sides[ln["right"]]["sector"], sides[ln["left"]]["sector"] if ln["left"] is not None else None)]
        xs = [X(p[0]) for p in pts] or [0.0]
        zs = [Z(p[1]) for p in pts] or [0.0]
        bbox[i] = (min(xs), min(zs), max(xs), max(zs))
    zone_of = _zones(len(sectors), pairs, doors, bbox)

    out_sectors = []
    for i, s in enumerate(sectors):
        special, hurt = sector_special(s["special"])
        floor_mat = material_for_flat(s["floor_tex"])
        wall_tex = max(faces.get(i, {"-": 1}).items(), key=lambda kv: kv[1])[0]
        sec = {
            "floor": H(s["floor"]), "ceil": H(ceil[i]), "light": round(max(0, min(255, s["light"])) / 255, 3),
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
    dropped = 0
    for ln in lines:
        if verts[ln["v1"]] == verts[ln["v2"]]:      # the parser rejects zero-length lines
            dropped += 1
            continue
        rec = {"v": [ln["v1"], ln["v2"]], "front": sides[ln["right"]]["sector"]}
        if ln["left"] is not None:
            rec["back"] = sides[ln["left"]]["sector"]
            if ln["special"] in DOOR_SPECIALS:
                rec["door"] = {"sector": rec["back"]}
        if ln["special"] in EXIT_SPECIALS:
            rec["exit"] = True
        out_lines.append(rec)

    # One soft fill light per zone, at the middle of its biggest sector, 0.4 m under the ceiling.
    lights = []
    for zone in sorted(set(zone_of)):
        members = [i for i in range(len(sectors)) if zone_of[i] == zone]
        big = max(members, key=lambda i: (bbox[i][2] - bbox[i][0]) * (bbox[i][3] - bbox[i][1]))
        cx, cz = (bbox[big][0] + bbox[big][2]) / 2, (bbox[big][1] + bbox[big][3]) / 2
        f, c = out_sectors[big]["floor"], out_sectors[big]["ceil"]
        mean = sum(out_sectors[i]["light"] for i in members) / len(members)
        lights.append({"pos": [round(cx, 3), round(max(f + 1.5, c - 0.4), 3), round(cz, 3)],
                       "color": [1.0, 0.92, 0.82], "power": round(3 + 9 * mean, 2), "fixture": "none"})

    return {
        "version": 1, "id": f"doom-{map_name.lower()}", "name": f"Doom {map_name.upper()} (dev placeholder)",
        "geometry": "sectors", "ammo": "infinite", "loadout": ["melee", "shotgun", "dynamite", "flare"],
        "vertices": [[X(x), Z(y)] for x, y in verts],
        "sectors": out_sectors, "lines": out_lines,
        "start": {"pos": [0.0, 0.0, 0.0], "yaw": round(math.radians(90 - start["angle"]), 6)},
        "lights": lights,
        "_dropped_zero_length_lines": dropped,
    }


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
    for i, li in enumerate(level["lights"]):
        parts.append(f'<text x="{li["pos"][0] * s}" y="{li["pos"][2] * s}" fill="#fc6" font-size="10">z{i}</text>')
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
    a = ap.parse_args()
    level = convert(a.wad, a.map, a.units_per_m)
    path = a.out / f"{level['id']}.level.json"
    dropped = level.pop("_dropped_zero_length_lines")
    path.write_text(json.dumps(level, indent=1))
    zones = len({s["zone"] for s in level["sectors"]})
    doors = sum(1 for ln in level["lines"] if "door" in ln)
    print(f"{path}: {len(level['sectors'])} sectors, {len(level['lines'])} lines, {zones} zones, {doors} door lines"
          + (f", dropped {dropped} zero-length lines" if dropped else ""))
    if a.svg:
        write_svg(level, a.svg / f"{a.map.upper()}.svg")
        print(f"plan: {a.svg / (a.map.upper() + '.svg')}")


if __name__ == "__main__":
    main()
