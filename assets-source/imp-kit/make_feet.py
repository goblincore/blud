# Imp: the FEET. The legs are the butcher's digitigrade chain in flesh (imp.blob), so the hock is the read and the
# foot is a long metatarsal ending in a splayed claw on the floor (biomech-style.md, "Reverse-knee legs"; "feet are
# silhouette").
#   claws  foot.l|claws  three bony toes splayed forward along the floor, each tipped by a talon hooking down into
#                        it, and a dewclaw behind the metatarsal (keratin, near-black at the root)
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
TOE = FO1                                  # the toe joint, on the floor (blob y 0.032)
FWD = Vector((0, -1, 0)); DOWN = Vector((0, 0, -1)); UP = -DOWN; BACK = -FWD

if 'claws' in PARTS:
    drop(['foot.l|claws', 'foot.r|claws']); clear_work()
    roots = []
    # The pad (imp.blob) runs 8 cm forward of the toe joint; the toes splay from it, the outer ones swept out. Each
    # toe is a short bony tube from the pad to its knuckle, and the talon leaves the knuckle forward and hooks down.
    for k, (dx, L, r0) in enumerate(((-0.032, 0.085, 0.012), (0.0, 0.105, 0.014), (0.034, 0.090, 0.012))):
        d = (FWD + Vector((dx * 6, 0, 0))).normalized()
        a = TOE + Vector((dx * 0.4, 0, 0.012)) + FWD * 0.02
        b = a + d * 0.07 + Vector((0, 0, 0.012))
        tube(f'toe{k}', [a.lerp(b, i / 10) for i in range(11)], [0.016 - 0.003 * i / 10 for i in range(11)], segs=12)
        ball(f'kn{k}', b, 0.016)
        horn(f'talon{k}', b, d + UP * 0.25, d.cross(DOWN).normalized(), L, r0, curl=1.45)
        roots.append(b)
    # The dewclaw: off the back of the metatarsal low down, raking back and hooking down.
    dw = F.at(0.78, math.pi, 0.026, 0.026)
    horn('dew', dw, BACK + DOWN * 0.4, (BACK + DOWN * 0.4).normalized().cross(DOWN).normalized(), 0.065, 0.010, curl=1.1)
    roots.append(dw)
    o = fuse('claws', voxel=0.0015, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 5000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.06 + 0.40 * u, 0.05 + 0.34 * u, 0.045 + 0.27 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.10)))
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
