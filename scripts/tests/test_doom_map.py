"""Tests for scripts/levels/doom_map.py on a WAD built in the test (no id data)."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "levels"))
import doom_map  # noqa: E402


def name8(s: str) -> bytes:
    return s.encode("ascii").ljust(8, b"\0")


def pack_wad(verts, sectors, sides, lines, things) -> bytes:
    lumps = [
        ("E1M1", b""),
        ("THINGS", b"".join(struct.pack("<hhhhh", *t) for t in things)),
        ("LINEDEFS", b"".join(struct.pack("<HHhhhHH", *l) for l in lines)),
        ("SIDEDEFS", b"".join(struct.pack("<hh8s8s8sH", x, y, name8(u), name8(lo), name8(m), s) for x, y, u, lo, m, s in sides)),
        ("VERTEXES", b"".join(struct.pack("<hh", *v) for v in verts)),
        ("SEGS", b""), ("SSECTORS", b""), ("NODES", b""),
        ("SECTORS", b"".join(struct.pack("<hh8s8shhh", f, c, name8(ft), name8(ct), li, sp, tg) for f, c, ft, ct, li, sp, tg in sectors)),
        ("REJECT", b""), ("BLOCKMAP", b""),
    ]
    body = b""
    directory = b""
    offset = 12
    for name, data in lumps:
        directory += struct.pack("<ii8s", offset, len(data), name8(name))
        body += data
        offset += len(data)
    return struct.pack("<4sii", b"PWAD", len(lumps), offset) + body + directory


def build_wad() -> bytes:
    # A: x 0..256, y 0..256 floor 0 ceil 128; B: x 256..384, y 0..256 floor 16 ceil 128 (F_SKY1 ceiling).
    verts = [(0, 0), (256, 0), (256, 256), (0, 256), (384, 0), (384, 256)]
    sectors = [(0, 128, "FLOOR4_8", "CEIL3_5", 160, 0, 0), (16, 128, "NUKAGE1", "F_SKY1", 255, 7, 0)]
    sides = [(0, 0, "-", "-", "STARTAN3", 0),   # 0 A walls
             (0, 0, "-", "STEP6", "-", 0),      # 1 A side of the step line
             (0, 0, "-", "-", "-", 1),          # 2 B side of the step line
             (0, 0, "-", "-", "BROWN1", 1)]     # 3 B walls
    # (v1, v2, flags, special, tag, right, left)
    # Doom: the RIGHT sidedef's sector is on the right of v1 -> v2, so these run clockwise around A and B.
    # Line 0 (A's south wall, x 256 -> 0 at y 0) is an exit switch (special 11).
    lines = [(1, 0, 1, 11, 0, 0, 0xFFFF), (2, 1, 4, 0, 0, 1, 2), (3, 2, 1, 0, 0, 0, 0xFFFF), (0, 3, 1, 0, 0, 0, 0xFFFF),
             (4, 1, 1, 0, 0, 3, 0xFFFF), (5, 4, 1, 0, 0, 3, 0xFFFF), (2, 5, 1, 0, 0, 3, 0xFFFF)]
    # (x, y, angle, type, flags): flags bit 1 easy, 2 medium, 4 hard, 16 multiplayer only.
    things = [(64, 128, 0, 1, 7),          # 0 player 1 start facing east
              (128, 64, 90, 3004, 7),      # 1 zombieman in A, facing north, every skill
              (192, 64, 180, 9, 4),        # 2 shotgun guy in A, hard only
              (128, 192, 0, 3001, 1),      # 3 imp in A, easy only
              (320, 128, 0, 2007, 7),      # 4 clip in B
              (192, 192, 0, 2001, 23),     # 5 shotgun in A, multiplayer only
              (32, 32, 0, 2035, 7),        # 6 barrel in A (skipped: plan 3b)
              (900, 900, 0, 2011, 7)]      # 7 stimpack in no sector
    return pack_wad(verts, sectors, sides, lines, things)


def build_row(mid_sector, mid_tag, special, extra_lines=()) -> bytes:
    """Three 128-unit squares in a row (A, M, B), clockwise, one sidedef per sector; line 0 carries `special`/tag 1."""
    xs = [0, 128, 256, 384]
    verts = [(x, 0) for x in xs] + [(x, 256) for x in xs]
    sectors = [(0, 128, "FLOOR4_8", "CEIL3_5", 160, 0, 0), mid_sector + (mid_tag,), (0, 96, "FLOOR4_8", "CEIL3_5", 160, 0, 0)]
    sides = [(0, 0, "-", "-", "STARTAN3", k) for k in range(3)]
    lines = []
    for k in range(3):
        lines.append((k + 1, k, 1, special if k == 0 else 0, 1 if k == 0 else 0, k, 0xFFFF))   # bottom, heading west
        lines.append((4 + k, 5 + k, 1, 0, 0, k, 0xFFFF))                                      # top, heading east
    lines.append((0, 4, 1, 0, 0, 0, 0xFFFF))                                                  # A's west edge, north
    for k in range(1, 4):                                                                     # shared edges, south
        lines.append((4 + k, k, 4, 0, 0, k - 1, k if k < 3 else 0xFFFF))
    lines.extend(extra_lines)
    return pack_wad(verts, sectors, sides, lines, [(64, 128, 0, 1, 7)])


def convert_row(tmp_path, *a, **kw):
    wad = tmp_path / "r.wad"
    wad.write_bytes(build_row(*a, **kw))
    return doom_map.convert(wad, "E1M1", units_per_m=32)


def convert(tmp_path, units_per_m=32, **kw) -> dict:
    return convert_stats(tmp_path, units_per_m, **kw)[0]


def convert_stats(tmp_path, units_per_m=32, **kw) -> tuple[dict, dict]:
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    out, stats = doom_map.convert(wad, "E1M1", units_per_m=units_per_m, **kw)
    json.dumps(out)                                     # serialisable
    return out, stats


def test_scale_and_origin_at_the_start(tmp_path):
    out = convert(tmp_path)
    assert out["geometry"] == "sectors" and out["id"] == "doom-e1m1"
    assert out["start"]["pos"] == [0.0, 0.0, 0.0]
    xs = [v[0] for v in out["vertices"]]
    zs = [v[1] for v in out["vertices"]]
    assert min(xs) == -2.0 and max(xs) == 10.0          # (0 - 64) / 32, (384 - 64) / 32
    assert min(zs) == -4.0 and max(zs) == 4.0           # Doom +y is our -z: -(256 - 128) / 32 .. (128 - 0) / 32


def test_heights_light_specials_materials(tmp_path):
    a, b = convert(tmp_path)["sectors"]
    assert (a["floor"], a["ceil"]) == (0.0, 4.0)
    assert (b["floor"], b["ceil"]) == (0.5, 4.0)
    assert a["light"] == round(160 / 255, 3)
    assert b["special"] == "hurt" and b["hurtPerSec"] == 5
    assert b["glow"] == "nukage" and b["materials"]["ceil"] == "sky"
    assert a["materials"] == {"floor": "metal-plate", "ceil": "concrete", "wall": "tech"}


def test_per_side_wall_materials(tmp_path):
    out = convert(tmp_path)
    step = next(l for l in out["lines"] if l.get("back") is not None)
    # The riser on the step line faces A (the lower floor): A's sidedef lower texture STEP6, not A's tech walls.
    assert step["walls"] == {"front": {"lower": "metal-plate"}}
    # One-sided lines whose middle matches their sector's wall family carry nothing (the fallback).
    walls = [l for l in out["lines"] if l.get("back") is None]
    assert all("walls" not in l for l in walls)


def test_lines_and_zones(tmp_path):
    out = convert(tmp_path)
    step = [l for l in out["lines"] if l.get("back") is not None]
    assert len(step) == 1 and {step[0]["front"], step[0]["back"]} == {0, 1}
    assert len(out["lines"]) == 7
    assert [s["zone"] for s in out["sectors"]] == [0, 0]   # joined by a non-door line
    assert [li for li in out["lights"] if "mood" not in li] == []                            # 96 m2: under the light threshold


def test_yaw_east_is_plus_x(tmp_path):
    import math
    yaw = convert(tmp_path)["start"]["yaw"]
    assert math.isclose(math.sin(yaw), 1.0, abs_tol=1e-9)  # forward = [sin yaw, 0, -cos yaw]


def test_every_sector_is_left_of_its_lines_with_positive_area(tmp_path):
    out = convert(tmp_path)
    vs = out["vertices"]
    area = [0.0] * len(out["sectors"])
    for ln in out["lines"]:
        (x0, z0), (x1, z1) = vs[ln["v"][0]], vs[ln["v"][1]]
        cross = (x0 * z1 - x1 * z0) / 2
        area[ln["front"]] += cross              # front is left of v0 -> v1
        if ln.get("back") is not None and ln["back"] != ln["front"]:
            area[ln["back"]] -= cross           # back is left of v1 -> v0
    assert all(a > 0 for a in area), area


def test_a_big_zone_gets_a_light_inside_its_sector(tmp_path):
    out = convert(tmp_path, units_per_m=16)               # 4x the area: 384 m2
    fill = [li for li in out["lights"] if "mood" not in li]
    assert len(fill) == 1
    px, py, pz = fill[0]["pos"]
    assert -4 < px < 12 and -8 < pz < 8                   # inside the 16 x 16 m box of A + B (x -4..20 overall)
    a = out["sectors"][0]
    assert a["floor"] < py < a["ceil"]
    assert px < 8                                         # A is x -4..12: the biggest sector holds the light


def test_remote_door_target_is_opened_and_joins_a_zone(tmp_path):
    out, stats = convert_row(tmp_path, (0, 0, "FLOOR4_8", "CEIL3_5", 160, 0), 1, 63)
    a, mid, b = out["sectors"]
    assert mid["ceil"] == round((96 - 4) / 32, 4) and mid["ceil"] > mid["floor"]   # lowest neighbour ceiling - 4
    assert mid["zone"] == a["zone"]
    assert stats["doors_opened"] == [1]


def test_floor_lower_target_is_lowered(tmp_path):
    out, stats = convert_row(tmp_path, (64, 128, "FLOOR4_8", "CEIL3_5", 160, 0), 1, 36)
    assert out["sectors"][1]["floor"] == 0.0              # from 64 units to the neighbours' 0
    assert stats["floors_lowered"] == [1]


def test_closed_sector_nothing_opens_is_an_error(tmp_path):
    import pytest
    with pytest.raises(ValueError, match="sector 1"):
        convert_row(tmp_path, (0, 0, "FLOOR4_8", "CEIL3_5", 160, 0), 0, 0)


def test_zero_length_line_is_dropped(tmp_path):
    out, stats = convert_row(tmp_path, (0, 128, "FLOOR4_8", "CEIL3_5", 160, 0), 0, 0, extra_lines=[(0, 0, 1, 0, 0, 0, 0xFFFF)])
    assert stats["dropped_zero_length_lines"] == 1
    assert all(ln["v"][0] != ln["v"][1] for ln in out["lines"])


def _inside(level, px, pz, sector):
    vs = level["vertices"]
    segs = [(tuple(vs[ln["v"][0]]), tuple(vs[ln["v"][1]])) for ln in level["lines"]
            if ln["front"] != ln.get("back") and sector in (ln["front"], ln.get("back"))]
    return doom_map._inside(px, pz, segs)


def test_pool_gets_a_green_fire_light_inside_it(tmp_path):
    out = convert(tmp_path)
    pools = [li for li in out["lights"] if li.get("mood") == "fire"]
    assert len(pools) == 1
    li = pools[0]
    r, g, b = li["color"]
    assert g > r and g > b and li["fixture"] == "none"
    assert _inside(out, li["pos"][0], li["pos"][2], 1)
    assert li["pos"][1] == round(out["sectors"][1]["floor"] + 0.6, 3)
    assert li["power"] == round(min(14, 4 + 0.15 * 32), 2)


def test_pool_lights_do_not_use_the_fill_light_cap(tmp_path):
    # 11 separate 256 m2 rooms (16 units/m); the last is nukage.
    verts, sectors, sides, lines = [], [], [], []
    for k in range(11):
        x = k * 600
        v = len(verts)
        verts += [(x, 0), (x + 256, 0), (x + 256, 256), (x, 256)]
        floor_tex = "NUKAGE1" if k == 10 else "FLOOR4_8"
        sectors.append((0, 128, floor_tex, "CEIL3_5", 160, 0, 0))
        sides.append((0, 0, "-", "-", "STARTAN3", k))
        for a, b in ((1, 0), (2, 1), (3, 2), (0, 3)):
            lines.append((v + a, v + b, 1, 0, 0, k, 0xFFFF))
    wad = tmp_path / "m.wad"
    wad.write_bytes(pack_wad(verts, sectors, sides, lines, [(64, 128, 0, 1, 7)]))
    out, _ = doom_map.convert(wad, "E1M1", units_per_m=16)
    fire = [li for li in out["lights"] if li.get("mood") == "fire"]
    assert len(fire) == 1
    assert len(out["lights"]) - len(fire) == doom_map.MAX_LIGHTS


# --- things (plan 3a task 1) -------------------------------------------------------------------

def test_default_skill_is_hard_spawns(tmp_path):
    spawns = {s["id"]: s for s in convert(tmp_path)["spawns"]}
    assert sorted(spawns) == ["s1", "s2"]                  # the imp (easy only) is absent
    assert spawns["s1"]["kind"] in doom_map.ZOMBIEMAN_VARIANTS
    assert spawns["s2"]["kind"] == "soldier"
    assert spawns["s1"]["pos"] == [2.0, 0.0, 2.0]          # ((128 - 64) / 32, A's floor, -(64 - 128) / 32)


def test_skill_1_keeps_the_imp_and_drops_the_shotgun_guy(tmp_path):
    spawns = {s["id"]: s["kind"] for s in convert(tmp_path, skill=1)["spawns"]}
    assert set(spawns) == {"s1", "s3"} and spawns["s3"] == "zombie"


def test_pickups_skip_multiplayer_and_stand_on_their_floor(tmp_path):
    out = convert(tmp_path)
    assert out["pickups"] == [{"id": "p4", "item": "shells", "pos": [8.0, out["sectors"][1]["floor"], 0.0]}]
    assert out["pickups"][0]["pos"][1] == 0.5


def test_spawn_yaw_uses_the_start_rule(tmp_path):
    import math
    spawns = {s["id"]: s for s in convert(tmp_path)["spawns"]}
    assert spawns["s1"]["yaw"] == round(math.radians(90 - 90), 6)
    assert spawns["s2"]["yaw"] == round(math.radians(90 - 180), 6)


def test_zombieman_variant_choice(tmp_path):
    assert {s["id"]: s["kind"] for s in convert(tmp_path, zombieman="butcher")["spawns"]}["s1"] == "butcher"
    a = convert(tmp_path, zombieman="mix")
    b = convert(tmp_path)
    assert a["spawns"] == b["spawns"]                      # mix is the default and deterministic
    assert doom_map.fnv1a32("a") == 0xE40C292C            # FNV-1a 32 reference value
    want = doom_map.ZOMBIEMAN_VARIANTS[doom_map.fnv1a32("s1") % 3]
    assert {s["id"]: s["kind"] for s in a["spawns"]}["s1"] == want


def test_exit_switch_writes_a_trigger_on_its_front_side(tmp_path):
    out = convert(tmp_path)
    assert out["completeOn"] == "level.end"
    assert len(out["triggers"]) == 1
    t = out["triggers"][0]
    assert {k: t[k] for k in ("id", "event", "once")} == {"id": "exit", "event": "level.end", "once": True}
    # Line 0 runs (6, 4) -> (-2, 4) in our x/z; A (its front) lies at z < 4.
    assert t["min"] == [-2.0, 0.0, 3.2] and t["max"] == [6.0, 2.0, 4.0]
    cx, cz = (t["min"][0] + t["max"][0]) / 2, (t["min"][2] + t["max"][2]) / 2
    assert _inside(out, cx, cz, 0)


def test_summary_counts_kinds_and_skipped_things(tmp_path):
    _, stats = convert_stats(tmp_path)
    want = doom_map.ZOMBIEMAN_VARIANTS[doom_map.fnv1a32("s1") % 3]
    assert stats["spawns_by_kind"] == {"soldier": 1, want: 1}
    assert stats["pickups_by_item"] == {"shells": 1}
    assert stats["skipped_types"] == {2035: 1}
    assert stats["in_no_sector"] == 1
    assert stats["not_this_skill"] == 1 and stats["multiplayer_only"] == 1
