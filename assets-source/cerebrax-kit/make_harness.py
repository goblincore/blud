# The cerebrax's HARNESS (pelvis|harness): the bone-metal ring the brain is clamped into and the four legs hang from.
# Not a plain torus (biomech-style.md: "never basic shapes"): a convex band fitted to the brain's own skin, high at the
# back and sweeping DOWN at the front to a point under the face like a mandible (the face sits low on the brain, so a
# level ring would cut across its chin); a crest round its middle, rolled lips top and bottom, chevron ribs raking
# back; a knuckled socket boss where each leg hangs; and curved talons rising off its top edge that close over the
# brain like the prongs holding a gem. The brain swells and turns inside it; the harness rides the frame (`pelvis`).
import bpy, math
from mathutils import Vector

try:
    PARTS
except NameError:
    PARTS = {'ring', 'frame', 'talons'}
O = Vector((J['centre'][0], 0, J['centre'][2]))         # the ring's centre axis (blob x, -, z)
# DIP: the brain is tilted 25 deg face-down (cerebrax.blob), its chin at y ~1.15; the V's flat bottom sits just under
# it (the owner: the face hanging low over the frame, close to the gun). 0.26 under the upright brain's face.
Y_BACK, DIP, DIP_FLAT, DIP_W, BAND = 1.62, 0.50, 18.0, 70.0, 0.15
CLEAR = 0.018                                           # the band's inner face this far off the brain's skin


def smooth(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)


def y_top(lon):
    """The band's top edge: Y_BACK at the back, dipping DIP under the face: flat across the face's width (+-DIP_FLAT
    deg), then rising to Y_BACK by +-DIP_W, so the V's arms climb either side of the face."""
    return Y_BACK - DIP * (1 - smooth((abs(lon) - DIP_FLAT) / (DIP_W - DIP_FLAT)))


_RCACHE = {}
def R(lon, y):
    k = (round(lon, 1), round(y, 3))
    if k not in _RCACHE: _RCACHE[k] = brain_radius_at(lon, y)
    return _RCACHE[k]


def band_point(u, v, out=0.0):
    """u across the band (0 bottom .. 1 top), v round it (0..1). Blender coords."""
    lon = -180 + 360 * v
    yt = y_top(lon); y = yt - BAND * (1 - u)
    r = max(R(lon, yt), R(lon, y)) + CLEAR + 0.034 * math.sin(math.pi * u) + out
    a = math.radians(lon)
    return bv(O.x + r * math.sin(a), y, O.z + r * math.cos(a))


if 'ring' in PARTS:
    drop(['pelvis|harness']); clear_work()
    P = lambda u, v: band_point(u, v)
    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, (v + e) % 1) - P(u, (v - e) % 1)
        n = dv.cross(du).normalized()
        c = bv(O.x, 0, O.z); p = P(u, v); radial = Vector((p.x - c.x, p.y - c.y, 0))
        return n if n.dot(radial) > 0 else -n
    surface_solid('band', P, N, 16, 180, 0.040, closed_v=True)
    # Rolled lips top and bottom, the crest round the middle, a blade on the crest.
    V = [i / 180 for i in range(181)]
    tube('lipT', [band_point(1.0, v, -0.006) for v in V], [0.016] * 181, segs=10)
    tube('lipB', [band_point(0.0, v, -0.006) for v in V], [0.016] * 181, segs=10)
    tube('crest', [band_point(0.55, v, 0.010) for v in V], [0.015] * 181, segs=10)
    tube('crest2', [band_point(0.55, v, 0.026) for v in V], [0.006] * 181, segs=8)
    # Chevron ribs raking back and down off the crest, both ways round from the front.
    for k in range(-11, 12):
        if k == 0: continue
        v0 = 0.5 + k / 26.0
        R_ = [i / 12 for i in range(13)]
        tube(f'rib{k}', [band_point(0.55 - 0.5 * u, v0 + (0.025 if k > 0 else -0.025) * u, 0.006) for u in R_],
             [0.004 + 0.008 * sn(0.1 + u * 0.9) for u in R_], segs=8)
    # The mandible point under the face: a keel running down off the dip, the gun mount's root.
    fp = band_point(0.0, 0.5, 0.0)
    tube('keel', [fp + Vector((0, 0.01 * i, -0.012 * i)) for i in range(9)], [0.040 - 0.003 * i for i in range(9)], segs=14)
    ball('chin', fp + Vector((0, 0.02, -0.06)), 1.0, 0.070, 0.060, 0.055)
    # Socket bosses: a knuckle at each leg's root, ringed along the leg, fused into the band.
    for key, up in (('hip', 'knee'), ('shoulder', 'elbow')):
        for sx in (1, -1):
            h = Vector((JV[key].x * sx, JV[key].y, JV[key].z)); kn = Vector((JV[up].x * sx, JV[up].y, JV[up].z))
            d = (kn - h).normalized()
            # Big enough that the strut's root stays sunk in it through the whole stride (the strut swings about h).
            ball(f'sock{key}{sx}', h, 1.0, 0.150, 0.150, 0.150)
            ring(f'sring{key}{sx}', h + d * 0.120, d, 0.100, 0.016)
            ring(f'sring2{key}{sx}', h + d * 0.150, d, 0.070, 0.011)
            # A raked horn off the boss, pointing back down the body: the socket's skull-cheek sweep.
            horn(f'shorn{key}{sx}', h - d * 0.05 + Vector((0, 0, 0.06)), -d + Vector((0, 0, 0.5)), d.cross(Vector((0, 0, 1))).normalized(), 0.16, 0.030, curl=-0.8)
            # A strut from the boss into the band (the band runs inside the legs' roots).
            tube(f'sstrut{key}{sx}', [h, h.lerp(bv(O.x, 1.50, O.z), 0.35)], [0.060, 0.050], segs=14)
    # Sutures down the band's face.
    sut = [zigzag(lambda s, v0=v0: band_point(0.2 + 0.6 * s, v0, 0.0), 0.007, 4,
                  lambda s, v0=v0: (band_point(0.2 + 0.6 * s, v0 + 0.01) - band_point(0.2 + 0.6 * s, v0)).normalized())
           for v0 in (0.12, 0.30, 0.70, 0.88)]
    # The eyes' red light spills onto the front of the band under the face (kit-overlay.ts GLOW_FROM_ATTRIBUTE:
    # skullmetal burns red): two embers at the eye sockets, a steep falloff over 0.35 m.
    eyes = [(sk(*tilted(-16.6, sx * 5.7), 0.01), 0.03, 0.9) for sx in (1, -1)]
    finish_part('harness', 'pelvis|harness', 9000, lines=sut, glow=(eyes, 0.35), voxel=0.005, noise=0.004, noise_scale=0.07, ao=(1.5, 1.6))

if 'frame' in PARTS:
    # THE CHASSIS (pelvis|frame): the band alone read as a ring with four legs stuck on it (owner, arena look,
    # 2026-11-08: "the legs seem a bit disconnected from the rest of the frame"). A side rail on each flank runs
    # hind socket -> fore socket, bowing out round the band; four braces drop from the sockets to a belly boss under
    # the brain; so every leg hangs off one welded frame, the reference's undercarriage.
    drop(['pelvis|frame']); clear_work()
    def bez(a, m, b, n=24):
        return [a * (1 - t) ** 2 + m * 2 * t * (1 - t) + b * t * t for t in (i / n for i in range(n + 1))]
    low = min(skin(-90 + i, lon)[0].y for i in range(0, 60, 2) for lon in range(-180, 180, 15))
    belly = bv(O.x, low - 0.12, J['centre'][2])
    print('FRAME brain bottom', round(low, 3), 'belly', tuple(round(c, 3) for c in belly))
    for sx in (1, -1):
        H = Vector((JV['hip'].x * sx, JV['hip'].y, JV['hip'].z)); S = Vector((JV['shoulder'].x * sx, JV['shoulder'].y, JV['shoulder'].z))
        # The rail: out round the band's flank at socket height, a little under it.
        v = 0.75 if sx > 0 else 0.25
        m = band_point(0.25, v, 0.10); m = Vector((m.x, m.y, H.z - 0.04))
        rail = bez(H, m, S)
        tube(f'rail{sx}', rail, [0.060 + 0.012 * (1 - bell((i / 24 - 0.5) / 0.5)) for i in range(25)], segs=16)
        top = [p + Vector((0, 0, 0.055)) for p in rail[3:-3]]
        tube(f'railcrest{sx}', top, [0.008 + 0.010 * bell((i / (len(top) - 1) - 0.5) / 0.5) for i in range(len(top))], segs=8)
        mid = rail[12]
        ring(f'railband{sx}', mid, (rail[13] - rail[11]).normalized(), 0.072, 0.013)
        # Chevron ribs down the rail's outer face.
        out = Vector((sx, 0, 0))
        for k in (6, 9, 15, 18):
            a_, b_ = rail[k], rail[k + 1]; t_ = (b_ - a_).normalized()
            R_ = [i / 10 for i in range(11)]
            tube(f'rrib{sx}{k}', [rail[k] + out * (0.058 + 0.004 * u) + Vector((0, 0, 0.04 - 0.09 * u)) - t_ * (0.04 * u) for u in R_],
                 [0.004 + 0.006 * sn(0.1 + u * 0.9) for u in R_], segs=8)
        # The braces: each socket down to the belly, sagging a little.
        for nm, P0 in (('h', H), ('s', S)):
            mm = P0.lerp(belly, 0.5) + Vector((0, 0, -0.06))
            br = bez(P0, mm, belly, 16)
            tube(f'brace{nm}{sx}', br, [0.048 - 0.012 * i / 16 for i in range(17)], segs=14)
            ring(f'bring{nm}{sx}', br[4], (br[5] - br[3]).normalized(), 0.050, 0.010)
    # The belly boss: a domed knuckle with a ring and a horn raking back down off it.
    ball('belly', belly, 1.0, 0.130, 0.130, 0.095)
    ring('bellyring', belly + Vector((0, 0, -0.03)), Vector((0, 0, 1)), 0.120, 0.016)
    horn('bellyhorn', belly + Vector((0, 0.02, -0.07)), Vector((0, 0.7, -1.0)), Vector((1, 0, 0)), 0.30, 0.050, curl=0.9)
    # A hanger from the belly forward to the keel, so the gun's mount is on the same frame.
    kp = band_point(0.0, 0.5, 0.0) + Vector((0, 0.02, -0.06))
    tube('gunstay', bez(belly, belly.lerp(kp, 0.5) + Vector((0, 0, -0.08)), kp, 16), [0.040] * 17, segs=12)
    finish_part('frame', 'pelvis|frame', 3500, voxel=0.005, noise=0.003, noise_scale=0.07, ao=(1.5, 1.6))

if 'talons' in PARTS:
    # Talons rising off the band's top edge and curling in over the brain: three per side, none in front of the face.
    drop(['pelvis|talons']); clear_work()
    for lon in (62, 108, 150, -62, -108, -150):
        v = (lon + 180) / 360.0
        base = band_point(1.0, v, 0.0)
        a = math.radians(lon)
        radial = Vector((math.sin(a), -math.cos(a), 0))         # blender: blob +z is -y
        tangent = Vector((0, 0, 1)).cross(radial).normalized()
        L = 0.42 if abs(lon) < 130 else 0.34
        # Leave upward, curl inward (toward the brain) round the tangent.
        horn(f't{lon}', base - radial * 0.01, Vector((0, 0, 1)) + radial * 0.15, tangent, L, 0.042, curl=-1.35)   # about z x radial, + turns outward: - curls in
        ball(f'tk{lon}', base + Vector((0, 0, 0.01)), 1.0, 0.050, 0.050, 0.040)
        ring(f'tr{lon}', base + Vector((0, 0, 0.045)), Vector((0, 0, 1)), 0.040, 0.009)
    finish_part('talons', 'pelvis|talons', 3000, voxel=0.004, noise=0.003, ao=(1.5, 1.6))
