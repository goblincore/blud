#!/usr/bin/env python3
"""PROPOSAL (scratch, not tracked): the Boiler Room (rid 5) at 8.0 x 28.0 m, h 3.4.

Renders BEFORE / AFTER strips of room 5 with night_train_layout.to_svg (the table is swapped
in memory; the tracked script is not edited) and joins them into one PNG with rsvg-convert.

Frame: x across (-4 west .. +4 east), u along from the south door (0) to the north door (28).
Kit bays (build_night_train.py, BAY 1.9): int(28 // 1.9) = 14 bays, pad 0.7 at each end, so bay
boundaries (wall ribs) sit at u = 0.7 + 1.9k: 0.7, 2.6, 4.5, 6.4, 8.3, 10.2, 12.1, 14.0, 15.9,
17.8, 19.7, 21.6, 23.5, 25.4, 27.3; each bay's window glass spans u = start+0.4 .. start+1.5.
The pistons (0.8 m long, floor to ceiling) are centred ON ribs (12.1, 14.0, 15.9) so every west
window stays clear; the bar (1.1 m high) sits under the 1.05 m sill on the east.
"""
import copy
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO / "scripts/levels"))
import night_train_layout as L  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

W2 = 4.0
PROPOSED_RID5 = dict(
    rid=5, name="boiler-room", w=8.0, L=28.0, h=3.4,
    walls=[],
    areas=[("favours + boiler (entrance)", -4.0, 4.0, 0, 8.3),
           ("dance floor (6 x 10 m) under the disco ball", -3.0, 3.0, 9.0, 19.0),
           ("chill-out / beacon 2", -4.0, 4.0, 19.7, 24.8),
           ("DJ stage (visual riser, no collision)", -4.0, 4.0, 24.8, 28.0)],
    props=[("favours", -4.0, -3.3, 2.0, 3.6, 0.76), ("favours", -4.0, -3.3, 4.5, 6.1, 0.76),
           ("favours", 3.3, 4.0, 3.0, 4.6, 0.76),                      # new: a third table, east, past the boiler
           # two pairs of pillars at the dance floor's corners
           ("pillar", -2.55, -2.25, 8.4, 8.7, 3.4), ("pillar", 2.25, 2.55, 8.4, 8.7, 3.4),
           ("pillar", -2.55, -2.25, 19.3, 19.6, 3.4), ("pillar", 2.25, 2.55, 19.3, 19.6, 3.4),
           ("bar", 3.4, 4.0, 10.0, 16.0, 1.1),                         # the kit bar is exactly 6 m
           # pistons on the west wall, centred on the bay ribs (windows stay clear)
           ("piston", -4.0, -3.3, 11.7, 12.5, 3.4), ("piston", -4.0, -3.3, 13.6, 14.4, 3.4),
           ("piston", -4.0, -3.3, 15.5, 16.3, 3.4),
           # DJ deck ACROSS the far end, facing south (needs a new yaw branch in build_night_train prop())
           ("dj deck", -2.9, -1.1, 25.8, 26.6, 1.1)],
    spawns=[*[(f"dancer-{i}", "zombie", x, u) for i, (x, u) in
              enumerate(((-1.6, 11.0), (1.4, 12.4), (-0.8, 15.6), (1.8, 17.2)), 1)],
            ("soldier-bar-1", "soldier", 2.9, 12.8), ("soldier-dj", "soldier", -2.0, 27.2)],
    pickups=[("favour-dynamite", "dynamite", -3.65, 3.0), ("bar-health", "health", 3.4, 16.8),
             ("dj-cd", "cd", -3.5, 27.4)],
    gates=[], moods=["steady", "steady", "steady", "steady"],        # round(28 / 8) = 4 tubes, u 3.5 / 10.5 / 17.5 / 24.5
    fires=[("party-boiler", W2 - 0.6, 0.7, 0.6, 1.0)],              # the wall boiler stays at u 0.7, east (x w2 - 0.6)
    triggers=[("strobe", "light.strobe.room.5", -4.0, 4.0, 5.5, 6.5)],
    beacons=[(0.0, 7.0, 2.95, 0.7), (0.0, 21.0, 2.95, -0.7)],
    # optional 3rd/4th beacons (NOT in the table): (0.0, 14.0) would sit on the disco ball -> use
    # (-2.4, 14.0, 2.95, 0.7) / (2.4, 14.0, 2.95, -0.7) flanking the ball, or (0.0, 26.0) over the stage.
)
# Build-script constants that must move with the table (build_night_train.py hard-codes them):
DISCO_BALL_U = 14.0                                        # was g(10.0)
STEAM_VENTS = ((-2.9, 10.8), (-2.9, 13.05), (-2.9, 14.95), (-2.9, 17.0), (2.8, 21.5))   # was (1.6,6.8),(-1.6,12.6),(1.6,18.6)
OPTIONAL_BEACONS = ((-2.4, 14.0), (2.4, 14.0))


def only_rid5(table):
    L.CARRIAGES[:] = [copy.deepcopy(table)]
    return L.to_svg()


def annotate(svg, table, ball_u, vents, extra_beacons=()):
    """Draw what to_svg doesn't: the disco ball, steam vents, window glass, optional beacons."""
    PX, PAD = 42.0, 1.2
    w2 = table["w"] / 2
    X = lambda u: (PAD + 3.0 + u) * PX  # noqa: E731
    Y = lambda x: (PAD + (x + w2)) * PX  # noqa: E731
    o = []
    bays = int(table["L"] // 1.9)
    pad = (table["L"] - bays * 1.9) / 2
    for b in range(bays):
        s = pad + b * 1.9
        for x in (-w2, w2):
            o.append(f'<rect x="{X(s + 0.4):.1f}" y="{Y(x) - 3:.1f}" width="{1.1 * PX:.1f}" height="6" fill="#6aa8ff" opacity="0.85"/>')
    o.append(f'<circle cx="{X(ball_u):.1f}" cy="{Y(0):.1f}" r="9" fill="#e8e8ff" stroke="#9090ff" stroke-width="2"/>'
             f'<text x="{X(ball_u):.1f}" y="{Y(0) - 12:.1f}" fill="#c8c8ff" font-size="10" text-anchor="middle">disco ball</text>')
    for vx, vu in vents:
        o.append(f'<rect x="{X(vu) - 6:.1f}" y="{Y(vx) - 6:.1f}" width="12" height="12" fill="none" stroke="#b0b0b0" stroke-width="1.5"/>'
                 f'<text x="{X(vu):.1f}" y="{Y(vx) + 17:.1f}" fill="#b0b0b0" font-size="8" text-anchor="middle">steam</text>')
    for bx, bu in extra_beacons:
        o.append(f'<text x="{X(bu):.1f}" y="{Y(bx) + 4:.1f}" fill="#ff2a1a" font-size="12" text-anchor="middle" opacity="0.45">◆</text>'
                 f'<text x="{X(bu):.1f}" y="{Y(bx) + 16:.1f}" fill="#ff6a5a" font-size="8" text-anchor="middle">opt. beacon</text>')
    # the north door (to_svg skips it on the last strip) and the dance-floor outline
    o.append(f'<rect x="{X(table["L"]) - 2.5:.1f}" y="{Y(-0.7):.1f}" width="5" height="{1.4 * PX:.1f}" fill="#50b050"/>')
    for label, x0, x1, u0, u1 in table["areas"]:
        if label.startswith("dance floor"):
            o.append(f'<rect x="{X(u0):.1f}" y="{Y(x0):.1f}" width="{(u1 - u0) * PX:.1f}" height="{(x1 - x0) * PX:.1f}" '
                     'fill="#c040ff" fill-opacity="0.07" stroke="#c070ff" stroke-width="1.5" stroke-dasharray="6 4"/>')
    # prop labels (to_svg draws furniture unlabelled)
    for label, x0, x1, u0, u1, _ in table["props"]:
        o.append(f'<text x="{X((u0 + u1) / 2):.1f}" y="{Y((x0 + x1) / 2) + 3:.1f}" fill="#f0e0c0" font-size="8" text-anchor="middle">{label}</text>')
    return svg.replace("</svg>", "\n".join(o) + "\n</svg>")


def main():
    before_t = next(c for c in L.CARRIAGES if c["rid"] == 5)
    saved = list(L.CARRIAGES)
    try:
        before = annotate(only_rid5(before_t), before_t, 10.0, ((1.6, 6.8), (-1.6, 12.6), (1.6, 18.6)))
        after = annotate(only_rid5(PROPOSED_RID5), PROPOSED_RID5, DISCO_BALL_U, STEAM_VENTS, OPTIONAL_BEACONS)
    finally:
        L.CARRIAGES[:] = saved
    (OUT / "before.svg").write_text(before)
    (OUT / "after.svg").write_text(after)
    for n in ("before", "after"):
        subprocess.run(["rsvg-convert", "-z", "1.5", "-o", str(OUT / f"{n}.png"), str(OUT / f"{n}.svg")], check=True)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
