# scripts/levels/flat/shell.py
"""The stone shell, ported from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py (walls 372-470, impost 472-475, vault 477-497,
ribs 499-516, window 526-601, floor 603-626, sink counter 700-703). Materials are glTF PBR (flat/materials.py): per-wall stone textures
carry the stains, the vault and flags are tiled coursed stone. Lights live in flat_layout.py. Run inside Blender."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import bm_cube, box, cyl, obj_from_bm, sphere, torus, tube  # noqa: F401

X0, X1, Y0, Y1, SPRING, CROWN, RV, CZ = LAY.X0, LAY.X1, LAY.Y0, LAY.Y1, LAY.SPRING, LAY.CROWN, LAY.RV, LAY.CZ
WX, WH, WS, WSP, WDEPTH, FLOOR, RIBS, NICHE = LAY.WX, LAY.WH, LAY.WS, LAY.WSP, LAY.WDEPTH, LAY.FLOOR, LAY.RIBS, LAY.NICHE
vault_z = LAY.vault_z
M = None            # the materials namespace, set by build()

def wall_hole_for(regions):
    """regions: functions z -> forbidden half-interval (lo, hi) along the wall or None. Returns, for a row spanning
    [za, zb], the forbidden intervals (sampled over the row's height)."""
    def holes(za, zb):
        res = []
        for f in regions:
            lo, hi = 1e9, -1e9
            for k in range(7):
                iv = f(za + (zb - za) * k / 6)
                if iv: lo, hi = min(lo, iv[0]), max(hi, iv[1])
            if lo < hi: res.append((lo, hi))
        return res
    return holes

def subtract(a, b, holes):
    segs = [(a, b)]
    for lo, hi in holes:
        nxt = []
        for s0, s1 in segs:
            if hi <= s0 or lo >= s1: nxt.append((s0, s1)); continue
            if lo > s0: nxt.append((s0, lo))
            if hi < s1: nxt.append((hi, s1))
        segs = nxt
    return segs

def ashlar(name, axis, plane, inward, u0, u1, z0, z1, wall_key, mat_, top=None, holes=None, depth=0.16, seed=1, hole_rect=None):
    """Blocks on one wall. axis 'x': the wall runs along x at y=plane; 'y': along y at x=plane. inward: +-1, the room
    side along the wall normal. top(u): the highest z at u (an end wall under the vault)."""
    rnd = random.Random(seed)
    bm = bmesh.new(); lay = None   # no per-block tint layer: the wall textures carry the stone
    gap = 0.011
    z = z0
    while z < z1 - 0.05:
        h = rnd.uniform(0.17, 0.34)
        if z + h > z1 - 0.06: h = z1 - z
        u = u0 - rnd.uniform(0.0, 0.35)
        while u < u1:
            L = rnd.uniform(0.24, 0.7)
            a, b = max(u, u0), min(u + L, u1)
            u += L
            if b - a < 0.06: continue
            for s0, s1 in subtract(a, b, holes(z, z + h) if holes else []):
                if s1 - s0 < 0.07: continue
                hh = h
                if top:
                    tmax = min(top(s0), top(s1), top((s0 + s1) / 2))
                    if z + 0.07 > tmax: continue
                    hh = min(h, tmax - z + 0.08)          # let the top course run up into the vault
                prot = rnd.uniform(-0.008, 0.026)
                n = plane + inward * (prot - depth / 2)
                c = ((s0 + s1) / 2, n, z + hh / 2) if axis == 'x' else (n, (s0 + s1) / 2, z + hh / 2)
                s = (s1 - s0 - gap, depth, hh - gap) if axis == 'x' else (depth, s1 - s0 - gap, hh - gap)
                rot = Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Z' if axis == 'x' else 'Y') @ Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Y' if axis == 'x' else 'X')
                bm_cube(bm, c, s, rot, lay, rnd.random())
        z += h
    C.planar_uv(bm, axis, LAY.WALL_U0[wall_key], LAY.WALL_W[wall_key], LAY.WALL_H)
    o = obj_from_bm(name, bm, mat_, bevel=0.022, segs=3, uv_size=0)
    # mortar behind the blocks, around one rectangular hole (the window, the niche)
    zt = (top(0.0) + 0.4) if top else z1 + 0.1
    rects = [(u0 - 0.1, u1 + 0.1, z0, zt)]
    if hole_rect:
        a, b, c, d = hole_rect
        rects = [(u0 - 0.1, a, z0, zt), (b, u1 + 0.1, z0, zt), (a, b, z0, c), (a, b, d, zt)]
    for k, (a, b, c, d) in enumerate(rects):
        if axis == 'x': box(f'{name}_mortar{k}', ((a + b) / 2, plane - inward * 0.05, (c + d) / 2), (b - a, 0.04, d - c), M.MORTAR)
        else: box(f'{name}_mortar{k}', (plane - inward * 0.05, (a + b) / 2, (c + d) / 2), (0.04, b - a, d - c), M.MORTAR)
    return o
QB, VB = 0.26, 0.24
def window_region(z):
    if WS - 0.14 <= z <= WSP: return (WX - WH - QB, WX + WH + QB)
    if WSP < z <= WSP + WH + VB:
        hw = math.sqrt(max(0.0, (WH + VB) ** 2 - (z - WSP) ** 2))
        hw = max(hw, WH + QB) if z < WSP + 0.12 else hw
        return (WX - hw, WX + hw)
    return None
NICHE = (2.42, 3.12, 0.92, 1.62)      # the west wall niche: y0, y1, z0, z1 (a round arch on top)
def niche_region(z):
    y0, y1, z0, z1 = NICHE
    if z0 - 0.04 <= z <= z1 + 0.04: return (y0 - 0.02, y1 + 0.02)
    return None

def build_walls():
    ashlar('wall_w', 'y', X0, +1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, 'w', M.STONE_W, holes=wall_hole_for([niche_region]), seed=2, hole_rect=(NICHE[0], NICHE[1], NICHE[2], NICHE[3]))
    ashlar('wall_e', 'y', X1, -1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, 'e', M.STONE_E, seed=3)
    ashlar('wall_n', 'x', Y1, -1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, 'n', M.STONE_N, top=vault_z, holes=wall_hole_for([window_region]), seed=4, hole_rect=(WX - WH, WX + WH, WS - 0.1, WSP + WH))
    ashlar('wall_s', 'x', Y0, +1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, 's', M.STONE_S, top=vault_z, seed=5)

def build_impost():
    for sx, nm in ((-1, 'w'), (1, 'e')):
        box(f'impost_{nm}', (sx * (X1 - 0.03), Y1 / 2, SPRING - 0.045), (0.12, Y1 + 0.2, 0.09), M.STONE_DARK, bevel=0.02)
        box(f'impost2_{nm}', (sx * (X1 - 0.01), Y1 / 2, SPRING - 0.11), (0.07, Y1 + 0.2, 0.05), M.STONE_DARK, bevel=0.012)

def vault():
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    nx, ny = 64, 40
    a0 = math.asin((X1 + 0.08) / RV)
    grid = []
    for j in range(ny + 1):
        y = Y0 - 0.12 + (Y1 - Y0 + 0.24) * j / ny; row = []
        for i in range(nx + 1):
            a = -a0 + 2 * a0 * i / nx
            row.append(bm.verts.new((RV * math.sin(a), y, CZ + RV * math.cos(a))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                a = -a0 + 2 * a0 * ii / nx
                l[uvl].uv = ((RV * a) / 1.68, (Y0 - 0.12 + (Y1 - Y0 + 0.24) * jj / ny) / 0.96)
    o = obj_from_bm('vault', bm, M.VAULT, smooth=True, uv_size=0)
    return o
def rib(y, w=0.17, d=0.11, n=11, seed=0):
    rnd = random.Random(seed)
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand')
    a0 = math.asin((X1 - 0.02) / RV)
    for k in range(n):
        a = -a0 + 2 * a0 * (k + 0.5) / n
        L = 2 * a0 / n * (RV - d / 2) - 0.012
        c = (math.sin(a) * (RV - d / 2), y, CZ + math.cos(a) * (RV - d / 2))
        rot = Matrix.Rotation(a, 3, 'Y')
        bm_cube(bm, c, (L, w, d), rot, lay, rnd.random())
    obj_from_bm(f'rib_{y:.1f}', bm, M.STONE_DARK, bevel=0.012)
    for sx in (-1, 1):   # corbels: three stepped stones
        for k, (wd, ht, z) in enumerate(((0.12, 0.07, SPRING - 0.2), (0.09, 0.06, SPRING - 0.27), (0.06, 0.05, SPRING - 0.33))):
            box(f'corbel_{y:.1f}_{sx}_{k}', (sx * (X1 - wd / 2), y, z), (wd, w + 0.02 - k * 0.03, ht), M.STONE_DARK, bevel=0.01)

def build_ribs():
    for i, y in enumerate(RIBS):
        if y != 1.8: rib(y, seed=10 + i)        # the middle rib is the vertebral one (giger.py)

def voussoirs():
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(9)
    n = 9; r0, r1 = WH, WH + VB; yA, yB = Y1 - 0.02, Y1 + 0.17
    for k in range(n):
        a0 = math.pi * k / n + 0.006; a1 = math.pi * (k + 1) / n - 0.006
        rr = r1 + rnd.uniform(-0.03, 0.02)
        pts = [(WX + math.cos(a) * r, WSP + math.sin(a) * r) for a, r in ((a0, r0), (a1, r0), (a1, rr), (a0, rr))]
        vs = [bm.verts.new((x, yA, z)) for x, z in pts] + [bm.verts.new((x, yB, z)) for x, z in pts]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        rv = rnd.random()
        for f in faces:
            ff = bm.faces.new([vs[i] for i in f]); ff[lay] = rv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    C.planar_uv(bm, 'x', LAY.WALL_U0['n'], LAY.WALL_W['n'], LAY.WALL_H)
    obj_from_bm('voussoirs', bm, M.STONE_N, bevel=0.012, uv_size=0)

def quoins():
    bm = bmesh.new(); lay = bm.faces.layers.float.new('rand'); rnd = random.Random(12)
    for sx in (-1, 1):
        z = WS - 0.12
        while z < WSP - 0.02:
            h = min(rnd.uniform(0.2, 0.27), WSP - z)
            c = (WX + sx * (WH + QB / 2), Y1 + 0.09, z + h / 2)
            bm_cube(bm, c, (QB - 0.012, 0.2, h - 0.012), None, lay, rnd.random())
            z += h
    C.planar_uv(bm, 'x', LAY.WALL_U0['n'], LAY.WALL_W['n'], LAY.WALL_H)
    obj_from_bm('quoins', bm, M.STONE_N, bevel=0.012, uv_size=0)
def soffit():
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    n = 24; rows = []
    for yy in (Y1 - 0.02, Y1 + WDEPTH):
        rows.append([bm.verts.new((WX + math.cos(math.pi * k / n) * WH, yy, WSP + math.sin(math.pi * k / n) * WH)) for k in range(n + 1)])
    for k in range(n):
        f = bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
        for l, (kk, jj) in zip(f.loops, ((k, 0), (k, 1), (k + 1, 1), (k + 1, 0))):
            l[uvl].uv = (WH * math.pi * kk / n / 1.68, jj * WDEPTH / 0.96)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.normal_flip()
    obj_from_bm('soffit', bm, M.VAULT, smooth=True)

def in_opening(x, z, pad=0.0):
    if WS - pad <= z <= WSP: return abs(x - WX) <= WH - pad
    if z > WSP: return (x - WX) ** 2 + (z - WSP) ** 2 <= (WH - pad) ** 2
    return False

def lattice(yy=Y1 + 0.42, step=0.115, bar=0.011):
    """A diamond lattice of iron bars clipped to the arch (leaded-window lines with the glass gone)."""
    bm = bmesh.new()
    for dirn in (1, -1):
        for k in range(-14, 15):
            # line: z = WS + dirn * (x - WX) + k * step * sqrt2
            off = k * step * math.sqrt(2)
            inside, start = False, None
            xs = [WX - WH - 0.05 + i * 0.004 for i in range(int((2 * WH + 0.1) / 0.004) + 1)]
            for x in xs + [None]:
                ok = x is not None and in_opening(x, WS + dirn * (x - WX) + off + WH, pad=0.004)
                if ok and not inside: start = x; inside = True
                if not ok and inside:
                    x1 = x - 0.004 if x is not None else xs[-1]
                    a = Vector((start, yy, WS + dirn * (start - WX) + off + WH)); b = Vector((x1, yy, WS + dirn * (x1 - WX) + off + WH))
                    L = (b - a).length
                    if L > 0.01:
                        bm_cube(bm, (a + b) / 2, (L, bar, bar), Matrix.Rotation(-math.atan2(b.z - a.z, b.x - a.x), 3, 'Y'))
                    inside = False
    obj_from_bm('lattice', bm, M.IRON)
    # the frame strap round the opening
    pts = [(WX - WH + 0.005, yy, WS)] + [(WX + math.cos(math.pi - math.pi * k / 16) * (WH - 0.005), yy, WSP + math.sin(math.pi * k / 16) * (WH - 0.005)) for k in range(17)] + [(WX + WH - 0.005, yy, WS)]
    tube('lattice_frame', pts, [0.012] * len(pts), M.IRON)
def build_window():
    voussoirs()
    quoins()
    box('sill', (WX, Y1 + 0.29, WS - 0.05), (2 * WH + 0.16, 0.66, 0.1), M.STONE_DARK, bevel=0.015)
    box('sill_lip', (WX, Y1 - 0.06, WS - 0.075), (2 * WH + 0.24, 0.1, 0.07), M.STONE_DARK, bevel=0.015)
    for sx in (-1, 1):  # the embrasure's reveals
        box(f'reveal{sx}', (WX + sx * (WH + 0.1), Y1 + WDEPTH / 2, (WS + WSP) / 2), (0.2, WDEPTH, WSP - WS + 0.02), M.VAULT, uv_size=(1.68, 1.68, 0.96))
    soffit()
    lattice()

def tatami(name, x0, x1, y0, y1, long_axis):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, 0.0275))
    o = bpy.context.active_object; o.name = name; o.scale = (x1 - x0 - 0.004, y1 - y0 - 0.004, 0.055)
    bpy.ops.object.transform_apply(scale=True)
    C.world_box_uv(o, 0.9)
    if long_axis == 'x':   # weave lines run across the long axis: rotate the UVs
        for l in o.data.uv_layers.active.data: l.uv = (l.uv[1], l.uv[0])
    o.data.materials.append(M.TATAMI)
    b = o.modifiers.new('bev', 'BEVEL'); b.width = 0.006; b.segments = 2
    # heri: the cloth borders along the long edges
    if long_axis == 'y':
        for x in (x0 + 0.02, x1 - 0.02): box(name + f'_heri{x:.2f}', (x, (y0 + y1) / 2, 0.056), (0.034, y1 - y0 - 0.01, 0.004), M.HERI)
    else:
        for y in (y0 + 0.02, y1 - 0.02): box(name + f'_heri{y:.2f}', ((x0 + x1) / 2, y, 0.056), (x1 - x0 - 0.01, 0.034, 0.004), M.HERI)

def build_floor():
    box('flagstones', (0, Y1 / 2, -0.05), (X1 - X0 + 0.3, Y1 + 0.3, 0.1), M.FLAG, uv_size=1.8)
    tatami('tat_a', -1.35, -0.45, 0.0, 1.8, 'y')
    tatami('tat_b', -1.35, -0.45, 1.8, 3.6, 'y')
    tatami('tat_c', -0.45, 1.35, 0.0, 0.9, 'x')
    tatami('tat_d', -0.45, 0.62, 2.7, 3.6, 'x')        # cut short: the kitchen's stone floor shows past it
    tatami('tat_e', -0.45, 0.45, 0.9, 2.7, 'y')
    tatami('tat_f', 0.45, 1.35, 0.9, 2.7, 'y')

def build_counter():
    box('counter', (1.07, 3.33, 0.39), (0.56, 0.52, 0.78), M.STONE_DARK, bevel=0.02)
    box('counter_top', (1.07, 3.31, 0.80), (0.6, 0.58, 0.05), M.STONE, bevel=0.015)


def view_plane():
    """The Bryce view outside the window: an emissive image plane 3 m beyond the north wall, sized so the window frames its middle part
    (room.py backdrop(), 1372-1393, for one fixed camera near the player's start)."""
    yb = Y1 + 3.0
    cam = Vector((WX, 0.6, 1.2))
    xs, zs = [], []
    for x, z in ((WX - WH, WS), (WX + WH, WS), (WX - WH, WSP + WH), (WX + WH, WSP + WH)):
        p = Vector((x, Y1 + WDEPTH * 0.7, z)); d = p - cam; t = (yb - cam.y) / d.y; q = cam + d * t
        xs.append(q.x); zs.append(q.z)
    w, h = max(xs) - min(xs), max(zs) - min(zs)
    pw = w / 0.42; ph = pw * 0.75                      # the window frames 42% of the view's width
    cx, cz = (min(xs) + max(xs)) / 2 - 0.05 * pw, (min(zs) + max(zs)) / 2 - 0.06 * ph
    bm = bmesh.new()
    verts = [bm.verts.new((cx + sx * pw * 0.8, yb, cz + sz * ph * 0.8)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(verts)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[uvl].uv = ((u - 0.5) * 1.6 + 0.5, (v - 0.5) * 1.6 + 0.5)
    o = obj_from_bm("view", bm, M.VIEW, uv_size=0)
    o["room"] = 1
    o["shadow"] = False


def build(m):
    global M
    M = m
    random.seed(11)
    build_walls()
    build_impost()
    vault()
    build_ribs()
    build_window()
    view_plane()
    build_floor()
    build_counter()
