#!/usr/bin/env python3
"""Draw a Level Format v1 file top-down as an SVG, for layout review.

    python3 scripts/levels/level_plan.py public/assets/levels/the-wake.level.json [--state quiet] [--out file.svg]

Default output: .lab-tmp/level-plans/<id>[.<state>].svg. Game space, looking
down: x to the right, -z (north, where the player heads) up. Grid lines every
metre, stronger every 5 m.

Drawn: rooms (labelled, open-sky rooms dashed), tunnels, furniture and solids,
gates (orange), triggers (dotted, labelled with their event), windows (cyan),
lights, the start (green arrow), spawns (red Z/S), graves (purple, wave
number), pickups (yellow, item), bells. With --state, elements tagged with
other states are dropped, as the game does (spec section 7).

Reads the JSON directly and does not validate it; run the level test for that.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

PX = 12.0  # SVG pixels per metre
PAD = 2.0  # metres of margin


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("level")
    ap.add_argument("--state")
    ap.add_argument("--out")
    a = ap.parse_args()
    L = json.loads(Path(a.level).read_text())

    def live(items):
        return [i for i in items or [] if not a.state or "states" not in i or a.state in i["states"]]

    rooms = live(L["rooms"])
    x0 = min(r["min"][0] for r in rooms) - PAD
    x1 = max(r["max"][0] for r in rooms) + PAD
    z0 = min(r["min"][1] for r in rooms) - PAD
    z1 = max(r["max"][1] for r in rooms) + PAD
    W, H = (x1 - x0) * PX, (z1 - z0) * PX

    def X(x):
        return (x - x0) * PX

    def Y(z):
        return (z - z0) * PX  # -z is up: smaller z draws higher

    def rect(mn, mx, style, title=""):
        # Boxes are [x,y,z]; rooms/tunnels are [x,z].
        ax, az = mn[0], mn[-1]
        bx, bz = mx[0], mx[-1]
        t = f"<title>{title}</title>" if title else ""
        return (f'<rect x="{X(ax):.1f}" y="{Y(az):.1f}" width="{(bx - ax) * PX:.1f}" '
                f'height="{(bz - az) * PX:.1f}" {style}>{t}</rect>')

    def label(x, z, text, color, size=10, dy=0):
        return f'<text x="{X(x):.1f}" y="{Y(z) + dy:.1f}" fill="{color}" font-size="{size}">{text}</text>'

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
         f'font-family="monospace"><rect width="100%" height="100%" fill="#101014"/>']
    for gx in range(math.ceil(x0), math.floor(x1) + 1):
        c = "#2a2a33" if gx % 5 == 0 else "#1a1a20"
        o.append(f'<line x1="{X(gx):.1f}" y1="0" x2="{X(gx):.1f}" y2="{H:.0f}" stroke="{c}"/>')
    for gz in range(math.ceil(z0), math.floor(z1) + 1):
        c = "#2a2a33" if gz % 5 == 0 else "#1a1a20"
        o.append(f'<line x1="0" y1="{Y(gz):.1f}" x2="{W:.0f}" y2="{Y(gz):.1f}" stroke="{c}"/>')

    for r in rooms:
        dash = ' stroke-dasharray="6 3"' if r.get("sky") else ""
        o.append(rect(r["min"], r["max"], f'fill="#2b2b36" stroke="#8a8aa0"{dash}',
                      f'room {r["id"]} {r["name"]}: height {r["height"]} m, floor {r.get("floor", 0)} m'))
        w = r["max"][0] - r["min"][0]
        d = r["max"][1] - r["min"][1]
        o.append(label(r["min"][0] + 0.3, r["min"][1] + 0.9,
                       f'{r["id"]} {r["name"]}  {w:g}x{d:g} h{r["height"]:g}', "#b8b8d0", 11))
    for t in live(L.get("tunnels")):
        o.append(rect(t["min"], t["max"], 'fill="#2b2b36" stroke="#6a6a80"',
                      f'tunnel {t["a"]}-{t["b"]}: width {min(t["max"][0] - t["min"][0], t["max"][1] - t["min"][1]):g} m'))
    for s in live(L.get("stairs")):
        o.append(rect(s["min"], s["max"], 'fill="#3a3a2a" stroke="#aa9"', f'stair {s["id"]} up {s["up"]}'))
    for b in live(L.get("furniture")) + live(L.get("solids")):
        o.append(rect(b["min"], b["max"], 'fill="#55556a" stroke="none"', f'box height {b["max"][1]:g} m'))
    for g in live(L.get("gates")):
        o.append(rect(g["min"], g["max"], 'fill="#d07a20"', f'gate {g["id"]} opens on {g["opensOn"]}'))
    for t in live(L.get("triggers")):
        o.append(rect(t["min"], t["max"], 'fill="none" stroke="#c8c850" stroke-dasharray="2 2"', f'trigger {t["id"]}'))
        o.append(label(t["min"][0], t["min"][2], t["event"], "#c8c850", 9, -2))
    for w in live(L.get("windows")):
        o.append(rect(w["min"], w["max"], 'fill="#40d0e0" stroke="#40d0e0" stroke-width="2"', f'window {w["id"]}: {w["view"]}'))
    for li in live(L.get("lights")):
        c = "#%02x%02x%02x" % tuple(int(255 * min(1.0, v)) for v in li["color"])
        o.append(f'<circle cx="{X(li["pos"][0]):.1f}" cy="{Y(li["pos"][2]):.1f}" r="{3 + li["power"] * 0.3:.1f}" '
                 f'fill="{c}" fill-opacity="0.35"/>')

    st = L["start"]
    sx, sz, yaw = st["pos"][0], st["pos"][2], st.get("yaw", 0.0)
    # forward = [sin yaw, 0, -cos yaw]
    fx, fz = sx + math.sin(yaw) * 1.5, sz - math.cos(yaw) * 1.5
    o.append(f'<line x1="{X(sx):.1f}" y1="{Y(sz):.1f}" x2="{X(fx):.1f}" y2="{Y(fz):.1f}" stroke="#40e040" stroke-width="3"/>'
             f'<circle cx="{X(sx):.1f}" cy="{Y(sz):.1f}" r="5" fill="#40e040"/>')
    for s in live(L.get("spawns")):
        ch = "Z" if s["kind"] == "zombie" else "S"
        o.append(f'<circle cx="{X(s["pos"][0]):.1f}" cy="{Y(s["pos"][2]):.1f}" r="5" fill="#d03030"><title>{s["id"]}</title></circle>'
                 + label(s["pos"][0], s["pos"][2], ch, "#fff", 8, 3).replace("<text ", '<text text-anchor="middle" '))
    for g in live(L.get("graves")):
        o.append(f'<rect x="{X(g["pos"][0]) - 4:.1f}" y="{Y(g["pos"][2]) - 6:.1f}" width="8" height="12" fill="#9050c0">'
                 f'<title>{g["id"]}</title></rect>' + label(g["pos"][0] + 0.5, g["pos"][2], str(g["wave"]), "#c090f0", 9))
    for p in live(L.get("pickups")):
        o.append(f'<circle cx="{X(p["pos"][0]):.1f}" cy="{Y(p["pos"][2]):.1f}" r="3.5" fill="#f0d030"><title>{p["id"]}</title></circle>'
                 + label(p["pos"][0] + 0.4, p["pos"][2], p["item"], "#f0d030", 9, 3))
    for b in live(L.get("bells")):
        o.append(f'<circle cx="{X(b["pos"][0]):.1f}" cy="{Y(b["pos"][2]):.1f}" r="{b.get("radius", 0.8) * PX:.1f}" '
                 f'fill="none" stroke="#e0b060" stroke-width="2"><title>bell {b["id"]}</title></circle>')
    o.append(label(x0 + 0.3, z0 + 1.0, f'{L["id"]}{" [" + a.state + "]" if a.state else ""}  north (-z) up, 1 m grid',
                   "#888", 11))
    o.append("</svg>")

    out = Path(a.out) if a.out else Path(".lab-tmp/level-plans") / f'{L["id"]}{"." + a.state if a.state else ""}.svg'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(o))
    print(f"wrote {out} ({x1 - x0 - 2 * PAD:g} x {z1 - z0 - 2 * PAD:g} m)")


if __name__ == "__main__":
    main()
