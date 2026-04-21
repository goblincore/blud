#!/usr/bin/env python3
"""Extract per-tile metadata (w, h, anchor offsets) from all TILES*.ART files.

Usage: python -m scripts.extract_tile_meta <blood-dir> --out <path>
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from scripts.art_meta import read_art_meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("blood_dir", help="Blood data directory containing TILES*.ART")
    ap.add_argument("--out", required=True, help="Output JSON path")
    args = ap.parse_args()

    blood_dir = Path(args.blood_dir)
    all_meta: dict[str, dict] = {}
    art_files = sorted(list(blood_dir.glob("TILES*.ART")) + list(blood_dir.glob("tiles*.art")))
    # Deduplicate (case-insensitive filesystems may double-count)
    seen: set[str] = set()
    for art in art_files:
        key = art.name.upper()
        if key in seen:
            continue
        seen.add(key)
        for tile in read_art_meta(art):
            if tile["w"] == 0 and tile["h"] == 0:
                continue  # skip blanks
            all_meta[str(tile["picnum"])] = {
                "w": tile["w"],
                "h": tile["h"],
                "ox": tile["xoffset"],
                "oy": tile["yoffset"],
            }

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(all_meta, separators=(",", ":"), indent=0))
    print(f"wrote {len(all_meta)} tiles → {args.out}")


if __name__ == "__main__":
    main()
