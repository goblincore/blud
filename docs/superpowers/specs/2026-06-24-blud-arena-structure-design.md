# Blud — Arena Structure: Layouts, Arches & Ruined Walls — Design

**Date:** 2026-06-24
**Status:** design approved (direction), pre-implementation
**Builds on:** arena-first generator (`dd5b575`) + stormy-ruins atmosphere (`e246d89`).
**Theme:** outdoor ruins under a stormy sky — arches are ruined gateways, cover is rubble, the perimeter is crumbling ramparts you can see the dead tree-line over.

> **Split note.** "Height" divides into two iterations. **This (structure)** = *see/shoot over* low walls + everything visual/structural: layout motifs, spawn arches, ruined/varied wall heights, enemy-wall-collision, height-aware LOS. Player physics is **untouched** (all geometry still blocks your movement; only sightlines + visuals become height-aware). **Next (mixed-height physics)** = the delicate part: the player *standing/jumping onto* cover (vertical collision + determinism). Spec: [2026-06-24-blud-mixed-height-cover-design.md](2026-06-24-blud-mixed-height-cover-design.md), trimmed to just the player-vertical piece.

---

## 1. Context

The arena-first generator (one big open arena + scattered cover) restored the open feel; the stormy skybox + dead-tree backdrop made it read as outdoor ruins. Playtest asks driving this iteration:
- Enemies should **emerge from arched doorways**, not pop into the open.
- The arena should be **structurally more interesting** — concretely, a **nested-ring** ("Doom donut": inner arena + outer hallway) layout, and a perimeter that reads as **crumbling ruins** rather than a solid box.

Two enabling facts:
- World geometry is `SimAABB` (XZ footprint, full-height). Adding a per-box **`top`** + height-aware LOS lets low ramparts/cover be seen and shot over — the minimum needed for "ruins you can see out of." No player-physics change required for that.
- `moveDude` has **no collision** ([dude.ts:237](../../../src/sim/dude.ts)) — cultists currently walk through walls. Any structure (rings, arches, ramparts) needs them blocked, so this iteration folds in enemy-wall-collision.

## 2. Goals

1. **Layout motifs:** the generator picks (seeded) between **open-arena** (current) and **nested-ring** (inner arena + outer hallway with a gapped dividing wall) for run-to-run variety.
2. **Spawn arches:** ~3–4 recessed perimeter niches with arched mouths; enemies spawn inside and walk out via the existing chase AI (no emerge logic). Spawns relocate from random cells into niches.
3. **Ruined/varied walls:** perimeter (and the nested-ring inner wall) get **per-segment heights** — full ramparts, crumbled-low sections, gaps — so you see the sky/tree-line over the low bits.
4. **Height-aware LOS:** sightlines + shots pass *over* low walls/cover (blocked only if the line dips ≤ the wall's top). Cultists see/shoot over low cover; the player shoots over ramparts.
5. **Enemy-wall-collision:** cultists are blocked by all walls/cover (fixes ghost-through-walls; makes them path through arch mouths and ring gaps).
6. **Deterministic** throughout; harness stays green.

### Non-goals (deferred)
- **Player vertical collision** — standing/jumping onto cover or ramparts. That's the separate mixed-height iteration; here, low cover blocks your movement (you can't mount it yet) but you *can* see/shoot over it.
- Sunken/raised inner arena (floor-height changes / multi-floor).
- Enemy verticality, ledge loot, props/materials/lighting theming (its own later pass).

## 3. Height model (see/shoot-over only)

- `SimAABB` gains **`top: number`** (fp). Full walls use `WALL_TOP = fpFromMeters(1000)` (finite sentinel); ruined-low walls and low cover use real heights (~1.2–1.8 m).
- **Movement is unchanged:** `clipMoveXZ` still blocks on *any* box (player can't walk through, or mount, anything). No `feetY`/step logic this iteration.
- **LOS becomes height-aware:** `losClear` / pellet occlusion (`segmentEnterT`/`segmentHitsAABB`) block a segment **iff it stays ≤ `box.top` while crossing** — i.e. `min(yEnter, yExit) ≤ top`. Full walls (`WALL_TOP`) preserve today's behavior exactly; low walls/cover let lines pass over. Cultist LOS + pellets already thread eye-Y ([dude.ts:306](../../../src/sim/dude.ts), [:568](../../../src/sim/dude.ts)), so this "just works" once the tests respect `top`.

## 4. Generator (`floorplan.ts`)

Keep the occupancy grid; add a **parallel per-cell height code** (`0` = open floor; else a tier → fp top: low-cover, low-rampart, mid, full-wall). Bake merges runs of **equal height**.

### 4.1 Layout motif
A seeded choice at the top of `generateFloorplan`:
- **open-arena** — current behavior (big open interior + scattered cover).
- **nested-ring** — draw a solid **inner wall ring** (rectangle outline, 1–2 cells thick) inset ~3–4 cells from the perimeter, leaving an **outer hallway** band between it and the perimeter and an **inner arena** in the centre. Punch **2–4 gaps** in the inner ring so the player/enemies move between hallway and inner arena. Scatter cover in both the inner arena and the hallway.

### 4.2 Spawn arches
Perimeter thickens to a ~2–3 cell **wall band**; carve **~3–4 enclosed niches** (≈3 w × 2 deep) on different edges, each open to the playfield through a ~2-cell **arch mouth**. Enemy spawns relocate into the niches. In nested-ring, arches open into the **outer hallway** (enemies flow inward through the ring gaps) — naturally telegraphed. Arena interior stays **≥ 48 m**; grid grows to host the band.

### 4.3 Ruined/varied wall heights
Assign perimeter (and inner-ring) segments a **seeded height tier** — mostly full ramparts with a fraction crumbled **low** (~1.5 m, see/shoot over) and occasional full **gaps**. Cover islands likewise mix low (~1.2 m) and tall. Bias so the arena still feels enclosed but broken, not a sealed box.

### 4.4 Start / spawns / fingerprint
Player start: an open playfield cell (inner arena for nested-ring) facing center. Fingerprint folds in the height grid + motif + arch metadata.

## 5. Sim collision + LOS (`geometry.ts`, `dude.ts`, `thing.ts`)

- `geometry.ts`: `SimAABB.top`; height-aware `losClear`/`segmentHitsAABB`/`segmentEnterT`; `WALL_TOP`. `clipMoveXZ` unchanged.
- `dude.ts`: **`moveDude` gains `clipMoveXZ`** against `geo` → cultists blocked by walls/cover (path around, through arch mouths + ring gaps). LOS/pellet calls already pass Y; now respected.
- `thing.ts`: unchanged (things bounce off all geometry as today).
- `buildArenaGeometry` + existing AABB construction: set `top = WALL_TOP` (back-compat).

## 6. Cosmetic baker (`bake-cosmetic.ts`)

- Render each wall rect at its **real height** (`top` m, capped at the 4 m wall height for `WALL_TOP`). Ruined-low ramparts and low cover read short; full walls tall. Rapier colliders match.
- **Arch frames:** at each niche mouth, draw posts + a lintel/arched top from the arch metadata; dim recess material inside the niche.
- Nested-ring inner wall renders like the perimeter (with its own height variation).

## 7. Determinism

Geometry stays a pure function of the seed (now carrying `top`, motif, arches); fingerprint folds them in. `moveDude`'s clip is integer-fp/deterministic. Harness: a cultist **paths around a wall** (no longer ghosts through) and the existing player/dynamite fingerprints stay deterministic on height-tiered, motif-varied geometry; same seed → identical map fingerprint across two states + snapshot/resume.

## 8. Affected files

| File | Change |
|------|--------|
| `src/sim/geometry.ts` | `SimAABB.top` + `WALL_TOP`; height-aware `losClear`/`segmentHitsAABB`/`segmentEnterT`; `buildArenaGeometry` sets `top`. `clipMoveXZ` unchanged. |
| `src/sim/floorplan.ts` | per-cell height grid; layout motif (open + nested-ring); spawn-arch niches; ruined/varied wall heights; `MeterRect`/bake gain `top`; spawns into niches; fingerprint folds height+motif+arches. |
| `src/sim/dude.ts` | `moveDude` adds `clipMoveXZ` (enemy wall collision). |
| `src/game/level/bake-cosmetic.ts` | per-rect real heights + matching colliders; arch-frame meshes + recess; nested-ring inner wall. |
| `src/sim/*.test.ts` (geometry, floorplan, dude, determinism) | height-aware LOS, motif/arch/ruined-wall generation, enemy collision, fingerprint determinism. |

## 9. Verification

- **Unit (geometry):** height-aware `losClear` blocks under a box top, clears over it; `WALL_TOP` preserves today's results.
- **Unit (generator):** both motifs produced across seeds; nested-ring inner wall has ≥2 gaps reaching the inner arena (flood-fill); arches = enclosed niches with ≥2-cell mouths connecting to the playfield; all spawn cells inside niches + open; ruined walls present (some low, some full); arena ≥48 m; same seed → identical.
- **Unit (dude):** `moveDude` stops at a wall (no ghosting); cultist `losClear` true over a low rampart, false through a full wall.
- **Determinism harness:** path-around-wall + same-seed map fingerprint match across two states + snapshot/resume.
- **Integration:** firewall grep clean, tsc, full vitest, vite build.
- **Playtest (the gate):** nested-ring maps appear and play (flank around the hallway, push through gaps); enemies emerge from arches and path around walls (no ghosting); you can see/shoot over crumbled-low ramparts to the tree-line and over low cover; tall walls block; reroll a dozen — mix of motifs, arches, ruined heights, all walkable.

## 10. Open items (tune in planning/playtest)

- Motif mix (open vs nested-ring %), inner-ring inset/thickness/gap count.
- Ruined-low fraction + low-wall height (~1.5 m), low-cover height (~1.2 m).
- Arch count/mouth/niche/band dims; grid size to keep ≥48 m open.
- Whether ruined perimeter gaps (full holes) read well or feel exposed — start sparse.
