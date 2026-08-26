#!/usr/bin/env python3
"""Grapeshot shotgun — k3 rematch build. Procedural, deterministic, standalone.

Builds the lab's improvised pipe-gun and exports
public/assets/lab/grapeshot-gun-k3.glb plus review renders (turntable + FPV)
into docs/dev-notes/2026-08-25-grapeshot-model-k3/.

Run headless from the repo root:
    blender --background --python scripts/model_grapeshot_gun_k3.py

Design notes vs the glm bake-off winner (full writeup in the dev notes):
detail budget goes where a FIRST-PERSON camera actually looks — breech plugs
with firing pins, two bent-nail hammers, a screwed-down breech strap, a wire
running in the groove between the pipes, grip tape wraps — plus real pipe
wall thickness at the muzzles (open tubes, recessed bore bottoms, one
slanted hacksaw cut). Barrels are deliberately asymmetric (length, radius,
muzzle treatment). Everything else stays cheap.

Origin at the grip point, muzzle down -Y, GunRoot empty parents all parts —
same convention as model_grapeshot_gun_glm.py so the runtime can swap.
"""

import bpy
import bmesh
import math
import os
import random
import sys

from mathutils import Vector, Matrix

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
SEED = 20260825
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "grapeshot-gun-k3.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-08-25-grapeshot-model-k3")

# Authored in "natural" coordinates (plank centerline z=0..0.045, muzzle at
# Y≈-0.44), then the whole gun shifts so the GRIP CENTER is the world origin.
GRIP_NATURAL = Vector((0.0, 0.075, -0.062))

rng = random.Random(SEED)


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
        "Wood":      M("Wood",      (0.120, 0.072, 0.038, 1.0), 0.0, 0.90),
        "Steel":     M("Steel",     (0.045, 0.048, 0.055, 1.0), 1.0, 0.50),
        "SteelWorn": M("SteelWorn", (0.095, 0.090, 0.082, 1.0), 0.9, 0.55),
        "Tape":      M("Tape",      (0.030, 0.030, 0.033, 1.0), 0.0, 0.92),
        "TapeCloth": M("TapeCloth", (0.160, 0.125, 0.075, 1.0), 0.0, 0.95),
        "Bore":      M("BoreIn",    (0.008, 0.008, 0.010, 1.0), 0.0, 0.95),
        "Igniter":   M("Igniter",   (0.100, 0.050, 0.045, 1.0), 0.0, 0.60),
        "WireRubber": M("WireRubber", (0.040, 0.036, 0.032, 1.0), 0.0, 0.85),
        "WireCloth":  M("WireCloth",  (0.340, 0.280, 0.190, 1.0), 0.0, 0.90),
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


def add_obj(name, mesh, col, root, mat, loc=(0, 0, 0), rot=(0, 0, 0),
            bevel=None, smooth=False):
    o = bpy.data.objects.new(name, mesh)
    link(o, col, root)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, mat, smooth=smooth, bevel=bevel)


def box_mesh(name, sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def add_box(name, sx, sy, sz, col, root, mat="Wood", loc=(0, 0, 0), rot=(0, 0, 0),
            bevel=None, smooth=False, mesh=None):
    return add_obj(name, mesh or box_mesh(name, sx, sy, sz), col, root, mat,
                   loc=loc, rot=rot, bevel=bevel, smooth=smooth)


def add_cyl(name, r, depth, segs, col, root, mat="Steel", loc=(0, 0, 0),
            axis_y=True, smooth=True, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r, radius2=r, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    rot = (math.pi / 2, 0, 0) if axis_y else (0, 0, 0)
    return add_obj(name, me, col, root, mat, loc=loc, rot=rot, smooth=smooth)


def tube_mesh(name, r_out, r_in, depth, segs, cut_skew=0.0):
    """Open tube along local Z: outer+inner walls, front/back annulus rings.

    cut_skew slants the front (-Z) face like a hacksaw cut: the front rim
    shifts along the axis by cut_skew * sin(theta).
    Faces ordered: outer wall, inner wall (both smooth), then annuli (flat).
    """
    verts = []
    hf = -depth / 2.0  # front (muzzle)
    hb = depth / 2.0   # back (breech)
    rings = []
    for r, z, skew in ((r_out, hf, cut_skew), (r_out, hb, 0.0),
                       (r_in, hf, cut_skew), (r_in, hb, 0.0)):
        ring = []
        for i in range(segs):
            th = 2.0 * math.pi * i / segs
            ring.append(len(verts))
            verts.append((r * math.cos(th), r * math.sin(th),
                          z + skew * math.sin(th)))
        rings.append(ring)
    of, ob, inf, inb = rings
    faces = []
    n_smooth = 0
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((of[i], ob[i], ob[j], of[j]))      # outer wall
        n_smooth += 1
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((inf[i], inf[j], inb[j], inb[i]))  # inner wall
        n_smooth += 1
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((of[i], of[j], inf[j], inf[i]))    # front annulus
        faces.append((ob[i], inb[i], inb[j], ob[j]))    # back annulus
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for k, p in enumerate(me.polygons):
        p.use_smooth = k < n_smooth
    return me


def disc_mesh(name, r, z, segs):
    """Flat filled disc at local depth z, normal +Z (a dark bore bottom)."""
    verts = [(0.0, 0.0, z)]
    for i in range(segs):
        th = 2.0 * math.pi * i / segs
        verts.append((r * math.cos(th), r * math.sin(th), z))
    faces = []
    for i in range(segs):
        faces.append((0, 1 + i, 1 + (i + 1) % segs))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def tape_band_mesh(name, sx, sy, sz, pinch=0.93, jitter=0.0012):
    """Chunky tape wrap: box with pulled-in end faces + slight hand jitter."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    for v in bm.verts:
        if abs(v.co.y) > sy * 0.49:
            v.co.x *= pinch
            v.co.z *= pinch
        v.co.x += rng.uniform(-jitter, jitter)
        v.co.z += rng.uniform(-jitter, jitter)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def add_wire(name, mat_name, pts, radius, col, root, resolution=3):
    cu = bpy.data.curves.new(name, type='CURVE')
    cu.dimensions = '3D'
    cu.fill_mode = 'FULL'
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu)
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
    return o


# --------------------------------------------------------------------------
# Parts
# --------------------------------------------------------------------------
# Pipe layout constants (natural coords)
PIPE_L = dict(x=-0.0205, r=0.0190, z=0.0640, y_front=-0.4350, y_back=0.040)
PIPE_R = dict(x=+0.0215, r=0.0200, z=0.0650, y_front=-0.4200, y_back=0.050)


def build_gun(col, root):
    # ---- plank stock: boxy, tapered, hand-cut jitter, beveled edges ----
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    yedges = [e for e in bm.edges if abs((e.verts[1].co - e.verts[0].co).y) > 0.5]
    bmesh.ops.subdivide_edges(bm, edges=yedges, use_grid_fill=True, cuts=3)
    bmesh.ops.scale(bm, vec=(0.084, 0.52, 0.045), verts=bm.verts)
    for v in bm.verts:
        t = -v.co.y / 0.26  # 0 at rear, 1 at muzzle end
        v.co.x *= (1.0 - 0.10 * t)
        v.co.x += rng.uniform(-0.004, 0.004)
        v.co.z += rng.uniform(-0.003, 0.003)
        if v.co.z > 0:
            v.co.z *= (1.0 + 0.06 * rng.uniform(0, 1))
    plank_mesh = bpy.data.meshes.new("plank")
    bm.to_mesh(plank_mesh)
    bm.free()
    add_box("Plank", 0, 0, 0, col, root, mat="Wood", loc=(0, -0.12, 0.0225),
            mesh=plank_mesh, bevel=0.005)

    # ---- twin pipes: REAL open tubes with wall thickness, asymmetric ----
    for tag, P, skew in (("L", PIPE_L, 0.0045), ("R", PIPE_R, 0.0)):
        depth = P["y_back"] - P["y_front"]
        yc = (P["y_back"] + P["y_front"]) / 2.0
        me = tube_mesh(f"Pipe{tag}", P["r"], P["r"] - 0.0045, depth, 18,
                       cut_skew=skew)
        po = add_obj(f"Pipe{tag}", me, col, root, "Steel", loc=(P["x"], yc, P["z"]),
                     rot=(math.pi / 2, 0, 0))
        # inner walls go near-black so the bores read deep, not disc-flat
        po.data.materials.append(MATS["Bore"])
        for k, p in enumerate(po.data.polygons):
            if 18 <= k < 36:  # inner-wall quads (see tube_mesh face order)
                p.material_index = 1
        # recessed dark bore bottom, 55 mm inside the muzzle
        bme = disc_mesh(f"Bore{tag}", P["r"] - 0.0048, -depth / 2.0 + 0.055, 14)
        add_obj(f"Bore{tag}", bme, col, root, "Bore",
                loc=(P["x"], yc, P["z"]), rot=(math.pi / 2, 0, 0))
        # welded breech plug capping the rear + a firing-pin dot
        add_cyl(f"Plug{tag}", P["r"] - 0.0015, 0.004, 14, col, root, "SteelWorn",
                loc=(P["x"], P["y_back"] + 0.001, P["z"]))
        add_cyl(f"Pin{tag}", 0.0026, 0.005, 8, col, root, "SteelWorn",
                loc=(P["x"], P["y_back"] + 0.004, P["z"]))

    # ---- breech strap: bent sheet steel screwed down over the pipe rears ----
    add_box("BreechStrap", 0.098, 0.052, 0.007, col, root, "SteelWorn",
            loc=(0, 0.045, 0.0885), rot=(0, math.radians(1.5), math.radians(-1.0)),
            bevel=0.002)
    screw_at = [(-0.037, 0.028), (0.0375, 0.031), (-0.036, 0.063), (0.038, 0.060)]
    for i, (sx, sy) in enumerate(screw_at):
        add_cyl(f"Screw{i}", 0.0042, 0.0045, 8, col, root, "SteelWorn",
                loc=(sx, sy, 0.092), axis_y=False, smooth=False)
        bpy.context.view_layer.objects.active = bpy.data.objects[f"Screw{i}"]
        o = bpy.data.objects[f"Screw{i}"]
        o.rotation_euler = (rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0)

    # ---- hammers: solid bent strikers behind the breech, asymmetric ----
    # Left sits tall (half-cocked), right reclines. Post + arm + knob, all
    # connected, mounted on the plank top just behind the breech strap.
    add_box("HammerPostL", 0.013, 0.016, 0.034, col, root, "SteelWorn",
            loc=(-0.019, 0.082, 0.058), rot=(math.radians(-6), 0, 0), bevel=0.002)
    add_box("HammerArmL", 0.011, 0.014, 0.042, col, root, "SteelWorn",
            loc=(-0.021, 0.096, 0.088), rot=(math.radians(-28), 0, 0), bevel=0.002)
    add_box("HammerKnobL", 0.020, 0.016, 0.018, col, root, "SteelWorn",
            loc=(-0.022, 0.105, 0.106), rot=(math.radians(-28), 0, math.radians(-4)),
            bevel=0.004)
    add_box("HammerPostR", 0.012, 0.015, 0.028, col, root, "SteelWorn",
            loc=(0.022, 0.086, 0.056), rot=(math.radians(-10), 0, 0), bevel=0.002)
    add_box("HammerArmR", 0.010, 0.013, 0.036, col, root, "SteelWorn",
            loc=(0.026, 0.098, 0.078), rot=(math.radians(-42), 0, math.radians(6)),
            bevel=0.002)
    add_box("HammerKnobR", 0.018, 0.014, 0.015, col, root, "SteelWorn",
            loc=(0.029, 0.108, 0.090), rot=(math.radians(-42), 0, math.radians(10)),
            bevel=0.0035)

    # ---- tape bands: 3 wrapping plank+pipes (middle one is cloth tape) ----
    bands = [
        ("BandRear",  "TapeCloth", 0.104, 0.022, 0.108, (0, -0.052, 0.0435), 2.0, -1.0),
        ("BandMid",   "Tape",      0.103, 0.034, 0.107, (0, -0.185, 0.0435), 2.5, 0.0),
        ("BandFront", "Tape",      0.097, 0.030, 0.103, (0, -0.335, 0.0425), -3.0, 1.5),
    ]
    for name, mat, sx, sy, sz, loc, ry, rx in bands:
        me = tape_band_mesh(name, sx, sy, sz)
        add_box(name, 0, 0, 0, col, root, mat=mat, loc=loc,
                rot=(math.radians(rx), math.radians(ry), 0), mesh=me, bevel=0.002)

    # ---- muzzle treatment: L taped, R bare with a hose clamp ----
    me = tape_band_mesh("MuzzTapeL", 0.048, 0.034, 0.048)
    add_box("MuzzTapeL", 0, 0, 0, col, root, mat="Tape",
            loc=(PIPE_L["x"], -0.405, PIPE_L["z"]),
            rot=(0, math.radians(3.5), 0), mesh=me, bevel=0.002)
    add_box("ClampR", 0.046, 0.014, 0.046, col, root, "SteelWorn",
            loc=(PIPE_R["x"], -0.385, PIPE_R["z"]),
            rot=(0, math.radians(-2.0), 0), bevel=0.0015)
    add_box("ClampScrew", 0.010, 0.010, 0.012, col, root, "SteelWorn",
            loc=(PIPE_R["x"] + 0.024, -0.385, PIPE_R["z"] + 0.010),
            rot=(0, 0, math.radians(10)))

    # ---- front sight: bent nail on the longer (left) pipe only ----
    add_wire("SightNail", "SteelWorn",
             [(PIPE_L["x"], -0.398, PIPE_L["z"] + PIPE_L["r"] - 0.002),
              (PIPE_L["x"] - 0.001, -0.400, PIPE_L["z"] + PIPE_L["r"] + 0.012),
              (PIPE_L["x"] - 0.003, -0.404, PIPE_L["z"] + PIPE_L["r"] + 0.017)],
             0.0028, col, root)

    # ---- grip (leans back 18 deg) with crooked tape wraps + twine ----
    grip_rot = math.radians(-18)
    R = Matrix.Rotation(grip_rot, 4, 'X')
    grip_loc = Vector((0, 0.075, -0.062))
    add_box("Grip", 0.036, 0.092, 0.14, col, root, "Wood",
            loc=grip_loc, rot=(grip_rot, 0, 0), bevel=0.006)
    for i, zoff in enumerate((-0.050, -0.020, 0.010, 0.040)):
        off = R @ Vector((0, 0, zoff))
        me = tape_band_mesh(f"GripWrap{i}", 0.0405, 0.0965, 0.030,
                            pinch=0.95, jitter=0.0009)
        add_box(f"GripWrap{i}", 0, 0, 0, col, root, mat="Tape",
                loc=grip_loc + off,
                rot=(grip_rot + math.radians(rng.uniform(-2.0, 2.0)), 0,
                     math.radians(rng.uniform(-1.5, 1.5))),
                mesh=me, bevel=0.0015)
    off = R @ Vector((0, 0, 0.062))
    me = tape_band_mesh("TwineTop", 0.040, 0.096, 0.014, pinch=0.96)
    add_box("TwineTop", 0, 0, 0, col, root, mat="TapeCloth",
            loc=grip_loc + off, rot=(grip_rot + math.radians(3), 0, 0), mesh=me)

    # ---- butt stock + taped butt plate (cheap: barely visible in FPV) ----
    add_box("Stock", 0.072, 0.175, 0.05, col, root, "Wood",
            loc=(0, 0.225, 0.014), rot=(math.radians(6), 0, 0), bevel=0.005)
    add_box("ButtPlate", 0.080, 0.012, 0.062, col, root, "Tape",
            loc=(0, 0.316, 0.008), rot=(math.radians(6), 0, 0))

    # ---- trigger loop: small, dark, bent-metal ring + blade ----
    bpy.ops.mesh.primitive_torus_add(major_radius=0.024, minor_radius=0.0042,
                                     major_segments=12, minor_segments=6,
                                     location=(0, -0.005, -0.028),
                                     rotation=(0, math.radians(90), math.radians(4)))
    loop = bpy.context.active_object
    loop.name = "TriggerLoop"
    for c in loop.users_collection:
        c.objects.unlink(loop)
    col.objects.link(loop)
    loop.parent = root
    finish(loop, "Steel", smooth=True)
    add_box("TriggerBlade", 0.010, 0.014, 0.034, col, root, "Steel",
            loc=(0, -0.004, -0.024), rot=(math.radians(-14), 0, 0))

    # ---- igniter block taped under the plank, ahead of the trigger ----
    add_box("IgniterBlock", 0.034, 0.052, 0.026, col, root, "Igniter",
            loc=(0, -0.125, -0.015), rot=(0, math.radians(2), 0), bevel=0.003)
    me = tape_band_mesh("BandIgn", 0.052, 0.030, 0.076)
    add_box("BandIgn", 0, 0, 0, col, root, mat="Tape",
            loc=(0, -0.125, 0.0105), rot=(0, math.radians(3.0), 0), mesh=me)

    # ---- wires: one runs TOP in the pipe groove (the FPV-visible one),
    #      two along the plank sides to the breech, one to the trigger ----
    add_wire("WireTop", "WireCloth",
             [(-0.008, -0.108, -0.018), (-0.004, -0.100, 0.030),
              (0.000, -0.060, 0.055), (0.001, -0.010, 0.058),
              (0.004, 0.030, 0.063), (0.006, 0.043, 0.081)],
             0.0038, col, root)
    add_wire("WireSideL", "WireRubber",
             [(-0.012, -0.099, -0.020), (-0.030, -0.060, -0.012),
              (-0.036, -0.005, 0.028), (-0.016, 0.030, 0.052), (-0.009, 0.038, 0.060)],
             0.0040, col, root)
    add_wire("WireSideR", "WireCloth",
             [(0.012, -0.099, -0.020), (0.033, -0.055, -0.008),
              (0.038, 0.000, 0.030), (0.018, 0.032, 0.055), (0.009, 0.038, 0.062)],
             0.0040, col, root)
    add_wire("WireTrig", "WireCloth",
             [(0.013, -0.105, -0.016), (0.030, -0.070, 0.002),
              (0.026, -0.030, -0.014), (0.010, -0.018, -0.026)],
             0.0035, col, root)

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
# Review renders (turntable + FPV)
# --------------------------------------------------------------------------
def setup_render(sc):
    world = bpy.data.worlds.new("ReviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.055, 0.06, 0.07, 1.0)
    bg.inputs[1].default_value = 1.0
    sc.world = world

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
    tr = cam.constraints.new('TRACK_TO')
    tr.target = tgt
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 512
    sc.render.resolution_y = 512
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    return cam, cam_data, tgt


TURN_TGT = Vector((0, -0.134, 0.03))
TURN_VIEWS = {
    "turntable_front":        Vector((0.0, -1.35, 0.12)),
    "turntable_back":         Vector((0.0, 1.35, 0.12)),
    "turntable_left":         Vector((1.35, -0.134, 0.12)),
    "turntable_threequarter": Vector((0.78, -0.95, 0.38)),
    "turntable_top":          Vector((0.05, -0.20, 1.35)),
}
FPV_CAM = Vector((0.16, 0.30, 0.22))
FPV_TGT = Vector((-0.03, -0.65, 0.01))


def render_views(sc, cam, cam_data, tgt, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, offset in TURN_VIEWS.items():
        cam_data.lens = 55
        cam.location = TURN_TGT + offset
        tgt.location = TURN_TGT
        bpy.context.view_layer.update()
        sc.render.filepath = os.path.join(out_dir, name + ".png")
        bpy.ops.render.render(write_still=True)
    cam_data.lens = 30
    cam.location = FPV_CAM
    tgt.location = FPV_TGT
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(out_dir, "fpv.png")
    bpy.ops.render.render(write_still=True)


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
    global MATS
    sc = reset_scene()
    MATS = build_materials()
    col, root = make_collection()
    build_gun(col, root)

    bb_min, bb_max, tris = gun_bounds(col)
    print(f"[grapeshot-k3] scene tris={tris} dims={bb_max - bb_min}")
    print(f"[grapeshot-k3] bbox_min={tuple(round(v,4) for v in bb_min)} "
          f"bbox_max={tuple(round(v,4) for v in bb_max)}")

    size = export_glb(OUT_GLB)
    print(f"[grapeshot-k3] exported {OUT_GLB} ({size} bytes)")
    print(f"[grapeshot-k3] glb verify: {verify_glb(OUT_GLB)}")

    cam, cam_data, tgt = setup_render(sc)
    render_views(sc, cam, cam_data, tgt, NOTES_DIR)

    ok = True
    if size > 1024 * 1024:
        print("[grapeshot-k3] FAIL: glb over 1 MB", file=sys.stderr)
        ok = False
    if tris > 8000:
        print(f"[grapeshot-k3] FAIL: {tris} tris over 8000", file=sys.stderr)
        ok = False
    if not ok:
        sys.exit(1)
    print("[grapeshot-k3] OK")


main()
