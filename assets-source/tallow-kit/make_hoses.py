# Tallow: the PLUMBING, the character's story drawn on him: rendered fat goes from the boiler in his back down each
# arm to the cannon's fuel bladder. One fat corrugated hose a side (`hose`), with a bony flanged port wherever it enters
# flesh or metal (`skullmetal`), DIVING under the skin for part of each run (Cronenberg: the plumbing is half grown
# in). Each segment rides ONE bone and breaks at a joint in a port (biomech-style.md, "Hoses, wires and ports"). The
# first pass's belly siphons wrapped his waist like belts and read as "silly" (owner, 2026-11-14): gone.
#   feed     clavicle.l|feed   boiler -> over the yoke -> a port on top of the shoulder. It rides the CLAVICLE, so it
#                              sheds with a shot-off arm (kit-sheds.test.ts: on `chest` it reached 15 cm into the arm)
#   arm      upperarm.l|feed   shoulder port -> down the back of the upper arm -> the elbow
#   fore     forearm.l|feed    elbow port -> diving into the sleeve's underside (the cannon's bladder comes out of
#                              the meat further down, make_cannons.py)
#   ports    clavicle.l|port, upperarm.l|port
#   gore     clavicle.l|gore, upperarm.l|gore, forearm.l|hgore: torn meat and blood round each port and the dive
# Built on the left and mirrored. PARTS selects a subset.
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'feed', 'arm', 'fore', 'gore'}

HR = 0.030                      # hose radius: fat, readable across a room
UA0, UA1 = BONE['upperarm.l']; FA0, FA1 = BONE['forearm.l']; CL0, CL1 = BONE['clavicle.l']
FU, FF = BoneFrame(UA0, UA1), BoneFrame(FA0, FA1)
# The shoulder port: top-back of the shoulder mound (tallow.blob: r 0.205, tall 0.85, 4 cm under the clavicle's tail).
SH_C = CL1 + Vector((0, 0, -0.040))
SH_D = Vector((0.10, 0.55, 0.85)).normalized()      # blender: up and back, a little out
SH = SH_C + SH_D * 0.195
# The elbow port: behind the elbow ball (r 0.142).
EL_D = (-FF.u * 0.6 - FF.f * 0.3 + Vector((0, 0.6, 0))).normalized()
EL = FA0 + EL_D * 0.150
# The upper arm's back-outer skin: r 0.170 -> 0.140 with the hanging mass (r 0.140, 5 cm behind) under it.
# On this down-pointing bone BoneFrame's s points INWARD, so outer is ph -90 and the back is ph 180.
ua = lambda t, ph, off: FU.at(t, ph, 0.195 - 0.035 * t + off, 0.175 - 0.035 * t + off)   # the gorilla upper arm (r 0.185 -> 0.150)

if 'feed' in PARTS:
    drop(['chest|feed', 'clavicle.l|feed', 'clavicle.r|feed', 'clavicle.l|port', 'clavicle.r|port']); clear_work()
    # From the boiler's upper flank (make_back.py's sac: centre 8.5 cm off the back at y 1.36, half-width 0.235),
    # up over the fat of the yoke and down onto the shoulder port.
    a = tp(1.44, 150, 0.14); b = tp(1.56, 138, 0.06); c = tp(1.62, 120, 0.05)
    hose_run('feed', [tp(1.40, 158, 0.16), a, b, c, SH + SH_D * 0.05 + Vector((-0.06, 0.02, 0.03)), SH + SH_D * 0.012], HR)
    finish('feed', 'clavicle.l|feed', 3000, material='hose', ao=(1.3, 1.4), voxel=0.0035, smooth=(0.4, 2), noise=0.0015, noise_scale=0.03)
    port('shp', SH, SH_D, 0.050)
    finish('shport', 'clavicle.l|port', 800, material='skullmetal', voxel=0.0028, smooth=(0.5, 2), noise=0.0018, noise_scale=0.04)

if 'arm' in PARTS:
    drop(['upperarm.l|feed', 'upperarm.r|feed', 'upperarm.l|port', 'upperarm.r|port']); clear_work()
    PH = D(-140)
    # The middle of the run dives UNDER the skin (off -0.012): half grown in.
    ctrl = [SH - SH_D * 0.03 + (UA1 - UA0).normalized() * 0.03, ua(0.22, PH, 0.010), ua(0.45, PH, -0.012), ua(0.70, PH, -0.012), ua(0.92, D(-160), 0.010), EL + EL_D * 0.02]
    hose_run('armfeed', ctrl, HR)
    finish('armfeed', 'upperarm.l|feed', 2400, material='hose', ao=(1.3, 1.4), voxel=0.0035, smooth=(0.4, 2), noise=0.0015, noise_scale=0.03)
    port('elp', EL, EL_D, 0.046)
    finish('elport', 'upperarm.l|port', 800, material='skullmetal', voxel=0.0028, smooth=(0.5, 2), noise=0.0018, noise_scale=0.04)

if 'fore' in PARTS:
    drop(['forearm.l|feed', 'forearm.r|feed']); clear_work()
    # Elbow port -> along the sleeve's underside -> diving INTO it at t ~0.22 (end 3 cm under the skin; the sleeve is
    # r ~0.142 there). The bladder (make_cannons.py) comes out of the meat at t ~0.80: the hose runs on inside him.
    fa = lambda t, off: FF.at(t, D(180), 0.142 + off, 0.142 + off)
    hose_run('forefeed', [EL + EL_D * 0.03, EL + EL_D * 0.05 + FF.u * 0.04 - FF.f * 0.04, fa(0.10, 0.035), fa(0.17, 0.010), fa(0.24, -0.030)], HR * 0.9)
    finish('forefeed', 'forearm.l|feed', 1700, material='hose', ao=(1.3, 1.4), voxel=0.0035, smooth=(0.4, 2), noise=0.0015, noise_scale=0.03)

if 'gore' in PARTS:
    drop(['clavicle.l|gore', 'clavicle.r|gore']); clear_work()
    gore_ring('sg', SH - SH_D * 0.006, SH_D, 0.074, 11, 0.012, 0.022, drips=2, seed=21)
    finish_gore('sgore', 'clavicle.l|gore', 900)
    drop(['upperarm.l|gore', 'upperarm.r|gore']); clear_work()
    gore_ring('eg', EL - EL_D * 0.006, EL_D, 0.068, 10, 0.011, 0.020, drips=2, seed=22)
    finish_gore('egore', 'upperarm.l|gore', 900)
    drop(['forearm.l|hgore', 'forearm.r|hgore']); clear_work()
    fa = lambda t, off: FF.at(t, D(180), 0.142 + off, 0.142 + off)
    gore_ring('fg', fa(0.19, 0.0), fa(0.24, -0.03) - fa(0.17, 0.01), 0.030, 8, 0.009, 0.016, drips=1, seed=23)
    finish_gore('fgore', 'forearm.l|hgore', 600)
