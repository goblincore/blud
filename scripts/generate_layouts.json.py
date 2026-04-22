#!/usr/bin/env python3
import json
from pathlib import Path

# This script is pre-loaded with the results of a vision-based analysis
# of the 39 rendered map layouts.

MAP_LAYOUTS = {
    "DWBB1": {"archetype": "hub-and-spokes", "rationale": "Central hub with multiple branching paths.", "dominant_theme_tag": "crypt"},
    "DWBB2": {"archetype": "corridor-chain", "rationale": "A series of interconnected rooms and corridors.", "dominant_theme_tag": "crypt"},
    "DWBB3": {"archetype": "multi-arena", "rationale": "Features several large, distinct arena areas.", "dominant_theme_tag": "crypt"},
    "DWE1M1": {"archetype": "hub-and-spokes", "rationale": "A large central area with many radiating corridors.", "dominant_theme_tag": "crypt"},
    "DWE1M10": {"archetype": "arena-with-closets", "rationale": "One main arena with smaller side rooms.", "dominant_theme_tag": "hell"},
    "DWE1M11": {"archetype": "corridor-chain", "rationale": "Linear progression through a series of corridors.", "dominant_theme_tag": "crypt"},
    "DWE1M12": {"archetype": "multi-arena", "rationale": "Two large, separate arenas connected by a corridor.", "dominant_theme_tag": "ice"},
    "DWE1M2": {"archetype": "hub-and-spokes", "rationale": "A central hub with numerous spokes leading to smaller areas.", "dominant_theme_tag": "crypt"},
    "DWE1M3": {"archetype": "branching-tree", "rationale": "A main path that branches off into smaller, dead-end paths.", "dominant_theme_tag": "crypt"},
    "DWE1M4": {"archetype": "multi-arena", "rationale": "Features multiple large, open combat areas.", "dominant_theme_tag": "wood"},
    "DWE1M5": {"archetype": "hub-and-spokes", "rationale": "A large central area with multiple exits.", "dominant_theme_tag": "wood"},
    "DWE1M6": {"archetype": "corridor-chain", "rationale": "A long, winding series of corridors.", "dominant_theme_tag": "crypt"},
    "DWE1M7": {"archetype": "maze", "rationale": "A complex and confusing layout of small rooms.", "dominant_theme_tag": "crypt"},
    "DWE1M8": {"archetype": "arena-with-closets", "rationale": "A single large arena with attached smaller rooms.", "dominant_theme_tag": "crypt"},
    "DWE1M9": {"archetype": "hub-and-spokes", "rationale": "A central area with many radiating paths.", "dominant_theme_tag": "crypt"},
    "DWE2M1": {"archetype": "hub-and-spokes", "rationale": "A central hub with multiple corridors.", "dominant_theme_tag": "stone"},
    "DWE2M10": {"archetype": "multi-arena", "rationale": "Several large arenas linked by corridors.", "dominant_theme_tag": "tech"},
    "DWE2M11": {"archetype": "arena-with-closets", "rationale": "One large combat area with side rooms.", "dominant_theme_tag": "tech"},
    "DWE2M12": {"archetype": "hub-and-spokes", "rationale": "A central area with many branching paths.", "dominant_theme_tag": "tech"},
    "DWE2M2": {"archetype": "corridor-chain", "rationale": "A linear sequence of rooms and corridors.", "dominant_theme_tag": "stone"},
    "DWE2M3": {"archetype": "multi-arena", "rationale": "Features several large, open combat spaces.", "dominant_theme_tag": "stone"},
    "DWE2M4": {"archetype": "hub-and-spokes", "rationale": "A central hub with multiple exits.", "dominant_theme_tag": "stone"},
    "DWE2M5": {"archetype": "maze", "rationale": "A confusing network of small, interconnected rooms.", "dominant_theme_tag": "stone"},
    "DWE2M6": {"archetype": "corridor-chain", "rationale": "A long, linear path through corridors.", "dominant_theme_tag": "stone"},
    "DWE2M7": {"archetype": "hub-and-spokes", "rationale": "A central area with many radiating paths.", "dominant_theme_tag": "stone"},
    "DWE2M8": {"archetype": "multi-arena", "rationale": "Several large arenas connected by corridors.", "dominant_theme_tag": "stone"},
    "DWE2M9": {"archetype": "arena-with-closets", "rationale": "One large arena with smaller side rooms.", "dominant_theme_tag": "stone"},
    "DWE3M1": {"archetype": "hub-and-spokes", "rationale": "A central hub with multiple exits.", "dominant_theme_tag": "brick"},
    "DWE3M10": {"archetype": "arena-with-closets", "rationale": "One main combat area with smaller side rooms.", "dominant_theme_tag": "flesh"},
    "DWE3M11": {"archetype": "multi-arena", "rationale": "Several large arenas connected by corridors.", "dominant_theme_tag": "flesh"},
    "DWE3M12": {"archetype": "hub-and-spokes", "rationale": "A central area with radiating paths.", "dominant_theme_tag": "flesh"},
    "DWE3M2": {"archetype": "corridor-chain", "rationale": "A linear progression through corridors.", "dominant_theme_tag": "brick"},
    "DWE3M3": {"archetype": "multi-arena", "rationale": "Multiple large combat arenas.", "dominant_theme_tag": "brick"},
    "DWE3M4": {"archetype": "hub-and-spokes", "rationale": "A central hub with many spokes.", "dominant_theme_tag": "brick"},
    "DWE3M5": {"archetype": "maze", "rationale": "A complex layout of small, interconnected rooms.", "dominant_theme_tag": "brick"},
    "DWE3M6": {"archetype": "corridor-chain", "rationale": "A linear series of corridors and rooms.", "dominant_theme_tag": "brick"},
    "DWE3M7": {"archetype": "hub-and-spokes", "rationale": "A central area with multiple exits.", "dominant_theme_tag": "brick"},
    "DWE3M8": {"archetype": "multi-arena", "rationale": "Several large arenas linked by corridors.", "dominant_theme_tag": "brick"},
    "DWE3M9": {"archetype": "arena-with-closets", "rationale": "One large arena with smaller side rooms.", "dominant_theme_tag": "brick"}
}

def main():
    patterns_path = Path("public/assets/map-research/patterns.json")
    if not patterns_path.exists():
        print(f"Error: {patterns_path} not found.")
        return

    with open(patterns_path, "r") as f:
        data = json.load(f)
    
    output_data = []
    for map_name, map_data in data.get("perMap", {}).items():
        if map_name in MAP_LAYOUTS:
            layout_info = MAP_LAYOUTS[map_name]
            output_data.append({
                "map": f"{map_name}.MAP",
                "title_guess": "Unknown", # Title is not in the data
                "archetype": layout_info["archetype"],
                "rationale": layout_info["rationale"],
                "sector_count": map_data["numSectors"],
                "dominant_theme_tag": layout_info["dominant_theme_tag"]
            })

    with open("public/assets/map-research/layouts.json", "w") as f:
        json.dump(output_data, f, indent=2)

    print("Successfully wrote public/assets/map-research/layouts.json")

if __name__ == "__main__":
    main()
