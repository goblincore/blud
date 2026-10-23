# The butcher's axe, grafted on in place of the right hand (foreArm.r). Run after kit_sculpt.py + butcher_common.py.
# Three parts, all rigid on foreArm.r:
#   haft  - a bony collar biting into the wrist stump (staples, a rolled lip), a ribbed bone-metal haft continuing
#           the forearm's line, a back spike and a pommel spike: skullmetal, fused and AO-baked;
#   blade - a crescent head, thick at the haft and knife-thin at the edge, cheeks ribbed: NOT voxel-remeshed (a 1.6 mm
#           voxel rounds a 2 mm edge away), coloured steel -> rust -> blood toward the edge (make_spike.py's wear);
#   wheel - the reference figure's saw wheel at the heel of the blade.
# The edge faces the body's BACK at rest (blob -z). Pitching the arm forward turns a back-facing edge DOWN, so with
# the zombie's reaching arms the edge hangs under the haft, and raised overhead it faces forward: the chop leads
# with it. (The first cut faced it forward, and in the reach walk the edge pointed at the ceiling.)
import bpy, bmesh, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'haft', 'blade', 'wheel'}

E, W = JV['elbowR'], JV['wristR']
d = (W - E).normalized()                                 # haft axis: the forearm's line, carried past the wrist
back = bv(0, 0, -1)
b = (back - d * back.dot(d)).normalized()                # blade direction: the body's back at rest
n = d.cross(b).normalized()                              # the blade's thickness axis (~x)
at = lambda a, c=0.0, t=0.0: W + d * a + b * c + n * t   # a along the haft from the wrist, c toward the edge, t across

A_END = 0.46                                             # haft end, metres past the wrist

if 'haft' in PARTS:
    drop(['foreArm.r|haft']); clear_work()
    # graft collar: a flared bony cuff over the stump (the .blob's metal wrist core, r 0.050, sits inside)
    tube('cuff', [at(-0.06 + 0.10 * i / 20) for i in range(21)], [0.060 - 0.016 * (i / 20) ** 1.5 for i in range(21)], segs=24)
    ring('lip', at(-0.058), d, 0.060, 0.0075)
    ring('lip2', at(-0.02), d, 0.056, 0.005)
    for k in range(6):                                   # staples biting into the forearm flesh above the cuff
        a = 2 * math.pi * k / 6 + 0.3
        o = b * math.cos(a) + n * math.sin(a)
        tube(f'staple{k}', [at(-0.058) + o * 0.058, at(-0.085) + o * 0.064, at(-0.11) + o * 0.058], [0.0045, 0.005, 0.004], segs=8)
    S = [i / 60 for i in range(61)]
    tube('haft', [at(0.03 + (A_END - 0.03) * s) for s in S], [0.024 - 0.004 * s for s in S], segs=16)
    for a_ in (0.08, 0.14, 0.20):
        ring(f'grip{a_}', at(a_), d, 0.025, 0.0045)
    horn('pommel', at(A_END - 0.01), d, n, 0.10, 0.020, curl=0.25)
    horn('backspike', at(0.33, -0.015), -b + d * 0.15, n, 0.13, 0.020, curl=-0.5)
    tube('backcrest', [at(0.24 + 0.18 * s, -0.020 - 0.004 * sn(s)) for s in S], [0.004 + 0.005 * sn(s) for s in S], segs=8)
    o = fuse('haft', voxel=0.0016, smooth=(0.5, 3), noise=0.0012, noise_scale=0.02)
    decimate(o, 5000); bake_ao(o, 'skullmetal'); install(o, 'foreArm.r|haft'); clear_work()

if 'blade' in PARTS:
    drop(['foreArm.r|blade']); clear_work()
    NU, NV = 28, 64

    def attach(v):                                       # where the head meets the haft
        return 0.27 + 0.13 * v

    def edge(v):                                         # the crescent: a hooked horn above, a long beard below
        a = 0.03 + 0.55 * v
        c = 0.19 + 0.07 * math.sin(math.pi * v) ** 0.8
        return a, c

    def P2(u, v):
        ah = attach(v); ae, ce = edge(v)
        a = ah + (ae - ah) * u
        a += 0.07 * math.sin(math.pi * u) * ((1 - v) ** 3 - v ** 3)          # horn and beard swoop: a concave back
        c = 0.018 + (ce - 0.018) * u - 0.025 * math.sin(math.pi * u) * (1 - math.sin(math.pi * v))   # hollow ground cheeks
        return a, c

    def thick(u, v):                                     # half-thickness: 9 mm at the haft, 1 mm at the edge, thin horns
        return (0.009 * (1 - u) ** 1.4 + 0.0010) * (0.35 + 0.65 * math.sin(math.pi * min(1, max(0, v))) ** 0.5)

    bm = bmesh.new()
    G = [[[None, None] for _ in range(NV + 1)] for _ in range(NU + 1)]
    for i in range(NU + 1):
        for j in range(NV + 1):
            u, v = i / NU, j / NV
            a, c = P2(u, v); t = thick(u, v)
            G[i][j][0] = bm.verts.new(at(a, c, t)); G[i][j][1] = bm.verts.new(at(a, c, -t))
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((G[i][j][0], G[i + 1][j][0], G[i + 1][j + 1][0], G[i][j + 1][0]))
            bm.faces.new((G[i][j + 1][1], G[i + 1][j + 1][1], G[i + 1][j][1], G[i][j][1]))
    for j in range(NV):                                  # close the haft side and the edge
        for i in (0, NU):
            bm.faces.new((G[i][j][0], G[i][j + 1][0], G[i][j + 1][1], G[i][j][1]))
    for i in range(NU):                                  # close the two horn ends
        for j in (0, NV):
            bm.faces.new((G[i][j][0], G[i][j][1], G[i + 1][j][1], G[i + 1][j][0]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    blade = mkobj('blade', bm)
    # cheek ornament on both faces: a rolled ridge along the haft, chevron ribs raking toward the edge, a suture.
    # These are separate tubes joined (not remeshed) into the blade part.
    extra = []
    for side in (1, -1):
        R = [i / 30 for i in range(31)]
        extra.append(tube(f'ridge{side}', [at(*P2(0.08, 0.04 + 0.92 * s), side * (thick(0.08, 0.04 + 0.92 * s) + 0.001)) for s in R],
                          [0.0035 + 0.003 * sn(s) for s in R], segs=8))
        for k, v0 in enumerate((0.22, 0.42, 0.62, 0.80)):
            R = [i / 16 for i in range(17)]
            pts = [at(*P2(0.12 + 0.45 * s, v0 + 0.06 * s), side * (thick(0.12 + 0.45 * s, v0) + 0.0006)) for s in R]
            extra.append(tube(f'rib{side}{k}', pts, [0.0022 * (1 - 0.6 * s) for s in R], segs=6))
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in [blade] + extra: o.select_set(True)
    bpy.context.view_layer.objects.active = blade
    bpy.ops.object.join()
    for p in blade.data.polygons: p.use_smooth = True
    blade.data.materials.clear(); blade.data.materials.append(bpy.data.materials['plate'])
    ah0 = at(0.30, 0.0); ae0 = at(0.30, 0.28)
    def edgeness(vtx):
        c = (vtx.co - W).dot(b)
        return max(0.0, min(1.0, (c - 0.10) / 0.16))
    wear_colours(blade, Vector((0.80, 0.79, 0.76)), Vector((0.40, 0.20, 0.10)), Vector((0.30, 0.02, 0.02)),
                 ah0, ae0, rust_at=(0.15, 0.55), blood_at=(0.55, 0.95), edge=edgeness)
    install(blade, 'foreArm.r|blade'); clear_work()

if 'wheel' in PARTS:
    drop(['foreArm.r|wheel']); clear_work()
    cen = at(0.20, -0.03, 0.0)                           # behind the haft at the blade's heel, as on the reference
    bm = bmesh.new(); NT = 16; R0, R1 = 0.050, 0.066; hw = 0.0035
    e1 = d; e2 = b
    ring_pts = []
    for k in range(NT * 2):
        a = math.pi * k / NT
        r = R1 if k % 2 == 0 else R0
        a2 = a + (0.12 if k % 2 == 0 else 0)            # raked teeth
        ring_pts.append(cen + (e1 * math.cos(a2) + e2 * math.sin(a2)) * r)
    top = [bm.verts.new(p + n * hw) for p in ring_pts]; bot = [bm.verts.new(p - n * hw) for p in ring_pts]
    ct = bm.verts.new(cen + n * hw); cb = bm.verts.new(cen - n * hw)
    m = len(ring_pts)
    for k in range(m):
        bm.faces.new((ct, top[k], top[(k + 1) % m])); bm.faces.new((cb, bot[(k + 1) % m], bot[k]))
        bm.faces.new((top[k], bot[k], bot[(k + 1) % m], top[(k + 1) % m]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    wheel = mkobj('wheel', bm)
    hub = ring('hub', cen, n, 0.016, 0.006)
    for o in bpy.context.selected_objects: o.select_set(False)
    wheel.select_set(True); hub.select_set(True); bpy.context.view_layer.objects.active = wheel
    bpy.ops.object.join()
    wheel.data.materials.clear(); wheel.data.materials.append(bpy.data.materials['plate'])
    wear_colours(wheel, Vector((0.62, 0.60, 0.56)), Vector((0.42, 0.22, 0.10)), Vector((0.30, 0.02, 0.02)),
                 cen, cen + b * 0.06, rust_at=(-0.6, 0.4), blood_at=(0.2, 1.0))
    install(wheel, 'foreArm.r|wheel'); clear_work()
