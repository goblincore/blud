#!/usr/bin/env python3
import json
import sys
from pathlib import Path

def main():
    try:
        top_families_json = sys.stdin.read()
        top_families = json.loads(top_families_json)
    except json.JSONDecodeError:
        print("Error: Could not decode JSON from stdin.", file=sys.stderr)
        sys.exit(1)

    tiles_dir = Path("public/assets/blood-tiles/")
    if not tiles_dir.is_dir():
        print(f"Error: Tiles directory not found at {tiles_dir}", file=sys.stderr)
        sys.exit(1)

    all_picnums = set()
    for family in top_families:
        for picnum in family.get("floorPics", []):
            all_picnums.add(picnum)
        # Take top 4 wall pics for checking
        for picnum in family.get("wallPics", [])[:4]:
             all_picnums.add(picnum)

    missing_picnums = []
    for picnum in sorted(list(all_picnums)):
        tile_path = tiles_dir / f"{picnum:05d}.png"
        if not tile_path.exists():
            missing_picnums.append(picnum)

    if missing_picnums:
        print("Missing tile PNGs:")
        for picnum in missing_picnums:
            print(picnum)
    else:
        print("All required tile PNGs are present.")

if __name__ == "__main__":
    main()
