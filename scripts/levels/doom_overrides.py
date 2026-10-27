"""Hand-written edits applied on top of a converted Doom map (doom_map.py `--overrides`).

Our data, not the WAD's: committed in scripts/levels/overrides/<map>.json, so regenerating a level from
the WAD keeps the edits. Coordinates are OURS (metres, the converted level's x/z: the player start is
the origin, Doom +y is our -z), as read off the `--svg` plan or the level JSON.

    {
      "map": "E1M1",
      "note": "free text",
      "sectors": [
        {"at": [0, -12], "expect": {"floor": -0.5}, "set": {"glow": "nukage", "special": "hurt", "hurtPerSec": 5, "floor": -0.625}}
      ],
      "spawns": [
        {"id": "o-teratoma-1", "kind": "teratoma", "at": [38, -10], "face": [24, -10.5], "sector": 1}
      ]
    }

Sector patches pick their sector by `sector` (an index) or `at` (a point that exactly one sector
holds; give both to pin which one). `expect` (optional) checks fields before patching, so an edit
fails loudly if the WAD or the converter changes under it. `set` writes floor / ceil / light /
special / hurtPerSec / glow / materials (merged per key); `glow` also sets materials.floor to the
glow material, as the converter does. Patches run BEFORE lights and things are placed, so a new glow
sector gets a pool light, and things standing on a moved floor follow it.

Spawns stand at `at` on the floor of the sector under it (`sector`, optional, asserts which), facing
`yaw` (radians, 0 = -z, the start rule) or `face` (a point to look at). A spawn must be in a sector
(not the void), at least the body radius from any wall it cannot pass, and its id must be new.
Every problem is an OverrideError naming the entry.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

# Mirrors of src/lab/sdf-zombie/webgpu/level-def.ts SPAWN_KINDS and sector-def.ts SECTOR_SPECIALS /
# GLOW_KINDS / SECTOR_BODY_RADIUS_M / SECTOR_STEP_M / SECTOR_HEADROOM_M (test_doom_overrides.py
# checks the TypeScript still says the same).
SPAWN_KINDS = ("zombie", "soldier", "cultist", "juggernaut", "warbull", "deadeye", "butcher", "flayer", "teratoma")
SECTOR_SPECIALS = ("none", "hurt", "flicker", "pulse", "strobe")
GLOW_KINDS = ("nukage", "lava", "acid")
BODY_RADIUS_M = 0.34
STEP_M = 0.75
HEADROOM_M = 1.9

TOP_KEYS = {"map", "note", "sectors", "spawns"}
SECTOR_KEYS = {"sector", "at", "expect", "set", "note"}
SET_KEYS = {"floor", "ceil", "light", "special", "hurtPerSec", "glow", "materials"}
MATERIAL_KEYS = {"floor", "ceil", "wall"}
SPAWN_KEYS = {"id", "kind", "at", "yaw", "face", "sector", "note"}


class OverrideError(ValueError):
    pass


def default_path(map_name: str) -> Path:
    return Path(__file__).resolve().parent / "overrides" / f"{map_name.lower()}.json"


def load(path: Path) -> dict:
    try:
        data = json.loads(Path(path).read_text())
    except json.JSONDecodeError as e:
        raise OverrideError(f"{path}: not JSON ({e})") from e
    if not isinstance(data, dict):
        raise OverrideError(f"{path}: the top level must be an object")
    return data


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _xz(v, where: str) -> tuple[float, float]:
    if not (isinstance(v, list) and len(v) == 2 and all(_num(c) for c in v)):
        raise OverrideError(f"{where}: must be [x, z] in metres")
    return float(v[0]), float(v[1])


def _unknown(o: dict, allowed: set[str], where: str) -> None:
    extra = sorted(set(o) - allowed)
    if extra:
        raise OverrideError(f"{where}: unknown key(s) {extra} (allowed: {sorted(allowed)})")


def check_top(ov: dict, map_name: str) -> None:
    _unknown(ov, TOP_KEYS, "overrides")
    if str(ov.get("map", "")).upper() != map_name.upper():
        raise OverrideError(f"overrides: \"map\" is {ov.get('map')!r}, converting {map_name.upper()}")
    for key in ("sectors", "spawns"):
        if not isinstance(ov.get(key, []), list):
            raise OverrideError(f"overrides.{key}: must be a list")


def _inside(px: float, pz: float, segs) -> bool:
    odd = False
    for (ax, az), (bx, bz) in segs:
        if (az > pz) != (bz > pz) and px < ax + (pz - az) * (bx - ax) / (bz - az):
            odd = not odd
    return odd


def sectors_at(x: float, z: float, sector_segs) -> list[int]:
    """Every sector whose boundary (even-odd) holds (x, z): one, except on a shared line or in a bad map."""
    return [i for i, segs in enumerate(sector_segs) if segs and _inside(x, z, segs)]


def _pick(entry: dict, where: str, sector_segs, n: int) -> int:
    idx = entry.get("sector")
    if idx is not None and not (isinstance(idx, int) and not isinstance(idx, bool) and 0 <= idx < n):
        raise OverrideError(f"{where}: sector {idx!r} is not one of the map's {n} sectors (0..{n - 1})")
    if "at" not in entry:
        if idx is None:
            raise OverrideError(f"{where}: needs \"sector\" (an index) or \"at\" ([x, z])")
        return idx
    x, z = _xz(entry["at"], f"{where}.at")
    found = sectors_at(x, z, sector_segs)
    if not found:
        raise OverrideError(f"{where}: ({x}, {z}) is in no sector (the void)")
    if idx is not None:
        if idx not in found:
            raise OverrideError(f"{where}: ({x}, {z}) is in sector(s) {found}, not sector {idx}")
        return idx
    if len(found) > 1:
        raise OverrideError(f"{where}: ({x}, {z}) is in sectors {found}: move the point or add \"sector\"")
    return found[0]


def apply_sectors(ov: dict, out_sectors: list[dict], sector_segs) -> list[dict]:
    """Patch out_sectors in place. Returns one {sector, set} record per entry (for the summary)."""
    done = []
    seen: dict[int, str] = {}
    for k, entry in enumerate(ov.get("sectors", [])):
        where = f"overrides.sectors[{k}]"
        if not isinstance(entry, dict):
            raise OverrideError(f"{where}: must be an object")
        _unknown(entry, SECTOR_KEYS, where)
        i = _pick(entry, where, sector_segs, len(out_sectors))
        if i in seen:
            raise OverrideError(f"{where}: sector {i} is already patched by {seen[i]}")
        seen[i] = where
        sec = out_sectors[i]
        for key, want in (entry.get("expect") or {}).items():
            have = sec.get("materials", {}).get(key[len("materials."):]) if key.startswith("materials.") else sec.get(key)
            if key == "special" and have is None:
                have = "none"
            if have != want and not (_num(have) and _num(want) and abs(have - want) < 1e-6):
                raise OverrideError(f"{where}: sector {i} expected {key} {want!r}, the converter gave {have!r}")
        patch = entry.get("set")
        if not isinstance(patch, dict) or not patch:
            raise OverrideError(f"{where}: needs a non-empty \"set\" object")
        _unknown(patch, SET_KEYS, f"{where}.set")
        for key in ("floor", "ceil", "light", "hurtPerSec"):
            if key in patch and not _num(patch[key]):
                raise OverrideError(f"{where}.set.{key}: must be a number")
        if "light" in patch and not 0 <= patch["light"] <= 1:
            raise OverrideError(f"{where}.set.light: must be 0..1")
        if "special" in patch and patch["special"] not in SECTOR_SPECIALS:
            raise OverrideError(f"{where}.set.special: one of {SECTOR_SPECIALS}")
        if "glow" in patch and patch["glow"] is not None and patch["glow"] not in GLOW_KINDS:
            raise OverrideError(f"{where}.set.glow: one of {GLOW_KINDS} or null")
        mats = patch.get("materials", {})
        if not isinstance(mats, dict) or not all(isinstance(v, str) and v for v in mats.values()):
            raise OverrideError(f"{where}.set.materials: an object of material names")
        _unknown(mats, MATERIAL_KEYS, f"{where}.set.materials")
        for key in ("floor", "ceil", "light", "hurtPerSec"):
            if key in patch:
                v = patch[key]
                sec[key] = v if isinstance(v, int) else round(float(v), 4)
        if "special" in patch:
            if patch["special"] == "none":
                sec.pop("special", None)
            else:
                sec["special"] = patch["special"]
        sec["materials"] = {**sec["materials"], **mats}
        if "glow" in patch:
            if patch["glow"] is None:
                sec.pop("glow", None)
            else:
                sec["glow"] = patch["glow"]
                sec["materials"]["floor"] = patch["glow"]
        if sec.get("special") == "hurt" and not sec.get("hurtPerSec", 0) > 0:
            raise OverrideError(f"{where}: sector {i} is hurt with no hurtPerSec > 0")
        if sec.get("special") != "hurt":
            sec.pop("hurtPerSec", None)
        if not sec["ceil"] > sec["floor"]:
            raise OverrideError(f"{where}: sector {i} ceiling {sec['ceil']} <= floor {sec['floor']}")
        done.append({"sector": i, "set": patch})
    return done


def _seg_dist(px: float, pz: float, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = 0.0 if dx == dz == 0 else max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def apply_spawns(ov: dict, spawns: list[dict], used_ids: set[str], vertices, lines, out_sectors, sector_segs) -> list[dict]:
    """Append the override spawns to `spawns`. `lines` are the level's output lines ({v, front, back?})."""
    added = []
    for k, entry in enumerate(ov.get("spawns", [])):
        where = f"overrides.spawns[{k}]"
        if not isinstance(entry, dict):
            raise OverrideError(f"{where}: must be an object")
        _unknown(entry, SPAWN_KEYS, where)
        sid = entry.get("id")
        if not isinstance(sid, str) or not sid:
            raise OverrideError(f"{where}: needs a string id")
        where = f"overrides.spawns[{k}] ({sid})"
        if sid in used_ids:
            raise OverrideError(f"{where}: id {sid!r} is already used")
        if entry.get("kind") not in SPAWN_KINDS:
            raise OverrideError(f"{where}: kind {entry.get('kind')!r} is not one of {SPAWN_KINDS}")
        if "at" not in entry:
            raise OverrideError(f"{where}: needs \"at\" ([x, z])")
        i = _pick(entry, where, sector_segs, len(out_sectors))
        x, z = _xz(entry["at"], f"{where}.at")
        floor = out_sectors[i]["floor"]
        if out_sectors[i]["ceil"] - floor < HEADROOM_M:
            raise OverrideError(f"{where}: sector {i} has {out_sectors[i]['ceil'] - floor:.2f} m of headroom, a body needs {HEADROOM_M}")
        # A wall it cannot pass: a one-sided line, or a two-sided one whose other side is a climb over
        # the step or too low a gap. Within the body radius, the body starts inside it.
        for ln in lines:
            if i not in (ln["front"], ln.get("back")):
                continue
            other = ln.get("back") if ln["front"] == i else ln["front"]
            if other == i:                 # both sides in this sector: a line drawn across its floor
                continue
            if other is not None:
                o = out_sectors[other]
                if o["floor"] - floor <= STEP_M and min(o["ceil"], out_sectors[i]["ceil"]) - max(o["floor"], floor) >= HEADROOM_M:
                    continue
            d = _seg_dist(x, z, vertices[ln["v"][0]], vertices[ln["v"][1]])
            if d < BODY_RADIUS_M:
                raise OverrideError(f"{where}: ({x}, {z}) is {d:.2f} m from a wall of sector {i}, a body needs {BODY_RADIUS_M}")
        if ("yaw" in entry) == ("face" in entry):
            raise OverrideError(f"{where}: needs exactly one of \"yaw\" (radians) or \"face\" ([x, z])")
        if "yaw" in entry:
            if not _num(entry["yaw"]):
                raise OverrideError(f"{where}.yaw: must be a number (radians)")
            yaw = float(entry["yaw"])
        else:
            fx, fz = _xz(entry["face"], f"{where}.face")
            if (fx, fz) == (x, z):
                raise OverrideError(f"{where}.face: the spawn's own point")
            yaw = math.atan2(fx - x, -(fz - z))          # the start rule: 0 faces -z, +pi/2 faces +x
        spawn = {"id": sid, "kind": entry["kind"], "pos": [round(x, 4), floor, round(z, 4)], "yaw": round(yaw, 6)}
        spawns.append(spawn)
        used_ids.add(sid)
        added.append({**spawn, "sector": i})
    return added
