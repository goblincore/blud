# Imp: the FUEL CONDUITS that tie the fire together: from the forge-heart's flanks (make_torso.py) out across the ribs
# to the armpit (straight up to the shoulders the pair read as a V necklace), down the front of the upper arm, and down the forearm into the fist's socket collar
# (make_hands.py), so the fire in the hands visibly comes from the chest. A dark iron hose, sunk part-way into the
# flesh, with a thin burning seam every few cm (a baked `_glow` band; ribs close together with a glow floor read as a
# string of orange beads), in three segments, each riding ONE bone (biomech-style.md, "Hoses"):
#   chest  spine|conduitL       heart -> shoulder port
#   upper  upperArm.l|conduit   shoulder port -> elbow port
#   fore   foreArm.l|conduit    elbow port -> the socket's collar at the wrist
# Built on the left and mirrored. A port (a ringed bony boss) hides each break at a joint.
import bpy, math
from mathutils import Vector
from mathutils.kdtree import KDTree

try:
    PARTS
except NameError:
    PARTS = {'chest', 'upper', 'fore'}

UP = Vector((0, 0, 1))
HOSE_R, RIB_EVERY = 0.0070, 0.024
UA0, UA1 = BONE['upperArm.l']; FA0, FA1 = BONE['foreArm.l']
FU, FF = BoneFrame(UA0, UA1), BoneFrame(FA0, FA1)
# Arm skin radii along each bone (imp.blob: the deltoid r 0.070 at the clavicle's end, the upper arm 0.046 -> 0.036,
# the forearm 0.050 -> 0.032 with a belly r 0.052 x 2 tall at 0.30), plus the hose's radius and a few mm of air.
ur = lambda t: 0.046 - 0.010 * t + 0.022 * max(0.0, 1 - t / 0.22) + HOSE_R * 0.35
fr = lambda t: 0.050 - 0.018 * t + 0.010 * bell((t - 0.30) / 0.35) + HOSE_R * 0.35


def catmull(ctrl, n):
    out = []
    P = [ctrl[0]] + ctrl + [ctrl[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(ctrl[-1])
    return out


def hose(name, pts, kit, port_end=True, port_start=False):
    """A ribbed hose along pts with ports, fused; its ribs' seams burn (`_glow` banded by arc length)."""
    clear_work()
    tube(name, pts, [HOSE_R] * len(pts), segs=12)
    S = [0.0]
    for i in range(1, len(pts)): S.append(S[-1] + (pts[i] - pts[i - 1]).length)
    k = 1
    while k * RIB_EVERY < S[-1] - 0.006:
        s = k * RIB_EVERY; j = next(i for i in range(1, len(S)) if S[i] >= s); w = (s - S[j - 1]) / max(1e-9, S[j] - S[j - 1])
        ring(f'{name}r{k}', pts[j - 1].lerp(pts[j], w), (pts[j] - pts[j - 1]).normalized(), HOSE_R * 1.02, 0.0012, segs=16)
        k += 1
    for at, tan in ((pts[-1], pts[-1] - pts[-2]) if port_end else (None, None), (pts[0], pts[1] - pts[0]) if port_start else (None, None)):
        if at is None: continue
        ball(f'{name}port', at, HOSE_R * 1.9)
        ring(f'{name}pr', at, tan.normalized(), HOSE_R * 1.8, 0.0024, segs=24)
    o = fuse(name, voxel=0.0011, smooth=(0.5, 2), noise=0.0006, noise_scale=0.02)
    decimate(o, 1800)
    bake_ao(o, 'impmetal', gain=1.0, gamma=1.3)
    tint_ao(o, lambda co: (0.35, 0.34, 0.33))   # dark iron: it should sit back and let the seams burn
    # The seams burn: a band of glow between each pair of ribs, from the hose's own arc length.
    kd = KDTree(len(pts))
    for i, p in enumerate(pts): kd.insert(p, i)
    kd.balance()
    me = o.data
    if '_glow' in me.attributes: me.attributes.remove(me.attributes['_glow'])
    ga = me.attributes.new('_glow', 'FLOAT', 'POINT')
    for v, g in zip(me.vertices, ga.data):
        _, i, dist = kd.find(v.co)
        # A soft pulse at every SECOND rib, no floor: at every rib and sharper, the chest's short run read as bee stripes.
        band = 0.5 + 0.5 * math.cos(2 * math.pi * S[i] / (RIB_EVERY * 2))
        g.value = band ** 10 * 0.85 if dist < HOSE_R * 1.6 else 0.0
    install(o, kit)
    b, _, n = kit.partition('|')
    mirror_to_r(o, (b.replace('.l', '.r') + '|' + n) if '.l' in b else (b + '|' + n.replace('L', 'R')))
    clear_work()


if 'chest' in PARTS:
    drop(['spine|conduitL', 'spine|conduitR', 'clavicle.l|conduit', 'clavicle.r|conduit']); clear_work()
    on = lambda x, y, off: (lambda pn: pn[0] + pn[1] * off)(skin('front', 'torso', x, y - LOWER))
    # From the heart's left flank (its semi-axis across is 0.042: make_torso.py) out over the ribs and up to the armpit's
    # front, sunk part-way into the skin.
    ctrl = [on(0.038, 1.326, 0.002), on(0.075, 1.330, 0.003), on(0.110, 1.368, 0.003), on(0.138, 1.405, 0.004),
            on(0.156, 1.445, 0.006)]
    pts = catmull(ctrl, 10)
    # In two at a coupling over the ribs (2026-11-02, owner: a shot-off arm left this hose behind, running to a port on
    # nothing). The outer run rides the clavicle, so it sheds with the arm (kit-damage.ts: the clavicle's pieces go with
    # the upper arm); the inner one stays on the chest, a torn stub at its coupling. The whole hose on the clavicle
    # would slide over the ribs as the shoulder bobs.
    hose('conduitL', pts[:21], 'spine|conduitL')
    hose('conduit', pts[20:], 'clavicle.l|conduit', port_end=True, port_start=False)

if 'upper' in PARTS:
    drop(['upperArm.l|conduit', 'upperArm.r|conduit'])
    # Down the front of the upper arm (ph 0), easing round to the outside (ph -90 on .l) by the elbow.
    ctrl = [FU.at(t, math.radians(-50 * t), ur(t), ur(t)) for t in (0.06, 0.30, 0.55, 0.80, 0.98)]
    hose('conduit', catmull(ctrl, 10), 'upperArm.l|conduit', port_end=True, port_start=True)

if 'fore' in PARTS:
    drop(['foreArm.l|conduit', 'foreArm.r|conduit'])
    # Down the outside of the forearm, over the belly, into the socket's graft collar at the wrist.
    ctrl = [FF.at(t, math.radians(-50 - 20 * t), fr(t), fr(t)) for t in (0.04, 0.30, 0.60, 0.85, 1.02)]
    hose('conduit', catmull(ctrl, 10), 'foreArm.l|conduit', port_end=False, port_start=True)
