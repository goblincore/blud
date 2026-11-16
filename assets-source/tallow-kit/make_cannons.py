# Tallow: the ARM CANNONS, third pass. Owner (2026-11-14): the second pass's crowned, finned barrels were "a bit too
# floral"; they "should look more heavy and industrial and ... more embedded in the flesh, more like bloody decals where
# the metal flesh interfaces". So: no crown points, chevron fins or spines. A heavy octagonal BREECH BLOCK sunk into the
# meat (tallow.blob's sleeve and lip roll up against its back face), a thick barrel with two bolted octagonal bands, a
# slotted muzzle brake, a hydraulic recoil piston on top and a banded fuel tank slung underneath, fed from the block.
# Where the block goes into him: torn meat, clots and drips (`gore`), and blood smeared on the metal, thick at the flesh
# and streaking forward along the underside. Still the Cronenberg rule (the meat swallows the breech); the machine
# itself is now plainly a machine.
#   barrel  forearm.l|barrel  block, barrel, bands, brake, piston, tank, bolts (impmetal; blood in vertex colours)
#   gore    forearm.l|gore    the torn meat and clots round the block's back face, drips hanging off it (gore)
#   throat  forearm.l|throat  a black liner filling the bore (void) from t 1.20 to just behind the muzzle rim
# The BORE IS A DARK HOLE (owner, 2026-11-15: the opening was "a light color so doesnt read as a barrel"): the brake
# rings are hollow (they were solid octagons that capped the muzzle in pale metal), the inside walls are sooted black,
# and the glowing ember disc and its bore glow are gone. The shot's fire is the muzzle blast (game-spawn.ts).
# The fireball leaves the muzzle (MotionProfile.spit from handTipR: the hand bone's tail is forearm t ~1.55).
# Everything rides the FOREARM. Built on the left and mirrored. PARTS selects a subset.
# BoneFrame on this forearm (pointing forward and down): ph 0 is the TOP of the cannon, ph 180 its underside.
import bpy, bmesh, math
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {'barrel', 'gore', 'throat'}

FA0, FA1 = BONE['forearm.l']
F = BoneFrame(FA0, FA1)
drop(['forearm.l|burner', 'forearm.r|burner'])      # the first pass's parts, if this .blend still has them
drop(['forearm.l|ember', 'forearm.r|ember'])        # the bore's glowing disc (third pass): the bore is dark now
at = lambda t: F.at(t, 0, 0, 0)
E1, E2, _ = basis(F.u)                              # the frame `prism` builds in, for placing bolts on its flats
face_dir = lambda a: E1 * math.cos(a) + E2 * math.sin(a)
OCT = math.pi / 8                                   # octagon rotation: its k-th flat faces OCT + (2k + 1) pi / 8

T_BREECH, T_BLOCK0, T_BLOCK1, T_MUZZLE = 0.38, 0.62, 0.92, 1.56
WALL = 0.038
# The barrel: 0.118 out of the block, tapering a little to the brake. Under the block it is hidden.
rad = lambda t: 0.118 - 0.008 * min(1.0, max(0.0, (t - T_BLOCK1) / (T_MUZZLE - T_BLOCK1)))
R_BLOCK, R_BAND, R_BRAKE = 0.152, 0.138, 0.150
T_THROAT = 1.20


def tph(co):
    d = co - F.h; t = d.dot(F.u) / F.L; rel = d - F.u * d.dot(F.u)
    return t, math.atan2(rel.dot(F.s), rel.dot(F.f))


def hollow_prism(name, a, b, ro, ri, segs=8, rot=0.0, inner=48):
    """A ring: a flat-sided prism of outer radius ro from a to b with a round hole of radius ri down its axis."""
    e1, e2, _ = basis(b - a)
    bm = bmesh.new()
    def loop(c, r, n, rr):
        return [bm.verts.new(c + (e1 * math.cos(rr + 2 * math.pi * k / n) + e2 * math.sin(rr + 2 * math.pi * k / n)) * r)
                for k in range(n)]
    # Same vertex count inside and out so the end caps are quads: the outer octagon resampled at `inner` points.
    def oct_loop(c):
        out = []
        for k in range(inner):
            th = 2 * math.pi * k / inner
            # Radius of a regular segs-gon (circumradius ro, a vertex at rot) along angle th.
            sector = 2 * math.pi / segs
            x = (th - rot) % sector - sector / 2
            r = ro * math.cos(sector / 2) / math.cos(x)
            out.append(bm.verts.new(c + (e1 * math.cos(th) + e2 * math.sin(th)) * r))
        return out
    oa, ob = oct_loop(a), oct_loop(b)
    ia, ib = loop(a, ri, inner, 0.0), loop(b, ri, inner, 0.0)
    n = inner
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((oa[k], oa[j], ob[j], ob[k]))      # outside
        bm.faces.new((ib[k], ib[j], ia[j], ia[k]))      # the hole
        bm.faces.new((ia[k], ia[j], oa[j], oa[k]))      # back face
        bm.faces.new((ob[k], ob[j], ib[j], ib[k]))      # front face
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mkobj(name, bm)


def smear(co):
    """The metal's vertex colour: dark gunmetal, with blood thick where the block meets the flesh (t 0.62) and runs of
    it streaking forward along the underside, each its own length. Inside the bore: soot, near black."""
    t, ph = tph(co)
    d = co - F.h; r = (d - F.u * d.dot(F.u)).length
    if t > 1.0 and r < rad(min(t, T_MUZZLE)) - WALL * 0.45:
        lip = sm((T_MUZZLE - 0.004 - t) / 0.03)          # the very rim stays a little lighter, a worn edge
        return mix3((0.30, 0.29, 0.28), (0.035, 0.032, 0.03), lip)
    # Mottled, never a painted band: a clot pattern times a fall-off from the flesh.
    mot = 0.5 + 0.5 * math.sin(co.x * 71.0 + math.sin(co.y * 53.0) * 2.4 + co.z * 59.0)
    base = (1 - sm((t - 0.63) / (0.06 + 0.12 * mot))) * (0.55 + 0.45 * mot)
    under = max(0.0, -math.cos(ph)) ** 0.7
    streak = 1.0 if math.sin(ph * 11.0 + 2.0 * math.sin(ph * 3.1)) > 0.25 else 0.0
    L = 0.12 + 0.34 * (0.5 + 0.5 * math.sin(ph * 7.7 + 1.1))
    run = (1 - sm((t - 0.63) / L)) * under * streak
    w = min(1.0, max(base, 0.9 * run))
    return mix3((0.60, 0.59, 0.58), BLOOD_ON_METAL, w)


if 'barrel' in PARTS:
    drop(['forearm.l|barrel', 'forearm.r|barrel']); clear_work()
    _, P, N = bone_shell('shell', F, T_BREECH, T_MUZZLE, -math.pi, math.pi, rad, rad, WALL, nu=60, nv=64)
    edge_lips(P, N, 0.015, n=120, which=('u1',), inset=0.006)
    # BREECH BLOCK: a heavy octagon sunk into the meat, a step down at its front, a row of bolts round each end.
    prism('block', at(T_BLOCK0), at(T_BLOCK1), R_BLOCK, 8, OCT)
    prism('blockstep', at(T_BLOCK1 - 0.01), at(T_BLOCK1 + 0.035), R_BLOCK - 0.016, 8, OCT)
    flat = R_BLOCK * math.cos(math.pi / 8)
    for row, t in enumerate((0.72, 0.85)):
        for k in range(8):
            a = OCT + (2 * k + 1) * math.pi / 8
            bolt(f'bb{row}{k}', at(t) + face_dir(a) * flat, face_dir(a))
    # Two heavy octagonal bands down the barrel, four bolts each.
    for j, t in enumerate((1.06, 1.24)):
        prism(f'band{j}', at(t - 0.022), at(t + 0.022), R_BAND, 8, OCT)
        for k in range(0, 8, 2):
            a = OCT + (2 * k + 1) * math.pi / 8
            bolt(f'nb{j}{k}', at(t) + face_dir(a) * R_BAND * math.cos(math.pi / 8), face_dir(a), r=0.009, h=0.010)
    # MUZZLE BRAKE: two octagonal rings joined by four bars, the barrel showing through the slots between.
    # Hollow: the bore runs open through both rings to the muzzle (solid rings capped it in pale metal).
    hollow_prism('brake0', at(1.40), at(1.44), R_BRAKE, rad(1.42) - 0.006, 8, OCT)
    hollow_prism('brake1', at(1.51), at(T_MUZZLE), R_BRAKE, rad(1.535) - 0.006, 8, OCT)
    for k in range(0, 8, 2):
        a = OCT + 2 * k * math.pi / 8
        d = face_dir(a) * (R_BRAKE - 0.012)
        prism(f'bar{k}', at(1.43) + d, at(1.52) + d, 0.016, 4, math.pi / 4)
    # HYDRAULIC RECOIL PISTON along the top: a cylinder off the block's front, its rod into a lug on the front band.
    top = F.f
    H0, H1, H2 = at(0.95) + top * 0.172, at(1.10) + top * 0.172, at(1.235) + top * 0.172
    prism('cyl', H0, H1, 0.026, 12)
    prism('cylcap', H0 - F.u * 0.012, H0 + F.u * 0.006, 0.030, 12)
    prism('rod', H1, H2, 0.012, 12)
    prism('lug0', at(0.955) + top * 0.10, at(0.955) + top * 0.165, 0.016, 4, math.pi / 4)
    prism('lug1', at(1.235) + top * 0.13, at(1.235) + top * 0.168, 0.014, 4, math.pi / 4)
    ball('rodend', H2, 0.018)
    # FUEL TANK slung underneath: a banded canister clamped to the barrel, fed into the block's underside.
    dn = -F.f
    K0, K1 = at(0.97) + dn * 0.196, at(1.20) + dn * 0.196
    prism('tank', K0, K1, 0.046, 12)
    for j, u in enumerate((0.12, 0.5, 0.88)):
        c = K0.lerp(K1, u); prism(f'tb{j}', c - F.u * 0.009, c + F.u * 0.009, 0.051, 12)
    for j, (c, s_) in enumerate(((K0, -1), (K1, 1))):
        prism(f'tcap{j}', c, c + F.u * 0.014 * s_, 0.034, 12)
    for j, t in enumerate((1.02, 1.15)):
        prism(f'clamp{j}', at(t) + dn * 0.112, at(t) + dn * 0.152, 0.014, 4, math.pi / 4)
    tube('feedpipe', [K0 - F.u * 0.01, K0 - F.u * 0.04 + F.f * 0.02, at(0.88) + dn * 0.17, at(0.86) + dn * 0.135], [0.016] * 4, segs=10)
    finish('barrel', 'forearm.l|barrel', 4200, material='impmetal', tint=smear,
           voxel=0.0030, smooth=(0.4, 2), noise=0.0012, noise_scale=0.05)

if 'gore' in PARTS:
    drop(['forearm.l|gore', 'forearm.r|gore']); clear_work()
    # Where the block's back face meets the meat (the sleeve's surface is r ~0.145 there): torn lumps lying back
    # against the flesh, blood hanging off the low side, and clots smeared up onto the block's first flats.
    gore_ring('gc', at(T_BLOCK0 - 0.005), F.u, 0.146, 18, 0.016, 0.032, drips=4, dlen=(0.04, 0.10), out=-F.u, seed=3)
    gore_ring('gs', at(T_BLOCK0 + 0.05), F.u, R_BLOCK * math.cos(math.pi / 8) + 0.002, 9, 0.008, 0.016, out=None, seed=8)
    finish_gore('gore', 'forearm.l|gore', 1400)


def disc(name, centre, r, flatk):
    o = ball(name, Vector(), 1.0, r, r, r * flatk)
    o.data.transform(F.u.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    o.data.transform(Matrix.Translation(centre))
    return o


if 'throat' in PARTS:
    drop(['forearm.l|throat', 'forearm.r|throat']); clear_work()
    # A black LINER down the bore, its front face just behind the muzzle rim: the barrel's own metal, even sooted,
    # caught the environment light and read pale. Black from the rim back is what reads as a hole.
    T_LINER = T_MUZZLE - 0.028
    plain_part(prism('throat', at(T_THROAT), at(T_LINER), rad(T_LINER) - WALL - 0.002, 32), 'void', 'forearm.l|throat')
