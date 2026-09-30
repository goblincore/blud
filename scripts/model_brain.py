# scripts/model_brain.py — the whole brain the flail knocks out of a zombie's skull at the
# brain stage (melee head damage, plan Task 11; spec
# docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §14 decision 3).
#
# Two cerebral hemispheres with a longitudinal fissure between them, a lateral
# (Sylvian) fissure over each temporal lobe, gyri and sulci made by REAL
# displacement, a cerebellum with fine transverse folia and a short brain stem.
#
# HOW THE FOLDS ARE MADE (a high mesh, baked onto a low one):
#   1. Each lobe starts as a shaped ellipsoid (flat medial wall against the
#      fissure, flat base, a temporal lobe dropping below it), voxel-remeshed to
#      a uniform 1 mm quad grid.
#   2. CEREBRUM: a Gray-Scott reaction-diffusion (the labyrinth regime,
#      F 0.037 / k 0.060, 8000 steps) runs on that grid's vertex graph (numpy),
#      seeded with noise blobs. Its labyrinth stripes have a near-constant
#      width everywhere, which is what gyri look like (plain noise stripes swell
#      into blobs and rings). The v-rich stripes become the sulci: narrowed by a
#      threshold, smoothed, and pushed in along the normal FOLD_DEPTH. The
#      Sylvian fissure is an extra groove.
#      CEREBELLUM: grooves of constant angle around a left-right axis through
#      its front (folia: stacked left-right from behind, fanning from the side).
#   3. The high mesh (~145k tris) is decimated to the low one (<= 8k tris), so
#      the silhouette keeps the big folds; Cycles bakes the high mesh's normals
#      (tangent space) and its albedo (base x fold cavity: crowns pink-grey,
#      sulci darker and redder) onto the low mesh's smart-project UVs.
#
# Exports public/assets/lab/brain.glb with ONE mesh node `Brain` (origin at the
# bbox centre, ~0.14 m long, <= 8k tris, 1024^2 baseColor + normal textures as
# WebP — EXT_texture_webp, which three's GLTFLoader reads — ~0.8 MB; PNG was 2.8).
# Renders previews to $PREVIEW_DIR (default docs/dev-notes/2026-09-28-head-damage)
# and re-imports the GLB to assert the node contract and the budget.
#
# Helpers, the EEVEE three-point preview rig and the export + re-import
# verification follow scripts/model_flail.py.
#
# Run:  blender -b --factory-startup -P scripts/model_brain.py
# Metres. Blender space: Z up, +Y the frontal pole (glTF export turns Z up into +Y up).
import bpy, bmesh, math, os, tempfile, time
import numpy as np
from mathutils import Vector, noise

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "brain.glb")
PREVIEW_DIR = os.environ.get("PREVIEW_DIR", os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-28-head-damage"))
os.makedirs(PREVIEW_DIR, exist_ok=True)

MAX_TRIS = 8000
TRIS_HEMI = 3000          # decimate targets per part
TRIS_CEREB = 1100
TEX = 1024                # baked texture size
VOXEL = 0.001             # the high mesh's remesh grid (m)
# Cerebrum half-extents per hemisphere (m): the brain is ~0.14 long, ~0.11 wide.
HEMI_A = (0.042, 0.069, 0.041)
# The hemisphere's shape centre, |x|: its flat medial wall (0.22 of the half-width) sits 1.5 mm off the
# midline, so the longitudinal fissure is a thin dark slot.
HEMI_C = 0.0015 + 0.22 * HEMI_A[0]
FOLD_DEPTH = 0.0055       # sulcus depth
# Gray-Scott on the neighbour-mean Laplacian: sinuous labyrinths ~10 grid steps apart.
GS = dict(Du=0.64, Dv=0.32, F=0.037, k=0.060, iters=8000)
CEREB_C = (0.0, -0.036, -0.023)
CEREB_A = (0.044, 0.025, 0.019)
BASE = (0.58, 0.30, 0.31)          # linear albedo of the crowns (~#c9959a)
SULCUS = (0.26, 0.075, 0.085)      # the fold bottoms: darker, redder

noise.seed_set(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
T0 = time.time()


def log(msg):
    print(f"[brain] {time.time() - T0:6.1f}s {msg}", flush=True)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_mod(o, mod):
    select_only(o)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def shaped(name, fn, subdiv=6):
    """An icosphere whose unit directions `fn` maps to positions, voxel-remeshed to VOXEL."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        v.co = fn(v.co.copy())
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    rm = o.modifiers.new("rm", 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = VOXEL
    apply_mod(o, rm)
    return o


def arrays(o):
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
    nor = np.empty(n * 3); me.vertices.foreach_get("normal", nor); nor = nor.reshape(n, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get("vertices", e); e = e.reshape(-1, 2)
    i = np.concatenate([e[:, 0], e[:, 1]]); j = np.concatenate([e[:, 1], e[:, 0]])
    deg = np.bincount(i, minlength=n).astype(np.float64)
    return co, nor, i, j, deg


def neighbour_mean(x, i, j, deg):
    return np.bincount(i, weights=x[j], minlength=len(deg)) / deg


def gray_scott(co, i, j, deg, seed):
    # Seeded with blobs where a 3D noise is high (single-vertex seeds diffuse away before they react).
    n = len(co)
    off = Vector((seed * 1.7, seed * 0.3, seed * 2.9))
    seedf = np.array([noise.noise(Vector(p) * 260.0 + off) for p in co])
    u = np.ones(n); v = np.zeros(n)
    spots = seedf > 0.35
    u[spots] = 0.5; v[spots] = 0.25
    Du, Dv, F, k = GS["Du"], GS["Dv"], GS["F"], GS["k"]
    for _ in range(GS["iters"]):
        lu = neighbour_mean(u, i, j, deg) - u
        lv = neighbour_mean(v, i, j, deg) - v
        uvv = u * v * v
        u += Du * lu - uvv + F * (1.0 - u)
        v += Dv * lv + uvv - (F + k) * v
    return v


def finish(o, co, nor, disp, cav):
    """Displace along the normal by -disp; store the albedo as a point colour."""
    me = o.data
    p = co - nor * disp[:, None]
    me.vertices.foreach_set("co", p.ravel())
    col = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    t = cav ** 1.3
    rgb = np.array(SULCUS)[None, :] + (np.array(BASE) - np.array(SULCUS))[None, :] * t[:, None]
    rgba = np.concatenate([rgb, np.ones((len(t), 1))], axis=1)
    col.data.foreach_set("color", rgba.ravel())
    me.update()


def hemisphere(side):
    """side +1 = right (x > 0), -1 = left."""
    ax, ay, az = HEMI_A

    def fn(d):
        dx, dy, dz = d.x * side, d.y, d.z          # dx > 0 = lateral
        x = ax * dx * (0.22 + 0.78 * sstep(-0.35, 0.3, dx))   # the medial wall, flat against the fissure
        x *= 1.0 + 0.10 * dy                        # frontal pole broad, occipital narrower
        y = ay * dy
        z = az * dz
        if dz < 0:                                  # flat base; the temporal lobe drops below it
            temporal = sstep(0.05, 0.6, dx) * math.exp(-((dy - 0.12) / 0.38) ** 2)
            z *= 0.62 + 0.55 * temporal
        else:                                       # the dome, highest a little behind the middle
            z *= 1.0 + 0.08 * math.exp(-((dy + 0.15) / 0.5) ** 2)
        return Vector((side * (x + HEMI_C), y, z))   # x is lateral-positive here: mirror it back

    o = shaped("hemi_R" if side > 0 else "hemi_L", fn)
    co, nor, i, j, deg = arrays(o)
    log(f"{o.name}: {len(co)} verts, reaction-diffusion {GS['iters']} steps")
    v = gray_scott(co, i, j, deg, seed=11 if side > 0 else 29)
    log(f"{o.name}: v range {v.min():.3f}..{v.max():.3f}, share > 0.1: {(v > 0.1).mean():.2f}")
    vn = (v - v.min()) / max(1e-9, v.max() - v.min())
    # The v-rich stripes are the sulci, narrowed by the threshold; smoothed so the crowns round off.
    s = smoothstep(0.58, 0.9, vn)
    for _ in range(3):
        s = 0.5 * s + 0.5 * neighbour_mean(s, i, j, deg)
    # Normalised position for the big landmarks.
    lx = (co[:, 0] - side * HEMI_C) * side / ax
    ly = co[:, 1] / ay
    lz = co[:, 2] / az
    medial = smoothstep(0.2, -0.3, lx)              # 1 on the medial wall
    depth = FOLD_DEPTH * (1.0 - 0.45 * medial)
    # The lateral (Sylvian) fissure: front-low to back-high over the temporal lobe.
    a2 = np.array([0.62, -0.30]); b2 = np.array([-0.20, 0.20])
    pd = np.stack([ly, lz], axis=1)
    ab = b2 - a2
    t = np.clip(((pd - a2) @ ab) / (ab @ ab), 0.0, 1.0)
    dist = np.linalg.norm(pd - (a2[None, :] + t[:, None] * ab[None, :]), axis=1)
    sylvian = np.exp(-(dist / 0.06) ** 2) * smoothstep(0.35, 0.75, lx) * (1.0 - 0.5 * t)
    sul = np.maximum(s, sylvian)
    disp = depth * sul + 0.005 * sylvian
    cav = (1.0 - sul) * (1.0 - 0.55 * medial)
    finish(o, co, nor, disp, cav)
    return o


def cerebellum():
    ax, ay, az = CEREB_A
    cx, cy, cz = CEREB_C

    def fn(d):
        x, y, z = ax * d.x, ay * d.y, az * d.z
        if d.z > 0:
            z *= 0.7                                # flat under the occipital lobes (the tentorium)
        notch = math.exp(-(d.x / 0.18) ** 2) * sstep(0.0, -0.8, d.y)
        y += ay * 0.25 * notch                      # the vermis notch at the back
        return Vector((x + cx, y + cy, z + cz))

    o = shaped("cerebellum", fn, subdiv=5)
    co, nor, i, j, deg = arrays(o)
    lx = (co[:, 0] - cx) / ax
    ly = (co[:, 1] - cy)
    lz = (co[:, 2] - cz)
    # Folia: grooves of constant angle around a left-right axis through the hilum at the FRONT (the
    # peduncles), so they run left-right, stack top to bottom from behind and fan out from the front
    # seen from the side.
    th = np.arctan2(lz, -(ly - ay * 0.9))
    wob = np.array([noise.noise(Vector(p) * 60.0) for p in co])
    s = np.sin(th * 34.0 + 0.5 * wob)
    fol = smoothstep(0.2, 0.95, s)                  # thin grooves between broad folia
    for _ in range(2):
        fol = 0.5 * fol + 0.5 * neighbour_mean(fol, i, j, deg)
    notch = np.exp(-(lx / 0.2) ** 2) * smoothstep(0.0, -0.02, ly)
    disp = 0.0022 * fol + 0.003 * notch
    cav = (1.0 - 0.8 * fol) * (1.0 - 0.5 * notch)
    finish(o, co, nor, disp, cav)
    return o


def stem():
    """A short tapered brain stem with the pons bulge, down and back from the underside."""
    top = Vector((0.0, -0.010, -0.018)); bot = Vector((0.0, -0.030, -0.078))
    prof = [(0.0, 0.0), (0.010, 0.0), (0.0135, 0.18), (0.0145, 0.32), (0.0115, 0.48), (0.0095, 0.7), (0.0085, 0.96), (0.0, 1.0)]
    segs = 14
    bm = bmesh.new()
    axis = bot - top
    side_v = Vector((1, 0, 0))
    fwd = axis.normalized().cross(side_v).normalized()
    col = bm.verts.layers.float_color.new("Col")
    stem_col = tuple(SULCUS[c] + (BASE[c] - SULCUS[c]) * 0.8 for c in range(3)) + (1.0,)
    rings = []
    for r, t in prof:
        c = top + axis * t
        ring = []
        for k in range(1 if r == 0.0 else segs):
            a = 2 * math.pi * k / segs
            v = bm.verts.new(c + (side_v * math.cos(a) + fwd * math.sin(a) * 0.85) * r)
            v[col] = stem_col
            ring.append(v)
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(segs):
            if len(ra) == 1:
                bm.faces.new((ra[0], rb[(k + 1) % segs], rb[k]))
            elif len(rb) == 1:
                bm.faces.new((ra[k], ra[(k + 1) % segs], rb[0]))
            else:
                bm.faces.new((ra[k], ra[(k + 1) % segs], rb[(k + 1) % segs], rb[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("stem")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("stem", me)
    bpy.context.collection.objects.link(o)
    return o


def duplicate(o, name):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.collection.objects.link(c)
    return c


def decimate(o, tris):
    o.data.calc_loop_triangles()
    now = len(o.data.loop_triangles)
    mod = o.modifiers.new("dec", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, tris / now)
    mod.use_collapse_triangulate = True
    apply_mod(o, mod)
    o.data.calc_loop_triangles()
    log(f"{o.name}: {now} -> {len(o.data.loop_triangles)} tris")


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    bpy.ops.object.shade_smooth()
    return o


# ---------------------------------------------------------------- high + low meshes
high_parts = [hemisphere(+1), hemisphere(-1), cerebellum(), stem()]
low_parts = [duplicate(p, p.name + "_low") for p in high_parts]
decimate(low_parts[0], TRIS_HEMI)
decimate(low_parts[1], TRIS_HEMI)
decimate(low_parts[2], TRIS_CEREB)
high = join("BrainHigh", high_parts)
brain = join("Brain", low_parts)

# Origin at the low mesh's bbox centre, both meshes moved together.
bb = [brain.matrix_world @ Vector(c) for c in brain.bound_box]
centre = sum(bb, Vector()) / 8
for o in (brain, high):
    o.data.transform(__import__("mathutils").Matrix.Translation(-centre))
    o.data.update()
dims = brain.dimensions
log(f"dims (Blender x=width, y=length, z=height): {tuple(round(d, 4) for d in dims)}")

# ---------------------------------------------------------------- UVs + bake
select_only(brain)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

tmp = tempfile.mkdtemp(prefix="brain-bake-")
img_col = bpy.data.images.new("brain_albedo", TEX, TEX, alpha=False)
img_nrm = bpy.data.images.new("brain_normal", TEX, TEX, alpha=False, float_buffer=False)
img_nrm.colorspace_settings.name = 'Non-Color'

# High material: emission = the vertex albedo (what the EMIT bake reads).
mh = bpy.data.materials.new("BrainHighMat")
mh.use_nodes = True
nh = mh.node_tree
for nd in list(nh.nodes):
    nh.nodes.remove(nd)
out_h = nh.nodes.new("ShaderNodeOutputMaterial")
em = nh.nodes.new("ShaderNodeEmission")
vc = nh.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
nh.links.new(vc.outputs["Color"], em.inputs["Color"])
nh.links.new(em.outputs["Emission"], out_h.inputs["Surface"])
high.data.materials.clear(); high.data.materials.append(mh)

# Low material: the export material (Principled, textures), plus the bake target node.
ml = bpy.data.materials.new("BrainWet")
ml.use_nodes = True
nl = ml.node_tree
bsdf = nl.nodes["Principled BSDF"]
tex_col = nl.nodes.new("ShaderNodeTexImage"); tex_col.image = img_col
tex_nrm = nl.nodes.new("ShaderNodeTexImage"); tex_nrm.image = img_nrm
nmap = nl.nodes.new("ShaderNodeNormalMap")
bsdf.inputs["Roughness"].default_value = 0.3
for key, val in (("Coat Weight", 0.5), ("Coat Roughness", 0.12), ("Sheen Weight", 0.25)):
    if key in bsdf.inputs:
        bsdf.inputs[key].default_value = val
brain.data.materials.clear(); brain.data.materials.append(ml)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 1
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 0.006
sc.render.bake.max_ray_distance = 0.012
sc.render.bake.margin = 6


def bake(kind, node):
    nl.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    brain.select_set(True)
    bpy.context.view_layer.objects.active = brain
    bpy.ops.object.bake(type=kind)
    log(f"baked {kind}")


bake('NORMAL', tex_nrm)
bake('EMIT', tex_col)
for img in (img_col, img_nrm):
    img.filepath_raw = os.path.join(tmp, img.name + ".png")
    img.file_format = 'PNG'
    img.save()
    img.pack()
nl.links.new(tex_col.outputs["Color"], bsdf.inputs["Base Color"])
nl.links.new(tex_nrm.outputs["Color"], nmap.inputs["Color"])
nl.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bpy.data.objects.remove(high, do_unlink=True)

# ---------------------------------------------------------------- preview (the low mesh, as the game gets it)
WORLD = bpy.data.worlds.new("PreviewWorld")
WORLD.use_nodes = True
WORLD.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.03, 1)
sc.world = WORLD


def light_rig(target):
    specs = [
        ("key", 4.0, (1.0, 0.97, 0.9), (target[0] + 0.22, target[1] - 0.30, target[2] + 0.28)),
        ("fill", 1.5, (0.75, 0.8, 0.95), (target[0] - 0.28, target[1] - 0.18, target[2] + 0.10)),
        ("rim", 2.5, (1.0, 0.75, 0.6), (target[0] - 0.05, target[1] + 0.32, target[2] + 0.22)),
    ]
    out = []
    for name, power, color, loc in specs:
        ld = bpy.data.lights.new(name, type='POINT')
        ld.energy = power
        ld.color = color
        ld.shadow_soft_size = 0.05
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.collection.objects.link(lo)
        out.append(lo)
    return out


def render(path, loc, target=(0, 0, 0), res=(900, 700), lens=60):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - Vector(loc)).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    lights = light_rig(target)
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    try:
        sc.render.engine = 'BLENDER_EEVEE'
        sc.eevee.taa_render_samples = 32
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        log(f"EEVEE render failed ({e}); falling back to Workbench.")
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.color_type = 'TEXTURE'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for lo in lights:
        bpy.data.objects.remove(lo, do_unlink=True)


render(os.path.join(PREVIEW_DIR, "brain-model.png"), (0.26, 0.30, 0.22))            # 3/4 front-top-right
render(os.path.join(PREVIEW_DIR, "brain-model-side.png"), (0.42, 0.0, 0.0))          # right side
render(os.path.join(PREVIEW_DIR, "brain-model-back.png"), (-0.12, -0.34, -0.10))     # back-low-left
render(os.path.join(PREVIEW_DIR, "brain-model-top.png"), (0.0, -0.10, 0.40))         # top, from behind: the fissure

# ---------------------------------------------------------------- export + verify
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
select_only(brain)
brain.data.color_attributes.remove(brain.data.color_attributes["Col"])
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True,
                          use_selection=True, export_image_format='WEBP', export_image_quality=90)
size = os.path.getsize(OUT_GLB)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OUT_GLB)
new = [o for o in bpy.data.objects if o not in before]
meshes = [o for o in new if o.type == 'MESH']
tris = 0
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
names = sorted(o.name.split('.')[0] for o in meshes)
imgs = sorted({n.image.name for o in meshes for s in o.material_slots if s.material for n in s.material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image})
log(f"exported {OUT_GLB} ({size} bytes, {tris} tris); mesh nodes {names}; textures {imgs}")
if names != ["Brain"]:
    raise SystemExit(f"[brain] FAIL: expected one mesh node Brain, got {names}")
if tris > MAX_TRIS:
    raise SystemExit(f"[brain] FAIL: {tris} tris > {MAX_TRIS}")
if len(imgs) < 2:
    raise SystemExit("[brain] FAIL: the albedo and normal textures did not export")
print("[brain] PASS")
