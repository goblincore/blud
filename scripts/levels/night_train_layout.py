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
         gates=[]),
    dict(rid=3, name="dining-car", w=4.2, L=18.0, h=3.0,
         walls=[(-2.1, -2.0, 15.4, 15.4 + T), (-0.6, 2.1, 15.4, 15.4 + T)],   # saloon | galley, door west
         areas=[("saloon (tables)", -2.1, 2.1, 0, 9.6), ("buffet lounge", -2.1, 2.1, 9.6, 15.4),
                ("galley", -2.1, 2.1, 15.5, 18.0)],
         props=[*[(f"table", -2.1, -1.4, u - 0.9, u + 0.9, 0.95) for u in (1.45, 3.35, 5.25, 7.15, 9.05)],
                *[(f"table", 1.4, 2.1, u - 0.9, u + 0.9, 0.95) for u in (1.45, 3.35, 5.25, 7.15, 9.05)],
                ("buffet island", -0.6, 0.6, 11.0, 14.2, 1.0),
                ("stoves", 1.3, 2.1, 15.7, 17.6, 1.0), ("counter", -2.1, -1.6, 16.6, 17.8, 1.0)],
         spawns=[("waiter-1", "zombie", -1.1, 3.4), ("waiter-2", "zombie", 1.1, 7.2),
                 ("cultist-island", "cultist", 0.0, 15.0), ("cultist-lounge", "cultist", -1.4, 13.0),
                 ("cook", "zombie", 0.3, 16.8)],
         pickups=[("galley-health", "health", -1.85, 17.2), ("galley-shells", "shells", 1.7, 17.2)],
         gates=[]),
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
                 ("cultist-c4", "cultist", 0.2, 12.0), ("lobby-1", "zombie", -1.0, 17.2), ("lobby-2", "zombie", 1.0, 17.2)],
         pickups=[("c2-shells", "shells", 1.5, 6.0), ("new-weapon", "dynamite", 1.5, 9.0)],
         gates=[("c5-door", "never", -0.6, -0.5, 14.28, 15.68)]),
    dict(rid=5, name="party-carriage", w=4.2, L=20.0, h=3.4,
         walls=[],
         areas=[("dance floor", -2.1, 2.1, 0, 20.0)],
         props=[("favours", -2.1, -1.4, 2.0, 3.6, 0.76), ("favours", -2.1, -1.4, 4.5, 6.1, 0.76),
                ("pillar", -0.15, 0.15, 7.0, 7.3, 3.4), ("pillar", -0.15, 0.15, 12.7, 13.0, 3.4),
                ("bar", 1.5, 2.1, 11.5, 17.5, 1.1), ("jukebox", -2.1, -1.3, 18.9, 19.5, 1.5)],
         spawns=[*[(f"dancer-{i}", "zombie", x, u) for i, (x, u) in enumerate(
                     ((-1.0, 8.5), (0.8, 8.8), (-0.6, 10.0), (1.0, 10.4), (-1.2, 11.4), (0.4, 11.8), (-0.3, 14.5), (0.9, 15.2)), 1)],
                 ("cultist-bar-1", "cultist", 1.1, 13.0), ("cultist-bar-2", "cultist", 1.1, 16.5)],
         pickups=[("favour-dynamite", "dynamite", -1.75, 3.0), ("bar-health", "health", 1.8, 17.8), ("jukebox-cd", "cd", -1.7, 19.2)],
         gates=[]),
    dict(rid=8, name="cab", w=3.0, L=8.0, h=2.6,
         walls=[],
         areas=[("cab: the Stoker at the firebox", -1.5, 1.5, 0, 8.0)],
         props=[("backhead", -1.5, 1.5, 7.6, 8.0, 2.4)],
         spawns=[], pickups=[], gates=[]),
]


def placed():
    """Each carriage with its south end z (game space; carriages run toward -z)."""
    z = 0.0
    out = []
    for c in CARRIAGES:
        out.append((c, z))
        z -= c["L"] + VESTIBULE
    return out


def to_level() -> dict:
    doc = {"version": 1, "id": "night-train", "name": "Night Train", "ammo": "finite", "loadout": ["melee"],
           "rooms": [], "tunnels": [], "furniture": [], "solids": [], "gates": [], "spawns": [], "pickups": []}
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
        for pid, item, x, u in c["pickups"]:
            doc["pickups"].append({"id": pid, "item": item, "pos": [x, 0.3, g(u)]})
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
            cult = kind == "cultist"
            col = "#e0a020" if cult else "#d03030"
            o.append(f'<circle cx="{X(u):.1f}" cy="{Y(x):.1f}" r="7" fill="{col}"/>'
                     + text(u, x + 0.1, "C" if cult else "Z", "#fff", 10, "middle", "bold"))
        for pid, item, x, u in c["pickups"]:
            o.append(f'<rect x="{X(u) - 5:.1f}" y="{Y(x) - 5:.1f}" width="10" height="10" fill="#40c0e0" transform="rotate(45 {X(u):.1f} {Y(x):.1f})"/>'
                     + text(u + 0.2, x - 0.2, item, "#7fd8ee", 9))
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
             '<tspan fill="#d03030">● Z zombie</tspan>   <tspan fill="#e0a020">● C cultist</tspan>   '
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
