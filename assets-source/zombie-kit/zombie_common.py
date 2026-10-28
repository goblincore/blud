# assets-source/zombie-kit/zombie_common.py
#
# Shared by the zombie kit's make scripts. exec() after ../twinhead-kit/kit_sculpt.py (bv, tube, ring, ball, fuse, ...).
# Skin comes from surface.json (scripts/zombie-surface.ts): every strap, cuff and trouser leg is laid on the PROBED
# skin a set clearance out, not round a bone (biomech-style.md). All helpers here take and return BLOB coordinates
# (metres, Y up, +Z forward); convert with B() when building geometry.
import bpy, bmesh, json, math, os, random
from mathutils import Vector, Matrix

# The body the kit is laid on: the zombie's surface.json, or a variant's own probe (make_kit.py --body zombie-fat).
SURF = json.load(open(os.path.join(KIT_DIR, globals().get('SURFACE_FILE', 'surface.json'))))
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


def to_blob(co):
    """Blender coords back to the .blob's (bv's inverse)."""
    return Vector((co.x, co.z, -co.y))


def limb_coords(bone, p):
    """A blob point's place round `bone`: (t along it, ph in degrees in limb_frame's convention, radius)."""
    h, tl, u, fw, s = limb_frame(bone)
    L = (tl - h).length; d = p - h; t = d.dot(u) / L
    r = d - u * d.dot(u)
    return t, math.degrees(math.atan2(r.dot(s), r.dot(fw))), r.length


def angd(a, b):
    """Signed shortest angle a - b in degrees."""
    return (a - b + 180.0) % 360.0 - 180.0


def gauss(x, w):
    return math.exp(-(x / w) ** 2)


def smoothstep(e0, e1, x):
    k = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return k * k * (3 - 2 * k)


def deform(o, fn, smooth_after=1):
    """Cloth relief sculpted into a fused part: each vertex moves `fn(blob point)` metres along its normal (folds,
    seams, patches). A light smooth afterwards keeps the folds soft, like cloth, not carved."""
    me = o.data
    me.update()
    # Read every position and normal BEFORE writing any: setting v.co dirties the normals, and the next v.normal read
    # recomputes all of them, which made this loop quadratic (40 min on the 138k-vertex seat).
    moved = [v.co + v.normal * fn(to_blob(v.co)) for v in me.vertices]
    for v, c in zip(me.vertices, moved): v.co = c
    me.update()
    if smooth_after:
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('fs', 'SMOOTH'); m.factor = 0.5; m.iterations = smooth_after
        bpy.ops.object.modifier_apply(modifier='fs')


def crease(o, k=6.0, lift=0.25):
    """Darken the creases and lift the crests in the vertex colours (a cavity map), so the folds read even under
    the flat, bright light of the arena, where the AO alone washed out."""
    me = o.data; ca = me.color_attributes.active_color
    n = len(me.vertices); acc = [Vector() for _ in range(n)]; cnt = [0] * n; el = [0.0] * n
    for e in me.edges:
        a, b = e.vertices; va, vb = me.vertices[a].co, me.vertices[b].co
        acc[a] += vb; acc[b] += va; cnt[a] += 1; cnt[b] += 1
        l = (va - vb).length; el[a] += l; el[b] += l
    c = []
    for i, v in enumerate(me.vertices):
        if not cnt[i]: c.append(0.0); continue
        m = acc[i] / cnt[i]
        c.append((m - v.co).dot(v.normal) / max(1e-6, el[i] / cnt[i]))   # > 0 in a crease
    nbr = [[] for _ in range(n)]
    for e in me.edges:
        a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
    for _ in range(2):
        c = [(c[i] * 2 + sum(c[j] for j in nbr[i])) / (2 + len(nbr[i])) for i in range(n)]
    for i in range(n):
        f = 1.0 - min(0.6, k * max(0.0, c[i])) + min(lift, k * 0.5 * max(0.0, -c[i]))
        col = ca.data[i].color
        ca.data[i].color = (col[0] * f, col[1] * f, col[2] * f, 1.0)


def finish(name, kit, material, tris, voxel=0.0018, noise=0.0008, noise_scale=0.02, smooth=(0.5, 3), ao=True,
           base=(0.8, 0.8, 0.8), rust=None, rust_amt=0.0, seed=1, dirt=None, folds=None, cavity=0.0, ao_dist=0.03, nmap=False):
    import time; t0 = time.time()
    o = fuse(name, voxel=voxel, smooth=smooth, noise=noise, noise_scale=noise_scale)
    print(f'[finish] {name} fused {len(o.data.vertices)} verts {time.time() - t0:.1f}s', flush=True)
    if folds: deform(o, folds); print(f'[finish] {name} folds {time.time() - t0:.1f}s', flush=True)
    hi = None
    if nmap:   # keep the full-detail sculpt: its relief is baked into the decimated part's normal map (bake_normal_atlas)
        hi = o.copy(); hi.data = o.data.copy(); hi.name = f'{name}.hi'; work_coll().objects.link(hi)
    decimate(o, tris)
    print(f'[finish] {name} decimated {len(o.data.polygons)} {time.time() - t0:.1f}s', flush=True)
    if ao: bake_ao(o, material=material, ao_dist=ao_dist)
    else: plain(o, material)
    colourise(o, base, rust, rust_amt, seed, dirt=dirt)
    if cavity: crease(o, cavity)
    print(f'[finish] {name} done {time.time() - t0:.1f}s', flush=True)
    o = install(o, kit)
    if hi:
        for c in list(hi.users_collection): c.objects.unlink(hi)
        hi_coll().objects.link(hi)
        NMAP_PARTS.append((o, hi))
    return o


NMAP_PARTS = []   # (decimated part in `mech`, its full-detail sculpt) for bake_normal_atlas


def hi_coll():
    c = bpy.data.collections.get('nmap_hi') or bpy.data.collections.new('nmap_hi')
    if c.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(c)
    return c


def drop_inner_wall(o, bone=None):
    """Delete the cloth shell's INNER wall: faces facing in toward the part's own axis (its bone; the torso's vertical
    axis for the seat). The kit draws double-sided, so a single outer skin reads the same, the atlas holds only what is
    seen (twice the texels), and the bake has no inner wall to fire through (the closed shell baked ~10% flipped)."""
    bone = bone or o.name.split('|')[0]
    if bone in LIMB:
        h, tl, u, fw, s_ = limb_frame(bone)
        axis = lambda p: h + u * (p - h).dot(u)
    else:
        axis = lambda p: Vector((0.0, p.y, 0.02))
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    gone = []
    for f in bm.faces:
        c = to_blob(f.calc_center_median()); n = to_blob(f.normal)
        if n.dot(c - axis(c)) < 0: gone.append(f)
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(o.data); bm.free(); o.data.update()


def bake_normal_atlas(material, size, png_path):
    """NORMAL MAPS FOR KIT (owner, 2026-10-26: the cloth relief "doesn't really read"). Every decimated part wearing
    `material` is unwrapped into ONE shared atlas (blender-kit.ts merges a material's parts into one primitive, so they
    share one texture), then each part's full-detail sculpt is baked into it as a tangent-space normal map
    (selected-to-active, Cycles). The material gets an Image Texture -> Normal Map node, so the glTF exporter writes
    normalTexture, TEXCOORD_0 and (export_tangents) TANGENT. The sculpts are deleted afterwards."""
    parts = [(lo, hi) for lo, hi in NMAP_PARTS if lo.data.materials and lo.data.materials[0].name == material]
    if not parts: return
    los = [lo for lo, _ in parts]
    for lo, hi in parts: drop_inner_wall(lo); drop_inner_wall(hi, lo.name.split('|')[0])
    bpy.ops.object.select_all(action='DESELECT')
    for lo in los: lo.hide_set(False); lo.select_set(True)
    bpy.context.view_layer.objects.active = los[0]
    bpy.ops.object.mode_set(mode='EDIT')       # multi-object edit: every part's islands packed into one 0..1 space
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.get(f'nm_{material}') or bpy.data.images.new(f'nm_{material}', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0.5, 0.5, 1.0, 1.0)
    m = bpy.data.materials[material]; nt = m.node_tree
    tex = nt.nodes.get('nmap_tex') or nt.nodes.new('ShaderNodeTexImage'); tex.name = 'nmap_tex'; tex.image = img
    nmn = nt.nodes.get('nmap') or nt.nodes.new('ShaderNodeNormalMap'); nmn.name = 'nmap'
    bsdf = nt.nodes['Principled BSDF']
    nt.links.new(tex.outputs['Color'], nmn.inputs['Color']); nt.links.new(nmn.outputs['Normal'], bsdf.inputs['Normal'])
    nt.nodes.active = tex                      # the bake writes into the material's ACTIVE image node
    sc = bpy.context.scene; prev = sc.render.engine
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
    sc.render.bake.use_selected_to_active = True
    # Both the part and its sculpt are outer skins only (drop_inner_wall), so a generous cage is safe: the fold crests
    # stand up to 7 mm off the decimated part, and with the sculpt's inner wall still there, rays starting inside a
    # crest hit it from behind and baked flipped normals (~10% of the atlas, yellow).
    sc.render.bake.cage_extrusion = 0.010; sc.render.bake.max_ray_distance = 0.025
    sc.render.bake.margin = 6; sc.render.bake.normal_space = 'TANGENT'
    for k, (lo, hi) in enumerate(parts):
        hi.hide_set(False)
        bpy.ops.object.select_all(action='DESELECT')
        hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
        sc.render.bake.use_clear = k == 0
        bpy.ops.object.bake(type='NORMAL')
        hi.hide_set(True)
    sc.render.engine = prev
    img.filepath_raw = png_path; img.file_format = 'PNG'; img.save()
    for _, hi in parts: bpy.data.objects.remove(hi, do_unlink=True)
    print(f'[nmap] {material}: {len(parts)} parts -> {png_path}', flush=True)


def mat(name, base=(1, 1, 1), rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m
