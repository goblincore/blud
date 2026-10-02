# scripts/levels/check_control_room_kit.py
"""Checks the control-room kit pieces exist and have sane sizes.

    blender --background assets-source/levels/kit.blend --python scripts/levels/check_control_room_kit.py

Game axes: Blender (x, y, z) = game (x, -z, y), so a piece's game size is (dx, dz', dy') = (bx, bz, by).
Each entry is (name, (dx_min, dx_max), (dy_min, dy_max), (dz_min, dz_max)) in game metres.
"""
import sys

import bpy
import mathutils

EXPECT = [
    ("crt-console-green", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("crt-console-amber", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("crt-console-cyan", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("server-rack", (0.70, 0.80), (2.35, 2.45), (1.35, 1.45)),
    ("crt-wall", (6.7, 6.9), (2.6, 2.75), (0.65, 0.75)),
    ("firebox-door", (0.40, 0.48), (1.75, 1.85), (1.25, 1.35)),
    ("egg-plinth", (2.6, 6.6), (1.25, 1.35), (2.6, 6.6)),
    ("egg-placeholder", (1.7, 2.2), (2.4, 2.7), (1.7, 2.2)),
    ("cable-tray-34", (0.55, 0.65), (0.05, 0.15), (0.95, 1.05)),
    ("end-wall-blank-80-34", (7.9, 8.1), (3.3, 3.5), (0.0, 0.01)),
]
MATERIALS = ["train.beige", "train.crt-green", "train.crt-amber", "train.crt-cyan", "train.crt-dim", "train.egg"]

bad = []
for name in MATERIALS:
    if name not in bpy.data.materials:
        bad.append(f"material {name} missing")
for name, rx, ry, rz in EXPECT:
    coll = bpy.data.collections.get(name)
    if coll is None or not coll.all_objects:
        bad.append(f"piece {name} missing")
        continue
    pts = [o.matrix_world @ mathutils.Vector(c) for o in coll.all_objects for c in o.bound_box]
    size = [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]
    dx, dy, dz = size[0], size[2], size[1]
    for label, val, (lo, hi) in (("dx", dx, rx), ("dy", dy, ry), ("dz", dz, rz)):
        if not lo <= val <= hi:
            bad.append(f"{name}.{label} = {val:.3f} outside {lo}..{hi}")
if bad:
    print("FAIL check_control_room_kit:\n  " + "\n  ".join(bad))
    sys.exit(1)
print(f"PASS check_control_room_kit: {len(EXPECT)} pieces, {len(MATERIALS)} materials")
