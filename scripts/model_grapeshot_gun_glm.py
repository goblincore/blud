#!/usr/bin/env python3
"""Grapeshot shotgun (Spec D) — procedural model, deterministic.

Builds the lab's improvised pipe-gun from primitives and exports
public/assets/lab/grapeshot-gun-glm.glb plus 4 turntable review renders.

Run headless from the repo root:
    blender --background --python scripts/model_grapeshot_gun_glm.py

Construction language (docs/superpowers/specs/2026-08-16-sdf-lab-grapeshot-design.md §1):
rough hand-cut wood plank stock, two steel pipes side by side, tape band
wraps, a crude bent-metal trigger loop, wires running to a taped-on igniter
block. Claymation-chunky proportions; dark matte materials.

Real-world scale ~0.75 m. Origin at the grip point, muzzle pointing -Y
(glTF exporter's default axis conversion handles the rest).
"""

import bpy
import bmesh
import math
import os
import random
import sys

from mathutils import Vector

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
SEED = 1337
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "grapeshot-gun-glm.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-08-16-grapeshot-model-glm")

# Layout is authored in "natural" coordinates with the plank centerline on
# Z=0..0.045 and the muzzle at Y=-0.44, then the whole gun is shifted so the
# GRIP CENTER lands at the world origin.
GRIP_NATURAL = Vector((0.0, 0.075, -0.062))

rng = random.Random(SEED)


# --------------------------------------------------------------------------
# Scene reset (standalone headless: factory settings are not blocked)
# --------------------------------------------------------------------------
def reset_scene():
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    except Exception:
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        for coll in list(bpy.data.collections):
            bpy.data.collections.remove(coll)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc


# --------------------------------------------------------------------------
# Materials — dark, matte; the SDF hands stay the star
# --------------------------------------------------------------------------
def build_materials():
    def M(name, base, metallic, rough):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bs = m.node_tree.nodes["Principled BSDF"]
        bs.inputs["Base Color"].default_value = base
        bs.inputs["Metallic"].default_value = metallic
        bs.inputs["Roughness"].default_value = rough
        return m

    return {
        "Wood":    M("Wood",    (0.155, 0.095, 0.050, 1.0), 0.0, 0.85),
        "Steel":   M("Steel",   (0.050, 0.053, 0.060, 1.0), 1.0, 0.45),
        "Tape":    M("Tape",    (0.033, 0.033, 0.036, 1.0), 0.0, 0.92),
        "WireRubber": M("WireRubber", (0.05, 0.045, 0.040, 1.0), 0.0, 0.85),
        "WireCloth":  M("WireCloth",  (0.40, 0.34, 0.24, 1.0), 0.0, 0.90),
        "Bore":    M("BoreIn",  (0.012, 0.012, 0.014, 1.0), 0.0, 0.95),
        "Igniter": M("Igniter", (0.11, 0.055, 0.05, 1.0), 0.0, 0.60),
    }


MATS = {}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def make_collection():
    col = bpy.data.collections.new("Gun")
    bpy.context.scene.collection.children.link(col)
    root = bpy.data.objects.new("GunRoot", None)
    col.objects.link(root)
    return col, root


def link(obj, col, root):
    col.objects.link(obj)
    obj.parent = root
    return obj


def finish(obj, mat, smooth=False, bevel=None):
    """Assign material; optionally apply a small bevel (claymation edges)."""
    if bevel:
        bv = obj.modifiers.new("bv", 'BEVEL')
        bv.width = bevel
        bv.segments = 2
        bv.limit_method = 'ANGLE'
        bv.angle_limit = math.radians(40)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="bv")
    slots = obj.data.materials
    if not slots:
        slots.append(MATS[mat])
    else:
        slots[0] = MATS[mat]
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def add_box(name, sx, sy, sz, col, root, mat="Wood", loc=(0, 0, 0), rot=(0, 0, 0),
            bevel=None, smooth=False, mesh=None):
    if mesh is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
    o = bpy.data.objects.new(name, mesh)
    link(o, col, root)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, mat, smooth=smooth, bevel=bevel)


def add_cyl(name, r, depth, segs, col, root, mat="Steel", loc=(0, 0, 0),
            axis_y=True, smooth=True, mesh=None):
    if mesh is None:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                              radius1=r, radius2=r, depth=depth)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
    o = bpy.data.objects.new(name, mesh)
    link(o, col, root)
    o.location = loc
    if axis_y:
        o.rotation_euler = (math.pi / 2, 0, 0)
    return finish(o, mat, smooth=smooth)


def tape_band_mesh(name, sx, sy, sz):
    """Chunky tape wrap: box with pulled-in end faces + slight hand jitter."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    for v in bm.verts:
        if abs(v.co.y) > sy * 0.49:  # end faces -> stretched-wrap look
            v.co.x *= 0.93
            v.co.z *= 0.93
        v.co.x += rng.uniform(-0.0012, 0.0012)
        v.co.z += rng.uniform(-0.0012, 0.0012)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


# --------------------------------------------------------------------------
# Parts
# --------------------------------------------------------------------------
def build_gun(col, root):
    # ---- plank stock: boxy, tapered, hand-cut jitter, beveled edges ----
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    yedges = [e for e in bm.edges if abs((e.verts[1].co - e.verts[0].co).y) > 0.5]
    bmesh.ops.subdivide_edges(bm, edges=yedges, use_grid_fill=True, cuts=3)
    bmesh.ops.scale(bm, vec=(0.084, 0.52, 0.045), verts=bm.verts)
    for v in bm.verts:
        t = -v.co.y / 0.26  # 0 at rear, 1 at muzzle end
        v.co.x *= (1.0 - 0.10 * t)  # taper toward the front
        v.co.x += rng.uniform(-0.004, 0.004)
        v.co.z += rng.uniform(-0.003, 0.003)
        if v.co.z > 0:
            v.co.z *= (1.0 + 0.06 * rng.uniform(0, 1))  # rough-sawn top
    plank_mesh = bpy.data.meshes.new("plank")
    bm.to_mesh(plank_mesh)
    bm.free()
    add_box("Plank", 0, 0, 0, col, root, mat="Wood", loc=(0, -0.12, 0.0225),
            mesh=plank_mesh, bevel=0.005)

    # ---- twin steel pipes on top of the plank ----
    for i, sx in enumerate((-0.0205, 0.0205)):
        add_cyl(f"Pipe{i}", 0.019, 0.48, 16, col, root, "Steel",
                loc=(sx, -0.20, 0.0665))
        # dark bore inset at the muzzle face
        add_cyl(f"Bore{i}", 0.012, 0.014, 12, col, root, "Bore",
                loc=(sx, -0.437, 0.0665))

    # ---- tape bands: 3 wrapping plank+pipes, 2 muzzle wraps ----
    bands = [
        ("BandMid",   0.104, 0.034, 0.108, (0, -0.185, 0.0435), 2.5, 0.0),
        ("BandFront", 0.098, 0.030, 0.104, (0, -0.335, 0.0425), -3.0, 1.5),
        ("BandRear",  0.106, 0.032, 0.110, (0, -0.055, 0.0440), 1.5, -1.0),
        ("MuzzBand0", 0.046, 0.030, 0.046, (-0.0205, -0.412, 0.0665), 4.0, 0.0),
        ("MuzzBand1", 0.046, 0.030, 0.046, (0.0205, -0.412, 0.0665), -3.5, 0.0),
    ]
    for name, sx, sy, sz, loc, ry, rx in bands:
        me = tape_band_mesh(name, sx, sy, sz)
        add_box(name, 0, 0, 0, col, root, mat="Tape", loc=loc,
                rot=(math.radians(rx), math.radians(ry), 0), mesh=me)

    # ---- grip (leans back), butt stock + taped butt plate ----
    add_box("Grip", 0.036, 0.092, 0.14, col, root, "Wood",
            loc=(0, 0.075, -0.062), rot=(math.radians(-18), 0, 0), bevel=0.006)
    add_box("Stock", 0.072, 0.175, 0.05, col, root, "Wood",
            loc=(0, 0.225, 0.014), rot=(math.radians(6), 0, 0), bevel=0.005)
    add_box("ButtPlate", 0.080, 0.012, 0.062, col, root, "Tape",
            loc=(0, 0.316, 0.008), rot=(math.radians(6), 0, 0))

    # ---- trigger loop: crude bent-metal ring (hole axis along X) + blade ----
    loop_mesh = bpy.data.meshes.new("trigloop")
    tmp = bpy.data.objects.new("tmp", loop_mesh)
    col.objects.link(tmp)
    bpy.context.view_layer.objects.active = tmp
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.0048,
                                     major_segments=12, minor_segments=6,
                                     location=(0, -0.005, -0.030),
                                     rotation=(0, math.radians(90), 0))
    loop = bpy.context.active_object
    loop.name = "TriggerLoop"
    loop.parent = root
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(loop_mesh)
    finish(loop, "Steel", smooth=True)
    add_box("TriggerBlade", 0.012, 0.016, 0.038, col, root, "Steel",
            loc=(0, -0.004, -0.026), rot=(math.radians(-14), 0, 0))

    # ---- igniter block taped under the plank, ahead of the trigger ----
    add_box("IgniterBlock", 0.034, 0.052, 0.026, col, root, "Igniter",
            loc=(0, -0.125, -0.015), rot=(0, math.radians(2), 0), bevel=0.003)
    me = tape_band_mesh("BandIgn", 0.052, 0.030, 0.076)
    add_box("BandIgn", 0, 0, 0, col, root, mat="Tape",
            loc=(0, -0.125, 0.0105), rot=(0, math.radians(3.0), 0), mesh=me)

    # ---- wires: igniter -> pipe breech (x2) and igniter -> trigger loop ----
    wires = [
        ("WireRubber", "IgniterBreechR",
         [(-0.012, -0.099, -0.020), (-0.030, -0.060, -0.012),
          (-0.036, -0.005, 0.028), (-0.016, 0.030, 0.052), (-0.009, 0.038, 0.060)]),
        ("WireCloth", "IgniterBreechL",
         [(0.012, -0.099, -0.020), (0.033, -0.055, -0.008),
          (0.038, 0.000, 0.030), (0.018, 0.032, 0.055), (0.009, 0.038, 0.062)]),
        ("WireCloth", "IgniterTrig",
         [(0.013, -0.105, -0.016), (0.030, -0.070, 0.002),
          (0.026, -0.030, -0.014), (0.010, -0.018, -0.026)]),
    ]
    for mat_name, wname, pts in wires:
        cu = bpy.data.curves.new(wname, type='CURVE')
        cu.dimensions = '3D'
        cu.fill_mode = 'FULL'
        cu.bevel_depth = 0.0042       # chunky clay wire
        cu.bevel_resolution = 2
        cu.resolution_u = 3
        cu.use_fill_caps = True
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        o = bpy.data.objects.new(wname, cu)
        link(o, col, root)
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target='MESH')
        slots = o.data.materials
        if not slots:
            slots.append(MATS[mat_name])
        else:
            slots[0] = MATS[mat_name]
        for p in o.data.polygons:
            p.use_smooth = True

    # ---- shift so the grip center is the world origin ----
    root.location = -GRIP_NATURAL
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              export_apply=True, export_yup=True,
                              export_extras=False)
    return os.path.getsize(path)


# --------------------------------------------------------------------------
# Turntable renders (review only; cannot be seen by the authoring agent)
# --------------------------------------------------------------------------
def setup_render(sc):
    world = bpy.data.worlds.new("ReviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.055, 0.06, 0.07, 1.0)
    bg.inputs[1].default_value = 1.0
    sc.world = world

    # exactly three suns (key/fill/rim) — an earlier session's accidental
    # duplicate suns blew every render out to flat white; keep this explicit
    suns = (
        ("SunKey",  (math.radians(60), math.radians(15), math.radians(40)), 4.0),
        ("SunFill", (math.radians(70), math.radians(-60), 0), 1.2),
        ("SunRim",  (math.radians(35), 0, math.radians(150)), 1.8),
    )
    for n, rot, e in suns:
        ld = bpy.data.lights.new(n, 'SUN')
        ld.energy = e
        ld.angle = math.radians(30)
        l = bpy.data.objects.new(n, ld)
        l.rotation_euler = rot
        sc.collection.objects.link(l)

    cam_data = bpy.data.cameras.new("ReviewCam")
    cam_data.lens = 55
    cam = bpy.data.objects.new("ReviewCam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam

    tgt = bpy.data.objects.new("CamTarget", None)
    sc.collection.objects.link(tgt)
    tgt.location = Vector((0, -0.134, 0.03))  # gun assembly center
    tr = cam.constraints.new('TRACK_TO')
    tr.target = tgt
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 512
    sc.render.resolution_y = 512
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    return cam


VIEWS = {
    "turntable_front":         Vector((0.0, -1.35, 0.12)),
    "turntable_back":          Vector((0.0, 1.35, 0.12)),
    "turntable_left":          Vector((1.35, -0.134, 0.12)),
    "turntable_threequarter":  Vector((0.78, -0.95, 0.38)),
}


def render_turntables(sc, cam, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    stats = {}
    for name, offset in VIEWS.items():
        cam.location = tgt_center + offset
        bpy.context.view_layer.update()
        path = os.path.join(out_dir, name + ".png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        stats[name] = png_stats(path)
    return stats


def png_stats(path):
    """Luminance diagnostics so a text-only reviewer can sanity-check."""
    try:
        import numpy as np
        img = bpy.data.images.load(path, check_existing=False)
        px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        lum = px[..., :3].mean(axis=2)
        bg = float(np.median(lum))
        above = lum > (bg + 0.05)
        ys, xs = np.nonzero(above)
        return {
            "bg": round(bg, 3),
            "max": round(float(lum.max()), 3),
            "coverage_pct": round(float(above.mean() * 100), 1),
            "subject_bbox": ([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
                             if above.any() else None),
        }
    except Exception as e:
        return {"error": str(e)}


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------
def gun_bounds(col):
    bb_min = Vector((1e9,) * 3)
    bb_max = -bb_min
    tris = 0
    for o in col.objects:
        if o.type != 'MESH':
            continue
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            bb_min = Vector(map(min, bb_min, w))
            bb_max = Vector(map(max, bb_max, w))
    return bb_min, bb_max, tris


def verify_glb(path):
    """Round-trip reimport: world-space dims + triangle count from the file."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    dg = bpy.context.evaluated_depsgraph_get()
    bb_min = Vector((1e9,) * 3)
    bb_max = -bb_min
    tris = 0
    for o in new:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = o.matrix_world @ v.co
            bb_min = Vector(map(min, bb_min, w))
            bb_max = Vector(map(max, bb_max, w))
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    result = {"dims": tuple(round(v, 4) for v in (bb_max - bb_min)),
              "bbox_min": tuple(round(v, 4) for v in bb_min),
              "bbox_max": tuple(round(v, 4) for v in bb_max),
              "tris": tris,
              "mesh_objects": len([o for o in new if o.type == 'MESH'])}
    for o in list(new):
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    return result


# --------------------------------------------------------------------------
def main():
    global MATS, tgt_center
    sc = reset_scene()
    MATS = build_materials()
    col, root = make_collection()
    build_gun(col, root)

    bb_min, bb_max, tris = gun_bounds(col)
    print(f"[grapeshot] scene tris={tris} dims={bb_max - bb_min}")
    print(f"[grapeshot] bbox_min={tuple(round(v,4) for v in bb_min)} "
          f"bbox_max={tuple(round(v,4) for v in bb_max)}")

    size = export_glb(OUT_GLB)
    print(f"[grapeshot] exported {OUT_GLB} ({size} bytes)")
    print(f"[grapeshot] glb verify: {verify_glb(OUT_GLB)}")

    tgt_center = Vector((0, -0.134, 0.03))
    cam = setup_render(sc)
    stats = render_turntables(sc, cam, NOTES_DIR)
    for name, s in stats.items():
        print(f"[grapeshot] {name}: {s}")

    if size > 1024 * 1024:
        print("[grapeshot] FAIL: glb over 1 MB", file=sys.stderr)
        sys.exit(1)
    print("[grapeshot] OK")


main()
