# Sector levels and the E1M1 experiment — Design

**Date:** 2026-10-24 · **Status:** approved in brainstorm (owner, 2026-10-24); spec review pending
**Format:** extends [Level Format v1](2026-09-23-level-format-design.md) · **Related:**
[Level mesh key](2026-09-24-level-mesh-key-design.md), [Night Train dynamic light](2026-09-26-night-train-dynamic-light-design.md)

## 1. Why

Playing the WIP levels, the owner found the representational ones (Night Train, the Wake's
graveyard) less interesting than the stripped-down test spaces (the ring, the arena). The arena's
overwhelming dark reads as alien; a train carriage reads as a theme-park set. The theory: levels
that do not represent a real building are more interesting. Doom's maps are like that: their
layouts are not how anyone would build a building.

**The experiment:** rebuild Doom's E1M1 layout in our engine, with our look (the arena's
repeating normal-mapped materials, not Doom's textures), our enemies, glowing hazard pools and
exploding barrels, then play it and judge whether it feels more alien than the train.

**The lasting gain:** sector geometry is the engine's multi-floor support, which every future
direction needs. The WAD is one source of sectors; our own levels can be authored as sectors too.

## 2. Decisions (owner, 2026-10-24)

- **Faithful** geometry: real sector shapes and heights (angled walls, stairs, raised floors,
  sunken pools, varied ceilings). Not a flattened footprint.
- **Source: the WAD**, not the Sketchfab E1M3 mesh (a triangle shell with no sectors, things or
  specials). `doomu.wad` (Ultimate Doom) is on the owner's machine. **Map: E1M1** (small, known,
  has barrels, nukage and height changes). Any map is a converter argument later.
- **Doors in, everything else out:** use-to-open ceiling doors. No lifts, secret walls, keys
  (E1M1 has none), or other switches. The exit switch is a `level.end` trigger.
- **Lighting: Doom's light levels, darkened** (§7), with a toggle to arena-dark.

## 3. Asset rule

Everything derived from the WAD is a **dev placeholder**, the same rule as the extracted Blood
assets: never committed, never shipped. The generated `public/assets/levels/doom-*.level.json`
is gitignored. Committed: the converter, the mapping tables (Doom ids → our names), and a
hand-made fixture. Doom texture names never appear in generated output; they are mapped to our
material names in the converter.

## 4. The sector format

Level JSON gains an optional `sectors` block. A level has **either** `rooms` **or** `sectors`,
never both; every existing level is unchanged.

```jsonc
{
  "version": 1, "id": "doom-e1m1", "geometry": "sectors",
  "vertices": [[x, z], ...],                          // metres
  "sectors": [{
    "floor": 0.0, "ceil": 3.0,                        // metres
    "light": 0.63,                                    // 0..1
    "special": "none",                                // none | hurt | flicker | pulse | strobe
    "hurtPerSec": 10,                                 // hurt sectors only
    "glow": "nukage",                                 // null | nukage | lava | acid (independent of special: a pool is usually glow + hurt)
    "materials": { "floor": "metal-plate", "ceil": "concrete", "wall": "tech" },
    "zone": 3                                         // §6.5
  }],
  "lines": [{
    "v": [0, 1], "front": 0, "back": 4,               // back null/absent = solid wall
    "door": { "sector": 4, "speed": 2.0, "wait": 4.0 },  // optional
    "exit": true                                      // optional: the exit switch
  }],
  "start": { "pos": [x, y, z], "yaw": 0 },
  "spawns": [...], "pickups": [...], "barrels": [{ "id": "b1", "pos": [x, y, z] }],
  "solids": [...], "lights": [...]
}
```

A two-sided line between sectors of different heights generates the step riser (lower floor →
higher floor) and the ceiling lip (higher ceiling → lower ceiling). Validation: every sector is
closed by its lines (each vertex used an even number of times per sector), no line references a
missing sector, heights satisfy `ceil > floor` except for door sectors (closed: `ceil == floor`).
Capability: a sector level `requires` a new `sectors` capability (not `multi-floor`, which
stays the refusal for room levels with raised floors: the Wake gate checks it), which joins
`ENGINE_CAPABILITIES` in plan 1.

## 5. The converter

`scripts/levels/doom_map.py <wad> E1M1 [--units-per-m 32] [--skill 4] [--out public/assets/levels]`

- Reads VERTEXES, LINEDEFS, SIDEDEFS, SECTORS, THINGS (vanilla Doom format; no BSP needed).
- **Scale:** 1 m = 32 units by default (Doom's 56-unit player ≈ our 1.75 m capsule). A 128-unit
  corridor is 4 m. Doom +y maps to our −z. A flag, in case it feels wrong in play.
- **Mapping tables** (committed, `scripts/levels/doom_tables.py`):
  - texture/flat families → our materials (e.g. `STARTAN*`/`TEK*` → `tech`, `FLOOR*` →
    `metal-plate`, `CEIL*` → `concrete`, `NUKAGE*` → glow `nukage`, `LAVA*` → `lava`,
    `SLIME*`/`FWATER*` → `acid`);
  - sector types → specials (1/2/3/8/12/13/17 → light effects; 5/7/16 → hurt);
  - linedef specials → `door` (1, 26–28, 31–34, 117, 118: door; locked variants treated as plain)
    and `exit` (11, 51, 52, 124);
  - thing types → kinds (§9), filtered by skill flag.
- **Door sectors**: plan 1 writes them OPEN (ceiling at Doom's open height: lowest neighbouring
  ceiling − 4 units) so the map is walkable before doors move; plan 2 writes them closed
  (`ceil = floor`) with the open height computed at load.
- **Zones** (§6.5) assigned here.
- Writes `<out>/doom-<map>.level.json` and prints a summary (sectors, lines, zones, things by kind).

## 6. Geometry, collision, navigation

### 6.1 The ground interface

Today the game assumes floor `y = 0` in about 18 modules: the player (`stepPlayer` snaps to 0),
encounter navigation (a flat grid), rig/IK feet, gibs, dynamite, burning, prop drops, blood.
One small pure interface replaces that assumption:

```ts
interface LevelGround {
  floorAt(x: number, z: number): number;   // the sector's floor; NaN outside every sector
  ceilAt(x: number, z: number): number;
  blockingNear(x: number, z: number, r: number, feetY: number): readonly WallSeg[];
}
// Doom has no sector over sector, so (x, z) picks one floor. Box solids stay in the
// collider list, as today.
```

Room levels implement it as today (floor 0, the box colliders), so behaviour stays identical;
the existing ring, Night Train and Wake gates prove it. Sector levels implement it with a uniform
grid over sector polygons (point-in-sector lookup) plus live door ceilings. Consumers migrate one
at a time: player → actors and navigation → the rest.

### 6.2 2.5D collision

Pure, unit-tested; the same rule goes into the Rust port.

- Walls are 2D segments pushed against a circle of the capsule radius (0.32 m).
- A two-sided line blocks only if the step up is over **0.75 m** (24 units) or the opening
  (min ceil − max floor) is under **1.9 m** (the Flat's doorway rule). Otherwise the player moves
  onto the new floor.
- Stepping up snaps the feet; the camera eases the eye height over ~0.1 s so stairs don't jerk.
- Stepping down is a fall under gravity (ledges and pits work).
- Box solids (barrels, decorations) keep the AABB push (`resolveCapsule`).

### 6.3 Navigation

The encounter grid planner gains heights: each cell stores its floor height. A move between cells
is allowed if the climb is ≤ 0.75 m and the headroom ≥ 1.9 m; drops are allowed. Actors get their
ground height as a root offset; feet and IK work relative to it instead of 0. **Riskiest part:**
plan 1 first proves the player on heights, then actors on E1M1's flat areas, then actors across
heights behind a unit test.

### 6.4 Meshes

Sectors are triangulated (ear clipping with holes) into floor and ceiling meshes; lines produce
wall quads (one-sided full height, two-sided risers and lips). UVs are world-space so the arena's
repeating normal-map materials tile evenly with no seams. Meshes join per zone and material and
go into the level group the way level art meshes do (`game-level-art.ts`), so level lighting,
probes and shadows apply unchanged. The door's ceiling mesh is separate so it can move.

### 6.5 Zones

Sectors are too small to act as lighting "rooms" (E1M1 has ~80). The converter groups them into
**zones**: connected components of sectors when doors are cut, with any zone over ~400 m² split
on its longest axis. Zones play the role of rooms for probes, near-light sets and level events.

## 7. Lighting

- Sector `light` → zone ambient through a hard curve: `ambient = floor + k · light^2.2`, capped
  low, so Doom's bright areas stay dim. Within a zone, per-sector values tint surfaces through a
  vertex attribute, so a dark alcove in a bright room stays dark.
- Light specials map onto `lamp-moods.ts` (flicker, pulse, strobe).
- `?doomlight=0` flattens every sector to arena-dark for A/B; default on.
- The flashlight starts on (E1M1 has no torch pickup).
- `k`, the floor and the cap are tuned in play with the owner, side by side.

## 8. Doors, hazards, barrels

**Doors.** Look at a door line within 1.5 m and press **E** (add a use key if the game has none).
The ceiling rises at `speed` (default 2 m/s) to its open height, waits `wait` (4 s), closes, and
reopens if anything is under it. A pure `door-state.ts` (closed → opening → open → closing) drives
`ceilAt`, the door mesh offset and nav headroom. Monsters don't open doors in v1. No sound yet.

**Hazard floors.** `glow` sectors draw their floor with a hand-written WGSL material: emissive,
slowly flowing noise (nukage green, lava orange, acid yellow-green), plus a soft halo on the
neighbouring wall quads. Each pool zone gets one cheap shadowless point light so bodies in it
pick up the colour. `hurt` sectors damage the player on a 1 s tick while their feet are on that
floor (`hurtPerSec`); `?god` ignores it.

**Exploding barrels.** A new `barrel` kind: a metal drum from a small Blender kit mesh, with the
same normal-map treatment as the level and its albedo calibrated to the torch (plain three.js
materials blow out to white otherwise). 20 HP; slugs, melee and blasts damage it. At 0 HP it
detonates through `explosion-aoe` (wounds, launches, gibs, camera kick) and the explosion VFX;
barrels in the blast catch after a random 0.1–0.3 s delay so chains ripple. Its collider goes with it.

## 9. Things

| Doom | Ours |
|---|---|
| Zombieman (3004) | a biomech zombie variant: `deadeye` (pistol gunner), `butcher` (axe) or `flayer` (saw-sickle), picked at random per spawn (§9.1) |
| Shotgun guy (9) | `soldier` |
| Imp (3001) | `zombie` (for now) |
| Barrel (2035) | `barrel` |
| Shotgun (2001), shells (2008, 2049), clip/bullets (2007, 2048) | `shotgun`, `shells` |
| Stimpack (2011), medikit (2012), armor (2018, 2019), bonus (2014, 2015) | `health` |
| Player 1 start (1) | `start` |
| Lamps, columns, other decorations | box `solids`; lamps also add a level light |

### 9.1 The zombieman's variants (owner, 2026-10-24)

The three biomech zombie conversions are registered characters (`character-registry.ts`:
`deadeye` with `gunner: { weapon: 'pistol' }`, `butcher` with its grafted axe, `flayer`) but
not yet level spawn kinds: `SpawnKind` is `zombie | soldier | cultist | juggernaut | warbull`.
Plan 5 adds `deadeye`, `butcher` and `flayer` to `SpawnKind` (and the spawn path that builds
them from the registry, as the arena's `?spawn=` already does).

The converter picks a variant per zombieman, deterministic from a hash of the spawn id, so the
same map always places the same bodies. `--zombieman mix|deadeye|butcher|flayer` (default `mix`,
equal weights) switches it; a single variant is there to compare how each one plays in the map.

Default skill flag: Ultra-Violence (busiest). `?skill=` picks another. Unknown types are skipped
and listed in the converter summary.

## 10. Build order (one plan each)

1. **Sectors, ground interface, 2.5D collision, converter.** Walk an empty E1M1, doors open,
   arena material everywhere. **First owner checkpoint: judge the space.**
2. **Doors.**
3. **Hazard floors.**
4. **Sector lighting.**
5. **Things:** enemies (with nav on heights), pickups, exit, barrels.

## 11. Testing

- Unit tests (vitest, `npm run test:changed`): sector lookup, triangulation, segment collision,
  step/headroom rules, door state, height-aware nav, the light curve, the converter's tables.
- Committed fixture `public/assets/levels/fixtures/sectors.level.json`: two rooms, a step, a pit,
  a door, a nukage pool, a barrel. Parse/validate tests and a Python converter test against a
  tiny hand-built WAD-format lump set, so CI never needs the real WAD.
- `scripts/sdf-game-doom-gate.sh` (local; skips if the generated level is absent): a waypoint walk
  through E1M1 (start steps, zigzag, nukage drop with damage, a door, a barrel chain) plus a
  frame-cost readout.
- Regression: ring, Night Train and Wake gates pass unchanged after the ground interface lands.

## 12. Done

The owner can play E1M1 start to exit in our look, with real heights, doors, glowing hurting
pools, darkened sector lighting, enemies and chaining barrels, and say whether it feels more alien
than the train. Plan 1 alone is the first checkpoint.

## 13. Out of scope

Lifts, switches other than the exit, secret walls, crushers, monsters opening doors, sound, keys,
Doom's textures and sprites, slopes (Doom has none), sector-over-sector (Doom has none).
