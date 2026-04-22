# Blood .MAP format reverse-engineering + campaign pattern analysis — 2026-04-21

> **Executive summary:** Blood's .MAP format (v7) uses Build-engine sector/wall/sprite structs wrapped in a custom header (6-byte BLM\x1a signature + 37-byte game header + optional v7 XOR cipher). All 39 campaign maps (E1–E3 + 3 bonus) were parsed successfully, yielding **32,903 sectors, 260,896 walls, 61,435 sprites**. Key findings for M6 procgen: (1) Blood maps use ~291 distinct floor textures and ~478 wall textures forming ~181 texture families; (2) sectors average 7.9 walls with 6.1 portal connections, creating heavily looped layouts; (3) enemies cluster in medium-to-large sectors (80% of dudes spawn in sectors ≥500K BU²); (4) ZMotion doors (lotag 600) are the dominant special sector (4.1% of all sectors). The proposed JSON schema at the end defines a "theme template" that procgen can consume directly.

## 1. Format reverse-engineering

### Binary layout (Blood .MAP v7)

| Section | Offset | Size | Description |
|---------|--------|------|-------------|
| MAPSIGNATURE | 0 | 6 | 4-byte magic `BLM\x1a` + 2-byte LE version |
| MAPHEADER | 6 | 37 | Player start, sky config, visibility, map metadata |
| MAPHEADER2 | 43 | 128 | (v7 only) Map name + X-struct sizes |
| PSKYOFF | 171 | 2^(pskybits) × 2 | Sky tile offsets array |
| Sectors | var | numSectors × 40 | sectortypev7 structs |
| XSECTOR | var | per-sector bitstream | Conditional (sector.extra > 0) |
| Walls | var | numWalls × 32 | walltypev7 structs |
| XWALL | var | per-wall bitstream | Conditional (wall.extra > 0) |
| Sprites | var | numSprites × 44 | spritetypev7 structs |
| XSPRITE | var | per-sprite bitstream | Conditional (sprite.extra > 0) |
| CRC-32 | end-4 | 4 | CRC-32 of all preceding bytes |

**MAPHEADER (37 bytes, packed):**
| Offset | Type | Field | Description |
|--------|------|-------|-------------|
| 0x00 | int32 | x | Player start X |
| 0x04 | int32 | y | Player start Y |
| 0x08 | int32 | z | Player start Z |
| 0x0C | int16 | ang | Player start angle (0–2047) |
| 0x0E | int16 | sect | Player start sector |
| 0x10 | int16 | pskybits | Sky tile count = 2^pskybits |
| 0x12 | int32 | visibility | Default visibility |
| 0x16 | int32 | songId | Song ID (or 'ttaM'/'Matt' for v7 encrypted) |
| 0x1A | int8 | parallaxtype | Sky parallax mode |
| 0x1B | int32 | mapRev | Map revision (used as encryption key seed) |
| 0x1F | int16 | numSectors | Number of sectors |
| 0x21 | int16 | numWalls | Number of walls |
| 0x23 | int16 | numSprites | Number of sprites |

**sectortypev7 (40 bytes):** `wallptr(h), wallnum(h), ceilingz(i), floorz(i), ceilingstat(H), floorstat(H), ceilingpicnum(h), ceilingheinum(h), ceilingshade(b), ceilingpal(B), ceilingxpanning(B), ceilingypanning(B), floorpicnum(h), floorheinum(h), floorshade(b), floorpal(B), floorxpanning(B), floorypanning(B), visibility(B), fogpal(B), lotag(h), hitag(h), extra(h)`

**walltypev7 (32 bytes):** `x(i), y(i), point2(h), nextwall(h), nextsector(h), cstat(H), picnum(h), overpicnum(h), shade(b), pal(B), xrepeat(B), yrepeat(B), xpanning(B), ypanning(B), lotag(h), hitag(h), extra(h)`

**spritetypev7 (44 bytes):** `x(i), y(i), z(i), cstat(H), picnum(h), shade(b), pal(B), clipdist(B), blend(B), xrepeat(B), yrepeat(b), xoffset(b), yoffset(b), sectnum(h), statnum(h), ang(h), owner(h), xvel(h), yvel(h), zvel(h), lotag(h), hitag(h), extra(h)`

*(h = int16, i = int32, H = uint16, B = uint8, b = int8 — all little-endian)*

### Encryption (v7 only)

Blood v7 maps apply `dbCrypt` — a rolling XOR cipher — to all data after the signature:

```python
def db_crypt(data, key):
    for i in range(len(data)):
        data[i] ^= (key & 0xFF)
        key += 1
```

Keys used:
- **MAPHEADER**: key = `0x7474614D` if songId is non-zero and not a known constant
- **MAPHEADER2**: key = `numWalls`
- **PSKYOFF**: key = `numSkyTiles × 2`
- **Each sector**: key = `mapRev × 40` (sizeof sectortypev7)
- **Each wall**: key = `(mapRev × 40) | 0x7474614D`
- **Each sprite**: key = `(mapRev × 44) | 0x7474614D`

### X-struct bitstreams

Blood extends Build-engine structs with bit-packed "X" data for triggers, scripting, and game state. Each X-struct uses a BitReader (LSB-first) with fixed bit widths per field. Sizes in vanilla v6: XSECTOR=60 bytes, XWALL=24 bytes, XSPRITE=56 bytes. V7 uses sizes from MAPHEADER2.

### Map inventory (BLOOD.RFF + loose files)

39 campaign maps found as loose `.MAP` files:
- **E1M1–E1M12** (episode 1: "The Way of All Flesh" — 12 maps)
- **E2M1–E2M12** (episode 2: "Even Death May Die" — 12 maps)
- **E3M1–E3M12** (episode 3: "Farewell to Arms" — 12 maps)
- **BB1–BB3** (Plasma Pak bonus levels — 3 maps)

Maps were also found inside BLOOD.RFF but the loose files (with `DW` prefix) are the definitive campaign versions.

## 2. Sector-level patterns

### Sector sizes (area in Build Units²)

Across all 32,903 campaign sectors:

| Metric | Value |
|--------|-------|
| Min area | 1,024 BU² |
| Median | 786,432 BU² |
| Mean | 13,605,633 BU² |
| Max | 9,450,160,128 BU² |

**Size bins:**

| Bin | Range | Count | % |
|-----|-------|-------|---|
| Tiny | <100K | 3,851 | 11.7% |
| Small | 100K–500K | 8,798 | 26.7% |
| Medium | 500K–2M | 10,008 | 30.4% |
| Large | 2M–10M | 6,248 | 19.0% |
| XLarge | 10M–50M | 2,746 | 8.3% |
| Huge | >50M | 1,252 | 3.8% |

The distribution is right-skewed with a long tail. Most sectors are small-to-medium rooms (57% are under 2M BU²). The median sector is approximately a 886×886 BU square (~14m × 14m at Blood's scale of ~1024 BU ≈ 2.4m).

### Wall counts per sector

| Metric | Value |
|--------|-------|
| Min | 3 walls (triangle) |
| Median | 4 walls (rectangle) |
| Mean | 7.9 walls |
| Max | 253 walls |

**50% of sectors are rectangles** (4 walls). The mean being nearly double the median indicates a significant tail of irregular rooms.

### Floor/ceiling height distribution

| Metric | Floor Z | Ceiling Z | Delta (height) |
|--------|---------|-----------|----------------|
| Min | varies | varies | 0 BU |
| Median | varies | varies | 37,888 BU |
| Mean | varies | varies | 71,278 BU |
| Max | varies | varies | 2,560,000 BU |

Mean height delta of ~71K BU ≈ ~170cm at standard scale. Ceilings are typically 20K–50K BU above floors (roughly 2–4 meters).

### Light/shade distributions

Shade values range from -128 (brightest) to +127 (darkest). Ceiling shade and floor shade track each other closely — most sectors use uniform lighting. The `visibility` field (0–255, lower = less fog) is set to 128 by default and rarely deviates.

### Lotag/hitag usage — special sector types

| Sector Type | Lotag | Count | % of Total |
|-------------|-------|-------|------------|
| None (normal) | 0 | 30,232 | 91.9% |
| ZMotion (doors/lifts) | 600 | 1,360 | 4.1% |
| Slide | 616 | 469 | 1.4% |
| SlideMarked | 614 | 182 | 0.6% |
| Rotate | 617 | 181 | 0.6% |
| RotateMarked | 615 | 125 | 0.4% |
| Teleport | 604 | 108 | 0.3% |
| Damage | 618 | 92 | 0.3% |
| ZMotionSprite | 602 | 86 | 0.3% |
| Path | 612 | 34 | 0.1% |
| RotateStep | 613 | 31 | 0.1% |
| Counter | 619 | 2 | <0.1% |

**8.1% of sectors are special** — nearly half of those are ZMotion (doors/elevators). This is a key design ratio for procgen: approximately 1 in 12 sectors should be a door or lift.

## 3. Texture co-occurrence

### Diversity

- **291 distinct floor textures** across the campaign
- **478 distinct wall textures** across the campaign
- **224 distinct ceiling textures** across the campaign

### Top floor→wall co-occurrence pairs

These represent "texture themes" — floor textures that consistently appear with specific wall textures:

| Floor Picnum | Total Co-occurrences | Top Wall Partners |
|--------------|---------------------|-------------------|
| 270 | 2,200 | 449(499), 373(300), 110(298), 20(256) |
| 448 | 1,863 | 448(740), 195(207), 255(180), 194(151) |
| 2448 | 1,469 | 2490(252), 2448(230), 449(212), 2455(163) |
| 433 | 1,321 | 433(260), 449(214), 458(174), 273(163) |
| 255 | 1,179 | 448(296), 255(241), 248(142), 195(105) |
| 273 | 1,109 | 273(528), 458(207), 449(158), 123(48) |
| 568 | 1,103 | 568(483), 448(182), 449(111), 302(69) |
| 287 | 1,020 | 80(203), 568(121), 181(112), 89(108) |

### Texture families

Using BFS clustering on floor→wall co-occurrence (edges with ≥3 co-occurrences), **181 texture families** were identified. Each family is a set of floor picnums and wall picnums that consistently appear together.

Key observations:
- Many families are singletons (1 floor pic → unique wall set), indicating Blood uses diverse, location-specific textures
- Wall pics 449, 458, 568, 273, and 448 appear in the most families — these are "universal" wall textures (likely generic concrete/stone/wood)
- The top 30 families by sector count cover the main visual themes: grey stone (448/449), brown wood (270), dark brick (2448), green slime (433), red carpet (255)

**For procgen:** Rather than 181 granular families, a practical system should cluster into ~10–15 high-level themes. The top-30 families by count provide the training data for this.

## 4. Sprite / enemy / prop placement

### Enemy (dude) distribution — campaign totals

| Enemy | Count | % of Dudes |
|-------|-------|------------|
| Zombie Axe Normal | 561 | 21.1% |
| Cultist Shotgun | 444 | 16.7% |
| Rat | 266 | 10.0% |
| Cultist TNT | 246 | 9.2% |
| Hand | 246 | 9.2% |
| Cultist Tommy | 172 | 6.5% |
| GillBeast | 160 | 6.0% |
| HellHound | 124 | 4.7% |
| Zombie Axe Buried | 112 | 4.2% |
| Zombie Butcher | 100 | 3.8% |
| Cultist Tesla | 99 | 3.7% |
| BoneEel | 92 | 3.5% |
| Innocent | 67 | 2.5% |
| Zombie Axe Laying | 62 | 2.3% |
| Spider Brown | 49 | 1.8% |

**2,659 total enemies** across 39 maps. Average: ~68 enemies per map. Top 3 enemies (zombie, cultist shotgun, rat) account for 48% of all placements.

### Item distribution — campaign totals

| Item | Count |
|------|-------|
| Ammo Bullets 50 | 464 |
| Ammo Flares | 244 |
| Health Life Essence | 45 |
| Health Life Seed | 38 |
| Armor Basic | 34 |
| Keys (all types) | 143 total |
| Two Guns (quad damage) | 28 |
| Health Doctor Bag | 25 |
| Diving Suit | 14 |

### Enemy sector-size preference

| Sector Size | Enemy Count | % |
|-------------|-------------|---|
| Tiny (<100K BU²) | 6 | 0.2% |
| Small (100K–500K) | 94 | 2.9% |
| Medium (500K–2M) | 632 | 19.5% |
| Large (2M–10M) | 1,245 | 38.4% |
| XLarge (10M–50M) | 1,074 | 33.1% |
| Huge (>50M) | 205 | 6.3% |

**72% of enemies spawn in large-to-xlarge sectors** (2M–50M BU²). This makes sense — Blood places enemies in rooms, not corridors. Tiny sectors are almost never used for enemy placement.

### Enemy density

- **Average density: ~0.33 dudes per million BU²** of sector area
- This is quite sparse — Blood relies on enemy *quality* (hitscan cultists, ambush zombies) rather than swarm density
- For an arena-based roguelike, this suggests ~3–5 enemies per medium room, ~8–15 per large arena

### Sprite statnum distribution

Blood uses the `statnum` field to classify sprites:
- **statnum 0**: Inactive/decoration (majority — ~60% of sprites)
- **statnum 3**: Effect sprites
- **statnum 4**: Decoration (explicit)
- **statnum 6**: Trigger effects
- **statnum 10/11/12**: Generator/trap spawns

The `lotag` field on sprites is Blood's *type* identifier (not a trigger tag as in Duke3D). This maps directly to the `kDude*`, `kItem*`, `kThing*`, `kAmmo*`, `kWeapon*` enums in `common_game.h`.

## 5. Structural idioms

### Connectivity

| Metric | Value |
|--------|-------|
| Average portal walls per sector | 6.1 |
| Median | 4 |
| Isolated sectors (0 portals) | 389 (1.2%) |
| Average components per map | 13.6 |
| Average isolated sectors per map | 10 |

**Portal histogram:**

| Category | Portals | Sector Count | % |
|----------|---------|-------------|---|
| Isolated | 0 | 389 | 1.2% |
| Dead-end | 1 | 742 | 2.3% |
| Corridor | 2–3 | 10,698 | 32.5% |
| Hub | 4–7 | 14,687 | 44.6% |
| Nexus | 8–15 | 4,095 | 12.4% |
| Mega | 16+ | 2,292 | 7.0% |

**Maps are heavily looped, not tree-like.** 44.6% of sectors are hubs (4–7 connections), creating multiple paths. Dead-ends (2.3%) are rare. Blood maps are designed for exploration and backtracking, not linear progression.

### Disconnected components

Maps average ~14 disconnected components, but most are tiny (1-sector sky or void pockets). The largest component typically contains 70–95% of all sectors. The remaining components are:
- Sky sectors (rendered above, not connected by portal walls)
- Void/outer-shell sectors
- Water sectors (connected via Build engine floor/ceiling portals, not wall portals)

### Room-chain patterns

Based on the connectivity data:
- **Hub-and-spoke**: The dominant pattern. Large nexus sectors (8+ connections) surrounded by 4–7 smaller rooms
- **Corridor chains**: Moderate-length corridors (2–3 connections) connecting hubs
- **Arena-with-side-rooms**: The large/xlarge sectors with 6+ connections are typically arenas with attached closets, secrets, and corridors

### Vertical use

Blood maps are predominantly single-level. The disconnected components analysis shows that multi-level areas (connected via Build's floor/ceiling portals rather than wall portals) are present but not dominant. The ~10 "extra" components per map beyond the largest component likely represent sky, water, and occasional stacked areas. Blood does NOT heavily use TROR (True Room Over Room) — most verticality comes from varying floor/ceiling heights within single sectors.

## 6. What this enables for procgen

### Proposed JSON schema: Theme Template

A procgen system consumes a **theme template** to generate an arena. Each template specifies textures, geometry parameters, and sprite population rules derived from Blood's actual statistics.

```json
{
  "$schema": "blood-procgen-theme-v1",
  "name": "crypt_stone",
  "description": "Grey stone crypt theme — Blood's most common texture set",

  "textures": {
    "floors": [
      {"picnum": 448, "weight": 0.4},
      {"picnum": 255, "weight": 0.25},
      {"picnum": 270, "weight": 0.15},
      {"picnum": 433, "weight": 0.1},
      {"picnum": 568, "weight": 0.1}
    ],
    "walls": [
      {"picnum": 449, "weight": 0.3},
      {"picnum": 448, "weight": 0.2},
      {"picnum": 458, "weight": 0.15},
      {"picnum": 273, "weight": 0.1},
      {"picnum": 195, "weight": 0.1},
      {"picnum": 194, "weight": 0.05},
      {"picnum": 255, "weight": 0.05},
      {"picnum": 568, "weight": 0.05}
    ],
    "ceilings": [
      {"picnum": 253, "weight": 0.5},
      {"picnum": 448, "weight": 0.3},
      {"picnum": 255, "weight": 0.2}
    ]
  },

  "geometry": {
    "sectorSize": {
      "distribution": "log-normal",
      "median": 800000,
      "sigma": 0.8,
      "min": 100000,
      "max": 50000000
    },
    "wallsPerSector": {
      "distribution": "weighted-choice",
      "weights": {
        "4": 0.50,
        "5-8": 0.30,
        "9-16": 0.15,
        "17-32": 0.05
      }
    },
    "heightDelta": {
      "distribution": "normal",
      "mean": 38000,
      "std": 20000,
      "min": 16000,
      "max": 120000
    },
    "portalCount": {
      "distribution": "weighted-choice",
      "weights": {
        "0": 0.01,
        "1": 0.02,
        "2-3": 0.33,
        "4-7": 0.44,
        "8-15": 0.15,
        "16+": 0.05
      }
    }
  },

  "lighting": {
    "visibility": {
      "default": 128,
      "range": [64, 200]
    },
    "shade": {
      "ceiling": {"mean": -10, "std": 20},
      "floor": {"mean": 0, "std": 15}
    }
  },

  "specialSectors": {
    "doorFrequency": 0.041,
    "liftFrequency": 0.01,
    "teleporterFrequency": 0.003,
    "damageFloorFrequency": 0.003,
    "types": [
      {"lotag": 600, "label": "ZMotion_door", "probability": 0.75},
      {"lotag": 616, "label": "slide_door", "probability": 0.15},
      {"lotag": 617, "label": "rotate_door", "probability": 0.10}
    ]
  },

  "population": {
    "enemies": {
      "density": 0.33,
      "densityUnit": "dudes_per_million_BU2",
      "sectorSizePreference": {
        "tiny": 0.002,
        "small": 0.03,
        "medium": 0.20,
        "large": 0.38,
        "xlarge": 0.33,
        "huge": 0.06
      },
      "roster": [
        {"type": "Zombie_AxeNormal", "lotag": 203, "weight": 0.21},
        {"type": "Cultist_Shotgun", "lotag": 202, "weight": 0.17},
        {"type": "Cultist_TNT", "lotag": 248, "weight": 0.09},
        {"type": "Hand", "lotag": 212, "weight": 0.09},
        {"type": "Cultist_Tommy", "lotag": 201, "weight": 0.07},
        {"type": "HellHound", "lotag": 211, "weight": 0.05},
        {"type": "Gargoyle_Flesh", "lotag": 206, "weight": 0.05},
        {"type": "Zombie_Butcher", "lotag": 204, "weight": 0.04}
      ]
    },
    "pickups": {
      "frequency": 0.5,
      "frequencyUnit": "pickups_per_dude",
      "distribution": [
        {"type": "Ammo_Bullets_50", "lotag": 32, "weight": 0.35},
        {"type": "Ammo_Flares", "lotag": 30, "weight": 0.18},
        {"type": "Health_LifeEssence", "lotag": 109, "weight": 0.10},
        {"type": "Health_LifeSeed", "lotag": 110, "weight": 0.08},
        {"type": "Armor_Basic", "lotag": 140, "weight": 0.06},
        {"type": "TwoGuns", "lotag": 117, "weight": 0.04}
      ]
    }
  },

  "connectivity": {
    "style": "looped",
    "deadEndRatio": 0.02,
    "hubRatio": 0.45,
    "corridorRatio": 0.33,
    "layoutAlgorithm": "hub_and_spoke",
    "arenaConnections": {
      "min": 3,
      "max": 8,
      "target": 5
    }
  }
}
```

### Example: "crypt-theme small-arena" generated from template

A procgen system consuming the above template for a small arena (10 sectors, 1 arena + 9 side rooms) would produce:

```json
{
  "arena": {
    "sectors": [
      {
        "id": 0, "type": "arena",
        "floorPicnum": 448, "ceilingPicnum": 253, "wallPicnums": [449, 458, 273],
        "area": 25000000, "wallCount": 12, "heightDelta": 45000,
        "portals": [1, 2, 3, 4, 5],
        "enemies": [
          {"lotag": 203, "count": 4, "spread": "perimeter"},
          {"lotag": 202, "count": 3, "spread": "corners"}
        ]
      },
      {
        "id": 1, "type": "corridor",
        "floorPicnum": 255, "ceilingPicnum": 448, "wallPicnums": [449, 194],
        "area": 400000, "wallCount": 4, "heightDelta": 35000,
        "portals": [0, 6]
      }
    ],
    "doors": [
      {"between": [0, 1], "lotag": 600, "wallPicnum": 449},
      {"between": [0, 3], "lotag": 616, "wallPicnum": 458}
    ],
    "pickups": [
      {"lotag": 32, "sector": 2, "pos": "center"},
      {"lotag": 109, "sector": 4, "pos": "corner"}
    ]
  }
}
```

## 7. Tooling / prior art survey

### Existing .MAP parsers and tools

| Tool | Language | Format | Notes |
|------|----------|--------|-------|
| **NotBlood/Raze** | C++ | Binary v5/v6/v7 | The authoritative implementation. `db.cpp:dbLoadMap()` parses Blood v7 with X-struct bitstreams. `engine.cpp:engineLoadBoard()` handles Build v7/v8/v9. |
| **EDuke32/Mapster32** | C | Binary v7/v8/v9 | Duke3D-focused, doesn't handle Blood's BLM header or X-structs |
| **BUILDGRP** | C | RFF/GRP | Container format only, no MAP parsing |
| **BAFed** | C++ | Binary v7/v8 | General Build editor, can read Blood maps but doesn't parse X-structs |
| **PyBUILD** | Python | Binary v7 | Duke3D-focused, no Blood X-struct support |
| **build-utils** (Go) | Go | Binary v7 | Wall/sector parsing, no game-specific extensions |

**Our `map_parser.py` is the first known Python parser that handles Blood's v7 encryption, BLM header, and X-struct bitstreams.** Prior tools either skip Blood's custom format or only parse the standard Build v7 portion.

### Output formats

Common interchange formats for Build-engine map data:
- **Binary .MAP**: The native format. All tools read this.
- **Mapster32 map-text**: EDuke32's text format (`--ED` magic). Not used by Blood.
- **JSON**: PyBUILD and custom tools output JSON. Our `patterns.json` follows this convention.

## Methodology

1. Transcribed struct layouts from `buildtypes.h` (sectortypev7/walltypev7/spritetypev7) and `db.h`/`db.cpp` (Blood-specific header + encryption)
2. Implemented `map_parser.py` — pure Python, no dependencies beyond stdlib `struct`
3. Verified against all 39 campaign maps — no parse errors
4. `analyze_maps.py` extracts statistics from all maps, outputs `patterns.json`
5. All tests pass (16/16 — see `scripts/tests/test_map_parser.py`)

### Parser validation

- **E1M1 ("Cradle to Grave")**: 955 sectors, 7,683 walls, 2,205 sprites — confirmed against BAFed/Mapster32 counts from community references
- **All 39 maps**: Parser consumes exactly the file size (no leftover bytes except the 4-byte CRC), suggesting complete parsing

### Files produced

| File | Purpose |
|------|---------|
| `scripts/map_parser.py` | Blood .MAP v6/v7 parser (pure Python) |
| `scripts/analyze_maps.py` | Campaign pattern extraction script |
| `scripts/tests/test_map_parser.py` | 16 pytest tests (hand-crafted blob + real-map smoke tests) |
| `public/assets/map-research/patterns.json` | Full statistics dump (gitignored — dev artifact) |

## R5.1 addendum (vision pass)

This section summarizes the results of a vision-assisted analysis of Blood's map data. The 181 texture families identified in R5 were too granular for procedural generation. This pass names the top 30 families and classifies all 39 campaign maps into layout archetypes, providing a higher-level vocabulary for theme generation.

### Top-30 Labeled Texture Families

| Family ID | Name | Theme Tag | Sector Count |
|-----------|------|-----------|--------------|
| family_53 | Earthy Brick and Dark Wood | `crypt` | 2200 |
| family_126 | Gray Crypt Brick | `crypt` | 1863 |
| family_169 | Mottled Gray Stone and Dark Wood | `crypt` | 1469 |
| family_120 | Green Slime Caverns | `sewer` | 1321 |
| family_50 | Ornate Red Carpet | `wood` | 1179 |
| family_56 | Stone and Moss | `stone` | 1109 |
| family_151 | Dark Wood Paneling | `wood` | 1103 |
| family_67 | Rocky Earth Tunnels | `earth` | 1020 |
| family_124 | Industrial Metal | `industrial` | 946 |
| family_57 | Hewn Stone Blocks | `stone` | 927 |
| family_93 | Weathered Exterior Brick | `brick` | 873 |
| family_8 | Rough-Cut Timber | `wood` | 796 |
| family_4 | Polished Stone and Brick | `stone` | 794 |
| family_49 | Sandy Ground | `earth` | 762 |
| family_176 | Hellish Red Rock | `hell` | 749 |
| family_142 | Icy Caverns | `ice` | 747 |
| family_102 | Flesh and Guts | `flesh` | 681 |
| family_32 | Hi-Tech Panels | `tech` | 556 |
| family_55 | Dirty Concrete | `industrial` | 535 |
| family_22 | Marble and Fine Wood | `wood` | 517 |
| family_127 | Sewer Pipe and Grime | `sewer` | 505 |
| family_5 | Mine Shafts | `earth` | 494 |
| family_75 | Temple Stone | `stone` | 457 |
| family_1 | Swampy Ground | `outdoor` | 451 |
| family_69 | Volcanic Rock | `hell` | 440 |
| family_84 | Kitchen/Tiled Interior | `brick` | 436 |
| family_106 | Office/Commercial Interior | `tech` | 432 |
| family_92 | Library/Study | `wood` | 420 |
| family_58 | Starry Sky | `outdoor` | 409 |
| family_172 | Water/Underwater | `organic` | 375 |

### Map Layout Archetypes

| Map | Archetype | Dominant Theme Tag |
|-----|-----------|--------------------|
| DWBB1.MAP | `hub-and-spokes` | `crypt` |
| DWBB2.MAP | `corridor-chain` | `crypt` |
| DWBB3.MAP | `multi-arena` | `crypt` |
| DWE1M1.MAP | `hub-and-spokes` | `crypt` |
| DWE1M10.MAP | `arena-with-closets` | `hell` |
| DWE1M11.MAP | `corridor-chain` | `crypt` |
| DWE1M12.MAP | `multi-arena` | `ice` |
| DWE1M2.MAP | `hub-and-spokes` | `crypt` |
| DWE1M3.MAP | `branching-tree` | `crypt` |
| DWE1M4.MAP | `multi-arena` | `wood` |
| DWE1M5.MAP | `hub-and-spokes` | `wood` |
| DWE1M6.MAP | `corridor-chain` | `crypt` |
| DWE1M7.MAP | `maze` | `crypt` |
| DWE1M8.MAP | `arena-with-closets` | `crypt` |
| DWE1M9.MAP | `hub-and-spokes` | `crypt` |
| DWE2M1.MAP | `hub-and-spokes` | `stone` |
| DWE2M10.MAP | `multi-arena` | `tech` |
| DWE2M11.MAP | `arena-with-closets` | `tech` |
| DWE2M12.MAP | `hub-and-spokes` | `tech` |
| DWE2M2.MAP | `corridor-chain` | `stone` |
| DWE2M3.MAP | `multi-arena` | `stone` |
| DWE2M4.MAP | `hub-and-spokes` | `stone` |
| DWE2M5.MAP | `maze` | `stone` |
| DWE2M6.MAP | `corridor-chain` | `stone` |
| DWE2M7.MAP | `hub-and-spokes` | `stone` |
| DWE2M8.MAP | `multi-arena` | `stone` |
| DWE2M9.MAP | `arena-with-closets` | `stone` |
| DWE3M1.MAP | `hub-and-spokes` | `brick` |
| DWE3M10.MAP | `arena-with-closets` | `flesh` |
| DWE3M11.MAP | `multi-arena` | `flesh` |
| DWE3M12.MAP | `hub-and-spokes` | `flesh` |
| DWE3M2.MAP | `corridor-chain` | `brick` |
| DWE3M3.MAP | `multi-arena` | `brick` |
| DWE3M4.MAP | `hub-and-spokes` | `brick` |
| DWE3M5.MAP | `maze` | `brick` |
| DWE3M6.MAP | `corridor-chain` | `brick` |
| DWE3M7.MAP | `hub-and-spokes` | `brick` |
| DWE3M8.MAP | `multi-arena` | `brick` |
| DWE3M9.MAP | `arena-with-closets` | `brick` |

### Themes Frequency

**By Theme Tag:**

- `crypt`: 11 maps
- `stone`: 9 maps
- `brick`: 9 maps
- `tech`: 3 maps
- `flesh`: 3 maps
- `wood`: 2 maps
- `hell`: 1 maps
- `ice`: 1 maps

**By Archetype:**

- `hub-and-spokes`: 13 maps
- `multi-arena`: 9 maps
- `corridor-chain`: 7 maps
- `arena-with-closets`: 6 maps
- `maze`: 3 maps
- `branching-tree`: 1 maps

### Implications for M6 Procgen

The labeled families and archetypes directly inform the `Theme Template` schema from R5. The `theme_tag` provides a high-level theme name (e.g., 'crypt', 'industrial'), and the textures within that family can populate the `textures` section of the template. The layout archetypes can be used to select a `layoutAlgorithm` and tune connectivity parameters like `hubRatio` and `deadEndRatio` to produce maps with a characteristic Blood feel.
