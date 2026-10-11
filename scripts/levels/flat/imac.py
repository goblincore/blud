# scripts/levels/flat/imac.py
"""The Giger iMac (machine stage 3), ported from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py (887-903 the profile, 954-1087 the shell, the face,
the screen, the mouth, the guts, the handle, the crest, the legs, the umbilicus and the hoses; the stickers and the lights are not ported: lights live
in flat_layout.py). The shell is alpha-blended (flat/materials.py); the guts inside are real meshes. Run inside Blender."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, obj_from_bm, sphere, torus  # noqa: F401
from flat.giger import vertebral

KX, KY, KTOP, FLOOR, Y1 = LAY.KX, LAY.KY, LAY.KTOP, LAY.FLOOR, LAY.Y1
IM_FRONT, IM_Z, IM_LEN, IM_W, IM_H = LAY.IM_FRONT, LAY.IM_Z, LAY.IM_LEN, LAY.IM_W, LAY.IM_H
MT = None           # the materials namespace, set by build()


def tube(name, pts, radii, material, res=2, cyclic=False):
    """The machine's tubes are small: a coarser curve and cross-section than the room's conduits (the look-dev's defaults made 147k triangles)."""
    return C.tube(name, pts, radii, material, res=res, cyclic=cyclic, res_u=3)


def im_profile(s):
    """Along the body (s 0 = face, 1 = the cranium's tip): half width, top and bottom (relative to IM_Z), exponent."""
    edge = 0.86 + 0.14 * math.sqrt(min(1.0, s / 0.05))                 # the face's rounded rim
    hw = IM_W * edge * (math.sqrt(max(0.0, 1 - ((s - 0.28) / 0.72) ** 2)) if s > 0.28 else 1.0)
    top = IM_H * edge * (math.sqrt(max(0.0, 1 - ((s - 0.22) / 0.78) ** 2)) if s > 0.22 else 1.0)
    top += 0.022 * math.exp(-((s - 0.42) / 0.16) ** 2)                 # the cranium swells behind the face
    bot = -IM_H * edge * (math.sqrt(max(0.0, 1 - ((s - 0.12) / 0.88) ** 2)) if s > 0.12 else 1.0)
    bot = bot * (1 - 0.35 * s) + 0.05 * s                                # the tip lifts: a teardrop that sweeps back and up
    return max(hw, 0.0005), top, min(bot, top - 0.001), 3.4 - 1.5 * s

def im_point(s, a, inset=0.0):
    hw, top, bot, e = im_profile(s)
    zc, hz = (top + bot) / 2, (top - bot) / 2
    ca, sa = math.cos(a), math.sin(a)
    f = lambda c: math.copysign(abs(c) ** (2 / e), c)
    return Vector((KX + f(ca) * (hw - inset), IM_FRONT + s * IM_LEN, IM_Z + zc + f(sa) * max(hz - inset, 0.0)))


def rounded_rect(w, h, r, n=6):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def plate(name, outer, inner, thick, at, m):
    """A flat plate (rounded rect with holes) facing -y, its front at 'at'."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'; cu.extrude = thick / 2
    cu.bevel_depth = 0.004; cu.bevel_resolution = 2
    for poly in [outer] + inner:
        sp = cu.splines.new('POLY'); sp.points.add(len(poly) - 1); sp.use_cyclic_u = True
        for i, (x, y) in enumerate(poly): sp.points[i].co = (x, y, 0, 1)
    o = bpy.data.objects.new(name, cu); C.dressing().objects.link(o); o.data.materials.append(m)
    o.rotation_euler = (math.radians(90), 0, 0); o.location = at
    o = C.to_mesh(o)
    C.world_box_uv(o, 0.5)
    return o


def giger_imac():
    # The shell: rings along the body, a superellipse in section, closed at the face and at the tip.
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); NS, NA = 90, 72; rings = []
    for i in range(NS + 1):
        s = (i / NS) ** 1.15
        ring = []
        for j in range(NA):
            a = j / NA * math.tau; p = im_point(s, a)
            p += Vector((0, 0, 0)) if s < 0.02 else Vector((0, 0, 0.004 * noise.noise(p * 15.0)))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(NS):
        for j in range(NA):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % NA], rings[i + 1][(j + 1) % NA], rings[i + 1][j]))
            for l, (jj, ii) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                l[uvl].uv = (jj / NA, ii / NS)       # u round the body (the texture tiles), v along it
    # (the look-dev closed the dome at the face with a cap; a blended, lamp-lit cap would wash out the screen, and the face plate closes the front anyway)
    tip = bm.verts.new(im_point(1.0, 0.0) + Vector((0, 0.004, 0)))
    for j in range(NA): bm.faces.new((rings[NS][j], rings[NS][(j + 1) % NA], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj_from_bm('imac_shell', bm, MT.SHELL, smooth=True, uv_size=0)
    front_y = IM_FRONT - 0.002
    c = Vector((KX, IM_FRONT, IM_Z))
    # The face: a bone surround (the G3's front), the screen sunk in a black bezel, the chin with the mouth.
    SWD, SHT, SCZ = 0.25, 0.19, 0.045
    plate('imac_face', rounded_rect(0.335, 0.325, 0.075), [[(x, y + SCZ) for x, y in rounded_rect(SWD + 0.04, SHT + 0.04, 0.03)],
                                                          [(x, y - 0.118) for x, y in rounded_rect(0.13, 0.028, 0.013)]], 0.016, (c.x, front_y, c.z), MT.SHELL)
    plate('imac_bezel', rounded_rect(SWD + 0.04, SHT + 0.04, 0.03), [rounded_rect(SWD, SHT, 0.016)], 0.01, (c.x, front_y + 0.008, c.z + SCZ), MT.BEZEL)
    lip = rounded_rect(SWD + 0.05, SHT + 0.05, 0.034, 8)
    tube('imac_screenlip', [(c.x + x, front_y - 0.011, c.z + y + SCZ) for x, y in lip], [0.009] * len(lip), MT.BONE, cyclic=True)
    for k in range(24):   # small bone teeth along the lip, Giger's repeated studs
        x, y = lip[int(k / 24 * len(lip))]
        sphere(f'imac_stud{k}', (c.x + x * 1.045, front_y - 0.012, c.z + y * 1.06 + SCZ), 0.006, MT.BONE, scale=(1, 1.4, 1), seg=10)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); nu, nv = 24, 18; grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u, v = i / nu - 0.5, j / nv - 0.5
            bulge = 0.012 * (1 - (2 * u) ** 2) * (1 - (2 * v) ** 2)
            row.append(bm.verts.new((c.x + u * SWD, front_y + 0.012 - bulge, c.z + SCZ + v * SHT)))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l[uvl].uv = (ii / nu, jj / nv)
    obj_from_bm('imac_screen', bm, MT.SCREEN, smooth=True)
    # The mouth (the CD slot): swollen lips, the tray out like a tongue with a disc on it, drool to the board.
    mo = rounded_rect(0.135, 0.032, 0.015, 6)
    tube('imac_lips', [(c.x + x, front_y - 0.009, c.z + y - 0.118) for x, y in mo], [0.009] * len(mo), MT.LIPS, cyclic=True)
    box('imac_slot', (c.x, front_y + 0.01, c.z - 0.118), (0.12, 0.03, 0.018), MT.DARKGLASS)
    sphere('imac_tongue', (c.x, front_y - 0.05, c.z - 0.124), 0.06, MT.TONGUE, scale=(0.95, 1.0, 0.12))
    cyl('imac_cd', (c.x, front_y - 0.06, c.z - 0.114), 0.042, 0.0015, MT.CD, verts=48)
    gloop_strand('imac_drool', Vector((c.x - 0.035, front_y - 0.095, c.z - 0.126)), Vector((c.x - 0.032, front_y - 0.1, KTOP + 0.002)), 0.003)
    for sx in (-1, 1):    # gill slits for the speakers
        for k in range(3):
            g = box(f'imac_gill{sx}{k}', (c.x + sx * (0.112 - k * 0.013), front_y - 0.009, c.z - 0.11 + k * 0.004), (0.006, 0.012, 0.042), MT.DARKGLASS)
            g.rotation_euler = (0, math.radians(sx * (25 + k * 6)), 0)
    # Inside: a gunmetal skull-frame (hoops and a keel) that reads through the dome, the tube's neck, the creature.
    for k, s in enumerate((0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.86)):
        pts = [im_point(s, j / 28 * math.tau, inset=0.016) for j in range(28)]
        tube(f'imac_hoop{k}', pts, [0.008] * len(pts), MT.BONE, cyclic=True)
    keel = [im_point(s, math.pi / 2, inset=0.02) for s in (0.1, 0.3, 0.5, 0.7, 0.85, 0.95)]
    vertebral('imac_keel', keel, 0.009, lambda p: Vector((0, 0, -1)), ring_every=0.018, spine_every=1)
    cyl('imac_neck', (c.x, c.y + 0.12, c.z + 0.03), 0.105, 0.2, MT.DARKGLASS, rot=(math.radians(-90), 0, 0), r2=0.025)
    mb = bpy.data.metaballs.new('creature'); mb.resolution = 0.01; mb.render_resolution = 0.004; mb.threshold = 0.6
    cr = bpy.data.objects.new('creature', mb); C.dressing().objects.link(cr); cr.data.materials.append(MT.FLESH)
    VIS = 1 / 0.575
    def vb(p, r):
        el = mb.elements.new(); el.co = p; el.radius = r * VIS
    cc = Vector((c.x, c.y + 0.3, c.z + 0.0))
    head = cc + Vector((-0.06, -0.02, 0.05)); vb(head, 0.058)                 # the big head, near the dome's crown
    for k in range(10):      # the body curls round the tube's neck and back toward the tip
        a = math.radians(-20 + k * 30)
        vb(cc + Vector((math.cos(a) * 0.075, 0.02 + k * 0.009, -0.01 + math.sin(a) * 0.06)), 0.03 - k * 0.002)
    for k in range(5): vb(head.lerp(cc + Vector((0.07, 0.02, -0.01)), k / 4), 0.017)
    for sx in (-1, 1): vb(head + Vector((sx * 0.03, -0.04, -0.035)), 0.012); vb(head + Vector((sx * 0.04, -0.055, -0.055)), 0.009)
    C.to_mesh(cr)
    for k in range(7):       # vessels along the inside of the dome
        rnd = random.Random(40 + k); a0 = rnd.uniform(0, math.tau)
        pts = [im_point(0.05 + 0.13 * i, a0 + 0.25 * math.sin(i * 1.3 + k), inset=0.006) for i in range(7)]
        tube(f'imac_vessel{k}', pts, [0.0045] * len(pts), MT.FLESH)
    # The handle (the G3's cut-out, here a loop of vertebrae) and a bone crest down the cranium.
    hs = (0.4, 0.46, 0.53, 0.6)
    hp = [im_point(hs[0], math.pi / 2) + Vector((0, 0, -0.005))] + [im_point(s, math.pi / 2) + Vector((0, 0, 0.055 * math.sin((s - 0.4) / 0.2 * math.pi))) for s in hs[1:-1]] + [im_point(hs[-1], math.pi / 2) + Vector((0, 0, -0.005))]
    vertebral('imac_handle', hp, 0.012, lambda p: Vector((0, 0, 1)), ring_every=0.016, spine_every=2)
    crest = [im_point(s, math.pi / 2) + Vector((0, 0, 0.004)) for s in (0.64, 0.72, 0.8, 0.88, 0.95, 0.99)]
    vertebral('imac_crest', crest, 0.007, lambda p: Vector((0, 0.3, 1)), ring_every=0.016, spine_every=1)
    # Six beetle legs under the front half.
    for sx in (-1, 1):
        for k, s in enumerate((0.06, 0.24, 0.42)):
            hp_ = im_point(s, -math.pi / 2 + sx * 0.5, inset=0.01)
            hip = Vector((hp_.x, hp_.y, hp_.z))
            knee = hip + Vector((sx * 0.07, (s - 0.24) * 0.12, 0.03))
            foot = Vector((hip.x + sx * 0.12, hip.y + (s - 0.24) * 0.25, KTOP + 0.004))
            tube(f'imac_leg{sx}{k}a', [hip, hip.lerp(knee, 0.5) + Vector((0, 0, 0.012)), knee], [0.01, 0.009, 0.007], MT.GUN)
            tube(f'imac_leg{sx}{k}b', [knee, knee.lerp(foot, 0.5) + Vector((sx * 0.012, 0, 0)), foot], [0.007, 0.005, 0.0022], MT.BONE)
            sphere(f'imac_knee{sx}{k}', knee, 0.012, MT.BONE)
    # The umbilicus out of the tip, two lesser hoses: off the board, across the floor, into the wall by the window.
    tipp = im_point(0.97, 0.0)
    vertebral('umbilicus', [tipp, tipp + Vector((0.0, 0.06, -0.06)), Vector((KX + 0.06, KY + 0.46, KTOP - 0.08)),
                            Vector((KX + 0.2, KY + 0.62, FLOOR + 0.035)), Vector((0.5, 3.3, FLOOR + 0.035)), Vector((0.72, Y1 - 0.08, 0.22)), Vector((0.74, Y1 - 0.05, 0.42))],
               0.026, lambda p: Vector((0, 0, 1)), collar=((0.74, Y1 - 0.03, 0.46), (0, -1, 0.3)))
    for k, (sx, end) in enumerate(((-1, Vector((-0.35, 3.2, FLOOR + 0.02))), (1, Vector((0.6, 2.75, FLOOR + 0.02))))):
        a0 = im_point(0.8, -math.pi / 2 + sx * 0.6)
        tube(f'imac_hose{k}', [a0, a0 + Vector((sx * 0.06, 0.03, -0.06)), Vector((a0.x + sx * 0.12, a0.y + 0.12, KTOP - 0.05)), end.lerp(a0, 0.3), end],
             [0.012, 0.012, 0.011, 0.011, 0.01], MT.GUN)
    return front_y


def gloop_strand(name, a, b, r):
    pts = [a.lerp(b, t) + Vector((0, -0.004 * math.sin(t * math.pi), 0)) for t in (0, 0.3, 0.6, 1)]
    tube(name, pts, [r, r * 0.6, r * 0.5, r * 1.6], MT.MUCUS)


def build(m):
    global MT
    MT = m
    random.seed(11)
    giger_imac()
