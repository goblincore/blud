# scripts/levels/build_train_kit.py
"""The train carriage kit, v2: a grimy industrial prison train.

    blender --background --factory-startup --python scripts/levels/build_train_kit.py \
        [-- --out PATH --renders DIR] [--width 3.0 --ceilings 2.6,3.2]

Spec: docs/superpowers/specs/2026-09-25-night-train-art-v2-design.md (look) on the structure of
docs/superpowers/specs/2026-09-25-train-carriage-kit-design.md (bays, sized shells, partitions).

Without --width the shell pieces are built for every (width, ceiling) pair the approved layout
uses (scripts/levels/night_train_layout.py); --width/--ceilings build one size (comparisons).

Writes assets-source/levels/kit.blend (one collection per kit piece) and the baked textures in
assets-source/levels/kit-textures/ (per material: colour, roughness, normal). Levels link the
pieces (collection instances); the level exporter turns repeated pieces into GPU instances.

Units are game metres. Every piece is modelled in GAME space (x, y, z), y up, the carriage
along -z, and converted with g() to Blender (x, -z, y). A bay spans z in [-1.9, 0]. Side-wall
pieces have their face at the wall plane x = 0 with the room on the +x side (the build script
puts them at x = -w/2 and turns them for the east side). One material per object, so the
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
W = 1.5  # the cab's half width (the cab shell is one size)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if "--width" in ARGV:
    # A one-off kit for one carriage size (width comparisons): --width W --ceilings H1,H2
    SIZES = sorted({(float(arg("--width", "3.0")), float(c)) for c in arg("--ceilings", "2.6").split(",")})
else:
    # Every (width, ceiling) the approved layout uses (docs/game/levels/01-night-train/layout.md).
    from night_train_layout import CARRIAGES
    SIZES = sorted({(c["w"], c["h"]) for c in CARRIAGES if c["name"] != "cab"})
DADO = 0.95
WALL_TOP = 2.2
LAMP_STRENGTH = 0.6  # dimmer than v1: the carriages read dark; the flashlight carries the view


def dm(v):
    """Metres to decimetres for piece names: 4.2 -> 42."""
    return int(round(v * 10))


def g(x, y, z):
    return (x, -z, y)


# ---- materials: procedural colour, roughness and height, baked to three maps ----------------

class Nodes:
    """A tiny node-building helper for one material's tree."""

    def __init__(self, tree):
        self.n, self.l = tree.nodes, tree.links
        self.uv = self.n.new("ShaderNodeTexCoord").outputs["UV"]

    def node(self, kind, inputs=None, **attrs):
        nd = self.n.new(kind)
        for k, v in attrs.items():
            setattr(nd, k, v)
        for k, v in (inputs or {}).items():
            if isinstance(v, bpy.types.NodeSocket):
                self.l.new(v, nd.inputs[k])
            else:
                nd.inputs[k].default_value = v
        return nd

    def stretch(self, sx, sy):
        return self.node("ShaderNodeVectorMath", {0: self.uv, 1: (sx, sy, 1.0)}, operation="MULTIPLY").outputs[0]

    def noise(self, scale, detail=4.0, vec=None, rough=0.5):
        return self.node("ShaderNodeTexNoise", {"Vector": vec or self.uv, "Scale": scale, "Detail": detail,
                                                "Roughness": rough}).outputs["Fac"]

    def math(self, op, a, b=0.0):
        nd = self.node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                self.l.new(v, nd.inputs[i])
            else:
                nd.inputs[i].default_value = v
        return nd.outputs[0]

    def ramp(self, fac, stops, constant=False):
        nd = self.node("ShaderNodeValToRGB")
        self.l.new(fac, nd.inputs["Fac"])
        el = nd.color_ramp.elements
        if constant:
            nd.color_ramp.interpolation = "CONSTANT"
        el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
        el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
        for pos, col in stops[1:-1]:
            e = el.new(pos)
            e.color = (*col, 1)
        return nd.outputs["Color"]

    def mix(self, fac, a, b):
        nd = self.node("ShaderNodeMix", data_type="RGBA")
        for key, v in (("Factor", fac), ("A", a), ("B", b)):
            sock = nd.inputs[key] if key == "Factor" else [s for s in nd.inputs if s.name == key and s.type == "RGBA"][0]
            if isinstance(v, bpy.types.NodeSocket):
                self.l.new(v, sock)
            else:
                sock.default_value = v if key == "Factor" else (*v, 1)
        return [s for s in nd.outputs if s.type == "RGBA"][0]

    def grid_dots(self, per_m, radius):
        """1 inside a dot of `radius` (in cells) at the centre of each 1/per_m cell."""
        v = self.node("ShaderNodeVectorMath", {0: self.uv, 1: (per_m, per_m, 1.0)}, operation="MULTIPLY").outputs[0]
        f = self.node("ShaderNodeVectorMath", {0: v}, operation="FRACTION").outputs[0]
        d = self.node("ShaderNodeVectorMath", {0: f, 1: (0.5, 0.5, 0.0)}, operation="DISTANCE").outputs["Value"]
        return self.math("LESS_THAN", d, radius)


def procedural(kind, t):
    """(colour, roughness, height) sockets for a material kind."""
    if kind in ("steel", "steel-scratched"):
        dark = kind == "steel-scratched"
        streak = t.noise(3.0, 6.0, t.stretch(1.0, 40.0))
        # Scratches: the cell edges of a Voronoi stretched along the grain are long, thin and
        # nearly straight (a wave texture read as marble contours; first render 2026-09-25).
        edge = t.node("ShaderNodeTexVoronoi", {"Vector": t.stretch(1.0, 10.0), "Scale": 7.0 if dark else 4.0},
                      feature="DISTANCE_TO_EDGE").outputs["Distance"]
        scratch = t.math("LESS_THAN", edge, 0.018 if dark else 0.01)
        base = t.ramp(streak, [(0.0, (0.13, 0.135, 0.145) if dark else (0.27, 0.28, 0.30)),
                               (1.0, (0.27, 0.27, 0.28) if dark else (0.45, 0.46, 0.48))])
        col = t.mix(t.math("MULTIPLY", scratch, 0.45), base, (0.55, 0.56, 0.58))
        if dark:  # grime patches
            grime = t.noise(1.4, 3.0)
            col = t.mix(t.math("MULTIPLY", t.math("GREATER_THAN", grime, 0.55), 0.6), col, (0.05, 0.045, 0.04))
            rough = t.math("ADD", t.math("MULTIPLY", grime, 0.3), 0.38)
        else:
            rough = t.math("ADD", t.math("MULTIPLY", streak, 0.15), 0.28)
        rough = t.math("ADD", rough, t.math("MULTIPLY", scratch, 0.15))
        height = t.math("SUBTRACT", t.math("MULTIPLY", streak, 0.3), t.math("MULTIPLY", scratch, 0.6))
        return col, rough, height
    if kind == "plate":
        brick = t.node("ShaderNodeTexBrick", {"Vector": t.uv, "Scale": 1.0, "Mortar Size": 0.012,
                                              "Brick Width": 0.95, "Row Height": 0.48}, offset=0.5)
        seam = brick.outputs["Fac"]
        rivet = t.grid_dots(4.0, 0.06)
        streak = t.noise(4.0, 5.0, t.stretch(1.0, 12.0))
        base = t.ramp(streak, [(0.0, (0.17, 0.17, 0.18)), (1.0, (0.33, 0.33, 0.34))])
        col = t.mix(t.math("MULTIPLY", seam, 0.9), base, (0.03, 0.03, 0.03))
        col = t.mix(rivet, col, (0.5, 0.5, 0.52))
        rough = t.math("ADD", t.math("MULTIPLY", streak, 0.2), 0.4)
        height = t.math("SUBTRACT", rivet, seam)
        return col, rough, height
    if kind == "grate":
        u = t.node("ShaderNodeSeparateXYZ", {"Vector": t.uv}).outputs["X"]
        bar = t.math("LESS_THAN", t.math("FRACT", t.math("MULTIPLY", u, 10.0)), 0.35)
        col = t.mix(bar, (0.015, 0.015, 0.015), (0.3, 0.3, 0.31))
        rough = t.math("ADD", t.math("MULTIPLY", bar, -0.1), 0.6)
        return col, rough, bar
    if kind == "rust":
        n = t.noise(4.0, 6.0, t.stretch(1.0, 6.0))
        col = t.ramp(n, [(0.0, (0.08, 0.035, 0.015)), (0.5, (0.24, 0.1, 0.035)), (1.0, (0.45, 0.2, 0.07))])
        return col, 0.85, t.math("MULTIPLY", n, 0.3)
    if kind == "pipe":
        chip = t.math("GREATER_THAN", t.noise(8.0, 5.0), 0.64)
        col = t.mix(chip, (0.13, 0.155, 0.13), (0.42, 0.42, 0.44))
        rough = t.math("ADD", t.math("MULTIPLY", chip, -0.25), 0.6)
        return col, rough, t.math("MULTIPLY", chip, -0.4)
    if kind == "brass-old":
        n = t.noise(10.0, 4.0)
        col = t.ramp(n, [(0.0, (0.2, 0.14, 0.05)), (1.0, (0.55, 0.4, 0.15))])
        return col, t.math("ADD", t.math("MULTIPLY", n, 0.25), 0.3), t.math("MULTIPLY", n, 0.2)
    if kind == "leather":
        edge = t.node("ShaderNodeTexVoronoi", {"Vector": t.uv, "Scale": 26.0}, feature="DISTANCE_TO_EDGE").outputs["Distance"]
        crack = t.math("LESS_THAN", edge, 0.04)
        n = t.noise(6.0, 3.0)
        base = t.ramp(n, [(0.0, (0.1, 0.02, 0.02)), (1.0, (0.22, 0.04, 0.035))])
        col = t.mix(crack, base, (0.03, 0.01, 0.01))
        return col, t.math("ADD", t.math("MULTIPLY", crack, 0.3), 0.55), t.math("MULTIPLY", crack, -1.0)
    if kind == "canvas":
        fine, stain = t.noise(40.0, 2.0), t.noise(2.0, 4.0)
        base = t.ramp(fine, [(0.0, (0.2, 0.19, 0.16)), (1.0, (0.3, 0.28, 0.23))])
        col = t.mix(t.math("MULTIPLY", t.math("GREATER_THAN", stain, 0.55), 0.7), base, (0.07, 0.06, 0.04))
        return col, 0.9, t.math("MULTIPLY", fine, 0.2)
    if kind == "soot":
        v = t.node("ShaderNodeSeparateXYZ", {"Vector": t.uv}).outputs["Y"]
        fade = t.math("MAXIMUM", t.math("SUBTRACT", 1.0, t.math("MULTIPLY", v, 2.0)), 0.0)
        alpha = t.math("MULTIPLY", t.math("MULTIPLY", fade, fade), t.math("ADD", t.math("MULTIPLY", t.noise(6.0), 0.6), 0.4))
        return t.ramp(alpha, [(0.0, (0, 0, 0)), (1.0, (1, 1, 1))]), 1.0, 0.0   # the colour map IS the alpha
    if kind == "party":
        vor = t.node("ShaderNodeTexVoronoi", {"Vector": t.uv, "Scale": 14.0}, feature="F1").outputs["Color"]
        hsv = t.node("ShaderNodeHueSaturation", {"Color": vor, "Saturation": 1.8, "Value": 1.1}).outputs["Color"]
        return hsv, 0.7, 0.0
    raise ValueError(kind)


BAKED = {  # name: (kind, size px, metallic)
    "train.steel": ("steel", 1024, 1.0),
    "train.steel-scratched": ("steel-scratched", 1024, 1.0),
    "train.plate": ("plate", 1024, 1.0),
    "train.grate": ("grate", 512, 1.0),
    "train.rust": ("rust", 512, 0.3),
    "train.pipe": ("pipe", 512, 0.6),
    "train.brass-old": ("brass-old", 512, 1.0),
    "train.leather": ("leather", 512, 0.0),
    "train.canvas": ("canvas", 512, 0.0),
    "train.soot": ("soot", 512, 0.0),
    "train.party": ("party", 256, 0.0),
}
FLAT = {"soot", "party"}  # no roughness/normal maps


def bake_textures():
    """For each material: colour and roughness through EMIT bakes, the normal through a NORMAL
    bake of a Principled BSDF with Bump(height), all on a UV'd 1 x 1 m plane (1 texture = 1 m)."""
    os.makedirs(TEX, exist_ok=True)
    for f in os.listdir(TEX):  # v1's maps (wood, panel, velvet...) must not linger
        if f.endswith(".png"):
            os.remove(os.path.join(TEX, f))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    scene.render.bake.normal_space = "TANGENT"
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    out = {}
    for name, (kind, size, _) in BAKED.items():
        short = name.split(".", 1)[1]
        maps = ("color",) if kind in FLAT else ("color", "rough", "normal")
        out[name] = {}
        for which in maps:
            m = bpy.data.materials.new(f"bake:{name}:{which}")
            m.use_nodes = True
            t = Nodes(m.node_tree)
            col, rough, height = procedural(kind, t)
            output = t.n["Material Output"]
            if which == "normal":
                bsdf = t.n["Principled BSDF"]
                h = height if isinstance(height, bpy.types.NodeSocket) else t.node("ShaderNodeValue").outputs[0]
                bump = t.node("ShaderNodeBump", {"Height": h, "Strength": 0.7, "Distance": 0.02})
                t.l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
            else:
                t.n.remove(t.n["Principled BSDF"])
                emit = t.node("ShaderNodeEmission")
                src = col if which == "color" else rough
                if isinstance(src, bpy.types.NodeSocket):
                    t.l.new(src, emit.inputs["Color"])
                else:
                    emit.inputs["Color"].default_value = (src, src, src, 1)
                t.l.new(emit.outputs["Emission"], output.inputs["Surface"])
            img = bpy.data.images.new(f"{short}-{which}.png", size, size, is_data=(which != "color"))
            tex = t.n.new("ShaderNodeTexImage")
            tex.image = img
            t.n.active = tex
            plane.data.materials.clear()
            plane.data.materials.append(m)
            bpy.ops.object.bake(type="NORMAL" if which == "normal" else "EMIT", margin=0)
            path = os.path.join(TEX, f"{short}-{which}.png")
            img.filepath_raw = path
            img.file_format = "PNG"
            img.save()
            out[name][which] = path
            bpy.data.images.remove(img)
            bpy.data.materials.remove(m)
    bpy.data.objects.remove(plane)
    return out


def final_materials(paths):
    def image(path, data):
        img = bpy.data.images.load(path)
        img.filepath = bpy.path.relpath(path, start=os.path.dirname(OUT))  # relative to where the kit is SAVED
        if data:
            img.colorspace_settings.name = "Non-Color"
        return img

    mats = {}
    for name, (kind, _, metal) in BAKED.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        t = Nodes(m.node_tree)
        bsdf = t.n["Principled BSDF"]
        bsdf.inputs["Metallic"].default_value = metal
        col = t.n.new("ShaderNodeTexImage")
        col.image = image(paths[name]["color"], kind == "soot")
        if kind == "soot":  # black, with the map as alpha (a grime decal)
            bsdf.inputs["Base Color"].default_value = (0.01, 0.01, 0.01, 1)
            bsdf.inputs["Roughness"].default_value = 1.0
            t.l.new(col.outputs["Color"], bsdf.inputs["Alpha"])
            if hasattr(m, "surface_render_method"):
                m.surface_render_method = "BLENDED"
            mats[name] = m
            continue
        t.l.new(col.outputs["Color"], bsdf.inputs["Base Color"])
        if kind in FLAT:
            bsdf.inputs["Roughness"].default_value = 0.7
        else:
            rough = t.n.new("ShaderNodeTexImage")
            rough.image = image(paths[name]["rough"], True)
            t.l.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
            nrm = t.n.new("ShaderNodeTexImage")
            nrm.image = image(paths[name]["normal"], True)
            nmap = t.node("ShaderNodeNormalMap", {"Color": nrm.outputs["Color"], "Strength": 1.0})
            t.l.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        mats[name] = m
    for name, rgb, strength in (("train.lamp", (1.0, 0.78, 0.5), LAMP_STRENGTH), ("train.firebox", (1.0, 0.42, 0.1), 1.0)):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        mats[name] = m
    m = bpy.data.materials.new("window:night")  # the game replaces this with the scenery shader
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
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
        """pts: game-space corners, counter-clockwise seen from the side the face faces."""
        b = self.bm(mat)
        return b.faces.new([b.verts.new(g(*p)) for p in pts])

    def box(self, mat, lo, hi):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
        for ids in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)):
            self.quad(mat, [c[i] for i in ids])

    def cyl(self, mat, start, axis, length, r, n=10, r_end=None):
        """A cylinder (or cone, with r_end) from `start` along axis 'x' | 'y' | 'z' (positive)."""
        b = self.bm(mat)
        r1 = r if r_end is None else r_end
        ai = "xyz".index(axis)
        oth = [i for i in range(3) if i != ai]

        def ring(t, rad):
            vs = []
            for k in range(n):
                a = 2 * math.pi * k / n
                p = list(start)
                p[ai] += t
                p[oth[0]] += rad * math.cos(a)
                p[oth[1]] += rad * math.sin(a)
                vs.append(b.verts.new(g(*p)))
            return vs
        lo, hi = ring(0.0, r), ring(length, max(r1, 1e-4))
        for k in range(n):
            j = (k + 1) % n
            b.faces.new([lo[k], lo[j], hi[j], hi[k]])
        b.faces.new(lo[::-1])
        b.faces.new(hi)

    def wall_x(self, mat, x, facing, z0, z1, y0, y1):
        pts = [(x, y0, z1), (x, y0, z0), (x, y1, z0), (x, y1, z1)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def wall_z(self, mat, z, facing, x0, x1, y0, y1):
        pts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def floor(self, mat, y, facing, x0, x1, z0, z1):
        pts = [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)]
        self.quad(mat, pts if facing > 0 else pts[::-1])

    def finish(self, mats):
        coll = bpy.data.collections.new(self.name)
        bpy.context.scene.collection.children.link(coll)
        for mat, b in self.parts.items():
            bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
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


S, SX, PL, PIPE, BR = "train.steel", "train.steel-scratched", "train.plate", "train.pipe", "train.brass-old"


def pipes(p, z0, z1):
    """The two wall pipe runs (low and high) with clamp brackets, from z0 down to z1."""
    L = z0 - z1
    for x, y, r in ((0.11, 0.3, 0.06), (0.1, 2.05, 0.05)):
        p.cyl(PIPE, (x, y, z1), "z", L, r)
        for bz in (z0 - 0.35, z1 + 0.35):
            p.box(SX, (0.0, y - r - 0.02, bz - 0.03), (x + r + 0.01, y - r, bz + 0.03))


def wall_bay(kind):
    """kind: 'window' | 'plain' | 'door'. One bay of side wall at the wall plane (room at +x)."""
    p = Piece(f"bay-wall-{kind}")
    p.wall_x(PL, 0.0, 1, -BAY, 0, 0, DADO)                                    # riveted plate below
    p.box(SX, (0.0, DADO, -BAY), (0.05, DADO + 0.05, 0))                        # bolted cap
    y0 = DADO + 0.05
    if kind == "window":
        wz0, wz1, wy0, wy1 = -1.5, -0.4, 1.05, 1.85
        p.wall_x(S, 0.0, 1, -BAY, 0, y0, wy0)
        p.wall_x(S, 0.0, 1, -BAY, 0, wy1, WALL_TOP)
        p.wall_x(S, 0.0, 1, -BAY, wz0, wy0, wy1)
        p.wall_x(S, 0.0, 1, wz1, 0, wy0, wy1)
        f, d = 0.08, 0.06   # a heavy bolted frame
        p.box(SX, (0, wy0 - f, wz0 - f), (d, wy0, wz1 + f))
        p.box(SX, (0, wy1, wz0 - f), (d, wy1 + f, wz1 + f))
        p.box(SX, (0, wy0, wz0 - f), (d, wy1, wz0))
        p.box(SX, (0, wy0, wz1), (d, wy1, wz1 + f))
        for by in (wy0 - f / 2, wy1 + f / 2):
            for bz in (wz0 - f / 2, wz1 + f / 2):
                p.box(BR, (d, by - 0.015, bz - 0.015), (d + 0.02, by + 0.015, bz + 0.015))
        p.wall_x("window:night", -0.03, 1, wz0, wz1, wy0, wy1)
    else:
        p.wall_x(S, 0.0, 1, -BAY, 0, y0, WALL_TOP)
    if kind == "door":
        p.box(PL, (0, 0.02, -1.35), (0.04, 2.02, -0.55))
        p.box(SX, (0.04, 0.98, -0.7), (0.09, 1.04, -0.6))
        for hy in (0.3, 1.7):
            p.box(SX, (0.0, hy, -1.39), (0.05, hy + 0.12, -1.35))
    pipes(p, 0.0, -BAY)
    p.wall_x("train.soot", 0.004, 1, -BAY, 0, 0, 0.5)
    return p


def pillar():
    """An I-beam rib between bays, at the wall plane."""
    p = Piece("bay-pillar")
    p.box(SX, (0, 0, -0.02), (0.18, WALL_TOP, 0.02))
    p.box(SX, (0.16, 0, -0.09), (0.2, WALL_TOP, 0.09))
    p.box(SX, (0, 0, -0.09), (0.03, WALL_TOP, 0.09))
    return p


CEIL_PROFILE = [(-1.5, 0.0), (-1.45, 0.15), (-1.35, 0.25), (-1.2, 0.32), (-1.0, 0.35), (-0.6, 0.35),
                (-0.6, 0.4), (0.6, 0.4), (0.6, 0.35), (1.0, 0.35), (1.2, 0.32), (1.35, 0.25), (1.45, 0.15), (1.5, 0.0)]


def ceiling_bay(width, height):
    """Steel arch, a rib at the bay's start, a big centre pipe, a caged lamp."""
    W = width / 2
    p = Piece(f"bay-ceiling-{dm(width)}-{dm(height)}")
    base = height - 0.4
    for side in (-1, 1):
        if base > WALL_TOP + 1e-3:
            p.wall_x(S, side * W, -side, -BAY, 0, WALL_TOP, base)
    prof = [(x * W / 1.5, y) for x, y in CEIL_PROFILE]
    for (xa, ya), (xb, yb) in zip(prof, prof[1:]):
        p.quad(S, [(xa, base + ya, 0), (xb, base + yb, 0), (xb, base + yb, -BAY), (xa, base + ya, -BAY)])
        for zr, facing in ((0.03, 1), (-0.03, -1)):   # the rib, both faces
            pts = [(xa, base + ya, zr), (xb, base + yb, zr), (xb, base + yb - 0.09, zr), (xa, base + ya - 0.09, zr)]
            p.quad(SX, pts if facing < 0 else pts[::-1])
    p.cyl(PIPE, (0.0, height - 0.2, -BAY), "z", BAY, 0.13, 12)
    y = base + 0.3
    lamp = p.bm("train.lamp")
    ring = [lamp.verts.new(g(0.4 + 0.1 * math.cos(2 * math.pi * i / 10), y, -BAY / 2 + 0.1 * math.sin(2 * math.pi * i / 10))) for i in range(10)]
    lamp.faces.new(ring)
    for dx in (-0.12, 0.12):
        for dz in (-0.12, 0.12):
            p.box(SX, (0.4 + dx - 0.008, y - 0.14, -BAY / 2 + dz - 0.008), (0.4 + dx + 0.008, y + 0.03, -BAY / 2 + dz + 0.008))
    p.box(SX, (0.27, y - 0.15, -BAY / 2 - 0.13), (0.53, y - 0.14, -BAY / 2 + 0.13))
    return p


def floor_bay(width, grate):
    W = width / 2
    p = Piece(f"bay-floor-{'grate' if grate else 'plate'}-{dm(width)}")
    p.floor(PL, 0, 1, -W, W, -BAY, 0)
    if grate:
        p.floor("train.grate", 0.004, 1, -0.6, 0.6, -BAY, 0)
        for x in (-0.62, 0.6):
            p.box(SX, (x, 0, -BAY), (x + 0.02, 0.01, 0))
    return p


def end_wall(width, height):
    """A riveted bulkhead at a carriage's SOUTH end (z = 0), facing north (-z); 1.4 m door."""
    W = width / 2
    p = Piece(f"end-wall-door-{dm(width)}-{dm(height)}")
    dx, dh = 0.7, 2.1
    for x0, x1 in ((-W, -dx), (dx, W)):
        p.wall_z(PL, 0, -1, x0, x1, 0, DADO)
        p.wall_z(S, 0, -1, x0, x1, DADO, height)
    p.wall_z(S, 0, -1, -dx, dx, dh, height)
    for x0, x1 in ((-dx - 0.12, -dx), (dx, dx + 0.12)):
        p.box(SX, (x0, 0, -0.08), (x1, dh + 0.12, 0))
    p.box(SX, (-dx, dh, -0.08), (dx, dh + 0.12, 0))
    return p


def partition(height):
    """A thin steel partition, 1 m along -z (scaled by the instance), both faces."""
    p = Piece(f"partition-{dm(height)}")
    t = 0.05
    for side in (-1, 1):
        x = side * t
        p.wall_x(PL, x, side, -1.0, 0, 0, DADO)
        p.wall_x(S, x, side, -1.0, 0, DADO, height)
    p.floor(SX, height - 0.01, 1, -t, t, -1.0, 0)
    return p


def cage_partition(height):
    """Bars in a 1 m tile along -z (the build script tiles it, so the bars keep their spacing)."""
    p = Piece(f"cage-partition-{dm(height)}")
    for i in range(8):
        z = -0.0625 - i * 0.125
        p.box(SX, (-0.015, 0, z - 0.012), (0.015, height, z + 0.012))
    for y0, y1 in ((0.0, 0.08), (1.0, 1.05), (height - 0.06, height)):
        p.box(SX, (-0.03, y0, -1.0), (0.03, y1, 0.0))
    return p


def vestibule():
    p = Piece("vestibule")
    L, h = 1.2, 2.1
    p.floor("train.grate", 0, 1, -0.7, 0.7, -L, 0)
    p.floor(SX, h, -1, -0.7, 0.7, -L, 0)
    p.wall_x(SX, -0.7, 1, -L, 0, 0, h)
    p.wall_x(SX, 0.7, -1, -L, 0, 0, h)
    for i in range(1, 6):
        z = -L * i / 6
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 0.7, sx * 0.64))
            p.box(SX, (x0, 0, z - 0.03), (x1, h, z + 0.03))
    p.cyl(PIPE, (0.35, h - 0.12, -L), "z", L, 0.06)
    return p


def lamp_hanging():
    p = Piece("lamp-hanging", sway="lamp")
    p.box(SX, (-0.01, -0.45, -0.01), (0.01, 0, 0.01))
    p.box("train.lamp", (-0.1, -0.62, -0.1), (0.1, -0.47, 0.1))
    for dx in (-0.12, 0.12):
        for dz in (-0.12, 0.12):
            p.box(SX, (dx - 0.008, -0.64, dz - 0.008), (dx + 0.008, -0.45, dz + 0.008))
    return p


def curtain():
    """A tattered canvas rag at a window."""
    p = Piece("curtain", sway="curtain")
    for z0, z1, drop in ((-0.3, 0.0, 0.65), (-1.1, -0.82, 0.5)):
        p.box("train.canvas", (0.07, -drop, z0), (0.085, 0.0, z1))
    return p


def seat_bench():
    p = Piece("seat-bench")
    p.box(SX, (0, 0, -0.9), (0.6, 0.25, 0))
    p.box("train.leather", (0, 0.25, -0.9), (0.6, 0.45, 0))
    p.box("train.leather", (0, 0.45, -0.9), (0.12, 1.1, 0))
    return p


def luggage_rack():
    p = Piece("luggage-rack")
    p.box("train.grate", (0, 1.88, -BAY), (0.4, 1.92, 0))
    p.box(SX, (0.37, 1.92, -BAY), (0.4, 2.0, 0))
    for z in (-0.1, -1.8):
        p.box(SX, (0, 1.7, z - 0.015), (0.4, 1.88, z + 0.015))
    return p


def trunk():
    p = Piece("trunk")
    p.box(SX, (-0.25, 0, -0.45), (0.25, 0.5, 0.45))
    for z in (-0.3, 0.3):
        p.box("train.rust", (-0.26, 0, z - 0.03), (0.26, 0.51, z + 0.03))
    return p


def trunk_big():
    p = Piece("trunk-big")
    p.box(SX, (-0.55, 0, -0.45), (0.55, 0.7, 0.45))
    for x in (-0.3, 0.3):
        p.box("train.rust", (x - 0.03, 0, -0.46), (x + 0.03, 0.71, 0.46))
    return p


def coffin():
    p = Piece("coffin")
    b = p.bm(SX)
    ring = [(-0.2, -1.0), (0.2, -1.0), (0.3, -0.5), (0.2, 1.0), (-0.2, 1.0), (-0.3, -0.5)]
    lo = [b.verts.new(g(x, 0, z)) for x, z in ring]
    hi = [b.verts.new(g(x, 0.5, z)) for x, z in ring]
    b.faces.new(lo)
    b.faces.new(hi[::-1])
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        b.faces.new([lo[j], lo[i], hi[i], hi[j]])
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    p.box("train.rust", (-0.05, 0.5, -0.8), (0.05, 0.52, 0.6))
    return p


def desk():
    p = Piece("desk")
    p.box(SX, (-0.4, 0.74, -0.8), (0.4, 0.8, 0.8))
    p.box(S, (-0.38, 0, -0.78), (0.38, 0.74, -0.3))
    p.box(S, (-0.38, 0, 0.3), (0.38, 0.74, 0.78))
    p.box(BR, (-0.03, 0.8, 0.47), (0.03, 1.15, 0.53))
    p.box("train.lamp", (-0.1, 1.15, 0.4), (0.1, 1.26, 0.6))
    return p


def stove():
    p = Piece("stove")
    p.box(SX, (-0.3, 0, -0.4), (0.3, 1.0, 0.4))
    p.cyl(PIPE, (0.0, 1.0, 0.0), "y", 1.8, 0.08)
    p.wall_x("train.firebox", -0.305, -1, -0.2, 0.2, 0.25, 0.55)
    return p


def buffet_island():
    p = Piece("buffet-island")
    p.box(PL, (-0.6, 0, -1.6), (0.6, 0.97, 1.6))
    p.box(SX, (-0.62, 0.97, -1.62), (0.62, 1.0, 1.62))
    return p


def galley_stoves():
    p = Piece("galley-stoves")
    p.box(SX, (-0.4, 0, -0.95), (0.4, 0.95, 0.95))
    for z in (-0.5, 0.4):
        p.box("train.firebox", (-0.3, 0.95, z - 0.2), (0.1, 0.97, z + 0.2))
    return p


def galley_counter():
    p = Piece("galley-counter")
    p.box(S, (-0.25, 0, -0.6), (0.25, 0.97, 0.6))
    p.box(SX, (-0.26, 0.97, -0.61), (0.26, 1.0, 0.61))
    return p


def bar():
    p = Piece("bar")
    p.box(PL, (-0.3, 0, -3.0), (0.3, 1.05, 3.0))
    p.box(SX, (-0.32, 1.05, -3.02), (0.32, 1.1, 3.02))
    p.wall_x("train.leather", -0.305, -1, -2.9, 2.9, 0.55, 0.95)   # padded front
    p.box(BR, (-0.42, 0.15, -3.0), (-0.38, 0.19, 3.0))               # foot rail
    return p


def pillar_round():
    p = Piece("pillar-round")
    p.cyl(SX, (0.0, 0.0, 0.0), "y", 3.4, 0.15, 12)
    for y in (0.0, 1.2, 2.4, 3.25):
        p.cyl(BR, (0.0, y, 0.0), "y", 0.15, 0.18, 12)
    return p


def bunk():
    """Steel racks with canvas mattresses; origin at its floor centre."""
    p = Piece("bunk")
    for y in (0.4, 1.4):
        p.box(SX, (-0.4, y, -1.3), (0.4, y + 0.05, 1.3))
        p.box("train.canvas", (-0.37, y + 0.05, -1.27), (0.37, y + 0.17, 1.27))
    for x in (-0.4, 0.36):
        for z in (-1.3, 1.26):
            p.box(SX, (x, 0, z), (x + 0.04, 1.8, z + 0.04))
    return p


def jukebox():
    p = Piece("jukebox")
    p.box(SX, (-0.4, 0, -0.25), (0.4, 1.2, 0.25))
    n = 6
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        x0, x1 = -0.4 * math.cos(a0), -0.4 * math.cos(a1)
        y = 1.2 + 0.3 * max(math.sin(a0), math.sin(a1))
        p.box(SX, (min(x0, x1), 1.2, -0.25), (max(x0, x1), y, 0.25))
    p.wall_z("train.lamp", 0.255, 1, -0.3, 0.3, 0.7, 1.15)
    p.wall_z("train.party", 0.256, 1, -0.3, 0.3, 0.3, 0.6)
    for y in (0.65, 1.18):
        p.box(BR, (-0.42, y, 0.25), (0.42, y + 0.03, 0.27))
    return p


def favour_table():
    p = Piece("favour-table")
    p.box(SX, (-0.35, 0.72, -0.8), (0.35, 0.76, 0.8))
    for x in (-0.3, 0.3):
        for z in (-0.75, 0.75):
            p.box(S, (x - 0.02, 0, z - 0.02), (x + 0.02, 0.72, z + 0.02))
    return p


def booth():
    """A booth along a wall (origin at the wall plane, centred on the table): facing leather
    benches with a steel table between; 0.75 x 1.8 m."""
    p = Piece("booth")
    p.box(SX, (0.05, 0.72, -0.45), (0.75, 0.76, 0.45))
    p.box(S, (0.35, 0, -0.05), (0.45, 0.72, 0.05))
    for side in (-1, 1):
        z0, z1 = sorted((side * 0.47, side * 0.9))
        zb0, zb1 = sorted((side * 0.8, side * 0.9))
        p.box(SX, (0.0, 0, z0), (0.75, 0.25, z1))
        p.box("train.leather", (0.0, 0.25, z0), (0.75, 0.45, z1))
        p.box("train.leather", (0.0, 0.45, zb0), (0.75, 1.15, zb1))
    return p


def boiler():
    """A wall boiler (origin at the wall plane): a riveted drum with a glowing grate and a flue."""
    p = Piece("boiler")
    p.cyl(SX, (0.4, 0.0, 0.0), "y", 2.0, 0.35, 16)
    for y in (0.15, 1.0, 1.85):
        p.cyl(PL, (0.4, y, 0.0), "y", 0.08, 0.37, 16)
    p.wall_x("train.firebox", 0.755, 1, -0.15, 0.15, 0.45, 0.72)
    p.box(SX, (0.74, 0.4, -0.2), (0.77, 0.77, -0.15))
    p.box(SX, (0.74, 0.4, 0.15), (0.77, 0.77, 0.2))
    p.cyl(PIPE, (0.4, 2.0, 0.0), "y", 1.4, 0.09)
    p.wall_x("train.soot", 0.004, 1, -0.6, 0.6, 0, 0.5)
    return p


def gear_housing():
    """Exposed gears on a bulkhead (origin at the wall plane, the large gear's centre)."""
    p = Piece("gear-housing")
    p.box(SX, (0.0, -0.45, -0.55), (0.03, 0.45, 0.35))
    for (cz, cy, r, teeth) in ((0.0, 0.0, 0.3, 14), (-0.38, 0.22, 0.17, 9)):
        p.cyl(BR, (0.03, cy, cz), "x", 0.05, r, 20)
        for k in range(teeth):
            a = 2 * math.pi * k / teeth
            ty, tz = cy + (r + 0.03) * math.sin(a), cz + (r + 0.03) * math.cos(a)
            p.box(BR, (0.03, ty - 0.025, tz - 0.025), (0.08, ty + 0.025, tz + 0.025))
        p.cyl(SX, (0.03, cy, cz), "x", 0.09, 0.04, 8)
    return p


def grille():
    p = Piece("grille")
    p.box(SX, (0.0, 0.0, -0.3), (0.03, 0.4, 0.3))
    for i in range(6):
        y = 0.05 + i * 0.06
        p.box(S, (0.03, y, -0.27), (0.06, y + 0.025, 0.27))
    return p


def valve():
    """A valve wheel on the low pipe (origin at the wall plane, floor level)."""
    p = Piece("valve")
    p.cyl(SX, (0.11, 0.36, 0.0), "y", 0.18, 0.025)
    cy, ri, ro, th, n = 0.56, 0.105, 0.135, 0.025, 20
    b = p.bm(BR)

    def ring(rad, y):
        return [b.verts.new(g(0.11 + rad * math.cos(2 * math.pi * k / n), y, rad * math.sin(2 * math.pi * k / n))) for k in range(n)]
    io, oo, iu, ou = ring(ri, cy + th / 2), ring(ro, cy + th / 2), ring(ri, cy - th / 2), ring(ro, cy - th / 2)
    for k in range(n):   # a flat ring with a thickness: top, bottom, outer and inner walls
        j = (k + 1) % n
        for f in ((io[k], oo[k], oo[j], io[j]), (iu[j], ou[j], ou[k], iu[k]), (oo[k], ou[k], ou[j], oo[j]), (io[j], iu[j], iu[k], io[k])):
            b.faces.new(f)
    for dx, dz in ((ro, 0.0), (0.0, ro)):   # two spokes
        p.box(BR, (0.11 - dx - 0.01, cy - 0.01, -dz - 0.01), (0.11 + dx + 0.01, cy + 0.01, dz + 0.01))
    return p


def gauges():
    """Three pressure gauges on a plate (origin at the wall plane, floor level)."""
    p = Piece("gauges")
    p.box(SX, (0.0, 1.15, -0.3), (0.03, 1.45, 0.3))
    for z in (-0.18, 0.0, 0.18):
        p.cyl(BR, (0.03, 1.3, z), "x", 0.04, 0.075, 16)
        p.cyl(S, (0.07, 1.3, z), "x", 0.005, 0.06, 16)
    return p


def streamers():
    """Party streamers hanging from the ceiling pipe across one bay (origin: the pipe's underside)."""
    p = Piece("streamers", sway="curtain")
    for i, (x, z, drop) in enumerate(((-0.8, -0.3, 0.7), (-0.45, -0.8, 0.9), (-0.1, -1.3, 0.5), (0.3, -0.5, 0.8),
                                        (0.6, -1.1, 0.65), (0.85, -1.6, 0.9))):
        p.box("train.party", (x - 0.025, -drop, z - 0.003), (x + 0.025, 0.0, z + 0.003))
    return p


def bunting(width):
    """A sagging line of pennants across the carriage (origin: centre, at its fixing height)."""
    p = Piece(f"bunting-{dm(width)}")
    W = width / 2 - 0.2
    n = 9
    pts = [(-W + 2 * W * i / n, -0.35 * (1 - ((2 * i / n) - 1) ** 2)) for i in range(n + 1)]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        b = p.bm("train.party")
        v = [b.verts.new(g(xa, ya, 0)), b.verts.new(g(xb, yb, 0)), b.verts.new(g((xa + xb) / 2, (ya + yb) / 2 - 0.25, 0))]
        b.faces.new(v)
    return p


def party_hats():
    p = Piece("party-hats")
    for x, z in ((-0.15, -0.2), (0.12, 0.05), (-0.05, 0.3), (0.2, -0.35)):
        p.cyl("train.party", (x, 0.0, z), "y", 0.2, 0.06, 8, r_end=0.0)
    return p


def cab_shell():
    """The cab, 3.0 m wide, 8 m long from its south end (z = 0) to the boiler backhead (z = -8)."""
    p = Piece("cab-shell")
    L, H = 8.0, 2.6
    p.floor(PL, 0, 1, -W, W, -L, 0)
    p.floor(SX, H, -1, -W, W, -L, 0)
    for side in (-1, 1):
        x = side * W
        wz0, wz1, wy0, wy1 = -3.6, -2.6, 1.3, 1.9
        p.wall_x(SX, x, -side, -L, 0, 0, wy0)
        p.wall_x(SX, x, -side, -L, 0, wy1, H)
        p.wall_x(SX, x, -side, -L, wz0, wy0, wy1)
        p.wall_x(SX, x, -side, wz1, 0, wy0, wy1)
        p.wall_x("window:night", x + side * 0.03, -side, wz0, wz1, wy0, wy1)
        for y, r in ((0.35, 0.07), (2.2, 0.06)):
            p.cyl(PIPE, (x - side * (r + 0.02), y, -L), "z", L, r)
    for x0, x1 in ((-W, -0.7), (0.7, W)):
        p.wall_z(SX, 0, -1, x0, x1, 0, H)
    p.wall_z(SX, 0, -1, -0.7, 0.7, 2.1, H)
    p.wall_z(SX, -L, 1, -W, W, 0, H)
    n, r, cy, zf = 16, 1.1, 1.3, -L + 0.3
    p.cyl(PL, (0.0, cy, -L), "z", 0.3, r, n)            # the boiler's barrel end: the backhead
    p.wall_z("train.firebox", zf + 0.005, 1, -0.3, 0.3, 0.7, 1.2)
    p.box(SX, (-0.36, 0.64, zf), (0.36, 0.7, zf + 0.06))
    p.box(SX, (-0.36, 1.2, zf), (0.36, 1.26, zf + 0.06))
    for gx in (-0.6, -0.2, 0.2, 0.6):
        p.cyl(BR, (gx, 2.0, zf), "z", 0.04, 0.09, 16)
    return p


# ---- main ----------------------------------------------------------------------------------

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = final_materials(bake_textures())
    widths = sorted({w for w, _ in SIZES})
    heights = sorted({h for _, h in SIZES})
    pieces = [
        wall_bay("window"), wall_bay("plain"), wall_bay("door"), pillar(),
        *[ceiling_bay(w, h) for w, h in SIZES],
        *[end_wall(w, h) for w, h in SIZES],
        *[floor_bay(w, gr) for w in widths for gr in (False, True)],
        *[partition(h) for h in heights], *[cage_partition(h) for h in heights],
        vestibule(), lamp_hanging(), curtain(),
        seat_bench(), luggage_rack(), trunk(), trunk_big(), coffin(), jukebox(), favour_table(), cab_shell(),
        desk(), stove(), buffet_island(), galley_stoves(), galley_counter(), bar(), pillar_round(), bunk(),
        booth(), boiler(), gear_housing(), grille(), valve(), gauges(), streamers(),
        *[bunting(w) for w in widths], party_hats(),
    ]
    for pc in pieces:
        pc.finish(mats)
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
