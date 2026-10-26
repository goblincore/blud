# assets-source/zombie-kit/make_kit.py
#
# THE ZOMBIE'S KIT (owner, 2026-10-26: bring the zombie up to the newer creatures' standard). Every look shares:
#   * the grabber HANDS (look-dev concept A, assets-source/zombie-kit history: make_hands.py), now 1.2x and fleshier;
#   * IRON WRIST SHACKLES hiding the seam where the forearm meets the hand, each with a broken chain.
# and then ONE outfit on top. The owner picked the LABOURER (2026-10-26 look-dev, all three rendered in
# docs/dev-notes/2026-10-26-zombie-refine-lookdev/); the other two stay buildable for variants:
#   labourer  torn work trousers to below the knee, work boots, suspenders   (the default: zombie-parts.glb)
#   asylum    ankle shackles with broken chains, a torn canvas straitjacket yoke and its leather straps
#   morgue    a toe tag on the right big toe, a torn sheet over one shoulder and round the hips (wants
#             `zombie-detail-gen.ts --incision` for its Y-incision)
#
#   /opt/homebrew/bin/blender -b -noaudio -P assets-source/zombie-kit/make_kit.py [-- <variant|none>]
#   npx tsx scripts/blender-kit.ts zombie assets-source/zombie-kit/zombie-parts.glb
#
# TRIANGLES: the zombie is the crowd enemy, so every part is decimated to a small budget (the look-dev's were twice
# these, ~31k tris for the labourer); the shipped kit is ~15k.
#
# Skin positions come from surface.json (npx tsx scripts/zombie-surface.ts). Parts are named `<bone>|<part>` and
# ride that bone rigidly (scripts/blender-kit.ts). `zombieskin` is FLESH: the game redraws it with the flesh shader's
# lighting in the zombie's own flesh (kit-flesh.ts). Everything else is albedo in vertex colours on a white material.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
VARIANT = argv[0] if argv and not argv[0].startswith('--') else 'labourer'
OUT_GLB = os.path.join(HERE, 'zombie-parts.glb' if VARIANT == 'labourer' else f'zombie-{VARIANT}-parts.glb')

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
mech = bpy.data.collections.get('mech') or bpy.data.collections.new('mech')
if mech.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(mech)
G = {'__name__': '__kit__', 'KIT_DIR': HERE}
exec(open(os.path.join(HERE, '../twinhead-kit/kit_sculpt.py')).read(), G)
exec(open(os.path.join(HERE, 'zombie_common.py')).read(), G)
globals().update({k: v for k, v in G.items() if not k.startswith('__')})

# Materials: a white base so the baked vertex colour is the albedo (blender-kit.ts multiplies them).
for n in ('rustplate', 'chain', 'cloth', 'leather', 'boot', 'white', 'skullmetal'):
    mat(n)
_SKIN = mat('zombieskin', (0.82, 0.44, 0.46), 0.38)   # henenlotter-latex baseColor (the game swaps in its own flesh)
_NAIL = mat('zombienail', (0.42, 0.36, 0.22), 0.30)   # yellowed, cracked horn

# Dark: the first cuffs at (0.30, 0.28, 0.26) / (0.36, 0.15, 0.06) rendered as pale gold bangles in the lab.
IRON = (0.10, 0.095, 0.09); RUST = (0.17, 0.065, 0.025)


# ======================================================================== hands
HAND_SCALE = 1.2          # owner: "about 1.2x"
HMAT = {'Flesh': _SKIN, 'Nail': _NAIL}
HPARTS = []


def _sphere(r, segs=9, rings=6):     # crowd-cheap: the zombie is the horde enemy
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free(); return me


def _frustum(r0, r1, d, segs=8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=d)
    me = bpy.data.meshes.new('f'); bm.to_mesh(me); bm.free(); return me


def _put(me, m, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    o = bpy.data.objects.new('p', me); mech.objects.link(o); HPARTS.append(o)
    o.location = loc; o.rotation_euler = rot; o.scale = scale; o.parent = parent
    o.data.materials.append(HMAT[m])
    for p in o.data.polygons: p.use_smooth = True
    return o


def _seg(parent, p0, p1, r0, r1, m='Flesh', segs=8):
    a, b = Vector(p0), Vector(p1); d = b - a
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    return _put(_frustum(r0, r1, d.length, segs), m, parent, loc=(a + b) / 2, rot=rot)


def hand(root, palm, fingers, thumb, digit_r, joint_r, palm_lumps=()):
    """The grabber, in its own frame: origin at the palm centre, fingers -Z, palmar +Y, thumb +X.
    fingers: (x at the knuckle, splay deg, lengths, curls)."""
    _put(_sphere(1.0, 14, 9), 'Flesh', root, scale=palm)
    for (x, y, z, r) in palm_lumps:                      # swellings, so the palm is not a clean egg
        _put(_sphere(r, 9, 6), 'Flesh', root, loc=(x, y, z))
    for (kx, splay, lens, curls) in fingers:
        p = Vector((kx, -0.003, -palm[2] * 0.86))
        q = Quaternion((0, 1, 0), math.radians(-splay)); lateral = q @ Vector((1, 0, 0))
        _put(_sphere(joint_r[0]), 'Flesh', root, loc=p)
        # the bony back: a metacarpal ridge from the wrist end of the palm to this knuckle
        _seg(root, Vector((kx * 0.5, -palm[1] * 0.8, palm[2] * 0.55)), p + Vector((0, -0.003, 0)), digit_r[0] * 0.5, digit_r[0] * 0.7)
        for j in range(3):
            q = Quaternion(lateral, math.radians(curls[j])) @ q
            nxt = p + q @ Vector((0, 0, -lens[j]))
            _seg(root, p, nxt, digit_r[j], digit_r[j + 1])
            if j < 2: _put(_sphere(joint_r[j + 1]), 'Flesh', root, loc=nxt)
            p = nxt
        # a cracked dark nail on the back of the tip
        _put(_sphere(digit_r[3] * 1.35, 10, 8), 'Nail', root, loc=p + q @ Vector((0, -digit_r[3] * 0.6, 0.002)), scale=(1.0, 0.45, 1.5))
    t0 = Vector((palm[0] * 0.80, 0.008, 0.012)); _put(_sphere(joint_r[0] * 1.1), 'Flesh', root, loc=t0)
    t1 = t0 + Vector(thumb[0]).normalized() * 0.038; _seg(root, t0, t1, digit_r[0] * 1.15, digit_r[1] * 1.1)
    _put(_sphere(joint_r[1] * 1.05), 'Flesh', root, loc=t1)
    t2 = t1 + Vector(thumb[1]).normalized() * 0.030
    _seg(root, t1, t2, digit_r[1] * 1.05, digit_r[3] * 1.1)
    _put(_sphere(digit_r[3] * 1.2, 8, 6), 'Nail', root, loc=t2 + Vector((0, -digit_r[3] * 0.6, 0)), scale=(1, 0.45, 1.3))


def grabber(root, sx):
    # Concept A, FLESHIER (owner, 2026-10-26: "1.2x and fatter"): the palm 25% thicker and 10% wider, digits ~30% and
    # knuckles ~25% fatter than the first grabber, built at that size and then scaled 1.2 by the root. Mirrored for the
    # left hand by flipping x on every authored point (the look-dev authored a right hand).
    global HPARTS
    HPARTS = []
    hand(root, (0.044, 0.020, 0.055),
         [(+0.033, +14, (0.044, 0.027, 0.021), (12, 48, 34)),
          (+0.011, +4,  (0.048, 0.030, 0.022), (10, 50, 36)),
          (-0.012, -6,  (0.045, 0.028, 0.021), (14, 52, 38)),
          (-0.033, -18, (0.036, 0.022, 0.018), (18, 56, 40))],
         ((0.80, 0.30, -0.52), (0.55, 0.55, -0.62)),
         (0.0125, 0.0108, 0.0094, 0.0080), (0.0158, 0.0136, 0.0116),
         palm_lumps=((0.019, -0.013, 0.010, 0.019), (-0.023, -0.011, -0.014, 0.017), (0.0, 0.010, 0.006, 0.020)))
    if sx < 0:   # mirror into a left hand (and fix the winding a negative scale flips)
        m = Matrix.Diagonal((sx, 1, 1, 1))
        for o in HPARTS:
            o.data.transform(Matrix.Translation(o.location) @ o.rotation_euler.to_matrix().to_4x4() @ Matrix.Diagonal((*o.scale, 1)))
            o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)
            o.data.transform(m); o.data.flip_normals()


# zombie.blob's forearm TAIL (the wrist), from buildBody: (+-0.3011, 0.8121, 0.0703) in the .blob's frame. The hand's
# own frame is turned about Blender Z so the palm faces the thigh and the thumb points forward (Blender -Y).
WRIST = Vector(LIMB['foreArm.l']['tail'])
HANG = 0.072              # palm centre below the wrist: the bigger palm's half-length (0.055 x 1.2) plus a little


def build_hand(sx, bone):
    root = bpy.data.objects.new(f'{bone}-root', None); mech.objects.link(root)
    root.rotation_euler = (0, 0, math.radians(90 if sx < 0 else -90))
    w = B((WRIST.x * (-sx), WRIST.y, WRIST.z))
    root.location = (w.x, w.y, w.z - HANG)
    root.scale = (HAND_SCALE,) * 3
    grabber(root, sx)
    bpy.context.view_layer.update()
    parts = list(HPARTS); target = parts[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=parts, selected_editable_objects=parts):
        bpy.ops.object.join()
    mw = target.matrix_world.copy(); target.parent = None; target.matrix_world = mw
    bpy.data.objects.remove(root, do_unlink=True)
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=[target], selected_editable_objects=[target]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    target.name = f'{bone}|hand'; target.data.name = target.name
    return target


# ===================================================================== shackles
def cuff(sd, bone, t0, t1, prefix, clear=0.004, thick=0.0075, lip=0.0036, chain_dir=None, links=3, chain_ph=90.0):
    """An iron cuff round `bone` from t0 to t1: a band shaped to the probed skin `clear` metres out (rigid, so each
    angle takes the widest skin across the band), rolled lips, a hinge knuckle at the back, a lock boss at the front,
    rivets, and an eye at the bottom edge with a broken chain hanging from it."""
    clear_work()
    PH = [k * 7.5 for k in range(48)]
    R = {ph: max(limb_r(bone, t0 + (t1 - t0) * k / 6, ph) for k in range(7)) + clear for ph in PH}
    def rad(ph):
        ph %= 360; j = int(ph // 7.5) % 48; k = (ph - j * 7.5) / 7.5
        return R[PH[j]] * (1 - k) + R[PH[(j + 1) % 48]] * k
    # a slight barrel: the band bellies 1.5 mm at its middle, so it reads as forged rather than extruded
    band(f'{prefix}band', lambda u, v: limb_pt(bone, t0 + (t1 - t0) * u, 360 * v, r=rad(360 * v) + thick + 0.0015 * math.sin(math.pi * u)),
         10, 48, thick)
    for u in (0.0, 1.0):
        pts = [B(limb_pt(bone, t0 + (t1 - t0) * u, 360 * k / 48, r=rad(360 * k / 48) + thick * 0.8)) for k in range(50)]
        tube(f'{prefix}lip{u}', pts, [lip] * len(pts), segs=8)
    # hinge knuckles at the back (ph 180): three barrels along the bone
    for k, (a, b) in enumerate(((0.0, 0.3), (0.35, 0.65), (0.7, 1.0))):
        pa = B(limb_pt(bone, t0 + (t1 - t0) * a, 180, r=rad(180) + thick + 0.004))
        pb = B(limb_pt(bone, t0 + (t1 - t0) * b, 180, r=rad(180) + thick + 0.004))
        tube(f'{prefix}hinge{k}', [pa, pb], [0.0052, 0.0052], segs=10)
    # lock boss at the front: a squat block with a keyhole pressed in later
    c = B(limb_pt(bone, (t0 + t1) / 2, 0, r=rad(0) + thick + 0.004))
    ball(f'{prefix}lock', c, 0.010, 1.4, 0.9, 1.6)
    for k in range(8):   # rivets round the middle
        ph = 22.5 + 45 * k
        if abs(((ph + 180) % 360) - 180) < 20 or abs(ph - 180) < 20: continue
        ball(f'{prefix}rivet{k}', B(limb_pt(bone, (t0 + t1) / 2, ph, r=rad(ph) + thick + 0.0012)), 0.0026)
    # the eye on the bottom edge, outward, and the chain from it
    h, tl, u, fw, s = limb_frame(bone)
    down = (bv(*(tl - h).normalized()) if chain_dir is None else chain_dir).normalized()
    out = bv(*limb_dir(bone, chain_ph)).normalized()
    eye_c = B(limb_pt(bone, t1, chain_ph, r=rad(chain_ph) + thick + 0.006))
    stadium(f'{prefix}eye', eye_c, down, out, 0.020, 0.013, 0.0034)
    chain(f'{prefix}link', eye_c + down * 0.004, down, out.cross(down), links)


def build_cuff(sd, bone, t0, t1, part, **kw):
    cuff(sd, bone, t0, t1, f'{part}{sd}', **kw)
    o = finish(f'{bone}|{part}', f'{bone}|{part}', 'rustplate', 1100, voxel=0.0013, noise=0.0006, noise_scale=0.012,
               smooth=(0.5, 2), base=IRON, rust=RUST, rust_amt=0.75, seed=3 if sd == 'l' else 7)
    return o


# =============================================================== surface strips
def strip(name, path, width, thick, n=60, closed=False, out=0.004, ragged=None, lift=None):
    """A strap or a strip of cloth laid on the TORSO along `path`, a list of (y, th) control points. `width(s)` may
    vary along it; `ragged(s, w)` jags its edges (u -0.5..0.5 across it). Normals from the torso's own surface."""
    pts = [torso_pt(y, th) for (y, th) in path]
    if closed: pts = pts + [pts[0]]
    # resample by arc length
    L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    def at(s):
        d = s * L[-1]
        for i in range(1, len(L)):
            if d <= L[i] or i == len(L) - 1:
                k = (d - L[i - 1]) / max(1e-9, L[i] - L[i - 1])
                y = path[(i - 1) % len(path)][0] * (1 - k) + path[i % len(path)][0] * k
                a0, a1 = path[(i - 1) % len(path)][1], path[i % len(path)][1]
                if a1 - a0 > 180: a1 -= 360
                if a0 - a1 > 180: a1 += 360
                return y, a0 * (1 - k) + a1 * k
        return path[-1]
    def frame(s):
        y, th = at(s)
        e = 0.5
        p = torso_pt(y, th)
        n_ = (torso_pt(y, th + e) - torso_pt(y, th - e)).cross(torso_pt(min(y + 0.006, 1.475), th) - torso_pt(max(y - 0.006, 0.845), th))
        n_ = n_.normalized()
        if n_.dot(Vector((p.x, 0, p.z - 0.02))) < 0: n_ = -n_
        y2, th2 = at(min(1, s + 0.01)); y1, th1 = at(max(0, s - 0.01))
        tgt = (torso_pt(y2, th2) - torso_pt(y1, th1)).normalized()
        across = tgt.cross(n_).normalized()
        return p, n_, across
    def P(u, v):
        p, n_, across = frame(v)
        w = width(v) if callable(width) else width
        uu = u - 0.5
        if ragged: uu = ragged(v, uu)
        o = out + (lift(v) if lift else 0.0)
        return B(p + n_ * (o + thick) + across * (uu * w))
    def N(u, v):
        p, n_, a = frame(v); return bv(*n_).normalized()
    return surface_solid(name, P, N, 4, n, thick, closed_v=closed)


def _sleeve(name, P, nu, nv, thick):
    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, (v + e) % 1) - P(u, (v - e) % 1)
        return du.cross(dv).normalized()
    cen = sum((P(0.5, k / 8) for k in range(8)), Vector()) / 8
    sgn = 1 if N(0.5, 0).dot(P(0.5, 0) - cen) > 0 else -1
    return surface_solid(name, P, lambda u, v: N(u, v) * sgn, nu, nv, thick, closed_v=True)


def jag(seed, amp, teeth):
    """A torn edge: a few big tears plus small teeth, as a function of angle (deg) -> offset."""
    import random
    r = random.Random(seed)
    big = [(r.uniform(0, 360), r.uniform(0.4, 1.0), r.uniform(18, 40)) for _ in range(3)]
    ph0 = r.uniform(0, 6.28)
    def f(ph):
        v = 0.25 * math.sin(math.radians(ph) * teeth + ph0) + 0.15 * math.sin(math.radians(ph) * teeth * 2.3 + 1.7 * ph0)
        for (c, h, w) in big:
            d = abs(((ph - c + 180) % 360) - 180)
            if d < w: v += h * (1 - d / w)
        return amp * v
    return f


def dirt_up(y0, y1):
    """Grime soaking up from the floor: 1 at blender z y0, 0 at y1."""
    return lambda co: max(0.0, min(1.0, (y1 - co.z) / (y1 - y0))) * 0.6


# =============================================================== the variants
def asylum():
    # Ankle shackles, lower on the shin than the wrist cuffs' share of the forearm: just above the ankle knob.
    for sd in 'lr':
        build_cuff(sd, f'shin.{sd}', 0.78, 0.90, 'shackle', clear=0.005, thick=0.008,
                   chain_dir=Vector((0, 0.55, -0.85)), links=3, chain_ph=90)
    # The straitjacket's remains: a torn canvas YOKE over the shoulders and upper back (the body of the jacket has
    # rotted off), and its leather straps, one round the chest and one round the gut, buckled at the back.
    clear_work()
    yoke_bottom = jag(11, 0.035, 9)
    ys = [(1.47, a) for a in range(-80, 81, 10)]
    # the yoke as rings from the shoulder line down the back, ragged at the bottom
    def yoke(u, v):
        th = 100 + 160 * v                      # round the back, from the left flank to the right
        ybot = 1.25 + yoke_bottom(th)
        y = 1.475 - (1.475 - ybot) * u
        return B(torso_pt(y, th, 0.006 + 0.004 * u))
    _sleeve_open('yokeback', yoke, 10, 40, 0.004)
    # the shoulder pieces over the front: two tongues down onto each pec, torn
    for s in (1, -1):
        def tongue(u, v, s=s):
            th = s * (40 + 50 * v)
            ybot = 1.36 + 0.5 * yoke_bottom(th + 200)
            y = 1.475 - (1.475 - ybot) * u
            return B(torso_pt(y, th, 0.006 + 0.003 * u))
        _sleeve_open(f'tongue{s}', tongue, 8, 16, 0.004)
    finish('spine|yoke', 'spine|yoke', 'cloth', 3000, voxel=0.0028, noise=0.0022, noise_scale=0.03, smooth=(0.6, 3),
           base=(0.62, 0.57, 0.46), rust=(0.30, 0.22, 0.12), rust_amt=0.6, seed=5)
    clear_work()
    for k, y in enumerate((1.27, 1.12)):
        strip(f'strap{k}', [(y + 0.004 * math.cos(math.radians(a)), a) for a in range(0, 360, 12)], 0.034, 0.0045, n=72, closed=True, out=0.004)
        # the buckle at the back, off-centre, and the strap's tail hanging from it
        c = B(torso_pt(y, 205, 0.012)); nrm = bv(*Vector((math.sin(math.radians(205)), 0, math.cos(math.radians(205))))).normalized()
        up = Vector((0, 0, 1)); side = up.cross(nrm).normalized()
        frame = [c + side * a + up * b for a, b in ((-0.022, -0.026), (0.022, -0.026), (0.022, 0.026), (-0.022, 0.026), (-0.022, -0.026))]
        tube(f'buckle{k}', frame, [0.0035] * len(frame), segs=8)
    finish('spine|straps', 'spine|straps', 'leather', 2400, voxel=0.0018, noise=0.0008, smooth=(0.5, 2),
           base=(0.24, 0.14, 0.08), rust=(0.08, 0.05, 0.03), rust_amt=0.5, seed=8)
    # the buckles as iron (separate part so they take the metal look)
    clear_work()
    for k, y in enumerate((1.27, 1.12)):
        c = B(torso_pt(y, 205, 0.012)); nrm = bv(*Vector((math.sin(math.radians(205)), 0, math.cos(math.radians(205))))).normalized()
        up = Vector((0, 0, 1)); side = up.cross(nrm).normalized()
        frame = [c + side * a + up * b + nrm * 0.004 for a, b in ((-0.022, -0.026), (0.022, -0.026), (0.022, 0.026), (-0.022, 0.026), (-0.022, -0.026))]
        tube(f'buckle{k}', frame, [0.0038] * len(frame), segs=8)
        tube(f'tongue{k}', [c + side * -0.022 + nrm * 0.004, c + side * 0.026 + nrm * 0.006], [0.002, 0.002], segs=6)
    finish('spine|buckles', 'spine|buckles', 'rustplate', 800, voxel=0.0012, noise=0.0003, base=IRON, rust=RUST, rust_amt=0.6)
    # torn sleeve stubs on the upper arms with the sleeve strap dangling
    for sd in 'lr':
        clear_work()
        rag = jag(21 if sd == 'l' else 33, 0.07, 7)
        _sleeve(f'sleeve{sd}', lambda u, v, sd=sd, rag=rag: B(limb_pt(f'upperArm.{sd}', -0.06 + (0.38 + rag(360 * v) - -0.06) * u, 360 * v, 0.008 + 0.004 * u)), 10, 40, 0.004)
        finish(f'upperArm.{sd}|sleeve', f'upperArm.{sd}|sleeve', 'cloth', 1500, voxel=0.0026, noise=0.002, noise_scale=0.03,
               smooth=(0.6, 3), base=(0.62, 0.57, 0.46), rust=(0.30, 0.22, 0.12), rust_amt=0.6, seed=9)


def _sleeve_open(name, P, nu, nv, thick):
    def N(u, v):
        e = 1e-3
        du = P(min(1, u + e), v) - P(max(0, u - e), v); dv = P(u, min(1, v + e)) - P(u, max(0, v - e))
        n = du.cross(dv)
        return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
    c = P(0.5, 0.5); axis = Vector((0, -0.02, c.z))
    sgn = 1 if N(0.5, 0.5).dot(Vector((c.x, c.y + 0.02, 0))) > 0 else -1
    return surface_solid(name, P, lambda u, v: N(u, v) * sgn, nu, nv, thick, closed_v=False)


def morgue():
    # The toe tag: a loop of string round the front of the right foot and a manila card hanging off it, outboard.
    clear_work()
    loop = [B(limb_pt('foot.r', 0.88, 360 * k / 24, 0.0025)) for k in range(26)]
    tube('string', loop, [0.0012] * len(loop), segs=5)
    knot = B(limb_pt('foot.r', 0.88, 90, 0.003))
    out = bv(*limb_dir('foot.r', 90)).normalized()
    card_top = knot + out * 0.018 + Vector((0, 0.010, 0.012))
    tube('tie', [knot, knot + out * 0.008 + Vector((0, 0.004, 0.010)), card_top], [0.0012] * 3, segs=5)
    finish('foot.r|string', 'foot.r|string', 'cloth', 600, voxel=0.0008, noise=0, smooth=(0.3, 1), ao=False, base=(0.75, 0.72, 0.62))
    clear_work()
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * 0.0015, v.co.y * 0.060, v.co.z * 0.034))
    # tilt it: hanging from its top corner, swung forward
    R = Matrix.Rotation(math.radians(-18), 4, 'X') @ Matrix.Rotation(math.radians(8), 4, 'Z')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(card_top + out * 0.004 + Vector((0, 0.018, -0.016))) @ R, verts=bm.verts)
    o = mkobj('card', bm)
    plain(o, 'white'); colourise(o, (0.80, 0.66, 0.42))
    install(o, 'foot.r|tag')
    # The sheet: a torn strip draped over the LEFT shoulder (front, over the top, down the back) and a wrap round the
    # hips, grey-white with old stains. Both ride the torso (spine / pelvis) rigidly.
    clear_work()
    rag = lambda s, u: u * (1.0 + 0.35 * math.sin(s * 37) + 0.2 * math.sin(s * 91 + 1))
    strip('drape', [(1.10, 18), (1.22, 26), (1.34, 36), (1.44, 52), (1.472, 75), (1.45, 105), (1.38, 128), (1.26, 148), (1.12, 158), (1.02, 162)],
          lambda s: 0.11 + 0.05 * math.sin(s * 3.1), 0.004, n=90, out=0.007, ragged=rag, lift=lambda s: 0.006 * math.sin(s * 17))
    finish('spine|sheet', 'spine|sheet', 'cloth', 3200, voxel=0.0026, noise=0.0026, noise_scale=0.03, smooth=(0.6, 3),
           base=(0.70, 0.70, 0.66), rust=(0.42, 0.30, 0.16), rust_amt=0.55, seed=12)
    clear_work()
    hem = jag(41, 0.05, 11)
    def wrap(u, v):
        th = 360 * v
        y0 = 1.03 + 0.012 * math.sin(math.radians(th) * 2)
        y1 = 0.90 + hem(th)
        y = y0 + (y1 - y0) * u
        return B(torso_pt(y, th, 0.006 + 0.010 * u))
    _sleeve('wrap', wrap, 10, 60, 0.004)
    finish('pelvis|sheet', 'pelvis|sheet', 'cloth', 3200, voxel=0.0028, noise=0.003, noise_scale=0.03, smooth=(0.6, 3),
           base=(0.70, 0.70, 0.66), rust=(0.45, 0.10, 0.08), rust_amt=0.35, seed=14)


def labourer():
    # Dark: (0.17, 0.19, 0.24) washed out to pale grey under the arena's lights.
    DENIM = (0.075, 0.085, 0.12); GRIME = (0.10, 0.075, 0.045)
    # Trousers: the seat and waistband on the pelvis, a leg on each thigh, the torn shin piece on each shin. Rigid
    # pieces on separate bones overlap generously at the joints so a bend does not open a gap.
    #
    # THE CLOTH'S RELIEF IS GEOMETRY (owner, 2026-10-26: "his pants are a bit flat looking"). The body normal map
    # cannot reach kit, and these voxel-remeshed parts have no UVs for a normal texture, so the folds are sculpted in
    # (`deform`) and then darkened into the vertex colours (`crease`): compression folds behind the knee, drag folds
    # from the crotch, bunching above the torn hem, raised flat-felled seams, the fly, back pockets and a knee patch.
    # Amplitudes 3-7 mm on a 2 mm voxel (the first pass at 2-5 mm still read as smooth tubes); the parts' triangle budgets rose with them (~1.5x) to keep the folds.
    from mathutils import noise as mnoise

    def drape(p, amp=0.0040, scale=9.0, seed=0.0):
        """Low, broad bagginess: cloth hangs in soft lumps, not a sprayed-on skin."""
        return amp * mnoise.noise(p * scale + Vector((seed, 2 * seed, 3 * seed)))

    def seam(arc, w=0.0035, h=0.0014):
        """A flat-felled seam: a raised band with a stitch groove down each side."""
        return h * gauss(arc, w) - 0.0009 * (gauss(arc - w * 1.3, 0.0012) + gauss(arc + w * 1.3, 0.0012))

    def leg_folds(bone, sd, patch):
        L = (Vector(LIMB[bone]['tail']) - Vector(LIMB[bone]['head'])).length
        def fn(p):
            t, ph, r = limb_coords(bone, p)
            arc = lambda a: math.radians(angd(ph, a)) * r          # metres round the leg from angle a
            d = drape(p, seed=3.1 if sd == 'l' else 7.7)
            # compression folds behind the knee: stacked, wobbling, strongest at the back
            back = max(0.0, math.cos(math.radians(angd(ph, 180)) * 0.9))
            for k in range(4):
                tk = 0.78 + 0.055 * k + 0.012 * math.sin(math.radians(ph) * 3 + k * 1.7)
                d += back * (0.0070 if k % 2 == 0 else -0.0040) * gauss((t - tk) * L, 0.009)
            # a few soft stretch wrinkles across the front of the knee
            front = max(0.0, math.cos(math.radians(angd(ph, 0))))
            for k in range(2):
                d += front * 0.0040 * gauss((t - (0.90 + 0.05 * k)) * L, 0.007)
            # the long folds a trouser leg HANGS in from the hip: a few wandering vertical ridges, fading out at the knee
            # (the first pass, without them, read as smooth tubes from across the room)
            hang = smoothstep(0.02, 0.15, t) * smoothstep(0.80, 0.62, t)
            d += hang * 0.0042 * math.sin(math.radians(ph) * 4 + 2.4 * mnoise.noise(Vector((t * 2.5, 0.3, 1.7 if sd == 'l' else 4.1))))
            # drag folds from the crotch, raking down the inside and front of the thigh
            if t < 0.45:
                inner = max(0.0, math.cos(math.radians(angd(ph, -55)) * 0.8))
                for k in range(3):
                    line = t * L - (0.02 + 0.05 * k) - 0.55 * arc(-90)
                    d += inner * (1 - t / 0.45) * 0.0060 * gauss(line, 0.0075)
            # seams down the outside and the inside of the leg
            d += seam(arc(90)) + seam(arc(-90))
            # a knee patch on one leg: a raised panel with a stitched edge
            if patch:
                a = angd(ph, 5); m = smoothstep(-34, -28, a) * smoothstep(34, 28, a) * smoothstep(0.76, 0.79, t) * smoothstep(1.01, 0.98, t)
                edge = gauss(abs(a) - 30, 2.2) * smoothstep(0.74, 0.79, t) * smoothstep(1.03, 0.98, t) + \
                    gauss((t - 0.785) * L, 0.0018) * smoothstep(-36, -28, a) * smoothstep(36, 28, a)
                d += 0.0026 * m - 0.0012 * edge
            return d
        return fn

    def shin_folds(bone, sd):
        L = (Vector(LIMB[bone]['tail']) - Vector(LIMB[bone]['head'])).length
        def fn(p):
            t, ph, r = limb_coords(bone, p)
            d = drape(p, 0.0025, seed=5.3 if sd == 'l' else 9.1)
            # the cloth bunches where the knee bends it, all the way round
            for k in range(4):
                tk = 0.02 + 0.07 * k + 0.02 * math.sin(math.radians(ph) * 2 + k)
                d += (0.0065 if k % 2 == 0 else -0.0035) * gauss((t - tk) * L, 0.009)
            arc = lambda a: math.radians(angd(ph, a)) * r
            return d + seam(arc(90)) + seam(arc(-90))
        return fn

    def seat_folds(p):
        th = math.degrees(math.atan2(p.x, p.z - 0.02)); y = p.y
        r = math.hypot(p.x, p.z - 0.02); arc = lambda a: math.radians(angd(th, a)) * r
        d = drape(p, 0.0030, seed=1.3)
        # gathered under the cinched waistband: short vertical ripples
        d += 0.0022 * math.sin(math.radians(th) * 38) * gauss(y - 1.018, 0.012)
        # the fly: a raised placket down the front, off-centre, its stitch line curving in at the bottom
        d += 0.0020 * gauss(arc(3), 0.009) * smoothstep(0.90, 0.93, y) * smoothstep(1.04, 1.02, y)
        d -= 0.0010 * gauss(arc(3) - 0.012 + 0.10 * max(0.0, 0.94 - y), 0.0013) * smoothstep(0.915, 0.93, y) * smoothstep(1.035, 1.02, y)
        # crotch smile folds low on the front
        for sgn in (1, -1):
            for k in range(2):
                line = (y - (0.895 + 0.022 * k)) - 0.35 * abs(arc(0))
                d += 0.0032 * gauss(line, 0.0055) * smoothstep(0.004, 0.02, abs(arc(0))) * smoothstep(0.12, 0.06, abs(arc(0))) * (1 if sgn * angd(th, 0) > 0 else 0)
        # back pockets: raised panels with stitched edges
        for c in (155, -155):
            a = arc(c); m = smoothstep(-0.055, -0.048, a) * smoothstep(0.055, 0.048, a) * smoothstep(0.925, 0.935, y) * smoothstep(1.005, 0.995, y)
            edge = (gauss(abs(a) - 0.050, 0.0016) * smoothstep(0.92, 0.935, y) * smoothstep(1.01, 0.995, y)
                    + gauss(y - 0.928 - 0.25 * abs(a), 0.0016) * smoothstep(0.058, 0.048, abs(a)))
            d += 0.0018 * m - 0.0011 * edge
        # side seams
        return d + seam(arc(90)) + seam(arc(-90))

    clear_work()
    def seat(u, v):
        th = 360 * v
        y = 1.045 - (1.045 - 0.85) * u   # to 0.85: at 0.87 a sliver of crotch showed between the seat and the thighs
        # 11 mm + up to 4 mm off the POSED envelope (surface.json): the fold valleys pull the cloth in by up to 4 mm, and
        # the first trousers, 6 mm off the rest skin, had flesh coming through at the crotch whenever he walked.
        return B(torso_pt(y, th, 0.011 + 0.004 * u))
    _sleeve('seat', seat, 12, 60, 0.004)
    band_ = [B(torso_pt(1.045, 6 * k, 0.012)) for k in range(62)]
    tube('waistband', band_, [0.008] * len(band_), segs=8)
    for k, th in enumerate((24, 70, 120, 160, -160, -120, -70, -24)):   # belt loops
        tube(f'loop{k}', [B(torso_pt(1.058, th, 0.019)), B(torso_pt(1.045, th, 0.021)), B(torso_pt(1.030, th, 0.019))], [0.0028] * 3, segs=6)
    finish('pelvis|trousers', 'pelvis|trousers', 'cloth', 1900, voxel=0.0020, noise=0.0010, noise_scale=0.03,
           smooth=(0.5, 2), base=DENIM, rust=GRIME, rust_amt=0.5, seed=21, folds=seat_folds, cavity=12.0, ao_dist=0.05, nmap=True)
    for sd in 'lr':
        clear_work()
        _sleeve(f'thigh{sd}', lambda u, v, sd=sd: B(limb_pt(f'thigh.{sd}', -0.06 + 1.12 * u, 360 * v, 0.012 + 0.006 * math.sin(math.pi * u))), 14, 40, 0.004)
        finish(f'thigh.{sd}|trousers', f'thigh.{sd}|trousers', 'cloth', 1600, voxel=0.0020, noise=0.0010, noise_scale=0.03,
               smooth=(0.5, 2), base=DENIM, rust=GRIME, rust_amt=0.5, seed=22 if sd == 'l' else 23,
               folds=leg_folds(f'thigh.{sd}', sd, patch=(sd == 'l')), cavity=12.0, ao_dist=0.05, nmap=True)
        clear_work()
        rag = jag(51 if sd == 'l' else 57, 0.09, 8)
        _sleeve(f'shin{sd}', lambda u, v, sd=sd, rag=rag: B(limb_pt(f'shin.{sd}', -0.08 + (0.40 + rag(360 * v) + 0.08) * u, 360 * v, 0.015 + 0.004 * u)), 10, 40, 0.004)
        finish(f'shin.{sd}|trousers', f'shin.{sd}|trousers', 'cloth', 1100, voxel=0.0020, noise=0.0010, noise_scale=0.03,
               smooth=(0.5, 2), base=DENIM, rust=GRIME, rust_amt=0.7, seed=24 if sd == 'l' else 25, dirt=dirt_up(0.35, 0.55),
               folds=shin_folds(f'shin.{sd}', sd), cavity=12.0, ao_dist=0.05, nmap=True)
        # Work boots: a shaft round the ankle on the shin, the boot body round the foot. Rounded toe cap, a heel, a
        # flat sole on the floor, laces up the front.
        clear_work()
        _sleeve(f'shaft{sd}', lambda u, v, sd=sd: B(limb_pt(f'shin.{sd}', 0.70 + 0.34 * u, 360 * v, 0.008 + 0.004 * u)), 8, 32, 0.005)
        top = [B(limb_pt(f'shin.{sd}', 0.70, 360 * k / 32, 0.016)) for k in range(34)]
        tube(f'cuff{sd}', top, [0.006] * len(top), segs=8)
        finish(f'shin.{sd}|boot', f'shin.{sd}|boot', 'boot', 700, voxel=0.0022, noise=0.0012, smooth=(0.5, 3),
               base=(0.16, 0.10, 0.06), rust=(0.09, 0.06, 0.04), rust_amt=0.6, seed=26)
        clear_work()
        fh, ft = Vector(LIMB[f'foot.{sd}']['head']), Vector(LIMB[f'foot.{sd}']['tail'])
        heel = fh + Vector((0, -0.036, -0.016)); toe = ft + Vector((0, -0.040, 0.030))
        ball(f'heel{sd}', B(heel), 0.066, 1.08, 1.0, 0.95)
        tube(f'vamp{sd}', [B(heel.lerp(toe, k / 8) + Vector((0, 0.010 * math.sin(math.pi * k / 8), 0))) for k in range(9)],
             [0.064 - 0.004 * k / 8 for k in range(9)], segs=16)
        ball(f'toecap{sd}', B(toe), 0.060, 1.18, 1.0, 0.92)
        o = fuse(f'foot.{sd}|boot', voxel=0.0024, smooth=(0.6, 3), noise=0.0012, noise_scale=0.03)
        for v in o.data.vertices:          # a flat sole on the floor (blender z = blob y)
            if v.co.z < 0.002: v.co.z = 0.002
        decimate(o, 900); bake_ao(o, material='boot', ao_dist=0.03)
        colourise(o, (0.16, 0.10, 0.06), (0.09, 0.06, 0.04), 0.6, 27, dirt=lambda co: 1.0 if co.z < 0.022 else 0.0)
        install(o, f'foot.{sd}|boot')
    # Suspenders: two leather straps from the waistband's front over each shoulder, crossing in an X on the back.
    clear_work()
    for s in (1, -1):
        strip(f'brace{s}', [(1.05, s * 18), (1.16, s * 21), (1.28, s * 25), (1.38, s * 32), (1.45, s * 48), (1.472, s * 80),
                            (1.44, s * 120), (1.34, s * 155), (1.24, s * 185 if s > 0 else -175), (1.12, s * 200 if s > 0 else -160), (1.05, s * 206 if s > 0 else -154)],
              0.030, 0.0035, n=80, out=0.004)
    finish('spine|suspenders', 'spine|suspenders', 'leather', 900, voxel=0.0016, noise=0.0006, smooth=(0.5, 2),
           base=(0.30, 0.16, 0.08), rust=(0.10, 0.06, 0.03), rust_amt=0.5, seed=28)
    clear_work()
    for s in (1, -1):
        for (y, th) in ((1.07, s * 18), (1.07, 206 if s > 0 else 154)):
            c = B(torso_pt(y, th, 0.012))
            ball(f'clip{s}{th}', c, 0.010, 1.0, 1.0, 1.3)
    finish('spine|clips', 'spine|clips', 'rustplate', 300, voxel=0.0012, noise=0.0003, base=IRON, rust=RUST, rust_amt=0.4)


# ======================================================================== build
hands = [build_hand(-1, 'foreArm.l'), build_hand(+1, 'foreArm.r')]
# Wrist shackles: from where the forearm starts to taper into the wrist knob, down over the top of the palm, so the
# seam between the thick wrist and the hand is inside the iron (owner, 2026-10-26).
for sd in 'lr':
    build_cuff(sd, f'foreArm.{sd}', 0.86, 1.04, 'shackle')
{'asylum': asylum, 'morgue': morgue, 'labourer': labourer, 'none': lambda: None}[VARIANT]()
for o in list(mech.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
# The trousers' relief as a normal map (1024: ~0.8 mm a texel over the trousers' ~0.6 m2), baked from the sculpts.
bake_normal_atlas('cloth', 1024, os.path.join(HERE, 'zombie-cloth-n.png'))

parts = [o for o in mech.objects if o.type == 'MESH']
print('[zombie-kit]', VARIANT, {o.name: len(o.data.polygons) for o in parts}, 'total', sum(len(o.data.polygons) for o in parts))
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.hide_set(False); o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True, export_extras=False,
                          use_selection=True, export_vertex_color='ACTIVE', export_attributes=True,
                          export_tangents=True, export_image_format='AUTO')
print('[zombie-kit] ->', OUT_GLB)
