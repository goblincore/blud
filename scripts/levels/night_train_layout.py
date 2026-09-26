#!/usr/bin/env python3
"""Night Train's first-slice layout tables (docs/game/levels/01-night-train/layout.md).

    python3 scripts/levels/night_train_layout.py --json .lab-tmp/night-train-layout.level.json --svg .lab-tmp/night-train-layout.svg

The tables are the plan of record until the .blend exists (level design guide §5). Each
carriage is described in its OWN frame: x across (-w/2 west .. +w/2 east), u along from its
south end (0) to its north end (L); the player walks north. `--json` writes a Level Format v1
file (one room per carriage, thin partitions as solids, props as furniture, spawns, pickups)
for the level tests and scripts/levels/level_plan.py; `--svg` draws every carriage as its own
strip, north to the right, for review.

The locked compartment is a gate that never opens in v1.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

VESTIBULE = 1.2
T = 0.1  # internal partition thickness

# Each carriage: rid, name, width, length, height, then lists in the carriage frame.
#   walls:   (x0, x1, u0, u1)            thin partitions (collision + art)
#   areas:   (label, x0, x1, u0, u1)     named sub-rooms, for the drawing and the doc
#   props:   (label, x0, x1, u0, u1, h)  furniture (collision boxes)
#   spawns:  (id, kind, x, u)
#   pickups: (id, item, x, u)
#   gates:   (id, event, x0, x1, u0, u1)
#   pickups may add a height: (id, item, x, u, y)
#   moods:    one per ceiling lamp, south to north (lamp-moods.ts; dynamic light spec §3)
#   fires:    (id, x, u, y, power)       orange fire lights (stoves, boilers, the firebox)
#   triggers: (id, event, x0, x1, u0, u1) once, floor to 2.2 m
FIRE = (1.0, 0.42, 0.12)
# When `on` fires, the level also fires `emit` (dynamic light spec §3).
CUES = [("pickup.flashlight", ["light.die.room.6", "alert.room.6"])]
# The level ends at the firebox (the Stoker comes later); the CD is a collectible.
COMPLETE_ON = "level.end"
CARRIAGES = [
    dict(rid=1, name="guards-van", w=3.6, L=16.0, h=2.8,
         walls=[(-1.8, -1.7, 5.5, 5.5 + T), (-0.3, 1.8, 5.5, 5.5 + T),        # hold | cage, door west
                (-1.8, 0.3, 10.5, 10.5 + T), (1.7, 1.8, 10.5, 10.5 + T)],      # cage | office, door east
         areas=[("baggage hold", -1.8, 1.8, 0, 5.5), ("mail cage", -1.8, 1.8, 5.6, 10.5),
                ("guard's office", -1.8, 1.8, 10.6, 16.0)],
         props=[("trunks", -1.8, -1.0, 1.0, 2.4, 1.0), ("trunks", 1.0, 1.8, 2.2, 3.6, 1.0),
                ("big trunk", 0.5, 1.6, 4.0, 4.9, 0.7),
                ("coffin", -1.6, -0.9, 7.2, 9.2, 0.5), ("coffin", 0.9, 1.6, 6.0, 8.0, 0.5),
                ("desk", -1.8, -1.0, 12.0, 13.6, 0.8), ("stove", 1.2, 1.8, 14.8, 15.6, 1.2)],
         spawns=[("van-trunk", "zombie", 1.05, 4.45), ("van-coffin-w", "zombie", -1.25, 8.2),
                 ("van-coffin-e", "zombie", 1.25, 7.0), ("van-guard", "zombie", 0.6, 13.8)],
         pickups=[("sawn-off", "shotgun", 1.4, 2.9), ("van-shells", "shells", -1.4, 12.8),
                  ("van-health", "health", -1.4, 13.3)],
         gates=[], moods=["flicker", "stutter"], fires=[("office-stove", 1.1, 15.2, 0.5, 0.8)], triggers=[]),
    dict(rid=2, name="third-class", w=3.8, L=18.0, h=2.8,
         walls=[],
         areas=[("third class: benches both sides of a 1.5 m aisle", -1.9, 1.9, 0, 18.0)],
         props=[*[("bench", x0, x1, u - 0.225, u + 0.225, 0.95) for u in (1.5, 3.3, 5.1, 6.9, 8.7, 10.5, 12.3, 14.1, 15.9)
                  for x0, x1 in ((-1.9, -0.75), (0.75, 1.9))]],
         spawns=[("third-slumped-1", "zombie", -1.3, 2.4), ("third-slumped-2", "zombie", 1.3, 7.8),
                 ("third-aisle", "zombie", 0.0, 11.4), ("third-slumped-3", "zombie", -1.3, 13.2),
                 ("third-soldier", "soldier", 0.0, 17.0)],
         pickups=[("third-shells", "shells", 1.3, 9.6), ("third-health", "health", -1.3, 15.0)],
         gates=[], moods=["stutter", "flicker"], fires=[], triggers=[]),
    dict(rid=3, name="dining-car", w=4.2, L=18.0, h=3.0,
         walls=[(-2.1, -2.0, 15.4, 15.4 + T), (-0.6, 2.1, 15.4, 15.4 + T)],   # saloon | galley, door west
         areas=[("saloon (tables)", -2.1, 2.1, 0, 9.6), ("buffet lounge", -2.1, 2.1, 9.6, 15.4),
                ("galley", -2.1, 2.1, 15.5, 18.0)],
         props=[*[(f"table", -2.1, -1.4, u - 0.9, u + 0.9, 0.95) for u in (1.45, 3.35, 5.25, 7.15, 9.05)],
                *[(f"table", 1.4, 2.1, u - 0.9, u + 0.9, 0.95) for u in (1.45, 3.35, 5.25, 7.15, 9.05)],
                ("buffet island", -0.6, 0.6, 11.0, 14.2, 1.0),
                ("stoves", 1.3, 2.1, 15.7, 17.6, 1.0), ("counter", -2.1, -1.6, 16.6, 17.8, 1.0)],
         spawns=[("waiter-1", "zombie", -1.1, 3.4), ("waiter-2", "zombie", 1.1, 7.2),
                 ("soldier-island", "soldier", 0.0, 15.0), ("soldier-lounge", "soldier", -1.4, 13.0),
                 ("cook", "zombie", 0.3, 16.8)],
         pickups=[("galley-health", "health", -1.85, 17.2), ("galley-shells", "shells", 1.7, 17.2)],
         gates=[], moods=["flicker", "dead"], fires=[("galley-stoves", 1.2, 16.6, 0.6, 0.8)], triggers=[]),
    dict(rid=6, name="coat-check", w=3.8, L=14.0, h=2.8,
         walls=[],
         areas=[("coat racks: a serpentine", -1.9, 1.9, 0, 9.0), ("attendant's counter", -1.9, 1.9, 9.0, 14.0)],
         props=[("coat rack", -1.9, 0.5, 2.8, 3.2, 1.8), ("coat rack", -0.5, 1.9, 5.3, 5.7, 1.8),
                ("coat rack", -1.9, 0.5, 7.8, 8.2, 1.8), ("attendant counter", -1.9, 0.5, 10.4, 10.9, 1.0)],
         spawns=[("coats-1", "zombie", 1.2, 4.2), ("coats-2", "zombie", -1.2, 6.8), ("coats-3", "zombie", 1.2, 9.3)],
         pickups=[("torch", "flashlight", -1.2, 12.4, 1.4), ("coat-shells", "shells", 1.4, 12.8)],
         gates=[], moods=["dead", "dying"], fires=[], triggers=[]),
    dict(rid=4, name="sleeper", w=4.0, L=18.0, h=2.8,
         walls=[(-0.6, 2.0, 1.6, 1.6 + T), (-0.6, 2.0, 16.3, 16.3 + T),       # lobbies | compartments
                *[(-0.5, 2.0, u, u + T) for u in (4.56, 7.52, 10.48, 13.44)],  # between compartments
                # the corridor wall, with a 1.4 m door into each compartment
                *[(-0.6, -0.5, a, b) for a, b in ((1.6, 2.44), (3.84, 5.4), (6.8, 8.36), (9.76, 11.32), (12.72, 14.28), (15.68, 16.4))]],
         areas=[("south lobby", -2.0, 2.0, 0, 1.6), ("corridor", -2.0, -0.6, 1.7, 16.3),
                ("C1", -0.5, 2.0, 1.7, 4.56), ("C2", -0.5, 2.0, 4.66, 7.52), ("C3", -0.5, 2.0, 7.62, 10.48),
                ("C4", -0.5, 2.0, 10.58, 13.44), ("C5", -0.5, 2.0, 13.54, 16.3), ("north lobby", -2.0, 2.0, 16.4, 18.0)],
         props=[*[("bunk", 1.2, 2.0, a + 0.1, b - 0.1, 0.6) for a, b in ((1.7, 4.56), (4.66, 7.52), (7.62, 10.48), (10.58, 13.44))]],
         spawns=[("c1-sleeper", "zombie", 0.6, 3.1), ("c3-sleeper", "zombie", 0.6, 9.0),
                 ("soldier-c4", "soldier", 0.2, 12.0), ("lobby-1", "zombie", -1.0, 17.2), ("lobby-2", "zombie", 1.0, 17.2)],
         pickups=[("c2-shells", "shells", 1.5, 6.0), ("new-weapon", "dynamite", 1.5, 9.0)],
         gates=[("c5-door", "never", -0.6, -0.5, 14.28, 15.68)],
         moods=["dying", "stutter"], fires=[("sleeper-boiler", 1.4, 0.6, 0.6, 1.0)],
         triggers=[("blackout", "light.blackout.room.4", -2.0, -0.6, 8.6, 9.4)]),
    dict(rid=5, name="boiler-room", w=4.2, L=20.0, h=3.4,
         walls=[],
         areas=[("the Boiler Room: dance floor under the disco ball, steam vents", -2.1, 2.1, 0, 17.0),
                ("DJ deck", -2.1, 2.1, 17.0, 20.0)],
         props=[("favours", -2.1, -1.4, 2.0, 3.6, 0.76), ("favours", -2.1, -1.4, 4.5, 6.1, 0.76),
                ("pillar", -0.15, 0.15, 7.0, 7.3, 3.4), ("pillar", -0.15, 0.15, 12.7, 13.0, 3.4),
                ("bar", 1.5, 2.1, 11.5, 16.5, 1.1),
                ("piston", -2.1, -1.4, 13.8, 14.6, 3.4), ("piston", -2.1, -1.4, 15.8, 16.6, 3.4),
                ("dj deck", -2.1, -1.3, 17.4, 19.2, 1.1)],
         spawns=[*[(f"dancer-{i}", "zombie", x, u) for i, (x, u) in enumerate(((-0.6, 8.6), (0.8, 9.0), (-0.4, 10.6), (0.9, 11.2)), 1)],
                 ("soldier-bar-1", "soldier", 1.0, 12.4), ("soldier-dj", "soldier", -0.8, 18.3)],
         pickups=[("favour-dynamite", "dynamite", -1.75, 3.0), ("bar-health", "health", 1.1, 17.0), ("dj-cd", "cd", -1.7, 19.6)],
         gates=[], moods=["steady", "steady"], fires=[("party-boiler", 1.5, 0.7, 0.6, 1.0)],
         triggers=[("strobe", "light.strobe.room.5", -2.1, 2.1, 5.5, 6.5)]),
    dict(rid=7, name="tender", w=3.4, L=10.0, h=2.6,
         walls=[],
         areas=[("tender: the coal bunker (west), a walkway (east)", -1.7, 1.7, 0, 10.0)],
         props=[("coal", -1.7, -0.2, 1.6, 8.4, 1.2)],
         spawns=[("coal-1", "zombie", 0.9, 3.5), ("coal-2", "zombie", 0.9, 7.0)],
         pickups=[("tender-health", "health", 1.2, 9.2)],
         gates=[], moods=["dying"], fires=[], triggers=[]),
    dict(rid=8, name="cab", w=3.0, L=8.0, h=2.6,
         walls=[],
         areas=[("cab: the Stoker at the firebox", -1.5, 1.5, 0, 8.0)],
         props=[("backhead", -1.5, 1.5, 7.6, 8.0, 2.4)],
         spawns=[], pickups=[], gates=[], moods=["steady"], fires=[("firebox", 0.0, 7.0, 1.0, 4.0)],
         triggers=[("end", COMPLETE_ON, -1.5, 1.5, 4.5, 6.5)]),
]


WARM = (1.0, 0.72, 0.45)
LIGHT_POWER = 1.1  # Doom 3 dark (owner, 2026-09-26): the lamps and the lightning carry the view


def lamps(c):
    """The ceiling lamps of a carriage, in its frame: ((x, y, u), mood), south to north."""
    n = max(1, round(c["L"] / 8))
    if len(c["moods"]) != n:
        raise SystemExit(f"{c['name']}: {n} lamps but {len(c['moods'])} moods")
    return [((0.0, c["h"] - 0.4, c["L"] * (i + 0.5) / n), c["moods"][i]) for i in range(n)]


def placed():
    """Each carriage with its south end z (game space; carriages run toward -z)."""
    z = 0.0
    out = []
    for c in CARRIAGES:
        out.append((c, z))
        z -= c["L"] + VESTIBULE
    return out


def to_level() -> dict:
    doc = {"version": 1, "id": "night-train", "name": "Night Train", "ammo": "finite", "loadout": ["melee"], "completeOn": COMPLETE_ON,
           "rooms": [], "tunnels": [], "furniture": [], "solids": [], "gates": [], "triggers": [], "lights": [],
           "spawns": [], "pickups": [], "cues": [{"on": on, "emit": list(emit)} for on, emit in CUES]}
    prev = None
    for c, zs in placed():
        w2 = c["w"] / 2
        g = lambda u: zs - u  # noqa: E731  (carriage u -> game z)
        doc["rooms"].append({"id": c["rid"], "name": c["name"], "min": [-w2, g(c["L"])], "max": [w2, zs],
                             "height": c["h"], "shell": "art"})
        if prev is not None:
            doc["tunnels"].append({"a": prev, "b": c["rid"], "min": [-0.7, zs], "max": [0.7, zs + VESTIBULE], "height": 2.1})
        prev = c["rid"]
        for x0, x1, u0, u1 in c["walls"]:
            doc["solids"].append({"min": [x0, 0, g(u1)], "max": [x1, c["h"], g(u0)]})
        for _, x0, x1, u0, u1, h in c["props"]:
            doc["furniture"].append({"min": [x0, 0, g(u1)], "max": [x1, h, g(u0)]})
        for sid, kind, x, u in c["spawns"]:
            doc["spawns"].append({"id": sid, "kind": kind, "pos": [x, 0, g(u)], "yaw": 3.1416})
        for pid, item, x, u, *y in c["pickups"]:
            doc["pickups"].append({"id": pid, "item": item, "pos": [x, y[0] if y else 0.3, g(u)]})
        for i, (pos, mood) in enumerate(lamps(c)):
            doc["lights"].append({"pos": [pos[0], pos[1], g(pos[2])], "color": list(WARM), "power": LIGHT_POWER, "mood": mood})
        for _, x, u, y, power in c["fires"]:
            doc["lights"].append({"pos": [x, y, g(u)], "color": list(FIRE), "power": power, "mood": "fire"})
        for tid, event, x0, x1, u0, u1 in c["triggers"]:
            doc["triggers"].append({"id": tid, "event": event, "once": True, "min": [x0, 0, g(u1)], "max": [x1, 2.2, g(u0)]})
        for gid, event, x0, x1, u0, u1 in c["gates"]:
            doc["gates"].append({"id": gid, "opensOn": event, "min": [x0, 0, g(u1)], "max": [x1, 2.2, g(u0)]})
    doc["start"] = {"pos": [0, 0, -1.0], "yaw": 0.0}
    return doc


def to_svg() -> str:
    """Every carriage as a horizontal strip, north (the way the player walks) to the right."""
    PX, PAD, GAP = 42.0, 1.2, 1.6
    maxL = max(c["L"] for c in CARRIAGES)
    rows = [(c, sum(cc["w"] + GAP for cc in CARRIAGES[:i])) for i, c in enumerate(CARRIAGES)]
    W = (maxL + 2 * PAD + 3.0) * PX
    H = (sum(c["w"] + GAP for c in CARRIAGES) + PAD) * PX
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" font-family="Helvetica,Arial,sans-serif">',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#16161a"/>']
    for c, y0 in rows:
        w2 = c["w"] / 2
        X = lambda u: (PAD + 3.0 + u) * PX  # noqa: E731
        Y = lambda x: (PAD + y0 + (x + w2)) * PX  # noqa: E731  (west at the top of the strip)

        def box(x0, x1, u0, u1, fill, stroke="none", sw=1.0, extra=""):
            return (f'<rect x="{X(u0):.1f}" y="{Y(x0):.1f}" width="{(u1 - u0) * PX:.1f}" height="{(x1 - x0) * PX:.1f}" '
                    f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')

        def text(u, x, s, color="#ddd", size=11, anchor="start", weight="normal"):
            return (f'<text x="{X(u):.1f}" y="{Y(x):.1f}" fill="{color}" font-size="{size}" '
                    f'text-anchor="{anchor}" font-weight="{weight}">{s}</text>')

        o.append(f'<text x="{PAD * PX:.0f}" y="{Y(0) + 4:.0f}" fill="#fff" font-size="13" font-weight="bold">{c["rid"]}</text>')
        o.append(text(0, -w2 - 0.35, f'{c["name"]} · {c["w"]:.1f} × {c["L"]:.0f} m · ceiling {c["h"]:.1f} m', "#fff", 13, weight="bold"))
        o.append(box(-w2, w2, 0, c["L"], "#2a2622", "#8a7a60", 2))
        for u in range(1, int(c["L"])):
            o.append(f'<line x1="{X(u):.1f}" y1="{Y(-w2):.1f}" x2="{X(u):.1f}" y2="{Y(w2):.1f}" stroke="#34302a" stroke-width="1"/>')
        for label, x0, x1, u0, u1, _ in c["props"]:
            o.append(box(x0, x1, u0, u1, "#5a4a36", "#8c7456", 1))
        for x0, x1, u0, u1 in c["walls"]:
            o.append(box(x0, x1, u0, u1, "#d8c8a8"))
        for gid, _, x0, x1, u0, u1 in c["gates"]:
            o.append(box(x0 - 0.05, x1 + 0.05, u0, u1, "#e08030") + text((u0 + u1) / 2, x1 + 0.45, "locked", "#e08030", 10, "middle"))
        for sid, kind, x, u in c["spawns"]:
            sol = kind == "soldier"
            col = "#e0a020" if sol else "#d03030"
            o.append(f'<circle cx="{X(u):.1f}" cy="{Y(x):.1f}" r="7" fill="{col}"/>'
                     + text(u, x + 0.1, "S" if sol else "Z", "#fff", 10, "middle", "bold"))
        for tid, event, x0, x1, u0, u1 in c["triggers"]:
            o.append(box(x0, x1, u0, u1, "none", "#f0e040", 1.5, 'stroke-dasharray="4 3"')
                     + text((u0 + u1) / 2, x1 - 0.15, event, "#f0e040", 9, "middle"))
        for (lx, _, lu), mood in lamps(c):
            o.append(f'<circle cx="{X(lu):.1f}" cy="{Y(lx):.1f}" r="4" fill="none" stroke="#ffd080" stroke-width="1.5"/>'
                     + text(lu, lx + 0.45, mood, "#ffd080", 9, "middle"))
        for _, fx, fu, _, _ in c["fires"]:
            o.append(f'<circle cx="{X(fu):.1f}" cy="{Y(fx):.1f}" r="4" fill="#ff7020"/>')
        for pid, item, x, u, *_ in c["pickups"]:
            torch = item == "flashlight"
            o.append(f'<rect x="{X(u) - 5:.1f}" y="{Y(x) - 5:.1f}" width="10" height="10" fill="{"#fff060" if torch else "#40c0e0"}" transform="rotate(45 {X(u):.1f} {Y(x):.1f})"/>'
                     + text(u + 0.2, x - 0.2, "FLASHLIGHT" if torch else item, "#fff060" if torch else "#7fd8ee", 11 if torch else 9, weight="bold" if torch else "normal"))
        for label, x0, x1, u0, u1 in c["areas"]:  # last, so furniture never hides them
            o.append(f'<text x="{X(u0 + 0.15):.1f}" y="{Y(x0 + 0.35):.1f}" fill="#e8d8b8" font-size="11" '
                     f'stroke="#16161a" stroke-width="3" paint-order="stroke">{label}</text>')
        # doors in and out (the vestibules), centred
        for u in ((0.0,) if c is CARRIAGES[-1] else (0.0, c["L"])):  # nothing beyond the engine
            o.append(box(-0.7, 0.7, u - 0.06, u + 0.06, "#50b050"))
        if c["rid"] == 1:
            o.append(f'<polygon points="{X(1.0) - 8:.1f},{Y(0) - 7:.1f} {X(1.0) + 9:.1f},{Y(0):.1f} {X(1.0) - 8:.1f},{Y(0) + 7:.1f}" fill="#60e060"/>'
                     + text(1.0, 0.55, "start (portal)", "#60e060", 10, "middle"))
    ly = H - PAD * PX * 0.35
    o.append(f'<text x="{PAD * PX:.0f}" y="{ly:.0f}" fill="#aaa" font-size="11">north (toward the engine) →   '
             '<tspan fill="#d03030">● Z zombie</tspan>   <tspan fill="#e0a020">● S soldier</tspan>   <tspan fill="#ffd080">○ lamp (mood)</tspan>   <tspan fill="#ff7020">● fire</tspan>   <tspan fill="#f0e040">▭ trigger</tspan>   '
             '<tspan fill="#40c0e0">◆ pickup</tspan>   <tspan fill="#d8c8a8">▬ partition</tspan>   '
             '<tspan fill="#8c7456">■ furniture</tspan>   <tspan fill="#50b050">▬ door to the vestibule</tspan>   1 m grid</text>')
    o.append("</svg>")
    return "\n".join(o)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--svg")
    a = ap.parse_args()
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(to_level(), indent=2) + "\n")
    if a.svg:
        Path(a.svg).parent.mkdir(parents=True, exist_ok=True)
        Path(a.svg).write_text(to_svg())


if __name__ == "__main__":
    main()
