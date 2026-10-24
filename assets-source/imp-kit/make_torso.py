# Imp: the TORSO's hard parts.
#   spreader  spine|spreader   the chest wound held open: two hooked skullmetal blades biting into the wound's edges
#                              like ribs, and a cage of four bowed ribs across the furnace (impmetal,
#                              lit by the furnace)
#   furnace   spine|furnace    the glowing heart in the wound that feeds the fireballs (ventglow)
#   spines    spine|spines     a row of bony spines raking back and up along the upper back (keratin)
#   spikes    clavicle.l|spikes  two spikes off each shoulder, raked back (keratin)
# The wound and the back sit on the probed skin (skin.json, scripts/imp-skin.ts).
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'spreader', 'furnace', 'spines', 'spikes'}

UP = Vector((0, 0, 1)); BACK = Vector((0, 1, 0))
WY = 1.35                                   # the wound's centre height (imp.blob: spine at=0.62)
W, WN = skin('front', 'torso', 0.0, WY)
FURNACE = W - WN * 0.010
FURNACE_R = 0.034

if 'spreader' in PARTS:
    drop(['spine|spreader']); clear_work()
    on = lambda x, y, off: (lambda pn: pn[0] + pn[1] * off)(skin('front', 'torso', x, y))
    for sgn in (1, -1):
        # A blade from the crossbar's end down the wound's side, hooking in under its lower edge.
        # Rising from under the pec, bowing out round the wound's side and hooking in under it, like a rib.
        ctrl = [(0.060, 1.452, -0.010), (0.090, 1.425, 0.006), (0.094, 1.38, 0.012), (0.084, 1.33, 0.012),
                (0.066, 1.292, 0.006), (0.040, 1.280, -0.010)]
        pts = [on(sgn * x, y, o) for x, y, o in ctrl]
        fine = []
        for i in range(len(pts) - 1):
            for q in range(8): fine.append(pts[i].lerp(pts[i + 1], q / 8))
        fine.append(pts[-1])
        tube(f'blade{sgn}', fine, [0.0035 + 0.0070 * sn(0.15 + 0.85 * i / len(fine)) for i in range(len(fine))], segs=12)
        # Barbs biting into the wound's edge.
        for y in (1.39, 1.35, 1.31):
            b = on(sgn * 0.078, y, 0.010)
            horn(f'barb{sgn}{y}', b, Vector((-sgn, 0, 0)) - WN * 0.6, WN, 0.022, 0.0045, curl=0.8)
    # (A ratcheted crossbar over the wound joined the blades into a trapezoid frame: it read as a badge, a basic
    # shape. The blades stand alone now, two hooked ribs prising the wound open.)
    # The cage over the furnace: four ribs bowed out across the wound, top to bottom.
    for k, x in enumerate((-0.033, -0.011, 0.011, 0.033)):
        R = [i / 20 for i in range(21)]
        tube(f'rib{k}', [on(x, 1.405 - 0.11 * u, 0.006 + 0.014 * sn(u)) for u in R],
             [0.0035 + 0.0015 * sn(u) for u in R], segs=10)
    finish('spreader', 'spine|spreader', 6000, mirror=False, material='impmetal',
           glow=([(FURNACE, FURNACE_R, 1.0)], 0.09, 1.6, 0.5), voxel=0.0014)

if 'furnace' in PARTS:
    drop(['spine|furnace']); clear_work()
    o = ball('furnace', FURNACE, 1.0, FURNACE_R * 1.15, FURNACE_R * 0.8, FURNACE_R * 1.35)
    plain_part(o, 'ventglow', 'spine|furnace', mirror=False)

if 'spines' in PARTS:
    drop(['spine|spines']); clear_work()
    roots = []
    # The ridge: down the middle of the upper back, longest between the shoulder blades; a shorter row either side.
    for x, y, L, r0 in ((0, 1.30, 0.06, 0.013), (0, 1.36, 0.08, 0.016), (0, 1.42, 0.09, 0.017), (0, 1.48, 0.07, 0.014),
                        (0.05, 1.38, 0.045, 0.011), (-0.05, 1.38, 0.045, 0.011),
                        (0.055, 1.45, 0.05, 0.012), (-0.055, 1.45, 0.05, 0.012)):
        p, n = skin('back', 'torso', x, y)
        base = p - n * 0.008
        d0 = (n + UP * 0.9).normalized()
        horn(f'sp{x}{y}', base, d0, Vector((-1, 0, 0)), L + 0.008, r0, curl=0.7)
        roots.append(p)
    o = fuse('spines', voxel=0.0016, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 4000)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.07 + 0.42 * u, 0.06 + 0.36 * u, 0.05 + 0.29 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.08)))
    install(o, 'spine|spines'); clear_work()

if 'spikes' in PARTS:
    drop(['clavicle.l|spikes', 'clavicle.r|spikes']); clear_work()
    roots = []
    # Off the top of the deltoid (imp.blob: clavicle at=0.95, r 0.070), raked up, out and back.
    for base_b, dir_b, L, r0 in (((0.195, 1.495, 0.130), (0.45, 1.0, -0.65), 0.085, 0.015),
                                 ((0.165, 1.505, 0.105), (0.25, 1.0, -0.85), 0.060, 0.012)):
        base = bv(*base_b); d0 = bv(*dir_b).normalized()
        horn(f'spk{L}', base, d0, d0.cross(BACK).normalized(), L, r0, curl=0.7)
        roots.append(base)
    o = fuse('spikes', voxel=0.0016, smooth=(0.5, 3), noise=0.0010, noise_scale=0.02)
    decimate(o, 2500)
    bake_ao(o, material='horn', gain=1.0, gamma=1.2, tint=(1.0, 1.0, 1.0))
    tint_ao(o, lambda co: (lambda u: (0.07 + 0.42 * u, 0.06 + 0.36 * u, 0.05 + 0.29 * u))(
        min(1.0, min((co - r).length for r in roots) / 0.08)))
    install(o, 'clavicle.l|spikes'); mirror_to_r(o, 'clavicle.r|spikes'); clear_work()
