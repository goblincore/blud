# Blud — Arena Structure: Mixed-Height Cover + Spawn Arches — Design

**Date:** 2026-06-24
**Status:** design approved (direction + scope), pre-implementation
**Builds on:** [2026-06-23-blud-procedural-levels-design.md](2026-06-23-blud-procedural-levels-design.md) (arena-first generator). Follows the arena-first feel pivot (`dd5b575`).

> **⚠️ RE-SPLIT (2026-06-24):** this spec was reduced. Spawn arches, height-aware geometry/LOS, ruined walls, layout motifs, and enemy-wall-collision moved to the **structure** iteration → [2026-06-24-blud-arena-structure-design.md](2026-06-24-blud-arena-structure-design.md), which ships first. **This spec now covers ONLY the remaining delicate piece: the player *standing/jumping onto* cover** — `SimAABB.top` is assumed to already exist (added by the structure iteration); here we add `supportFloorY` + the player vertical step (land/step/fall on box tops) + cover tiers becoming *standable* + determinism coverage for jump-onto-cover. Sections below that describe arches / dude-collision / height-aware LOS are superseded by the structure spec; read this for §3.2–3.3 (supportFloorY + player vertical step) and the standable-cover determinism harness.

---

## 1. Context

The arena-first generator (big open arena + scattered cover islands) restored the open feel, but all cover is **full-height** — the sim models world geometry as full-height columns (`SimAABB` is an XZ footprint with no Y; `losClear` accepts eye heights but drops them; the player floor is hard-clamped to `y = 0`). Playtest ask: **mixed-height objects** — low cover you can **see and shoot over**, and **stand / jump on top of**.

This is a real change to the deterministic player core: the player is currently a 2D circle (`clipMoveXZ`) with a `y ≤ 0` floor clamp ([player.ts:55](../../../src/sim/player.ts)). Standable cover means giving the sim **vertical world collision** (box tops you can land on, step onto, and shoot over) — a Build/Doom-style heightfield, done in deterministic integer fp.

Two relevant facts found while scoping:
- **Cultist LOS and pellets already thread Y** ([dude.ts:306](../../../src/sim/dude.ts), [dude.ts:568](../../../src/sim/dude.ts)) — the geometry tests just discard it. Making them height-aware gives "enemies see/shoot over low cover" almost for free.
- **`moveDude` has NO collision** ([dude.ts:237](../../../src/sim/dude.ts)) — `d.x += d.vx; d.z += d.vz` with no `clipMoveXZ`. Cultists currently walk *through* walls and cover; the single open arena hid it. This work folds in dude wall collision.

## 2. Goals

1. Cover comes in **height tiers**: low (standable, see/shoot over) and tall (full walls), generated procedurally.
2. The **player** can walk into low cover and be blocked, auto-step tiny ledges, **jump onto** low cover and **stand** on it, walk off and fall, and **see/shoot over** low cover.
3. **Enemies** (cultists) are **floor-bound**: low cover blocks their *movement* (they path around — and this also fixes the walk-through-walls gap) but **not** their *sight/shots* (height-aware LOS lets them shoot over low cover).
4. **Spawn arches:** the generator places a few **recessed perimeter niches** with **arched mouths**; enemies spawn *inside* a niche and walk out through the arch into the arena (telegraphed origin), instead of appearing at random open cells. The arches also give the perimeter visual structure.
5. All of it stays **deterministic** (integer fp; same seed/inputs → same hash) and the determinism harness proves it.

### Non-goals (deferred)
- Enemy verticality (cultists mounting cover / vertical AI navigation).
- Pickups, loot, or objectives placed on cover tops (no reason-to-climb design yet).
- Multi-floor levels, ramps/slopes, stairs (only flat tops; auto-step handles small lips).
- Things (dynamite/heads/pellets-as-kThings) gaining height-awareness — they keep treating all cover as full-height obstacles for bounce (acceptable; refine later if it reads wrong).

## 3. The height model

Everything is solid **from the floor (y = 0) up to a per-box `top`**. There are no floating boxes; "low cover" is a short solid block, "wall" is a tall one.

- `SimAABB` gains **`top: number`** (fp, max Y above the floor). Full-height walls use a tall sentinel `WALL_TOP = fpFromMeters(1000)` (finite — never `Infinity`, to keep arithmetic/hashing safe). Low cover uses its real height (e.g. `fpFromMeters(1.2)`).
- **Floor is still y = 0 everywhere**; box tops are the only raised surfaces. The player's effective floor at any XZ is `max(0, tallest box-top under them that they can stand on)`.

### 3.1 Horizontal movement — step-aware `clipMoveXZ`

`clipMoveXZ(from, dx, dz, radius, boxes, feetY, stepUp)`:
- A box blocks horizontal movement **iff `box.top > feetY + stepUp`** (too tall to step onto from current feet). Boxes at/below `feetY + stepUp` do **not** block — you step up onto / are already above them.
- **Player:** `feetY = p.y`, `stepUp = STEP` (≈ 0.5 m auto-step).
- **Dudes / things:** `feetY = 0`, `stepUp = 0` → blocked by **every** box with `top > 0` (all cover + walls). This is what makes enemies path around cover (and fixes walk-through-walls).
- Otherwise identical axis-separated slide logic (deterministic, order-independent).

### 3.2 Vertical support — `supportFloorY`

New `supportFloorY(x, z, radius, boxes, feetY, stepUp) → number` (fp): the **highest `box.top` ≤ `feetY + stepUp`** among boxes whose XZ footprint the point overlaps (within `radius`), else `0`. This is the surface the player stands on.

### 3.3 Player vertical step (replaces the `y ≤ 0` clamp)

In `stepPlayer`, after the horizontal move:
1. `floorY = supportFloorY(p.x, p.z, RADIUS, geo, p.y, STEP)`.
2. **Step-up:** if `grounded` and `floorY > p.y` (stepped onto a ≤STEP-higher surface) → `p.y = floorY` (snap up).
3. Jump (edge-triggered) + gravity as today (`p.vy -= GRAVITY_DV; p.y += p.vy`).
4. **Land / fall:** replace `if (p.y <= 0)` with `if (p.y <= floorY) { p.y = floorY; p.vy = 0; p.grounded = true; }` else `grounded = false`. Walking off an edge drops `floorY` below `p.y` → the clamp no longer catches → the player falls.

Net behaviors: bonk into tall walls; auto-step tiny lips; run into low cover and be blocked unless airborne above its top; **jump onto** low cover and stand; walk off and fall; tall cover (> jump height) is an impassable wall.

### 3.4 Height-aware line tests (LOS + pellet occlusion)

`losClear` / the pellet occlusion test (`segmentEnterT`/`segmentHitsAABB`) gain Y-awareness: a box blocks the segment **iff the segment's height stays ≤ `box.top` somewhere within its XZ-crossing interval**. Since the segment's Y is linear in the slab parameter `t`, this is a check at the clamped entry/exit `t` — the box occludes iff `min(yEnter, yExit) ≤ box.top`.
- Full-height walls (`top = WALL_TOP`) → always occlude (today's behavior preserved exactly).
- Low cover → a sightline/shot between two ~1.2–1.8 m eye points passes *above* a 1.2 m box → not blocked. So cultists see and shoot over low cover; the player shoots over it too.

`clipMoveXZ`, `losClear`, `segmentEnterT`, `segmentHitsAABB`, and the new `supportFloorY` are the only geometry changes; their callers (player, dude, thing) pass the appropriate Y/step.

## 4. Generator — cover tiers (`floorplan.ts`)

Cover blocks get a **height tier**:
- **low** — `1.2 m`, standable + see/shoot over.
- **tall** — full wall (`WALL_TOP`), 4 m visually.
- (A **mid** ~2.2 m tier is optional; start with low/tall and add mid only if the mix feels thin.)

Implementation: keep the occupancy grid for placement (cover cells = solid, so spawns/start avoid them) and add a **parallel per-cell height code** (`0` = open, else a tier → fp top). The perimeter border ring is `tall`. Each scattered cover island is assigned a tier by a seeded roll (bias toward low so most cover is shoot-over-able). `bakeWallRectsMeters` merges runs of **equal height** and emits `{rect, top}`; `bakeSimGeometry` maps each to a `SimAABB` with `top`. The fingerprint folds in the height codes.

## 4.5 Spawn arches — perimeter gates (`floorplan.ts`)

Enemies should **emerge from framed doorways in the wall**, not appear at random open cells.

- The perimeter thickens from a 1-cell ring into a **wall band** (≈2–3 cells, i.e. 4–6 m — reads as thick stone arena walls) so there is room to recess niches into it. The open arena interior stays **≥ 48 m**; the grid grows to host the band.
- The generator carves **`N_ARCHES` (≈3–4) recessed niches** into the band on different edges. Each niche is a small **enclosed pocket** (≈3 wide × 2 deep cells) walled on its outer three sides, open to the arena through an **arch mouth** (≈2 cells wide) in the inner wall. Niche placement is seeded and spaced so two arches don't overlap.
- **Enemy spawn points relocate into the niches** (replacing the random arena-cell spawns). A spawned enemy stands in the niche facing the arena; the existing chase AI walks it out through the arch toward the player — **no special "emerge" logic needed**. (Wave spawning in `main.ts` already reads `sim.spawnPointsMeters()`, so this is a generator-side change; the wiring is unchanged.)
- The arch mouth is a real **gap in the wall geometry** (open cells), so enemies physically path through it and the player can shoot into/through it.
- **Player start** stays an open arena-edge cell facing center (not a niche).

This subsumes the "satellite alcoves" deferred from the procgen spec, repurposed as spawn theaters.

## 5. Cosmetic baker (`bake-cosmetic.ts`)

- **Heights:** render each wall rect at its **real height** (`top` in meters, capped for the `WALL_TOP` sentinel → the existing 4 m wall height) instead of a flat `WALL_HEIGHT`. Rapier colliders match. Low cover reads as short crates/walls; tall cover as full walls. (Sim collision is authoritative; cosmetic just mirrors the per-rect height.)
- **Arch frames:** at each niche mouth, draw a simple **arch frame** — two side posts + a lintel/arched top spanning the mouth — so the opening reads as a doorway rather than a bare gap. The frame is cosmetic only (the collidable gap is the open cells); it sits in the wall band above/around the mouth. Frame placement comes from the niche/arch metadata the generator records on the `Floorplan` (mouth position + width + edge orientation). A dim recess material on the niche interior sells the "enemies come from in there" read.

## 6. Determinism

- Geometry stays a pure function of the seed (now carrying `top`); reconstructed identically per client. Map fingerprint folds in heights.
- The new player vertical step and dude collision are integer-fp and deterministic. Extend the determinism harness: a recorded run that **jumps onto cover** (player y settles on a box top) and a cultist that **paths around cover** must hash-match across two states every tic, and survive snapshot/resume.
- `STEP`, `GRAVITY_DV`, `JUMP_VY`, tier heights are constants → no RNG in the vertical step.

## 7. Affected files

| File | Change |
|------|--------|
| `src/sim/geometry.ts` | `SimAABB.top`; step-aware `clipMoveXZ(...feetY, stepUp)`; height-aware `losClear`/`segmentHitsAABB`/`segmentEnterT`; new `supportFloorY`; `WALL_TOP`. |
| `src/sim/player.ts` | `stepPlayer`: step-aware clip + `supportFloorY` + land/step/fall replacing the `y ≤ 0` clamp; `STEP` constant. |
| `src/sim/dude.ts` | `moveDude`: add step-aware `clipMoveXZ` (feet 0 / step 0) → enemies blocked by all cover (+ fixes walk-through-walls). LOS/pellet calls unchanged (already pass Y; now respected). |
| `src/sim/thing.ts` | `clipMoveXZ` call passes `feetY = 0, stepUp = 0` (things bounce off all cover as today). |
| `src/sim/floorplan.ts` | cover height tiers + parallel height grid; `MeterRect`/bake gain `top`; thickened perimeter band + recessed spawn niches with arch mouths; `arches` metadata on `Floorplan`; spawns relocate into niches; fingerprint folds heights + arches. |
| `src/sim/geometry.ts` (`buildArenaGeometry`) + tests | set `top = WALL_TOP` on existing AABBs (back-compat). |
| `src/game/level/bake-cosmetic.ts` | render per-rect real height + matching colliders; arch-frame meshes at niche mouths; recess material. |
| `src/sim/determinism.test.ts` | jump-onto-cover + path-around-cover determinism coverage. |

## 8. Verification

- **Unit (geometry):** `clipMoveXZ` blocks when `top > feetY+stepUp`, passes otherwise; `supportFloorY` returns the right tier top / 0 off-cover; height-aware `losClear` blocks under a box top and clears over it; full-height (`WALL_TOP`) preserves today's results.
- **Unit (player):** jump onto a 1.2 m box → lands and stays at `y = 1.2`; walk off → falls to 0; auto-step a 0.4 m lip; blocked by a 3 m wall.
- **Unit (dude):** `moveDude` stops at a cover edge (no longer ghosts through); cultist `losClear` returns true over a 1.2 m box between two eye-height points, false through a tall wall.
- **Unit (arches):** generator emits `N_ARCHES` niches; each niche is enclosed except a ≥2-cell arch mouth that connects (flood-fill) to the arena; all enemy spawn cells lie inside niches and are open; arena interior stays ≥48 m; same seed → identical arches.
- **Determinism harness:** jump-onto-cover + path-around-cover runs hash-match across two states each tic + snapshot/resume; existing player/dude/dynamite fingerprints stay deterministic on height-tiered geometry.
- **Integration:** firewall grep clean (`src/sim` engine-free), tsc, full vitest, vite build.
- **Playtest (the gate):** stand behind low cover and trade shots over it; jump onto cover and fight from height; cultists path around cover instead of through it and still shoot over low cover; tall walls block sight + movement; enemies **emerge from arched niches** and walk into the arena; reroll a dozen maps — mix of low/tall cover + 3–4 arches, all walkable.

## 9. Open items (resolve in planning, not blocking)

- Exact `STEP` (≈0.5 m), low-tier height (≈1.2 m), and low-vs-tall mix ratio — tune in playtest.
- `supportFloorY` edge case: standing half-on/half-off a box — start with "center-over-footprint (expanded by radius) → supported," refine if it feels grabby.
- Whether to add the mid (~2.2 m) tier in v1 or defer until the low/tall mix is judged.
- Arch count (≈3–4), mouth width (≈2 cells), niche depth (≈2 cells), perimeter band thickness (≈2–3 cells), and grid size to keep the open arena ≥48 m — tune in playtest.
- Arch-frame mesh style (flat lintel vs stepped/arched top) — start simple, prettify in the later theming pass.
