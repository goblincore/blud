# Tallow: the BREATHING MASK and its tubes (owner, 2026-11-14, third pass: "you can add back the breathing mask and
# tubes n stuff on the face"). Heavier and more industrial than the first pass's bony muzzle: a contoured plate over
# his lower face strapped round the back of his head, a heavy canister snout with a grille, a filter canister on each
# cheek, and two corrugated hoses from under the snout down into ports in his upper chest. It is EMBEDDED, not worn:
# the plate sits 2 mm under his skin at its inner face, the strap bites in, and every edge where metal meets flesh is
# torn meat and blood (`gore`), with drips off the plate's lower edge down his chin.
#   mask    skull|mask      plate, snout, grille, filters, strap, bolts (impmetal; blood low on it)
#   snoutv  skull|snoutv    the dark inside of the snout, behind the grille (void)
#   mgore   skull|mgore     the gore round the plate and along the strap (gore)
#   hoses   skull|mhoseL/R  the hoses, riding the head, ending in couplings just above the chest ports
#   ports   spine2|mportL/R the chest ports; spine2|mgoreL/R their gore
# PARTS selects a subset. The face's own prims (tallow.blob: brow, red eyes, nose) stay above the plate.
import bpy, math, random
from mathutils import Vector, Matrix

try:
    PARTS
except NameError:
    PARTS = {'mask', 'mgore', 'hoses', 'ports'}

UP = Vector((0, 0, 1))
# The plate's outline in (height y, angle a): under the nose (its bottom is y ~1.785) to under the jaw, TAPERING to
# a point at each cheek where the filter sits. The third look's plate ran +-62 deg at full height and read as a flat
# band round his face (biomech-style.md, the deadeye: a mask reads only when it is SMALL and SHAPED).
A0, A1 = -46.0, 46.0
ylo = lambda a: 1.672 + 0.040 * (a / 46.0) ** 2
yhi = lambda a: 1.776 - 0.022 * (a / 46.0) ** 2
uv = lambda u, v: (lambda a: (ylo(a) + (yhi(a) - ylo(a)) * v, a))(A0 + (A1 - A0) * u)
MY = 1.725
M = tp(MY, 0, 0.012); MN = tn(MY, 0)
SD = (MN - UP * 0.35).normalized()                 # the snout points out and down
SIDE = UP.cross(SD).normalized(); VERT = SD.cross(SIDE).normalized()   # SIDE is +x, his left


def mtint(co):
    """Dark gunmetal, blood toward the plate's lower edge and the snout's underside (blender z is blob y)."""
    w = 1 - sm((co.z - (1.668 - LOWER)) / 0.045)
    mot = 0.5 + 0.5 * math.sin(co.x * 71.0 + co.y * 59.0 + math.sin(co.z * 53.0) * 2.4)
    return mix3((0.58, 0.57, 0.56), BLOOD_ON_METAL, min(1.0, w * (0.5 + 0.5 * mot)))


if 'mask' in PARTS:
    drop(['skull|mask', 'skull|snoutv']); clear_work()
    P = lambda u, v: tp(*uv(u, v), 0.010)
    N = lambda u, v: tn(*uv(u, v))
    surface_solid('plate', P, N, 40, 14, 0.012)
    edge_lips(P, N, 0.007, n=90, which=('v0', 'v1', 'u0', 'u1'), inset=0.004)
    # Bolts round the plate, into his face.
    for (u, v) in ((0.12, 0.25), (0.12, 0.8), (0.88, 0.25), (0.88, 0.8), (0.32, 0.88), (0.68, 0.88), (0.5, 0.1)):
        y, a = uv(u, v); bolt(f'pb{u}{v}', tp(y, a, 0.012), tn(y, a), r=0.008, h=0.008)
    # The snout: a heavy banded canister with a grille across its front.
    S0, S1 = M - SD * 0.010, M + SD * 0.090
    prism('snout', S0, S1, 0.058, 12)
    for j, u in enumerate((0.35, 0.75)):
        c = S0.lerp(S1, u); prism(f'sb{j}', c - SD * 0.008, c + SD * 0.008, 0.064, 12)
    ring('grim', S1, SD, 0.052, 0.009, segs=36)
    for k in range(5):
        off = -0.036 + 0.018 * k; w = math.sqrt(max(0.0, 0.050 ** 2 - off ** 2))
        c = S1 + VERT * off
        tube(f'gb{k}', [c - SIDE * w, c + SIDE * w], [0.0055, 0.0055], segs=8)
    # Filter canisters on the cheeks, pointing out and down.
    for sg in (-1, 1):
        y, a = 1.716, sg * 44
        b0 = tp(y, a, 0.010); fd = (tn(y, a) - UP * 0.45).normalized()
        prism(f'f{sg}', b0 - fd * 0.01, b0 + fd * 0.075, 0.034, 12)
        for j, u in enumerate((0.3, 0.65)):
            c = b0 + fd * (0.075 * u); prism(f'fr{sg}{j}', c - fd * 0.006, c + fd * 0.006, 0.039, 12)
        prism(f'fc{sg}', b0 + fd * 0.075, b0 + fd * 0.088, 0.027, 12)
    # The strap: round the back of his head from the plate's edges, biting in (its centre 2 mm under the skin).
    pts = [tp(1.732 + 0.010 * math.sin(math.radians(a - 60) * 1.5), a, -0.002) for a in range(44, 317, 5)]
    tube('strap', pts, [0.011] * len(pts), segs=8)
    finish('mask', 'skull|mask', 6000, mirror=False, material='impmetal', tint=mtint,
           voxel=0.0024, smooth=(0.4, 2), noise=0.0010, noise_scale=0.04)
    clear_work()
    o = ball('snoutv', Vector(), 1.0, 0.050, 0.050, 0.020)
    o.data.transform(SD.to_track_quat('Z', 'Y').to_matrix().to_4x4()); o.data.transform(Matrix.Translation(S1 - SD * 0.012))
    plain_part(o, 'void', 'skull|snoutv', mirror=False)

if 'mgore' in PARTS:
    drop(['skull|mgore']); clear_work()
    rng = random.Random(11)
    # Torn meat along the plate's whole outline, where its edge goes into his face.
    edge = [(i / 14, 0.0) for i in range(15)] + [(i / 14, 1.0) for i in range(15)] + [(0.0, j / 5) for j in range(1, 5)] + [(1.0, j / 5) for j in range(1, 5)]
    for k, (u, v) in enumerate(edge):
        if rng.random() < 0.35: continue   # gaps: an unbroken row read as red beads
        y, a = uv(u, v); y += (-0.006 if v == 0 else 0.006 if v == 1 else 0.0)
        a += (-3 if u == 0 else 3 if u == 1 else 0)
        lump(f'pe{k}', tp(y, a, 0.002), tn(y, a), rng.uniform(0.008, 0.016) * (1.7 if rng.random() < 0.2 else 1.0), flat=rng.uniform(0.35, 0.65),
             stretch=rng.uniform(1.0, 1.8), spin=rng.uniform(0, math.pi))
    # Blood off the plate's lower edge, down his chin.
    for k, u in enumerate((0.30, 0.46, 0.58, 0.72)):
        y, a = uv(u, 0.0); drip(f'pd{k}', tp(y - 0.004, a, 0.006), rng.uniform(0.03, 0.07), rng.uniform(0.005, 0.0075))
    # Along the strap, alternately above and below it, where it bites in.
    for k, a in enumerate(range(52, 310, 14)):
        if rng.random() < 0.4: continue
        y = 1.732 + 0.010 * math.sin(math.radians(a - 60) * 1.5) + (0.014 if k % 2 else -0.014)
        lump(f'se{k}', tp(y, a, 0.002), tn(y, a), rng.uniform(0.007, 0.012), flat=0.5, stretch=1.6)
    finish_gore('mgore', 'skull|mgore', 3000, mirror=False)

CP_Y, CP_A = 1.50, 20
CP = tp(CP_Y, CP_A, 0.012); CN = tn(CP_Y, CP_A)

if 'hoses' in PARTS:
    drop(['skull|mhoseL', 'skull|mhoseR']); clear_work()
    S0h = M + SD * 0.055 - VERT * 0.050 + SIDE * 0.030
    hose_run('mh', [S0h, S0h - UP * 0.06 + SD * 0.02 + SIDE * 0.02, CP + CN * 0.13 + UP * 0.08, CP + CN * 0.06 + UP * 0.01, CP + CN * 0.022], 0.022, rib_every=0.022)
    ball('mhc', CP + CN * 0.022, 0.029)
    finish('mhose', 'skull|mhoseL', 3000, material='hose', ao=(1.3, 1.4), voxel=0.0028, smooth=(0.4, 2), noise=0.0012, noise_scale=0.03)

if 'ports' in PARTS:
    drop(['spine2|mportL', 'spine2|mportR', 'spine2|mgoreL', 'spine2|mgoreR']); clear_work()
    port('mp', CP, CN, 0.036)
    finish('mport', 'spine2|mportL', 1600, material='skullmetal', voxel=0.0026, smooth=(0.5, 2), noise=0.0015, noise_scale=0.04)
    gore_ring('mg', CP - CN * 0.008, CN, 0.060, 10, 0.010, 0.020, drips=2, dlen=(0.03, 0.07), seed=5)
    finish_gore('mgore', 'spine2|mgoreL', 1800)
