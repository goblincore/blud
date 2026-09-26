"""Export a Blud level (.blend) to Level Format v1 JSON.

Runs INSIDE Blender:

    blender --background assets-source/levels/the-wake.blend \
        --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json

Spec: docs/superpowers/specs/2026-09-23-level-format-design.md
Conventions: docs/game/levels/blender-conventions.md
Validation lives in the game (level-json.ts); this script only refuses names it
cannot read. A non-empty `dressing` collection also exports as <id>.art.glb
(the mesh key: docs/superpowers/specs/2026-09-24-level-mesh-key-design.md).
"""
import json
import re
import sys

import bpy
from mathutils import Vector

DIGITS = 3


def rnd(v):
    r = round(float(v), DIGITS)
    return 0.0 if r == 0 else r


def out_path():
    argv = sys.argv
    if "--" not in argv or len(argv[argv.index("--") + 1:]) != 1:
        raise SystemExit("usage: blender --background X.blend --python export_level.py -- OUT.json")
    return argv[argv.index("--") + 1]


def to_game(v):
    return [rnd(v[0]), rnd(v[2]), rnd(-v[1])]


def world_aabb(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    return [rnd(min(xs)), rnd(min(zs)), rnd(-max(ys))], [rnd(max(xs)), rnd(max(zs)), rnd(-min(ys))]


def objects(name):
    coll = bpy.data.collections.get(name)
    return [] if coll is None else sorted(coll.all_objects, key=lambda o: o.name)


def base_name(obj):
    return re.sub(r"\.\d{3}$", "", obj.name)


def fields(obj, prefix, count):
    bits = base_name(obj).split(":")
    if bits[0] != prefix or len(bits) != count:
        raise SystemExit(f"bad name {obj.name!r}: expected {prefix} with {count} ':'-separated parts")
    return bits


def csv(value):
    return [s.strip() for s in str(value).split(",") if s.strip()]


def with_states(obj, item):
    if "states" in obj.keys():
        item["states"] = csv(obj["states"])
    return item


def yaw_of(obj):
    # Radians, not metres: millimetre rounding would move a yaw by up to 0.03°.
    return round(-obj.matrix_world.to_euler("XYZ").z, 4) + 0.0


def room_for(obj, rooms):
    if "room" in obj.keys():
        return int(obj["room"])
    gmin, gmax = world_aabb(obj)
    cx, cz = (gmin[0] + gmax[0]) / 2, (gmin[2] + gmax[2]) / 2
    for r in rooms:
        if r["min"][0] <= cx <= r["max"][0] and r["min"][1] <= cz <= r["max"][1]:
            return r["id"]
    def d2(r):
        rx, rz = (r["min"][0] + r["max"][0]) / 2, (r["min"][1] + r["max"][1]) / 2
        return (rx - cx) ** 2 + (rz - cz) ** 2
    return min(rooms, key=d2)["id"]


def export_art(doc, json_path):
    """Dressing -> <id>.art.glb. Mutates the loaded scene; the .blend is never saved."""
    dressing = bpy.data.collections.get("dressing")
    if dressing is None or not dressing.all_objects:
        return
    view = bpy.context.view_layer
    # 1. Linked kit pieces: collection-instance empties become real objects that SHARE
    #    their mesh data (linked duplicates), which the exporter writes as GPU instances.
    for inst in [o for o in dressing.all_objects if o.instance_type == "COLLECTION" and o.instance_collection]:
        for o in view.objects:
            o.select_set(False)
        inst.select_set(True)
        view.objects.active = inst
        room = room_for(inst, doc["rooms"])
        piece = inst.instance_collection
        originals = {ob.data.name: ob for ob in piece.all_objects if ob.type == "MESH"}
        bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=False)
        for o in bpy.context.selected_objects:
            if o.type == "MESH":
                o["room"] = room
                o["kit"] = piece.name
                o["kit_parts"] = len(originals)
                src = originals.get(o.data.name)
                if src is not None and "sway" in src.keys():
                    o["sway"] = str(src["sway"])
        bpy.data.objects.remove(inst)
    view.update()
    meshes = [o for o in dressing.all_objects if o.type == "MESH"]
    for o in meshes:
        if "room" not in o.keys():
            o["room"] = room_for(o, doc["rooms"])
    for o in meshes:
        for slot in o.material_slots:
            img_nodes = [n for n in (slot.material.node_tree.nodes if slot.material and slot.material.use_nodes else [])
                         if n.type == "TEX_IMAGE" and n.image]
            for n in img_nodes:
                if max(n.image.size) > 1024:
                    raise SystemExit(f"texture {n.image.name} is {n.image.size[0]}x{n.image.size[1]} (max 1024)")
    shared = {o.data.name for o in meshes if o.data.users > 1}
    # 2. Kit instances: one parent empty per (room, piece, part mesh), so each room's copies
    #    of one part are siblings (the exporter instances siblings that share a mesh). A
    #    one-mesh piece keeps the name kit:<room>:<piece>; a multi-part piece adds .<part>.
    parents = {}
    for o in [o for o in meshes if o.data.name in shared]:
        kit = o.get("kit", o.data.name)
        key = (int(o["room"]), kit, o.data.name)
        if key not in parents:
            name = f"kit:{key[0]}:{kit}" if int(o.get("kit_parts", 1)) == 1 else f"kit:{key[0]}:{kit}.{o.data.name}"
            p = bpy.data.objects.new(name, None)
            p["room"] = key[0]
            if "sway" in o.keys():
                p["sway"] = o["sway"]
            dressing.objects.link(p)
            parents[key] = p
        mw = o.matrix_world.copy()
        o.parent = parents[key]
        o.matrix_world = mw
    # 3. The rest: split by material, then join per (room, material, shadow).
    groups = {}
    for o in [o for o in meshes if o.data.name not in shared]:
        for m in o.modifiers[:]:
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
        mats = [s.material for s in o.material_slots] or [None]
        mat = mats[0]
        if len(mats) > 1:
            raise SystemExit(f"{o.name}: one material per dressing object (split it in Blender)")
        shadow = bool(o.get("shadow", True))
        key = (int(o["room"]), mat.name if mat else "none", shadow)
        groups.setdefault(key, []).append(o)
    for (room, mat, shadow), objs in groups.items():
        for o in view.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        view.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = view.objects.active
        j.name = f"art:{room}:{mat}" + ("" if shadow else ":noshadow")
        j["room"] = room
        if not shadow:
            j["shadow"] = False
    for o in view.objects:
        o.select_set(False)
    for o in dressing.all_objects:
        o.select_set(True)
    art_name = f"{doc['id']}.art.glb"
    art_path = json_path.rsplit("/", 1)[0] + "/" + art_name if "/" in json_path else art_name
    bpy.ops.export_scene.gltf(filepath=art_path, export_format="GLB", use_selection=True, export_yup=True,
                              export_extras=True, export_gpu_instances=True, export_cameras=False,
                              export_lights=False, export_apply=True, export_materials="EXPORT")
    doc["art"] = art_name
    print(f"art: {len(groups)} joined meshes, {len(parents)} instanced pieces -> {art_path}")


def main():
    scene = bpy.context.scene
    # matrix_world is only current after a depsgraph update. A scene built by a
    # script in the same headless session has none yet, so every marker and
    # light would export at the origin.
    bpy.context.view_layer.update()
    level_id = scene.get("level_id")
    if not level_id:
        raise SystemExit("scene custom property level_id is required")
    doc = {"version": 1, "id": level_id}
    if scene.get("level_name"):
        doc["name"] = scene["level_name"]
    if scene.get("skyline"):
        doc["skyline"] = scene["skyline"]
    if scene.get("ammo"):
        doc["ammo"] = scene["ammo"]
    if scene.get("loadout"):
        doc["loadout"] = csv(scene["loadout"])
    if scene.get("complete_on"):
        doc["completeOn"] = scene["complete_on"]
    if scene.get("states"):
        doc["states"] = csv(scene["states"])
    for key in ("rooms", "tunnels", "stairs", "furniture", "solids", "gates", "triggers", "windows",
                "lights", "spawns", "graves", "pickups", "bells", "portals"):
        doc[key] = []

    for o in objects("rooms"):
        _, rid, name = fields(o, "room", 3)
        gmin, gmax = world_aabb(o)
        room = {"id": int(rid), "name": name, "min": [gmin[0], gmin[2]], "max": [gmax[0], gmax[2]],
                "height": rnd(gmax[1] - gmin[1])}
        if gmin[1] != 0:
            room["floor"] = gmin[1]
        if o.get("sky"):
            room["sky"] = str(o["sky"])
        if o.get("ground"):
            room["ground"] = str(o["ground"])
        if o.get("void"):
            room["void"] = True
        if o.get("shell"):
            room["shell"] = str(o["shell"])
        if o.get("edge_style"):
            room["edge"] = {"style": str(o["edge_style"]), "height": rnd(float(o.get("edge_height", 2.2)))}
        doc["rooms"].append(with_states(o, room))

    paths = bpy.data.collections.get("paths")
    if paths:
        by_id = {r["id"]: r for r in doc["rooms"]}
        for o in sorted(paths.objects, key=lambda x: x.name):
            parts = base_name(o).split(":")
            if len(parts) != 3 or parts[0] != "path":
                raise SystemExit(f"paths: bad name {o.name} (want path:<ground>:<room id>)")
            gmin, gmax = world_aabb(o)
            room = by_id.get(int(parts[2]))
            if room is None:
                raise SystemExit(f"{o.name}: no room {parts[2]}")
            room.setdefault("paths", []).append({"ground": parts[1], "min": [gmin[0], gmin[2]], "max": [gmax[0], gmax[2]]})

    for o in objects("tunnels"):
        _, a, b = fields(o, "tunnel", 3)
        gmin, gmax = world_aabb(o)
        doc["tunnels"].append(with_states(o, {"a": int(a), "b": int(b), "min": [gmin[0], gmin[2]],
                                              "max": [gmax[0], gmax[2]], "height": rnd(gmax[1] - gmin[1])}))

    for o in objects("stairs"):
        _, up, sid = fields(o, "stair", 3)
        gmin, gmax = world_aabb(o)
        doc["stairs"].append(with_states(o, {"id": sid, "up": up, "min": gmin, "max": gmax}))

    for coll in ("furniture", "solids"):
        for o in objects(coll):
            if o.type == "MESH":
                gmin, gmax = world_aabb(o)
                doc[coll].append(with_states(o, {"min": gmin, "max": gmax}))

    for o in objects("gates"):
        _, event, gid = fields(o, "gate", 3)
        gmin, gmax = world_aabb(o)
        doc["gates"].append(with_states(o, {"id": gid, "opensOn": event, "min": gmin, "max": gmax}))

    for o in objects("triggers"):
        _, event, tid = fields(o, "trigger", 3)
        gmin, gmax = world_aabb(o)
        item = {"id": tid, "event": event, "min": gmin, "max": gmax}
        if "once" in o.keys():
            item["once"] = bool(o["once"])
        doc["triggers"].append(with_states(o, item))

    for o in objects("windows"):
        _, view, wid = fields(o, "window", 3)
        gmin, gmax = world_aabb(o)
        doc["windows"].append(with_states(o, {"id": wid, "view": view, "min": gmin, "max": gmax}))

    for o in objects("lights"):
        if o.type != "LIGHT" or o.data.type != "POINT":
            continue
        c = o.data.color
        doc["lights"].append(with_states(o, {"pos": to_game(o.matrix_world.translation),
                                             "color": [rnd(c[0]), rnd(c[1]), rnd(c[2])],
                                             "power": rnd(o.get("power", o.data.energy / 10.0))}))

    start = None
    for o in objects("markers"):
        if o.type != "EMPTY":
            continue
        name = base_name(o)
        pos = to_game(o.matrix_world.translation)
        kind = name.split(":")[0]
        if name == "start":
            if start is not None:
                raise SystemExit("more than one start marker")
            start = {"pos": pos, "yaw": yaw_of(o)}
        elif kind == "spawn":
            _, what, sid = fields(o, "spawn", 3)
            doc["spawns"].append(with_states(o, {"id": sid, "kind": what, "pos": pos, "yaw": yaw_of(o)}))
        elif kind == "grave":
            _, wave, gid = fields(o, "grave", 3)
            doc["graves"].append(with_states(o, {"id": gid, "wave": int(wave), "pos": pos, "yaw": yaw_of(o)}))
        elif kind == "pickup":
            _, item, pid = fields(o, "pickup", 3)
            doc["pickups"].append(with_states(o, {"id": pid, "item": item, "pos": pos}))
        elif kind == "bell":
            _, bid = fields(o, "bell", 2)
            doc["bells"].append(with_states(o, {"id": bid, "pos": pos, "radius": rnd(o.get("radius", 0.8))}))
        elif kind == "portal":
            _, target, pid = fields(o, "portal", 3)
            doc["portals"].append(with_states(o, {"id": pid, "pos": pos, "yaw": yaw_of(o), "target": target,
                                                  "width": rnd(o.get("width", 2.2)), "height": rnd(o.get("height", 3.4))}))
        else:
            raise SystemExit(f"unknown marker {o.name!r}")
    if start is None:
        raise SystemExit("no start marker")
    doc["start"] = start

    for key in [k for k, v in doc.items() if v == []]:
        del doc[key]

    path = out_path()
    # The mesh key: dressing -> <id>.art.glb beside the JSON (sets doc["art"]).
    # It mutates the loaded scene, so it runs last and the .blend is never saved.
    export_art(doc, path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print(f"exported {level_id}: {len(doc.get('rooms', []))} rooms, {len(doc.get('tunnels', []))} tunnels -> {path}")


main()
