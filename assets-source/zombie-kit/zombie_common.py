# assets-source/zombie-kit/zombie_common.py
#
# Shared by the zombie kit's make scripts. exec() after ../twinhead-kit/kit_sculpt.py (bv, tube, ring, ball, fuse, ...).
# Skin comes from surface.json (scripts/zombie-surface.ts): every strap, cuff and trouser leg is laid on the PROBED
# skin a set clearance out, not round a bone (biomech-style.md). All helpers here take and return BLOB coordinates
# (metres, Y up, +Z forward); convert with B() when building geometry.
import bpy, bmesh, json, math, os, random
from mathutils import Vector, Matrix

SURF = json.load(open(os.path.join(KIT_DIR, 'surface.json')))
_TOR = SURF['torso']
_TY = [r['y'] for r in _TOR]
LIMB = SURF['limbs']


def B(v):
    return bv(v[0], v[1], v[2])


def _lerp(a, b, k):
    return a + (b - a) * k


def torso_pt(y, th, out=0.0):
    """The torso skin at height y, angle th (deg; 0 = front +z, +90 = the body's left, +x), pushed `out` metres along
    the horizontal radial (the strap clearance). Bilinear over surface.json's 1 cm x 6 deg rings."""
    y = min(max(y, _TY[0]), _TY[-1])
    i = min(int((y - _TY[0]) / 0.01), len(_TY) - 2); ky = (y - _TY[i]) / 0.01
    th = th % 360.0; j = int(th // 6) % 60; kt = (th - j * 6) / 6.0; j2 = (j + 1) % 60

    def at(r):
        a, b = Vector(_TOR[r]['pts'][j]), Vector(_TOR[r]['pts'][j2])
        return a.lerp(b, kt)
    p = at(i).lerp(at(i + 1), ky)
    rad = Vector((p.x, 0, p.z - 0.02))
    if rad.length > 1e-6 and out: p = p + rad.normalized() * out
    return p


def limb_frame(bone):
    L = LIMB[bone]; h = Vector(L['head']); t = Vector(L['tail'])
    u = (t - h).normalized()
    fw = Vector((0, -1, 0)) if abs(u.z) > 0.9 else (Vector((0, 0, 1)) - u * u.z).normalized()
    s = fw.cross(u); o = -1 if bone.endswith('.r') else 1
    return h, t, u, fw, s * o


def limb_r(bone, t, ph):
    L = LIMB[bone]; T = L['t']; R = L['r']
    t = min(max(t, T[0]), T[-1])
    i = min(int((t - T[0]) / 0.04 + 1e-9), len(T) - 2); kt = (t - T[i]) / 0.04
    ph = ph % 360.0; j = int(ph // 15) % 24; kp = (ph - j * 15) / 15.0; j2 = (j + 1) % 24
    def rr(row):
        a, b = R[row][j], R[row][j2]
        if a < 0: a = b
        if b < 0: b = a
        return _lerp(a, b, kp)
    return max(0.01, _lerp(rr(i), rr(i + 1), kt))


def limb_pt(bone, t, ph, out=0.0, r=None):
    """Skin round `bone` at fraction t, angle ph (deg; 0 = the bone frame's front, +90 = outward), `out` metres proud."""
    h, tl, u, fw, s = limb_frame(bone)
    a = math.radians(ph)
    d = fw * math.cos(a) + s * math.sin(a)
    rad = (limb_r(bone, t, ph) if r is None else r) + out
    return h + (tl - h) * t + d * rad


def limb_dir(bone, ph):
    h, tl, u, fw, s = limb_frame(bone); a = math.radians(ph)
    return fw * math.cos(a) + s * math.sin(a)


def band(name, P, nu, nv, thick, closed=True):
    """A closed shell from a parametric band P(u, v) in BLOB coords (u across the band, v round it), `thick` inward."""
    def PP(u, v): return B(P(u, v))
    def NN(u, v):
        e = 1e-3
        du = PP(min(1, u + e), v) - PP(max(0, u - e), v)
        dv = PP(u, (v + e) % 1 if closed else min(1, v + e)) - PP(u, (v - e) % 1 if closed else max(0, v - e))
        n = du.cross(dv)
        n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
        c = PP(u, v)
        return n
    # orient: the normal must point AWAY from the band's own centroid
    cen = Vector()
    for i in range(8): cen += PP(0.5, i / 8)
    cen /= 8
    sgn = 1 if NN(0.5, 0.0).dot(PP(0.5, 0.0) - cen) > 0 else -1
    return surface_solid(name, PP, lambda u, v: NN(u, v) * sgn, nu, nv, thick, closed_v=closed)


def stadium(name, c, a, b, L, W, minor, gap=0.0, segs=8, n=28):
    """A chain link: a stadium loop centred at c (blender coords), long along a, wide along b. `gap` (0..1) opens it
    at the far end (a broken link)."""
    a = a.normalized(); b = b.normalized(); pts = []
    rr = W / 2; straight = max(0.0, L / 2 - rr)
    for k in range(n + 1):
        s = k / n
        if gap and abs(s - 0.25) < gap / 2: continue
        th = 2 * math.pi * s
        # a stadium: two half-circles joined by straights
        x = math.cos(th) * rr + (straight if math.cos(th) > 0 else -straight)
        y = math.sin(th) * rr
        pts.append(c + a * x + b * y)
    if not gap: pts.append(pts[1])
    return tube(name, pts, [minor] * len(pts), segs=segs, caps=bool(gap))


def chain(prefix, start, down, side, links, L=0.030, W=0.019, minor=0.0042, broken=True, sag=None):
    """A hanging chain from `start` (blender coords) along `down`; alternate links turn 90 degrees. The last link is
    broken open when `broken`. `sag(i)` may bend the run (a Vector offset per link)."""
    down = down.normalized(); side = side.normalized(); other = down.cross(side).normalized()
    p = start + down * (L / 2 - minor); objs = []
    for i in range(links):
        off = sag(i) if sag else Vector()
        b = side if i % 2 == 0 else other
        last = broken and i == links - 1
        objs.append(stadium(f'{prefix}{i}', p + off, down, b, L, W, minor, gap=0.32 if last else 0.0))
        p = p + down * (L - 2.2 * minor)
    return objs


def colourise(o, base, rust=None, rust_amt=0.0, seed=1, scale=18.0, dirt=None):
    """Multiply the baked AO (vertex colour) by a base albedo, mottled toward `rust` by a position noise. The material's
    baseColorFactor stays white so the vertex colour IS the albedo."""
    from mathutils import noise
    ca = o.data.color_attributes.active_color
    if ca is None:
        ca = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        o.data.color_attributes.active_color = ca; o.data.color_attributes.render_color_index = 0
        for v in ca.data: v.color = (1, 1, 1, 1)
    for i, v in enumerate(o.data.vertices):
        c = ca.data[i].color
        k = 0.0
        if rust is not None:
            n = noise.noise(v.co * scale + Vector((seed, seed * 2, seed * 3)))
            k = min(1.0, max(0.0, 0.5 + 0.9 * n)) * rust_amt
        col = [base[q] * (1 - k) + (rust[q] if rust else 0) * k for q in range(3)]
        if dirt is not None:   # darker toward the floor: dirt and dried blood soak up from below
            d = dirt(v.co)
            col = [col[q] * (1 - d) + 0.05 * d for q in range(3)]
        ca.data[i].color = (c[0] * col[0], c[1] * col[1], c[2] * col[2], 1.0)


def finish(name, kit, material, tris, voxel=0.0018, noise=0.0008, noise_scale=0.02, smooth=(0.5, 3), ao=True,
           base=(0.8, 0.8, 0.8), rust=None, rust_amt=0.0, seed=1, dirt=None):
    o = fuse(name, voxel=voxel, smooth=smooth, noise=noise, noise_scale=noise_scale)
    decimate(o, tris)
    if ao: bake_ao(o, material=material, ao_dist=0.03)
    else: plain(o, material)
    colourise(o, base, rust, rust_amt, seed, dirt=dirt)
    return install(o, kit)


def mat(name, base=(1, 1, 1), rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m
