# scripts/levels/flat/materials.py
"""The Flat's materials: plain glTF-exportable PBR (Principled BSDF over image textures), replacing room.py's Cycles node trees.

`make()` returns a namespace M; builders use M.STONE_N etc. Textures come from assets-source/levels/flat-textures/ (make_textures.py).
Emission is capped at 1 by the engine (ART_EMISSIVE_CAP), so emissive materials use strength 1.
Run inside Blender.
"""
import os
from types import SimpleNamespace

import bpy

TEX = os.path.abspath("assets-source/levels/flat-textures")


def _image(nt, file, color=True):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(os.path.join(TEX, file), check_existing=True)
    t.image.colorspace_settings.name = "sRGB" if color else "Non-Color"
    t.extension = "REPEAT"
    return t


def pbr(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, tex=None, normal=None, normal_strength=1.0, emit=None, emit_tex=None):
    """color: (r, g, b); tex/normal: file names in TEX; emit: (r, g, b) at strength 1; emit_tex: a file shown as emission."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1.0)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if tex:
        nt.links.new(_image(nt, tex).outputs["Color"], p.inputs["Base Color"])
    if normal:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(_image(nt, normal, color=False).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    if emit_tex:
        p.inputs["Base Color"].default_value = (0, 0, 0, 1)
        nt.links.new(_image(nt, emit_tex).outputs["Color"], p.inputs["Emission Color"])
        p.inputs["Emission Strength"].default_value = 1.0
    elif emit:
        p.inputs["Emission Color"].default_value = (*emit, 1.0)
        p.inputs["Emission Strength"].default_value = 1.0
    return m


def stone(name, key, rough=0.82):
    return pbr(name, tex=f"{key}_color.png", normal=f"{key}_normal.png", rough=rough, normal_strength=0.8)


def make():
    M = SimpleNamespace()
    # stone (colour and normal from the textures; rough 0.82 as the look-dev)
    M.STONE_N, M.STONE_E, M.STONE_W, M.STONE_S = (stone(f"stone_{k}", f"wall_{k}") for k in "news")
    M.STONE = M.STONE_DARK                                # the sink counter top (a 1 m tile, not a wall-sized texture)
    M.STONE_DARK = stone("stone_dark", "dark")
    M.VAULT = stone("vault", "vault")
    M.FLAG = stone("flagstone", "flag")
    M.MORTAR = pbr("mortar", (0.05, 0.045, 0.04), rough=0.95)
    # wood, metal, bone, flesh (room.py 310-325)
    M.OAK = pbr("oak", (0.12, 0.065, 0.03), rough=0.6)
    M.IRON = pbr("iron", (0.05, 0.045, 0.04), rough=0.55, metal=0.85)
    M.GUN = pbr("gunmetal", (0.06, 0.065, 0.07), rough=0.35, metal=0.85)
    M.BONE = pbr("bone", (0.58, 0.52, 0.40), rough=0.38)
    M.GASKET = pbr("gasket", (0.42, 0.10, 0.09), rough=0.25)
    # the floor and the soft goods
    M.TATAMI = pbr("tatami", tex="tatami.png", rough=0.62)
    M.HERI = pbr("heri", (0.02, 0.03, 0.025), rough=0.7)
    M.KOTATSU = pbr("kotatsu_board", (0.32, 0.17, 0.08), rough=0.3)
    M.QUILT = pbr("quilt", tex="quilt.png", rough=0.9)
    M.FUTON = pbr("futon", (0.88, 0.86, 0.80), rough=0.9)
    M.DUVET = pbr("duvet", (0.98, 0.88, 0.55), rough=0.9)
    M.PILLOW = pbr("pillow", (0.6, 0.85, 0.85), rough=0.9)
    M.FRIDGE = pbr("fridge", (0.62, 0.86, 0.80), rough=0.22)
    M.BOOKS = pbr("books", tex="books.png", rough=0.35)
    # lights as objects (emissive: the engine caps emission at 1)
    M.PAPER = pbr("lantern_paper", (0.5, 0.05, 0.03), emit=(0.9, 0.12, 0.05))
    M.LACQUER = pbr("lacquer", (0.02, 0.02, 0.02), rough=0.2)
    M.BULBS = [pbr(f"bulb{k}", c, emit=c) for k, c in enumerate(((1, 0.6, 0.8), (0.6, 0.9, 1), (1, 0.9, 0.5), (0.7, 1, 0.7)))]
    M.WAX = pbr("wax", (0.92, 0.88, 0.75), rough=0.5)
    M.FLAME = pbr("flame", (1, 0.8, 0.4), emit=(1.0, 0.7, 0.3))
    M.VIEW = pbr("view", emit_tex="view.png")
    M.AMBER = pbr("amber_placeholder", (1.0, 0.55, 0.15), rough=0.3, emit=(1.0, 0.5, 0.12))
    return M
