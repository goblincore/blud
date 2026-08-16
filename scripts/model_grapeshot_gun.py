"""Build the lab's homemade grapeshot shotgun (Spec D, section 1) and export it.

Construction language: rough hand-cut wood plank stock (boxy silhouette),
two steel pipes side by side, chunky tape band wraps holding pipes to plank,
a crude bent-metal trigger loop, and wires running to a taped-on igniter
block. Claymation-chunky proportions, dark matte materials.

Deterministic: no randomness anywhere; every part is fixed-dimension.

Run headless:
    blender --background --python scripts/model_grapeshot_gun.py
    blender --background --python scripts/model_grapeshot_gun.py -- --no-renders

Outputs:
    public/assets/lab/grapeshot-gun.glb          (~0.76 m long, origin at grip,
                                                  gun points down -Y in Blender)
    docs/dev-notes/2026-08-16-grapeshot-model/{front,back,left,three-quarter}.png
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector

REPO_ROOT = Path(__file__).resolve().parent.parent
GLB_PATH = REPO_ROOT / "public" / "assets" / "lab" / "grapeshot-gun.glb"
RENDER_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-16-grapeshot-model"

RENDER_TURNTABLE = "--no-renders" not in sys.argv


# ---------------------------------------------------------------------------
# Scene reset
# ---------------------------------------------------------------------------

def reset_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            datablocks.remove(block)


# ---------------------------------------------------------------------------
# Materials (flat-ish PBR, tuned dark so the latex hands stay the star)
# ---------------------------------------------------------------------------

def make_mat(name, color, rough=0.8, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def build_materials():
    return {
        "wood":    make_mat("Wood_Plank",    (0.23, 0.13, 0.07), 0.90, 0.00),
        "wood2":   make_mat("Wood_Butt",     (0.18, 0.10, 0.05), 0.95, 0.00),
        "steel":   make_mat("Steel_Pipe",    (0.16, 0.17, 0.18), 0.45, 0.85),
        "tape":    make_mat("Tape_Wrap",     (0.09, 0.09, 0.10), 0.70, 0.00),
        "wireR":   make_mat("Wire_Red",      (0.35, 0.04, 0.03), 0.60, 0.00),
        "wireB":   make_mat("Wire_Black",    (0.03, 0.03, 0.035), 0.60, 0.00),
        "bore":    make_mat("Bore_Dark",     (0.01, 0.01, 0.01), 1.00, 0.00),
        "igniter": make_mat("Igniter_Block", (0.12, 0.12, 0.13), 0.60, 0.20),
    }


# ---------------------------------------------------------------------------
# Primitive helpers
# ---------------------------------------------------------------------------

def box(name, dims, loc, mat, bevel=0.0, rot=None):
    """Axis-aligned (optionally rotated) box. `dims` are FULL extents
    (primitive_cube_add(size=1) spans -0.5..0.5, so scale = full extent)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = dims
    if rot:
        o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new("ChunkBevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    o.data.materials.append(mat)
    return o


def cyl(name, radius, depth, loc, mat, verts=14, rot=None, squash_y=1.0):
    """Cylinder; `rot` orients it, `squash_y` flattens local Y (tape bands)."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    if rot:
        o.rotation_euler = rot
    if squash_y != 1.0:
        o.scale = (1.0, squash_y, 1.0)
        bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def wire_curve(name, pts, bevel, mat):
    """Bezier tube through `pts` (3D curve, fixed low res for chunkiness)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = bevel
    cu.bevel_resolution = 1
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


# ---------------------------------------------------------------------------
# The gun. Origin (0,0,0) = grip point. Barrel runs toward -Y, butt toward +Y.
# ---------------------------------------------------------------------------

def build_gun(M):
    # -- Wood plank stock: three hand-cut lumps ---------------------------
    # Main fore-plank under the pipes
    box("Plank_Main", (0.052, 0.46, 0.075), (0, -0.06, -0.045),
        M["wood"], bevel=0.008)
    # Shoulder butt at the rear (+Y), taller slab
    box("Plank_Butt", (0.055, 0.14, 0.145), (0, 0.11, -0.085),
        M["wood2"], bevel=0.010)
    # Crude palm swell at the grip (origin)
    box("Plank_Grip", (0.056, 0.13, 0.110), (0, 0.02, -0.075),
        M["wood"], bevel=0.012)

    # -- Twin steel pipes (y: +0.10 breech -> -0.58 muzzle) ---------------
    pipe_rot = Euler((math.radians(90), 0, 0))
    cyl("Pipe_L", 0.017, 0.68, (-0.020, -0.24, 0.017), M["steel"],
        verts=16, rot=pipe_rot)
    cyl("Pipe_R", 0.017, 0.68, (0.020, -0.24, 0.017), M["steel"],
        verts=16, rot=pipe_rot)
    # Dark discs inset at the muzzle to fake hollow bores
    cyl("Bore_L", 0.013, 0.004, (-0.020, -0.579, 0.017), M["bore"],
        verts=12, rot=pipe_rot)
    cyl("Bore_R", 0.013, 0.004, (0.020, -0.579, 0.017), M["bore"],
        verts=12, rot=pipe_rot)
    # Crude breech plate capping both pipes
    box("Breech_Plate", (0.075, 0.018, 0.045), (0, 0.095, 0.017),
        M["steel"], bevel=0.004)

    # -- Chunky tape band wraps around the pipe pair ----------------------
    cyl("Tape_Breech", 0.037, 0.045, (0, 0.055, 0.017), M["tape"],
        verts=16, rot=pipe_rot, squash_y=0.82)
    cyl("Tape_Mid", 0.037, 0.035, (0, -0.230, 0.017), M["tape"],
        verts=16, rot=pipe_rot, squash_y=0.82)
    cyl("Tape_Muzzle", 0.037, 0.035, (0, -0.500, 0.017), M["tape"],
        verts=16, rot=pipe_rot, squash_y=0.82)

    # -- Crude bent-metal trigger loop + blade, below the grip ------------
    wire_curve("Trigger_Loop", [
        (0, -0.045, -0.100),
        (0, -0.055, -0.155),
        (0, -0.100, -0.185),
        (0, -0.155, -0.175),
        (0, -0.175, -0.125),
        (0, -0.145, -0.095),
    ], 0.0065, M["steel"])
    box("Trigger_Blade", (0.010, 0.016, 0.055), (0, -0.115, -0.125),
        M["steel"], bevel=0.003, rot=Euler((math.radians(-18), 0, 0)))

    # -- Taped-on igniter block at the right side of the breech -----------
    box("Igniter_Block", (0.030, 0.070, 0.038), (0.048, 0.045, 0.030),
        M["igniter"], bevel=0.004)
    cyl("Igniter_Tape", 0.040, 0.026, (0.018, 0.045, 0.024), M["tape"],
        verts=14, rot=pipe_rot, squash_y=0.78)

    # -- Wire runs: igniter block forward along the right pipe ------------
    wire_curve("Wire_Red", [
        (0.055, 0.055, 0.045),
        (0.045, -0.050, 0.042),
        (0.042, -0.200, 0.040),
        (0.040, -0.350, 0.038),
        (0.038, -0.490, 0.035),
    ], 0.0028, M["wireR"])
    wire_curve("Wire_Black", [
        (0.050, 0.060, 0.018),
        (0.044, -0.020, 0.006),
        (0.041, -0.150, 0.004),
        (0.039, -0.300, 0.002),
        (0.037, -0.480, 0.000),
    ], 0.0028, M["wireB"])


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_glb():
    # Curves -> meshes so the glTF export is explicit and stable
    for o in list(bpy.context.scene.objects):
        if o.type == "CURVE":
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.convert(target="MESH")

    bpy.ops.object.select_all(action="SELECT")
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,   # apply bevel modifiers on export
    )


# ---------------------------------------------------------------------------
# Turntable renders (for human review; not part of the shipped asset)
# ---------------------------------------------------------------------------

def point_at(obj, target):
    d = target - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_turntables():
    scene = bpy.context.scene
    # Blender 5.x folded EEVEE Next back into BLENDER_EEVEE; probe a chain.
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue

    target = Vector((0, -0.15, -0.04))

    bpy.ops.object.camera_add(location=(0.9, -1.0, 0.5))
    cam = bpy.context.active_object
    cam.name = "TurntableCam"
    cam.data.lens = 55
    scene.camera = cam

    def area_light(name, loc, energy):
        bpy.ops.object.light_add(type="AREA", location=loc)
        l = bpy.context.active_object
        l.name = name
        l.data.energy = energy
        l.data.size = 0.6
        point_at(l, target)

    area_light("Key", (0.8, -0.6, 1.2), 60)
    area_light("Fill", (-0.9, 0.4, 0.5), 35)
    area_light("Rim", (0.0, 0.9, 0.8), 50)

    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.30))
    ground = bpy.context.active_object
    ground.name = "Ground"
    gm = make_mat("Ground_Mat", (0.06, 0.06, 0.07), 0.9, 0.0)
    ground.data.materials.append(gm)

    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    # Enum items are runtime-populated from OCIO; assign and catch, never
    # introspect enum_items (Blender 5.2 scripting trap).
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        pass

    views = {
        "front":         (0.0, -1.35, 0.10),
        "back":          (0.0, 1.05, 0.25),
        "left":          (-1.15, -0.15, 0.10),
        "three-quarter": (0.90, -1.00, 0.50),
    }
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    for label, loc in views.items():
        cam.location = loc
        point_at(cam, target)
        scene.render.filepath = str(RENDER_DIR / f"{label}.png")
        bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------

def main():
    reset_scene()
    mats = build_materials()
    build_gun(mats)
    export_glb()
    print(f"[grapeshot] exported {GLB_PATH}")
    if RENDER_TURNTABLE:
        render_turntables()
        print(f"[grapeshot] turntables -> {RENDER_DIR}")


main()
