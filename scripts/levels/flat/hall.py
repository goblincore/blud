# scripts/levels/flat/hall.py
"""The entry hall's dressing: the genkan step, coat hooks, a shoe cubby with slippers, a wall sconce, and two vertebral conduits on the vault. Run inside Blender."""
import math

from mathutils import Vector  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, sphere, tube  # noqa: F401
from flat.giger import vertebral

X0, X1, HY0, GENKAN_Y, GENKAN_H = LAY.X0, LAY.X1, LAY.HY0, LAY.GENKAN_Y, LAY.GENKAN_H
vault_z = LAY.vault_z
MT = None


def genkan():
    """The hall's floor, stepped up 8 cm north of GENKAN_Y (the collider is in the layout, so the player really steps up)."""
    box('genkan_step', (0, GENKAN_Y / 2 - 0.08, GENKAN_H / 2), (X1 - X0, -GENKAN_Y - 0.16, GENKAN_H), MT.STONE_DARK, bevel=0.01, uv_size=1.0)


def hooks():
    box('hook_rail', (X0 + 0.04, -0.95, 1.55), (0.04, 0.9, 0.09), MT.OAK, bevel=0.006)
    for k in range(4):
        cyl(f'hook{k}', (X0 + 0.11, -1.28 + k * 0.22, 1.55), 0.012, 0.10, MT.BONE, r2=0.004, rot=(0, math.pi / 2, 0), verts=8)      # a spur into the hall


def cubby():
    x0, x1, y0, y1 = X0, X0 + 0.32, -1.75, -0.85
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box('cubby_top', (cx, cy, 0.36), (x1 - x0, y1 - y0, 0.03), MT.OAK, bevel=0.005)
    box('cubby_mid', (cx, cy, 0.18), (x1 - x0 - 0.02, y1 - y0 - 0.02, 0.02), MT.OAK)
    for i, yy in enumerate((y0 + 0.01, cy, y1 - 0.01)):
        box(f'cubby_side{i}', (cx, yy, 0.18), (x1 - x0, 0.02, 0.36), MT.OAK)
    for k, y in enumerate((-1.45, -1.12)):                                                  # a pair of slippers on each shelf
        box(f'slipper{k}', (cx + 0.02, y, 0.215), (0.22, 0.10, 0.06), MT.FLESH, bevel=0.025)
        box(f'slipper_b{k}', (cx + 0.02, y, 0.395), (0.22, 0.10, 0.06), MT.LIPS, bevel=0.025)


def sconce():
    """A wall lamp by the bathroom doorway (the light is in flat_layout.LIGHTS)."""
    tube('sconce_arm', [(X1 - 0.01, -0.45, 1.80), (X1 - 0.08, -0.45, 1.84), (X1 - 0.16, -0.45, 1.92)], [0.01] * 3, MT.IRON, res=3, res_u=4)
    cyl('sconce_cup', (X1 - 0.17, -0.45, 1.93), 0.04, 0.04, MT.IRON, r2=0.055, verts=12)
    sphere('sconce_glass', (X1 - 0.17, -0.45, 1.99), 0.045, MT.BULBS[2], seg=12)


def conduits():
    """The room's two vault conduits run on over the hall to its south wall."""
    for sx, x in ((-1, -0.62), (1, 0.58)):
        z = vault_z(x) - 0.09
        pts = [(x, HY0 - 0.1, z), (x, HY0 + 0.4, z), (x, -0.9, z - 0.075), (x, -0.3, z), (x, 0.0, z)]
        vertebral(f'hall_conduit{sx}', pts, 0.032, lambda p: Vector((0, 0, -1)))


def build(m):
    global MT
    MT = m
    genkan()
    hooks()
    cubby()
    sconce()
    conduits()
