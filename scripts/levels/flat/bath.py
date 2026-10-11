# scripts/levels/flat/bath.py
"""The bathroom (spec 2026-10-11-flat-apartment-design.md): tile-lined walls, a tile floor and a flat ceiling, a wooden architrave on the doorway, a bare bulb;
the fixtures are added below (Task 7). Interior: x from X1 + PART_T to BX1, y from HY0 to 0, z up to 2.3. Run inside Blender."""
import math

import bmesh
from mathutils import Vector  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, obj_from_bm, sphere, torus, tube  # noqa: F401
from flat.giger import vertebral

X1, BX1, HY0, BDY, BDHW, BDH, PART_T = LAY.X1, LAY.BX1, LAY.HY0, LAY.BDY, LAY.BDHW, LAY.BDH, LAY.PART_T
BX0 = X1 + PART_T                 # the bathroom's west plane: the lining sits on the partition's far side
CEIL = 2.3
MT = None                         # the materials namespace, set by build()


def lining():
    cx, cy = (BX0 + BX1) / 2, (HY0 + 0.0) / 2
    w = BX1 - BX0
    box('bath_floor', (cx, cy, -0.02), (w, -HY0, 0.04), MT.BATHFLOOR, uv_size=1.0)
    box('bath_ceiling', (cx, cy, CEIL + 0.02), (w, -HY0, 0.04), MT.TILE, uv_size=1.0)
    box('bath_wall_n', (cx, -0.015, CEIL / 2), (w, 0.03, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_s', (cx, HY0 + 0.015, CEIL / 2), (w, 0.03, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_e', (BX1 - 0.015, cy, CEIL / 2), (0.03, -HY0, CEIL), MT.TILE, uv_size=1.0)
    # the partition's lining: two pieces and a lintel round the doorway, and reveals on the doorway's sides (the partition is 0.2 deep)
    wx = BX0 + 0.015
    south_len = (BDY - BDHW) - HY0
    box('bath_wall_w_s', (wx, HY0 + south_len / 2, CEIL / 2), (0.03, south_len, CEIL), MT.TILE, uv_size=1.0)
    north_len = 0.0 - (BDY + BDHW)
    box('bath_wall_w_n', (wx, (BDY + BDHW) + north_len / 2, CEIL / 2), (0.03, north_len, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_w_lintel', (wx, BDY, (BDH + CEIL) / 2), (0.03, 2 * BDHW, CEIL - BDH), MT.TILE, uv_size=1.0)
    for sy, nm in ((-1, 's'), (1, 'n')):
        box(f'bath_reveal_{nm}', ((X1 + BX0) / 2, BDY + sy * (BDHW - 0.015), BDH / 2), (PART_T, 0.03, BDH), MT.OAK, uv_size=1.0)


def architrave():
    """A plain wooden frame round the doorway, on the hall side of the partition."""
    x = X1 - 0.02
    for sy, nm in ((-1, 's'), (1, 'n')):
        box(f'frame_{nm}', (x, BDY + sy * (BDHW + 0.035), BDH / 2 + 0.03), (0.04, 0.07, BDH + 0.06), MT.OAK, bevel=0.008)
    box('frame_top', (x, BDY, BDH + 0.065), (0.05, 2 * BDHW + 0.14, 0.09), MT.OAK, bevel=0.01)


def lamp():
    """A bare bulb on a cord from the ceiling (the light is in flat_layout.LIGHTS)."""
    cx, cy, z = 2.0, -1.0, 2.12
    tube('bath_cord', [(cx, cy, CEIL), (cx, cy, z + 0.12)], [0.004, 0.004], MT.IRON, res=2, res_u=2)
    cyl('bath_socket', (cx, cy, z + 0.08), 0.018, 0.06, MT.IRON, verts=10)
    sphere('bath_bulb', (cx, cy, z), 0.04, MT.BATHBULB, seg=12)


def rr_loop(cx, cy, w, l, r, n=6):
    """A rounded rectangle's points (counter-clockwise) in the xy plane."""
    pts = []
    for qx, qy, a0 in ((w / 2 - r, l / 2 - r, 0), (-w / 2 + r, l / 2 - r, 90), (-w / 2 + r, -l / 2 + r, 180), (w / 2 - r, -l / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + qx + math.cos(a) * r, cy + qy + math.sin(a) * r))
    return pts


def loft(name, rings, material, cap_first=False, cap_last=False):
    """A closed or open shell through rings = [(z, [(x, y), ...]), ...] (the same point count in each)."""
    bm = bmesh.new()
    verts = [[bm.verts.new((x, y, z)) for x, y in pts] for z, pts in rings]
    m = len(rings[0][1])
    for a, b in zip(verts, verts[1:]):
        for i in range(m):
            bm.faces.new((a[i], a[(i + 1) % m], b[(i + 1) % m], b[i]))
    if cap_first:
        bm.faces.new(verts[0])
    if cap_last:
        bm.faces.new(list(reversed(verts[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material, smooth=True)


def claw_tub():
    """A cast-iron tub (dark outside, white enamel inside and on the rim) on four bone-and-bronze claws."""
    cx, cy, W, Ln = LAY.TUB

    def ring(z, inset):
        return (z, rr_loop(cx, cy, W - 2 * inset, Ln - 2 * inset, max(0.34 - inset, 0.05)))

    loft('tub_outer', [ring(0.20, 0.07), ring(0.27, 0.02), ring(0.40, 0.0), ring(0.62, 0.0), ring(0.74, 0.012)], MT.CASTIRON, cap_first=True)
    loft('tub_inner', [ring(0.74, 0.012), ring(0.755, 0.05), ring(0.70, 0.065), ring(0.36, 0.10), ring(0.27, 0.15)], MT.ENAMEL, cap_last=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * (W / 2 - 0.12), cy + sy * (Ln / 2 - 0.22)
            tube(f'tub_claw{sx}{sy}', [(x, y, 0.26), (x + sx * 0.03, y + sy * 0.03, 0.14), (x + sx * 0.07, y + sy * 0.08, 0.05)], [0.032, 0.026, 0.02], MT.BONE, res=3, res_u=4)
            sphere(f'tub_ball{sx}{sy}', (x + sx * 0.075, y + sy * 0.085, 0.04), 0.038, MT.BRONZE, seg=12)
            cyl(f'tub_talon{sx}{sy}', (x + sx * 0.075, y + sy * 0.135, 0.045), 0.018, 0.07, MT.BONE, r2=0.0, rot=(-sy * math.pi / 2, 0, 0), verts=8)


def taps_and_shower():
    """Freestanding supply pipes at the tub's south end: two handles, a spout, a riser with a hand shower; a chrome curtain ring overhead (no curtain yet)."""
    cx, cy, W, Ln = LAY.TUB
    y0 = cy - Ln / 2 - 0.09                                   # the pipes stand just beyond the tub's end
    tube('shower_riser', [(cx, y0, 0.02), (cx, y0, 0.90), (cx, y0, 1.50), (cx, y0 + 0.07, 1.62), (cx, y0 + 0.23, 1.62)], [0.014] * 5, MT.CHROME, res=3, res_u=6)
    cyl('shower_head', (cx, y0 + 0.27, 1.60), 0.065, 0.02, MT.CHROME, rot=(0.35, 0, 0), verts=20)
    tube('tub_spout', [(cx, y0, 0.88), (cx, y0 + 0.03, 0.93), (cx, y0 + 0.10, 0.93), (cx, y0 + 0.12, 0.84)], [0.012] * 4, MT.CHROME, res=3, res_u=6)
    for sx in (-1, 1):
        sphere(f'tap_handle{sx}', (cx + sx * 0.08, y0, 0.93), 0.02, MT.CHROME, seg=10)
    torus('curtain_ring', (cx, cy, 1.95), 0.5, 0.007, MT.CHROME, scale=(0.86, 1.7, 1.0))
    for i, (hx, hy) in enumerate(((0.43, 0.0), (-0.43, 0.0), (0.0, 0.85), (0.0, -0.85))):
        tube(f'ring_hanger{i}', [(cx + hx, cy + hy, 1.95), (cx + hx, cy + hy, CEIL)], [0.004, 0.004], MT.CHROME, res=2, res_u=2)


def toilet(cx=1.85):
    box('toilet_tank', (cx, -0.12, 0.62), (0.38, 0.20, 0.38), MT.ENAMEL, bevel=0.03)
    box('toilet_lid', (cx, -0.12, 0.825), (0.40, 0.22, 0.03), MT.ENAMEL, bevel=0.012)
    box('toilet_bowl', (cx, -0.40, 0.20), (0.34, 0.56, 0.40), MT.ENAMEL, bevel=0.12)      # a heavily bevelled block reads as a rounded bowl
    seat = cyl('toilet_seat', (cx, -0.42, 0.405), 0.20, 0.03, MT.OAK, verts=32)
    seat.scale = (0.92, 1.25, 1.0)
    hole = cyl('toilet_hole', (cx, -0.43, 0.422), 0.13, 0.005, MT.DARKGLASS, verts=24)
    hole.scale = (0.9, 1.3, 1.0)
    cyl('toilet_flush', (cx + 0.14, -0.12, 0.85), 0.012, 0.05, MT.CHROME, verts=8)


def sink(cx=1.86):
    cyl('sink_pedestal', (cx, -1.88, 0.38), 0.07, 0.76, MT.ENAMEL, verts=20)
    box('sink_basin', (cx, -1.84, 0.82), (0.50, 0.34, 0.14), MT.ENAMEL, bevel=0.07)
    box('sink_back', (cx, -1.975, 0.95), (0.50, 0.03, 0.12), MT.ENAMEL, bevel=0.01)
    tube('sink_spout', [(cx, -1.94, 0.90), (cx, -1.91, 1.0), (cx, -1.84, 1.0), (cx, -1.82, 0.93)], [0.01] * 4, MT.CHROME, res=3, res_u=6)
    for sx in (-1, 1):
        sphere(f'sink_handle{sx}', (cx + sx * 0.09, -1.93, 0.93), 0.016, MT.CHROME, seg=10)


def mirror(cx=1.86, cz=1.5):
    """A stone-and-bone frame round a dark polished glass on the south wall, facing north. The glass reflects nothing yet (the planar mirror is a later spike)."""
    w, h, y = 0.46, 0.62, HY0 + 0.03
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    pts = [(cx - w / 2, cz - h / 2), (cx - w / 2, cz + h / 2), (cx + w / 2, cz + h / 2), (cx + w / 2, cz - h / 2)]
    f = bm.faces.new([bm.verts.new((x, y + 0.002, z)) for x, z in pts])
    for l, uv in zip(f.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
        l[uvl].uv = uv
    obj_from_bm('mirror_glass', bm, MT.MIRROR, uv_size=0)
    for sx in (-1, 1):
        box(f'mirror_frame_side{sx}', (cx + sx * (w / 2 + 0.03), y + 0.012, cz), (0.06, 0.03, h + 0.12), MT.STONE_DARK, bevel=0.008)
    for sz, nm in ((-1, 'b'), (1, 't')):
        box(f'mirror_frame_{nm}', (cx, y + 0.012, cz + sz * (h / 2 + 0.03)), (w + 0.12, 0.03, 0.06), MT.STONE_DARK, bevel=0.008)
    for sx in (-1, 1):
        sphere(f'mirror_stud{sx}', (cx + sx * (w / 2 + 0.03), y + 0.03, cz + h / 2 + 0.03), 0.014, MT.BONE, scale=(1, 1.2, 1), seg=10)


def pipe_run():
    """A Giger pipe down the north-east corner into the tub, with a flesh collar where it meets the ceiling."""
    vertebral('bath_pipe', [(3.06, -0.20, CEIL - 0.02), (3.07, -0.23, 1.5), (3.05, -0.27, 0.95)], 0.03, lambda p: Vector((-1, 0, 0)), collar=((3.06, -0.2, CEIL - 0.05), (0, 0, -1)))


def build(m):
    global MT
    MT = m
    lining()
    architrave()
    lamp()
    claw_tub()
    taps_and_shower()
    toilet()
    sink()
    mirror()
    pipe_run()
