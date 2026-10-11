# scripts/levels/build_the_flat.py
"""The Flat's room (spec docs/superpowers/specs/2026-10-11-flat-room-design.md).

    python3 scripts/levels/flat/make_textures.py            # once, and after any texture change
    blender --background --factory-startup --python scripts/levels/build_the_flat.py
    blender --background assets-source/levels/flat.blend --python scripts/levels/export_level.py -- public/assets/levels/flat.level.json

Blender space (x, y, z), z up; north (the window) is +y; game (x, y, z) = Blender (x, z, -y).
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import flat_layout as L  # noqa: E402
from flat import common as C  # noqa: E402
from flat import materials  # noqa: E402

OUT = os.path.abspath("assets-source/levels/flat.blend")


def gbox(collection, name, bmin, bmax, wire=False):
    """A box in Blender space (min and max corners) in `collection`."""
    mesh = bpy.data.meshes.new(name)
    verts = [(x, y, z) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    mesh.from_pydata(verts, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    obj = bpy.data.objects.new(name, mesh)
    if wire:
        obj.display_type = "WIRE"
    C.collection(collection).objects.link(obj)
    return obj


def build_markers_lights_collision():
    room = gbox("rooms", "room:1:flat", L.ROOM_BOX[0], L.ROOM_BOX[1], wire=True)
    room["shell"] = "art"                           # the art is the room's look; the generated surfaces are not drawn
    for name, (bmin, bmax) in L.COLLISION.items():
        gbox("furniture", name, bmin, bmax, wire=True)
    for name, (bmin, bmax) in L.SOLIDS.items():           # the walls inside the room box: collision only, the art draws them
        gbox("solids", name, bmin, bmax, wire=True)
    start = bpy.data.objects.new("start", None)
    start.empty_display_type = "ARROWS"
    start.location = L.START[:3]
    C.collection("markers").objects.link(start)     # rotation 0: the +y arrow faces north, the window
    for name, pos, color, power, extra in L.LIGHTS:
        data = bpy.data.lights.new(name, "POINT")
        data.color = color
        data.energy = power * 10.0
        obj = bpy.data.objects.new(name, data)
        obj.location = pos
        obj["power"] = power
        for k, v in extra.items():
            obj[k] = v
        C.collection("lights").objects.link(obj)


def assert_scene():
    for o in C.dressing().all_objects:
        if o.type == "MESH":
            assert len(o.material_slots) == 1, f"{o.name}: one material per dressing object"
        else:
            raise SystemExit(f"{o.name}: only meshes may be in dressing (convert curves)")
    for img in bpy.data.images:
        assert max(img.size) <= 1024, f"{img.name} is {tuple(img.size)}"
    for n in ("rooms", "furniture", "solids", "markers", "lights", "dressing"):
        assert C.collection(n).all_objects, f"collection {n} is empty"


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc["level_id"] = "flat"
    sc["level_name"] = "The Flat"
    sc["ammo"] = "infinite"
    C.use_dressing()
    M = materials.make()
    from flat import giger, imac, props, shell
    shell.build(M)
    giger.build(M)
    props.build(M)
    imac.build(M)
    build_markers_lights_collision()
    assert_scene()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, relative_remap=True)
    print(f"saved {OUT}")


main()
