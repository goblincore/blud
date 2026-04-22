"""Tests for patterns.json schema validator (synthetic fixtures)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from validate_patterns_schema import validate, SchemaError


def _minimal_valid() -> dict:
    return {
        "metadata": {"maps_analyzed": 39, "version": "r5.1"},
        "texture_families": {
            "family_126": {
                "name": "Gray Crypt Brick",
                "theme_tag": "crypt",
                "sector_count": 1863,
                "floors": [{"picnum": 448, "weight": 0.4}, {"picnum": 255, "weight": 0.6}],
                "walls": [{"picnum": 449, "weight": 1.0}],
                "ceilings": [{"picnum": 253, "weight": 1.0}],
            },
        },
        "map_archetypes": {
            "DWBB1.MAP": {"archetype": "hub-and-spokes", "theme_tag": "crypt"},
        },
        "geometry": {
            "sectorSize": {"median": 800000, "distribution": "log-normal"},
            "wallsPerSector": {"distribution": "weighted-choice"},
        },
    }


def test_minimal_valid_passes():
    validate(_minimal_valid())


def test_missing_texture_families_fails():
    data = _minimal_valid()
    del data["texture_families"]
    with pytest.raises(SchemaError, match="texture_families"):
        validate(data)


def test_family_without_name_fails():
    data = _minimal_valid()
    del data["texture_families"]["family_126"]["name"]
    with pytest.raises(SchemaError, match="name"):
        validate(data)


def test_family_weights_must_sum_close_to_one():
    data = _minimal_valid()
    data["texture_families"]["family_126"]["floors"] = [
        {"picnum": 448, "weight": 0.3},
        {"picnum": 255, "weight": 0.3},
    ]
    with pytest.raises(SchemaError, match="weight.*sum"):
        validate(data)


def test_archetype_values_must_be_known():
    data = _minimal_valid()
    data["map_archetypes"]["DWBB1.MAP"]["archetype"] = "spaghetti-castle"
    with pytest.raises(SchemaError, match="archetype"):
        validate(data)


def test_theme_tag_values_must_be_known():
    data = _minimal_valid()
    data["texture_families"]["family_126"]["theme_tag"] = "moon-base"
    with pytest.raises(SchemaError, match="theme_tag"):
        validate(data)
