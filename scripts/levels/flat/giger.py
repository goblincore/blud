# scripts/levels/flat/giger.py
"""The Giger layer, ported from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py (the vertebral rib 517-524, the conduits 628-685,
the boiler 687-698, the radiator 1270-1281 without its socks). One gunmetal, one bone and one flesh-gasket material for the whole
layer, so it costs three draw calls. Run inside Blender."""
import math
import random

from mathutils import Matrix, Vector  # noqa: F401
import bmesh

import flat_layout as LAY
from flat import common as C
from flat.common import bm_cube, box, catmull, cyl, obj_from_bm, resample, sphere, torus, tube  # noqa: F401

X0, X1, Y0, Y1, SPRING, CROWN, RV, CZ = LAY.X0, LAY.X1, LAY.Y0, LAY.Y1, LAY.SPRING, LAY.CROWN, LAY.RV, LAY.CZ
WX, WH, WS, WSP, FLOOR, RIBS = LAY.WX, LAY.WH, LAY.WS, LAY.WSP, LAY.FLOOR, LAY.RIBS
vault_z = LAY.vault_z
MT = None           # the materials namespace, set by build() (not M: vertebral() has a local matrix called M)


def vertebral(name, pts, r, away, ring_every=0.045, spine_every=3, collar=None, mat_core=None, mat_ring=None, spines=True):
    """A ribbed conduit: a gunmetal core with vertebra rings every ring_every m and dorsal spines pointing away from
    the surface it clings to (away: a vector, or a function of the position)."""
    samples = resample(catmull(pts, 16), ring_every)
    tube(name, [p for p, _ in catmull(pts, 4)], [r] * len(catmull(pts, 4)), mat_core or MT.GUN, res=3)
    bm = bmesh.new(); bm2 = bmesh.new()
    for k, (p, t) in enumerate(samples[1:-1]):
        q = t.to_track_quat('Z', 'Y').to_matrix()
        M = Matrix.Translation(p) @ q.to_4x4()
        ringr = r * (1.42 if k % 2 == 0 else 1.25)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=ringr, radius2=ringr * 0.92, depth=r * 0.55, matrix=M)
        if spines and k % spine_every == 0:
            a = away(p) if callable(away) else Vector(away)
            a = (a - t * a.dot(t)).normalized()
            base = p + a * ringr * 0.85
            q2 = a.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            L = r * random.uniform(1.4, 2.3)
            bmesh.ops.create_cone(bm2, cap_ends=True, segments=8, radius1=r * 0.45, radius2=0.0005, depth=L,
                                  matrix=Matrix.Translation(base + a * L / 2) @ q2)
    o = obj_from_bm(name + '_rings', bm, mat_ring or MT.BONE, smooth=True)
    if spines: obj_from_bm(name + '_spines', bm2, mat_ring or MT.BONE, smooth=True)
    if collar:   # the fleshy grommet where it enters the stone
        p, n = Vector(collar[0]), Vector(collar[1])
        q = n.to_track_quat('Z', 'Y').to_euler()
        torus(name + '_collar', p, r * 1.55, r * 0.55, MT.GASKET, rot=q, scale=(1, 1, 0.7))
    return o


def giger_rib(y):
    """The gothic rib turned Giger's: the same arch, made of vertebrae, spines hanging into the room."""
    a0 = math.asin((X1 - 0.03) / RV)
    pts = [(math.sin(a) * (RV - 0.07), y, CZ + math.cos(a) * (RV - 0.07)) for a in [-a0 + 2 * a0 * k / 12 for k in range(13)]]
    vertebral(f'giger_rib_{y}', pts, 0.05, lambda p: Vector((-p.x, 0, -(p.z - CZ))).normalized(), ring_every=0.05, spine_every=2)
    for sx in (-1, 1):
        sphere(f'bone_corbel{sx}', (sx * (X1 - 0.07), y, SPRING - 0.2), 0.09, MT.BONE, scale=(0.9, 1.0, 1.25))
        cyl(f'bone_corbel_hook{sx}', (sx * (X1 - 0.13), y, SPRING - 0.32), 0.03, 0.14, MT.BONE, r2=0.0, rot=(0, math.radians(sx * -150), 0), verts=12)

def boiler(c):
    x, y, z = c
    for k in range(13):
        zz = z - 0.26 + k * 0.042
        rr = 0.13 + 0.02 * math.sin(k / 12 * math.pi)
        torus(f'boiler_rib{k}', (x, y, zz), rr, 0.016, MT.GUN)
    cyl('boiler_core', (x, y, z), 0.13, 0.56, MT.GUN)
    sphere('boiler_top', (x, y, z + 0.28), 0.13, MT.BONE, scale=(1, 1, 0.55))
    sphere('boiler_bot', (x, y, z - 0.28), 0.12, MT.GUN, scale=(1, 1, 0.5))
    vertebral('boiler_out', [(x, y, z - 0.33), (x - 0.04, y - 0.02, z - 0.48), (x - 0.18, y - 0.08, 0.86)], 0.022, lambda p: Vector((-1, 0, 0)))
    # rust and wet streaks run down the stone below it

def radiator():
    """A ribcage under the window: bone ribs off a vertebral bar, socks drying on it."""
    bar = [Vector((WX - 0.32, Y1 - 0.07, 0.42)), Vector((WX, Y1 - 0.08, 0.43)), Vector((WX + 0.32, Y1 - 0.07, 0.42))]
    vertebral('radiator_spine', bar, 0.02, lambda p: Vector((0, -1, 0.4)), ring_every=0.03, spine_every=2)
    for k in range(9):
        x = WX - 0.28 + k * 0.07
        pts = [Vector((x, Y1 - 0.07, 0.42)), Vector((x, Y1 - 0.2, 0.36)), Vector((x, Y1 - 0.2, 0.2)), Vector((x, Y1 - 0.08, 0.12))]
        tube(f'radiator_rib{k}', pts, [0.014, 0.012, 0.012, 0.01], MT.BONE)


def build(m):
    global MT
    MT = m
    random.seed(11)
    DOWN = (0, 0, -1)
    for sx, x in ((-1, -0.62), (1, 0.58)):
        z = vault_z(x) - 0.09
        pts = [(x, -0.1, z), (x, 0.45, z)]
        for y in RIBS: pts += [(x, y, z - 0.075), (x, y + 0.45, z)]
        pts[-1] = (x, Y1 + 0.1, z)
        vertebral(f'vault_conduit{sx}', pts, 0.032, lambda p: Vector((0, 0, -1)))
        for y in RIBS:     # bone clamps where they pass under the ribs
            torus(f'clamp{sx}_{y}', (x, y, z - 0.075), 0.05, 0.016, MT.BONE, rot=(math.pi / 2, 0, 0))
    giger_rib(1.8)
    for k, dx in enumerate((-0.085, 0.0, 0.085)):      # a bundle of three along the crown, sagging between the ribs
        x = dx; z = vault_z(x) - 0.06 - 0.01 * k
        pts = [(x, -0.1, z)]
        for y0_, y1_ in zip((0.0, 0.9, 1.8, 2.7), (0.9, 1.8, 2.7, 3.6)):
            pts += [((x * 1.4), (y0_ + y1_) / 2, z - 0.12 - 0.03 * k), (x, y1_, z - 0.02)]
        pts[-1] = (x, Y1 + 0.1, z)
        vertebral(f'crown_bundle{k}', pts, 0.022 + 0.005 * (k == 1), lambda p: Vector((0, 0, -1)), ring_every=0.04, spine_every=4)
    for y in (0.0 + 0.03, Y1 - 0.03):
        torus(f'crown_collar{int(y * 100)}', (0, y, vault_z(0) - 0.09), 0.13, 0.04, MT.GASKET, rot=(math.pi / 2, 0, 0), scale=(1.1, 0.8, 1))
    vertebral('ne_duct', [(X1 - 0.12, Y1 - 0.12, vault_z(X1 - 0.12) - 0.05), (X1 - 0.11, Y1 - 0.11, 1.5), (X1 - 0.1, Y1 - 0.11, 1.0), (X1 - 0.13, Y1 - 0.1, 0.84)], 0.065,
              lambda p: Vector((-1, -1, 0)), ring_every=0.07, spine_every=2, collar=((X1 - 0.12, Y1 - 0.12, vault_z(X1 - 0.12) - 0.08), (0, 0, -1)))
    # One drops from the vault down the east wall into the boiler.
    vertebral('to_boiler', [(0.58, 2.95, vault_z(0.58) - 0.13), (0.95, 3.12, vault_z(0.95) - 0.1), (1.24, 3.22, 1.86), (1.24, 3.25, 1.66)], 0.03,
              lambda p: Vector((-1, 0, -0.3)))
    # One down the west wall into the floor behind the futon.
    vertebral('west_drop', [(-1.29, 2.3, SPRING - 0.12), (-1.27, 2.28, 1.3), (-1.29, 2.32, 0.5), (-1.25, 2.36, 0.08), (-1.15, 2.38, FLOOR + 0.02)], 0.036,
              lambda p: Vector((1, 0, 0)), collar=((-1.29, 2.3, SPRING - 0.15), (0, 0, -1)))
    # One down the north wall into the fridge.
    vertebral('to_fridge', [(-1.0, Y1 - 0.06, CROWN - 0.3), (-1.02, Y1 - 0.07, 1.4), (-1.0, Y1 - 0.09, 0.98)], 0.028,
              lambda p: Vector((0, -1, 0)), collar=((-1.0, Y1 - 0.04, 1.62), (0, -1, 0)))

    boiler((1.2, 3.3, 1.38))
    radiator()
