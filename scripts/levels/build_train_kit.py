# scripts/levels/build_train_kit.py
"""The train carriage kit, v2: a grimy industrial prison train.

    blender --background --factory-startup --python scripts/levels/build_train_kit.py \
        [-- --out PATH --renders DIR [--render-only a,b]] [--width 3.0 --ceilings 2.6,3.2]

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
            # Soft-edged grime (a hard threshold read as camouflage; first render 2026-09-25).
            soft = t.node("ShaderNodeMapRange", {"Value": grime, "From Min": 0.45, "From Max": 0.75, "To Min": 0.0, "To Max": 0.6}).outputs[0]
            col = t.mix(soft, col, (0.05, 0.045, 0.04))
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
        soft = t.node("ShaderNodeMapRange", {"Value": stain, "From Min": 0.45, "From Max": 0.75, "To Min": 0.0, "To Max": 0.6}).outputs[0]
        col = t.mix(soft, base, (0.07, 0.06, 0.04))
        return col, 0.9, t.math("MULTIPLY", fine, 0.2)
    if kind == "soot":
        v = t.node("ShaderNodeSeparateXYZ", {"Vector": t.uv}).outputs["Y"]
        fade = t.math("MAXIMUM", t.math("SUBTRACT", 1.0, t.math("MULTIPLY", v, 2.0)), 0.0)
        alpha = t.math("MULTIPLY", t.math("MULTIPLY", fade, fade), t.math("ADD", t.math("MULTIPLY", t.noise(6.0), 0.6), 0.4))
        return t.ramp(alpha, [(0.0, (0, 0, 0)), (1.0, (1, 1, 1))]), 1.0, 0.0   # the colour map IS the alpha
    if kind == "party":
        # A limited, grubby palette (rainbow confetti read as noise; first render 2026-09-25):
        # each Voronoi cell picks red, gold, teal or rose by its random value.
        vor = t.node("ShaderNodeTexVoronoi", {"Vector": t.uv, "Scale": 6.0}, feature="F1").outputs["Color"]
        r = t.node("ShaderNodeSeparateColor", {"Color": vor}).outputs["Red"]
        col = t.ramp(r, [(0.0, (0.42, 0.04, 0.05)), (0.25, (0.55, 0.38, 0.08)), (0.5, (0.05, 0.3, 0.3)), (0.75, (0.5, 0.16, 0.22))],
                     constant=True)
        dirt = t.noise(9.0, 3.0)
        col = t.mix(t.math("MULTIPLY", dirt, 0.35), col, (0.05, 0.04, 0.03))
        return col, 0.7, 0.0
    if kind == "wood":
        # Dark, grimy planks: grain along u, worn pale where hands and boots rub.
        grain = t.noise(2.5, 8.0, t.stretch(1.0, 30.0), rough=0.6)
        wear = t.noise(3.0, 4.0)
        base = t.ramp(grain, [(0.0, (0.05, 0.03, 0.017)), (0.5, (0.11, 0.065, 0.035)), (1.0, (0.2, 0.13, 0.07))])
        soft = t.node("ShaderNodeMapRange", {"Value": wear, "From Min": 0.55, "From Max": 0.75, "To Min": 0.0, "To Max": 0.5}).outputs[0]
        col = t.mix(soft, base, (0.26, 0.2, 0.14))
        rough = t.math("ADD", t.math("MULTIPLY", grain, 0.2), t.math("SUBTRACT", 0.72, t.math("MULTIPLY", soft, 0.3)))
        return col, rough, t.math("MULTIPLY", grain, 0.5)
    if kind == "wool":
        # Dark greatcoat wool: a slow drift between charcoal, navy-black, brown-black and
        # olive-grey (each coat samples a different part of the tile), fine fibre on top.
        tone, fibre = t.noise(1.2, 2.0), t.noise(60.0, 3.0)
        base = t.ramp(tone, [(0.3, (0.06, 0.06, 0.065)), (0.43, (0.035, 0.045, 0.085)), (0.57, (0.11, 0.07, 0.045)),
                             (0.7, (0.1, 0.1, 0.08))])
        col = t.mix(t.math("MULTIPLY", fibre, 0.3), base, (0.16, 0.15, 0.14))
        return col, 0.95, t.math("MULTIPLY", fibre, 0.3)
    if kind == "coal":
        # Black lumps; a few glossy specks catch the light.
        vor = t.node("ShaderNodeTexVoronoi", {"Vector": t.uv, "Scale": 25.0}, feature="F1")
        cell, dist = vor.outputs["Color"], vor.outputs["Distance"]
        shade = t.node("ShaderNodeSeparateColor", {"Color": cell}).outputs["Red"]
        base = t.ramp(shade, [(0.0, (0.012, 0.012, 0.013)), (1.0, (0.05, 0.048, 0.046))])
        speck = t.math("GREATER_THAN", t.noise(90.0, 2.0), 0.68)
        col = t.mix(t.math("MULTIPLY", speck, 0.8), base, (0.28, 0.28, 0.3))
        rough = t.math("SUBTRACT", 0.6, t.math("MULTIPLY", speck, 0.45))
        return col, rough, t.math("MULTIPLY", dist, -0.8)
    if kind == "mirror":
        # Bright silver with a faint cloud; the ball's flat-shaded facets are the tiles (a UV
        # grid did not line up with the facets and drew curved seams; first render 2026-09-26).
        n = t.noise(12.0, 3.0)
        col = t.ramp(n, [(0.0, (0.62, 0.63, 0.65)), (1.0, (0.82, 0.83, 0.85))])
        return col, t.math("ADD", t.math("MULTIPLY", n, 0.08), 0.04), 0.0
    if kind == "rubber":
        n = t.noise(20.0, 3.0)
        return t.ramp(n, [(0.0, (0.012, 0.012, 0.012)), (1.0, (0.035, 0.034, 0.033))]), 0.7, 0.0
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
    "train.wood-worn": ("wood", 512, 0.0),
    "train.wool": ("wool", 512, 0.0),
    "train.coal": ("coal", 512, 0.2),
    "train.mirror": ("mirror", 512, 1.0),
    "train.rubber": ("rubber", 256, 0.0),
}
FLAT = {"soot", "party", "rubber"}  # no roughness/normal maps


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
    for name, rgb, strength in (("train.lamp", (1.0, 0.78, 0.5), LAMP_STRENGTH), ("train.firebox", (1.0, 0.42, 0.1), 1.0),
                                 ("train.led", (1.0, 0.12, 0.05), 1.0)):
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
        # A part key is a material name, or "material@part" for a second object with the same
        # material (a moving part); part_sway marks ONE object (key -> sway) instead of all.
        self.part_sway = {}

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

    def obox(self, mat, c, rot, half):
        """An oriented box: centre c, a game-space rotation (3x3), half extents (x, y, z)."""
        c, (hx, hy, hz) = mathutils.Vector(c), half
        pts = [tuple(c + rot @ mathutils.Vector((sx * hx, sy * hy, sz * hz)))
               for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), (-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1))]
        for ids in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)):
            self.quad(mat, [pts[i] for i in ids])

    def loft(self, mat, rings, shift=None):
        """A closed skin through rings of game-space points (equal counts), capped at both
        ends. shift: (du, dv) added to the faces' UVs (a different patch of the texture)."""
        b = self.bm(mat)
        if shift:   # layers first: adding a layer invalidates existing face references
            su = b.faces.layers.float.get("uvshift_u") or b.faces.layers.float.new("uvshift_u")
            sv = b.faces.layers.float.get("uvshift_v") or b.faces.layers.float.new("uvshift_v")
        vs = [[b.verts.new(g(*p)) for p in r] for r in rings]
        n, faces = len(rings[0]), []
        for lo, hi in zip(vs, vs[1:]):
            for k in range(n):
                j = (k + 1) % n
                faces.append(b.faces.new([lo[k], lo[j], hi[j], hi[k]]))
        faces += [b.faces.new(vs[0][::-1]), b.faces.new(vs[-1])]
        bmesh.ops.recalc_face_normals(b, faces=faces)
        if shift:
            for f in faces:
                f[su], f[sv] = shift
        return faces

    def tube(self, mat, pts, r, n=6, shift=None):
        """A tube (hose, cable, bent bar) of radius r along a game-space polyline."""
        P = [mathutils.Vector(p) for p in pts]
        rings, u = [], None
        for i, p in enumerate(P):
            t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
            if u is None:
                ref = mathutils.Vector((0, 1, 0)) if abs(t.y) < 0.9 else mathutils.Vector((1, 0, 0))
                u = t.cross(ref).normalized()
            else:   # parallel transport: no twist between rings
                u = (u - t * u.dot(t)).normalized()
            w = t.cross(u)
            rings.append([tuple(p + r * (math.cos(2 * math.pi * k / n) * u + math.sin(2 * math.pi * k / n) * w)) for k in range(n)])
        return self.loft(mat, rings, shift)

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
        for key, b in self.parts.items():
            mat, _, part = key.partition("@")
            bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
            uv = b.loops.layers.uv.new("UVMap")
            su, sv = b.faces.layers.float.get("uvshift_u"), b.faces.layers.float.get("uvshift_v")
            for f in b.faces:
                n = f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                du, dv = (f[su], f[sv]) if su else (0.0, 0.0)
                for loop in f.loops:
                    co = loop.vert.co
                    u, v = [(co[1], co[2]), (co[0], co[2]), (co[0], co[1])][ax]
                    loop[uv].uv = (u + du, v + dv) if su else (u, v)
            if su:
                b.faces.layers.float.remove(su)
                b.faces.layers.float.remove(sv)
            me = bpy.data.meshes.new(f"{self.name}.{mat.split('.')[-1].split(':')[-1]}" + (f"-{part}" if part else ""))
            b.to_mesh(me)
            b.free()
            me.materials.append(mats[mat])
            ob = bpy.data.objects.new(me.name, me)
            sway = self.part_sway.get(key, self.sway)
            if sway:
                ob["sway"] = sway
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
    for x, z, drop in ((-0.8, -0.3, 0.45), (-0.4, -0.9, 0.6), (0.3, -0.5, 0.5), (0.75, -1.4, 0.35)):
        p.box("train.party", (x - 0.015, -drop, z - 0.002), (x + 0.015, 0.0, z + 0.002))
    return p


def bunting(width):
    """A sagging line of pennants across the carriage (origin: centre, at its fixing height)."""
    p = Piece(f"bunting-{dm(width)}")
    W = width / 2 - 0.2
    n = 9
    pts = [(-W + 2 * W * i / n, -0.35 * (1 - ((2 * i / n) - 1) ** 2)) for i in range(n + 1)]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        b = p.bm("train.party")
        mx = (xa + xb) / 2
        v = [b.verts.new(g(mx - 0.08, ya, 0)), b.verts.new(g(mx + 0.08, yb, 0)), b.verts.new(g(mx, (ya + yb) / 2 - 0.15, 0))]
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


# ---- the second pass: third class, coat check, the Boiler Room, the tender --------------------
#
# Footprints are the collision boxes of scripts/levels/night_train_layout.py. "Floor" pieces have
# their origin at the floor centre of the footprint; "wall" pieces at the wall plane (x = 0, the
# room at +x) and floor level, centred along z, like the booth and the boiler.

WOOD, WOOL, RUB = "train.wood-worn", "train.wool", "train.rubber"


def rot(axis, angle):
    """A game-space rotation about 'X' | 'Y' | 'Z'."""
    return mathutils.Matrix.Rotation(angle, 3, axis)


def third_bench():
    """A hard third-class bench (floor piece), 1.15 m across (x) by 0.45 m (z), 0.95 m high:
    wooden slats on steel end frames. The sitter faces -z (the back is on the +z edge); yaw PI
    turns it to face +z."""
    p = Piece("third-bench")
    W, lean = 0.575, math.radians(10)
    for x in (-W + 0.015, 0.0, W - 0.015):                        # three steel frames
        p.box(SX, (x - 0.015, 0.0, -0.2), (x + 0.015, 0.41, -0.17))          # front leg
        p.box(SX, (x - 0.015, 0.0, 0.1), (x + 0.015, 0.41, 0.13))            # rear leg
        p.box(SX, (x - 0.015, 0.38, -0.215), (x + 0.015, 0.41, 0.13))        # seat bearer
        p.box(SX, (x - 0.015, 0.06, -0.2), (x + 0.015, 0.09, 0.13))          # stretcher
        if x != 0.0:   # the back upright, leaning back from the seat's rear edge
            L = 0.55
            c = (x, 0.41 + L / 2 * math.cos(lean), 0.115 + L / 2 * math.sin(lean))
            p.obox(SX, c, rot("X", lean), (0.015, L / 2, 0.015))
    for i in range(4):                                             # seat slats
        z0 = -0.225 + i * 0.087
        p.box(WOOD, (-W, 0.41, z0), (W, 0.435, z0 + 0.072))
    for y in (0.56, 0.7, 0.84):                                    # back slats
        t = y - 0.41
        c = (0.0, 0.41 + t * math.cos(lean), 0.089 + t * math.sin(lean))
        p.obox(WOOD, c, rot("X", lean), (W, 0.045, 0.011))
    p.cyl(S, (-W + 0.02, 0.41 + 0.53 * math.cos(lean), 0.115 + 0.53 * math.sin(lean)), "x", 2 * W - 0.04, 0.014, 8)  # grab rail
    return p


def coat_rack():
    """A coat-check rail (floor piece), 2.4 m long along z by 0.4 m (x), 1.8 m high, crowded with
    dark greatcoats and a few hats on the shelf; symmetric (no facing). The build turns it with
    yaw PI/2 to run across the car; zscale stretches its length."""
    import random
    rnd = random.Random(6)
    p = Piece("coat-rack")
    L = 1.2
    for s in (-1, 1):
        z = s * (L - 0.03)
        p.box(SX, (-0.02, 0.0, z - 0.02), (0.02, 1.8, z + 0.02))                     # post
        p.box(SX, (-0.2, 0.0, z - 0.03), (0.2, 0.05, z + 0.03))                       # foot
    p.cyl(S, (0.0, 1.68, -L + 0.05), "z", 2 * L - 0.1, 0.014, 8)                      # the rail
    p.box("train.grate", (-0.19, 1.77, -L + 0.05), (0.19, 1.79, L - 0.05))           # hat shelf
    for x in (-0.2, 0.18):
        p.box(SX, (x, 1.76, -L + 0.03), (x + 0.02, 1.8, L - 0.03))
    n = 19
    for i in range(n):
        z = -L + 0.12 + i * (2 * L - 0.24) / (n - 1) + rnd.uniform(-0.02, 0.02)
        yaw = rnd.uniform(-0.15, 0.15)
        R = rot("Y", yaw)
        w = rnd.uniform(0.17, 0.19)                         # half the shoulder width (along x)
        d = rnd.uniform(0.065, 0.085)                        # half the thickness (along z)
        hem = rnd.uniform(0.3, 0.75)
        flare = rnd.uniform(1.0, 1.12)
        # (y, half width, half depth) from the collar down to the hem
        prof = [(1.665, 0.05, 0.035), (1.6, w * 0.9, d * 0.8), (1.52, w, d), (1.3, w * 0.95, d * 1.05),
                (1.0, w * 0.9, d), (hem, min(w * flare, 0.195), d * 1.1)]
        rings = []
        for y, hw, hd in prof:
            ring = []
            for k in range(8):
                a = 2 * math.pi * (k + 0.5) / 8
                ca, sa = math.cos(a), math.sin(a)
                # a rounded box: squarer than an ellipse, so the coats read as cloth, not tubes
                ex = hw * math.copysign(abs(ca) ** 0.6, ca) * rnd.uniform(0.96, 1.03)
                ez = hd * math.copysign(abs(sa) ** 0.6, sa) * rnd.uniform(0.92, 1.06)
                v = R @ mathutils.Vector((ex, 0.0, ez))
                ring.append((v.x, y + rnd.uniform(-0.01, 0.01) * (y < 1.5), z + v.z))
            rings.append(ring)
        shift = (rnd.random(), rnd.random())
        p.loft(WOOL, rings, shift)
        for s in (-1, 1):                                    # sleeves, hanging at the sides
            top = R @ mathutils.Vector((s * (w - 0.03), 0.0, 0.0))
            bot = R @ mathutils.Vector((s * (w - 0.015), 0.0, rnd.uniform(-0.03, 0.03)))
            p.tube(WOOL, [(top.x, 1.53, z + top.z), (bot.x * 1.02, 1.25, z + bot.z), (bot.x, 0.92 + rnd.uniform(0, 0.08), z + bot.z)],
                   0.045, 6, shift)
        p.box(SX, (-0.004, 1.665, z - 0.004), (0.004, 1.695, z + 0.004))            # the hook
    for z, kind in ((-0.85, "bowler"), (-0.3, "cap"), (0.2, "fedora"), (0.75, "bowler"), (1.0, "fedora")):
        x = rnd.uniform(-0.03, 0.03)
        shift = (rnd.random(), rnd.random())
        if kind == "cap":   # a peaked cap: a flat crown and a peak
            p.cyl(WOOL, (x, 1.79, z), "y", 0.07, 0.1, 10)
            p.box(RUB, (x - 0.08, 1.79, z - 0.16), (x + 0.08, 1.8, z - 0.08))
            continue
        p.cyl(WOOL, (x, 1.79, z), "y", 0.012, 0.15 if kind == "fedora" else 0.13, 12)   # brim
        p.cyl(WOOL, (x, 1.8, z), "y", 0.11 if kind == "fedora" else 0.1, 0.09, 10, r_end=0.075 if kind == "fedora" else 0.05)
    return p


def counter():
    """The attendant's counter (floor piece), 2.4 m long along z by 0.5 m (x), 1.0 m high: a
    worn wooden top on a riveted steel front. The customers' side (the front) faces +x; the
    build turns it with yaw -PI/2 to run across the car with the front facing +z (south), or
    +PI/2 for the front facing -z."""
    import random
    rnd = random.Random(3)
    p = Piece("counter")
    L = 1.2
    p.box(SX, (-0.22, 0.0, -L + 0.02), (0.19, 0.95, L - 0.02))                      # the carcass
    p.box(PL, (0.19, 0.08, -L + 0.03), (0.22, 0.95, L - 0.03))                      # riveted front
    p.box(SX, (0.18, 0.0, -L + 0.01), (0.235, 0.08, L - 0.01))                      # kick plate
    for z in (-0.6, 0.0, 0.6):
        p.box(SX, (0.22, 0.08, z - 0.03), (0.235, 0.95, z + 0.03))                  # straps
    p.box(WOOD, (-0.25, 0.95, -L), (0.25, 1.0, L))                                  # the top
    p.box(SX, (-0.22, 0.45, -L + 0.05), (-0.2, 0.47, L - 0.05))                     # shelf lip, staff side
    # a brass bell
    bx, bz = 0.08, 0.75
    p.cyl(BR, (bx, 1.0, bz), "y", 0.012, 0.05, 12)
    p.cyl(BR, (bx, 1.012, bz), "y", 0.04, 0.045, 12, r_end=0.012)
    p.cyl(BR, (bx, 1.052, bz), "y", 0.018, 0.006, 6)
    p.cyl(BR, (bx, 1.07, bz), "y", 0.006, 0.012, 8)
    # ticket stubs: a spike with a stack, and loose stubs
    sx, sz = -0.08, -0.55
    p.cyl(SX, (sx, 1.0, sz), "y", 0.01, 0.04, 8)
    p.cyl(SX, (sx, 1.01, sz), "y", 0.13, 0.003, 4)
    for i in range(9):
        p.obox("train.canvas", (sx + rnd.uniform(-0.005, 0.005), 1.015 + i * 0.006, sz), rot("Y", rnd.uniform(0, math.pi)),
               (0.035, 0.0012, 0.018))
    for i in range(7):
        c = (rnd.uniform(-0.18, 0.15), 1.0015, rnd.uniform(-0.35, 0.45))
        p.obox("train.canvas", c, rot("Y", rnd.uniform(0, math.pi)), (0.035, 0.0012, 0.018))
    return p


def dj_deck():
    """The DJ deck (wall piece, the room at +x), 0.8 m deep (x) by 1.8 m long (z), 1.1 m high:
    two turntables and a mixer on a steel flight case, a speaker stack at each end, cables,
    tiny red LEDs (train.led). Its front faces the room (+x)."""
    p = Piece("dj-deck")
    LED = "train.led"
    # the flight case
    p.box(SX, (0.12, 0.0, -0.55), (0.74, 0.88, 0.55))
    for x in (0.12, 0.72):
        for z in (-0.55, 0.53):
            p.box(S, (x - 0.005, 0.0, z - 0.005), (x + 0.025, 0.88, z + 0.025))    # edge extrusions
    p.box(S, (0.115, 0.86, -0.56), (0.745, 0.89, 0.56))                              # lid rim
    p.box(PL, (0.74, 0.08, -0.5), (0.75, 0.8, 0.5))                                  # front panel
    for z in (-0.35, 0.35):
        p.box(BR, (0.745, 0.42, z - 0.05), (0.765, 0.46, z + 0.05))                 # latches
    for i in range(8):
        z = -0.21 + i * 0.06
        p.box(LED, (0.75, 0.74, z - 0.008), (0.756, 0.752, z + 0.008))
    # turntables
    for zc in (-0.3, 0.3):
        p.box(S, (0.2, 0.89, zc - 0.22), (0.66, 0.96, zc + 0.22))
        p.cyl(RUB, (0.42, 0.96, zc - 0.02), "y", 0.018, 0.16, 20)                   # platter
        p.cyl("train.party", (0.42, 0.978, zc - 0.02), "y", 0.002, 0.045, 12)       # label
        p.cyl(S, (0.42, 0.978, zc - 0.02), "y", 0.012, 0.004, 4)                    # spindle
        p.cyl(SX, (0.6, 0.96, zc + 0.16), "y", 0.035, 0.02, 8)                      # arm pivot
        p.obox(S, (0.54, 0.99, zc + 0.08), rot("Y", math.atan2(-0.06, -0.08)), (0.005, 0.004, 0.1))  # tonearm
        p.box(LED, (0.63, 0.96, zc - 0.19), (0.645, 0.964, zc - 0.175))
    # the mixer
    p.box(SX, (0.24, 0.89, -0.075), (0.62, 0.99, 0.075))
    for x in (0.3, 0.36, 0.42):
        for z in (-0.035, 0.035):
            p.cyl(RUB, (x, 0.99, z), "y", 0.02, 0.012, 8)
    for z in (-0.04, 0.0, 0.04):
        p.box(S, (0.5, 0.99, z - 0.006), (0.53, 1.0, z + 0.006))
    for i in range(5):
        p.box(LED, (0.47 + i * 0.022, 0.99, 0.058), (0.482 + i * 0.022, 0.993, 0.066))
    # speaker stacks at the ends
    for s in (-1, 1):
        z0, z1 = sorted((s * 0.57, s * 0.9))
        zc = (z0 + z1) / 2
        p.box(SX, (0.2, 0.0, z0), (0.78, 0.6, z1))
        p.box(SX, (0.24, 0.6, z0 + 0.02), (0.76, 1.1, z1 - 0.02))
        p.cyl(RUB, (0.78, 0.3, zc), "x", 0.012, 0.15, 16)                            # woofer surround
        p.cyl(RUB, (0.77, 0.3, zc), "x", 0.02, 0.13, 16, r_end=0.04)                  # cone
        p.cyl(S, (0.785, 0.3, zc), "x", 0.006, 0.04, 10)                              # dust cap
        p.cyl(RUB, (0.76, 0.93, zc), "x", 0.012, 0.09, 14)                            # mid
        p.cyl(S, (0.765, 0.93, zc), "x", 0.006, 0.03, 8)
        p.box(RUB, (0.755, 0.68, zc - 0.11), (0.765, 0.78, zc + 0.11))                # horn
        p.box(LED, (0.76, 1.05, zc + 0.1), (0.766, 1.06, zc + 0.11))
        for x in (0.2, 0.76):                                                          # corner steel
            for y0, y1 in ((0.0, 0.03), (0.57, 0.63), (1.07, 1.1)):
                p.box(S, (x, y0, z0), (x + 0.02, y1, z1))
    # cables: turntables to the mixer, the mixer over the back and down, loops on the floor
    p.tube(RUB, [(0.22, 0.93, -0.25), (0.18, 0.97, -0.17), (0.25, 0.99, -0.08)], 0.006, 5)
    p.tube(RUB, [(0.22, 0.93, 0.25), (0.18, 0.97, 0.17), (0.25, 0.99, 0.08)], 0.006, 5)
    p.tube(RUB, [(0.25, 0.97, 0.0), (0.1, 0.93, 0.02), (0.06, 0.6, 0.05), (0.07, 0.02, 0.1), (0.13, 0.012, 0.35),
                 (0.16, 0.012, 0.62)], 0.01, 5)
    p.tube(RUB, [(0.25, 0.97, -0.03), (0.09, 0.92, -0.05), (0.05, 0.5, -0.08), (0.06, 0.012, -0.2), (0.12, 0.012, -0.45),
                 (0.08, 0.012, -0.62), (0.16, 0.08, -0.7)], 0.01, 5)
    return p


def disco_ball():
    """A mirror ball on a short chain below a motor. Origin: its fixing point (the ceiling pipe's
    underside); the ball's centre is 0.53 m below, on the origin's vertical axis, so the game
    spins the ball (sway = "spin") about the instance's y axis."""
    p = Piece("disco-ball")
    p.part_sway["train.mirror"] = "spin"
    p.box(SX, (-0.05, -0.02, -0.05), (0.05, 0.0, 0.05))                              # clamp plate
    p.cyl(SX, (0.0, -0.08, 0.0), "y", 0.06, 0.04, 10)                               # the motor
    for i in range(7):                                                               # chain links
        y = -0.1 - i * 0.03
        p.obox(SX, (0.0, y, 0.0), rot("Y", (i % 2) * math.pi / 2), (0.01, 0.018, 0.003))
    b = p.bm("train.mirror")
    r, cy = 0.25, -0.53
    res = bmesh.ops.create_uvsphere(b, u_segments=28, v_segments=16, radius=r,
                                    matrix=mathutils.Matrix.Translation(g(0.0, cy, 0.0)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.smooth = False
    p.cyl("train.mirror", (0.0, cy + r - 0.01, 0.0), "y", 0.03, 0.025, 8)          # the cap
    return p


def piston(height=3.4):
    """Heavy pneumatic machinery (wall piece, the room at +x), 0.7 m (x) by 0.8 m (z), floor to
    ceiling (3.4 m): a steel frame, a big cylinder with gauges and hoses, and the moving rod and
    hammer head, its own object (sway = "piston"). At rest the hammer is UP (its face 0.55 m above
    the anvil); the game moves that object down along y by up to 0.55 m and back."""
    p = Piece("piston")
    H = height
    for x in (0.02, 0.62):
        for z in (-0.38, 0.32):
            p.box(SX, (x, 0.0, z), (x + 0.06, H, z + 0.06))                          # posts
    p.box(PL, (0.0, 0.0, -0.4), (0.7, 0.12, 0.4))                                    # base plate
    p.box(PL, (0.0, H - 0.15, -0.4), (0.7, H, 0.4))                                  # head plate
    p.box(SX, (0.2, 0.12, -0.16), (0.5, 0.4, 0.16))                                  # the anvil
    for y in (1.6, 2.1):
        p.box(SX, (0.02, y, -0.38), (0.08, y + 0.08, 0.38))                          # back rails
        for z in (-0.38, 0.32):
            p.box(SX, (0.08, y, z), (0.62, y + 0.08, z + 0.06))                      # side rails
    p.box(SX, (0.08, 2.1, -0.32), (0.62, 2.18, 0.32))                                # cylinder deck
    p.cyl(S, (0.35, 2.18, 0.0), "y", 1.0, 0.2, 16)                                   # the cylinder
    for y in (2.18, 3.08):
        p.cyl(SX, (0.35, y, 0.0), "y", 0.07, 0.235, 16)                             # flanges
    p.cyl(SX, (0.35, 3.15, 0.0), "y", H - 0.15 - 3.15, 0.07, 10)                    # stem to the head
    p.cyl(SX, (0.35, 2.02, 0.0), "y", 0.08, 0.08, 12)                               # gland
    for y, z in ((2.55, 0.1), (2.8, -0.08)):
        p.cyl(PIPE, (0.53, y, z), "x", 0.04, 0.012, 6)
        p.cyl(BR, (0.57, y, z), "x", 0.03, 0.055, 14)
        p.cyl(S, (0.6, y, z), "x", 0.004, 0.045, 14)
    p.tube(RUB, [(0.35, 3.08, 0.2), (0.3, 3.0, 0.3), (0.12, 2.95, 0.3), (0.05, 2.8, 0.2), (0.04, 1.0, 0.2), (0.04, 0.12, 0.25)], 0.03, 6)
    p.tube(RUB, [(0.55, 2.3, -0.12), (0.62, 2.2, -0.25), (0.5, 2.0, -0.36), (0.12, 1.9, -0.36), (0.04, 1.6, -0.3), (0.04, 0.12, -0.3)],
           0.025, 6)
    p.tube(PIPE, [(0.35, H - 0.15, 0.1), (0.35, H - 0.4, 0.25), (0.35, 3.1, 0.25)], 0.03, 6)
    p.wall_x("train.soot", 0.004, 1, -0.4, 0.4, 0, 0.5)
    # the moving part: rod and hammer head, one object
    mv = "train.steel@piston"
    p.part_sway[mv] = "piston"
    p.cyl(mv, (0.35, 0.95, 0.0), "y", 2.0, 0.065, 12)
    p.box(mv, (0.18, 0.95, -0.17), (0.52, 1.25, 0.17))
    p.box(mv, (0.2, 1.25, -0.12), (0.5, 1.33, 0.12))
    return p


def steam_vent():
    """A floor steam vent (floor piece), 0.6 x 0.6 m: a grate in a steel frame, with a riser pipe
    and valve wheel at one corner. The grate carries sway = "steam" (the game spawns plumes at
    each instance's origin, the grate's centre)."""
    p = Piece("steam-vent")
    p.part_sway["train.grate"] = "steam"
    h = 0.03
    p.box(SX, (-0.3, 0.0, -0.3), (0.3, h, -0.25))
    p.box(SX, (-0.3, 0.0, 0.25), (0.3, h, 0.3))
    p.box(SX, (-0.3, 0.0, -0.25), (-0.25, h, 0.25))
    p.box(SX, (0.25, 0.0, -0.25), (0.3, h, 0.25))
    for x in (-0.3, 0.29):
        for z in (-0.3, 0.29):
            p.box(BR, (x + 0.01, h, z + 0.01), (x + 0.02, h + 0.006, z + 0.02))
    p.floor("train.grate", h - 0.008, 1, -0.25, 0.25, -0.25, 0.25)
    p.floor(RUB, 0.001, 1, -0.25, 0.25, -0.25, 0.25)   # the dark pit under the grate (seen through it)
    # the riser: a pipe from the frame's corner, an elbow, a valve wheel
    p.cyl(PIPE, (0.2, h, 0.2), "y", 0.3, 0.035, 8)
    p.cyl(SX, (0.2, h, 0.2), "y", 0.03, 0.05, 8)
    p.cyl(SX, (0.2, 0.33, 0.2), "y", 0.05, 0.045, 8)
    p.cyl(SX, (0.2, 0.38, 0.2), "y", 0.06, 0.012, 6)
    n, cy, ri, ro, th = 16, 0.44, 0.06, 0.08, 0.02
    b = p.bm(BR)

    def ring(rad, y):
        return [b.verts.new(g(0.2 + rad * math.cos(2 * math.pi * k / n), y, 0.2 + rad * math.sin(2 * math.pi * k / n))) for k in range(n)]
    io, oo, iu, ou = ring(ri, cy + th / 2), ring(ro, cy + th / 2), ring(ri, cy - th / 2), ring(ro, cy - th / 2)
    for k in range(n):
        j = (k + 1) % n
        for f in ((io[k], oo[k], oo[j], io[j]), (iu[j], ou[j], ou[k], iu[k]), (oo[k], ou[k], ou[j], oo[j]), (io[j], iu[j], iu[k], io[k])):
            b.faces.new(f)
    for dx, dz in ((ro, 0.0), (0.0, ro)):
        p.box(BR, (0.2 - dx - 0.008, cy - 0.008, 0.2 - dz - 0.008), (0.2 + dx + 0.008, cy + 0.008, 0.2 + dz + 0.008))
    return p


def coal_heap():
    """The tender's coal bunker (wall piece, the room at +x), 1.5 m (x) by 6.8 m (z), the coal
    heaped up to 1.2 m inside a riveted steel bunker wall (0.9 m) and end walls."""
    import random
    from mathutils import noise
    rnd = random.Random(7)
    p = Piece("coal-heap")
    Wd, L = 1.5, 3.4
    p.box(PL, (1.4, 0.0, -L), (1.46, 0.9, L))                                        # bunker wall
    p.box(SX, (1.38, 0.9, -L), (1.5, 0.95, L))                                       # its cap
    for s in (-1, 1):
        z0, z1 = sorted((s * L, s * (L - 0.06)))
        p.box(PL, (0.0, 0.0, z0), (1.46, 0.9, z1))                                   # end walls
        p.box(SX, (0.0, 0.9, z0), (1.5, 0.95, z1))
    for i in range(7):
        z = -L + 0.05 + i * (2 * L - 0.1) / 6
        p.box(SX, (1.46, 0.0, z - 0.04), (1.5, 0.9, z + 0.04))                       # ribs
    p.wall_x("train.soot", 1.505, 1, -L, L, 0.0, 0.5)
    # the heap: a noisy height field, highest against the carriage wall and mid-bunker
    nx, nz = 10, 40
    x0, x1, z0, z1 = 0.0, 1.4, -L + 0.06, L - 0.06

    def height(x, z):
        u = (z - z0) / (z1 - z0)
        along = math.sin(math.pi * u) ** 0.5
        across = 1.0 - 0.3 * (x - x0) / (x1 - x0)
        n = noise.noise(mathutils.Vector((x * 2.2, z * 1.3, 0.5)))
        n2 = noise.noise(mathutils.Vector((x * 7.0, z * 7.0, 3.3)))
        return max(0.5, min(1.18, 0.55 + 0.55 * along * across + 0.12 * n + 0.03 * n2))
    b = p.bm("train.coal")
    grid = [[b.verts.new(g(x0 + (x1 - x0) * i / nx, height(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * k / nz), z0 + (z1 - z0) * k / nz))
             for k in range(nz + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for k in range(nz):
            b.faces.new([grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]])   # facing up
    for _ in range(90):                                                              # lumps
        x, z = rnd.uniform(x0 + 0.08, x1 - 0.08), rnd.uniform(z0 + 0.08, z1 - 0.08)
        r = rnd.uniform(0.04, 0.1)
        m = mathutils.Matrix.Translation(g(x, height(x, z) + r * 0.2, z)) @ mathutils.Matrix.Diagonal((1.0, 1.0, 0.7, 1.0))
        res = bmesh.ops.create_icosphere(b, subdivisions=1, radius=r, matrix=m)
        for v in res["verts"]:
            v.co += mathutils.Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * r * 0.25
    return p


def shovel():
    """A coal shovel leaning on a wall (wall piece, the room at +x): the blade on the floor
    0.45 m out, the grip against the wall at 1.15 m. Width (z) 0.26 m."""
    p = Piece("shovel")
    B, T = mathutils.Vector((0.45, 0.006, 0.0)), mathutils.Vector((0.035, 1.15, 0.0))
    d = (T - B).normalized()
    R = rot("Z", math.atan2(-d.x, d.y))
    side = R @ mathutils.Vector((1, 0, 0))                                  # the blade's normal (toward the wall, up)
    c = B + d * 0.15
    p.obox("train.rust", c, R, (0.004, 0.15, 0.13))                                 # the blade
    for s in (-1, 1):
        p.obox("train.rust", c + side * 0.01 + mathutils.Vector((0, 0, s * 0.128)), R, (0.01, 0.14, 0.004))  # lips
    j = B + d * 0.3
    p.tube(SX, [tuple(j - d * 0.08 + side * 0.012), tuple(j + d * 0.06 + side * 0.012)], 0.02, 8)       # socket
    g0 = T - d * 0.13
    p.tube(WOOD, [tuple(j + side * 0.012), tuple(g0 + side * 0.012)], 0.017, 8)                       # shaft
    # the D grip
    q = [g0 + side * 0.012, g0 + d * 0.04 + mathutils.Vector((0, 0, 0.055)) + side * 0.012,
         T + mathutils.Vector((0, 0, 0.055)) + side * 0.012, T - mathutils.Vector((0, 0, 0.055)) + side * 0.012,
         g0 + d * 0.04 - mathutils.Vector((0, 0, 0.055)) + side * 0.012, g0 + side * 0.012]
    p.tube(SX, [tuple(v) for v in q], 0.011, 6)
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
        third_bench(), coat_rack(), counter(), dj_deck(), disco_ball(), piston(), steam_vent(), coal_heap(), shovel(),
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
    only = [n for n in arg("--render-only", "").split(",") if n]
    for c in colls:
        if only and c.name not in only:
            continue
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
