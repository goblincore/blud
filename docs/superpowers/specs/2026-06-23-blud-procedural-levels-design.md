# Blud — Procedural Levels (Slice 1: Generated Arena) — Design

**Date:** 2026-06-23
**Status:** design approved (architecture + scope), pre-implementation
**Supersedes (in part):** §6 of [2026-04-20-blud-design.md](2026-04-20-blud-design.md) — the original "author ~20 chunks in Blender, stitch by graph generator" plan is replaced by **fully procedural geometry** generated as deterministic data. Blender/glTF is no longer the level-authoring path.

---

## 1. Context

The deterministic-core milestone landed (player, dynamite, kickable head, shotgun cultist — all on `SimState`, playtest-confirmed, 569 tests). World collision geometry already lives in the sim as `SimAABB[]` — full-height, axis-aligned XZ boxes in fixed-point units ([src/sim/geometry.ts](../../../src/sim/geometry.ts)). Every gameplay system consumes that array:

- player clip — `clipMoveXZ`
- cultist line-of-sight — `losClear` / `segmentHitsAABB`
- pellet-vs-wall ordering — `segmentEnterT`
- dynamite / head bounce — same AABB set

Today that array comes from `buildArenaGeometry()`, a **hand-maintained duplicate** of the cosmetic geometry in [src/game/arena.ts](../../../src/game/arena.ts), kept in sync across the determinism firewall by hand (see the "SYNC WARNING" comment). One hardcoded 40×40 m arena, 4 walls, 3 obstacles.

**The user has confirmed the arena loop feels fun** — effectively passing the Phase-1 feel gate — and wants to move to level structure. The chosen direction is **fully procedural geometry**: the map is generated from a seed, not authored. Hand-authored room *templates* are desirable later but explicitly deferred; v1 *synthesizes* room shapes.

Because a seeded generator is a pure function `seed → map`, it is a natural fit for the deterministic sim (same seed → identical geometry on every client → free for future P2P lockstep). And because Blud is 2.5D (flat floors/ceilings, orthogonal walls, full-height columns), generation reduces to **producing a 2D floorplan and extruding walls up** — a tractable, well-trodden problem that drops straight into the existing AABB collision model.

## 2. Goal of this slice

Replace the single hardcoded arena with **one seeded, fully generated, single-floor multi-room map** that all existing systems run on unchanged. Prove the pipeline `seed → floorplan → sim geometry + cosmetic geometry + spawns` end-to-end and keep the game immediately playable.

**This is a de-risking vertical slice, not all of M6.** Run structure, themes, templates, verticality, and the remaining bestiary are deferred (see §8).

### Success criterion

Reroll the seed a dozen times in the running game. Every seed yields a **distinct, fully-connected, walkable** map with **at least one large open arena room**, in which the cultist hunts the player through the generated walls, projectiles/gibs collide correctly, and nothing falls out of world. Determinism harness confirms same seed → identical map fingerprint.

## 3. Architecture — one generator output, two consumers

```
seed ──▶ generateFloorplan(seed)  ──▶  Floorplan   (abstract: rooms[] + links[] + spawns[] + start, integer grid — plain data, firewall-safe)
                                          │
            ┌─────────────────────────────┼──────────────────────────────┐
            ▼ (src/sim)                    ▼ (src/game)                    ▼ (src/sim, derived)
   bakeSimGeometry(floorplan)      bakeCosmetic(floorplan)         floorplan.spawns
        → SimAABB[]                  → Three meshes (floor/walls)       → enemy spawn placement
        → fed to SimRunner.geo       → Rapier static colliders            (existing wave/T-key spawner)
        → drives clip/LOS/projectiles→ decal receiver surfaces
                                     → player start transform
```

**The `Floorplan` is the single source of truth and the pluggable seam.** Both the sim bake and the cosmetic bake derive from it, so the current hand-synced duplication (`buildArenaGeometry` vs `arena.ts`) is eliminated — change the floorplan, both consumers follow.

**Pluggability (the "templates later" seam):** `generateFloorplan` is one *producer* of a `Floorplan`. v1 synthesizes it. A future authored-template library will produce the *same* `Floorplan` shape and slot in behind the identical bake/spawn consumers with no downstream change. "Templates later" = swap the producer, not a rewrite.

**Firewall discipline:**
- `Floorplan` type + `generateFloorplan` + `bakeSimGeometry` are **pure, deterministic, plain-data** — they live in `src/sim` and import no Three/Rapier (enforced by the existing firewall test).
- `bakeCosmetic` lives in `src/game`, imports the firewall-safe `Floorplan`, and produces all Three/Rapier objects.

## 4. Data model (`Floorplan`)

Plain serializable data, integer grid coordinates (cells), no engine types. Illustrative shape (final field names settled during implementation):

```ts
interface Floorplan {
  seed: number;
  gridW: number; gridH: number;     // grid dimensions in cells
  cellMeters: number;               // cell size → world scale
  rooms: Room[];                    // axis-aligned rectangles in cell space
  links: Link[];                    // doorway/corridor connections between rooms
  spawns: SpawnPoint[];             // enemy spawn cells (room-tagged)
  start: { cell: Cell; facing: number };  // player start cell + Blood-angle facing
  arenaRoomId: number;              // the guaranteed large "feature" room
}

interface Room { id: number; x: number; z: number; w: number; h: number; kind: 'arena' | 'room' | 'corridor'; }
interface Link { a: number; b: number; door: Cell; }   // door cell between rooms a,b
interface SpawnPoint { cell: Cell; roomId: number; }
type Cell = { cx: number; cz: number };
```

Geometry is derived from rooms+links by the bakers (walls = the cell boundaries not opened by a door). The floorplan stores *intent* (rooms/links/doors); the bakers compute *walls*.

## 5. Generation algorithm (v1 synthesis)

**Seeded room-and-corridor on an integer grid.** Chosen over BSP (reads cramped/mazey) and WFC (heavy tuning, can fail) because it yields **readable rectangular combat rooms** — and a rectangle is the easiest primitive to later replace with an authored template.

Uses the sim's existing seeded RNG (`src/sim/rng.ts`) so generation is deterministic and replay-safe.

1. **Bounds.** Grid sized to a larger footprint than the old 40×40 (target ~64×64 m, perf-capped per §9). `cellMeters` chosen so walls land on clean fixed-point values.
2. **Place the feature arena.** Reserve and place **one large room** (`kind: 'arena'`) first — the guaranteed marquee open combat space the user asked for. Size is a large fraction of the grid. This is the **`arena-with-closets` / `multi-arena`** archetype, the 2nd/3rd most common in Blood's campaign (§5.1).
3. **Place remaining rooms.** Attempt N rectangular rooms of varied size via seeded rejection sampling; reject overlaps (with a margin) against placed rooms. Mix of sizes.
4. **Connect into a reachable graph.** Build a connection graph over rooms; take a spanning tree (guarantees every room reachable from `start`), then add a few extra edges for **flanking loops** (avoids pure-tree dead-feel). Each edge becomes a `Link` with a door cell punched through the shared/adjacent wall, joined by a short corridor where rooms aren't adjacent.
5. **Pick start + spawns.** `start` = a cell in a room far from the arena (so the player advances *into* the big space). `spawns` = cells distributed across rooms, weighted toward the arena.
6. **Validate.** Assert full connectivity (flood-fill from `start` reaches every room and spawn) and that the start cell is clear. On a failed seed, deterministically perturb and retry up to a bounded count; if still failing, fall back to a trivial valid layout (never ship an unwalkable map).

### 5.1 Tuning source — R5/R5.1 Blood campaign analysis

The generator's numeric knobs are grounded in the existing reverse-engineering of all 39 Blood campaign maps ([docs/dev-notes/2026-04-21-blood-map-research.md](../../dev-notes/2026-04-21-blood-map-research.md), R5 + R5.1 vision pass), the same way enemy HP is grounded in `tuning-sources.md`. These are **structural** patterns — theme-agnostic, so they apply directly even though Blud's art is not Blood's. Starting values (feel-tune later):

| Knob | Value (from R5) | Rationale |
|------|-----------------|-----------|
| Layout archetype | `arena-with-closets` / `multi-arena` | 2nd/3rd most common; matches "one big arena + side rooms". (Most common is `hub-and-spokes` — a later template variant.) |
| Connectivity style | **looped, not tree** — `hubRatio ≈ 0.45`, `deadEndRatio ≈ 0.02` | 44.6% of Blood sectors are 4–7-portal hubs; dead-ends are rare. Justifies the "spanning tree + extra loop edges" step. |
| Arena connections | target ~5 (min 3, max 8) | Large arenas in Blood average ~5 portals. |
| Room size | log-normal, median ~14×14 m (~800K BU²), right-skewed | Most rooms small-medium; a few large. Drives the varied-size sampling. |
| Enemy density | ~0.33 dudes / M BU² → **~3–5 per medium room, 8–15 in the big arena**, 72% in large rooms | Spawn-count + spawn-placement weighting (spawns weighted toward the arena). |
| Doors/lifts | ~1 in 12 sectors (ZMotion lotag 600) | **Deferred** — slice 1 uses open doorways, not animated doors. Recorded for the run-structure spec. |

These map cleanly onto the `Floorplan` knobs; the implementation plan turns the relevant rows into named constants. Texture/theme data (the other half of R5/R5.1) feeds the deferred theming layer — see §8.

## 6. Baking

**`bakeSimGeometry(floorplan) → SimAABB[]` (src/sim):** emit a full-height XZ box for every wall segment — i.e. every cell boundary on a room/corridor perimeter that is *not* an opened door. Perimeter of the whole map included. Output is exactly the array shape `stepSim`/`clipMoveXZ`/`losClear` already consume. Merge colinear adjacent wall cells into single AABBs to keep the box count low (perf + fewer LOS iterations).

**`bakeCosmetic(floorplan) → { meshes, colliders, surfaces, start } ` (src/game):** from the same floorplan, build:
- Three floor mesh(es) over room/corridor cells; wall meshes matching the sim AABBs (so visuals == collision).
- Rapier static cuboid colliders for the walls (cosmetic-side physics: gib/flare/decal collisions) — these mirror the sim AABBs, derived not hand-typed.
- Decal receiver surfaces (replacing `arenaStaticSurfaces()` / `registerArenaSurfaces()`), derived from floor + wall faces.
- Player start transform from `floorplan.start`.

Wall/floor merging for meshes can be coarse in v1 (one box per merged AABB) — texturing/theming is deferred.

## 7. Determinism

- Geometry is a deterministic function of seed and is reconstructed identically on load — it does **not** need to live inside the hashed `SimState` (it is constant for a run). `SimRunner` builds the floorplan + sim geometry from its seed at construction.
- Add a **map fingerprint** to the determinism harness: hash the baked `SimAABB[]` (and/or the `Floorplan`) and assert it is identical across two fresh runs of the same seed, and that it stays stable while the sim steps (geometry never mutates mid-run).
- Generation consumes the seeded `SimRng`; no `Math.random`/`Date.now` (already firewall-forbidden).

## 8. Scope

### In this slice
- `Floorplan` type + `generateFloorplan(seed)` (room-and-corridor synthesis, guaranteed connectivity, guaranteed ≥1 large arena room).
- `bakeSimGeometry` → `SimAABB[]`; `SimRunner` uses it in place of `buildArenaGeometry()`.
- `bakeCosmetic` → meshes + Rapier colliders + decal surfaces + start; `arena.ts` `buildArena` rebuilt to consume it (kills the duplication).
- Spawn points wired to the existing wave/T-key spawner; player start from floorplan.
- Dev **reroll key** (regenerate from a new seed at runtime) + determinism-harness map fingerprint.

### Deferred (each its own later spec)
- **Authored room templates** — the pluggable producer behind the same `Floorplan` seam (the seam exists now; the library comes later).
- **Run structure** — hub → N rooms → boss, door/gate transitions between maps, difficulty curve, win/lose flow.
- **Theming / props / lighting / set-pieces** — the Weird West aesthetic layer; per-region mood; prop sockets. R5/R5.1 already produced a reusable **theme-template schema** (weighted floor↔wall co-occurrence families → theme tags) and the `theme-preview.ts` dev route; that spec authors **Blud-native** texture families into that same shape (Blood picnums are reference only — extracted Blood art never ships, per the project guardrail). Open prerequisite: **P6** (`scripts/build_theme_patterns.py` to regen the merged `patterns.json` the preview expects).
- **Verticality** — multi-floor, ramps, height variation (current geometry is full-height single-floor by construction).
- **Remaining bestiary + boss** — Scrollkin, Posting Priest, Deputy Dogg, Gooner Horse, The Algorithm.

## 9. Constraints & non-goals

- **Single floor, full-height walls.** Floor is a y-clamp; walls have no height variation. v1 maps are flat. (Matches 2.5D; verticality is a separate spec.)
- **Axis-aligned only.** `clipMoveXZ` treats the player as an AABB and assumes axis-aligned geometry. No diagonal/angled walls in v1.
- **Perf budget.** Keep merged wall-AABB count bounded (LOS and clip iterate the full array each tic). Cosmetic draw calls instanced/merged. Honor the design doc's enemy/gib caps unchanged.
- **No transport/networking work** here — determinism is preserved for the *future* lockstep, not implemented now.

## 10. Verification

- **Unit (sim, pure):** `generateFloorplan` — same seed → identical floorplan; connectivity flood-fill passes for a battery of seeds; ≥1 `arena` room always present; start cell clear. `bakeSimGeometry` — wall AABBs enclose every room, doors are gaps, no overlap leaks.
- **Determinism harness:** map fingerprint identical across two same-seed runs; stable across stepping; existing player/cultist/dynamite fingerprints still deterministic on a generated map.
- **Integration:** firewall test stays green (no Three/Rapier in `src/sim`); tsc + full vitest + vite build green.
- **Playtest (the real gate):** reroll a dozen seeds — each distinct, fully walkable, one big arena; cultist LOS/chase/fire works through generated walls; dynamite/pellets/gibs collide correctly; player spawns in a valid spot facing into the map; nothing escapes the world bounds.

## 11. Open items (resolve during planning, not blocking)

- Exact grid size / `cellMeters` (target ~64×64 m; pick clean fixed-point cell size).
- Wall-merge strategy detail (greedy colinear merge vs per-cell) — pick the simplest that keeps AABB count sane.
- Where the reroll key lives (debug HUD vs a hotkey like the existing G/T/R dev keys).
