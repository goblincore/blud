"""Tests for build_theme_patterns.py — the raw-dump + labels -> theme patterns
join (R5.1 / P6)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from build_theme_patterns import (  # noqa: E402
    MAP_ARCHETYPES,
    build_patterns,
    ceiling_weights,
    floor_weights,
    normalize_weights,
    wall_weights,
)
from validate_patterns_schema import (  # noqa: E402
    KNOWN_ARCHETYPES,
    KNOWN_THEME_TAGS,
    validate,
)


def _sums_to_one(entries):
    return abs(sum(e["weight"] for e in entries) - 1.0) < 1e-6


# --- normalize_weights -----------------------------------------------------

def test_normalize_sorts_desc_and_sums_to_one():
    out = normalize_weights({10: 1.0, 20: 3.0})
    assert [e["picnum"] for e in out] == [20, 10]
    assert _sums_to_one(out)


def test_normalize_drops_nonpositive():
    out = normalize_weights({10: 0, 20: 5, 30: -1})
    assert [e["picnum"] for e in out] == [20]


def test_normalize_top_n_caps_and_renormalizes():
    out = normalize_weights({1: 1, 2: 1, 3: 1, 4: 1}, top_n=2)
    assert len(out) == 2
    assert _sums_to_one(out)


def test_normalize_empty_when_no_positive():
    assert normalize_weights({1: 0, 2: 0}) == []


def test_normalize_picnums_are_ints():
    out = normalize_weights({10: 2.0})
    assert isinstance(out[0]["picnum"], int)


# --- floor / wall weighting ------------------------------------------------

def test_floor_weights_use_cooccurrence_totals():
    cooc = {"448": {"449": 100, "458": 50}, "255": {"449": 10}}
    out = floor_weights([448, 255], cooc)
    # 448 (total 150) should outweigh 255 (total 10)
    assert out[0]["picnum"] == 448
    assert _sums_to_one(out)


def test_wall_weights_sum_over_family_floors():
    cooc = {"448": {"449": 100, "458": 5}, "255": {"449": 20}}
    out = wall_weights([449, 458], [448, 255], cooc)
    assert out[0]["picnum"] == 449  # 120 vs 5
    assert _sums_to_one(out)


def test_weights_fall_back_to_uniform_when_no_cooc():
    out = wall_weights([1, 2], [99], {})  # no cooc data
    assert _sums_to_one(out)
    assert {e["weight"] for e in out} == {0.5}


# --- ceiling derivation + fallback -----------------------------------------

def test_ceiling_weights_from_ceil_wall_cooc():
    cooc_ceil = {"253": {"449": 80}, "999": {"111": 80}}
    out = ceiling_weights([449], cooc_ceil, fallback_picnum=449)
    assert out[0]["picnum"] == 253  # 999 doesn't co-occur with wall 449
    assert _sums_to_one(out)


def test_ceiling_falls_back_to_wall_when_no_data():
    out = ceiling_weights([449], {}, fallback_picnum=449)
    assert out == [{"picnum": 449, "weight": 1.0}]


# --- archetype table -------------------------------------------------------

def test_archetypes_cover_39_maps_with_known_vocab():
    assert len(MAP_ARCHETYPES) == 39
    for m, entry in MAP_ARCHETYPES.items():
        assert m.endswith(".MAP")
        assert entry["archetype"] in KNOWN_ARCHETYPES
        assert entry["theme_tag"] in KNOWN_THEME_TAGS


# --- end-to-end: build_patterns output passes the schema validator ---------

def _fake_raw():
    return {
        "campaignSummary": {"totalSectors": 1200},
        "globalStats": {
            "globalFloorWallCooccurrence": {
                "448": {"449": 100, "458": 40},
                "255": {"449": 20},
            },
            "globalCeilWallCooccurrence": {"253": {"449": 60}},
            "sectorAreaHistogram": {"medium": 10},
            "portalHistogram": {"hub(4-7)": 7},
            "sectorLotags": {"600": 48, "0": 1100},
        },
    }


def _fake_labels():
    return [
        {"family_id": "family_126", "name": "Gray Crypt Brick", "theme_tag": "crypt",
         "sector_count": 1863, "floor_picnums": [448, 255], "wall_picnums": [449, 458]},
        # degenerate family (no walls) — must be skipped, not emitted invalid
        {"family_id": "family_x", "name": "Bad", "theme_tag": "stone",
         "sector_count": 1, "floor_picnums": [1], "wall_picnums": []},
    ]


def test_build_patterns_passes_validator():
    patterns, skipped = build_patterns(_fake_labels(), _fake_raw())
    assert skipped == ["family_x"]
    assert "family_126" in patterns["texture_families"]
    # geometry present + door frequency computed from lotag 600 / total sectors
    assert patterns["geometry"]["doorFrequency"] == pytest.approx(0.04, abs=0.005)
    validate(patterns)  # raises SchemaError on drift
