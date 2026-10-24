# The flayer's saw-sickle, grafted on in place of the LEFT hand (foreArm.l): the owner's reference figure's long
# curved blade with a saw wheel at its root. Run after kit_sculpt.py + butcher_common.py (../butcher-kit/build.py).
#   collar - the graft: a bony cuff biting into the wrist stump (staples, rolled lips) and a short ribbed haft,
#            skullmetal, fused and AO-baked (make_axe.py's recipe);
#   blade  - a sickle ~0.6 m long, curving through ~115 deg, its CONCAVE edge serrated with raked teeth and a barb
#            hooking off the spine near the tip. A bmesh loft, never voxel-remeshed (that rounds the edge away), worn
#            white steel to dried blood toward the edge and tip like the reference;
#   wheel  - an 18-tooth saw wheel at the root, behind the spine, in a bony half-guard.
# Orientation (biomech-style.md, the axe): the blade leaves along the forearm and curves toward the body's BACK at
# rest, so with the zombie's reaching arms it hooks DOWN, a talon, and the concave edge faces the chop.
import bpy, bmesh, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'collar', 'blade', 'wheel'}

E, W = JV['elbowL'], JV['wristL']
d = (W - E).normalized()
back = bv(0, 0, -1)
b = (back - d * back.dot(d)).normalized()                # the curl's direction at rest
n = d.cross(b).normalized()                              # thickness axis (~x)
at = lambda a, c=0.0, t=0.0: W + d * a + b * c + n * t
ROOT = 0.10                                              # where the blade leaves the haft, past the wrist
L, CURL = 0.62, math.radians(115)


def theta(s):
    return CURL * s ** 1.35


def centre(s, steps=200):
    """Centreline point at fraction s: integrate the turning direction from the root."""
    p = at(ROOT); k = max(1, int(steps * s))
    for i in range(k):
        th = theta((i + 0.5) / steps)
        p = p + (d * math.cos(th) + b * math.sin(th)) * (L / steps)
    return p


def frame(s):
    th = theta(s)
    tan = d * math.cos(th) + b * math.sin(th)
    inner = -d * math.sin(th) + b * math.cos(th)         # toward the curl's centre: the concave, cutting side
    return tan, inner


if 'collar' in PARTS:
    drop(['foreArm.l|collar']); clear_work()
    tube('cuff', [at(-0.06 + 0.10 * i / 20) for i in range(21)], [0.054 - 0.014 * (i / 20) ** 1.5 for i in range(21)], segs=24)
    ring('lip', at(-0.058), d, 0.054, 0.007)
    ring('lip2', at(-0.02), d, 0.050, 0.0045)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        o = b * math.cos(a) + n * math.sin(a)
        tube(f'staple{k}', [at(-0.058) + o * 0.052, at(-0.085) + o * 0.058, at(-0.11) + o * 0.052], [0.004, 0.0045, 0.0036], segs=8)
    S = [i / 30 for i in range(31)]
    tube('haft', [at(0.02 + (ROOT + 0.02) * s) for s in S], [0.024 - 0.002 * s for s in S], segs=16)
    for a_ in (0.05, 0.09):
        ring(f'grip{a_}', at(a_), d, 0.025, 0.0045)
    tube('root', [centre(0.0) - d * 0.01 + d * (0.05 * s) for s in S], [0.020 + 0.006 * math.sin(math.pi * s) for s in S], segs=14)
    o = fuse('collar', voxel=0.0016, smooth=(0.5, 3), noise=0.0012, noise_scale=0.02)
    decimate(o, 4500); bake_ao(o, 'skullmetal'); install(o, 'foreArm.l|collar'); clear_work()

if 'blade' in PARTS:
    drop(['foreArm.l|blade']); clear_work()
    NS, NW = 120, 14
    TEETH = 22

    def width(s):                                        # spine-to-edge, tapering to the point
        # 0.11 at the root: the first cut at 0.062 read as a whip from the front (in-engine, 2026-10-22).
        return 0.110 * (1 - s) ** 0.85 * (0.55 + 0.45 * min(1.0, s / 0.08))

    def tooth(s):                                        # raked sawtooth along the inner edge, fading near the tip
        f = (s * TEETH) % 1.0
        return 0.014 * (f ** 1.8) * (1 - s) ** 0.5

    def half(u, s):                                      # half-thickness across the blade: thick spine, knife edge
        return (0.0080 * (1 - u) ** 1.3 + 0.0007) * (0.4 + 0.6 * (1 - s) ** 0.6)

    C = [centre(i / NS) for i in range(NS + 1)]
    bm = bmesh.new(); G = []
    for i in range(NS + 1):
        s = i / NS; tan, inner = frame(s)
        w = width(s) + tooth(s)
        row = []
        for j in range(NW + 1):
            u = j / NW
            p = C[i] - inner * 0.012 + inner * (w * u)       # spine slightly outside the centreline, edge inside
            h = half(u, s)
            row.append((bm.verts.new(p + n * h), bm.verts.new(p - n * h)))
        G.append(row)
    for i in range(NS):
        for j in range(NW):
            bm.faces.new((G[i][j][0], G[i + 1][j][0], G[i + 1][j + 1][0], G[i][j + 1][0]))
            bm.faces.new((G[i][j + 1][1], G[i + 1][j + 1][1], G[i + 1][j][1], G[i][j][1]))
    for i in range(NS):
        for j in (0, NW):
            bm.faces.new((G[i][j][0], G[i][j][1], G[i + 1][j][1], G[i + 1][j][0]))
    for j in range(NW):
        for i in (0, NS):
            bm.faces.new((G[i][j][0], G[i][j + 1][0], G[i][j + 1][1], G[i][j][1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    blade = mkobj('blade', bm)
    extra = []
    for side in (1, -1):                                 # a fuller ridge along each face near the spine
        R = [0.03 + 0.85 * i / 60 for i in range(61)]
        pts = []; rad = []
        for s in R:
            tan, inner = frame(s)
            pts.append(centre(s) - inner * 0.012 + inner * (width(s) * 0.22) + n * side * (half(0.22, s) + 0.0004))
            rad.append(0.0022 * (1 - s) ** 0.5 + 0.0006)
        extra.append(tube(f'fuller{side}', pts, rad, segs=6))
    # the barb: a second hook off the spine near the tip (the reference blade's double point)
    tan, inner = frame(0.80)
    extra.append(horn('barb', centre(0.80) - inner * 0.010, -inner * 0.8 - tan * 0.5, n, 0.075, 0.010, curl=0.9))
    tan, inner = frame(0.45)
    extra.append(horn('spur', centre(0.45) - inner * 0.010, -inner * 0.9 - tan * 0.6, n, 0.05, 0.008, curl=0.7))
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in [blade] + extra: o.select_set(True)
    bpy.context.view_layer.objects.active = blade
    bpy.ops.object.join()
    for p in blade.data.polygons: p.use_smooth = True
    blade.data.materials.clear(); blade.data.materials.append(bpy.data.materials['plate'])
    root = at(ROOT); tipp = centre(1.0)

    def edgeness(v):                                     # bloodier toward the cutting edge: distance inside the spine
        best = min(range(0, NS + 1, 4), key=lambda i: (C[i] - v.co).length_squared)
        tan, inner = frame(best / NS)
        return max(0.0, min(1.0, ((v.co - C[best]).dot(inner) + 0.012) / max(1e-4, width(best / NS))))
    wear_colours(blade, Vector((0.86, 0.85, 0.82)), Vector((0.45, 0.24, 0.12)), Vector((0.32, 0.02, 0.02)),
                 root, tipp, rust_at=(0.5, 0.9), blood_at=(0.25, 0.85), edge=edgeness)
    install(blade, 'foreArm.l|blade'); clear_work()

if 'wheel' in PARTS:
    drop(['foreArm.l|wheel']); clear_work()
    tan, inner = frame(0.0)
    cen = at(ROOT + 0.035) - inner * 0.050               # behind the spine at the blade's root
    bm = bmesh.new(); NT = 18; R0, R1 = 0.056, 0.074; hw = 0.003
    pts = []
    for k in range(NT * 2):
        a = math.pi * k / NT + (0.10 if k % 2 == 0 else 0)
        r = R1 if k % 2 == 0 else R0
        pts.append(cen + (d * math.cos(a) + b * math.sin(a)) * r)
    top = [bm.verts.new(p + n * hw) for p in pts]; bot = [bm.verts.new(p - n * hw) for p in pts]
    ct = bm.verts.new(cen + n * hw); cb = bm.verts.new(cen - n * hw); m = len(pts)
    for k in range(m):
        bm.faces.new((ct, top[k], top[(k + 1) % m])); bm.faces.new((cb, bot[(k + 1) % m], bot[k]))
        bm.faces.new((top[k], bot[k], bot[(k + 1) % m], top[(k + 1) % m]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    wheel = mkobj('wheel', bm)
    wheel.data.materials.clear(); wheel.data.materials.append(bpy.data.materials['plate'])
    wear_colours(wheel, Vector((0.66, 0.64, 0.60)), Vector((0.42, 0.22, 0.10)), Vector((0.30, 0.02, 0.02)),
                 cen, cen + (d * 0.7 + b * 0.7) * 0.08, rust_at=(-0.5, 0.5), blood_at=(0.1, 1.0))
    install(wheel, 'foreArm.l|wheel'); clear_work()
    # the guard: a bony half-hood over the wheel's back with a hub boss and bolts (skullmetal)
    R = [i / 40 for i in range(41)]
    hood = [cen + (d * math.cos(math.pi * (0.55 + 0.9 * u)) + b * math.sin(math.pi * (0.55 + 0.9 * u))) * (R1 + 0.010) for u in R]
    for side in (1, -1):
        tube(f'hood{side}', [p + n * side * 0.009 for p in hood], [0.006 + 0.004 * sn(u) for u in R], segs=10)
    tube('hoodtop', hood, [0.008 + 0.004 * sn(u) for u in R], segs=10)
    ball('hub', cen, 1.0, 0.016, 0.016, 0.016)
    for side in (1, -1):
        ring(f'hubr{side}', cen + n * side * 0.006, n, 0.020, 0.004)
    tube('strut', [cen, at(ROOT - 0.01)], [0.008, 0.010], segs=10)
    o = fuse('guard', voxel=0.0015, smooth=(0.5, 2), noise=0.001, noise_scale=0.02)
    decimate(o, 3000); bake_ao(o, 'skullmetal'); install(o, 'foreArm.l|guard'); clear_work()
