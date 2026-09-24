"""Export a Blud level (.blend) to Level Format v1 JSON.

Runs INSIDE Blender:

    blender --background assets-source/levels/the-wake.blend \
        --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json

Spec: docs/superpowers/specs/2026-09-23-level-format-design.md
Conventions: docs/game/levels/blender-conventions.md
Validation lives in the game (level-json.ts); this script only refuses names it
cannot read.
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
                "lights", "spawns", "graves", "pickups", "bells"):
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
        if o.get("edge_style"):
            room["edge"] = {"style": str(o["edge_style"]), "height": rnd(float(o.get("edge_height", 2.2)))}
        doc["rooms"].append(with_states(o, room))

    paths = bpy.data.collections.get("paths")
    if paths:
        by_id = {r["id"]: r for r in doc["rooms"]}
        for o in sorted(paths.objects, key=lambda x: x.name):
            parts = o.name.split(":")
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
        else:
            raise SystemExit(f"unknown marker {o.name!r}")
    if start is None:
        raise SystemExit("no start marker")
    doc["start"] = start

    for key in [k for k, v in doc.items() if v == []]:
        del doc[key]

    path = out_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print(f"exported {level_id}: {len(doc.get('rooms', []))} rooms, {len(doc.get('tunnels', []))} tunnels -> {path}")


main()
