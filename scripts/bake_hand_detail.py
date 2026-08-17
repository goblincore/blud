"""Build two posed hands from Blender primitives and bake orthographic HEIGHT MAPS.

Original geometry: the hands are assembled here from cubes / spheres / cylinders
(palm block + dome, metacarpal knuckle balls, extensor tendon ridges, tapered
capsule phalanges with joint balls and nail plates), then unified into a single
flesh surface with a voxel Remesh + Smooth modifier stack. Nothing is downloaded
and no third-party asset is used.

Two poses:
    grip  -- RIGHT hand fisted around a vertical 30 mm-radius dynamite bundle,
             thumb locked over the outside of the proximal phalanges.
    pinch -- LEFT hand holding a 4 mm-radius cigarette clamped between the index
             and middle fingers, ring + pinky curled loosely, thumb relaxed.

The bundle / cigarette are POSING AIDS only. They are excluded from the height
map render (hide_render) so no prop shading bleeds into the flesh sheet; they are
shown in the lit human-review previews so the grip reads.

Sheet axis convention (identical for both hands, each authored in ITS OWN hand's
local frame -- the two sheets are NOT mirror images of each other):
    image +X (right) = hand's THUMB side
    image +Y (up)    = WRIST -> KNUCKLES
    so fingers/knuckles top, thumb right edge, wrist bottom.
Pixel value encodes HEIGHT toward the camera along the hand's back-normal:
nearest-to-camera = white, furthest = black. Unlit Emission shader driven by
Position.Z through a Map Range, auto-calibrated in two passes so the visible
surface spans the full 0..1. Background alpha = 0 (film_transparent).

Deterministic: no randomness anywhere, all dimensions fixed.

Run headless:
    blender --background --python scripts/bake_hand_detail.py

Outputs:
    public/assets/lab/hand-detail-grip.png    (256x256 RGBA height map)
    public/assets/lab/hand-detail-pinch.png   (256x256 RGBA height map)
    public/assets/lab/hand-detail.json        (per-sheet mean opaque luminance)
    docs/dev-notes/2026-08-17-hand-detail-bake/{grip,pinch}-preview.png (512px lit)

Also runnable under plain python3 to (re)compute just the manifest from the PNGs:
    python3 scripts/bake_hand_detail.py --manifest-only
"""

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LAB_DIR = REPO_ROOT / "public" / "assets" / "lab"
NOTE_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-hand-detail-bake"
MANIFEST_PATH = LAB_DIR / "hand-detail.json"

HEIGHT_RES = 256
PREVIEW_RES = 512
FRAME_FILL = 0.92          # hand occupies 92% of the frame -> ~4% margin a side

SHEETS = ("grip", "pinch")

try:
    import bpy
    from mathutils import Matrix, Vector
    IN_BLENDER = True
except ImportError:                                   # plain python3 mode
    IN_BLENDER = False


# ===========================================================================
# Manifest mode (needs PIL, which Blender's bundled python does not have)
# ===========================================================================

def compute_sheet_stats(png_path):
    """Mean / min / max luminance (0..1) over FULLY OPAQUE pixels only."""
    from PIL import Image

    img = Image.open(png_path)
    if img.mode != "RGBA":
        raise SystemExit(f"{png_path}: expected RGBA, got {img.mode}")
    px = img.load()
    w, h = img.size
    total = 0.0
    count = 0
    lo, hi = 1.0, 0.0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a != 255:
                continue
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            total += lum
            count += 1
            lo = min(lo, lum)
            hi = max(hi, lum)
    if count == 0:
        raise SystemExit(f"{png_path}: no opaque pixels")
    return {
        "size": (w, h),
        "opaque": count,
        "mean": total / count,
        "min": lo,
        "max": hi,
    }


def write_manifest():
    sheets = {}
    for name in SHEETS:
        rel = f"hand-detail-{name}.png"
        st = compute_sheet_stats(LAB_DIR / rel)
        sheets[name] = {"file": rel, "mean": round(st["mean"], 3)}
        print(f"[hand-detail] {rel}: {st['size'][0]}x{st['size'][1]} "
              f"opaque={st['opaque']} mean={st['mean']:.4f} "
              f"min={st['min']:.3f} max={st['max']:.3f}")
    MANIFEST_PATH.write_text(json.dumps({"sheets": sheets}, indent=2) + "\n")
    print(f"[hand-detail] manifest -> {MANIFEST_PATH}")


if not IN_BLENDER:
    write_manifest()
    sys.exit(0)


# ===========================================================================
# Scene reset
# ===========================================================================

def reset_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                       bpy.data.lights, bpy.data.images, bpy.data.worlds):
        for block in list(datablocks):
            datablocks.remove(block)
    world = bpy.data.worlds.new("Void")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    bpy.context.scene.world = world


# ===========================================================================
# Primitive helpers -- everything is built in the HAND LOCAL frame:
#   +X = thumb side, +Y = wrist -> knuckles, +Z = back of hand (camera side)
# ===========================================================================

def box(name, dims, loc, round_r=0.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = dims
    bpy.ops.object.transform_apply(scale=True)
    if round_r > 0.0:
        mod = o.modifiers.new("Round", "BEVEL")
        mod.width = round_r
        mod.segments = 4
        bpy.ops.object.modifier_apply(modifier="Round")
    return o


def ellipsoid(name, center, radii, xa=None, ya=None, za=None):
    """UV-sphere scaled to `radii`; optionally re-based onto an orthonormal
    frame (xa, ya, za) so flattened lumps (nails) can follow a finger."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12,
                                         radius=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = radii
    bpy.ops.object.transform_apply(scale=True)
    if xa is not None:
        m = Matrix((xa, ya, za)).transposed().to_4x4()
        m.translation = Vector(center)
        o.matrix_world = m
    else:
        o.location = center
    return o


def capsule(name, p0, p1, r0, r1):
    """Tapered shaft from p0 to p1 with ball caps -- one phalanx segment."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=r0, radius2=r1,
                                    depth=length, location=(p0 + p1) / 2.0)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    caps = [ellipsoid(f"{name}_cap0", p0, (r0, r0, r0)),
            ellipsoid(f"{name}_cap1", p1, (r1, r1, r1))]
    return [o] + caps


def cylinder(name, radius, depth, loc, rot=None, verts=28):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius,
                                        depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    if rot is not None:
        o.rotation_euler = rot
    return o


# ===========================================================================
# Digit builder
# ===========================================================================

def digit(name, base, seg_lens, pitch_degs, radii, splay_deg=0.0,
          nail_on_last=False, knuckle_scale=1.24):
    """Three-phalanx finger.

    base        MCP joint centre (metacarpal head).
    splay_deg   fan in the palm plane, +X = toward the thumb.
    pitch_degs  per-joint flexion, CUMULATIVE down the chain; positive curls
                toward the palm (-Z).
    radii       four shaft radii: MCP, PIP, DIP, tip.
    """
    parts = []
    pos = Vector(base)
    # Negated so that POSITIVE splay fans the finger toward +X (the thumb side).
    rz = Matrix.Rotation(math.radians(-splay_deg), 4, "Z")
    fwd0 = rz @ Vector((0.0, 1.0, 0.0))
    side = rz @ Vector((1.0, 0.0, 0.0))
    up0 = rz @ Vector((0.0, 0.0, 1.0))

    # Metacarpal head = the visible knuckle ball, sitting proud of the palm back
    kr = radii[0] * knuckle_scale
    parts.append(ellipsoid(f"{name}_knuckle", pos + Vector((0, 0, 0.0034)),
                           (kr * 0.90, kr, kr * 0.98)))

    cum = 0.0
    for i, (seg_len, pitch) in enumerate(zip(seg_lens, pitch_degs)):
        cum += pitch
        rot = Matrix.Rotation(math.radians(-cum), 4, side)
        d = (rot @ fwd0).normalized()
        up = (rot @ up0).normalized()
        nxt = pos + d * seg_len
        parts += capsule(f"{name}_ph{i}", pos, nxt, radii[i], radii[i + 1])
        if i < len(seg_lens) - 1:
            jr = radii[i + 1] * 1.16
            parts.append(ellipsoid(f"{name}_joint{i}", nxt,
                                   (jr * 0.96, jr * 0.90, jr)))
        if nail_on_last and i == len(seg_lens) - 1:
            r = radii[i + 1]
            centre = pos + d * (seg_len * 0.52) + up * (r * 0.66)
            parts.append(ellipsoid(f"{name}_nail", centre,
                                   (r * 0.72, seg_len * 0.36, r * 0.38),
                                   xa=side, ya=d, za=up))
        pos = nxt
    return parts


def thumb(name, pts, radii, nail=True):
    """Three-link thumb through explicit world points (4 points, 3 links)."""
    parts = []
    for i in range(3):
        p0, p1 = Vector(pts[i]), Vector(pts[i + 1])
        parts += capsule(f"{name}_l{i}", p0, p1, radii[i], radii[i + 1])
        if i < 2:
            jr = radii[i + 1] * 1.14
            parts.append(ellipsoid(f"{name}_j{i}", p1, (jr, jr, jr)))
    if nail:
        p0, p1 = Vector(pts[2]), Vector(pts[3])
        d = (p1 - p0).normalized()
        side = d.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
        up = side.cross(d).normalized()
        if up.z < 0:
            up, side = -up, -side
        r = radii[3]
        centre = p0 + d * ((p1 - p0).length * 0.55) + up * (r * 0.64)
        parts.append(ellipsoid(f"{name}_nail", centre,
                               (r * 0.74, (p1 - p0).length * 0.34, r * 0.40),
                               xa=side, ya=d, za=up))
    return parts


# ===========================================================================
# Shared palm / wrist / tendon block (same for both hands: each sheet lives in
# its own hand's local frame, so both are authored thumb-toward-+X)
# ===========================================================================

PALM_BACK_Z = 0.012
FINGER_BASES = {                      # MCP centres, arced knuckle line
    "index":  (0.027, 0.0450, 0.0040),
    "middle": (0.008, 0.0490, 0.0040),
    "ring":  (-0.011, 0.0448, 0.0032),
    "pinky": (-0.029, 0.0362, 0.0022),
}
FINGER_RADII = {
    "index":  (0.0110, 0.0100, 0.0088, 0.0078),
    "middle": (0.0113, 0.0102, 0.0090, 0.0080),
    "ring":   (0.0106, 0.0096, 0.0085, 0.0075),
    "pinky":  (0.0092, 0.0084, 0.0075, 0.0066),
}
FINGER_LENS = {
    "index":  (0.042, 0.027, 0.020),
    "middle": (0.046, 0.030, 0.021),
    "ring":   (0.042, 0.028, 0.020),
    "pinky":  (0.033, 0.021, 0.017),
}


def build_palm():
    parts = []
    # Slab + dome = a palm that is flat-ish on the inside and domed on the back
    parts.append(box("Palm_Slab", (0.082, 0.070, 0.021), (0.000, 0.011, 0.000),
                     round_r=0.009))
    parts.append(ellipsoid("Palm_Dome", (0.000, 0.014, 0.000),
                           (0.039, 0.034, 0.0125)))
    # Wrist stub, narrower and flatter than the palm
    parts.append(box("Wrist", (0.056, 0.042, 0.019), (0.002, -0.045, 0.000),
                     round_r=0.008))
    parts.append(ellipsoid("Wrist_Round", (0.002, -0.040, 0.000),
                           (0.026, 0.020, 0.0100)))
    # Ulnar head -- the knobble on the little-finger side of the wrist
    parts.append(ellipsoid("Ulnar_Head", (-0.024, -0.050, 0.006),
                           (0.008, 0.009, 0.006)))
    # Thenar (thumb) and hypothenar muscle pads, bulging palm-side
    parts.append(ellipsoid("Thenar", (0.030, -0.008, -0.004),
                           (0.018, 0.026, 0.013)))
    parts.append(ellipsoid("Hypothenar", (-0.032, -0.010, -0.003),
                           (0.012, 0.024, 0.011)))
    return parts


def build_tendons():
    """Four extensor ridges fanning from the wrist to each metacarpal head."""
    runs = [
        ("index",  (0.011, -0.026, 0.0090), (0.026, 0.038, 0.0104)),
        ("middle", (0.002, -0.027, 0.0090), (0.008, 0.040, 0.0104)),
        ("ring",   (-0.007, -0.026, 0.0088), (-0.011, 0.038, 0.0100)),
        ("pinky",  (-0.016, -0.024, 0.0084), (-0.028, 0.031, 0.0094)),
    ]
    parts = []
    for name, a, b in runs:
        # Flush at the wrist, ~2 mm proud at the knuckles: a tendon that
        # emerges as the hand opens, not a skeletal rib.
        parts += capsule(f"Tendon_{name}", a, b, 0.0026, 0.0040)
    return parts


# ===========================================================================
# Pose 1 -- grip: fist around a vertical 30 mm dynamite bundle
# ===========================================================================

GRIP_CURL = {                       # per-joint flexion, degrees
    "index":  (62, 58, 30),
    "middle": (60, 60, 32),
    "ring":   (62, 62, 32),
    "pinky":  (64, 64, 34),
}
GRIP_SPLAY = {"index": -3.0, "middle": 0.0, "ring": 3.0, "pinky": 8.0}


def build_grip():
    parts = build_palm() + build_tendons()
    for name in ("index", "middle", "ring", "pinky"):
        parts += digit(name, FINGER_BASES[name], FINGER_LENS[name],
                       GRIP_CURL[name], FINGER_RADII[name],
                       splay_deg=GRIP_SPLAY[name])
    # Thumb folded across the outside of the proximal phalanges
    parts += thumb("thumb",
                   [(0.034, -0.014, -0.004),
                    (0.054, 0.012, -0.010),
                    (0.048, 0.038, -0.024),
                    (0.024, 0.048, -0.032)],
                   (0.0146, 0.0118, 0.0102, 0.0088))

    # Posing aid: the dynamite bundle. Axis along the hand's X (parallel to the
    # knuckle line) -- i.e. "vertical" with the forearm level. Excluded from the
    # height bake, shown in the preview only.
    prop = cylinder("Prop_Dynamite", 0.030, 0.096,
                    (0.006, 0.048, -0.030),
                    rot=(0.0, math.radians(90.0), 0.0))
    return parts, prop


# ===========================================================================
# Pose 2 -- pinch: cigarette clamped between index and middle
# ===========================================================================

PINCH_CURL = {
    "index":  (3, 6, 6),          # kept near-straight: a diving fingertip would
    "middle": (4, 7, 6),         # spend the whole depth band on the pose
    "ring":   (36, 46, 24),
    "pinky":  (42, 50, 28),
}
PINCH_SPLAY = {"index": 7.0, "middle": -6.0, "ring": -1.0, "pinky": 3.0}


def build_pinch():
    parts = build_palm() + build_tendons()
    for name in ("index", "middle", "ring", "pinky"):
        parts += digit(name, FINGER_BASES[name], FINGER_LENS[name],
                       PINCH_CURL[name], FINGER_RADII[name],
                       splay_deg=PINCH_SPLAY[name],
                       nail_on_last=name in ("index", "middle"))
    # Thumb relaxed alongside the hand: abducted out to +X, short and thick
    parts += thumb("thumb",
                   [(0.032, -0.016, -0.002),
                    (0.055, 0.006, -0.004),
                    (0.063, 0.030, -0.002),
                    (0.062, 0.048, 0.002)],
                   (0.0150, 0.0122, 0.0106, 0.0092))

    # Posing aid: cigarette, clamped between index and middle middle-phalanges,
    # axis mostly along the palm normal with a forward tilt. Excluded from bake.
    prop = cylinder("Prop_Cigarette", 0.004, 0.072,
                    (0.0178, 0.082, 0.004),
                    rot=(math.radians(-16.0), 0.0, 0.0), verts=16)
    return parts, prop


# ===========================================================================
# Unify the primitive soup into one flesh surface
# ===========================================================================

def finalize_hand(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hand = bpy.context.active_object
    hand.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    rm = hand.modifiers.new("Flesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.0016
    rm.adaptivity = 0.0
    sm = hand.modifiers.new("Soften", "SMOOTH")
    sm.factor = 0.35
    sm.iterations = 2
    bpy.ops.object.shade_smooth()
    return hand


def evaluated_bounds(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    mw = obj.matrix_world
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for v in mesh.vertices:
        co = mw @ v.co
        for i in range(3):
            lo[i] = min(lo[i], co[i])
            hi[i] = max(hi[i], co[i])
    ev.to_mesh_clear()
    return Vector(lo), Vector(hi)


# ===========================================================================
# Height material -- unlit Emission = normalised depth along the view axis (+Z)
# ===========================================================================

def make_height_material(z_min, z_max):
    mat = bpy.data.materials.new("HandHeight")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.inputs["From Min"].default_value = z_min
    mr.inputs["From Max"].default_value = z_max
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat, mr


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


HIST_BINS = 512
FLOOR_PERCENTILE = 5.0     # fraction of opaque pixels allowed to clamp to black


def read_opaque_levels(png_path):
    """Percentile floor + max of the STORED grey of fully-opaque pixels.

    The naive min..max band is dominated by the deepest single feature (the
    thumb crossing the fist, the loosely curled ring/pinky), which squashes the
    whole palm into a flat plateau near 1.0 -- knuckle and tendon relief would
    then only occupy a few percent of the sheet's contrast. Clipping the bottom
    FLOOR_PERCENTILE of the depth histogram instead spends the 0..1 range on the
    relief that the consuming shader actually wants.
    """
    img = bpy.data.images.load(str(png_path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"      # read raw stored values
    buf = [0.0] * len(img.pixels)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)

    hist = [0] * HIST_BINS
    total = 0
    hi = 0.0
    for i in range(0, len(buf), 4):
        if buf[i + 3] < 0.999:
            continue
        v = min(max(buf[i], 0.0), 1.0)
        hist[min(int(v * HIST_BINS), HIST_BINS - 1)] += 1
        total += 1
        hi = max(hi, v)
    if total == 0:
        raise SystemExit(f"{png_path}: no opaque pixels in calibration pass")

    cutoff = total * FLOOR_PERCENTILE / 100.0
    seen = 0
    floor = 0.0
    for b, n in enumerate(hist):
        seen += n
        if seen >= cutoff:
            floor = (b + 1) / HIST_BINS
            break
    return floor, hi


# ===========================================================================
# Render setup
# ===========================================================================

def configure_engine(transparent):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # Enum items are OCIO-populated at runtime -- assign and catch, never
    # introspect enum_items (Blender 5.2 scripting trap).
    for attr, value in (("view_transform", "Standard"), ("look", "None")):
        try:
            setattr(scene.view_settings, attr, value)
        except (TypeError, ValueError):
            pass
    return scene


def add_height_camera(lo, hi):
    """Orthographic camera on the BACK-of-hand side looking down -Z.

    Identity rotation => view axis -Z, camera up +Y, camera right +X, so
    image +X = thumb side and image +Y = wrist -> knuckles.
    """
    cx = (lo.x + hi.x) * 0.5
    cy = (lo.y + hi.y) * 0.5
    span = max(hi.x - lo.x, hi.y - lo.y)
    scale = span / FRAME_FILL
    bpy.ops.object.camera_add(location=(cx, cy, hi.z + 0.40))
    cam = bpy.context.active_object
    cam.name = "HeightCam"
    cam.rotation_euler = (0.0, 0.0, 0.0)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    cam.data.clip_start = 0.01
    cam.data.clip_end = 2.0
    bpy.context.scene.camera = cam
    return cam, (cx, cy, scale)


def bake_height(hand, prop, name):
    prop.hide_render = True
    lo, hi = evaluated_bounds(hand)
    mat, mr = make_height_material(lo.z, hi.z)
    assign_material(hand, mat)

    scene = configure_engine(transparent=True)
    scene.render.resolution_x = HEIGHT_RES
    scene.render.resolution_y = HEIGHT_RES
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 24
    _cam, frame = add_height_camera(lo, hi)

    out_path = LAB_DIR / f"hand-detail-{name}.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Pass 1: provisional range = whole bbox depth. Only the camera-facing shell
    # is visible, so the useful depth band is a subset of it -> measure it.
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)
    s_lo, s_hi = read_opaque_levels(out_path)
    t_lo, t_hi = srgb_to_linear(s_lo), srgb_to_linear(s_hi)
    depth = hi.z - lo.z
    z_vis_lo = lo.z + t_lo * depth
    z_vis_hi = lo.z + t_hi * depth
    if z_vis_hi - z_vis_lo < 1e-5:
        raise SystemExit(f"[{name}] degenerate visible depth range")

    # Pass 2: re-normalise over the measured visible band -> full 0..1 sheet.
    mr.inputs["From Min"].default_value = z_vis_lo
    mr.inputs["From Max"].default_value = z_vis_hi
    bpy.ops.render.render(write_still=True)

    print(f"[hand-detail] {name}: bbox x[{lo.x:+.4f},{hi.x:+.4f}] "
          f"y[{lo.y:+.4f},{hi.y:+.4f}] z[{lo.z:+.4f},{hi.z:+.4f}]")
    print(f"[hand-detail] {name}: ortho centre=({frame[0]:+.4f},{frame[1]:+.4f}) "
          f"scale={frame[2]:.4f} m   visible z[{z_vis_lo:+.4f},{z_vis_hi:+.4f}]")
    print(f"[hand-detail] {name}: height map -> {out_path}")
    prop.hide_render = False
    return frame


# ---------------------------------------------------------------------------
# Lit preview (human review only -- prop shown here so the grip reads)
# ---------------------------------------------------------------------------

def make_pbr(name, color, rough=0.55, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def point_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_preview(hand, prop, name, cam_loc, target):
    assign_material(hand, make_pbr(f"Flesh_{name}", (0.62, 0.42, 0.34), 0.52))
    assign_material(prop, make_pbr(f"Prop_{name}", (0.20, 0.10, 0.07), 0.85))

    scene = configure_engine(transparent=False)
    scene.render.resolution_x = PREVIEW_RES
    scene.render.resolution_y = PREVIEW_RES
    scene.eevee.taa_render_samples = 32
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = \
        (0.05, 0.055, 0.065, 1.0)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35

    for cam in [o for o in scene.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(cam, do_unlink=True)
    bpy.ops.object.camera_add(location=cam_loc)
    cam = bpy.context.active_object
    cam.name = "PreviewCam"
    cam.data.lens = 50
    point_at(cam, target)
    scene.camera = cam

    # EEVEE jitters area-light shadows stochastically, which makes the preview
    # PNG differ byte-for-byte between otherwise identical runs. Pin it off so
    # the previews are reproducible too.
    scene.eevee.use_raytracing = False
    scene.eevee.use_shadow_jitter_viewport = False

    def area(nm, loc, energy, size=0.5):
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.active_object
        light.name = nm
        light.data.energy = energy
        light.data.size = size
        light.data.use_shadow_jitter = False
        point_at(light, target)

    area("Key", (0.20, -0.16, 0.26), 2.4, size=0.26)
    area("Fill", (-0.24, -0.12, 0.08), 1.0, size=0.40)
    area("Rim", (0.02, 0.22, 0.20), 1.2, size=0.26)

    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(NOTE_DIR / f"{name}-preview.png")
    bpy.ops.render.render(write_still=True)
    print(f"[hand-detail] {name}: preview -> {scene.render.filepath}")


# ===========================================================================

POSES = {
    # (builder, preview camera location, preview aim point) -- the preview looks
    # at the back of the hand from the thumb side and slightly above, i.e. the
    # same side the height camera bakes from, just perspective and lit.
    "grip": (build_grip, (0.070, -0.100, 0.270), (0.006, 0.020, -0.008)),
    "pinch": (build_pinch, (0.080, -0.120, 0.330), (0.008, 0.038, 0.000)),
}


def main():
    for name, (builder, cam_loc, target) in POSES.items():
        reset_scene()
        parts, prop = builder()
        hand = finalize_hand(parts, f"Hand_{name}")
        bake_height(hand, prop, name)
        render_preview(hand, prop, name, cam_loc, target)

    py = shutil.which("python3")
    if not py:
        raise SystemExit("python3 not found -- cannot compute manifest means")
    subprocess.run([py, str(Path(__file__).resolve()), "--manifest-only"],
                   check=True)


main()
