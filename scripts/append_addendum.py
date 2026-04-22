#!/usr/bin/env python3
import json
from pathlib import Path
from collections import Counter

def main():
    labels_path = Path("public/assets/map-research/labels.json")
    layouts_path = Path("public/assets/map-research/layouts.json")
    dev_notes_path = Path("docs/dev-notes/2026-04-21-blood-map-research.md")

    with open(labels_path, "r") as f:
        labels = json.load(f)
    with open(layouts_path, "r") as f:
        layouts = json.load(f)

    addendum = "\n## R5.1 addendum (vision pass)\n\n"
    addendum += "This section summarizes the results of a vision-assisted analysis of Blood's map data. The 181 texture families identified in R5 were too granular for procedural generation. This pass names the top 30 families and classifies all 39 campaign maps into layout archetypes, providing a higher-level vocabulary for theme generation.\n\n"

    # Top-30 Labeled Texture Families
    addendum += "### Top-30 Labeled Texture Families\n\n"
    addendum += "| Family ID | Name | Theme Tag | Sector Count |\n"
    addendum += "|-----------|------|-----------|--------------|\n"
    for label in labels:
        addendum += f"| {label['family_id']} | {label['name']} | `{label['theme_tag']}` | {label['sector_count']} |\n"
    addendum += "\n"

    # Map Layout Archetypes
    addendum += "### Map Layout Archetypes\n\n"
    addendum += "| Map | Archetype | Dominant Theme Tag |\n"
    addendum += "|-----|-----------|--------------------|\n"
    for layout in sorted(layouts, key=lambda x: x['map']):
        addendum += f"| {layout['map']} | `{layout['archetype']}` | `{layout['dominant_theme_tag']}` |\n"
    addendum += "\n"
    
    # Themes Frequency
    addendum += "### Themes Frequency\n\n"
    theme_counts = Counter(l['dominant_theme_tag'] for l in layouts)
    archetype_counts = Counter(l['archetype'] for l in layouts)
    
    addendum += "**By Theme Tag:**\n\n"
    for theme, count in theme_counts.most_common():
        addendum += f"- `{theme}`: {count} maps\n"
    addendum += "\n"
    
    addendum += "**By Archetype:**\n\n"
    for archetype, count in archetype_counts.most_common():
        addendum += f"- `{archetype}`: {count} maps\n"
    addendum += "\n"

    # Implications for M6 Procgen
    addendum += "### Implications for M6 Procgen\n\n"
    addendum += "The labeled families and archetypes directly inform the `Theme Template` schema from R5. The `theme_tag` provides a high-level theme name (e.g., 'crypt', 'industrial'), and the textures within that family can populate the `textures` section of the template. The layout archetypes can be used to select a `layoutAlgorithm` and tune connectivity parameters like `hubRatio` and `deadEndRatio` to produce maps with a characteristic Blood feel.\n"

    with open(dev_notes_path, "a") as f:
        f.write(addendum)

    print(f"Successfully appended R5.1 addendum to {dev_notes_path}")

if __name__ == "__main__":
    main()
