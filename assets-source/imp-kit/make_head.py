# Imp: the HEAD's hard parts. The head is flesh over a simplified demon skull (imp.blob, HEAD); these are the parts of
# that skull that break the hide.
#   teeth  skull|teeth  two rows of uneven, hooked teeth set on the edges of the dark mouth slot and standing PROUD of
#                       it, so they read against the dark; yellowed, stained brown at the gum (tooth)
#   horns  skull|horns  two horns from the temples over the brow ridge, sweeping up and out and hooking FORWARD,
#                       ringed keratin near-black at the root (the twinhead demon skull's horns, tighter to the head)
# Everything sits on the probed face (skin.json front.head, scripts/imp-skin.ts).
import bpy, math, random
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {'teeth', 'horns'}

R = random.Random(11)
# THE MOUTH: imp.blob's dark slot (blob at skull 0.30, offset (0,-0.018,0.128); compiled centre y ~1.566, semi-axis y
# 0.0224) stands a few mm proud of the muzzle and jaw. The teeth root in the FLESH just above and below it (probed
# with the slot left out: skin.json front.flesh), stand proud, and rake out and over the dark so they read against
# it. The first pass rooted them on the probed head (the slot's own face): they floated and crossed the muzzle; the
# second sat them just inside the slot's front: hidden, and the mouth read as a black ring.
UPPER_Y, LOWER_Y, HALF_W = 1.586, 1.546, 0.028


def tooth(name, root, d, back, L, w, hook):
    n = 12; pts = []; rad = []
    for i in range(n + 1):
        u = i / n
        pts.append(root + d * (L * u) + back * (hook * L * u * u)); rad.append(w * (1 - u) ** 0.85 + 0.0008)
    return tube(name, pts, rad, segs=10)


if 'teeth' in PARTS:
    drop(['skull|teeth']); clear_work()
    for row, y, sgn, n in (('u', UPPER_Y, -1, 9), ('l', LOWER_Y, 1, 8)):
        for k in range(n):
            x = -HALF_W + 2 * HALF_W * (k + 0.5) / n + R.uniform(-0.0015, 0.0015)
            p, nrm = skin('front', 'flesh', x, y)
            canine = abs(abs(x) - 0.019) < 0.005
            L = (0.030 if canine else R.uniform(0.017, 0.023)) * (1.0 if row == 'u' else 0.9)
            w = 0.0058 if canine else R.uniform(0.0038, 0.0048)
            d = (bv(R.uniform(-0.08, 0.08), sgn, 0.0) + nrm * 0.30).normalized()   # down (up) and out over the dark
            tooth(f't{row}{k}', p - nrm * 0.002, d, -nrm, L, w, R.uniform(0.10, 0.25))
    o = fuse('teeth', voxel=0.0008, smooth=(0.5, 2), noise=0.0003, noise_scale=0.01)
    decimate(o, 6000)
    bake_ao(o, material='tooth', gain=1.0, gamma=1.0, tint=(1.0, 1.0, 1.0), ao_dist=0.02)
    gum = lambda co: min(abs(co.z - UPPER_Y), abs(co.z - LOWER_Y))
    tint_ao(o, lambda co: (lambda g: (0.36 + 0.50 * g, 0.24 + 0.48 * g, 0.12 + 0.26 * g))(min(1.0, gum(co) / 0.018)))
    install(o, 'skull|teeth'); clear_work()

if 'horns' in PARTS:
    drop(['skull|horns']); clear_work()
    roots = []
    BACK = Vector((0, 1, 0)); UP = Vector((0, 0, 1))
    for sx in (1, -1):
        # Rooted 1 cm inside the temple, behind the brow ridge's end, with growth rings over the lower half.
        base = bv(sx * 0.044, 1.668, 0.325)   # over the outer end of the brow: further back they were lost behind the dome
        # FORWARD-FACING (owner, 2026-10-24: "switched to facing forward rather than swept back"): leaving up and out
        # off the temple, then hooking FORWARD over the brow so the tips point ahead, a bull's or a charging demon's.
        # Turning about d0 x forward carries the direction toward forward, the same on both sides.
        FWD = Vector((0, -1, 0))
        # OUT first, a little up, then turning forward: up-first (the first forward pass) read as two antennae.
        d0 = (Vector((sx * 0.85, 0, 0)) + UP * 0.40 + BACK * 0.10).normalized()
        axis = d0.cross(FWD).normalized()
        pts, rad = [], []; p = base.copy(); d = d0.copy(); n = 28; L = 0.15; r0 = 0.021
        for i in range(n + 1):
            u = i / n; pts.append(p.copy()); rad.append(r0 * (1 - u) ** 1.15)
            d = (Matrix.Rotation(2.1 / n, 3, axis) @ d).normalized(); p = p + d * (L / n)
            if u > 0.35: d = (d + UP * 0.05).normalized()   # and rising as it comes forward
        tube(f'horn{sx}', pts, rad, segs=14)
        for k in range(6):
            i = 2 + k * 2; t = (pts[i + 1] - pts[i]).normalized()
            ring(f'hr{sx}{k}', pts[i], t, rad[i] * 0.97, rad[i] * 0.07 + 0.0010)   # subtle: proud rings read as a corrugated pipe
        roots.append(base)
    o = fuse('horns', voxel=0.0014, smooth=(0.5, 3), noise=0.0008, noise_scale=0.02)
    decimate(o, 5000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.03 + 0.20 * u, 0.025 + 0.15 * u, 0.022 + 0.11 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.14)))
    install(o, 'skull|horns'); clear_work()
