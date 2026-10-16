# The cinematic goblin's TEETH, sculpted procedurally in Blender (goblin expressions Task 17, owner 2026-10-15: "sculpt the teeth in
# Blender"; the WAM sweeps "read very meshy and simple bright", the SDF pegs before them "had a bit more character ... the color was
# a bit better"; "stouter teeth is a yes").
#
# RUN (inside Blender; it only touches the `GoblinTeeth` collection, never the rest of the scene):
#   blender --background --factory-startup --python assets-source/goblin-teeth/goblin_teeth.py -- --export
#   or, in a live Blender:  exec(open('<repo>/assets-source/goblin-teeth/goblin_teeth.py').read(), {'__name__': '__main__', 'ARGS': ['--export']})
# --export writes assets-source/goblin-teeth/goblin-teeth.glb next to this file (or --out <path>).
# The glb then goes into the kit: scripts/merge-kit-teeth.mjs (run by scripts/build-wam-kit.sh goblin-cinematic).
#
# HEADLESS (Task 20; no live Blender session, no window, no viewport renders):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P assets-source/goblin-teeth/goblin_teeth.py [-- --out <path>]
# In background mode it always exports (about 3 s); the same script and Blender give the same glb bytes.
#
# FRAME. Every number below is in the KIT'S / .blob's frame: metres, Y up, +Z forward (the goblin faces +Z), the goblin standing at
# the origin. Blender is Z-up, so a point (x, y, z) is built at Blender (x, -z, y), which the glTF exporter (export_yup) turns back
# into (x, y, z). Each tooth has a ROOT `a` (inside the upper ridge or the jaw's flesh) and the point `b` its axis aims at; the tooth
# grows from `a` along a->b; `length` scales that run. Since Task 20 `a` and `b` are computed by THE LAYOUT below (until then they
# were the old SDF teeth's 11 roots).
#
# A TOOTH is a loft: RINGS cross-sections along a bent centre line, SIDES points each, closed by a dome at the root (inside the gum)
# and a point (or a chip) at the tip. Per tooth: the root radius `r` (4.8-6.2 mm since Task 20, set by the rows' spacing: about half
# the distance to the neighbour, so a row reads as a row of teeth and not a comb; Task 17's 11 were 5.6-8.4), the STOUTNESS in the
# profile: a NECK pinch at the gum (`neck`,
# default NECK), a crown SWELL (`swell` at `swellAt`) and a slow taper (`taper` < 1 stays fat longer, > 1 needles) to a blunt tip
# radius `tipR`, optionally ROUNDED off like a dome (`round` 0..1)); the cross-section's depth/width `flat` (incisors are blades,
# fangs ovals); a sabre `bend` (tip offset, fraction of the length, along the tooth's own depth axis: + back into the mouth, and
# `bendX` sideways); a `twist` (degrees, crooked); a `lean` (degrees about the depth axis: a crooked tooth leaning on its
# neighbour); a `chip` (a broken tip: the plane through the axis point at `t`, tilted `tilt` degrees about the width axis and
# `roll` about the depth axis; everything past it is cut, capped, the rim worn round and the face scooped); surface NOISE (`bump`,
# metres, kept SMALL: 0.2-0.25 mm) and vertical RIDGES (`ridge`); and a colour tweak (`yellow`, `dirt`).
#
# COLOUR: vertex colours (COLOR_0), warm dirty ivory like the SDF teeth (`e0d8c0` as lit), darker and yellower toward the gum
# (the stain), grime in the noise's hollows and on the side faces between neighbours, a slightly cleaner fresh face on a chip.
# Each tooth has its own seed (SEED, its index) for the noise, so the build is deterministic: same script, same glb bytes. No clean white anywhere. The kit material's
# base colour is white, so the vertex colour IS the albedo (three's GLTFLoader turns `vertexColors` on for a COLOR_0 primitive).
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, noise

ARGS = globals().get('ARGS') or (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
HERE = os.path.dirname(os.path.abspath(globals().get('__file__') or globals().get('SCRIPT_PATH') or '.'))
OUT = ARGS[ARGS.index('--out') + 1] if '--out' in ARGS else os.path.join(HERE, 'goblin-teeth.glb')
SEED = 17
COLL = 'GoblinTeeth'
RINGS = 10          # cross-sections from the root dome to the tip (12 until Task 20: 16 teeth now, so a lighter ring count)
SIDES = 10          # points per cross-section
NECK = 0.10         # how much a tooth pinches in at the gum (0 = a plain cone; 0.28 until Task 20's broader, blockier rows)

# ---- THE LAYOUT (Task 20, owner on PR #48: "when he grins there's this dark gap ... cartoonishly his teeth would be bigger and take
# up the space"; decision: TWO BIG ROWS with a thin dark band between them, like the emoji reference).
#
# Task 17 put 11 teeth at the old SDF teeth's roots (7 upper in the middle third of the mouth, 4 small lower ones the fat lower lip
# hid). Now 8 upper (two fangs) and 8 lower (two small canines), bigger and packed edge to edge, each row spanning the grin's opening
# (x +-0.039, the opening's own width: past |x| ~0.04 the mouth corners' flesh covers everything, see REST_FRONT): the upper row
# hangs from the upper ridge's underside, the lower row stands on the lower lip's top edge and follows its U, and the two meet
# along a SMILE LINE with a thin dark band between them (2.6 mm in the middle).
#
# The rows are laid out WHERE THEY SHOW, in the grin clip's peak pose (goblin-expressions.ts `grin`: gape 0.12 = 0.072 rad, smile
# 1, squash 0.5), from the posed lips' curves (goblin-cinematic.blob's smile morphs put the upper ridge's centre line on
# y = 1.168 - 0.016 (1 - (x/0.064)^2), z = 0.073 + 0.035 (1 - (x/0.064)^2) and the lower lip's on y = 1.150 - 0.051 (1 - (x/0.070)^2),
# z = 0.084 + 0.028 (1 - (x/0.070)^2); the lip's top edge is measured, LIP_TOP), and carried back to the REST frame through that pose's kit frames (rig-bind.ts kitFrames:
# the skull frame is only shifted by the squash's move at the mouth; the jaw frame also turns by the gape about the hinge). So at
# rest the rows sit where the shut mouth's flesh buries them (goblin-cinematic-blob.test.ts pins it, 0.5 mm or more inside), and
# at the grin they fill the opening. If the grin's lips or its gape/squash change, re-derive these (GRIN_* below).
GRIN_HEAD = (0.0, 1.1185759, 0.0129015)                         # the skull pivot = the kit's skull and jaw bone heads, at rest
GRIN_SKULL = (0.0, 1.1232097, 0.0147414)                        # kitFrames(skull).pos at the grin's peak (quat identity)
GRIN_JAW = (0.0, 1.1215655, 0.0137074)                          # kitFrames(jaw).pos at the grin's peak
GRIN_JAW_Q = (0.0359922, 0.0, 0.0, 0.9993521)                   # kitFrames(jaw).quat (x, y, z, w): the gape, 0.072 rad about +x


def ridge_y(x): return 1.168 - 0.016 * max(0.0, 1 - (x / 0.064) ** 2)          # upper ridge centre line (posed, grin)
def ridge_z(x): return 0.073 + 0.035 * max(0.0, 1 - (x / 0.064) ** 2)
def lip_y(x): return 1.150 - 0.051 * max(0.0, 1 - (x / 0.070) ** 2)            # lower lip centre line (posed, grin)
def lip_z(x): return 0.084 + 0.028 * max(0.0, 1 - (x / 0.070) ** 2)
def under(x): return ridge_y(x) - 0.0045                                       # the ridge's underside (thinned on the smile: ~5 mm)
# The lower lip's top edge as the front sees it, MEASURED on the posed grin (a bent bar's top climbs with its slope, so it is not the
# centre line plus a radius): x -> y, linear between.
LIP_TOP = [(0.0, 1.1090), (0.005, 1.1095), (0.01, 1.1105), (0.015, 1.1125), (0.02, 1.1150), (0.025, 1.1170), (0.03, 1.1195),
           (0.035, 1.1220), (0.04, 1.1260), (0.045, 1.1345), (0.05, 1.1450), (0.055, 1.1490), (0.06, 1.1515)]


def lip_top(x):
    x = abs(x)
    for (x0, y0), (x1, y1) in zip(LIP_TOP, LIP_TOP[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return LIP_TOP[-1][1]


# The smile line: the dark band's middle, 42% of the way up the opening (the upper row gets the bigger share, as in the reference).
def smile_y(x): return lip_top(x) + 0.42 * max(0.004, under(x) - lip_top(x))
def band(x): return 0.0013 * (1 - 0.30 * min(1.0, abs(x) / 0.05))                # half the dark band: 1.3 mm in the middle, 0.9 at the ends


# THE SHUT MOUTH'S FRONT: the rest face's most-recessed front z over y 1.115-1.165, per |x| (measured on goblin-cinematic.blob at
# rest). The mouth corners are a pinch (z drops from 0.091 at x 0.045 to 0.058 at 0.05), so no tooth can live past |x| ~0.043:
# every tooth is pushed back until its outer side sits at least 1.5 mm behind this (the tests then pin 0.5 mm of flesh over it).
REST_FRONT = [(0.000, 0.1203), (0.005, 0.1200), (0.010, 0.1188), (0.015, 0.1173), (0.020, 0.1144), (0.025, 0.1116), (0.030, 0.1083),
              (0.035, 0.1036), (0.040, 0.0966), (0.045, 0.0909), (0.050, 0.0581)]


def rest_front(x):
    x = abs(x)
    for (x0, y0), (x1, y1) in zip(REST_FRONT, REST_FRONT[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return REST_FRONT[-1][1]


def qrot(q, v):
    x, y, z, w = q
    ix, iy, iz, iw = w * v[0] + y * v[2] - z * v[1], w * v[1] + z * v[0] - x * v[2], w * v[2] + x * v[1] - y * v[0], -x * v[0] - y * v[1] - z * v[2]
    return (ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x)


def to_rest(p, upper):
    """A point placed in the grin's posed frame -> the kit's rest frame (the inverse of the grin's kit frame for that bone)."""
    if upper:
        return tuple(GRIN_HEAD[k] + p[k] - GRIN_SKULL[k] for k in range(3))
    qi = (-GRIN_JAW_Q[0], -GRIN_JAW_Q[1], -GRIN_JAW_Q[2], GRIN_JAW_Q[3])
    r = qrot(qi, tuple(p[k] - GRIN_JAW[k] for k in range(3)))
    return tuple(GRIN_HEAD[k] + r[k] for k in range(3))


# How much the side teeth fan out with the crescent (1 = square to the smile line). Fully square read as spikes slanting in at the
# corners; a third keeps them nearly upright, as cartoon teeth are.
FAN = 0.35


def placed(x, upper, reach=0.0, root=0.004, dz=0.0, r=0.005, flat=0.7):
    """Root `a` and tip `b` (rest frame) of a tooth centred at x: an upper tooth from `root` above the ridge's underside down to the
    band's top edge (`reach` further, e.g. a fang crossing the band), a lower one from `root` below the lip's top up to the band's
    bottom edge. The axis leans with the smile line by FAN (the side teeth fan out a little with the crescent), with a small rake."""
    e = 0.002
    slope = (smile_y(x + e) - smile_y(x - e)) / (2 * e) * FAN
    n = (-slope, 1.0)
    l = math.hypot(*n); n = (n[0] / l, n[1] / l)                               # the smile line's up-normal (x, y)
    if upper:
        z = ridge_z(x) - 0.0015 + dz
        top = under(x) + root
        bot = smile_y(x) + band(x) - reach
        h = top - bot
        a = (x + n[0] * h * 0.5, top, z - 0.001)                                # root leans back into the gum a touch
        b = (x - n[0] * h * 0.5, bot, z + 0.001)
    else:
        z = min(lip_z(x) - 0.0105, ridge_z(x) - 0.0045) + dz
        bot = lip_top(x) - root
        top = smile_y(x) - band(x) - reach
        h = top - bot
        a = (x - n[0] * h * 0.5, bot, z - 0.0015)
        b = (x + n[0] * h * 0.5, top, z + 0.0015)
    a, b = to_rest(a, upper), to_rest(b, upper)
    # buried at rest: the crown's front (centre + depth half) and its outer side behind the shut mouth's front
    lim = min(rest_front(x), rest_front(abs(x) + r * 1.15 + 0.003)) - r * flat * 1.1 - 0.0022
    back = max(0.0, max(a[2], b[2]) - lim)
    return (a[0], a[1], a[2] - back), (b[0], b[1], b[2] - back)


# Each tooth's CHARACTER (the Task 17 vocabulary, see the header): stout, never two alike. x is the posed centre; the rows are a
# little uneven on purpose (a goblin's teeth are not a dentist's). `reach` lengthens a tooth past the band (the fangs cross it).
UPPER = [
    # the goblin's right (-x) to its left. A fifth pair further out (x +-0.0395) was tried: the mouth corners' flesh covers it at
    # the grin from the front and at three-quarter, and the shut mouth's pinch at the corners leaves no room for it further forward.
    dict(x=-0.0340, r=0.0052, flat=0.66, swell=0.12, swellAt=0.45, taper=0.6, tipR=0.58, bend=0.04, bendX=0.0, twist=18, lean=7, round=0.6, chip=dict(t=0.88, tilt=14, roll=-20), yellow=0.10, dirt=0.40),
    # the right FANG: a long, swollen sabre that crosses the band, curving back
    dict(x=-0.0255, r=0.0052, flat=0.80, swell=0.22, swellAt=0.32, taper=1.1, tipR=0.08, bend=0.16, bendX=-0.10, twist=8, lean=4, reach=0.0105, yellow=0.08, dirt=0.40),
    dict(x=-0.0160, r=0.0055, flat=0.56, swell=0.10, swellAt=0.45, taper=0.5, tipR=0.66, bend=0.04, bendX=0.0, twist=-22, lean=-7, round=0.6, yellow=0.04, dirt=0.30),
    # the two middle incisors: broad chisels; the left one is BROKEN, a diagonal snap across its lower third
    dict(x=-0.0055, r=0.0062, flat=0.52, swell=0.08, swellAt=0.45, taper=0.45, tipR=0.72, bend=0.03, bendX=0.0, twist=-6, lean=-3, round=0.5, yellow=0.02, dirt=0.30),
    dict(x=0.0055, r=0.0061, flat=0.54, swell=0.08, swellAt=0.42, taper=0.45, tipR=0.70, bend=0.03, bendX=0.0, twist=5, lean=4, chip=dict(t=0.74, tilt=30, roll=-38), yellow=0.06, dirt=0.40),
    dict(x=0.0160, r=0.0055, flat=0.60, swell=0.12, swellAt=0.40, taper=0.6, tipR=0.50, bend=0.06, bendX=0.10, twist=-16, lean=12, round=0.4, yellow=0.14, dirt=0.30),
    # the left FANG: a little shorter and straighter than the right, its point snapped off
    dict(x=0.0255, r=0.0051, flat=0.84, swell=0.18, swellAt=0.32, taper=1.0, tipR=0.10, bend=0.12, bendX=0.08, twist=-10, lean=-5, reach=0.0125, chip=dict(t=0.92, tilt=-42, roll=25), yellow=0.04, dirt=0.40),
    dict(x=0.0340, r=0.0052, flat=0.68, swell=0.14, swellAt=0.5, taper=0.5, tipR=0.66, bend=0.03, bendX=0.05, twist=12, lean=-9, round=0.8, yellow=0.16, dirt=0.50),
]
LOWER = [
    dict(x=-0.0345, r=0.0049, flat=0.74, swell=0.12, swellAt=0.35, taper=0.55, tipR=0.60, bend=0.05, bendX=0.0, twist=-14, lean=8, round=0.6, yellow=0.16, dirt=0.50),
    # the right lower CANINE: a small tusk leaning out, its point standing into the band
    dict(x=-0.0255, r=0.0049, flat=0.80, swell=0.16, swellAt=0.25, taper=1.0, tipR=0.14, bend=0.10, bendX=-0.25, twist=10, lean=10, reach=0.0030, yellow=0.12, dirt=0.40),
    dict(x=-0.0160, r=0.0054, flat=0.60, swell=0.10, swellAt=0.3, taper=0.5, tipR=0.64, bend=0.04, bendX=0.0, twist=-18, lean=-6, round=0.6, chip=dict(t=0.88, tilt=20, roll=30), yellow=0.06, dirt=0.40),
    dict(x=-0.0055, r=0.0057, flat=0.56, swell=0.10, swellAt=0.3, taper=0.45, tipR=0.70, bend=0.03, bendX=0.0, twist=8, lean=3, round=0.7, yellow=0.08, dirt=0.35),
    dict(x=0.0055, r=0.0056, flat=0.58, swell=0.10, swellAt=0.3, taper=0.5, tipR=0.66, bend=0.03, bendX=0.0, twist=-12, lean=-4, round=0.6, yellow=0.12, dirt=0.40),
    dict(x=0.0160, r=0.0053, flat=0.62, swell=0.12, swellAt=0.3, taper=0.55, tipR=0.62, bend=0.04, bendX=0.04, twist=22, lean=8, round=0.8, yellow=0.14, dirt=0.45),
    # the left lower CANINE
    dict(x=0.0255, r=0.0048, flat=0.80, swell=0.15, swellAt=0.25, taper=1.0, tipR=0.16, bend=0.10, bendX=0.25, twist=-8, lean=-10, reach=0.0025, yellow=0.08, dirt=0.35),
    dict(x=0.0345, r=0.0048, flat=0.76, swell=0.14, swellAt=0.35, taper=0.55, tipR=0.62, bend=0.04, bendX=0.02, twist=16, lean=-6, round=0.7, yellow=0.18, dirt=0.55),
]
_DEF = dict(chip=None, bump=0.00020, ridge=0.00010, reach=0.0, length=1.0)


def teeth():
    out = []
    for row, specs, upper in (('u', UPPER, True), ('l', LOWER, False)):
        for k, t in enumerate(specs):
            spec = {**_DEF, **t}
            spec['a'], spec['b'] = placed(spec['x'], upper, spec['reach'], root=0.008 if upper else 0.004, r=spec['r'], flat=spec['flat'])
            spec['name'] = 'tooth_%s%02d' % (row, k)
            out.append(spec)
    return out


TEETH = teeth()

# Colours, sRGB 0..1 (stored as byte colour, which Blender treats as sRGB; the exporter writes COLOR_0 linear). Warm dirty ivory at
# the crown, a yellow-brown stain toward the gum. Lit by the lab (kit-overlay.ts LOOK `tooth`) the crown renders about (180,157,111)
# of 255 on the grin close-up: beige, not white (the WAM teeth' #e8e2d2 rendered a near-neutral (177,172,160)).
IVORY = (0.86, 0.77, 0.58)
STAIN = (0.42, 0.31, 0.16)
GRIME = (0.26, 0.19, 0.10)
FRESH = (0.80, 0.73, 0.58)


def W(p):
    """Kit frame (x, y up, z fwd) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def build_tooth(spec, k):
    rnd = random.Random(SEED * 101 + k)
    a, b = W(spec['a']), W(spec['b'])
    run = (b - a)
    L = (run.length + 0.001) * spec['length']        # the SDF prim's length plus its 1 mm rounded end
    d = run.normalized()
    # Width axis: kit +x (Blender +x) made perpendicular to the axis; depth axis = toward the mouth's back. In Blender the goblin
    # faces -y, so "back into the mouth" is +y in Blender; w = d x u points there for an upper tooth (d down) and the other way for
    # a lower one, so fix its sign by hand.
    u = (Vector((1, 0, 0)) - d * d.x).normalized()
    w = d.cross(u).normalized()
    if w.y < 0: w = -w                                # +w = back (into the mouth) for every tooth
    # Lean: turn the whole tooth about the depth axis (a crooked tooth leaning sideways), pivoting at the root.
    rot = Matrix.Rotation(math.radians(spec['lean']), 3, w)
    d, u = (rot @ d).normalized(), (rot @ u).normalized()

    noff = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    r0, flat = spec['r'], spec['flat']

    def centre(t):
        f = max(t, 0.0) ** 2                          # the sabre: the curve grows toward the tip
        return a + d * (t * L) + w * (spec['bend'] * L * f) + u * (spec['bendX'] * L * f)

    def radius(t):
        if t < 0:                                     # into the gum: narrow back toward the dome
            return r0 * (1 - spec.get('neck', NECK)) * (0.86 + 0.14 * (1 + t / 0.12))
        taper = spec['tipR'] + (1 - spec['tipR']) * (1 - t) ** spec['taper']
        bulge = 1 + spec['swell'] * math.exp(-((t - spec['swellAt']) / 0.2) ** 2)
        # the NECK: a tooth pinches in where it leaves the gum and swells into its crown, so neighbours part at the gum line
        # and each crown reads as its own rounded shape instead of one saw-blade band of triangles
        neck = 1 - spec.get('neck', NECK) * math.exp(-(t / 0.22) ** 2)
        # a ROUNDED end (`round` 0..1): the last quarter closes like a dome instead of running out to a cone's point
        u = min(1.0, max(0.0, (t - 0.72) / 0.28))
        dome = 1 - spec.get('round', 0.0) * (1 - math.sqrt(max(0.0, 1 - u * u)))
        return r0 * taper * bulge * neck * dome

    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col')
    # one ring inside the gum, the rest to just short of the tip, closer together toward the tip (where the shape turns)
    ts = [-0.12] + [(1 - (1 - i / (RINGS - 2)) ** 1.4) * 0.97 for i in range(RINGS - 1)]
    rings, tparam, sidep = [], {}, {}
    for t in ts:
        c = centre(t)
        # local frame along the bend: the tangent by finite difference
        tan = (centre(t + 0.01) - centre(t - 0.01)).normalized()
        uu = (u - tan * tan.dot(u)).normalized()
        ww = tan.cross(uu).normalized()
        if ww.dot(w) < 0: ww = -ww
        tw = math.radians(spec['twist']) * max(t, 0)
        ring = []
        for s in range(SIDES):
            th = 2 * math.pi * s / SIDES + tw
            # a flattened, slightly pear-shaped section: fuller at the front (the labial face) than the back
            front = 1.0 + 0.10 * max(0.0, -math.sin(th))
            off = uu * (radius(t) * math.cos(th)) + ww * (radius(t) * flat * math.sin(th) * front)
            p = c + off
            # vertical ridges and fine bumps, along the surface normal, SMALL
            n = off.normalized()
            disp = spec['ridge'] * math.cos(3 * th + 0.7 * k) * smooth(0.0, 0.3, t) * (1 - smooth(0.7, 1.0, t))
            disp += spec['bump'] * noise.noise(p * 900 + noff)
            v = bm.verts.new(p + n * disp)
            tparam[v] = t
            sidep[v] = abs(math.cos(th - tw))
            ring.append(v)
        rings.append(ring)
    # root dome (in the gum) and the tip point
    root = bm.verts.new(centre(-0.17)); tparam[root] = -0.17
    tipv = bm.verts.new(centre(1.0) + (centre(1.0) - centre(0.97)).normalized() * spec['tipR'] * r0 * 0.6 * (1 - 0.6 * spec.get('round', 0.0)))
    tparam[tipv] = 1.0
    for i in range(len(rings) - 1):
        r1, r2 = rings[i], rings[i + 1]
        for s in range(SIDES):
            bm.faces.new((r1[s], r1[(s + 1) % SIDES], r2[(s + 1) % SIDES], r2[s]))
    for s in range(SIDES):
        bm.faces.new((rings[0][(s + 1) % SIDES], rings[0][s], root))
        bm.faces.new((rings[-1][s], rings[-1][(s + 1) % SIDES], tipv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    chip_faces = set()
    if spec['chip']:
        ch = spec['chip']
        c = centre(ch['t'])
        tan = (centre(ch['t'] + 0.01) - centre(ch['t'] - 0.01)).normalized()
        nrm = Matrix.Rotation(math.radians(ch['tilt']), 3, u) @ tan
        nrm = (Matrix.Rotation(math.radians(ch['roll']), 3, w) @ nrm).normalized()
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=c, plane_no=nrm, clear_outer=True)
        cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        filled = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
        new_faces = filled['faces']
        for e in cut_edges:
            for v in e.verts:
                if v not in tparam: tparam[v] = ch['t']
        # A break is not a saw cut, and a sharp rim reads as a glass shard: round the rim with a small smooth inset (worn), then
        # sink the middle a fraction of a millimetre (a shallow conchoidal scoop) with a little jitter.
        rr = radius(ch['t'])
        ins = bmesh.ops.inset_region(bm, faces=new_faces, thickness=rr * 0.28, depth=-rr * 0.10, use_even_offset=True)
        inner = [f for f in new_faces if f.is_valid]
        for v in {v for f in ins['faces'] for v in f.verts}:
            tparam.setdefault(v, ch['t'])
        for v in {v for f in inner for v in f.verts}:
            tparam[v] = ch['t']
        poked = bmesh.ops.poke(bm, faces=inner)
        for v in poked['verts']:
            v.co += nrm * -rr * rnd.uniform(0.10, 0.18)
            tparam[v] = ch['t']
        for f in poked['faces']: chip_faces.add(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # colour: stain at the gum, ivory at the crown, grime in the hollows, a cleaner fresh break
    for f in bm.faces:
        f.smooth = f not in chip_faces
        for loop in f.loops:
            v = loop.vert
            t = tparam.get(v, 0.5)
            # the stain climbs most of the way down the crown (only the lower half ever shows past the lips)
            base = lerp3(STAIN, IVORY, smooth(0.0, 0.70, t))
            base = lerp3(base, (base[0], base[1] * 0.97, base[2] * 0.82), spec['yellow'] * 4)
            g = 0.5 + 0.5 * noise.noise(v.co * 420 + noff * 2)
            grime = spec['dirt'] * smooth(0.45, 0.95, g) * 0.5
            # grime between the teeth (the side faces), so neighbours read apart even where they touch
            grime += spec['dirt'] * 0.7 * smooth(0.55, 1.0, sidep.get(v, 0.0)) * (1 - smooth(0.75, 1.0, t))
            cc = lerp3(base, GRIME, grime)
            if f in chip_faces: cc = lerp3(cc, FRESH, 0.6)
            loop[col] = (*[min(1.0, max(0.0, x)) for x in cc], 1.0)

    me = bpy.data.meshes.new(spec['name'])
    bm.to_mesh(me)
    bm.free()
    return me


def tooth_material():
    m = bpy.data.materials.get('tooth') or bpy.data.materials.new('tooth')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.38
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def build():
    coll = bpy.data.collections.get(COLL)
    if coll is None:
        coll = bpy.data.collections.new(COLL)
        bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        if o.name.startswith('tooth_'):
            me = o.data
            bpy.data.objects.remove(o)
            if me and me.users == 0: bpy.data.meshes.remove(me)
    mat = tooth_material()
    objs = []
    for k, spec in enumerate(TEETH):
        me = build_tooth(spec, k)
        me.materials.append(mat)
        ob = bpy.data.objects.new(spec['name'], me)
        coll.objects.link(ob)
        objs.append(ob)
    return objs


def export(objs, path=OUT):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_texcoords=False, export_vertex_color='ACTIVE',
                              export_materials='EXPORT', export_extras=False, export_animations=False, export_skins=False)
    return path


if __name__ == '__main__':
    objs = build()
    # Headless (`Blender -b -P <this>`) always exports: that is how the glb is made (Task 20: no live Blender session needed). In a
    # live Blender it exports only when asked (--export), so a look-dev run just rebuilds the collection.
    if bpy.app.background or '--export' in ARGS:
        print('wrote', export(objs))
