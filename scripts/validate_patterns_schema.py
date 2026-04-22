#!/usr/bin/env python3
"""Validate patterns.json against the R5 theme-template schema.

Usage:
  python scripts/validate_patterns_schema.py [path/to/patterns.json]

Exits 0 on valid or missing file (with note); 1 on schema drift.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

# Vocabularies from R5.1 addendum (docs/dev-notes/2026-04-21-blood-map-research.md §R5.1).
KNOWN_THEME_TAGS = {
    "crypt", "sewer", "wood", "stone", "earth", "industrial",
    "brick", "hell", "ice", "flesh", "tech", "outdoor", "organic",
}
KNOWN_ARCHETYPES = {
    "hub-and-spokes", "corridor-chain", "multi-arena",
    "arena-with-closets", "maze", "branching-tree",
}
WEIGHT_SUM_TOLERANCE = 0.05


class SchemaError(ValueError):
    """Raised when patterns.json drifts from the documented schema."""


def _require(obj: dict, key: str, path: str) -> object:
    if key not in obj:
        raise SchemaError(f"{path}: missing required field '{key}'")
    return obj[key]


def _validate_weighted_picnums(entries: list, path: str) -> None:
    if not isinstance(entries, list) or not entries:
        raise SchemaError(f"{path}: must be a non-empty list of {{picnum, weight}} entries")
    total = 0.0
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            raise SchemaError(f"{path}[{i}]: must be an object")
        if "picnum" not in e or not isinstance(e["picnum"], int):
            raise SchemaError(f"{path}[{i}]: missing int 'picnum'")
        if "weight" not in e or not isinstance(e["weight"], (int, float)):
            raise SchemaError(f"{path}[{i}]: missing numeric 'weight'")
        total += float(e["weight"])
    if abs(total - 1.0) > WEIGHT_SUM_TOLERANCE:
        raise SchemaError(
            f"{path}: weight sum {total:.3f} not close to 1.0 "
            f"(tolerance ±{WEIGHT_SUM_TOLERANCE})"
        )


def _validate_family(fam_id: str, fam: dict) -> None:
    path = f"texture_families.{fam_id}"
    for field in ("name", "theme_tag", "sector_count", "floors", "walls", "ceilings"):
        _require(fam, field, path)
    if fam["theme_tag"] not in KNOWN_THEME_TAGS:
        raise SchemaError(
            f"{path}.theme_tag: '{fam['theme_tag']}' not in known tags {sorted(KNOWN_THEME_TAGS)}"
        )
    _validate_weighted_picnums(fam["floors"], f"{path}.floors")
    _validate_weighted_picnums(fam["walls"], f"{path}.walls")
    _validate_weighted_picnums(fam["ceilings"], f"{path}.ceilings")


def _validate_archetype_entry(map_name: str, entry: dict) -> None:
    path = f"map_archetypes.{map_name}"
    _require(entry, "archetype", path)
    _require(entry, "theme_tag", path)
    if entry["archetype"] not in KNOWN_ARCHETYPES:
        raise SchemaError(
            f"{path}.archetype: '{entry['archetype']}' not in known archetypes "
            f"{sorted(KNOWN_ARCHETYPES)}"
        )
    if entry["theme_tag"] not in KNOWN_THEME_TAGS:
        raise SchemaError(f"{path}.theme_tag: '{entry['theme_tag']}' not in known tags")


def validate(data: dict) -> None:
    _require(data, "texture_families", "")
    _require(data, "map_archetypes", "")
    _require(data, "geometry", "")

    families = data["texture_families"]
    if not isinstance(families, dict) or not families:
        raise SchemaError("texture_families: must be a non-empty object")
    for fam_id, fam in families.items():
        _validate_family(fam_id, fam)

    archetypes = data["map_archetypes"]
    if not isinstance(archetypes, dict) or not archetypes:
        raise SchemaError("map_archetypes: must be a non-empty object")
    for m, entry in archetypes.items():
        _validate_archetype_entry(m, entry)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path", type=Path, nargs="?",
                   default=Path("public/assets/map-research/patterns.json"))
    args = p.parse_args()
    if not args.path.exists():
        print(f"NOTE: {args.path} not present (gitignored — generate via analyze_maps.py to run full check).")
        print("Validator logic verified against synthetic fixtures in tests/test_validate_patterns_schema.py.")
        return 0
    try:
        data = json.loads(args.path.read_text())
        validate(data)
    except SchemaError as e:
        print(f"SCHEMA ERROR: {e}", file=sys.stderr)
        return 1
    print(f"OK  {args.path}  ({len(data.get('texture_families', {}))} families, "
          f"{len(data.get('map_archetypes', {}))} maps)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
