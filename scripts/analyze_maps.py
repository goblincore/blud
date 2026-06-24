#!/usr/bin/env python3
"""Analyze all Blood campaign .MAP files and extract structural/texture/sprite patterns.

Runs map_parser.parse_map over every .MAP in the Blood data directory,
aggregates statistics, and writes results to public/assets/map-research/patterns.json.
Also prints a human-readable summary to stdout.

Usage:
    python3 scripts/analyze_maps.py [--blood-dir DIR] [--out DIR]
"""

from __future__ import annotations
import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from map_parser import parse_map


# ---------------------------------------------------------------------------
# Blood sprite type enums (from common_game.h)
# ---------------------------------------------------------------------------

# Sprite lotag → type mapping (sprite.lotag = "type" in Blood terminology)
# These are the values stored in sprite.lotag that Blood uses to determine
# what kind of entity the sprite represents.
# NOTE: In Blood's map format, the sprite.lotag field IS the type identifier,
# not the lotag used in other Build games.

SPRITE_TYPES = {
    # Dudes (enemies)
    200: "kDudeBase",
    201: "Cultist_Tommy",
    202: "Cultist_Shotgun",
    203: "Zombie_AxeNormal",
    204: "Zombie_Butcher",
    205: "Zombie_AxeBuried",
    206: "Gargoyle_Flesh",
    207: "Gargoyle_Stone",
    208: "Gargoyle_StatueFlesh",
    209: "Gargoyle_StatueStone",
    210: "Phantasm",
    211: "HellHound",
    212: "Hand",
    213: "Spider_Brown",
    214: "Spider_Red",
    215: "Spider_Black",
    216: "Spider_Mother",
    217: "GillBeast",
    218: "BoneEel",
    219: "Bat",
    220: "Rat",
    221: "Pod_Green",
    222: "Tentacle_Green",
    223: "Pod_Fire",
    224: "Tentacle_Fire",
    225: "PodMother",
    226: "TentacleMother",
    227: "Cerberus_TwoHead",
    228: "Cerberus_OneHead",
    229: "Tchernobog",
    230: "Cultist_TommyProne",
    239: "Burning_Innocent",
    240: "Burning_Cultist",
    241: "Burning_ZombieAxe",
    242: "Burning_ZombieButcher",
    244: "Zombie_AxeLaying",
    245: "Innocent",
    246: "Cultist_ShotgunProne",
    247: "Cultist_Tesla",
    248: "Cultist_TNT",
    249: "Cultist_Beast",
    251: "Beast",
    # Things
    400: "TNT_Barrel",
    401: "Armed_ProxBomb",
    402: "Armed_RemoteBomb",
    405: "CrateFace",
    406: "GlassWindow",
    407: "Fluorescent",
    408: "WallCrack",
    410: "SpiderWeb",
    411: "MetalGrate",
    412: "FlammableTree",
    413: "Trap_Machinegun",
    414: "FallingRock",
    415: "KickablePail",
    416: "ObjectGib",
    417: "ObjectExplode",
    418: "Armed_TNTStick",
    419: "Armed_TNTBundle",
    426: "BloodChunks",
    # Ammo
    30: "Ammo_Flares",
    31: "Ammo_Shells",
    32: "Ammo_Bullets_50",
    33: "Ammo_Gasoline",
    34: "Ammo_TNTBundle",
    35: "Ammo_TNTProx",
    36: "Ammo_TNTRemote",
    37: "Ammo_Spray",
    38: "Ammo_TrappedSoul",
    39: "Ammo_Voodoo",
    # Weapons
    50: "Weapon_Flare",
    51: "Weapon_SawedOff",
    52: "Weapon_Tommy",
    53: "Weapon_Napalm",
    54: "Weapon_Dynamite",
    55: "Weapon_Spray",
    56: "Weapon_Tesla",
    57: "Weapon_LifeLeech",
    58: "Weapon_Voodoo",
    # Items — health
    107: "Health_DoctorBag",
    108: "Health_MedPouch",
    109: "Health_LifeEssence",
    110: "Health_LifeSeed",
    111: "Health_RedPotion",
    # Items — powerups
    112: "FeatherFall",
    113: "ShadowCloak",
    114: "DeathMask",
    115: "JumpBoots",
    117: "TwoGuns",
    118: "DivingSuit",
    119: "GasMask",
    121: "CrystalBall",
    124: "ReflectShots",
    125: "BeastVision",
    128: "ShroomDelirium",
    # Items — armor
    139: "Armor_Asbest",
    140: "Armor_Basic",
    141: "Armor_Body",
    142: "Armor_Fire",
    143: "Armor_Spirit",
    144: "Armor_Super",
    # Items — keys
    100: "Key_Skull",
    101: "Key_Eye",
    102: "Key_Fire",
    103: "Key_Dagger",
    104: "Key_Spider",
    105: "Key_Moon",
}

# Statnum categories
STATNUM_NAMES = {
    0: "Inactive",
    1: "Active",
    2: "Monster",
    3: "Projectile",
    4: "Decoration",
    5: "Item",
    6: "Effect",
    100: "Marker",
}

# Sector lotag → type mapping
SECTOR_TYPES = {
    0: "None",
    600: "ZMotion",
    602: "ZMotionSprite",
    604: "Teleport",
    612: "Path",
    613: "RotateStep",
    614: "SlideMarked",
    615: "RotateMarked",
    616: "Slide",
    617: "Rotate",
    618: "Damage",
    619: "Counter",
}

# Category classifiers for sprites
DUDE_RANGE = range(200, 255)
THING_RANGE = range(400, 436)
AMMO_RANGE = range(30, 40)
WEAPON_RANGE = range(50, 60)
ITEM_HEALTH_RANGE = range(107, 112)
ITEM_POWERUP_RANGE = set([112, 113, 114, 115, 117, 118, 119, 121, 124, 125, 128])
ITEM_ARMOR_RANGE = range(139, 145)
KEY_RANGE = range(100, 107)


def classify_sprite(lotag: int) -> str:
    if lotag in DUDE_RANGE:
        return "dude"
    if lotag in THING_RANGE:
        return "thing"
    if lotag in AMMO_RANGE:
        return "ammo"
    if lotag in WEAPON_RANGE:
        return "weapon"
    if lotag in ITEM_HEALTH_RANGE or lotag in ITEM_POWERUP_RANGE or lotag in ITEM_ARMOR_RANGE:
        return "item"
    if lotag in KEY_RANGE:
        return "key"
    if lotag in (300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319):
        return "missile"
    if lotag >= 700:
        return "generator"
    if lotag == 0:
        return "generic"
    return "unknown"


def sector_area(sector: dict, walls: list[dict]) -> float:
    """Compute area of a sector using the shoelace formula on its walls."""
    wp = sector["wallptr"]
    wn = sector["wallnum"]
    if wn < 3:
        return 0.0
    area = 0.0
    for i in range(wn):
        wi = walls[wp + i]
        wj = walls[wp + ((i + 1) % wn)]
        area += wi["x"] * wj["y"]
        area -= wj["x"] * wi["y"]
    return abs(area) / 2.0


def analyze_map(name: str, data: bytes) -> dict:
    """Parse and analyze a single .MAP file. Returns stats dict."""
    result = parse_map(data)
    sectors = result["sectors"]
    walls = result["walls"]
    sprites = result["sprites"]

    stats = {
        "name": name,
        "version": result["version"],
        "numSectors": len(sectors),
        "numWalls": len(walls),
        "numSprites": len(sprites),
        "numXSectors": len(result["xsectors"]),
        "numXWalls": len(result["xwalls"]),
        "numXSprites": len(result["xsprites"]),
        "visibility": result["visibility"],
        "mapRev": result["mapRev"],
    }

    # Sector areas
    areas = [sector_area(s, walls) for s in sectors]
    stats["sectorAreas"] = {
        "min": min(areas) if areas else 0,
        "max": max(areas) if areas else 0,
        "mean": sum(areas) / len(areas) if areas else 0,
        "histogram": _bin_histogram(areas, [0, 1e5, 5e5, 2e6, 1e7, 5e7, float("inf")],
                                    ["tiny(<1e5)", "small(1e5-5e5)", "medium(5e5-2e6)",
                                     "large(2e6-1e7)", "xlarge(1e7-5e7)", "huge(>5e7)"]),
    }

    # Wall counts per sector
    wall_counts = [s["wallnum"] for s in sectors]
    stats["wallCounts"] = {
        "min": min(wall_counts) if wall_counts else 0,
        "max": max(wall_counts) if wall_counts else 0,
        "mean": sum(wall_counts) / len(wall_counts) if wall_counts else 0,
        "histogram": _bin_histogram(wall_counts, [0, 4, 8, 16, 32, 64, float("inf")],
                                    ["triangle(3)", "rect(4)", "oct(5-8)", "med(9-16)",
                                     "high(17-32)", "very_high(33-64)", "extreme(>64)"]),
    }

    # Floor/ceiling heights
    ceil_heights = [s["ceilingz"] for s in sectors]
    floor_heights = [s["floorz"] for s in sectors]
    height_deltas = [s["floorz"] - s["ceilingz"] for s in sectors]
    stats["ceilingHeights"] = _describe(ceil_heights)
    stats["floorHeights"] = _describe(floor_heights)
    stats["heightDeltas"] = _describe(height_deltas)

    # Shade distributions
    ceil_shades = [s["ceilingshade"] for s in sectors]
    floor_shades = [s["floorshade"] for s in sectors]
    stats["ceilingShades"] = _describe(ceil_shades)
    stats["floorShades"] = _describe(floor_shades)

    # Visibility
    visibilities = [s["visibility"] for s in sectors]
    stats["sectorVisibility"] = _describe(visibilities)

    # Sector lotag distribution
    lotag_counts = Counter(s["lotag"] for s in sectors)
    stats["sectorLotags"] = {str(k): v for k, v in sorted(lotag_counts.items())}

    # Texture picnum distributions
    floor_pics = Counter(s["floorpicnum"] for s in sectors)
    ceil_pics = Counter(s["ceilingpicnum"] for s in sectors)
    wall_pics = Counter(w["picnum"] for w in walls)
    stats["floorPicnums"] = dict(sorted(floor_pics.items(), key=lambda x: -x[1]))
    stats["ceilingPicnums"] = dict(sorted(ceil_pics.items(), key=lambda x: -x[1]))
    stats["wallPicnums"] = dict(sorted(wall_pics.items(), key=lambda x: -x[1]))

    # Texture co-occurrence: for each sector, record floor_pic → set of wall_pics
    floor_wall_cooccur = defaultdict(Counter)
    ceil_wall_cooccur = defaultdict(Counter)
    floor_ceil_cooccur = defaultdict(Counter)
    for s in sectors:
        wp, wn = s["wallptr"], s["wallnum"]
        sector_wall_pics = set()
        for wi in range(wn):
            w = walls[wp + wi]
            sector_wall_pics.add(w["picnum"])
        fp = s["floorpicnum"]
        cp = s["ceilingpicnum"]
        for wpic in sector_wall_pics:
            floor_wall_cooccur[fp][wpic] += 1
            ceil_wall_cooccur[cp][wpic] += 1
        floor_ceil_cooccur[fp][cp] += 1

    stats["floorWallCooccurrence"] = {str(k): dict(v.most_common(10)) for k, v in sorted(floor_wall_cooccur.items())}
    stats["ceilWallCooccurrence"] = {str(k): dict(v.most_common(10)) for k, v in sorted(ceil_wall_cooccur.items())}
    stats["floorCeilCooccurrence"] = {str(k): dict(v.most_common(10)) for k, v in sorted(floor_ceil_cooccur.items())}

    # Sprite analysis
    sprite_type_counts = Counter()
    sprite_by_category = defaultdict(list)
    sprite_picnum_counts = Counter()
    dude_counts = Counter()
    item_counts = Counter()

    for sp in sprites:
        lotag = sp["lotag"]
        category = classify_sprite(lotag)
        type_name = SPRITE_TYPES.get(lotag, f"unknown_{lotag}")
        sprite_type_counts[type_name] += 1
        sprite_by_category[category].append(sp)
        sprite_picnum_counts[sp["picnum"]] += 1
        if category == "dude":
            dude_counts[type_name] += 1
        elif category in ("item", "ammo", "weapon", "key"):
            item_counts[type_name] += 1

    stats["spriteTypes"] = dict(sprite_type_counts.most_common())
    stats["spriteCategories"] = {cat: len(spr) for cat, spr in sprite_by_category.items()}
    stats["dudeCounts"] = dict(dude_counts.most_common())
    stats["itemCounts"] = dict(item_counts.most_common())
    stats["spritePicnums"] = dict(sorted(sprite_picnum_counts.items(), key=lambda x: -x[1])[:50])

    # Sprite placement: sector-area bins for dudes and items
    dude_sector_areas = []
    for sp in sprite_by_category.get("dude", []):
        sec_idx = sp["sectnum"]
        if 0 <= sec_idx < len(sectors):
            a = areas[sec_idx]
            dude_sector_areas.append(a)
    stats["dudeSectorAreaDistribution"] = _bin_histogram(
        dude_sector_areas, [0, 1e5, 5e5, 2e6, 1e7, float("inf")],
        ["tiny", "small", "medium", "large", "xlarge", "huge"])

    # Enemy density (dudes per sector area in build-units²)
    total_dude_area = sum(1.0 for _ in dude_sector_areas)
    total_map_area = sum(areas) if areas else 1
    stats["dudeDensity"] = len(dude_sector_areas) / (total_map_area / 1e6) if total_map_area > 0 else 0

    # Connectivity: count red-line (portal) walls per sector
    portal_walls_per_sector = Counter()
    adj = defaultdict(set)
    for si, s in enumerate(sectors):
        wp, wn = s["wallptr"], s["wallnum"]
        portals = 0
        for wi in range(wn):
            w = walls[wp + wi]
            if w["nextwall"] >= 0 and w["nextsector"] >= 0:
                portals += 1
                adj[si].add(w["nextsector"])
                adj[w["nextsector"]].add(si)
        portal_walls_per_sector[portals] += 1
    stats["portalWallsPerSector"] = dict(sorted(portal_walls_per_sector.items()))

    # Connectivity: BFS from player start sector
    player_sect = result["pos"]["cursectnum"]
    visited = set()
    queue = [player_sect]
    while queue:
        node = queue.pop(0)
        if node in visited:
            continue
        visited.add(node)
        for neighbor in adj.get(node, []):
            if neighbor not in visited:
                queue.append(neighbor)
    stats["connectedFromPlayer"] = len(visited)
    stats["totalSectors"] = len(sectors)
    stats["connectivityRatio"] = len(visited) / len(sectors) if sectors else 0

    # Count disconnected components
    all_visited = set()
    components = []
    for start in range(len(sectors)):
        if start in all_visited:
            continue
        comp = set()
        queue = [start]
        while queue:
            node = queue.pop(0)
            if node in comp:
                continue
            comp.add(node)
            all_visited.add(node)
            for n in adj.get(node, set()):
                if n not in comp:
                    queue.append(n)
        components.append(comp)
    stats["numComponents"] = len(components)
    stats["largestComponentSize"] = max(len(c) for c in components) if components else 0
    stats["isolatedSectors"] = sum(1 for i in range(len(sectors)) if not adj.get(i))

    # Average neighbors
    neighbor_counts = [len(adj.get(i, set())) for i in range(len(sectors))]
    stats["avgNeighborCount"] = sum(neighbor_counts) / len(neighbor_counts) if neighbor_counts else 0

    # Texture family clustering: group sectors by (floorpic, ceilpic) and extract wall pic sets
    family_counter = Counter()
    family_examples = {}
    for si, s in enumerate(sectors):
        fp = s["floorpicnum"]
        cp = s["ceilingpicnum"]
        key = (fp, cp)
        family_counter[key] += 1
        if key not in family_examples:
            family_examples[key] = {"sectors": [], "wallPics": Counter(), "areas": []}
        if len(family_examples[key]["sectors"]) < 5:
            family_examples[key]["sectors"].append(si)
        a = areas[si]
        family_examples[key]["areas"].append(a)
        wp, wn = s["wallptr"], s["wallnum"]
        for wi in range(wn):
            family_examples[key]["wallPics"][walls[wp + wi]["picnum"]] += 1

    stats["textureFamilies"] = {}
    for (fp, cp), count in family_counter.most_common(30):
        ex = family_examples[(fp, cp)]
        top_walls = ex["wallPics"].most_common(8)
        stats["textureFamilies"][f"floor={fp}_ceil={cp}"] = {
            "count": count,
            "topWallPics": dict(top_walls),
            "avgArea": sum(ex["areas"]) / len(ex["areas"]) if ex["areas"] else 0,
        }

    return stats


def _describe(values: list) -> dict:
    if not values:
        return {"min": 0, "max": 0, "mean": 0, "median": 0, "std": 0}
    n = len(values)
    mean = sum(values) / n
    sorted_v = sorted(values)
    median = sorted_v[n // 2]
    variance = sum((v - mean) ** 2 for v in values) / n if n > 0 else 0
    return {
        "min": sorted_v[0],
        "max": sorted_v[-1],
        "mean": round(mean, 2),
        "median": median,
        "std": round(math.sqrt(variance), 2),
    }


def _bin_histogram(values: list, bins: list, labels: list) -> dict:
    """Bin values into histogram buckets."""
    counts = [0] * (len(bins) - 1)
    for v in values:
        for i in range(len(bins) - 1):
            if bins[i] <= v < bins[i + 1]:
                counts[i] += 1
                break
    return dict(zip(labels, counts))


def main():
    ap = argparse.ArgumentParser(description="Analyze Blood .MAP files for procgen patterns")
    ap.add_argument("--blood-dir", default="/Users/donny/Documents/Raze/blood",
                    help="Blood data directory (contains .MAP files)")
    ap.add_argument("--out", default="public/assets/map-research",
                    help="Output directory for patterns.json")
    args = ap.parse_args()

    blood_dir = Path(args.blood_dir)
    out_dir = Path(args.out)

    maps = sorted(blood_dir.glob("*.MAP"))
    if not maps:
        print(f"No .MAP files found in {blood_dir}")
        sys.exit(1)

    print(f"Analyzing {len(maps)} maps from {blood_dir}")

    all_stats = {}
    campaign_totals = {
        "totalSectors": 0,
        "totalWalls": 0,
        "totalSprites": 0,
        "maps": [],
    }

    # Cross-map texture co-occurrence accumulator
    global_floor_wall = defaultdict(Counter)
    global_ceil_wall = defaultdict(Counter)
    global_dude_counts = Counter()
    global_item_counts = Counter()
    global_sector_lotags = Counter()
    global_floor_pics = Counter()
    global_ceil_pics = Counter()
    global_wall_pics = Counter()
    global_areas = []
    global_wall_counts = []
    global_height_deltas = []
    global_portal_counts = []
    global_dude_sector_areas = []

    for map_path in maps:
        name = map_path.stem
        print(f"  {name}...", end="", flush=True)
        try:
            data = map_path.read_bytes()
            stats = analyze_map(name, data)
            all_stats[name] = stats
            campaign_totals["totalSectors"] += stats["numSectors"]
            campaign_totals["totalWalls"] += stats["numWalls"]
            campaign_totals["totalSprites"] += stats["numSprites"]
            campaign_totals["maps"].append({
                "name": name,
                "sectors": stats["numSectors"],
                "walls": stats["numWalls"],
                "sprites": stats["numSprites"],
            })

            # Accumulate for global analysis
            for fp, wdict in stats.get("floorWallCooccurrence", {}).items():
                for wp, cnt in wdict.items():
                    global_floor_wall[int(fp)][int(wp)] += cnt
            for cp, wdict in stats.get("ceilWallCooccurrence", {}).items():
                for wp, cnt in wdict.items():
                    global_ceil_wall[int(cp)][int(wp)] += cnt

            for d, c in stats.get("dudeCounts", {}).items():
                global_dude_counts[d] += c
            for i, c in stats.get("itemCounts", {}).items():
                global_item_counts[i] += c
            for lt, c in stats.get("sectorLotags", {}).items():
                global_sector_lotags[int(lt)] += c

            # Re-parse for raw accumulations
            result = parse_map(data)
            sectors = result["sectors"]
            walls = result["walls"]
            sprites = result["sprites"]
            areas = [sector_area(s, walls) for s in sectors]
            global_areas.extend(areas)
            global_wall_counts.extend(s["wallnum"] for s in sectors)
            global_height_deltas.extend(s["floorz"] - s["ceilingz"] for s in sectors)

            # Portal counts
            for s in sectors:
                portals = 0
                wp, wn = s["wallptr"], s["wallnum"]
                for wi in range(wn):
                    w = walls[wp + wi]
                    if w["nextwall"] >= 0 and w["nextsector"] >= 0:
                        portals += 1
                global_portal_counts.append(portals)

            # Dude sector areas
            for sp in sprites:
                if classify_sprite(sp["lotag"]) == "dude":
                    si = sp["sectnum"]
                    if 0 <= si < len(areas):
                        global_dude_sector_areas.append(areas[si])

            print(f" {stats['numSectors']}s {stats['numWalls']}w {stats['numSprites']}sp ✓")
        except Exception as e:
            print(f" ERROR: {e}")
            import traceback
            traceback.print_exc()

    # Build global texture families (co-occurrence clustering)
    # Group floor picnums by their most co-occurring wall picnums
    picnum_to_family = {}
    family_id = 0
    visited_pics = set()
    families = {}

    # Use floor→wall co-occurrence to cluster
    all_floor_pics = set(global_floor_wall.keys())
    for fp in sorted(all_floor_pics):
        if fp in visited_pics:
            continue
        # BFS: find all picnums connected through co-occurrence
        cluster_floor = set()
        cluster_wall = set()
        queue = [("floor", fp)]
        while queue:
            kind, pic = queue.pop(0)
            if kind == "floor" and pic not in cluster_floor:
                cluster_floor.add(pic)
                visited_pics.add(pic)
                for wp, cnt in global_floor_wall.get(pic, {}).items():
                    if cnt >= 3 and wp not in cluster_wall:
                        cluster_wall.add(wp)
                        queue.append(("wall", wp))
            elif kind == "wall" and pic not in cluster_wall:
                cluster_wall.add(pic)
                # Look for other floor pics that share this wall
                for fp2, wdict in global_floor_wall.items():
                    if pic in wdict and wdict[pic] >= 3 and fp2 not in cluster_floor:
                        queue.append(("floor", fp2))

        if len(cluster_floor) >= 2 or len(cluster_wall) >= 3:
            family_id += 1
            families[f"family_{family_id}"] = {
                "floorPics": sorted(cluster_floor),
                "wallPics": sorted(cluster_wall),
                "floorPicCount": len(cluster_floor),
                "wallPicCount": len(cluster_wall),
            }
            for fp in cluster_floor:
                picnum_to_family[fp] = f"family_{family_id}"

    # Write results
    out_dir.mkdir(parents=True, exist_ok=True)
    output = {
        "campaignSummary": campaign_totals,
        "globalStats": {
            "sectorAreas": _describe(global_areas),
            "sectorAreaHistogram": _bin_histogram(
                global_areas, [0, 1e5, 5e5, 2e6, 1e7, 5e7, float("inf")],
                ["tiny(<1e5)", "small(1e5-5e5)", "medium(5e5-2e6)",
                 "large(2e6-1e7)", "xlarge(1e7-5e7)", "huge(>5e7)"]),
            "wallCounts": _describe(global_wall_counts),
            "heightDeltas": _describe(global_height_deltas),
            "portalCounts": _describe(global_portal_counts),
            "portalHistogram": _bin_histogram(
                global_portal_counts, [0, 1, 2, 4, 8, 16, float("inf")],
                ["isolated(0)", "deadend(1)", "corridor(2-3)", "hub(4-7)",
                 "nexus(8-15)", "mega(16+)"]),
            "sectorLotags": dict(global_sector_lotags.most_common()),
            "globalDudeCounts": dict(global_dude_counts.most_common()),
            "globalItemCounts": dict(global_item_counts.most_common()),
            "globalFloorWallCooccurrence": {
                str(k): dict(v.most_common(10))
                for k, v in sorted(global_floor_wall.items())
                if sum(v.values()) >= 5
            },
            "globalCeilWallCooccurrence": {
                str(k): dict(v.most_common(10))
                for k, v in sorted(global_ceil_wall.items())
                if sum(v.values()) >= 5
            },
            "textureFamilies": families,
            "dudeSectorAreaDistribution": _bin_histogram(
                global_dude_sector_areas, [0, 1e5, 5e5, 2e6, 1e7, float("inf")],
                ["tiny", "small", "medium", "large", "xlarge", "huge"]),
        },
        "perMap": all_stats,
    }

    # Raw statistics dump. The theme-shaped patterns.json that theme-preview.ts
    # loads is produced downstream by build_theme_patterns.py (raw + labels).
    out_path = out_dir / "patterns.raw.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nResults written to {out_path}")

    # Print summary
    print("\n" + "=" * 70)
    print("CAMPAIGN SUMMARY")
    print("=" * 70)
    print(f"Maps analyzed: {len(all_stats)}")
    print(f"Total sectors: {campaign_totals['totalSectors']}")
    print(f"Total walls:   {campaign_totals['totalWalls']}")
    print(f"Total sprites: {campaign_totals['totalSprites']}")
    print()
    print("GLOBAL SECTOR STATISTICS")
    print(f"  Area: min={output['globalStats']['sectorAreas']['min']:.0f} "
          f"mean={output['globalStats']['sectorAreas']['mean']:.0f} "
          f"max={output['globalStats']['sectorAreas']['max']:.0f}")
    print(f"  Area histogram: {output['globalStats']['sectorAreaHistogram']}")
    print(f"  Wall count: mean={output['globalStats']['wallCounts']['mean']:.1f}")
    print(f"  Height delta: mean={output['globalStats']['heightDeltas']['mean']:.0f}")
    print(f"  Portal counts: mean={output['globalStats']['portalCounts']['mean']:.1f}")
    print(f"  Portal histogram: {output['globalStats']['portalHistogram']}")
    print()
    print("SECTOR LOTAG DISTRIBUTION")
    for lt, cnt in global_sector_lotags.most_common(15):
        name = SECTOR_TYPES.get(int(lt), f"type_{lt}")
        print(f"  {name} ({lt}): {cnt}")
    print()
    print("ENEMY DISTRIBUTION (campaign totals)")
    for dude, cnt in global_dude_counts.most_common(20):
        print(f"  {dude}: {cnt}")
    print()
    print("ITEM DISTRIBUTION (campaign totals)")
    for item, cnt in global_item_counts.most_common(20):
        print(f"  {item}: {cnt}")
    print()
    print(f"TEXTURE FAMILIES: {len(families)}")
    for fam_name, fam in families.items():
        print(f"  {fam_name}: {fam['floorPicCount']} floor pics, {fam['wallPicCount']} wall pics")


if __name__ == "__main__":
    main()
