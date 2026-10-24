# The flayer's back and hoses. Run after kit_sculpt.py + butcher_common.py (../butcher-kit/build.py); borrows
# hose() and port() from ../butcher-kit/make_upper.py (exec'd with an empty PARTS, so it only defines them).
# Skin probes (flayer.blob): back z -0.093 at y 1.40, -0.103 at 1.30, -0.126 at 1.20; the helmet's nape socket
# sits at about (0, 1.645, 0.006).
#   dorsal - spine:  a vertebral ridge down the back (the reference figure's spiked column), its spinous spikes
#            raking long and back, transverse spurs, a cord under it;
#   hoses  - neck:   from the helmet's nape socket down into the top of the ridge; spine: from the ridge over the
#            left shoulder; upperArm.l / foreArm.l: down the weapon arm into the sickle's collar.
import bpy, math
from mathutils import Vector

_keep = PARTS if 'PARTS' in globals() else None
PARTS = set()
exec(open(find('make_upper.py')).read(), globals())
PARTS = _keep if _keep is not None else {'dorsal', 'hoses'}

if 'dorsal' in PARTS:
    drop(['spine|dorsal']); clear_work()
    ys = [1.455 - 0.058 * i for i in range(6)]
    zs = [-0.098 - 0.007 * i for i in range(6)]
    tube('cord', [bv(0, 1.47 - 0.31 * s, -0.093 - 0.040 * s) for s in [i / 30 for i in range(31)]], [0.016] * 31)
    for i, (y, z) in enumerate(zip(ys, zs)):
        c = bv(0, y, z)
        ball(f'centrum{i}', c, 1.0, 0.040, 0.026, 0.024)
        L = 0.10 + 0.04 * sn(i / 5)                      # the longest spikes mid-back
        horn(f'spinous{i}', c + bv(0, 0, -0.018), bv(0, 0.35, -1), bv(1, 0, 0), L, 0.016, curl=0.8)
        for sx in (-1, 1):
            horn(f't{i}{sx}', c + bv(sx * 0.03, 0, -0.004), bv(sx, 0.15, -0.45), bv(0, 0, 1) * sx, 0.055, 0.010, curl=0.6)
            ring(f'r{i}{sx}', c + bv(sx * 0.022, 0, 0), bv(1, 0, 0), 0.016, 0.004)
    o = fuse('dorsal'); decimate(o, 7000); bake_ao(o); install(o, 'spine|dorsal'); clear_work()

if 'hoses' in PARTS:
    drop(['neck|hose', 'spine|hose', 'upperArm.l|hose', 'foreArm.l|hose', 'upperArm.l|elbowport'])
    hose('neck|hoseN', [(0.0, 1.630, -0.002), (0.0, 1.58, -0.040), (0.0, 1.52, -0.075), (0.0, 1.475, -0.112)], r=0.012)
    hose('spine|hoseS', [(0.030, 1.440, -0.122), (0.10, 1.53, -0.085), (0.17, 1.55, -0.04), (0.23, 1.53, -0.01)], r=0.010)
    hose('upperArm.l|hose', [(0.24, 1.52, -0.02), (0.30, 1.42, -0.01), (0.33, 1.30, 0.03), (0.335, 1.20, 0.07)], r=0.009)
    port('upperArm.l|elbowport', (0.330, 1.195, 0.075), (1, -0.1, 0.1), r=0.015)
    E, Wr = J['elbowL'], J['wristL']
    def fa(t, ox, oz):
        return (E[0] + (Wr[0] - E[0]) * t + ox, E[1] + (Wr[1] - E[1]) * t, E[2] + (Wr[2] - E[2]) * t + oz)
    hose('foreArm.l|hose1', [fa(0.12, 0.052, -0.010), fa(0.45, 0.054, -0.005), fa(0.75, 0.056, 0.0), fa(0.93, 0.052, 0.004)], r=0.008)
    hose('foreArm.l|hose2', [fa(0.18, 0.018, -0.050), fa(0.50, 0.020, -0.054), fa(0.78, 0.022, -0.056), fa(0.94, 0.020, -0.052)], r=0.008)
