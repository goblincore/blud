#!/usr/bin/env python3
import json
from pathlib import Path

def main():
    patterns_path = Path("public/assets/map-research/patterns.json")
    if not patterns_path.exists():
        print(f"Error: {patterns_path} not found.")
        return

    with open(patterns_path, "r") as f:
        data = json.load(f)

    global_stats = data.get("globalStats", {})
    texture_families = global_stats.get("textureFamilies", {})
    floor_wall_cooccurrence = global_stats.get("globalFloorWallCooccurrence", {})

    families_with_counts = []
    for family_id, family_data in texture_families.items():
        sector_count = 0
        for floor_pic in family_data.get("floorPics", []):
            floor_pic_str = str(floor_pic)
            if floor_pic_str in floor_wall_cooccurrence:
                sector_count += sum(floor_wall_cooccurrence[floor_pic_str].values())
        
        family_data["family_id"] = family_id
        family_data["sector_count"] = sector_count
        families_with_counts.append(family_data)

    sorted_families = sorted(families_with_counts, key=lambda x: x["sector_count"], reverse=True)

    top_30_families = sorted_families[:30]

    print(json.dumps(top_30_families, indent=2))

if __name__ == "__main__":
    main()
