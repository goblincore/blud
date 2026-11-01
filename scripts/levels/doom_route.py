#!/usr/bin/env python3
"""Is a converted sector level walkable from its start to its exit?

    python3 scripts/levels/doom_route.py public/assets/levels/doom-map28.level.json

Floods the sector graph by the game's own rules (sector-def.ts: step, headroom, body width), door entities taken
as open, one way down a drop. Reads only the level file. Prints what is reached, what stops the flood and whether
an exit trigger's sector is among the reached. Exits 1 if the exit is not reached. A coarse check: sector to sector,
so a line wide enough over a sector the body cannot cross still counts.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

SECTOR_STEP_M = 0.75
SECTOR_HEADROOM_M = 1.9
BODY_WIDTH_M = 0.68


def sector_of(p, segs_by_sector) -> int | None:
    for s, segs in enumerate(segs_by_sector):
        odd = False
        for (ax, az), (bx, bz) in segs:
            if (az > p[1]) != (bz > p[1]) and p[0] < ax + (p[1] - az) * (bx - ax) / (bz - az):
                odd = not odd
        if odd:
            return s
    return None


def flood(level: dict) -> dict:
    vs, secs, lines = level["vertices"], level["sectors"], level["lines"]
    segs: list[list] = [[] for _ in secs]
    edges: dict[int, list] = {}
    for i, ln in enumerate(lines):
        a, b = vs[ln["v"][0]], vs[ln["v"][1]]
        f, k = ln["front"], ln.get("back")
        if f == k:
            continue
        segs[f].append((a, b))
        if k is None:
            continue
        segs[k].append((a, b))
        w = math.hypot(b[0] - a[0], b[1] - a[1])
        edges.setdefault(f, []).append((k, i, w))
        edges.setdefault(k, []).append((f, i, w))
    start = sector_of((level["start"]["pos"][0], level["start"]["pos"][2]), segs)
    seen, stack, blocked = {start}, [start], []

    def walkable(n: int, o: int, w: float) -> bool:
        opening = min(secs[n]["ceil"], secs[o]["ceil"]) - max(secs[n]["floor"], secs[o]["floor"])
        return secs[o]["floor"] - secs[n]["floor"] <= SECTOR_STEP_M and opening >= SECTOR_HEADROOM_M and w >= BODY_WIDTH_M

    while stack:
        n = stack.pop()
        for o, i, w in edges.get(n, []):
            if o in seen:
                continue
            if not walkable(n, o, w):
                up = secs[o]["floor"] - secs[n]["floor"]
                opening = min(secs[n]["ceil"], secs[o]["ceil"]) - max(secs[n]["floor"], secs[o]["floor"])
                blocked.append((n, o, i, round(up, 2), round(opening, 2), round(w, 2)))
                continue
            seen.add(o)
            stack.append(o)
    exits = []
    for t in level.get("triggers", []):
        if t.get("event") == "level.end":
            exits.append(sector_of(((t["min"][0] + t["max"][0]) / 2, (t["min"][2] + t["max"][2]) / 2), segs))
    # Soft locks: reached sectors with no way on to an exit (a drop with no lift back up).
    back = {e for e in exits if e in seen}
    grew = True
    while grew:
        grew = False
        for n in seen - back:
            if any(o in back and walkable(n, o, w) for o, _, w in edges.get(n, [])):
                back.add(n)
                grew = True
    place = lambda items: sum(1 for it in items if sector_of((it["pos"][0], it["pos"][2]), segs) in seen)  # noqa: E731
    return {"start": start, "reached": sorted(seen), "blocked": [b for b in blocked if b[1] not in seen], "exits": exits,
            "exit_reached": any(e in seen for e in exits), "soft_locks": sorted(seen - back), "spawns": (place(level.get("spawns", [])), len(level.get("spawns", []))),
            "pickups": (place(level.get("pickups", [])), len(level.get("pickups", [])))}


def main() -> None:
    level = json.loads(Path(sys.argv[1]).read_text())
    r = flood(level)
    print(f"start s{r['start']}; reached {len(r['reached'])} of {len(level['sectors'])} sectors; spawns {r['spawns'][0]}/{r['spawns'][1]}, pickups {r['pickups'][0]}/{r['pickups'][1]} in reach")
    print(f"unreached: {sorted(set(range(len(level['sectors']))) - set(r['reached']))}")
    for n, o, i, up, opening, w in sorted(r["blocked"], key=lambda b: (b[1], b[0])):
        print(f"  s{n} -> s{o} line {i}: up {up} m, opening {opening} m, width {w} m")
    print(f"soft locks (reached, no way on to the exit): {r['soft_locks']}")
    print(f"exit sectors {sorted(set(r['exits']))}: {'REACHED' if r['exit_reached'] else 'NOT reached'}")
    sys.exit(0 if r["exit_reached"] else 1)


if __name__ == "__main__":
    main()
