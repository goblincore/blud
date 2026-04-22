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
    
    output_data = []

    for i, family in enumerate(top_families):
        print(f"--- Family {i+1}/{len(top_families)} ---")
        family_id = family["family_id"]
        sector_count = family["sector_count"]
        
        print(f"Family ID: {family_id}")
        print(f"Sector Count: {sector_count}")

        floor_pics = family.get("floorPics", [])
        wall_pics = family.get("wallPics", [])
        
        print("Floor Picnums:", floor_pics)
        for picnum in floor_pics:
            print(f"read:public/assets/blood-tiles/{picnum:05d}.png")
            
        print("Wall Picnums (top 4):", wall_pics[:4])
        for picnum in wall_pics[:4]:
            print(f"read:public/assets/blood-tiles/{picnum:05d}.png")
        
        print("--- End Family ---")

if __name__ == "__main__":
    main()
