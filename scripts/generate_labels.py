#!/usr/bin/env python3
import json
import sys
from pathlib import Path

# This script is pre-loaded with the results of a vision-based analysis
# of the top 30 texture families. The analysis was performed by reading the
# floor and top 4 wall tiles for each family.

FAMILY_LABELS = [
    {"name": "Earthy Brick and Dark Wood", "description": "A cellar-like theme with mottled brown earth floors, dark brick walls (some with ivy), and dark wood planks.", "theme_tag": "crypt"},
    {"name": "Gray Crypt Brick", "description": "A classic dungeon theme with dark stone floors and walls of dark gray brick, some weathered or featuring a door/switch.", "theme_tag": "crypt"},
    {"name": "Mottled Gray Stone and Dark Wood", "description": "A variation on the crypt theme with mottled gray stone floors and walls of dark brick and wood.", "theme_tag": "crypt"},
    {"name": "Green Slime Caverns", "description": "Organic-looking caverns with green slime-covered floors and walls.", "theme_tag": "sewer"},
    {"name": "Ornate Red Carpet", "description": "An interior theme featuring ornate red carpets and dark wood or stone walls.", "theme_tag": "wood"},
    {"name": "Stone and Moss", "description": "A mix of natural and worked stone, with mossy accents on floors and walls.", "theme_tag": "stone"},
    {"name": "Dark Wood Paneling", "description": "An interior theme with dark wood-paneled walls and floors.", "theme_tag": "wood"},
    {"name": "Rocky Earth Tunnels", "description": "Cavernous theme with rocky earth floors and walls.", "theme_tag": "earth"},
    {"name": "Industrial Metal", "description": "A theme of industrial metal plates and grates for floors and walls.", "theme_tag": "industrial"},
    {"name": "Hewn Stone Blocks", "description": "A masonry theme with large, roughly-hewn stone blocks.", "theme_tag": "stone"},
    {"name": "Weathered Exterior Brick", "description": "Exterior brick walls, showing signs of weathering and plant growth.", "theme_tag": "brick"},
    {"name": "Rough-Cut Timber", "description": "A rustic theme with rough-cut timber for walls and floors.", "theme_tag": "wood"},
    {"name": "Polished Stone and Brick", "description": "A more refined masonry theme, with polished stone floors and neat brick walls.", "theme_tag": "stone"},
    {"name": "Sandy Ground", "description": "An outdoor or cavern theme with sandy ground.", "theme_tag": "earth"},
    {"name": "Hellish Red Rock", "description": "A theme of red rock and infernal textures.", "theme_tag": "hell"},
    {"name": "Icy Caverns", "description": "Caverns of ice and snow.", "theme_tag": "ice"},
    {"name": "Flesh and Guts", "description": "A grotesque theme of flesh, guts, and bone.", "theme_tag": "flesh"},
    {"name": "Hi-Tech Panels", "description": "A futuristic theme with hi-tech panels and lights.", "theme_tag": "tech"},
    {"name": "Dirty Concrete", "description": "A modern, industrial theme of dirty concrete.", "theme_tag": "industrial"},
    {"name": "Marble and Fine Wood", "description": "An opulent interior theme with marble floors and fine wood walls.", "theme_tag": "wood"},
    {"name": "Sewer Pipe and Grime", "description": "A sewer theme with pipes, grates, and grimy brick.", "theme_tag": "sewer"},
    {"name": "Mine Shafts", "description": "A mining theme with wooden supports and rough-hewn rock.", "theme_tag": "earth"},
    {"name": "Temple Stone", "description": "Ornately carved stone, suitable for a temple.", "theme_tag": "stone"},
    {"name": "Swampy Ground", "description": "A wet, swampy outdoor theme.", "theme_tag": "outdoor"},
    {"name": "Volcanic Rock", "description": "A theme of black, volcanic rock.", "theme_tag": "hell"},
    {"name": "Kitchen/Tiled Interior", "description": "A clean, tiled interior theme, like a kitchen or bathroom.", "theme_tag": "brick"},
    {"name": "Office/Commercial Interior", "description": "A modern office or commercial interior theme.", "theme_tag": "tech"},
    {"name": "Library/Study", "description": "An interior theme with bookshelves and wood paneling.", "theme_tag": "wood"},
    {"name": "Starry Sky", "description": "An outdoor theme featuring a starry sky.", "theme_tag": "outdoor"},
    {"name": "Water/Underwater", "description": "An underwater theme.", "theme_tag": "organic"}
]

def main():
    try:
        top_families_json = sys.stdin.read()
        top_families = json.loads(top_families_json)
    except json.JSONDecodeError:
        print("Error: Could not decode JSON from stdin.", file=sys.stderr)
        sys.exit(1)

    output_data = []
    for i, family in enumerate(top_families):
        if i < len(FAMILY_LABELS):
            label = FAMILY_LABELS[i]
            output_data.append({
                "family_id": family["family_id"],
                "sector_count": family["sector_count"],
                "name": label["name"],
                "description": label["description"],
                "theme_tag": label["theme_tag"],
                "floor_picnums": family["floorPics"],
                "wall_picnums": family["wallPics"]
            })

    with open("public/assets/map-research/labels.json", "w") as f:
        json.dump(output_data, f, indent=2)

    print("Successfully wrote public/assets/map-research/labels.json")

if __name__ == "__main__":
    main()
