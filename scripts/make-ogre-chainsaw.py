"""Build public/assets/lab/ogre-chainsaw.glb — the ogre's held chainsaw — in Blender.

    blender -b --factory-startup --python scripts/make-ogre-chainsaw.py

WHY A SCRIPT: same bargain as build-wam-kit.sh — an external tool, a committed
result, and a file recording exactly how one became the other. Re-run it after
changing a number; never hand-edit the .glb.

THE CONTRACT IT HAS TO MEET (carry.ts / held-prop.ts): a held prop is posed by
the soldier's carry machinery, which knows nothing about chainsaws. It seats
the prop's GRIP locator on the right hand and FABRIK-solves the left hand onto
its FORE locator, both in PROP-LOCAL coordinates shared by every prop:

    GUN_GRIP.gripHand = (0, -0.074, -0.074)   right hand -> REAR handle
    GUN_GRIP.foreHand = (0, -0.045,  0.155)   left hand  -> FRONT wrap handle
    prop-local +z = "muzzle" = the bar's direction, +y = up, +x = right

So the saw is laid out around those two points: the rear handle's grip rail
passes through gripHand, the front hoop passes through foreHand, the engine
sits between them and the bar runs out along +z. The profile's prop `scale`
(motion-profile.ts, 1.6) multiplies the mesh AND the locators, so everything
here is authored at 1/1.6 of its world size. He DRAGS it one-handed (the
`drag` carry), so only the grip locator is load-bearing; the fore locator
still sits on the hoop for a two-handed carry (`saw`, which needs <= 1.45 on
this rig for the left arm to reach it).

WORLD SIZE at scale 1.6: engine ~0.35 m long, bar ~0.80 m past the engine,
~1.33 m overall — long enough that, hanging from his fist at 1.04 m, the nose
trails to the floor. A big saw, sized for a 2.2 m brute (a logging saw on a man is
~0.9 m; this is the ogre's).

AXES: Blender is Z-up, glTF is Y-up; the exporter maps Blender (X, Y, Z) to
glTF (X, Z, -Y). Everything below is authored in PROP-LOCAL (x, y, z) and
converted by P() so the numbers match carry.ts one-for-one.
"""
from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "assets", "lab", "ogre-chainsaw.glb")

GRIP = (0.0, -0.074, -0.074)
FORE = (0.0, -0.045, 0.155)


def P(x: float, y: float, z: float) -> Vector:
    """Prop-local (x right, y up, z forward) -> Blender (X, Y, Z)."""
    return Vector((x, -z, y))


# --------------------------------------------------------------------------
# Scene + materials
# --------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name: str, rgb: tuple[float, float, float], metal: float, rough: float):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    return m


# Linear RGB. Chipped, oily RED housing — the one saturated thing on him, so
# the saw reads at distance against the brown leather and tan skin.
PAINT = material("saw_paint", (0.36, 0.045, 0.02), 0.15, 0.55)
# The guide bar: worn steel.
STEEL = material("saw_steel", (0.42, 0.43, 0.45), 0.85, 0.35)
# Chain, sprocket, cylinder fins: dark oily metal.
DARK = material("saw_dark", (0.05, 0.05, 0.055), 0.7, 0.45)
# Handles and pull-start grip: black rubber.
RUBBER = material("saw_rubber", (0.02, 0.02, 0.02), 0.0, 0.8)
# Dried blood crusted along the chain's lower run — he uses it.
BLOOD = material("saw_blood", (0.16, 0.01, 0.008), 0.1, 0.35)

objects: list[bpy.types.Object] = []


def finish(obj, mat, bevel: float = 0.0, segments: int = 2):
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    objects.append(obj)
    return obj


def box(name, centre, size, mat, bevel=0.004):
    """Axis-aligned box in prop-local coords: centre (x,y,z), size (sx,sy,sz)."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=P(*centre))
    o = bpy.context.object
    o.name = name
    # Prop (sx, sy, sz) -> Blender (X, Y, Z) = (sx, sz, sy)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bevel)


def cylinder(name, a, b, r, mat, verts=16, bevel=0.0):
    """Cylinder between two prop-local points."""
    va, vb = P(*a), P(*b)
    d = vb - va
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length,
                                        location=(va + vb) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(rotation=True)
    return finish(o, mat, bevel)


def tube(name, pts, r, mat, verts=10):
    """A round tube along a prop-local polyline, via a bevelled curve."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        v = P(*p)
        sp.points[i].co = (v.x, v.y, v.z, 1.0)
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    return finish(o, mat)


def rounded(pts, radius, n=4):
    """Round the corners of a polyline (fillet each interior vertex)."""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = (Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1]))
        a = (p0 - p1).normalized() * radius
        b = (p2 - p1).normalized() * radius
        for k in range(n + 1):
            t = k / n
            # quadratic Bezier through the corner
            q = (1 - t) ** 2 * (p1 + a) + 2 * (1 - t) * t * p1 + t ** 2 * (p1 + b)
            out.append(tuple(q))
    out.append(pts[-1])
    return out


def slab(name, outline_yz, thickness, x, mat, bevel=0.0):
    """Extrude a closed prop-local (y, z) outline along x — the bar plate."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(P(x - thickness / 2, y, z)) for (y, z) in outline_yz]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=Vector((thickness, 0, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return finish(o, mat, bevel)


# --------------------------------------------------------------------------
# ENGINE — the housing between the two hands. Its underside clears the rear
# grip rail (y -0.074) and its front clears the hoop (z 0.155).
# --------------------------------------------------------------------------
box("engine", (0.0, 0.010, 0.050), (0.110, 0.120, 0.180), PAINT, bevel=0.012)
# Top shroud: a slightly narrower hump, the silhouette's "saw" read in profile.
box("shroud", (0.0, 0.078, 0.040), (0.090, 0.040, 0.140), PAINT, bevel=0.012)
# Cylinder fins on top of the shroud, dark metal.
for i in range(5):
    box(f"fin{i}", (0.0, 0.104, -0.010 + i * 0.024), (0.070, 0.014, 0.008), DARK, bevel=0.002)
# Fuel cap (left) and oil cap (right).
cylinder("fuelcap", (-0.056, 0.030, -0.010), (-0.068, 0.030, -0.010), 0.016, RUBBER)
cylinder("oilcap", (0.056, 0.040, 0.100), (0.068, 0.040, 0.100), 0.013, RUBBER)
# Pull-start housing on the right side, with its T-handle.
cylinder("starter", (0.055, 0.010, 0.030), (0.078, 0.010, 0.030), 0.045, PAINT, verts=20, bevel=0.004)
cylinder("starterpull", (0.080, 0.050, 0.030), (0.092, 0.050, 0.030), 0.010, RUBBER)
box("starterT", (0.094, 0.050, 0.030), (0.010, 0.012, 0.040), RUBBER, bevel=0.003)
# Muffler on the front-left, dark and scorched.
box("muffler", (-0.050, -0.010, 0.128), (0.030, 0.050, 0.040), DARK, bevel=0.006)
# Sprocket cover on the right, front — where the bar bolts on.
box("clutchcover", (0.040, -0.010, 0.150), (0.040, 0.070, 0.080), PAINT, bevel=0.010)
cylinder("barnut1", (0.060, 0.000, 0.140), (0.068, 0.000, 0.140), 0.008, DARK)
cylinder("barnut2", (0.060, 0.000, 0.170), (0.068, 0.000, 0.170), 0.008, DARK)

# --------------------------------------------------------------------------
# REAR HANDLE — a closed loop behind the engine. Its lower rail runs along z
# THROUGH the grip locator: that rail is what the right fist closes on.
# --------------------------------------------------------------------------
gy, gz = GRIP[1], GRIP[2]
rear = [
    (0.0, 0.060, -0.030),
    (0.0, 0.060, -0.140),
    (0.0, gy, -0.140),
    (0.0, gy, -0.010),
    (0.0, -0.040, 0.000),
]
tube("rearhandle", rounded(rear, 0.030), 0.016, RUBBER)
# Trigger under the grip rail's front, a small dark tab.
box("trigger", (0.0, gy - 0.020, gz + 0.040), (0.012, 0.022, 0.020), DARK, bevel=0.003)

# --------------------------------------------------------------------------
# FRONT HOOP — the wrap handle the left hand takes. A U in the x-y plane at
# z = FORE.z, arching OVER the engine; its bottom run passes through the fore
# locator, so the left fist lands on the hoop itself.
# --------------------------------------------------------------------------
fy, fz = FORE[1], FORE[2]
hoop = [
    (0.070, fy, fz),
    (0.070, 0.120, fz),
    (-0.070, 0.120, fz),
    (-0.070, fy, fz),
    (0.020, fy, fz),
]
tube("hoop", rounded(hoop, 0.035), 0.014, RUBBER)
# Hand guard / chain brake: a flat plate in front of the hoop, top half.
box("handguard", (0.0, 0.080, fz + 0.030), (0.120, 0.070, 0.008), DARK, bevel=0.003)

# --------------------------------------------------------------------------
# GUIDE BAR + CHAIN — the length that makes it a chainsaw. Bar plate from the
# clutch cover out to z 0.64 (1.14 m world at scale 1.6 from the grip), a
# rounded nose; the chain is a slightly larger, darker outline behind it, and
# a row of teeth rides both edges.
# --------------------------------------------------------------------------
BAR_Y = -0.012        # bar centre height, level with the engine's lower third
BAR_H = 0.034         # half-height of the plate at the root
BAR_TIP_H = 0.024     # half-height at the nose
BAR_Z0, BAR_Z1 = 0.130, 0.640


def bar_outline(h0, h1, z0, z1, n=10):
    top = [(BAR_Y + h0 + (h1 - h0) * t, z0 + (z1 - z0) * t) for t in (0.0, 1.0)]
    nose = [(BAR_Y + h1 * math.cos(a), z1 + h1 * math.sin(a))
            for a in [math.pi / 2 - math.pi * k / n for k in range(1, n)]]
    bot = [(BAR_Y - h1, z1), (BAR_Y - h0, z0)]
    return top + nose + bot


slab("chain", bar_outline(BAR_H + 0.008, BAR_TIP_H + 0.008, BAR_Z0, BAR_Z1 + 0.004),
     0.012, 0.030, DARK)
slab("bar", bar_outline(BAR_H, BAR_TIP_H, BAR_Z0, BAR_Z1), 0.016, 0.030, STEEL, bevel=0.002)
# Teeth: small wedges along the top and bottom runs of the chain.
N_TEETH = 22
for i in range(N_TEETH):
    t = (i + 0.5) / N_TEETH
    z = BAR_Z0 + 0.02 + (BAR_Z1 - BAR_Z0 - 0.02) * t
    h = BAR_H + (BAR_TIP_H - BAR_H) * t + 0.010
    box(f"toothT{i}", (0.030, BAR_Y + h, z), (0.016, 0.008, 0.010), DARK, bevel=0.0)
    # The lower run is where the work happens: crusted, and every third tooth
    # is blood rather than steel.
    box(f"toothB{i}", (0.030, BAR_Y - h, z), (0.016, 0.008, 0.010),
        BLOOD if i % 3 == 0 else DARK, bevel=0.0)
# A smear of dried blood on the bar's lower half, both faces.
box("smearR", (0.039, BAR_Y - 0.012, 0.42), (0.002, 0.020, 0.26), BLOOD, bevel=0.0)
box("smearL", (0.021, BAR_Y - 0.010, 0.36), (0.002, 0.016, 0.20), BLOOD, bevel=0.0)

# --------------------------------------------------------------------------
# Locators — documentation for anyone opening the .glb: they mirror GUN_GRIP.
# The runtime does not read them (carry.ts's constants are the contract).
# --------------------------------------------------------------------------
for name, p in (("Grip_Hand", GRIP), ("Fore_Hand", FORE), ("Muzzle", (0.0, BAR_Y, BAR_Z1))):
    e = bpy.data.objects.new(name, None)
    e.location = P(*p)
    scene.collection.objects.link(e)
    objects.append(e)

# Join the meshes into one object (fewer draw calls for a prop the crowd may
# carry several of); keep the locators separate.
meshes = [o for o in objects if o.type == "MESH"]
for o in bpy.context.selected_objects:
    o.select_set(False)
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
saw = bpy.context.object
saw.name = "OgreChainsaw"
bpy.ops.object.shade_auto_smooth(angle=math.radians(40))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=True)
dims = saw.dimensions
print(f"wrote {OUT}")
print(f"prop-local size x{dims.x:.3f} y(up){dims.z:.3f} z(fwd){dims.y:.3f}; "
      f"world at scale 1.6: {dims.y * 1.6:.2f} m long")
