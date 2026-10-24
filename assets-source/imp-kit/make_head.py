# Imp: the HEAD's hard parts. The head is flesh over a simplified demon skull (imp.blob, HEAD); these are the parts of
# that skull that break the hide.
#   teeth  skull|teeth  two rows of uneven, hooked teeth set on the edges of the dark mouth slot and standing PROUD of
#                       it, so they read against the dark; yellowed, stained brown at the gum (tooth)
#   horns  skull|horns  two horns from the temples over the brow ridge, swept out and back and hooking down,
#                       ringed keratin near-black at the root (the twinhead demon skull's horns, tighter to the head)
# Everything sits on the probed face (skin.json front.head, scripts/imp-skin.ts).
import bpy, math, random
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {'teeth', 'horns'}

R = random.Random(11)
# The mouth slot (imp.blob) is centred at y 1.564; the rows root on its upper and lower edges.
UPPER_Y, LOWER_Y, HALF_W = 1.574, 1.553, 0.038


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
            x = -HALF_W + 2 * HALF_W * (k + 0.5) / n + R.uniform(-0.002, 0.002)
            p, nrm = skin('front', 'head', x, y)
            canine = abs(abs(x) - 0.024) < 0.006
            L = (0.036 if canine else R.uniform(0.018, 0.028)) * (1.0 if row == 'u' else 0.85)
            w = 0.0062 if canine else R.uniform(0.0042, 0.0054)
            root = p + nrm * 0.003
            d = (Vector((0, 0, sgn)) + nrm * 0.10 + Vector((R.uniform(-0.12, 0.12), 0, 0))).normalized()
            tooth(f't{row}{k}', root, d, -nrm, L, w, R.uniform(0.15, 0.35))
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
        # Rooted 1 cm inside the temple, behind the brow ridge's end; leaving up, out and back, curling down and back
        # along the skull (round the outward axis), with growth rings over the lower half.
        base = bv(sx * 0.046, 1.668, 0.335)   # over the outer end of the brow: further back they were lost behind the dome
        # Mostly BACK along the skull, a little up and out (more up read as a unicorn spike). Curling DOWN: turning
        # about d0 x down carries the direction toward down, the same on both sides.
        # Out to the side as much as back, so from the front each is a hook off the temple: curled up and back they
        # were seen end-on and read as round mouse ears.
        d0 = (BACK * 0.85 + UP * 0.25 + Vector((sx * 0.80, 0, 0))).normalized()
        axis = d0.cross(-UP).normalized()
        pts, rad = [], []; p = base.copy(); d = d0.copy(); n = 28; L = 0.16; r0 = 0.021
        for i in range(n + 1):
            u = i / n; pts.append(p.copy()); rad.append(r0 * (1 - u) ** 1.15)
            d = (Matrix.Rotation(1.1 / n, 3, axis) @ d).normalized(); p = p + d * (L / n)
        tube(f'horn{sx}', pts, rad, segs=14)
        for k in range(6):
            i = 2 + k * 2; t = (pts[i + 1] - pts[i]).normalized()
            ring(f'hr{sx}{k}', pts[i], t, rad[i], rad[i] * 0.13 + 0.0015)
        roots.append(base)
    o = fuse('horns', voxel=0.0014, smooth=(0.5, 3), noise=0.0008, noise_scale=0.02)
    decimate(o, 5000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.03 + 0.20 * u, 0.025 + 0.15 * u, 0.022 + 0.11 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.14)))
    install(o, 'skull|horns'); clear_work()
