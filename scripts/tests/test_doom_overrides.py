"""Tests for scripts/levels/doom_overrides.py through doom_map.convert, on the test WAD of test_doom_map.py.

That WAD in our metres: A is x -2..6, z -4..4 (floor 0, ceiling 4, the start at the origin), B is x 6..10
(floor 0.5, nukage, hurt 5); a zombieman stands in A at (2, 2), a clip in B at (8, 0), a barrel at (-1, 3).
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "levels"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import doom_map  # noqa: E402
import doom_overrides  # noqa: E402
from doom_overrides import OverrideError  # noqa: E402
from test_doom_map import build_wad  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def run(tmp_path, ov):
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    out, stats = doom_map.convert(wad, "E1M1", units_per_m=32, overrides={"map": "E1M1", **ov})
    json.dumps(out)
    return out, stats


def test_no_overrides_changes_nothing(tmp_path):
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    plain, _ = doom_map.convert(wad, "E1M1", units_per_m=32)
    empty, stats = doom_map.convert(wad, "E1M1", units_per_m=32, overrides={"map": "e1m1"})
    assert plain == empty
    assert stats["override_sectors"] == [] and stats["override_spawns"] == []


def test_a_point_patch_makes_a_pool_that_gets_its_own_light(tmp_path):
    out, stats = run(tmp_path, {"sectors": [{"at": [0, 0], "expect": {"floor": 0, "special": "none"},
                                             "set": {"glow": "acid", "special": "hurt", "hurtPerSec": 10}}]})
    a = out["sectors"][0]
    assert a["glow"] == "acid" and a["materials"]["floor"] == "acid"
    assert a["special"] == "hurt" and a["hurtPerSec"] == 10 and isinstance(a["hurtPerSec"], int)
    pools = [li for li in out["lights"] if li.get("mood") == "fire"]
    assert len(pools) == 2                              # B's nukage and A's acid (different kinds: two pools)
    acid = [li for li in pools if li["color"] == doom_map.POOL_COLOURS["acid"]]
    assert len(acid) == 1 and -2 < acid[0]["pos"][0] < 6 and acid[0]["pos"][1] == round(0 + 0.6, 3)
    assert stats["override_sectors"] == [{"sector": 0, "set": {"glow": "acid", "special": "hurt", "hurtPerSec": 10}}]


def test_a_lowered_floor_carries_the_things_on_it(tmp_path):
    out, _ = run(tmp_path, {"sectors": [{"sector": 0, "set": {"floor": -0.25}}]})
    assert out["sectors"][0]["floor"] == -0.25
    zm = next(s for s in out["spawns"] if s["id"] == "s1")
    assert zm["pos"][1] == -0.25
    assert all(b["pos"][1] == -0.25 for b in out["barrels"])


def test_clearing_a_special_drops_its_hurt(tmp_path):
    out, _ = run(tmp_path, {"sectors": [{"at": [8, 0], "set": {"special": "none", "glow": None}}]})
    b = out["sectors"][1]
    assert "special" not in b and "hurtPerSec" not in b and "glow" not in b
    assert not any(li.get("mood") == "fire" for li in out["lights"])


@pytest.mark.parametrize("entry, message", [
    ({"sector": 7, "set": {"floor": 0}}, "sector 7 is not one of the map's 2 sectors"),
    ({"at": [50, 50], "set": {"floor": 0}}, "(50.0, 50.0) is in no sector (the void)"),
    ({"at": [0, 0], "sector": 1, "set": {"floor": 0}}, "is in sector(s) [0], not sector 1"),
    ({"set": {"floor": 0}}, "needs \"sector\" (an index) or \"at\""),
    ({"at": [0, 0], "expect": {"floor": -0.5}, "set": {"floor": 0}}, "sector 0 expected floor -0.5, the converter gave 0.0"),
    ({"at": [0, 0], "set": {}}, "non-empty \"set\""),
    ({"at": [0, 0], "set": {"height": 1}}, "unknown key(s) ['height']"),
    ({"at": [0, 0], "set": {"glow": "blood"}}, ".set.glow: one of"),
    ({"at": [0, 0], "set": {"special": "hurt"}}, "is hurt with no hurtPerSec > 0"),
    ({"at": [0, 0], "set": {"floor": 5}}, "ceiling 4.0 <= floor 5"),
])
def test_bad_sector_patches_are_named(tmp_path, entry, message):
    with pytest.raises(OverrideError) as e:
        run(tmp_path, {"sectors": [entry]})
    assert "overrides.sectors[0]" in str(e.value) and message in str(e.value)


def test_a_sector_patched_twice_is_refused(tmp_path):
    with pytest.raises(OverrideError, match=r"sectors\[1\]: sector 0 is already patched by overrides.sectors\[0\]"):
        run(tmp_path, {"sectors": [{"sector": 0, "set": {"light": 0.5}}, {"at": [1, 1], "set": {"light": 0.2}}]})


def test_a_spawn_stands_on_its_floor_facing_its_point(tmp_path):
    out, stats = run(tmp_path, {"sectors": [{"at": [8, 0], "set": {"floor": 0.75}}],
                                "spawns": [{"id": "o-t", "kind": "teratoma", "at": [8, 2], "face": [8, -3], "sector": 1},
                                           {"id": "o-z", "kind": "zombie", "at": [0, 1], "yaw": 1.5}]})
    by = {s["id"]: s for s in out["spawns"]}
    assert by["o-t"] == {"id": "o-t", "kind": "teratoma", "pos": [8.0, 0.75, 2.0], "yaw": 0.0}   # faces -z
    assert by["o-z"]["pos"] == [0.0, 0.0, 1.0] and by["o-z"]["yaw"] == 1.5
    assert out["spawns"][-2:] == [by["o-t"], by["o-z"]]                                       # after Doom's
    assert [s["sector"] for s in stats["override_spawns"]] == [1, 0]
    east, _ = run(tmp_path, {"spawns": [{"id": "o-e", "kind": "zombie", "at": [0, 0], "face": [3, 0]}]})
    assert math.isclose(east["spawns"][-1]["yaw"], math.pi / 2, abs_tol=1e-6)               # the start rule


@pytest.mark.parametrize("entry, message", [
    ({"id": "o-v", "kind": "teratoma", "at": [40, 0], "yaw": 0}, "(40.0, 0.0) is in no sector (the void)"),
    ({"id": "o-w", "kind": "teratoma", "at": [-1.9, 0], "yaw": 0}, "0.10 m from a wall of sector 0"),
    ({"id": "s1", "kind": "zombie", "at": [0, 0], "yaw": 0}, "id 's1' is already used"),
    ({"id": "o-k", "kind": "imp", "at": [0, 0], "yaw": 0}, "kind 'imp' is not one of"),
    ({"id": "o-y", "kind": "zombie", "at": [0, 0]}, "exactly one of \"yaw\" (radians) or \"face\""),
    ({"id": "o-s", "kind": "zombie", "at": [0, 0], "yaw": 0, "sector": 1}, "is in sector(s) [0], not sector 1"),
    ({"id": "o-a", "kind": "zombie", "at": [0], "yaw": 0}, ".at: must be [x, z]"),
    ({"kind": "zombie", "at": [0, 0], "yaw": 0}, "needs a string id"),
])
def test_bad_spawns_are_named(tmp_path, entry, message):
    with pytest.raises(OverrideError) as e:
        run(tmp_path, {"spawns": [entry]})
    assert "overrides.spawns[0]" in str(e.value) and message in str(e.value)


def test_the_step_line_is_not_a_wall_for_a_spawn(tmp_path):
    # x 6 is A|B's two-sided step line (0.5 m up): a body may start next to it, but not next to B's outer wall.
    out, _ = run(tmp_path, {"spawns": [{"id": "o-step", "kind": "zombie", "at": [6.1, 0], "yaw": 0}]})
    assert out["spawns"][-1]["pos"][1] == 0.5
    with pytest.raises(OverrideError, match="from a wall of sector 1"):
        run(tmp_path, {"spawns": [{"id": "o-out", "kind": "zombie", "at": [9.8, 0], "yaw": 0}]})


def test_the_file_must_name_the_map_and_known_keys(tmp_path):
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    with pytest.raises(OverrideError, match="\"map\" is 'E1M2', converting E1M1"):
        doom_map.convert(wad, "E1M1", overrides={"map": "E1M2"})
    with pytest.raises(OverrideError, match=r"unknown key\(s\) \['things'\]"):
        doom_map.convert(wad, "E1M1", overrides={"map": "E1M1", "things": []})


def test_the_mirrors_match_the_typescript():
    level_def = (REPO / "src/lab/sdf-zombie/webgpu/level-def.ts").read_text()
    sector_def = (REPO / "src/lab/sdf-zombie/webgpu/sector-def.ts").read_text()

    def strings(src, name):
        m = re.search(rf"export const {name}: readonly \w+\[\] = \[([^\]]*)\]", src)
        assert m, name
        return tuple(re.findall(r"'([^']+)'", m.group(1)))

    def number(src, name):
        m = re.search(rf"export const {name} = ([0-9.]+);", src)
        assert m, name
        return float(m.group(1))

    assert doom_overrides.SPAWN_KINDS == strings(level_def, "SPAWN_KINDS")
    assert doom_overrides.SECTOR_SPECIALS == strings(sector_def, "SECTOR_SPECIALS")
    assert doom_overrides.GLOW_KINDS == strings(sector_def, "GLOW_KINDS")
    assert doom_overrides.BODY_RADIUS_M == number(sector_def, "SECTOR_BODY_RADIUS_M")
    assert doom_overrides.STEP_M == number(sector_def, "SECTOR_STEP_M")
    assert doom_overrides.HEADROOM_M == number(sector_def, "SECTOR_HEADROOM_M")


def test_the_committed_e1m1_overrides_are_well_formed():
    path = doom_overrides.default_path("E1M1")
    assert path == REPO / "scripts/levels/overrides/e1m1.json"
    ov = doom_overrides.load(path)
    doom_overrides.check_top(ov, "E1M1")
    for entry in ov["sectors"]:
        assert set(entry) <= doom_overrides.SECTOR_KEYS and set(entry["set"]) <= doom_overrides.SET_KEYS
    for entry in ov["spawns"]:
        assert set(entry) <= doom_overrides.SPAWN_KEYS and entry["kind"] in doom_overrides.SPAWN_KINDS
    assert len({s["id"] for s in ov["spawns"]}) == len(ov["spawns"])
