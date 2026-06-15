"""Tests for scripts/gen_notblood_tables.py — enum + aggregate-tokenizer foundation."""
from __future__ import annotations

import sys
from pathlib import Path

# Match the project convention (see test_map_parser.py): put scripts/ on sys.path
# so `import gen_notblood_tables` resolves without a package qualifier.
sys.path.insert(0, str(Path(__file__).parent.parent))

import gen_notblood_tables as g  # noqa: E402


def test_strip_comments_removes_line_and_block():
    src = "a // line\nb /* block */ c\n/* multi\nline */ d"
    out = g.strip_comments(src)
    assert "line" not in out and "block" not in out and "multi" not in out
    assert "a" in out and "b" in out and "c" in out and "d" in out


def test_parse_enum_implicit_increment():
    src = "enum { kDudeBase = 200, kDudeCultistTommy, kDudeCultistShotgun = 202, kZ };"
    e = g.parse_enum(src, anchor="kDudeBase")
    assert e["kDudeBase"] == 200
    assert e["kDudeCultistTommy"] == 201  # implicit
    assert e["kDudeCultistShotgun"] == 202
    assert e["kZ"] == 203


def test_split_aggregates_handles_nesting_and_casts():
    body = "{ 1, 2, {3, 4}, (char)5 }, { 6, 7, {8, 9}, (char)10 }"
    items = g.split_top_level_aggregates(body)
    assert len(items) == 2
    flat = g.flatten_scalars(items[0])
    assert flat == [1, 2, 3, 4, 5]


def test_explodeInfo_standard_row():
    tables = g.build_tables()  # parses everything; returns dict
    std = tables["explodeInfo"][1]
    assert std == {"repeat": 80, "dmg": 20, "dmgRng": 10, "radius": 150,
                   "dmgType": 900, "burnTime": 0, "ticks": 60,
                   "quakeEffect": 160, "flashEffect": 60}


def test_dudeInfo_zombie_gibtype():
    tables = g.build_tables()
    z = tables["dudeInfo"][g.ENUMS["kDude"]["kDudeZombieAxeNormal"] - 200]
    assert z["nGibType"] == [15, -1, -1]
    assert z["startHealth"] == 60


def test_arity_guard_rejects_wrong_column_count():
    import pytest
    with pytest.raises(g.ArityError):
        g.bind_struct(["repeat", "dmg", "dmgRng"], g.flatten_scalars("{ 1, 2 }"))


def test_gibList_human_linked():
    # gibList[15] = { NULL, 0, gibHuman, 7, 0 } (gib.cpp:242)
    # gibHuman[0] = { 425, 1454, ... } -> GIBTHING.at4 (picnum/tile) = 1454
    tables = g.build_tables()
    entry = tables["gibList"][15]
    assert entry["things"] is not None and len(entry["things"]) == 7
    assert entry["things"][0]["tile"] == 1454  # GIBTHING.at4 = picnum


def test_gibList_axezombie_head():
    # gibList[27] = { NULL, 0, gibAxeZombieHead, 1, 0 } (gib.cpp:254)
    # gibAxeZombieHead[0] = { 427, 3405, ... } -> GIBTHING.at4 (tile) = 3405
    tables = g.build_tables()
    entry = tables["gibList"][27]
    assert len(entry["things"]) == 1
    assert entry["things"][0]["tile"] == 3405
