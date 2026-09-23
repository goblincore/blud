#!/usr/bin/env python3
"""Draw a Blood map top-down as an SVG, for reference study only.

    python3 scripts/levels/blood_map_plan.py E1M1 [--bu-per-m 256] [--out .lab-tmp/map-research]

Reads BLOOD.RFF (default ~/Downloads/notblood-macos/BLOOD.RFF, or $BLOOD_RFF).
Writes <out>/<MAP>.svg and prints a calibration table. The output is derived
from Blood data: never commit it (.lab-tmp/ is gitignored).

Drawn: sector outlines (grey fill by floor height, darker = lower), openings
between sectors in blue, enemies (statnum 6) red with their type number,
other sprites as small grey dots, the player start green, grid lines every
10 m. Axes: Build x to the right, Build y down.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_parser import parse_map  # noqa: E402
from rff_reader import iter_by_ext, read_rff  # noqa: E402

Z_PER_XY = 16  # Build heights are 16x finer than x/y


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("map")
    ap.add_argument("--rff", default=os.environ.get("BLOOD_RFF", str(Path.home() / "Downloads/notblood-macos/BLOOD.RFF")))
    ap.add_argument("--bu-per-m", type=float, default=256.0)
    ap.add_argument("--out", default=".lab-tmp/map-research")
    a = ap.parse_args()

    maps = {e.name.upper(): e for e in iter_by_ext(read_rff(Path(a.rff)), "MAP")}
    m = parse_map(maps[a.map.upper()].data)
    s, w, sp = m["sectors"], m["walls"], m["sprites"]
    k = 1.0 / a.bu_per_m
    kz = k / Z_PER_XY

    xs = [p["x"] for p in w]
    ys = [p["y"] for p in w]
    x0, y0 = min(xs), min(ys)
    W, H = (max(xs) - x0) * k, (max(ys) - y0) * k
    px = 4.0  # SVG pixels per metre
    P = lambda x, y: f"{(x - x0) * k * px:.1f},{(y - y0) * k * px:.1f}"  # noqa: E731

    floors = [sec["floorz"] for sec in s]
    fmin, fmax = min(floors), max(floors)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W * px:.0f}" height="{H * px:.0f}" '
           f'style="font:9px monospace">', '<rect width="100%" height="100%" fill="#111"/>']
    for gx in range(0, int(W) + 1, 10):
        out.append(f'<line x1="{gx * px}" y1="0" x2="{gx * px}" y2="{H * px}" stroke="#222"/>')
    for gy in range(0, int(H) + 1, 10):
        out.append(f'<line x1="0" y1="{gy * px}" x2="{W * px}" y2="{gy * px}" stroke="#222"/>')
    for i, sec in enumerate(s):
        pts = " ".join(P(w[j]["x"], w[j]["y"]) for j in range(sec["wallptr"], sec["wallptr"] + sec["wallnum"]))
        t = 0.0 if fmax == fmin else (fmax - sec["floorz"]) / (fmax - fmin)  # Build z grows downward
        g = int(40 + 120 * t)
        out.append(f'<polygon points="{pts}" fill="rgb({g},{g},{g})" fill-opacity="0.5" stroke="#999" '
                   f'stroke-width="0.5"><title>sector {i} floor {-sec["floorz"] * kz:.2f} m '
                   f'height {(sec["floorz"] - sec["ceilingz"]) * kz:.2f} m</title></polygon>')
    for wall in w:
        if wall["nextsector"] >= 0:
            b = w[wall["point2"]]
            out.append(f'<polyline points="{P(wall["x"], wall["y"])} {P(b["x"], b["y"])}" stroke="#48f" stroke-width="1"/>')
    for t in sp:
        if t["statnum"] == 6:
            out.append(f'<circle cx="{P(t["x"], t["y"]).split(",")[0]}" cy="{P(t["x"], t["y"]).split(",")[1]}" r="2.5" fill="#e33"/>'
                       f'<text x="{(t["x"] - x0) * k * px + 3:.1f}" y="{(t["y"] - y0) * k * px:.1f}" fill="#e88">{t["lotag"]}</text>')
        else:
            cx, cy = P(t["x"], t["y"]).split(",")
            out.append(f'<circle cx="{cx}" cy="{cy}" r="1" fill="#777"/>')
    cx, cy = P(m["pos"]["x"], m["pos"]["y"]).split(",")
    out.append(f'<circle cx="{cx}" cy="{cy}" r="4" fill="#3e3"/></svg>')

    dest = Path(a.out)
    dest.mkdir(parents=True, exist_ok=True)
    f = dest / f"{a.map.upper()}.svg"
    f.write_text("\n".join(out))

    heights = sorted((sec["floorz"] - sec["ceilingz"]) * kz for sec in s)
    print(f"{a.map.upper()}: {len(s)} sectors, {len(w)} walls, {len(sp)} sprites -> {f}")
    print(f"extent {W:.0f} x {H:.0f} m at {a.bu_per_m:g} BU/m")
    print("sector heights (m) p10/p50/p90:",
          " / ".join(f"{heights[int(len(heights) * q)]:.2f}" for q in (0.1, 0.5, 0.9)))
    print("enemies by type:", dict(Counter(t["lotag"] for t in sp if t["statnum"] == 6)))


if __name__ == "__main__":
    main()
