#!/usr/bin/env python3
"""Is a converted sector level walkable from its start to its exit?

    python3 scripts/levels/doom_route.py public/assets/levels/doom-map28.level.json

Floods the sector graph by the game's own rules (sector-def.ts: step, headroom, body width), door entities taken
as open, one way down a drop. Reads only the level file. Prints what is reached, what stops the flood and whether
an exit trigger's sector is among the reached. Exits 1 if the exit is not reached. A coarse check: sector to sector,
so a line wide enough over a sector the body cannot cross still counts.

Locks count: a door with a `key` stays shut until a key pickup of that colour is reached, a `sealed` door until a
reached sector holds a switch firing its `opensOn` (the switch's line borders the sector: a shot from that sector). So
a key behind its own lock, or a switch behind the door it opens, reads as the exit not reached. Every door taken as
open is the `open_doors` result, for what the locks cost. A closet (`closets`, 2026-11-08) waits for its `opensOn` like a
sealed door; a trigger box (a walk-over line's) gives its event to the sector under its centre.

Lifts count: a lift sector stands at its `top`, and a body within a step of its low position can ride it up.

The exit verdict is a play-through, not the flood: every (sector, things held) state a player can get to, so a key below
a one-way drop with no way back to its door reads as not reached. `dead_ends` lists the places a player can get stuck for
good: states with no way on to the exit from there.
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


def flood(level: dict, locks: bool = True) -> dict:
    vs, lines = level["vertices"], level["lines"]
    lifts = {x["sector"]: x for x in level.get("lifts", [])}
    low = {s: level["sectors"][s]["floor"] for s in lifts}
    secs = [dict(s, floor=lifts[i]["top"]) if i in lifts else s for i, s in enumerate(level["sectors"])]
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
    # The locks: door sector -> what it waits for; what each sector gives when reached.
    waits = {}
    for d in level.get("doors", []) if locks else []:
        if d.get("key"):
            waits[d["sector"]] = f"key-{d['key']}"
        elif d.get("sealed"):
            waits[d["sector"]] = d["opensOn"]
    for c in level.get("closets", []) if locks else []:
        waits[c["sector"]] = c["opensOn"]
    gives: dict[int, list[str]] = {}
    for p in level.get("pickups", []):
        if p["item"].startswith("key-"):
            gives.setdefault(sector_of((p["pos"][0], p["pos"][2]), segs), []).append(p["item"])
    for sw in level.get("switches", []):
        gives.setdefault(lines[sw["line"]]["front"], []).append(sw["event"])
    for t in level.get("triggers", []):
        if t.get("event") != "level.end":
            gives.setdefault(sector_of(((t["min"][0] + t["max"][0]) / 2, (t["min"][2] + t["max"][2]) / 2), segs), []).append(t["event"])
    have: set[str] = set()
    order: list[str] = []
    waiting: list[int] = []

    def walkable(n: int, o: int, w: float) -> bool:
        opening = min(secs[n]["ceil"], secs[o]["ceil"]) - max(secs[n]["floor"], secs[o]["floor"])
        rides = o in lifts and low[o] - secs[n]["floor"] <= SECTOR_STEP_M
        return (rides or secs[o]["floor"] - secs[n]["floor"] <= SECTOR_STEP_M) and (rides or opening >= SECTOR_HEADROOM_M) and w >= BODY_WIDTH_M

    def reach(n: int) -> None:
        """What sector n gives; a door that was waiting for it joins the flood from the sectors beside it."""
        for g in gives.get(n, []):
            if g not in have:
                have.add(g)
                order.append(f"{g} in s{n}")
        for d in [d for d in waiting if waits[d] in have]:
            waiting.remove(d)
            del waits[d]
            stack.extend(s for s in seen if any(o == d for o, _, _ in edges.get(s, [])))
    reach(start)
    while stack:
        n = stack.pop()
        for o, i, w in edges.get(n, []):
            if o in seen:
                continue
            if o in waits:
                if waits[o] not in have:
                    if o not in waiting:
                        waiting.append(o)
                    continue
            if not walkable(n, o, w):
                up = secs[o]["floor"] - secs[n]["floor"]
                opening = min(secs[n]["ceil"], secs[o]["ceil"]) - max(secs[n]["floor"], secs[o]["floor"])
                blocked.append((n, o, i, round(up, 2), round(opening, 2), round(w, 2)))
                continue
            seen.add(o)
            stack.append(o)
            reach(o)
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
    # The play-through: (sector, what is held) states. Locks are the file's, not the flood's running copy.
    locked = {}
    for d in level.get("doors", []) if locks else []:
        if d.get("key"):
            locked[d["sector"]] = f"key-{d['key']}"
        elif d.get("sealed"):
            locked[d["sector"]] = d["opensOn"]
    for c in level.get("closets", []) if locks else []:
        locked[c["sector"]] = c["opensOn"]
    first = (start, frozenset(gives.get(start, [])))
    states, order_q = {first}, [first]
    succ: dict = {}
    while order_q:
        st = order_q.pop()
        n, held = st
        succ[st] = []
        for o, _, w in edges.get(n, []):
            if (o in locked and locked[o] not in held) or not walkable(n, o, w):
                continue
            nxt = (o, held | frozenset(gives.get(o, [])))
            succ[st].append(nxt)
            if nxt not in states:
                states.add(nxt)
                order_q.append(nxt)
    good = {st for st in states if st[0] in exits}
    grew = True
    while grew:
        grew = False
        for st in states - good:
            if any(x in good for x in succ[st]):
                good.add(st)
                grew = True
    dead = sorted({(n, tuple(sorted(h))) for n, h in states - good})
    place = lambda items: sum(1 for it in items if sector_of((it["pos"][0], it["pos"][2]), segs) in seen)  # noqa: E731
    return {"start": start, "reached": sorted(seen), "unlocked": order, "still_locked": sorted(d for d, w in waits.items() if w not in have), "blocked": [b for b in blocked if b[1] not in seen], "exits": exits,
            "exit_reached": first in good, "dead_ends": dead, "soft_locks": sorted(seen - back), "spawns": (place(level.get("spawns", [])), len(level.get("spawns", []))),
            "pickups": (place(level.get("pickups", [])), len(level.get("pickups", [])))}


def main() -> None:
    level = json.loads(Path(sys.argv[1]).read_text())
    r = flood(level)
    print(f"start s{r['start']}; reached {len(r['reached'])} of {len(level['sectors'])} sectors; spawns {r['spawns'][0]}/{r['spawns'][1]}, pickups {r['pickups'][0]}/{r['pickups'][1]} in reach")
    print(f"unreached: {sorted(set(range(len(level['sectors']))) - set(r['reached']))}")
    for n, o, i, up, opening, w in sorted(r["blocked"], key=lambda b: (b[1], b[0])):
        print(f"  s{n} -> s{o} line {i}: up {up} m, opening {opening} m, width {w} m")
    print(f"unlocked in order: {r['unlocked']}; doors still locked: {r['still_locked']}")
    print(f"with every door open: reached {len(flood(level, locks=False)['reached'])} sectors")
    print(f"dead ends (sector, held; no way on to the exit): {len(r['dead_ends'])} {r['dead_ends'][:8]}")
    print(f"soft locks (reached, no way on to the exit): {r['soft_locks']}")
    print(f"exit sectors {sorted(set(r['exits']))}: {'REACHED' if r['exit_reached'] else 'NOT reached'}")
    sys.exit(0 if r["exit_reached"] else 1)


if __name__ == "__main__":
    main()
