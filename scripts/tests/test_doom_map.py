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
    lines = [(1, 0, 1, 0, 0, 0, 0xFFFF), (2, 1, 4, 0, 0, 1, 2), (3, 2, 1, 0, 0, 0, 0xFFFF), (0, 3, 1, 0, 0, 0, 0xFFFF),
             (4, 1, 1, 0, 0, 3, 0xFFFF), (5, 4, 1, 0, 0, 3, 0xFFFF), (2, 5, 1, 0, 0, 3, 0xFFFF)]
    things = [(64, 128, 0, 1, 7), (300, 128, 0, 3004, 7)]   # player 1 start facing east; a zombieman (ignored in plan 1)
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


def convert(tmp_path) -> dict:
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    out = doom_map.convert(wad, "E1M1", units_per_m=32)
    json.dumps(out)                                     # serialisable
    return out


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


def test_lines_and_zones(tmp_path):
    out = convert(tmp_path)
    step = [l for l in out["lines"] if l.get("back") is not None]
    assert len(step) == 1 and {step[0]["front"], step[0]["back"]} == {0, 1}
    assert len(out["lines"]) == 7
    assert [s["zone"] for s in out["sectors"]] == [0, 0]   # joined by a non-door line
    assert len(out["lights"]) == 1


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
