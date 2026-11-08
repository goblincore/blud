# The cerebrax's head parts, all on `pelvis` with the brain and the harness, so nothing moves against anything (on the
# aim chain's `skull`, the first pass, the brain swung against its harness and clipped; owner, arena look): the red EYE embers in the
# face's sockets, the TEETH bared in the snarl, and the TENDRILS: corrugated feed lines curling off the brain's top
# and sides, plugged into it through bony ferrules, each ending in a glowing tip.
# Seated on skin.json (scripts/cerebrax-skin.ts): re-run that after any edit to the brain's prims.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'eyes', 'teeth', 'tendrils'}

# The first pass installed these on `skull`: clear any left in the .blend so the export has one copy, on pelvis.
drop(['skull|'])

# The eye sockets (cerebrax.blob: dark blobs at (+-0.045, -0.135, 0.452) from the brain's centre, authored, x1.60 ->
# lat -16.6, lon +-5.7).
EYES = [(-16.6, 5.7), (-16.6, -5.7)]

if 'eyes' in PARTS:
    # Embers seated IN the sockets, a few mm proud (biomech-style.md: the cyberbride's floated 1.5 cm high and read as
    # out of position). eyeglow is emissive 7: pinpoints.
    drop(['pelvis|eyes']); clear_work()
    for i, (la, lo) in enumerate(EYES):
        ball(f'eye{i}', sk(la, lo, -0.004), 1.0, 0.024, 0.016, 0.020)
    plain_part(join_work(), 'eyeglow', 'pelvis|eyes', mirror=False)

if 'teeth' in PARTS:
    # Fangs rooted in the lips' flesh, raked out over the dark gullet (the imp's lesson: probe the flesh, not the
    # gullet). Upper row along lat -24.6, lower along -29.4, unequal and a little crooked.
    drop(['pelvis|teeth']); clear_work()
    import random; rr = random.Random(7)
    for row, la, dirz, L0 in (('u', -24.6, -1, 0.050), ('l', -29.4, 1, 0.036)):
        for k in range(-3, 4):
            lo = k * 2.6 + rr.uniform(-0.5, 0.5)
            root = sk(la, lo, -0.010)
            n = skn(la, lo)
            d = Vector((0, 0, dirz)) * 1.0 + n * 0.35 + Vector((rr.uniform(-0.15, 0.15), 0, 0))
            L = L0 * (1.25 if abs(k) == 2 else 1.0) * rr.uniform(0.8, 1.1)
            horn(f'{row}{k}', root, d, n.cross(Vector((0, 0, 1))).normalized(), L, 0.010 if abs(k) == 2 else 0.008, curl=0.2 * -dirz)
    finish_part('teeth', 'pelvis|teeth', 3000, material='tooth', voxel=0.0016, noise=0.0006, smooth=(0.5, 2), ao=(1.2, 1.2))

if 'tendrils' in PARTS:
    # Each: rooted under the skin (a ferrule where it leaves), standing out along the skin's normal, then curling up
    # and over like a ram's horn. (lat, lon, length, curl, twist): two big ones off the top, smaller ones lower.
    drop(['pelvis|tendrils', 'pelvis|plugs', 'pelvis|tips']); clear_work()
    # The curl is about side = n x up; mirrored sides get mirrored axes, so ONE sign mirrors the pair. Negative turns
    # up-and-out on toward out-and-down: a ram's horn curling away from the brain (the reference's), not back over it.
    # About 2 rad over a metre: at 3.2 rad they closed into handle loops (first engine look); the reference's sweep.
    RUNS = [(48, 34, 1.30, -2.1, 0.5), (48, -34, 1.30, -2.1, -0.5), (18, 78, 0.85, -1.9, 0.0), (18, -78, 0.85, -1.9, 0.0),
            (30, 140, 0.75, -1.7, 0.3), (30, -140, 0.75, -1.7, -0.3)]
    tips = []; plugs = []
    for i, (la, lo, L, curl, tw) in enumerate(RUNS):
        n = skn(la, lo)
        root = sk(la, lo, -0.03)
        side = n.cross(Vector((0, 0, 1)))
        if side.length < 1e-3: side = Vector((1, 0, 0))
        side.normalize()
        # Leave along the normal, lean outward and up, curl about the horizontal tangent (the sign picks the side).
        d0 = (n * 1.0 + Vector((0, 0, 0.6))).normalized()
        pts = [root, sk(la, lo, 0.05)] + curl_path(sk(la, lo, 0.05), d0, side, L, curl, n=48, twist=tw)[1:]
        pts = resample(pts, 0.012)
        r0, r1 = 0.034 * (L / 1.0) ** 0.3, 0.020 * (L / 1.0) ** 0.3
        rad = [r0 + (r1 - r0) * (j / (len(pts) - 1)) for j in range(len(pts))]
        tube(f'td{i}', pts, rad, segs=12)
        # Corrugation: a rib ring every 2.4 cm (the imp's glowing-hose lesson: closer read as beads).
        acc = 0.0
        for j in range(2, len(pts) - 3):
            acc += (pts[j] - pts[j - 1]).length
            if acc > 0.024:
                acc = 0.0
                ax = (pts[j + 1] - pts[j - 1]).normalized()
                ring(f'tr{i}_{j}', pts[j], ax, rad[j] * 1.04, rad[j] * 0.22)
        plugs.append((sk(la, lo, 0.012), n, rad[0]))
        tips.append((pts[-1], (pts[-1] - pts[-3]).normalized(), rad[-1]))
    finish_part('tendrils', 'pelvis|tendrils', 16000, material='hose', voxel=0.003, noise=0.0015, ao=(1.3, 1.3))
    # The ferrules at the roots and the plugs at the ends: bony collars, burning red near the tips (_glow).
    for i, (p, n, r) in enumerate(plugs):
        ring(f'fer{i}', p, n, r * 1.25, r * 0.38)
        ball(f'ferb{i}', p - n * 0.01, 1.0, r * 1.5, r * 1.5, r * 1.5)
    glows = []
    for i, (p, d, r) in enumerate(tips):
        tube(f'plug{i}', [p - d * 0.01, p + d * 0.05], [r * 1.35, r * 1.15], segs=14)
        ring(f'plugr{i}', p + d * 0.02, d, r * 1.45, r * 0.30)
        glows.append((p + d * 0.065, 0.015, 1.0))
    finish_part('plugs', 'pelvis|plugs', 5000, glow=(glows, 0.08), voxel=0.003, noise=0.001, ao=(1.4, 1.4))
    for i, (p, d, r) in enumerate(tips):
        ball(f'tip{i}', p + d * 0.062, 1.0, r * 0.95, r * 0.95, r * 0.95)
    plain_part(join_work(), 'eyeglow', 'pelvis|tips', mirror=False)
