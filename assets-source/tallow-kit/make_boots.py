# Tallow: the IRON BOOTS (owner, fifth look: "doesnt quite read as corpulent ... maybe his legs should be shorter or wear
# some kind of footwear"). His feet are crammed into heavy iron clogs and the fat of his ankles is squeezed up out of
# the cuffs (tallow.blob's ankle roll swells past the cuff, r 0.19 against 0.182): fat forced into gear is the
# corpulence read. Industrial like the cannons: a riveted twelve-sided shaft with a rolled cuff and two bolted straps, a
# round steel toe cap, a thick rounded hoof-like sole, rust low down, blood where the cuff bites, torn meat and drips
# round its rim (`gore`).
#   boot    foot.l|boot    shaft, cuff, straps, buckles, foot, toe cap, rounded sole, bolts (impmetal; rust and blood)
#   bgore   foot.l|bgore   torn meat and blood round the cuff where the fat spills over it (gore)
# Both ride the FOOT bone (rigid with the plant). Built on the left and mirrored. PARTS selects a subset.
import bpy, bmesh, math
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {'boot', 'bgore'}

A, T = BONE['foot.l']                       # the ankle (y 0.18) and the toe joint, 0.22 m ahead
FWD = (T - A).normalized(); UP = Vector((0, 0, 1)); OUT = FWD.cross(UP).normalized()
if OUT.x < 0: OUT = -OUT                    # his left is +x
G = Vector((A.x, A.y, 0.0))                 # the ankle's axis on the floor
R_SHAFT, R_CUFF, Z_CUFF = 0.168, 0.182, 0.285


def box(name, c, sx, sy, sz):
    """A box at c, sx along OUT, sy along FWD, sz up."""
    bm = bmesh.new()
    M = Matrix((OUT * sx, FWD * sy, UP * sz)).transposed().to_4x4(); M.translation = c
    bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    return mkobj(name, bm)


# The sole's plan: an egg, not a slab (owner, sixth look: "i dont like the shape of the boots with the rectangle soles").
# Centre SC, half-width SX (wider toward the toe), reaching SF ahead and SB behind; the heel half covers the shaft.
SC, SX, SF, SB = G + FWD * 0.045, 0.176, 0.270, 0.218


def sole_pt(a, s=1.0):
    """The sole outline at angle a (0 = his outside, pi/2 = the toe), scaled by s about its centre."""
    ca, sa = math.cos(a), math.sin(a)
    x = SX * ca * (1.0 + 0.10 * sa)
    y = (SF if sa > 0 else SB) * sa
    return SC + (OUT * x + FWD * y) * s


def pad(name, prof, segs=48):
    """A rounded sole: rings of the egg outline lofted up a (height, scale) profile and capped, so the sole has a
    swollen rolled edge like a hoof or an elephant's foot rather than a box's corners."""
    bm = bmesh.new()
    R = [[bm.verts.new(sole_pt(2 * math.pi * k / segs, s) + UP * z) for k in range(segs)] for z, s in prof]
    for i in range(len(R) - 1):
        for k in range(segs):
            bm.faces.new((R[i][k], R[i][(k + 1) % segs], R[i + 1][(k + 1) % segs], R[i + 1][k]))
    bm.faces.new(list(reversed(R[0]))); bm.faces.new(R[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def btint(co):
    """Dark iron; rust up from the sole, blood down from the cuff (mottled)."""
    mot = 0.5 + 0.5 * math.sin(co.x * 67.0 + co.y * 61.0 + math.sin(co.z * 49.0) * 2.2)
    rust = (1 - sm(co.z / 0.10)) * (0.4 + 0.6 * mot)
    blood = sm((co.z - 0.20) / 0.07) * (0.35 + 0.65 * mot)
    c = mix3((0.56, 0.55, 0.54), (0.95, 0.52, 0.30), rust * 0.8)
    return mix3(c, BLOOD_ON_METAL, blood * 0.9)


if 'boot' in PARTS:
    drop(['foot.l|boot', 'foot.r|boot']); clear_work()
    # The shaft round the ankle and its rolled cuff.
    # The shaft flares at its base into the sole's egg outline (a swollen elephant-foot ankle, not a can on a plate).
    bm = bmesh.new(); segs = 48; rows = []
    for z in (0.050, 0.075, 0.100, 0.125, 0.160, Z_CUFF - 0.02):
        w = sm((0.125 - z) / 0.075)                  # 1 at the sole, 0 from 0.125 up
        row = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            circ = G + (OUT * math.cos(a) + FWD * math.sin(a)) * R_SHAFT
            row.append(bm.verts.new(circ.lerp(sole_pt(a, 0.94), w) + UP * z))
        rows.append(row)
    for i in range(len(rows) - 1):
        for k in range(segs):
            bm.faces.new((rows[i][k], rows[i][(k + 1) % segs], rows[i + 1][(k + 1) % segs], rows[i + 1][k]))
    bm.faces.new(list(reversed(rows[0]))); bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); mkobj('shaft', bm)
    prism('cuff', G + UP * (Z_CUFF - 0.035), G + UP * Z_CUFF, R_CUFF, 12, math.pi / 12)
    ring('cufflip', G + UP * Z_CUFF, UP, R_CUFF - 0.006, 0.011, segs=48)
    # Two straps round the shaft, a buckle block on the outside of each.
    for j, z in enumerate((0.142, 0.208)):          # above the flare
        prism(f'strap{j}', G + UP * (z - 0.013), G + UP * (z + 0.013), R_SHAFT + 0.009, 12, math.pi / 12)
        box(f'buckle{j}', G + UP * z + OUT * (R_SHAFT + 0.016), 0.022, 0.050, 0.040)
        bolt(f'bk{j}', G + UP * z + OUT * (R_SHAFT + 0.027), OUT, r=0.008, h=0.008)
    # Rivets round the cuff.
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        d = OUT * math.cos(a) + FWD * math.sin(a)
        bolt(f'cr{k}', G + UP * (Z_CUFF - 0.018) + d * R_CUFF * math.cos(math.pi / 12), d, r=0.008, h=0.007)
    # The foot: a heavy rounded clog body heel to toe, and a round steel toe cap over its front.
    ball('foot', G + FWD * 0.075 + UP * 0.088, 1.0, 0.150, 0.205, 0.092)
    ball('toecap', G + FWD * 0.200 + UP * 0.072, 1.0, 0.142, 0.112, 0.080)
    # A thick rounded sole, its rim rolled like a hoof, and a raised welt where the upper meets it. Bolts round the
    # welt follow the egg outline.
    pad('sole', [(-0.004, 0.86), (0.008, 0.95), (0.022, 1.0), (0.040, 0.99), (0.054, 0.93), (0.062, 0.84)])
    for k in range(14):
        a = 2 * math.pi * (k + 0.5) / 14
        p = sole_pt(a, 0.995) + UP * 0.030
        bolt(f'sb{k}', p, (p - SC - UP * 0.030).normalized(), r=0.008, h=0.008)
    finish('boot', 'foot.l|boot', 6000, material='impmetal', tint=btint,
           voxel=0.0030, smooth=(0.4, 2), noise=0.0012, noise_scale=0.05)

if 'bgore' in PARTS:
    drop(['foot.l|bgore', 'foot.r|bgore']); clear_work()
    # Where the fat comes out over the cuff: torn meat lying on the rim, blood running down the shaft's outside.
    gore_ring('bc', G + UP * (Z_CUFF + 0.006), UP, R_CUFF - 0.004, 16, 0.014, 0.028, drips=3, dlen=(0.04, 0.09), out=UP, seed=31)
    finish_gore('bgore', 'foot.l|bgore', 2200)
