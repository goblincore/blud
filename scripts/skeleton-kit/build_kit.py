# scripts/skeleton-kit/build_kit.py
#
# THE SKELETON KIT, BUILT IN BLENDER. One low-poly mesh per skeleton segment of the zombie (the units the mesh skeleton
# already draws and the melt / gibs already drop: webgpu/skeleton-spike/contract.ts), authored in the body's REST
# WORLD frame against the rig data scripts/skeleton-kit/export-rig.ts writes. The game swaps each piece in for the
# surface-nets mesh of the same segment (webgpu/skeleton-spike/skeleton-kit.ts), so a piece needs no binding of its
# own: it rides its segment, and falls with its segment's group.
#
# Build and export, headless (scripts/skeleton-kit/build.sh does both steps):
#   npx tsx scripts/skeleton-kit/export-rig.ts zombie <zombie-rig.json>
#   blender -b --python scripts/skeleton-kit/build_kit.py -- <zombie-rig.json> public/assets/lab/skeleton-kit.glb
# To look at it in an open Blender (no export): KIT_RIG = '<zombie-rig.json>'; exec(open('scripts/skeleton-kit/build_kit.py').read())
#
# Every coordinate below is in GAME space: metres, +x the body's left, +y up, +z its front. Meshes are converted to
# Blender's z-up on creation and back on export (glTF is y-up), so the GLB's numbers are the game's.
#
# Shapes are lofts (a tube along a path with an elliptical section), ellipsoids and plates, left as separate closed
# shells that pass through each other: a condyle is an ellipsoid sunk into the shaft's end. The body's flesh is the
# limit on every one of them (a bone that leaves the flesh shows through the skin of a wounded body):
# scripts/skeleton-kit/check-kit.ts measures that, and the numbers here were set against it.
import bpy, bmesh, json, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RIG_PATH = argv[0] if len(argv) > 0 else globals().get('KIT_RIG')
OUT_PATH = argv[1] if len(argv) > 1 else globals().get('KIT_OUT')
RIG = json.load(open(RIG_PATH))
J = [Vector(p) for p in RIG['joints']]
SEG = {s['key']: s for s in RIG['segments']}


# ----------------------------------------------------------------------------------------------------------------
# Geometry helpers. A shell is (verts, faces) in game space.
# ----------------------------------------------------------------------------------------------------------------
class Shells:
    """The closed shells of one segment's mesh."""
    def __init__(self):
        self.verts, self.faces = [], []

    def add(self, verts, faces):
        base = len(self.verts)
        self.verts += [Vector(v) for v in verts]
        self.faces += [tuple(i + base for i in f) for f in faces]

    def mirrored(self):
        out = Shells()
        out.verts = [Vector((-v.x, v.y, v.z)) for v in self.verts]
        out.faces = [tuple(reversed(f)) for f in self.faces]
        return out

    def merge(self, other):
        self.add(other.verts, other.faces)
        return self


def V(x, y, z):
    return Vector((x, y, z))


def fuse(shells, keep, voxel=0.004, smooth=3):
    """ONE SURFACE, NOT A PILE OF TUBES (owner, 2026-11-16: "everything is made from prims atm ... it just looks like
    tubes everywhere"; the pelvis "would be better as a sculpted mesh"). The shells a builder laid down are the
    armature of a sculpt: they are fused into one volume (Blender's voxel remesh), the creases where one form ran
    into the next are smoothed away, and the surface is thinned to about `keep` vertices. Bones that do not touch
    (radius and ulna) stay apart."""
    me = bpy.data.meshes.new('fuse')
    me.from_pydata([tuple(v) for v in shells.verts], [], shells.faces)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('fuse', me)
    bpy.context.scene.collection.objects.link(ob)
    rm = ob.modifiers.new('fuse', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = voxel
    sm = ob.modifiers.new('soften', 'SMOOTH'); sm.factor = 0.5; sm.iterations = smooth
    n = len(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices)
    ob.modifiers.new('thin', 'DECIMATE').ratio = min(1.0, keep / max(n, 1))
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    out = ev.to_mesh()
    s = Shells()
    s.add([tuple(v.co) for v in out.vertices], [tuple(p.vertices) for p in out.polygons])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    return s


def lerp(a, b, t):
    return a + (b - a) * t


# A SOLID FRAME BEFORE FINE DETAIL (owner, 2026-11-16, in the game: the clavicles were "two thin bars", and "in general
# the bones should be more beefy - its okay to lose fine detail for a more solid frame"; detail can come from a normal
# map later). Every shaft, process and rim is modelled at its anatomical thickness and then scaled by the factor here,
# so the proportions between bones stay written where they were. Joint ends (heads, condyles, sockets) were already
# fat and are left alone. The toes are not scaled: they sit 4 mm under the foot's skin.
BEEF = {
    'clavicle': 1.9, 'scapula': 1.35, 'humerus': 1.45, 'forearm': 1.55, 'hand': 1.4,
    'femur': 1.4, 'tibia': 1.3, 'fibula': 1.7, 'metatarsal': 1.3,
    'process': 1.5, 'column': 1.3, 'crest': 1.45, 'ramus': 1.3,
}


def catmull(pts, per=4):
    """A Catmull-Rom curve through `pts`, `per` samples a span. Returns the points and each one's place 0..1 along the
    control polygon (by index), which is what radii are interpolated over."""
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        n = per * (len(pts) - 1)
        return [lerp(pts[0], pts[-1], i / n) for i in range(n + 1)], [i / n for i in range(n + 1)]
    out, us = [], []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    spans = len(pts) - 1
    for s in range(spans):
        p0, p1, p2, p3 = ext[s], ext[s + 1], ext[s + 2], ext[s + 3]
        for i in range(per):
            t = i / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            us.append((s + t) / spans)
    out.append(pts[-1]); us.append(1.0)
    return out, us


def radii_at(radii, u):
    """Linear interpolation over a list of radii (numbers or (rx, ry) pairs) at u in 0..1."""
    rs = [(r, r) if isinstance(r, (int, float)) else r for r in radii]
    x = u * (len(rs) - 1)
    i = min(int(x), len(rs) - 2) if len(rs) > 1 else 0
    f = x - i
    a, b = rs[i], rs[min(i + 1, len(rs) - 1)]
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def loft(path, radii, sides=8, up=(0, 0, 1), per=0, cap=0.7, beef=1.0):
    """A tube along `path`. `radii`: one entry per control point (a number, or (rx, ry): rx along the frame's `up`
    side, ry across it). `per` > 0 smooths the path with a Catmull-Rom curve first. Ends close on a tip pushed out
    `cap` of the end radius, so smooth shading rounds them. `beef` scales every radius (see BEEF)."""
    radii = [r * beef if isinstance(r, (int, float)) else (r[0] * beef, r[1] * beef) for r in radii]
    if per > 0:
        pts, us = catmull(path, per)
    else:
        pts = [Vector(p) for p in path]
        us = [i / (len(pts) - 1) for i in range(len(pts))]
    n = len(pts)
    tans = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(t.normalized())
    nrm = Vector(up) - tans[0] * Vector(up).dot(tans[0])
    if nrm.length < 1e-6:
        nrm = tans[0].orthogonal()
    nrm.normalize()
    verts, faces = [], []
    for i in range(n):
        if i > 0:   # parallel transport
            nrm = nrm - tans[i] * nrm.dot(tans[i])
            nrm.normalize()
        bi = tans[i].cross(nrm)
        rx, ry = radii_at(radii, us[i])
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(pts[i] + nrm * (rx * math.cos(a)) + bi * (ry * math.sin(a)))
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    r0, r1 = radii_at(radii, 0), radii_at(radii, 1)
    tip0 = len(verts); verts.append(pts[0] - tans[0] * (min(r0) * cap))
    tip1 = len(verts); verts.append(pts[-1] + tans[-1] * (min(r1) * cap))
    for k in range(sides):
        faces.append((tip0, (k + 1) % sides, k))
        faces.append((tip1, (n - 1) * sides + k, (n - 1) * sides + (k + 1) % sides))
    return verts, faces


def ellipsoid(c, r, segs=8, rings=5, axes=None):
    """An ellipsoid at `c` with semi-axes `r` along `axes` (three vectors; the world's when omitted)."""
    c = Vector(c)
    ax = [Vector(a).normalized() for a in axes] if axes else [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]
    verts, faces = [c + ax[1] * r[1]], []
    for j in range(1, rings):
        ph = math.pi * j / rings
        for k in range(segs):
            th = 2 * math.pi * k / segs
            verts.append(c + ax[0] * (r[0] * math.sin(ph) * math.cos(th)) + ax[1] * (r[1] * math.cos(ph)) + ax[2] * (r[2] * math.sin(ph) * math.sin(th)))
    verts.append(c - ax[1] * r[1])
    last = len(verts) - 1
    for k in range(segs):
        faces.append((0, 1 + (k + 1) % segs, 1 + k))
        faces.append((last, 1 + (rings - 2) * segs + k, 1 + (rings - 2) * segs + (k + 1) % segs))
    for j in range(rings - 2):
        for k in range(segs):
            a, b = 1 + j * segs + k, 1 + j * segs + (k + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    return verts, faces


def plate(outline, thick, bulge=0.0, inset=0.22, smooth=0):
    """A thin lens-edged plate over a closed outline (which need not be flat): the outline is its rim, and each face
    is the outline drawn in toward the middle and lifted half the thickness, closed on a centre point. `bulge` lifts
    both centres along the plate's normal (a dished blade). `smooth` > 0 rounds the outline with a closed curve."""
    pts = [Vector(p) for p in outline]
    if smooth > 0:
        n = len(pts); out = []
        for s in range(n):
            p0, p1, p2, p3 = pts[(s - 1) % n], pts[s], pts[(s + 1) % n], pts[(s + 2) % n]
            for i in range(smooth):
                t = i / smooth
                out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
        pts = out
    n = len(pts)
    c = sum(pts, Vector()) / n
    nrm = Vector()
    for i in range(n):
        nrm += (pts[i] - c).cross(pts[(i + 1) % n] - c)
    nrm.normalize()
    h = thick / 2
    verts = list(pts)
    verts += [lerp(p, c, inset) + nrm * h for p in pts]
    verts += [lerp(p, c, inset) - nrm * h for p in pts]
    top = len(verts); verts.append(c + nrm * (h + bulge))
    bot = len(verts); verts.append(c - nrm * (h - bulge))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((j, i, 2 * n + i, 2 * n + j))
        faces.append((n + i, n + j, top))
        faces.append((2 * n + j, 2 * n + i, bot))
    return verts, faces


# ----------------------------------------------------------------------------------------------------------------
# The spine: one curve from the sacral promontory to the atlas, which every vertebra and every rib head sits on.
# ----------------------------------------------------------------------------------------------------------------
# (y, z) of the vertebral bodies' centres. The lumbar is short and the hips are high because the rig's are (its hip
# joints sit at the top of the pelvis bone, y 1.06): the column starts on the sacrum at y 1.035.
SPINE_YZ = [(1.035, -0.050), (1.065, -0.047), (1.100, -0.058), (1.167, -0.074), (1.245, -0.070), (1.320, -0.038),
            (1.400, 0.018), (1.440, 0.036), (1.490, 0.056), (1.545, 0.078)]
SPINE_PTS, _ = catmull([V(0, y, z) for y, z in SPINE_YZ], 12)


def spine_at(y):
    """The column's centre and its unit tangent at height y."""
    for i in range(len(SPINE_PTS) - 1):
        a, b = SPINE_PTS[i], SPINE_PTS[i + 1]
        if a.y <= y <= b.y:
            return lerp(a, b, (y - a.y) / (b.y - a.y)), (b - a).normalized()
    return (SPINE_PTS[0], (SPINE_PTS[1] - SPINE_PTS[0]).normalized()) if y < SPINE_PTS[0].y else (SPINE_PTS[-1], (SPINE_PTS[-1] - SPINE_PTS[-2]).normalized())


Y_SACRUM, Y_L1, Y_T1, Y_C1 = 1.035, 1.150, 1.400, 1.545   # column heights: lumbar | thoracic | cervical


def vertebra(y, h, rx, rz, spinous, drop, trans):
    """One vertebra at height y: a spool body, a spinous process out the back and a transverse process each side."""
    c, t = spine_at(y)
    side = V(1, 0, 0)
    back = side.cross(t).normalized()
    if back.z > 0:
        back = -back
    s = Shells()
    s.add(*loft([c - t * (h * 0.42), c, c + t * (h * 0.42)], [(rx * 1.06, rz * 1.06), (rx * 0.9, rz * 0.9), (rx * 1.06, rz * 1.06)], sides=8, up=side, cap=0.25))
    root = c + back * (rz * 0.85)
    s.add(*loft([root, root + back * (spinous * 0.55) - t * (drop * 0.4), root + back * spinous - t * drop], [(0.0055, 0.0045), (0.004, 0.0035), (0.0028, 0.0026)], sides=5, up=side, beef=BEEF['process']))
    for sg in (1, -1):
        s.add(*loft([c + back * (rz * 0.6) + side * (sg * rx * 0.7), c + back * (rz * 0.95) + side * (sg * (rx + trans))], [0.0045, 0.0032], sides=4, up=t, beef=BEEF['process']))
    return s


def column(y0, y1, r):
    """The discs: one thin tube through the bodies, so no vertebra hangs in the air between its neighbours."""
    ys = [lerp(y0, y1, i / 12) for i in range(13)]
    return loft([spine_at(y)[0] for y in ys], [r] * 13, sides=6, up=(1, 0, 0), cap=0.2, beef=BEEF['column'])


def build_spine():
    cage, neck = Shells(), Shells()
    hl = (Y_L1 - Y_SACRUM) / 5
    for i in range(5):       # L5 .. L1
        cage.merge(vertebra(Y_SACRUM + hl * (i + 0.5), hl, 0.0195, 0.0145, 0.014, 0.002, 0.014))
    ht = (Y_T1 - Y_L1) / 12
    for i in range(12):      # T12 .. T1
        f = i / 11
        cage.merge(vertebra(Y_L1 + ht * (i + 0.5), ht, lerp(0.0175, 0.0135, f), lerp(0.0135, 0.0105, f), 0.011, 0.008, 0.011))
    cage.add(*column(Y_SACRUM - 0.004, Y_T1 + 0.004, 0.0105))
    hc = (Y_C1 - Y_T1) / 7
    for i in range(7):       # C7 .. C1
        f = i / 6
        neck.merge(vertebra(Y_T1 + hc * (i + 0.5), hc, lerp(0.0125, 0.0115, f), lerp(0.0095, 0.0085, f), lerp(0.012, 0.006, f), 0.003, lerp(0.008, 0.010, f)))
    neck.add(*column(Y_T1 - 0.006, Y_C1 + 0.004, 0.0075))
    return cage, neck


# ----------------------------------------------------------------------------------------------------------------
# The ribcage: the extracted cage's own ribs and sternum.
# ----------------------------------------------------------------------------------------------------------------
RIB_KEEP = 0.5   # the share of the extraction's triangles the kit keeps


def build_ribs():
    """THE OLD CAGE'S RIBS AND STERNUM, as the game extracted them (owner, 2026-11-16, after two modelled cages, ten
    flat ribs and then six fat ones: "i honestly prefer the old ribcage ... a bit flat, the way the ribs go into the
    sternum seamlessly", with the kit's sacrum and spine). export-rig.ts extracts the surface of the chest's rib and
    sternum bars alone (zombie.blob: six hoops a side, each two bars meeting at the flank, and one flat sternum) and
    it is welded here, thinned to RIB_KEEP of its triangles, and set on the kit's vertebrae: the rib heads were
    authored 1.7 cm either side of the same spine line the column follows."""
    src = RIG['ribcage']
    me = bpy.data.meshes.new('ribcage-src')
    me.from_pydata([tuple(v) for v in src['verts']], [], [tuple(t) for t in src['tris']])
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('ribcage-src', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('thin', 'DECIMATE').ratio = RIB_KEEP
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    out = ev.to_mesh()
    s = Shells()
    s.add([tuple(v.co) for v in out.vertices], [tuple(p.vertices) for p in out.polygons])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    top = max((Vector(v) for v in src['verts'] if abs(v[0]) < 0.012), key=lambda v: v.y)   # the sternum's top
    top = V(0, top.y, top.z)
    # THE MANUBRIUM: a broad block on the sternum's top, which each clavicle's inner end is sunk into (build_shoulder),
    # so the collarbones grow out of the chest instead of ending beside it (owner, 2026-11-16: "the clavicle needs to
    # fuse properly with the ribcage top").
    s.add(*ellipsoid(top + V(0, -0.012, -0.004), (0.036, 0.021, 0.0125), segs=10, rings=6))
    return s, top


# ----------------------------------------------------------------------------------------------------------------
# The pelvis: sacrum and coccyx, and each side an iliac wing, a socket at the rig's hip joint and the pubic ring.
# ----------------------------------------------------------------------------------------------------------------
# WHERE THE HIP JOINT IS DRAWN. The rig's hip points sit at the top of its pelvis bone (y 1.06), waist height, about
# 14 cm above a person's hip joint; the flesh was moved off them on 2026-11-05 (zombie.blob: the thigh tube starts
# 8 cm down the thigh, "the legs were too far up and on the side of the body"). The first kit put the femoral head on
# the rig's hip point, so the pelvis sat under the ribs and the femurs flared out at the waist (owner, 2026-11-16:
# "the pelvic bone and accompanying leg bones are a bit too high up ... and to the side"). The head is now drawn where
# the flesh thigh begins: HIP_DROP below the rig's hip point and HIP_IN toward the middle. The thigh still turns about
# the rig's point, so in a stride the head rides a short arc in its socket (HIP_DROP x the sine of the swing).
HIP_DROP, HIP_IN = 0.080, 0.014
PELVIS_DROP = 0.065      # the hip bones come down with the sockets; the crest lands at y ~1.04


def femoral_head():
    return J[11] + V(-HIP_IN, -HIP_DROP, 0)


def build_sacrum():
    """Sacrum and coccyx. They are part of the CAGE's piece, rigid with the lumbar column: the rig's hips swing 3-5 cm
    against the base of its spine in a stride, so the two hip bones (the pelvis piece, which follows the hips) and
    the sacrum cannot be one rigid thing without either the femoral heads leaving their sockets or the column leaving
    the sacrum. The sacrum slides between the hip bones instead, where a pelvis has its sacro-iliac joints."""
    return loft([V(0, 1.042, -0.050), V(0, 1.010, -0.058), V(0, 0.975, -0.064), V(0, 0.940, -0.062), V(0, 0.905, -0.050), V(0, 0.885, -0.038)],
                [(0.022, 0.015), (0.032, 0.015), (0.036, 0.014), (0.024, 0.011), (0.010, 0.0065), (0.004, 0.0035)], sides=8, up=(1, 0, 0), per=2)


def build_pelvis():
    s = Shells()
    hip = J[11]
    L = Shells()
    # Iliac wing: PSIS, along the crest to the ASIS, down the front to the socket, back along the notch to the sacrum.
    L.add(*plate([V(0.030, 1.054, -0.066), V(0.080, 1.094, -0.054), V(0.130, 1.102, -0.014), V(0.134, 1.084, 0.032), V(0.116, 1.056, 0.050),
                  V(0.094, 1.030, 0.030), V(0.080, 1.014, -0.006), V(0.058, 1.008, -0.040), V(0.030, 1.018, -0.060)], 0.020, bulge=-0.004, inset=0.3, smooth=2))
    # The back of the wing, thick where it laps the sacrum: the sacrum slides behind it (build_sacrum).
    L.add(*ellipsoid(V(0.040, 1.034, -0.056), (0.020, 0.030, 0.013), segs=8, rings=5))
    # Crest: the thick rim over the wing.
    L.add(*loft([V(0.030, 1.056, -0.067), V(0.081, 1.096, -0.055), V(0.131, 1.104, -0.014), V(0.135, 1.086, 0.032), V(0.118, 1.058, 0.051)],
                [0.0065, 0.007, 0.0075, 0.007, 0.0065], sides=6, per=3, beef=BEEF['crest']))
    # The socket: a thick collar the femoral head sits in.
    L.add(*ellipsoid(hip + V(-0.016, -0.010, 0.000), (0.026, 0.034, 0.034), segs=10, rings=6))
    # Superior pubic ramus to the symphysis; ischium down to the sit bone; the ramus that closes the ring under them.
    sym_t, sym_b, sit = V(0.006, 0.992, 0.062), V(0.008, 0.968, 0.056), V(0.052, 0.948, -0.030)
    L.add(*loft([hip + V(-0.022, -0.024, 0.022), V(0.045, 1.012, 0.052), sym_t], [0.011, 0.009, 0.010], sides=6, per=3, beef=BEEF['ramus']))
    L.add(*loft([hip + V(-0.022, -0.030, -0.012), V(0.064, 0.985, -0.026), sit], [0.013, 0.012, 0.015], sides=6, per=3, beef=BEEF['ramus']))
    L.add(*loft([sit, V(0.036, 0.950, 0.016), sym_b], [0.011, 0.0075, 0.009], sides=6, per=3, beef=BEEF['ramus']))
    L.add(*ellipsoid(V(0, 0.980, 0.059), (0.009, 0.018, 0.008), segs=6, rings=4))   # the symphysis itself
    # Everything above was laid out round the rig's hip point; it comes down as one, and the socket goes to the head.
    head = femoral_head()
    L.verts = [v + V(0, -PELVIS_DROP, 0) for v in L.verts]
    L.add(*ellipsoid(head + V(-0.010, 0.004, 0.000), (0.026, 0.034, 0.034), segs=10, rings=6))
    s.merge(L); s.merge(L.mirrored())
    return s


# ----------------------------------------------------------------------------------------------------------------
# The shoulder girdle (the shoulder ball's segment: it turns about the shoulder joint with the rig's clavicle bone).
# ----------------------------------------------------------------------------------------------------------------
def build_shoulder(sternum_top):
    s = Shells()
    sh = J[5]
    # Clavicle: sternal end on the manubrium, an S to the acromion.
    s.add(*loft([V(0.010, sternum_top.y - 0.010, sternum_top.z - 0.004), V(0.066, 1.386, 0.074), V(0.126, 1.398, 0.047), V(0.184, 1.412, 0.028)],
                [(0.0085, 0.007), (0.0065, 0.006), (0.0065, 0.006), (0.009, 0.006)], sides=7, up=(0, 0, 1), per=4, beef=BEEF['clavicle']))
    # Scapula: the blade on the back of the ribs, its spine rising to the acromion over the joint, the socket, the coracoid.
    # The blade: a broad rounded paddle, not a dagger (owner, 2026-11-16: "the shoulder blades look too pointy"). Its
    # lower end is a wide curve 3 cm higher than a real inferior angle would hang.
    s.add(*plate([V(0.088, 1.394, -0.032), V(0.081, 1.346, -0.050), V(0.083, 1.306, -0.057), V(0.096, 1.289, -0.058), V(0.120, 1.287, -0.054),
                  V(0.138, 1.302, -0.044), V(0.152, 1.342, -0.024), V(0.166, 1.392, -0.002), V(0.130, 1.398, -0.016)], 0.011, bulge=0.003, inset=0.3, smooth=3))
    s.add(*loft([V(0.094, 1.370, -0.046), V(0.140, 1.394, -0.028), V(0.178, 1.416, -0.006), V(0.194, 1.422, 0.020)],
                [(0.004, 0.006), (0.0045, 0.007), (0.005, 0.009), (0.005, 0.010)], sides=6, up=(0, 1, 0), per=3, beef=BEEF['scapula']))
    s.add(*ellipsoid(sh + V(-0.027, -0.012, -0.024), (0.010, 0.018, 0.014), segs=8, rings=5))
    s.add(*loft([V(0.164, 1.396, 0.000), V(0.168, 1.398, 0.024), V(0.176, 1.388, 0.040)], [0.006, 0.005, 0.0045], sides=5, per=2, beef=BEEF['scapula']))
    return s


# ----------------------------------------------------------------------------------------------------------------
# The arm.
# ----------------------------------------------------------------------------------------------------------------
def build_humerus():
    s = Shells()
    a, b = J[5], J[7]
    P = lambda t: lerp(a, b, t)
    s.add(*loft([P(0.045), P(0.16), P(0.5), P(0.84), P(0.955)], [(0.0165, 0.016), (0.0125, 0.0125), (0.0105, 0.0105), (0.012, 0.0105), (0.021 / BEEF['humerus'], 0.011)], sides=8, up=(1, 0, 0), per=3, beef=BEEF['humerus']))
    s.add(*ellipsoid(a + V(-0.006, -0.004, -0.003), (0.021, 0.021, 0.021), segs=10, rings=6))          # head, in the socket
    s.add(*ellipsoid(a + V(0.011, -0.014, 0.002), (0.011, 0.015, 0.012)))                              # greater tubercle
    ax = (b - a).normalized()
    hinge = V(1, 0, 0) - ax * ax.x
    s.add(*ellipsoid(b - ax * 0.006, (0.027, 0.011, 0.0125), segs=10, rings=5, axes=(hinge, ax, hinge.cross(ax))))   # condyles
    return s


def build_forearm():
    s = Shells()
    a, b = J[7], J[9]
    # Ulna: the olecranon behind the elbow, thinning to the wrist.
    s.add(*loft([a + V(-0.004, 0.014, -0.012), a + V(-0.007, -0.016, -0.009), lerp(a, b, 0.5) + V(-0.010, 0, -0.006), lerp(a, b, 0.885) + V(-0.010, 0, -0.005)],
                [0.0105, 0.0095, 0.0068, 0.0052], sides=7, per=3, beef=BEEF['forearm']))
    # Radius: a small head at the elbow, widening to the wrist.
    s.add(*loft([a + V(0.010, -0.010, 0.007), a + V(0.011, -0.034, 0.007), lerp(a, b, 0.5) + V(0.010, 0, 0.006), lerp(a, b, 0.89) + V(0.008, 0, 0.006)],
                [0.0088, 0.0062, 0.0072, (0.013 / BEEF['forearm'], 0.0085)], sides=7, up=(1, 0, 0), per=3, beef=BEEF['forearm']))
    return s


# The flesh hand's fingers and thumb, copied from zombie.blob's HANDS block (2026-11-22; rolled palm-back, as there): (from, to, flesh r, flesh r2,
# offset, tip, bend), on the forearm (J[7] -> J[9]) past its tail, left side. A flesh finger is a quadratic Bezier
# capsule: a = forearm(from) + offset, b = forearm(to) + offset + tip, control = (a + b) / 2 + bend. Keep in step with
# the .blob: check-kit.ts fails a bone that leaves the flesh.
HAND_DIGITS = [
    (1.27, 1.55, 0.0120, 0.0080, (-0.0307, -0.0046, 0.0003), (-0.0189, 0.0157, -0.0348), (-0.0015, -0.0156, 0.0168)),     # index
    (1.27, 1.57, 0.0125, 0.0085, (-0.0089, -0.0013, 0.0001), (-0.0072, 0.0183, -0.0379), (0.0016, -0.0161, 0.0178)),     # middle
    (1.27, 1.55, 0.0120, 0.0080, (0.0129, 0.0019, -0.0001), (0.0048, 0.0192, -0.0360), (0.0044, -0.0147, 0.0167)),  # ring
    (1.25, 1.47, 0.0105, 0.0072, (0.0336, 0.0050, -0.0003), (0.0154, 0.0171, -0.0289), (0.0059, -0.0116, 0.0136)),  # little
]
HAND_THUMB = (1.06, 1.30, 0.0145, 0.0095, (-0.0455, -0.0074, -0.0115), (-0.0117, 0.0091, -0.0265), (-0.0047, -0.0084, 0.0084))


def flesh_curve(digit, n=6):
    """Points along a flesh digit's centre line, root to tip."""
    t0, t1, _, _, off, tip, bend = digit
    fa = lambda t: J[7] + (J[9] - J[7]) * t
    a = fa(t0) + V(*off)
    b = fa(t1) + V(*off) + V(*tip)
    c = (a + b) * 0.5 + V(*bend)
    return [a * (1 - u) ** 2 + c * (2 * u * (1 - u)) + b * u * u for u in (i / (n - 1) for i in range(n))]


def build_hand():
    """The hand's bones inside the flesh hand (zombie.blob HANDS, 2026-11-22): carpals under the wrist, a metacarpal
    down the palm to each knuckle, then each finger's phalanges along its own hooked flesh curve, ending short of the
    flesh tip; the thumb the same off the palm's front edge. Bone radius ~40% of the flesh's (x BEEF)."""
    s = Shells()
    w = J[9]
    d = (J[9] - J[7]).normalized()               # down the forearm
    pm = V(0, 0, -1); pm = (pm - d * pm.dot(d)).normalized()     # the palm's side: BACK (the hand is rolled palm-back, zombie.blob)
    kz = d.cross(pm).normalized()
    if kz.x > 0:                                 # the thumb side: toward the thigh (-x), the hand rolled palm-back
        kz = -kz
    s.add(*ellipsoid(w + d * 0.024, (0.007, 0.012, 0.019), segs=8, rings=4, axes=(pm, d, kz)))            # carpals
    for digit in HAND_DIGITS:
        pts = flesh_curve(digit)
        root = pts[0]
        k0 = w + d * 0.030 + (root - w - d * (root - w).dot(d)) * 0.55
        s.add(*loft([k0, root], [0.0034, 0.0040], sides=5, beef=BEEF['hand']))                                            # metacarpal
        tip = pts[-1] + (pts[-2] - pts[-1]).normalized() * digit[3] * 0.55   # stop short of the flesh's rounded tip
        s.add(*loft(pts[:-1] + [tip], [0.0040, 0.0036, 0.0033, 0.0030, 0.0027, 0.0024], sides=5, beef=BEEF['hand']))   # phalanges
    pts = flesh_curve(HAND_THUMB)
    t0 = w + d * 0.028 + kz * 0.006 + pm * 0.002
    tip = pts[-1] + (pts[-2] - pts[-1]).normalized() * HAND_THUMB[3] * 0.55
    s.add(*loft([t0, pts[1]], [0.0032, 0.0034], sides=5, beef=BEEF['hand']))                                              # thumb metacarpal
    s.add(*loft(pts[1:-1] + [tip], [0.0034, 0.0034, 0.0032, 0.0029, 0.0026], sides=5, beef=BEEF['hand']))                # thumb
    return s


# ----------------------------------------------------------------------------------------------------------------
# The leg.
# ----------------------------------------------------------------------------------------------------------------
def build_femur():
    s = Shells()
    hip, knee = J[11], J[12]
    head = femoral_head()
    tro = V(head.x + 0.036, head.y - 0.014, -0.005)                                                      # greater trochanter
    s.add(*ellipsoid(head, (0.022, 0.022, 0.022), segs=10, rings=6))                                     # head, in the socket
    s.add(*loft([head + V(0.006, -0.003, 0), tro + V(-0.006, 0.002, 0.001)], [0.0135, 0.0125], sides=7, beef=1.2))   # neck
    s.add(*ellipsoid(tro, (0.014, 0.021, 0.016)))
    s.add(*loft([tro + V(-0.003, -0.008, 0.001), V(0.116, 0.880, 0.002), V(0.110, 0.780, 0.005), V(0.103, 0.660, 0.002), knee + V(0, 0.026, 0)],
                [(0.016, 0.015), 0.0135, 0.0125, (0.0145, 0.0135), (0.030 / BEEF['femur'], 0.019)], sides=8, up=(1, 0, 0), per=3, beef=BEEF['femur']))
    for sg in (1, -1):
        s.add(*ellipsoid(knee + V(sg * 0.020, 0.012, -0.006), (0.017, 0.021, 0.025)))                    # condyles
    s.add(*ellipsoid(knee + V(0, 0.016, 0.027), (0.015, 0.017, 0.010), segs=8, rings=4))               # kneecap
    return s


def build_shin():
    s = Shells()
    knee, ankle = J[12], J[15]
    s.add(*ellipsoid(knee + V(0, -0.016, 0.000), (0.034, 0.013, 0.025), segs=10, rings=4))               # tibial plateau
    s.add(*loft([knee + V(0, -0.022, 0.002), V(0.097, 0.500, 0.009), V(0.096, 0.300, 0.015), V(0.098, 0.150, 0.022), ankle + V(0, 0.016, -0.001)],
                [(0.021 / BEEF['tibia'], 0.019 / BEEF['tibia']), 0.0155, 0.0125, 0.012, (0.019, 0.015)], sides=8, up=(1, 0, 0), per=3, beef=BEEF['tibia']))
    s.add(*ellipsoid(ankle + V(-0.019, 0.004, -0.001), (0.008, 0.015, 0.011)))                           # inner ankle
    s.add(*loft([V(0.128, 0.566, -0.008), V(0.128, 0.400, -0.004), V(0.123, 0.200, 0.010), ankle + V(0.021, 0.004, -0.003)],
                [0.009, 0.0052, 0.0048, 0.0085], sides=6, per=3, beef=BEEF['fibula']))                                         # fibula, to the outer ankle
    return s


def build_ankle():
    s = Shells()
    # The talus, a stout column from the ankle joint down to the point the foot turns about (4.5 cm under it): the
    # ankle's segment only turns with the body, so the column stays plumb under the shin, as the rig's own link does.
    s.add(*loft([J[15] + V(0, 0.004, 0), J[15] + V(0, -0.044, 0.002)], [(0.019, 0.019), (0.021, 0.022)], sides=8, up=(1, 0, 0), cap=0.5))                                # talus
    return s


def build_foot():
    s = Shells()
    s.add(*ellipsoid(V(0.100, 0.040, -0.004), (0.018, 0.024, 0.030)))                                    # heel
    s.add(*ellipsoid(V(0.100, 0.052, 0.046), (0.025, 0.018, 0.031)))                                     # tarsals
    for i, o in enumerate((-0.020, -0.010, 0.0, 0.010, 0.020)):
        m0, m1 = V(0.100 + o * 0.8, 0.052, 0.068), V(0.100 + o * 1.1, 0.028, 0.150)
        big = i == 0
        s.add(*loft([m0, m1], [0.0062 if big else 0.0052, 0.0058 if big else 0.0048], sides=5, beef=BEEF['metatarsal']))          # metatarsal
        s.add(*loft([m1, V(m1.x, 0.023, 0.150 + (0.040 if big else 0.034 - 0.004 * i))], [0.0052 if big else 0.0042, 0.004 if big else 0.0032], sides=5))   # toe
    return s


# ----------------------------------------------------------------------------------------------------------------
# Assemble: one object per segment key, left pieces mirrored onto the right's keys, and export.
# ----------------------------------------------------------------------------------------------------------------
cage, neck = build_spine()
ribs, sternum_top = build_ribs()
cage.merge(ribs)
cage.add(*build_sacrum())
KIT = {
    'axial:0-1': fuse(build_pelvis(), 1150), 'axial:1-2': cage, 'axial:2-3': neck,
}
for lkey, rkey, shells in (
    ('limb:armL:5-5', 'limb:armR:6-6', fuse(build_shoulder(sternum_top), 350)), ('limb:armL:5-7', 'limb:armR:6-8', fuse(build_humerus(), 260)),
    ('limb:armL:7-9', 'limb:armR:8-10', fuse(build_forearm(), 200)), ('limb:armL:9-9', 'limb:armR:10-10', fuse(build_hand(), 480, voxel=0.003, smooth=2)),
    ('limb:legL:11-12', 'limb:legR:13-14', fuse(build_femur(), 340)), ('limb:legL:12-15', 'limb:legR:14-16', fuse(build_shin(), 280)),
    ('limb:legL:15-15', 'limb:legR:16-16', build_ankle()), ('limb:legL:15-17', 'limb:legR:16-18', fuse(build_foot(), 240, voxel=0.003, smooth=2)),
):
    KIT[lkey] = shells
    KIT[rkey] = shells.mirrored()

# THE FRAME A PIECE RIDES, where it is not its segment's own (webgpu/skeleton-spike/skeleton-kit.ts kitSources):
#   span: turned by a width line and an up line of the rig, and held by the middle of the width line. The hip bones
#         follow the two hip joints, so each femoral head stays in its socket.
#   aim:  turned with a rig bone about the segment's own origin. The clavicle and scapula follow the rig's clavicle
#         bone about the shoulder joint, so the clavicle's inner end stays at the top of the chest.
def vec(v):
    return [round(c, 6) for c in v]


FRAMES = {
    'axial:0-1': {'kind': 'span', 'lat': [11, 13], 'up': [1, 2], 'restLat': vec(J[11] - J[13]), 'restUp': vec(J[2] - J[1]), 'restHold': vec((J[11] + J[13]) / 2)},
    'limb:armL:5-5': {'kind': 'aim', 'head': 2, 'tail': 5, 'restDir': vec((J[5] - J[2]).normalized())},
    'limb:armR:6-6': {'kind': 'aim', 'head': 2, 'tail': 6, 'restDir': vec((J[6] - J[2]).normalized())},
}

missing = [k for k in KIT if k not in SEG]
if missing:
    raise RuntimeError(f'kit pieces with no segment in the rig data: {missing}')

# Headless, the kit is built in the file's own scene and exported. In an open Blender it is built in a scene of its
# own, for looking at, and nothing is exported (an export from a scene the window does not show took Blender down).
if bpy.app.background:
    scene = bpy.context.scene
else:
    scene = bpy.data.scenes.get('skeleton_kit') or bpy.data.scenes.new('skeleton_kit')
for o in list(scene.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)

REPORT = {}
for key, shells in KIT.items():
    me = bpy.data.meshes.new(key)
    me.from_pydata([(v.x, -v.z, v.y) for v in shells.verts], [], shells.faces)   # game -> Blender (z up)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(key, me)
    seg = SEG[key]
    ob['segment'] = key
    ob['revision'] = seg['revision']
    ob['origin'] = seg['origin']
    if key in FRAMES:
        ob['frame'] = json.dumps(FRAMES[key])
    scene.collection.objects.link(ob)
    REPORT[key] = {'verts': len(me.vertices), 'tris': len(me.polygons)}

if OUT_PATH and bpy.app.background:
    for o in scene.objects:
        o.select_set(o.name in KIT)
    bpy.ops.export_scene.gltf(filepath=OUT_PATH, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_extras=True, export_materials='NONE', export_texcoords=False, export_normals=True,
                              export_animations=False, export_skins=False, export_morph=False)
REPORT['total'] = {'verts': sum(r['verts'] for r in REPORT.values()), 'tris': sum(r['tris'] for r in REPORT.values())}
result = REPORT
print(json.dumps(REPORT))
