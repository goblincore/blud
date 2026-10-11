# scripts/levels/flat/props.py
"""The hero props, from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py: the kotatsu and its quilt (705-707, 714-749), the futon and its
duvet (1131-1147), the fridge (1263-1264), the bookshelf and its books (1209-1226, 1245-1247), the paper lantern, the fairy lights and the
candle (1326-1367), plus a placeholder for the iMac. No clutter (plushies, posters, food, socks, gashapon): a later pass. Materials are
glTF PBR (flat/materials.py); lights are in flat_layout.py. Run inside Blender."""
import math
import random

import bmesh
from mathutils import Matrix, Vector, noise  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import bm_cube, box, cyl, obj_from_bm, smoothstep, sphere, torus, tube  # noqa: F401

X0, X1, Y0, Y1, SPRING, CROWN = LAY.X0, LAY.X1, LAY.Y0, LAY.Y1, LAY.SPRING, LAY.CROWN
FLOOR, KX, KY, KTOP, RIBS = LAY.FLOOR, LAY.KX, LAY.KY, LAY.KTOP, LAY.RIBS
SH_X0, SH_Y0, SH_Y1, SH_H = LAY.SH_X0, LAY.SH_Y0, LAY.SH_Y1, LAY.SH_H
vault_z = LAY.vault_z
MT = None           # the materials namespace, set by build()


def kotatsu_quilt(legs):
    """The kotatsu-buton: a 1.9 m square heightfield, flat on the frame under the board, dropping steeply at the table
    edge, lying out on the tatami in soft folds, and riding up over the goblin's thighs where they go in."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    n = 120; S = 1.9; grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = i / n, j / n
            x, y = KX + (u - 0.5) * S, KY + (v - 0.5) * S
            dx, dy = abs(x - KX) - 0.41, abs(y - KY) - 0.41
            d = max(dx, dy) if max(dx, dy) > 0 else max(dx, dy)
            top = KTOP - 0.03
            if d <= 0: h = top - 0.005 * (1 - math.exp(d * 30))
            else:
                ang = math.atan2(y - KY, x - KX)
                fold = 0.012 * math.sin(ang * 14 + 1.3) + 0.008 * noise.noise(Vector((x * 6, y * 6, 0)))
                drop = top * (1 - smoothstep(0.0, 0.16, d))
                h = max(FLOOR + 0.012 + max(0.0, fold) * smoothstep(0.1, 0.3, d), drop + fold * smoothstep(0.0, 0.08, d))
            p = Vector((x, y, 0))
            for a, b, r in legs:    # ride over the thighs
                ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)) if ab.length_squared > 0 else 0
                q = a + ab * t; dd = Vector((p.x - q.x, p.y - q.y, 0)).length
                if dd < r + 0.07:
                    cap = q.z + math.sqrt(max(0.0, (r + 0.025) ** 2 - dd * dd)) if dd < r + 0.025 else q.z + 0.0
                    lift = q.z + r + 0.025 - (dd - r - 0.025) * 0.9 if dd >= r + 0.025 else cap
                    h = max(h, lift)
            row.append(bm.verts.new((x, y, h)))
        grid.append(row)
    for j in range(n):
        for i in range(n):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (3 * ii / n, 3 * jj / n)      # the look-dev scaled the quilt image 3x
    o = obj_from_bm('kotatsu_quilt', bm, MT.QUILT, smooth=True)
    s = o.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.02; s.offset = -1

def duvet():
    bm = bmesh.new(); n = 40; grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            u, v = i / n, j / n
            x, y = -1.32 + u * 0.98, 0.32 + v * 1.25
            h = FLOOR + 0.1 + 0.07 * (0.5 + noise.noise(Vector((x * 3, y * 3, 0.5)))) + 0.05 * smoothstep(0.6, 1.0, v) * math.sin(u * math.pi)
            row.append(bm.verts.new((x, y, h)))
        grid.append(row)
    for j in range(n):
        for i in range(n): bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    o = obj_from_bm('duvet', bm, MT.DUVET, smooth=True)
    s = o.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.05; s.offset = -1

SPINES = [(0.85, 0.1, 0.15), (0.1, 0.25, 0.7), (0.95, 0.8, 0.2), (0.15, 0.6, 0.35), (0.95, 0.95, 0.92), (0.1, 0.1, 0.12), (0.9, 0.45, 0.65), (0.4, 0.75, 0.95), (0.6, 0.2, 0.7)]
def manga_row(bm, lay, x, y0, y1, z, rnd):
    y = y0 + 0.01
    run = rnd.choice(SPINES); count = 0
    while y < y1 - 0.02:
        t = rnd.uniform(0.014, 0.019); h = rnd.choice((0.177, 0.177, 0.182, 0.21))
        if count > rnd.randint(6, 18): run = rnd.choice(SPINES); count = 0
        count += 1
        idx = SPINES.index(run)
        bm_cube(bm, (x, y + t / 2, z + h / 2), (0.125, t - 0.0015, h), Matrix.Rotation(rnd.uniform(-0.03, 0.03), 3, 'X'), lay, idx / len(SPINES) + rnd.uniform(0, 0.02))
        y += t

def build_kotatsu():
    box('kotatsu_board', (KX, KY, KTOP - 0.0125), (0.82, 0.82, 0.025), MT.KOTATSU, bevel=0.006)
    kotatsu_quilt([])           # no goblin legs in this slice


def build_futon():
    box('futon', (-0.9, 1.25, FLOOR + 0.045), (0.85, 1.9, 0.09), MT.FUTON, bevel=0.04)
    duvet()
    box('pillow', (-0.9, 2.0, FLOOR + 0.13), (0.42, 0.24, 0.1), MT.PILLOW, bevel=0.04)


def build_fridge():
    box('fridge', (-1.04, 3.3, FLOOR + 0.43), (0.5, 0.52, 0.86), MT.FRIDGE, bevel=0.035)
    box('fridge_handle', (-0.82, 3.035, FLOOR + 0.62), (0.03, 0.02, 0.2), MT.BONE, bevel=0.008)


def build_shelf():
    for k in range(5):
        box(f'shelf_board{k}', (SH_X0 + 0.13, (SH_Y0 + SH_Y1) / 2, 0.02 + k * 0.36), (0.26, SH_Y1 - SH_Y0, 0.025), MT.OAK)
    for yy in (SH_Y0, SH_Y1):
        box(f'shelf_side{yy}', (SH_X0 + 0.13, yy, SH_H / 2), (0.26, 0.025, SH_H), MT.OAK)
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(31)
    for k in range(4):
        manga_row(bm, lay, SH_X0 + 0.1, SH_Y0, SH_Y1, 0.033 + k * 0.36, rnd)
    C.rand_uv(bm, lay, len(SPINES))          # one material for every book: each face points at its stripe of books.png
    obj_from_bm('manga', bm, MT.BOOKS, bevel=0.002, segs=1, uv_size=0)


def build_lights_as_objects():
    """The paper lantern, the fairy lights and the candle: the art. The lights themselves are in flat_layout.LIGHTS (fixture none)."""
    LZ = CROWN - 0.62
    tube('lantern_chain', [Vector((0.0, 1.05, CROWN)), Vector((0.0, 1.05, LZ + 0.18))], [0.004, 0.004], MT.IRON)
    lantern = sphere('lantern', (0.0, 1.05, LZ), 0.13, MT.PAPER, scale=(1, 1, 1.25))
    lantern['shadow'] = False
    for dz in (0.16, -0.16):
        cyl(f'lantern_rim{dz}', (0.0, 1.05, LZ + dz), 0.075, 0.03, MT.LACQUER)
    for sx in (-1, 1):
        x = sx * 0.92
        seg_pts = [0.2] + list(RIBS) + [3.4]
        allp = []
        for s0, s1 in zip(seg_pts, seg_pts[1:]):
            for t in [i / 6 for i in range(6)]:
                y = s0 + (s1 - s0) * t
                allp.append(Vector((x, y, vault_z(x) - 0.06 - 0.12 * math.sin(t * math.pi))))
        allp.append(Vector((x, 3.4, vault_z(x) - 0.06)))
        tube(f'fairy_wire{sx}', allp, [0.002] * len(allp), MT.IRON)
        for k, p in enumerate(allp[1:-1]):
            sphere(f'fairy{sx}_{k}', p + Vector((0, 0, -0.015)), 0.011, MT.BULBS[k % 4], seg=10)
    # a candle in an iron sconce on the west wall
    tube('sconce', [Vector((X0, 2.05, 1.35)), Vector((X0 + 0.08, 2.05, 1.33)), Vector((X0 + 0.12, 2.05, 1.4))], [0.008] * 3, MT.IRON)
    cyl('candle', (X0 + 0.12, 2.05, 1.45), 0.018, 0.09, MT.WAX)
    sphere('flame', (X0 + 0.12, 2.05, 1.51), 0.008, MT.FLAME, scale=(1, 1, 1.8))


def build_imac_placeholder():
    """The iMac's place: an amber, rounded body with a dark bezel (a stand-in for the translucent Giger iMac; spec section 11)."""
    sphere('imac_guts_spike', (KX + 0.04, KY + 0.14, KTOP + 0.2), 0.10, MT.FLESH, seg=24)
    sphere('imac_body', (KX + 0.04, KY + 0.14, KTOP + 0.2), 0.22, MT.SHELL, scale=(1.0, 1.15, 0.95), seg=32)
    box('imac_bezel', (KX + 0.04, KY - 0.05, KTOP + 0.2), (0.34, 0.03, 0.3), MT.GUN, bevel=0.02)


def build(m):
    global MT
    MT = m
    random.seed(11)
    build_kotatsu()
    build_futon()
    build_fridge()
    build_shelf()
    build_lights_as_objects()
    build_imac_placeholder()
