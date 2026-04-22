#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.collections import PatchCollection

# Add scripts directory to path to import map_parser
sys.path.insert(0, str(Path(__file__).parent))
from map_parser import parse_map

# Using a subset of the classification from analyze_maps.py
def classify_sprite(lotag: int) -> str:
    if 200 <= lotag <= 255:
        return "dude"
    # Simplified for rendering, we care about items vs enemies
    if 30 <= lotag <= 144:
        return "item"
    return "other"

def render_map(map_path: Path, out_dir: Path):
    print(f"Rendering {map_path.name}...")
    try:
        data = map_path.read_bytes()
        result = parse_map(data)
    except Exception as e:
        print(f"  Error parsing {map_path.name}: {e}")
        return

    sectors = result["sectors"]
    walls = result["walls"]
    sprites = result["sprites"]

    fig, ax = plt.subplots(figsize=(12, 12))
    ax.set_aspect('equal', adjustable='box')
    ax.set_facecolor('black')

    # Sector areas for coloring
    areas = []
    for s in sectors:
        wp = s["wallptr"]
        wn = s["wallnum"]
        if wn < 3:
            areas.append(0.0)
            continue
        area = 0.0
        for i in range(wn):
            wi = walls[wp + i]
            wj = walls[wp + ((i + 1) % wn)]
            area += wi["x"] * wj["y"]
            area -= wj["x"] * wi["y"]
        areas.append(abs(area) / 2.0)

    # Bins from analyze_maps.py
    bins = [0, 1e5, 5e5, 2e6, 1e7, 5e7, float("inf")]
    colors = ['#2a2a2a', '#4a4a4a', '#6a6a6a', '#8a8a8a', '#aaaaaa', '#cccccc']
    
    sector_patches = []
    sector_colors = []

    for i, sector in enumerate(sectors):
        sector_walls = []
        for w_idx in range(sector["wallptr"], sector["wallptr"] + sector["wallnum"]):
            wall = walls[w_idx]
            sector_walls.append((wall["x"], wall["y"]))
        
        polygon = Polygon(sector_walls, closed=True)
        sector_patches.append(polygon)

        area = areas[i]
        color = colors[-1]
        for bin_idx, upper_bound in enumerate(bins):
            if area < upper_bound:
                color = colors[bin_idx-1]
                break
        sector_colors.append(color)

    p = PatchCollection(sector_patches, facecolors=sector_colors, edgecolors='#505050', linewidths=0.5)
    ax.add_collection(p)

    # Sprites
    enemy_x, enemy_y = [], []
    item_x, item_y = [], []
    for sprite in sprites:
        category = classify_sprite(sprite['lotag'])
        if category == 'dude':
            enemy_x.append(sprite['x'])
            enemy_y.append(sprite['y'])
        elif category == 'item':
            item_x.append(sprite['x'])
            item_y.append(sprite['y'])
            
    ax.scatter(enemy_x, enemy_y, c='red', s=10, label='Enemies')
    ax.scatter(item_x, item_y, c='cyan', s=10, label='Items')

    # Player start
    player_start = result.get("pos")
    if player_start:
        ax.scatter(player_start['x'], player_start['y'], c='lime', s=50, marker='*', label='Player Start')

    ax.autoscale_view()
    plt.legend()
    plt.title(f"{map_path.name} Top-Down View")
    
    out_path = out_dir / f"{map_path.stem}.png"
    plt.savefig(out_path, bbox_inches='tight', pad_inches=0.1, facecolor='black')
    plt.close(fig)
    print(f"  Saved to {out_path}")

def main():
    ap = argparse.ArgumentParser(description="Render Blood .MAP files to top-down PNGs.")
    ap.add_argument("--blood-dir", default="/Users/donny/Documents/Raze/blood",
                    help="Blood data directory (contains .MAP files)")
    ap.add_argument("--out", default="public/assets/map-research/maps-topdown",
                    help="Output directory for PNGs")
    args = ap.parse_args()

    blood_dir = Path(args.blood_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    maps = sorted(blood_dir.glob("*.MAP"))
    if not maps:
        print(f"No .MAP files found in {blood_dir}")
        sys.exit(1)

    for map_path in maps:
        render_map(map_path, out_dir)

if __name__ == "__main__":
    main()
