# scripts/levels/build_train_kit.py
"""The train carriage kit (spec docs/superpowers/specs/2026-09-25-train-carriage-kit-design.md §3).

    blender --background --factory-startup --python scripts/levels/build_train_kit.py \
        [-- --width 3.0 --ceilings 2.6,3.2 --out PATH --renders DIR]

Writes assets-source/levels/kit.blend (one collection per kit piece) and the baked textures in
assets-source/levels/kit-textures/. Levels link the pieces (collection instances); the level
exporter turns repeated pieces into GPU instances.

Units are game metres. Every piece is modelled in GAME space (x, y, z), y up, the carriage
along -z, and converted with g() to Blender (x, -z, y). A bay spans z in [-1.9, 0] and a
carriage is x in [-1.5, 1.5]; wall pieces are the WEST wall (x = -1.5), the east side is the
same piece rotated 180 degrees (the build script does that). One material per object, so the
exporter can join single-use pieces.
"""
import math
import os
import sys

import bmesh
import bpy
import mathutils

ROOT = os.path.abspath("assets-source/levels")
TEX = os.path.join(ROOT, "kit-textures")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


OUT = os.path.abspath(arg("--out", os.path.join(ROOT, "kit.blend")))
BAY = 1.9
W = float(arg("--width", "3.0")) / 2          # half the carriage's inside width
CEILINGS = [float(c) for c in arg("--ceilings", "2.6,3.2").split(",")]
DADO = 0.95
WALL_TOP = 2.2


def g(x, y, z):
    return (x, -z, y)


# ---- materials ---------------------------------------------------------------------------

def node_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links


def procedural(kind, nodes, links):
    """The procedural colour for a baked material: returns the output socket."""
    tc = nodes.new("ShaderNodeTexCoord")
    ramp = nodes.new("ShaderNodeValToRGB")
    el = ramp.color_ramp.elements

    def stops(*cols):
        el[0].color = (*cols[0], 1)
        el[1].color = (*cols[-1], 1)
        for i, c in enumerate(cols[1:-1], start=1):
            e = el.new(i / (len(cols) - 1))
            e.color = (*c, 1)

    if kind == "wood":
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "X"
        wave.inputs["Scale"].default_value = 2.0
        wave.inputs["Distortion"].default_value = 4.0
        wave.inputs["Detail"].default_value = 2.0
        links.new(tc.outputs["UV"], wave.inputs["Vector"])
        links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        # Low contrast: polished dark wood, not zebra stripes (first render, 2026-09-25).
        stops((0.055, 0.030, 0.017), (0.075, 0.042, 0.024), (0.095, 0.054, 0.031))
    elif kind == "panel":
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 4.0
        noise.inputs["Detail"].default_value = 8.0
        links.new(tc.outputs["UV"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        stops((0.30, 0.24, 0.16), (0.55, 0.47, 0.34), (0.62, 0.55, 0.42))
    elif kind == "brass":
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 12.0
        links.new(tc.outputs["UV"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        stops((0.45, 0.30, 0.08), (0.78, 0.58, 0.22))
    elif kind == "runner":
        checker = nodes.new("ShaderNodeTexChecker")
        checker.inputs["Scale"].default_value = 8.0
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "RINGS"
        wave.inputs["Scale"].default_value = 6.0
        mix = nodes.new("ShaderNodeMath")
        mix.operation = "MULTIPLY"
        links.new(tc.outputs["UV"], checker.inputs["Vector"])
        links.new(tc.outputs["UV"], wave.inputs["Vector"])
        links.new(checker.outputs["Fac"], mix.inputs[0])
        links.new(wave.outputs["Fac"], mix.inputs[1])
        links.new(mix.outputs["Value"], ramp.inputs["Fac"])
        stops((0.02, 0.03, 0.07), (0.05, 0.07, 0.15), (0.40, 0.30, 0.10))
    elif kind == "velvet":
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 18.0
        links.new(tc.outputs["UV"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        stops((0.16, 0.012, 0.02), (0.36, 0.03, 0.05))
    elif kind == "iron":
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 9.0
        noise.inputs["Detail"].default_value = 6.0
        links.new(tc.outputs["UV"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        stops((0.025, 0.024, 0.026), (0.07, 0.065, 0.06))
    return ramp.outputs["Color"]


BAKED = {  # name: (procedural kind, size px, metallic, roughness)
    "train.wood-dark": ("wood", 1024, 0.0, 0.55),
    "train.panel": ("panel", 1024, 0.0, 0.8),
    "train.brass": ("brass", 512, 1.0, 0.35),
    "train.runner": ("runner", 1024, 0.0, 0.95),
    "train.velvet": ("velvet", 512, 0.0, 0.9),
    "train.iron": ("iron", 512, 0.7, 0.6),
}


def bake_textures():
    """Bake each procedural colour to a PNG through an EMIT bake on a UV'd 1 x 1 plane."""
    os.makedirs(TEX, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    paths = {}
    for name, (kind, size, _, _) in BAKED.items():
        m, nodes, links = node_material(f"bake:{name}")
        nodes.remove(nodes["Principled BSDF"])
        emit = nodes.new("ShaderNodeEmission")
        links.new(procedural(kind, nodes, links), emit.inputs["Color"])
        links.new(emit.outputs["Emission"], nodes["Material Output"].inputs["Surface"])
        img = bpy.data.images.new(f"{name}.png", size, size)
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        nodes.active = tex
        plane.data.materials.clear()
        plane.data.materials.append(m)
        bpy.ops.object.bake(type="EMIT", margin=0)
        path = os.path.join(TEX, f"{name.split('.', 1)[1]}.png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        paths[name] = path
        bpy.data.images.remove(img)
    bpy.data.objects.remove(plane)
    return paths


def final_materials(paths):
    mats = {}
    for name, (_, _, metal, rough) in BAKED.items():
        m, nodes, links = node_material(name)
        bsdf = nodes["Principled BSDF"]
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(paths[name])
        # Relative to where the kit is SAVED (--out may be outside assets-source/levels).
        tex.image.filepath = bpy.path.relpath(paths[name], start=os.path.dirname(OUT))
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        mats[name] = m
    for name, rgb in (("train.lamp", (1.0, 0.8, 0.55)), ("train.firebox", (1.0, 0.45, 0.12))):
        m, nodes, _ = node_material(name)
        bsdf = nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
        mats[name] = m
    m, nodes, _ = node_material("window:night")  # the game replaces this with the scenery shader
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    mats["window:night"] = m
    return mats


# ---- geometry ----------------------------------------------------------------------------

class Piece:
    """One kit piece: a bmesh per material; finish() makes one object per material."""

    def __init__(self, name, sway=None):
        self.name, self.sway, self.parts = name, sway, {}

    def bm(self, mat):
        return self.parts.setdefault(mat, bmesh.new())

    def quad(self, mat, pts):
        """pts: four game-space corners, counter-clockwise seen from the side the face faces."""
        b = self.bm(mat)
        f = b.faces.new([b.verts.new(g(*p)) for p in pts])
        return f

    def box(self, mat, lo, hi):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
        for ids in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)):
            self.quad(mat, [c[i] for i in ids])

    def wall_x(self, mat, x, facing, z0, z1, y0, y1):
        """A quad in the plane x = const, facing +x (facing=1) or -x."""
        pts = [(x, y0, z1), (x, y0, z0), (x, y1, z0), (x, y1, z1)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def wall_z(self, mat, z, facing, x0, x1, y0, y1):
        """A quad in the plane z = const, facing +z (facing=1) or -z."""
        pts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def floor(self, mat, y, facing, x0, x1, z0, z1):
        pts = [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def finish(self, mats):
        coll = bpy.data.collections.new(self.name)
        bpy.context.scene.collection.children.link(coll)
        for mat, b in self.parts.items():
            uv = b.loops.layers.uv.new("UVMap")
            for f in b.faces:
                n = f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                for loop in f.loops:
                    co = loop.vert.co
                    u, v = [(co[1], co[2]), (co[0], co[2]), (co[0], co[1])][ax]
                    loop[uv].uv = (u, v)
            me = bpy.data.meshes.new(f"{self.name}.{mat.split('.')[-1].split(':')[-1]}")
            b.to_mesh(me)
            b.free()
            me.materials.append(mats[mat])
            ob = bpy.data.objects.new(me.name, me)
            if self.sway:
                ob["sway"] = self.sway
            coll.objects.link(ob)
        return coll


def wall_bay(kind, top=WALL_TOP):
    """kind: 'window' | 'plain' | 'door'. West wall of one bay."""
    p = Piece(f"bay-wall-{kind}")
    x = -W
    p.box("train.wood-dark", (x, 0, -BAY), (x + 0.04, DADO, 0))                  # dado
    p.box("train.wood-dark", (x, DADO, -BAY), (x + 0.06, DADO + 0.06, 0))         # cap rail
    y0 = DADO + 0.06
    if kind == "window":
        wz0, wz1, wy0, wy1 = -1.5, -0.4, 1.05, 1.85
        p.wall_x("train.panel", x, 1, -BAY, 0, y0, wy0)
        p.wall_x("train.panel", x, 1, -BAY, 0, wy1, top)
        p.wall_x("train.panel", x, 1, -BAY, wz0, wy0, wy1)
        p.wall_x("train.panel", x, 1, wz1, 0, wy0, wy1)
        f = 0.05
        p.box("train.brass", (x, wy0 - f, wz0 - f), (x + 0.03, wy0, wz1 + f))
        p.box("train.brass", (x, wy1, wz0 - f), (x + 0.03, wy1 + f, wz1 + f))
        p.box("train.brass", (x, wy0, wz0 - f), (x + 0.03, wy1, wz0))
        p.box("train.brass", (x, wy0, wz1), (x + 0.03, wy1, wz1 + f))
        p.wall_x("window:night", x - 0.03, 1, wz0, wz1, wy0, wy1)                 # the glass
        p.box("train.brass", (x + 0.04, 1.02, -BAY), (x + 0.065, 1.045, 0))       # handrail
    else:
        p.wall_x("train.panel", x, 1, -BAY, 0, y0, top)
    if kind == "door":
        p.box("train.wood-dark", (x, 0.02, -1.35), (x + 0.03, 2.02, -0.55))
        p.box("train.brass", (x + 0.03, 1.0, -0.68), (x + 0.07, 1.04, -0.62))
    return p


def pillar():
    p = Piece("bay-pillar")
    p.box("train.wood-dark", (-W, 0, -0.06), (-W + 0.08, WALL_TOP, 0.06))
    return p


CEIL_PROFILE = [(-1.5, 0.0), (-1.45, 0.15), (-1.35, 0.25), (-1.2, 0.32), (-1.0, 0.35), (-0.6, 0.35),
                (-0.6, 0.4), (0.6, 0.4), (0.6, 0.35), (1.0, 0.35), (1.2, 0.32), (1.35, 0.25), (1.45, 0.15), (1.5, 0.0)]


def ceiling_bay(height):
    """Wall panel above 2.2 m up to the cove, the curved ceiling and clerestory, brackets, lamp."""
    p = Piece(f"bay-ceiling-{int(round(height * 10))}")
    base = height - 0.4     # the cove starts 0.4 m below the ceiling's peak
    for side in (-1, 1):
        if base > WALL_TOP + 1e-3:
            p.wall_x("train.panel", side * W, -side, -BAY, 0, WALL_TOP, base)
    prof = [(x * W / 1.5, y) for x, y in CEIL_PROFILE]  # the profile is drawn for 3.0 m; scale it
    for (xa, ya), (xb, yb) in zip(prof, prof[1:]):
        # A strip across the bay, facing down/inward (wound so the normal points into the carriage).
        pts = [(xa, base + ya, 0), (xb, base + yb, 0), (xb, base + yb, -BAY), (xa, base + ya, -BAY)]
        p.quad("train.panel", pts)
    for sx in (-0.6, 0.6):
        p.box("train.brass", (sx - 0.015, base + 0.33, -BAY), (sx + 0.015, base + 0.36, 0))
    for side in (-1, 1):
        for bz in (-0.2, -1.7):
            x0, x1 = sorted((side * W, side * (W - 0.22)))
            p.box("train.wood-dark", (x0, base - 0.02, bz - 0.02), (x1, base + 0.14, bz + 0.02))
    r, n, y = 0.15, 10, base + 0.36
    lamp = p.bm("train.lamp")
    ring = [lamp.verts.new(g(r * math.cos(2 * math.pi * i / n), y, -BAY / 2 + r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    lamp.faces.new(ring)
    return p


def floor_bay(runner):
    p = Piece("bay-floor-runner" if runner else "bay-floor-planks")
    p.floor("train.wood-dark", 0, 1, -W, W, -BAY, 0)
    if runner:
        p.floor("train.runner", 0.005, 1, -0.6, 0.6, -BAY, 0)
    return p


def end_wall(height):
    """At a carriage's SOUTH end (z = 0), facing north (-z), with a 1.4 m door opening."""
    p = Piece("end-wall-door" if abs(height - 2.6) < 1e-3 else f"end-wall-door-{int(round(height * 10))}")
    dx, dh = 0.7, 2.1
    for x0, x1 in ((-W, -dx), (dx, W)):
        p.wall_z("train.wood-dark", 0, -1, x0, x1, 0, DADO)
        p.wall_z("train.panel", 0, -1, x0, x1, DADO, height)
    p.wall_z("train.panel", 0, -1, -dx, dx, dh, height)
    p.box("train.wood-dark", (-dx - 0.08, 0, -0.05), (-dx, dh + 0.08, 0))
    p.box("train.wood-dark", (dx, 0, -0.05), (dx + 0.08, dh + 0.08, 0))
    p.box("train.wood-dark", (-dx, dh, -0.05), (dx, dh + 0.08, 0))
    return p


def vestibule():
    """1.2 m connector spanning z in [-1.2, 0], 1.4 m wide."""
    p = Piece("vestibule")
    L, h = 1.2, 2.1
    p.floor("train.iron", 0, 1, -0.7, 0.7, -L, 0)
    p.floor("train.iron", h, -1, -0.7, 0.7, -L, 0)
    p.wall_x("train.iron", -0.7, 1, -L, 0, 0, h)
    p.wall_x("train.iron", 0.7, -1, -L, 0, 0, h)
    for i in range(1, 6):
        z = -L * i / 6
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 0.7, sx * 0.66))
            p.box("train.iron", (x0, 0, z - 0.02), (x1, h, z + 0.02))
    return p


def lamp_hanging():
    p = Piece("lamp-hanging", sway="lamp")
    p.box("train.brass", (-0.012, -0.4, -0.012), (0.012, 0, 0.012))
    p.box("train.lamp", (-0.15, -0.55, -0.15), (0.15, -0.4, 0.15))
    return p


def curtain():
    p = Piece("curtain", sway="curtain")
    for z0, z1 in ((-0.35, 0.0), (-1.1, -0.75)):
        p.box("train.velvet", (0.05, -0.75, z0), (0.07, 0.0, z1))
    return p


def seat_bench():
    p = Piece("seat-bench")
    p.box("train.wood-dark", (0, 0, -0.9), (0.6, 0.25, 0))
    p.box("train.velvet", (0, 0.25, -0.9), (0.6, 0.45, 0))
    p.box("train.velvet", (0, 0.45, -0.9), (0.12, 1.1, 0))
    return p


def luggage_rack():
    p = Piece("luggage-rack")
    p.box("train.wood-dark", (0, 1.88, -BAY), (0.4, 1.92, 0))
    p.box("train.brass", (0.37, 1.92, -BAY), (0.4, 2.0, 0))
    for z in (-0.1, -1.8):
        p.box("train.brass", (0, 1.7, z - 0.015), (0.4, 1.88, z + 0.015))
    return p


def trunk():
    p = Piece("trunk")
    p.box("train.wood-dark", (-0.25, 0, -0.45), (0.25, 0.5, 0.45))
    for z in (-0.3, 0.3):
        p.box("train.brass", (-0.26, 0, z - 0.03), (0.26, 0.51, z + 0.03))
    return p


def coffin():
    p = Piece("coffin")
    b = p.bm("train.wood-dark")
    # Tapered: 0.6 m wide at the shoulders (z = -0.5), 0.4 m at the feet (z = 1.0) and head (z = -1.0).
    ring = [(-0.2, -1.0), (0.2, -1.0), (0.3, -0.5), (0.2, 1.0), (-0.2, 1.0), (-0.3, -0.5)]
    lo = [b.verts.new(g(x, 0, z)) for x, z in ring]
    hi = [b.verts.new(g(x, 0.5, z)) for x, z in ring]
    b.faces.new(lo)
    b.faces.new(hi[::-1])
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        b.faces.new([lo[j], lo[i], hi[i], hi[j]])
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    p.box("train.brass", (-0.05, 0.5, -0.8), (0.05, 0.52, 0.6))
    return p


def dining_table():
    p = Piece("dining-table")
    p.box("train.wood-dark", (-0.35, 0.72, -0.5), (0.35, 0.76, 0.5))
    p.box("train.wood-dark", (-0.05, 0, -0.05), (0.05, 0.72, 0.05))
    p.box("train.brass", (-0.25, 0, -0.25), (0.25, 0.03, 0.25))
    return p


def dining_chair():
    p = Piece("dining-chair")
    p.box("train.velvet", (-0.22, 0.4, -0.22), (0.22, 0.47, 0.22))
    p.box("train.velvet", (-0.22, 0.47, 0.18), (0.22, 0.95, 0.22))
    for x in (-0.19, 0.19):
        for z in (-0.19, 0.19):
            p.box("train.wood-dark", (x - 0.02, 0, z - 0.02), (x + 0.02, 0.4, z + 0.02))
    return p


def buffet_counter():
    """Along the wall (origin at the wall, like the luggage rack): 0.6 m deep, 3.0 m long."""
    p = Piece("buffet-counter")
    p.box("train.wood-dark", (0, 0, -3.0), (0.6, 1.0, 0))
    p.box("train.brass", (0, 1.0, -3.02), (0.62, 1.03, 0.02))
    return p


def jukebox():
    p = Piece("jukebox")
    p.box("train.wood-dark", (-0.4, 0, -0.25), (0.4, 1.2, 0.25))
    n = 6
    for i in range(n):  # a rounded top as stacked boxes
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        x0, x1 = -0.4 * math.cos(a0), -0.4 * math.cos(a1)
        y = 1.2 + 0.3 * max(math.sin(a0), math.sin(a1))
        p.box("train.wood-dark", (min(x0, x1), 1.2, -0.25), (max(x0, x1), y, 0.25))
    p.wall_z("train.lamp", 0.255, 1, -0.3, 0.3, 0.7, 1.15)
    p.box("train.brass", (-0.42, 0.65, 0.25), (0.42, 0.68, 0.27))
    p.box("train.brass", (-0.42, 1.18, 0.25), (0.42, 1.21, 0.27))
    return p


def favour_table():
    p = Piece("favour-table")
    p.box("train.panel", (-0.35, 0.72, -0.8), (0.35, 0.76, 0.8))
    p.box("train.panel", (-0.36, 0.45, -0.81), (0.36, 0.72, 0.81))  # the cloth skirt
    return p


def cab_shell():
    """The cab, 8 m long from its south end (z = 0) to the boiler backhead (z = -8)."""
    p = Piece("cab-shell")
    L, H = 8.0, 2.6
    p.floor("train.iron", 0, 1, -W, W, -L, 0)
    p.floor("train.iron", H, -1, -W, W, -L, 0)
    for side in (-1, 1):
        x = side * W
        wz0, wz1, wy0, wy1 = -3.6, -2.6, 1.3, 1.9
        p.wall_x("train.iron", x, -side, -L, 0, 0, wy0)
        p.wall_x("train.iron", x, -side, -L, 0, wy1, H)
        p.wall_x("train.iron", x, -side, -L, wz0, wy0, wy1)
        p.wall_x("train.iron", x, -side, wz1, 0, wy0, wy1)
        p.wall_x("window:night", x + side * 0.03, -side, wz0, wz1, wy0, wy1)
    # South end: the coal door (1.4 m opening) toward the absent tender.
    for x0, x1 in ((-W, -0.7), (0.7, W)):
        p.wall_z("train.iron", 0, -1, x0, x1, 0, H)
    p.wall_z("train.iron", 0, -1, -0.7, 0.7, 2.1, H)
    # North end: the backhead, a disc face on the boiler, with the firebox door and gauges.
    p.wall_z("train.iron", -L, 1, -W, W, 0, H)
    b = p.bm("train.iron")
    n, r, cy, zf = 16, 1.1, 1.3, -L + 0.3
    ring = [b.verts.new(g(r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), zf)) for i in range(n)]
    b.faces.new(ring)
    for i in range(n):  # the boiler's barrel back to the end wall
        j = (i + 1) % n
        a, c = ring[i], ring[j]
        a2 = b.verts.new((a.co.x, a.co.y - 0.3, a.co.z))
        c2 = b.verts.new((c.co.x, c.co.y - 0.3, c.co.z))
        b.faces.new([a, c, c2, a2])
    p.wall_z("train.firebox", zf + 0.01, 1, -0.3, 0.3, 0.7, 1.2)
    p.box("train.iron", (-0.36, 0.64, zf), (0.36, 0.7, zf + 0.06))
    p.box("train.iron", (-0.36, 1.2, zf), (0.36, 1.26, zf + 0.06))
    for gx in (-0.6, -0.2, 0.2, 0.6):
        p.box("train.brass", (gx - 0.09, 1.92, zf), (gx + 0.09, 2.1, zf + 0.04))
    return p


# ---- main ----------------------------------------------------------------------------------

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = final_materials(bake_textures())
    pieces = [
        wall_bay("window"), wall_bay("plain"), wall_bay("door"), pillar(),
        *[ceiling_bay(c) for c in CEILINGS], floor_bay(False), floor_bay(True),
        *[end_wall(c) for c in CEILINGS], vestibule(), lamp_hanging(), curtain(),
        seat_bench(), luggage_rack(), trunk(), coffin(), dining_table(), dining_chair(),
        buffet_counter(), jukebox(), favour_table(), cab_shell(),
    ]
    for pc in pieces:
        pc.finish(mats)
    for m in [m for m in bpy.data.materials if m.name.startswith("bake:")]:
        bpy.data.materials.remove(m)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, relative_remap=True)
    print(f"saved {OUT}: {len(pieces)} pieces")
    if "--renders" in ARGV:
        render_pieces(arg("--renders", ""))


def render_pieces(out):
    """Each piece alone, from a three-quarter view, in Workbench with texture colours."""
    os.makedirs(out, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 480, 360
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    colls = [c for c in sc.collection.children]
    for c in colls:
        for other in colls:
            sc.view_layers[0].layer_collection.children[other.name].exclude = other is not c
        bpy.context.view_layer.update()
        obs = list(c.all_objects)
        lo = [min(min((o.matrix_world @ mathutils.Vector(v))[i] for v in o.bound_box) for o in obs) for i in range(3)]
        hi = [max(max((o.matrix_world @ mathutils.Vector(v))[i] for v in o.bound_box) for o in obs) for i in range(3)]
        ctr = [(lo[i] + hi[i]) / 2 for i in range(3)]
        size = max(hi[i] - lo[i] for i in range(3))
        cam.location = (ctr[0] + size * 1.1, ctr[1] - size * 1.3, ctr[2] + size * 0.6)
        d = [ctr[i] - cam.location[i] for i in range(3)]
        cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
        sc.render.filepath = os.path.join(out, f"kit-{c.name}.png")
        bpy.ops.render.render(write_still=True)
    print(f"rendered {len(colls)} pieces -> {out}")


main()
