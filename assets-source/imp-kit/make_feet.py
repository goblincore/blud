# Imp: the FEET. The legs are the butcher's digitigrade chain in flesh (imp.blob), so the hock is the read, and the foot
# is a big splayed claw (owner, 2026-11-02): the toes are flesh prims fanned wide along the floor, and the kit is only
# what breaks the hide (biomech-style.md, "Reverse-knee legs"; "feet are silhouette").
#   claws  foot.l|claws  a short thick claw hooking down off each toe's tip, three forward and one behind, with a bony
#                        cuff at its root (keratin, near-black at the root)
#   hock   foot.l|hock   the strogg graft: a bony collar round the hock with a crest, and a curled spur raking back and
#                        up off it (skullmetal)
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'claws', 'hock'}

FO0, FO1 = BONE['foot.l']
F = BoneFrame(FO0, FO1)
TOE = FO1                                  # the toe joint (blob y 0.031)
# imp.blob's toes: (root + tip offsets from the toe joint, blob axes) and the claw's length and root radius. The first
# pass (thin talons a third the shin's length on a small pad) read as a bird's foot.
TOES = (((0.000, 0.000, 0.260), 0.118, 0.030), ((0.150, 0.000, 0.200), 0.108, 0.028),
        ((-0.080, 0.000, 0.190), 0.102, 0.027), ((0.000, 0.000, -0.105), 0.085, 0.024))
FWD = Vector((0, -1, 0)); DOWN = Vector((0, 0, -1)); UP = -DOWN; BACK = -FWD

if 'claws' in PARTS:
    drop(['foot.l|claws', 'foot.r|claws']); clear_work()
    roots = []
    for k, (off, L, r0) in enumerate(TOES):
        tip = TOE + bv(*off)
        d = bv(off[0], 0, off[2]).normalized()
        root = tip - d * 0.012
        ring(f'cuff{k}', root + UP * 0.006, d, r0 * 1.05, 0.0035, segs=24)
        horn(f'claw{k}', root + UP * 0.006, d + UP * 0.10, d.cross(DOWN).normalized(), L, r0, curl=1.25)
        roots.append(root)
    o = fuse('claws', voxel=0.0015, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 5000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.05 + 0.20 * u, 0.03 + 0.09 * u, 0.025 + 0.05 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.09)))
    install(o, 'foot.l|claws'); mirror_to_r(o, 'foot.r|claws'); clear_work()

if 'hock' in PARTS:
    drop(['foot.l|hock', 'foot.r|hock']); clear_work()
    # The collar round the top of the metatarsal, just under the hock's flesh, tipped forward with the bone.
    rr = lambda t: 0.046 - 0.010 * t
    _, P, N = bone_shell('collar', F, 0.05, lambda ph: 0.17 + 0.05 * math.exp(-((ph - math.pi) / D(40)) ** 2),
                         -math.pi, math.pi, rr, rr, 0.007, nu=16, nv=64)
    edge_lips(P, N, 0.004, n=120, which=('u0', 'u1'), inset=0.002)
    # A crest down the back, where the spur grows from.
    on = lambda t, ph, off=0.0: F.at(t, ph, rr(t) + off, rr(t) + off)
    S = [0.02 + 0.22 * i / 30 for i in range(31)]
    tube('crest', [on(t, math.pi, 0.003) for t in S], [0.003 + 0.005 * sn((t - 0.02) / 0.22) for t in S])
    # The SPUR: the hock's biggest shape, raking back and up and curling over (butcher.blob's lesson: the hock is the
    # read).
    base = on(0.10, math.pi, 0.004)
    d0 = (BACK + UP * 0.9).normalized()
    horn('spur', base, d0, d0.cross(BACK).normalized(), 0.12, 0.018, curl=0.9)
    finish('hock', 'foot.l|hock', 3500, material='skullmetal', voxel=0.0016)
