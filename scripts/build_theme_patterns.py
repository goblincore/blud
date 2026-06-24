#!/usr/bin/env python3
"""Join the raw map-analysis dump + vision labels into the theme-template
`patterns.json` that `src/dev/theme-preview.ts` loads and
`scripts/validate_patterns_schema.py` validates (R5.1 / TASKS.md P6).

Pipeline (all artifacts are gitignored dev-only outputs under
public/assets/map-research/):

    analyze_maps.py        -> patterns.raw.json   (full statistics dump)
    get_top_families.py    -> (top-30 families, stdout)
    generate_labels.py     -> labels.json         (vision names + theme tags)
    build_theme_patterns.py-> patterns.json       (THIS script — theme shape)
    validate_patterns_schema.py patterns.json     (schema gate)

The raw dump carries floor/wall texture families and floor->wall / ceiling->wall
co-occurrence counts; `labels.json` carries the human/vision family names and
theme tags. This script weights each family's picnums by their co-occurrence
prominence (normalized to sum 1.0), derives ceiling picnums from the
ceiling->wall co-occurrence, and emits the per-map layout archetypes (the R5.1
vision pass, embedded below). Output top-level keys: `texture_families`,
`map_archetypes`, `geometry`, `metadata`.

Usage:
    python3 scripts/build_theme_patterns.py \
        [--raw public/assets/map-research/patterns.raw.json] \
        [--labels public/assets/map-research/labels.json] \
        [--out public/assets/map-research/patterns.json]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

# R5.1 vision pass — per-map layout archetype + dominant theme tag
# (docs/dev-notes/2026-04-21-blood-map-research.md §R5.1). Embedded the same way
# generate_labels.py embeds the family vision labels: this is a manual/vision
# classification, not something analyze_maps.py can derive.
MAP_ARCHETYPES: dict[str, dict[str, str]] = {
    "DWBB1.MAP":   {"archetype": "hub-and-spokes",      "theme_tag": "crypt"},
    "DWBB2.MAP":   {"archetype": "corridor-chain",      "theme_tag": "crypt"},
    "DWBB3.MAP":   {"archetype": "multi-arena",         "theme_tag": "crypt"},
    "DWE1M1.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "crypt"},
    "DWE1M2.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "crypt"},
    "DWE1M3.MAP":  {"archetype": "branching-tree",      "theme_tag": "crypt"},
    "DWE1M4.MAP":  {"archetype": "multi-arena",         "theme_tag": "wood"},
    "DWE1M5.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "wood"},
    "DWE1M6.MAP":  {"archetype": "corridor-chain",      "theme_tag": "crypt"},
    "DWE1M7.MAP":  {"archetype": "maze",                "theme_tag": "crypt"},
    "DWE1M8.MAP":  {"archetype": "arena-with-closets",  "theme_tag": "crypt"},
    "DWE1M9.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "crypt"},
    "DWE1M10.MAP": {"archetype": "arena-with-closets",  "theme_tag": "hell"},
    "DWE1M11.MAP": {"archetype": "corridor-chain",      "theme_tag": "crypt"},
    "DWE1M12.MAP": {"archetype": "multi-arena",         "theme_tag": "ice"},
    "DWE2M1.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "stone"},
    "DWE2M2.MAP":  {"archetype": "corridor-chain",      "theme_tag": "stone"},
    "DWE2M3.MAP":  {"archetype": "multi-arena",         "theme_tag": "stone"},
    "DWE2M4.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "stone"},
    "DWE2M5.MAP":  {"archetype": "maze",                "theme_tag": "stone"},
    "DWE2M6.MAP":  {"archetype": "corridor-chain",      "theme_tag": "stone"},
    "DWE2M7.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "stone"},
    "DWE2M8.MAP":  {"archetype": "multi-arena",         "theme_tag": "stone"},
    "DWE2M9.MAP":  {"archetype": "arena-with-closets",  "theme_tag": "stone"},
    "DWE2M10.MAP": {"archetype": "multi-arena",         "theme_tag": "tech"},
    "DWE2M11.MAP": {"archetype": "arena-with-closets",  "theme_tag": "tech"},
    "DWE2M12.MAP": {"archetype": "hub-and-spokes",      "theme_tag": "tech"},
    "DWE3M1.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "brick"},
    "DWE3M2.MAP":  {"archetype": "corridor-chain",      "theme_tag": "brick"},
    "DWE3M3.MAP":  {"archetype": "multi-arena",         "theme_tag": "brick"},
    "DWE3M4.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "brick"},
    "DWE3M5.MAP":  {"archetype": "maze",                "theme_tag": "brick"},
    "DWE3M6.MAP":  {"archetype": "corridor-chain",      "theme_tag": "brick"},
    "DWE3M7.MAP":  {"archetype": "hub-and-spokes",      "theme_tag": "brick"},
    "DWE3M8.MAP":  {"archetype": "multi-arena",         "theme_tag": "brick"},
    "DWE3M9.MAP":  {"archetype": "arena-with-closets",  "theme_tag": "brick"},
    "DWE3M10.MAP": {"archetype": "arena-with-closets",  "theme_tag": "flesh"},
    "DWE3M11.MAP": {"archetype": "multi-arena",         "theme_tag": "flesh"},
    "DWE3M12.MAP": {"archetype": "hub-and-spokes",      "theme_tag": "flesh"},
}


# ---------------------------------------------------------------------------
# Pure join helpers (unit-tested in scripts/tests/test_build_theme_patterns.py)
# ---------------------------------------------------------------------------

def normalize_weights(scores: dict[int, float], top_n: int | None = None) -> list[dict]:
    """Turn {picnum: score} into a sorted, normalized [{picnum, weight}] list.

    Drops non-positive scores, sorts by score desc (picnum asc as tiebreak),
    keeps the top `top_n`, and normalizes weights to sum to 1.0. Returns [] if
    no positive scores (callers must supply a fallback to stay schema-valid —
    floors/walls/ceilings may not be empty)."""
    pos = [(p, s) for p, s in scores.items() if s > 0]
    if not pos:
        return []
    pos.sort(key=lambda kv: (-kv[1], kv[0]))
    if top_n is not None:
        pos = pos[:top_n]
    total = sum(s for _, s in pos)
    out = [{"picnum": int(p), "weight": round(s / total, 4)} for p, s in pos]
    # Correct rounding drift onto the largest entry so the sum is exactly 1.0.
    drift = round(1.0 - sum(e["weight"] for e in out), 4)
    if out and drift:
        out[0]["weight"] = round(out[0]["weight"] + drift, 4)
    return out


def uniform_weights(picnums: list[int], top_n: int | None = None) -> list[dict]:
    """Fallback: equal weight across `picnums` (used when co-occurrence data is
    absent for a family). Normalized to sum 1.0."""
    pics = list(dict.fromkeys(int(p) for p in picnums))  # dedupe, keep order
    if top_n is not None:
        pics = pics[:top_n]
    return normalize_weights({p: 1.0 for p in pics}, top_n=None)


def floor_weights(floor_picnums: list[int], cooc_floor_wall: dict, top_n: int = 6) -> list[dict]:
    """Weight a family's floor picnums by total floor->wall co-occurrence."""
    scores = {
        int(f): sum(cooc_floor_wall.get(str(f), {}).values())
        for f in floor_picnums
    }
    return normalize_weights(scores, top_n) or uniform_weights(floor_picnums, top_n)


def wall_weights(wall_picnums: list[int], floor_picnums: list[int],
                 cooc_floor_wall: dict, top_n: int = 8) -> list[dict]:
    """Weight a family's wall picnums by how often they co-occur with the
    family's floors."""
    scores: dict[int, float] = {}
    for w in wall_picnums:
        wkey = str(w)
        scores[int(w)] = sum(
            cooc_floor_wall.get(str(f), {}).get(wkey, 0) for f in floor_picnums
        )
    return normalize_weights(scores, top_n) or uniform_weights(wall_picnums, top_n)


def ceiling_weights(wall_picnums: list[int], cooc_ceil_wall: dict,
                    fallback_picnum: int, top_n: int = 4) -> list[dict]:
    """Derive a family's ceiling picnums from ceiling->wall co-occurrence: a
    ceiling that frequently appears over the family's walls. Falls back to the
    family's top wall picnum when no ceiling data co-occurs (so the list is
    never empty — required by the schema)."""
    wall_set = {str(w) for w in wall_picnums}
    scores: dict[int, float] = {}
    for ceil_str, partners in cooc_ceil_wall.items():
        score = sum(cnt for wp, cnt in partners.items() if wp in wall_set)
        if score > 0:
            scores[int(ceil_str)] = score
    weighted = normalize_weights(scores, top_n)
    return weighted or [{"picnum": int(fallback_picnum), "weight": 1.0}]


def build_texture_families(labels: list[dict], raw: dict) -> dict:
    """Join vision labels with raw co-occurrence into weighted theme families."""
    gs = raw.get("globalStats", {})
    cooc_floor_wall = gs.get("globalFloorWallCooccurrence", {})
    cooc_ceil_wall = gs.get("globalCeilWallCooccurrence", {})

    families: dict[str, dict] = {}
    skipped: list[str] = []
    for entry in labels:
        fam_id = entry["family_id"]
        floors_in = entry.get("floor_picnums") or []
        walls_in = entry.get("wall_picnums") or []
        if not floors_in or not walls_in:
            skipped.append(fam_id)
            continue
        walls = wall_weights(walls_in, floors_in, cooc_floor_wall)
        floors = floor_weights(floors_in, cooc_floor_wall)
        ceilings = ceiling_weights(walls_in, cooc_ceil_wall,
                                   fallback_picnum=walls[0]["picnum"])
        families[fam_id] = {
            "name": entry["name"],
            "theme_tag": entry["theme_tag"],
            "sector_count": entry.get("sector_count", 0),
            "floors": floors,
            "walls": walls,
            "ceilings": ceilings,
        }
    return families, skipped


def build_geometry(raw: dict) -> dict:
    """Carry a curated, generator-useful subset of the structural stats from the
    raw dump. The validator only requires `geometry` to be present; these fields
    feed the procedural-levels generator tuning (spec §5.1)."""
    gs = raw.get("globalStats", {})
    summary = raw.get("campaignSummary", {})
    sector_lotags = gs.get("sectorLotags", {})
    total_sectors = summary.get("totalSectors") or summary.get("sectors")
    door_count = sector_lotags.get("600", 0)
    geometry = {
        "sectorAreas": gs.get("sectorAreas"),
        "sectorAreaHistogram": gs.get("sectorAreaHistogram"),
        "wallCounts": gs.get("wallCounts"),
        "heightDeltas": gs.get("heightDeltas"),
        "portalCounts": gs.get("portalCounts"),
        "portalHistogram": gs.get("portalHistogram"),
        "dudeSectorAreaDistribution": gs.get("dudeSectorAreaDistribution"),
    }
    if total_sectors:
        geometry["doorFrequency"] = round(door_count / total_sectors, 4)
    return geometry


def build_patterns(labels: list[dict], raw: dict) -> tuple[dict, list[str]]:
    families, skipped = build_texture_families(labels, raw)
    patterns = {
        "metadata": {
            "version": "r5.1",
            "maps_analyzed": len(MAP_ARCHETYPES),
            "generated_from": "patterns.raw.json + labels.json",
        },
        "texture_families": families,
        "map_archetypes": MAP_ARCHETYPES,
        "geometry": build_geometry(raw),
    }
    return patterns, skipped


def main() -> int:
    base = Path("public/assets/map-research")
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=base / "patterns.raw.json")
    ap.add_argument("--labels", type=Path, default=base / "labels.json")
    ap.add_argument("--out", type=Path, default=base / "patterns.json")
    args = ap.parse_args()

    for p in (args.raw, args.labels):
        if not p.exists():
            print(f"ERROR: required input {p} not found. Run the pipeline first "
                  f"(analyze_maps.py -> get_top_families.py | generate_labels.py).")
            return 1

    raw = json.loads(args.raw.read_text())
    labels = json.loads(args.labels.read_text())

    patterns, skipped = build_patterns(labels, raw)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(patterns, indent=2))

    print(f"OK  wrote {args.out}  "
          f"({len(patterns['texture_families'])} families, "
          f"{len(patterns['map_archetypes'])} maps)")
    if skipped:
        print(f"NOTE: skipped {len(skipped)} families with no floor or wall "
              f"picnums: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
