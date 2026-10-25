# Sector levels 3b — debris on sector floors, and exploding barrels — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** on Doom-derived sector levels (E1M1), everything a fight leaves behind — gib chunks (marched, sprite,
mesh, baked), blood drops and floor splats, entrails, dropped guns and kit pieces, ejected casings, burning piles,
dynamite bundles and corpses — lands on the floor under it, falls off ledges to the lower floor, and stops at
sector walls; and E1M1's Doom barrels are in the level as our own toxic drums that take damage, explode through
the existing blast, hurt the player and enemies in a radius, chain, and leave a scorch.

**Spec:** `docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md` §6.1 (the ground interface), §8
(barrels), §9 (things). Read first: the hand-off `docs/dev-notes/2026-10-24-sector-levels-handoff.md` items 2f and 4;
plan 3a `docs/superpowers/plans/2026-10-24-sector-levels-3a-enemies.md` and its notes
`docs/dev-notes/2026-10-24-sector-levels-3a/NOTES.md`; `docs/reference/legacy-dynamite-gibbing.md` §3.

**Owner, playtest 2026-10-25:** "enemies change elevation properly, but dropped bodies/kit, ejected shells and blood
stains float in mid-air on raised/sunken floors"; "the parts with enemies feel good"; other parts need interaction
(barrels first).

**Architecture:** one small pure interface, one sector implementation, and every debris stepper takes it as an
optional argument.
- `debris-ground.ts` (new, pure, in `src/lab/sdf-zombie/`): `DebrisGround { floorAt(x, z); ceilAt?(x, z);
  bounce(prev, next, vel, restitution, friction, radius = 0) }` and `landingFloor(g, x, z, last)`. The steppers in `src/lab/sdf-zombie/` import only
  this interface (they must not import `webgpu/`).
- `webgpu/sector-debris.ts` (new, pure): the sector implementation — `floorAt` from `SectorGround`, `bounce` from ONE
  horizontal `sectorSegmentHit` probe per moving piece per step (a segment test, so a fast piece cannot tunnel),
  at the start height clamped into the start sector's floor..ceiling band, run on `radius` past the end, with the hit
  line's normal (the side the piece is on); `ceilAt` (Infinity under sky). Cached per `SectorMap`.
- `webgpu/game-hit-trace.ts`: `debrisGround(ctx)` (null on room levels) and `sectorHitBetween(ctx, a, b)`; every game
  call site passes `debrisGround(ctx) ?? undefined`. **Room levels pass nothing**, so every stepper runs its old
  y = 0 code path, byte for byte.
- Barrels: pure `barrel-state.ts` (HP, hits, blast catch with a hashed 0.1–0.3 s delay, the fuse step, segment vs
  drum) and `blast-player.ts` (the player's blast share with falloff); `barrel-look.ts` (pure profile + albedo);
  `game-barrel-view.ts` (three: drum, stub, scorch); `game-barrels.ts` (the runtime on `ctx.world.barrels`), which
  explodes through `detonateAt` (`game-dynamite-step.ts`) so a barrel's blast IS the dynamite blast (wounds, gibs,
  launches, light, VFX, camera kick).

**Tech Stack:** TypeScript, three.js WebGPU + TSL, Vitest, Python 3 + pytest, headless-Chrome gate
(`scripts/sdf-game-doom-gate.mjs`).

**Decisions taken in this plan:**
- **The floor is read at the piece's CURRENT x/z every step** (`landingFloor`), never at its spawn point; off the map
  (a column hole, the void) a piece keeps its last floor (stored on the piece as an optional `floorY`).
  A piece's floor is the floor under its CENTRE: right for chunks, casings and blood; a gun or kit piece straddling a
  riser may hang or sink half its length — accepted for 3b (an optional footprint `floorUnder(x, z, r)` can come
  later).
- **Spawns start inside the level:** a spawner seeds the piece's `floorY` with the body's floor
  (`ctx.world.level.ground.floorAt` at the body, i.e. the actor's floor) and clamps each spawn point with
  `sectorHitBetween(ctx, bodyCentre, spawnPos)` (a hit: put the piece at the hit point pulled `WALL_SKIN_M` plus its
  radius back toward the body centre), so a gib, rope node, gun, kit piece or casing never starts inside a wall or a
  column — `bounce` judges a step only from a start inside the map. Tasks 2, 4 and 5 do this.
- **Walls:** one horizontal probe from the step's start to its end (run on by the piece's `radius`) at the START
  height, clamped into the start sector's [floor, ceiling] band (no top under sky) — so a piece that ended a step
  above its sector's ceiling (over a doorway's lower lintel) or below its floor still meets this step's walls. A
  one-sided line, a riser higher than the piece (the lower part) or a lip lower than it (the upper part) stops the
  piece's CENTRE `max(radius, 1 cm)` from the line, on its own path (a centre already closer is pushed out along the
  normal); the normal (from the line's side the piece is on, `front === sector`) velocity reflects × the piece's own
  restitution, the tangential keeps × its friction. Callers pass their piece's collision radius (chunks `c.radius`,
  bundles the flight's bundle radius, guns/kit a half-extent); `radius` 0 is the bare 1 cm skin. Falling off a ledge
  is open (the piece is above the lower floor); sliding into a step up is a wall unless the piece is above that floor.
  A step start off the map is not judged (`bounce` returns null). A piece moving parallel to a wall within its radius
  is not pushed out (only a crossing is judged).
- **Blood on walls:** the shipped blood is floor splats only (`blood-sim.ts` `stamp` never paints walls), so it needs
  no sector walls — the drop now stops at a sector wall and runs down it to that wall's floor. The opt-in surface
  blood (`?surfaceblood=1`, `surface-blood-view.ts`) already sweeps every mesh in `ctx.world.levelGroup`, and on a
  sector level those ARE the sector walls and floors (`game-sector-mesh.ts` adds them there); nothing to build, one
  gate check (Task 15) proves a stain lands on a `sector-wall-*` receiver.
- **Casings, guns, kit pieces, bundles also stop at walls** (cheap: only moving pieces probe; casings once per
  1/120 s sub-step, but only while not resting, a handful at a time). **Entrail nodes take the floor only** (each node
  is at most ~0.55 m from a body and constrained to its neighbours; a rope over a ledge hangs off it, which is right).
- **Corpses:** a body whose floor drops by more than 0.75 m (`FALL_DROP_M`, the spec's step rule) FALLS under gravity
  instead of easing at 6 m/s; collapsed rig points meet the floor under each point (`applyFloorContact`, the bend
  constraint's floor fallback), clamped so a point never climbs more than 0.75 m (a ledge wall is not a floor).
- **Player blast damage already exists for rockets only** (`rockets.ts` `blastPlayerDamage`: 45 at the centre,
  quadratic to 0 at 3.2 m, applied in `game-tick.ts` after `detonateAt`); dynamite and the overcook never hurt the
  player. This plan adds a general `blast-player.ts` (same falloff shape, proven equal to the rocket's) and gives
  barrels their own profile. **Dynamite does NOT hurt the player — enemies only (owner, 2026-10-25: keep today's
  behaviour).** `blast-player.ts` serves rockets (their rule unchanged) and barrels only; no task adds player damage
  to a thrown bundle or the overcook, and `detonateAt` itself never damages the player (barrels apply theirs in
  `game-barrels.ts` after calling it).
- **Blasts on sector levels are shielded by sector geometry** (Doom's radius-damage sight check): a body whose torso
  centre, a barrel whose centre, or the player whose capsule centre is behind a sector wall from the blast takes
  nothing. One probe per target. Room levels are unchanged (no filter).
- **Barrel numbers (owner, 2026-10-25: use these, tune after playing):** radius 0.3 m, height 0.95 m, 20 HP; a pellet 4, a slug 20, a flail strike 10,
  an enemy round 3; a blast lights every intact barrel whose centre is within 3.5 m (and not shielded) after
  0.1–0.3 s (FNV-1a of `id:blastCount`, deterministic, no RNG stream touched); a barrel shot to 0 HP goes up on the
  next barrel step (never inside the pellet loop); it explodes at its centre (floor + 0.475 m); the player takes up to
  55 HP, quadratic to 0 at 4.0 m. The blast itself (radius, wounds, gibs) is the dynamite blast unchanged.
- **Barrel look:** a lathe drum (two rolling hoops, chimed rims, a recessed lid) in a procedural toxic-green albedo
  with a black/yellow hazard band, rust at the foot and drips, the level's `metalSheet` normal and roughness maps,
  lit like the sector walls (the sector's light level × albedo) plus a faint nukage-green glow in the lid. No WAD
  data. After the blast: a sooty stub (the drum's bottom 0.18 m, torn top) and a soot scorch on the floor.
- **All of E1M1's barrels, whatever the skill (owner, 2026-10-25: barrels are scenery).** The converter ignores the
  skill flags for type 2035; Doom's multiplayer-only flag (16) STILL skips a barrel — those things are not in a
  single-player Doom game either, and the rule stays the same one the monsters and pickups use.
- **Barrels are sector-level only** in this plan (the level format accepts `barrels` only in sector files). Barrels in
  room levels are later, not in 3b (owner, 2026-10-25).
- **Known gap, accepted for 3b:** a destroyed barrel keeps blocking enemy pathing until the level reloads (navigation
  is built once, with the drums' boxes in it).

**Out of scope (later):** barrels in room levels (Level Format v1 `barrels`, the Flat/arena), a destroyed barrel
freeing its navigation cells (nav is built once; the cells stay blocked until reload), barrel sounds, metal shrapnel
pieces, doors/lifts/switches, enemies ducking barrels, per-barrel shadows.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import; plain data in, plain
    data out). The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). TSL node graphs are for thin
    glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()` bindings
    (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no wall-clock in logic) and console/capture seams
    in plain data.
- **Room levels must not change.** The ring testbed, Night Train, the Wake, the Flat and the arena keep byte-identical
  behaviour: every new parameter is optional and absent on room levels (`debrisGround(ctx)` is null there), and the
  old code path runs unchanged when it is absent. Prove it with the existing tests passing UNCHANGED
  (`gib-chunks.test.ts`, `blood-sim.test.ts` — it pins byte identity —, `entrails*.test.ts`, `prop-drop.test.ts`,
  `dynamite-flight.test.ts`, `motion-floor.test.ts`, the motion snapshot tests in `src/lab/sdf-zombie/__snapshots__`,
  `shotgun-casings.test.ts`, `rockets.test.ts`) and the regression gates in Task 17.
- Work ONLY in your worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <paths>`, `npm run test:changed`) plus `npm run typecheck` (~2 min, once per
  round). Never the full suite: CI runs it on every push (`gh run list --branch <branch>`).
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Gates need
  `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors. Machine load is often high: a budget
  failure at load average > 15 is re-run, not "fixed".
- **Prove visual and performance claims with a number** and look at the screenshots yourself.
- **Boot time is a gate:** a change that touches shaders or materials (Tasks 12, 13) reports cold-boot `drawOnce`
  against the base branch (fresh profile each run).
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's `.visible`. Never sample the
  render target you are writing. In `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment. A
  `MeshBasicNodeMaterial` in `ctx.world.levelGroup` is hidden by the deferred router — use `MeshStandardNodeMaterial`
  there (as the sector meshes do). Adding a light needs a skip in `game-lighting-leaves.ts levelSceneLights` — this
  plan adds none.
- Kill anything you start outside a capture script in the same step.
- **Anything derived from the WAD is a dev placeholder:** never commit `public/assets/levels/doom-*.level.json` or
  `.lab-tmp/`. Extracted Blood assets are dev placeholders — never commit them.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Every y = 0 site found (2026-10-25 grep of `src/lab/sdf-zombie/`)

The hand-off's line numbers were stale; these are the current sites (line numbers approximate, find by function).

| # | File | Function / place | Assumption today | Task |
| --- | --- | --- | --- | --- |
| 1 | `gib-chunks.ts` | `stepChunk` (~294, the `y < floorOffset` floor clamp and the post-topple re-seat) | floor plane y = 0; no walls but boxes | 2 |
| 2 | `gib-chunks.ts` | `chunkSettled` (~434) | grounded = `pos[1] <= chunkSupportOffset` (floor 0) | 2 |
| 3 | `webgpu/game-hit-trace.ts` | `chunkCollidersAt` (~190) | boxes + ceiling only. Feeds the SDF chunks and flesh bits and the snapped eye (`game-tick.ts` ~1148), mesh gibs incl. torn meat and the brain (`game-mesh-gibs.ts` ~82), sprite pieces (`gib-sprite-pieces.ts` via `game-tick.ts` ~1177) | 2 |
| 4 | `blood-sim.ts` | `stepBlood` (~620) | a drop lands at `pos[1] <= 0.01`; no walls | 3 |
| 5 | `blood-sim.ts` | `stamp` (~555, ~559) | both splats at y = 0 | 3 |
| 6 | `webgpu/blood-view-gpu.ts` | `sync`, splat loop (~386) | splat drawn at y = 0.005 | 3 |
| 7 | `webgpu/goo-layer.ts` | `sync`, splat density quads (~2431, ~2507–2508) | splat at y = 0.02 | 3 |
| 8 | `blood-view.ts` (WebGL twin, lab only) | `sync`, splat loop (~111) | splat at y = 0.005 | 3 |
| 9 | `entrails.ts` | `stepGutChain` (~177) | nodes clamp to y = 0 | 4 |
| 10 | `prop-drop.ts` | `stepDrop` (`floorY` param) — called by `webgpu/held-prop.ts` `step` | `webgpu/character-view.ts` `pose` (~695) passes `0` | 5 |
| 11 | `webgpu/shotgun-casings.ts` | `step` (~106) | casings rest at y = 0.012 | 5 |
| 12 | `webgpu/kit-damage.ts` | `update`, shed-piece drops (~226) | a dropped kit piece rests at bounds.min.y = 0.01 | 5 |
| 13 | `motion.ts` | the floor block of `stepMotion` (~688) | a drop eases at 6 m/s (no fall) | 6 |
| 14 | `motion.ts` | `applyFloorContact` (~1613), called from `webgpu/game-actor.ts` (~1703) and `actor.ts` (~238, lab) | one floor plane for the whole collapsed rig (the body's) | 6 |
| 15 | `rig.ts` | `constrainRigBends` floor fallback (~144), called from `game-actor.ts` (~1707) | one floor plane | 6 |
| 16 | `webgpu/game-burning.ts` | `updateCards` (~411–438) | `groundY: 0` for the burn-down pile (cards and LOD cards) | 7 |
| 17 | `webgpu/game-dynamite-step.ts` | `detonateAt` (~57) | `floorDistM: Math.max(0, at[1])` (air vs ground burst) | 7 |
| 18 | `explosion-aoe.ts` | `resolveExplosion` default `floorDistM` (~442) | `Math.max(0, at[1])` — only when the caller passes nothing; the game passes it (site 17); lab default left | — |
| 19 | `dynamite-flight.ts` | `stepSub` (~183) | the floor is y = 0; walls are boxes or the arena rect | 8 |
| 20 | `webgpu/game-dynamite-step.ts` | `stepDynamite` flight world (~240) | no floor/walls passed | 8 |
| 21 | `webgpu/game-dynamite-throw.ts` | `throwBundle` origin (~136–155) | the prop's hand position, may sit past a wall the player hugs | 8 |
| 22 | `webgpu/game-seams-spawn-goo.ts` | `spawnCrowd` (~226) | `p0 = [cx, 0, cz]` | 9 |
| 23 | `webgpu/game-loop.ts` | pickup meshes (~107) and the spin (~199) | **already fixed in 3a** (y = floor + 0.25 on sector levels); pickups do not bob (spin only) — gate check only | 15 |
| 24 | `webgpu/game-tick.ts` | player pellets `p.pos[1] <= 0.02` (~892), rockets/bile `to[1] <= 0.02` (~1018, ~1038) | already room-level only (3a) | — |

Checked and NOT a floor assumption: flesh-bit shrink (`game-tick.ts` ~1140, relative to its own y), the snapped eye's
stalk (`game-kit-eye.ts`, rides a live body), `gib-tear.ts` (no floor; regions hand over to chunks), the explosion VFX
(anchors at the blast point), the player's own ejected shells (`game-tick.ts` ~727, view-model only, never land),
flame cards' `groundY` default (`flame-cards.ts` ~761, fed by site 16), `humanoid-sever.ts` (spike page only).

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/debris-ground.ts` | create | The `DebrisGround` interface + `landingFloor` |
| `src/lab/sdf-zombie/webgpu/sector-debris.ts` (+ test) | create | Sector floor + wall bounce for debris |
| `src/lab/sdf-zombie/webgpu/game-hit-trace.ts` | modify | `debrisGround(ctx)`, `sectorHitBetween`, `chunkCollidersAt` passes the ground |
| `src/lab/sdf-zombie/gib-chunks.ts` (+ test) | modify | Chunks land on / bounce off sector geometry |
| `src/lab/sdf-zombie/blood-sim.ts` (+ test), `blood-view.ts`, `webgpu/blood-view-gpu.ts`, `webgpu/goo-layer.ts` | modify | Drops and splats on the floor under them |
| `src/lab/sdf-zombie/entrails.ts` (+ test), `webgpu/game-bleed.ts` | modify | Rope nodes on the floor under them |
| `src/lab/sdf-zombie/prop-drop.ts` (+ test), `webgpu/held-prop.ts`, `webgpu/shotgun-casings.ts` (+ test), `webgpu/kit-damage.ts`, `webgpu/kit-overlay.ts`, `webgpu/character-view.ts`, `webgpu/game-spawn.ts` | modify | Guns, casings, kit pieces |
| `src/lab/sdf-zombie/motion.ts` (+ `motion-floor.test.ts`), `rig.ts`, `webgpu/game-actor.ts` | modify | Bodies fall off ledges; corpse contact per point |
| `src/lab/sdf-zombie/webgpu/game-burning.ts`, `webgpu/game-dynamite-step.ts` | modify | Burn pile floor; blast floor distance; sector-shielded blasts |
| `src/lab/sdf-zombie/dynamite-flight.ts` (+ test), `webgpu/game-dynamite-throw.ts` | modify | Bundles on sector floors and walls |
| `src/lab/sdf-zombie/webgpu/game-seams-debris.ts` | create | `debris()`, `collapseActor`, `bloodBurstAt`, `throwTestBundle` |
| `src/lab/sdf-zombie/webgpu/level-def.ts`, `sector-json.ts` (+ test), `public/assets/levels/fixtures/sectors.level.json` | modify | `barrels` in the sector format |
| `scripts/levels/doom_map.py`, `doom_tables.py`, `scripts/tests/test_doom_map.py` | modify | Thing 2035 → barrels |
| `src/lab/sdf-zombie/webgpu/barrel-state.ts` (+ test), `src/lab/sdf-zombie/blast-player.ts` (+ test) | create | Barrel rules; player blast share |
| `src/lab/sdf-zombie/webgpu/barrel-look.ts` (+ test), `webgpu/game-barrel-view.ts` | create | Drum profile/albedo/scorch alpha; the meshes |
| `src/lab/sdf-zombie/webgpu/game-barrels.ts`, `game-seams-barrels.ts`, `game-state-world.ts`, `game-level-rooms.ts`, `game-main.ts`, `game-tick.ts`, `game-flail.ts` | create/modify | Barrels in play |
| `scripts/sdf-game-doom-gate.mjs` | modify | Sections 6 (debris) and 7 (barrels) |
| `docs/dev-notes/2026-10-25-sector-levels-3b/NOTES.md` | create | Results |

Parallelism: after Task 1, Tasks 2, 4, 5, 6 touch disjoint files and may run in parallel. Run in order the tasks
that share a file: `game-tick.ts` — 3 → 13 → 14; `game-dynamite-step.ts` — 7 → 8 → 13; `game-hit-trace.ts` — 1 → 2.
Task 9 needs 2–8. Tasks 10–12 are independent of 2–9 (10 and 11 in parallel; 12 needs 11's `BARREL`). Task 13 needs
9–12; Task 14 needs 13. The gates (15, 16) and the regressions (17) need everything before them.

---

## Task 1: The debris ground (pure)

**Files:** create `src/lab/sdf-zombie/debris-ground.ts`, `src/lab/sdf-zombie/webgpu/sector-debris.ts`,
`src/lab/sdf-zombie/webgpu/sector-debris.test.ts`; modify `src/lab/sdf-zombie/webgpu/game-hit-trace.ts`.

The fixture (`public/assets/levels/fixtures/sectors.level.json`): A x −4..4, z −8..0, floor 0, ceil 4, with the
column hole x −1..1, z −5..−3; B z −8..−12, floor 0.5; C z −12..−16, floor 1.5; D x 4..8, z −8..0, floor −1, sky.

- [ ] **Step 1: Write the interface** `src/lab/sdf-zombie/debris-ground.ts`:

```ts
// src/lab/sdf-zombie/debris-ground.ts
//
// WHAT LOOSE DEBRIS LANDS ON (plan 2026-10-25-sector-levels-3b): the floor under a piece at its CURRENT x/z and the
// walls it must not pass. Room levels pass nothing, so every stepper keeps its y = 0 plane byte for byte; sector
// levels pass webgpu/sector-debris.ts's implementation. The steppers in this folder import only this file.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from './types';

export interface WallBounce {
  pos: Vec3;
  vel: Vec3;
  /** Unit wall normal in x/z (y 0), pointing back toward where the piece came from. */
  normal: Vec3;
}

export interface DebrisGround {
  /** Floor height under (x, z); NaN off the map (a column hole, the void). A piece's floor is the floor under its
   *  CENTRE (a long piece straddling a riser may hang or sink half its length: accepted for 3b). */
  floorAt(x: number, z: number): number;
  /** Ceiling height over (x, z): Infinity under sky, NaN off the map. Optional (a stepper with no ground, or a
   *  ground without it, has no ceiling: treat as Infinity). */
  ceilAt?(x: number, z: number): number;
  /** The piece moved prev → next with velocity vel. If that move crossed a sector wall at the start height (clamped
   *  into the start sector's floor..ceiling band: a one-sided line, a riser higher than the piece, a lip lower than
   *  it), the piece's centre stops max(radius, 1 cm) short of the wall (the probe runs on `radius` past next, so the
   *  leading edge meets it): the normal velocity reflects × `restitution`, the tangential keeps × `friction`, y is
   *  next's. `radius` defaults to 0. Null when nothing was crossed (or prev is off the map: nothing to judge
   *  against). */
  bounce(prev: Vec3, next: Vec3, vel: Vec3, restitution: number, friction: number, radius?: number): WallBounce | null;
}

/** The floor a piece at (x, z) lands on: the floor there, or `last` (its previous floor) off the map. */
export function landingFloor(g: DebrisGround, x: number, z: number, last: number): number {
  const f = g.floorAt(x, z);
  return Number.isFinite(f) ? f : last;
}
```

- [ ] **Step 2: Write the failing tests** `src/lab/sdf-zombie/webgpu/sector-debris.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/sector-debris.test.ts — the sector debris ground on the committed sectors fixture
// (A floor 0 with the column hole x −1..1 z −5..−3; B z −8..−12 floor 0.5; C z −12..−16 floor 1.5; D x 4..8 floor −1).
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { sectorDebrisGround, WALL_SKIN_M } from './sector-debris';
import { landingFloor } from '../debris-ground';
import type { Vec3 } from '../types';

const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
const g = sectorDebrisGround(map, buildSectorGround(map));

describe('sectorDebrisGround: floors', () => {
  it('reads the sector floor under a point, NaN in the column', () => {
    expect(g.floorAt(0, -2)).toBe(0);
    expect(g.floorAt(0, -10)).toBe(0.5);
    expect(g.floorAt(0, -14)).toBe(1.5);
    expect(g.floorAt(6, -4)).toBe(-1);
    expect(Number.isNaN(g.floorAt(0, -4))).toBe(true);
  });
  it('landingFloor keeps the last floor off the map', () => {
    expect(landingFloor(g, 0, -4, 0.25)).toBe(0.25);
    expect(landingFloor(g, 0, -10, 0.25)).toBe(0.5);
  });
  it('is cached per map', () => {
    expect(sectorDebrisGround(map, buildSectorGround(map))).toBe(g);
  });
});

describe('sectorDebrisGround: walls', () => {
  it('a piece low in A sliding into the 0.5 m riser stops 1 cm short and reflects', () => {
    const b = g.bounce([1, 0.2, -7.5], [1, 0.2, -8.5], [0.4, 0, -3], 0.5, 0.7)!;
    expect(b).not.toBeNull();
    expect(b.pos[2]).toBeCloseTo(-8 + WALL_SKIN_M, 9);
    expect(b.normal[2]).toBeCloseTo(1, 9);                         // back toward A (+z)
    expect(b.vel[2]).toBeCloseTo(1.5, 9);                          // −(−3) × 0.5
    expect(b.vel[0]).toBeCloseTo(0.28, 9);                         // tangential × 0.7
  });
  it('above the step it passes onto B', () => {
    expect(g.bounce([1, 0.7, -7.5], [1, 0.7, -8.5], [0, 0, -3], 0.5, 0.7)).toBeNull();
  });
  it('off the C ledge toward B is open (it falls)', () => {
    expect(g.bounce([0, 1.6, -12.4], [0, 1.6, -11.6], [0, 0, 2], 0.5, 0.7)).toBeNull();
  });
  it('the column face stops it; a fast piece cannot tunnel the north wall', () => {
    const c = g.bounce([0, 0.2, -2], [0, 0.2, -4], [0, 0, -20], 0.5, 0.7)!;
    expect(c.pos[2]).toBeCloseTo(-3 + WALL_SKIN_M, 9);
    const w = g.bounce([0, 1, -0.5], [0, 1, 3.5], [0, 0, 240], 0.5, 0.7)!;   // 4 m in one step
    expect(w.pos[2]).toBeCloseTo(-WALL_SKIN_M, 9);
    expect(w.normal[2]).toBeCloseTo(-1, 9);
  });
  it('a start off the map or a stationary piece is not judged', () => {
    expect(g.bounce([0, 0.2, -4], [0, 0.2, -6], [0, 0, -3], 0.5, 0.7)).toBeNull();
    const p: Vec3 = [1, 0.2, -7];
    expect(g.bounce(p, [1, 0.1, -7], [0, -1, 0], 0.5, 0.7)).toBeNull();
  });
});

describe('sectorDebrisGround: review fixes', () => {
  it('a piece above its ceiling or below its floor still meets the walls', () => {
    // Above A's 4 m ceiling, sliding into A's north wall: probed at the ceiling, still a wall.
    const up = g.bounce([0, 4.5, -0.5], [0, 4.5, 0.5], [0, 0, 60], 0.5, 0.7)!;
    expect(up).not.toBeNull();
    expect(up.pos[2]).toBeCloseTo(-WALL_SKIN_M, 9);
    // Sunk under B's 0.5 m floor, sliding into the 1.5 m riser to C: probed at B's floor, still a wall.
    const down = g.bounce([0, 0.3, -11.5], [0, 0.3, -12.5], [0, 0, -3], 0.5, 0.7)!;
    expect(down).not.toBeNull();
    expect(down.pos[2]).toBeCloseTo(-12 + WALL_SKIN_M, 9);
  });
  it('a radius stops the centre that far from the wall, and catches a leading edge the centre never crossed', () => {
    const r = g.bounce([1, 0.2, -7.5], [1, 0.2, -8.5], [0, 0, -3], 0.5, 0.7, 0.1)!;
    expect(r.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    const edge = g.bounce([1, 0.2, -7.5], [1, 0.2, -7.95], [0, 0, -3], 0.5, 0.7, 0.1)!;
    expect(edge).not.toBeNull();
    expect(edge.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    expect(edge.vel[2]).toBeCloseTo(1.5, 9);
    expect(g.bounce([1, 0.2, -7.5], [1, 0.2, -7.95], [0, 0, -3], 0.5, 0.7)).toBeNull();   // radius 0: open
  });
  it('a slanted approach with a radius ends exactly radius off the line', () => {
    const r = g.bounce([1, 0.2, -7.5], [2, 0.2, -8.5], [2, 0, -2], 0.5, 1, 0.1)!;
    expect(r.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    expect(r.pos[0]).toBeCloseTo(1.4, 9);                           // on the centre's path
    expect(r.vel[0]).toBeCloseTo(2, 9);
  });
  it('the normal comes from the side the piece is on (column faces, from outside)', () => {
    const n = g.bounce([0, 0.2, -5.5], [0, 0.2, -4.5], [0, 0, 3], 0.5, 0.7)!;   // the column's south face, z −5
    expect(n.normal[2]).toBeCloseTo(-1, 9);
    expect(n.pos[2]).toBeCloseTo(-5 - WALL_SKIN_M, 9);
    const e = g.bounce([1.5, 0.2, -4], [0.5, 0.2, -4], [-3, 0, 0], 0.5, 0.7)!;
    expect(e.normal[0]).toBeCloseTo(1, 9);
  });
  it('ceilAt: the sector ceiling, Infinity under sky, NaN off the map', () => {
    expect(g.ceilAt!(0, -2)).toBe(4);
    expect(g.ceilAt!(6, -4)).toBe(Infinity);
    expect(Number.isNaN(g.ceilAt!(0, -4))).toBe(true);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/lab/sdf-zombie/webgpu/sector-debris.test.ts` — FAIL (module missing).

- [ ] **Step 4: Implement** `src/lab/sdf-zombie/webgpu/sector-debris.ts`:

```ts
// src/lab/sdf-zombie/webgpu/sector-debris.ts
//
// THE SECTOR DEBRIS GROUND (plan 2026-10-25-sector-levels-3b Task 1): DebrisGround for a sector level. floorAt is the
// sector floor; bounce is ONE horizontal sectorSegmentHit probe from the step's start to its end at the START height
// (a segment test, so a fast piece cannot tunnel a wall), run on past the end by the piece's radius so its leading
// edge meets the wall, and the piece's CENTRE is put max(radius, WALL_SKIN_M) from the line hit.
// Horizontal at the start height on purpose, and that height clamped into the start sector's open band
// [floor, ceil] (no top under sky): the probe meets only walls — a riser it is lower than, a lip it is higher than, a
// one-sided line — never the floor or ceiling of the sector it is in (those are the vertical clamp's business, read
// at the end x/z), and a piece that ended last step above its ceiling or below its floor still meets this step's
// walls. Cached per SectorMap.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from '../types';
import type { DebrisGround, WallBounce } from '../debris-ground';
import { SKY_MATERIAL, type SectorMap } from './sector-def';
import type { SectorGround } from './sector-ground';
import { sectorSegmentHit, type SectorHit } from './sector-ray';

/** How far short of a wall a stopped piece is put, metres (keeps the next step's start off the line). */
export const WALL_SKIN_M = 0.01;

const cache = new WeakMap<SectorMap, DebrisGround>();

export function sectorDebrisGround(map: SectorMap, ground: SectorGround): DebrisGround {
  const cached = cache.get(map);
  if (cached) return cached;
  const S = map.sectors;
  const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  const g: DebrisGround = {
    floorAt: (x, z) => ground.floorAt(x, z),
    ceilAt(x, z) {
      const s = ground.sectorAt(x, z);
      if (s < 0) return NaN;
      const sec = S[s]!;
      return sec.materials.ceil === SKY_MATERIAL ? Infinity : sec.ceil;
    },
    bounce(prev, next, vel, restitution, friction, radius = 0): WallBounce | null {
      const dx = next[0] - prev[0], dz = next[2] - prev[2];
      if (dx === 0 && dz === 0) return null;
      const s = ground.sectorAt(prev[0], prev[2]);
      if (s < 0) return null;
      // Probe inside the start sector's open band: a piece above its ceiling (or below its floor) would
      // otherwise read as a ceiling (floor) hit at t 0 and skip every wall this step.
      const sec = S[s]!;
      const top = sec.materials.ceil === SKY_MATERIAL ? Infinity : sec.ceil;
      const y = Math.min(top, Math.max(sec.floor, prev[1]));
      const stop = Math.max(radius, WALL_SKIN_M);
      // The probe runs on past next by the radius, so the piece's leading edge meets the wall, not its centre.
      const ext = radius > 0 ? radius / Math.hypot(dx, dz) : 0;
      a[0] = prev[0]; a[1] = y; a[2] = prev[2];
      b[0] = next[0] + dx * ext; b[1] = y; b[2] = next[2] + dz * ext;
      const h = sectorSegmentHit(map, ground, a, b, out, s);
      if (!h || h.kind !== 'wall' || h.line < 0) return null;
      const ln = map.lines[h.line]!;
      const v0 = map.vertices[ln.v[0]]!, v1 = map.vertices[ln.v[1]]!;
      // (−ez, ex) points into the line's front (left) side; flip it when the piece came from the back.
      let nx = -(v1[1] - v0[1]), nz = v1[0] - v0[0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (ln.front !== h.sector) { nx = -nx; nz = -nz; }
      const vn = vel[0] * nx + vel[2] * nz;
      const tx = vel[0] - vn * nx, tz = vel[2] - vn * nz;
      const rn = vn < 0 ? -vn * restitution : vn;
      // Where the centre's own path is `stop` from the line (the line is straight, so the distance is linear in
      // t), clamped to the step; a centre already closer than that is pushed out along the normal.
      const dist0 = nx * (prev[0] - h.point[0]) + nz * (prev[2] - h.point[2]);
      const dn = dx * nx + dz * nz;   // < 0: the step runs toward the wall
      const tc = dn < 0 ? Math.min(1, Math.max(0, (stop - dist0) / dn)) : 0;
      const push = stop - (dist0 + tc * dn);
      return {
        pos: [prev[0] + tc * dx + push * nx, next[1], prev[2] + tc * dz + push * nz] as Vec3,
        vel: [tx * friction + rn * nx, vel[1], tz * friction + rn * nz] as Vec3,
        normal: [nx, 0, nz] as Vec3,
      };
    },
  };
  cache.set(map, g);
  return g;
}
```

  (Review fixes, 2026-10-25: the probe height is clamped into the start sector's band and `sectorAt` is looked up
  once and passed as `startSector`; `radius` stops the centre that far out; the normal's side is
  `ln.front === h.sector`; `ceilAt` added.)

- [ ] **Step 5: Game helpers** in `src/lab/sdf-zombie/webgpu/game-hit-trace.ts` (beside `chunkCollidersAt`):

```ts
import type { DebrisGround } from '../debris-ground';
import { sectorDebrisGround } from './sector-debris';
import { sectorSegmentHit, type SectorHit } from './sector-ray';
import type { SectorGround } from './sector-ground';

/** The debris ground on a SECTOR level (plan 3b), or null on a room level — where every debris stepper keeps its
 *  y = 0 plane exactly. Cached per map inside sector-debris.ts, so this is a WeakMap lookup per call. */
export function debrisGround(ctx: GameContext): DebrisGround | null {
  const map = ctx.world.level.def?.sectors;
  return map ? sectorDebrisGround(map, ctx.world.level.ground as SectorGround) : null;
}

/** Where a → b first meets sector geometry, or null (always null on room levels). */
export function sectorHitBetween(ctx: GameContext, a: Vec3, b: Vec3): SectorHit | null {
  const map = ctx.world.level.def?.sectors;
  return map ? sectorSegmentHit(map, ctx.world.level.ground as SectorGround, a, b) : null;
}
```

- [ ] **Step 6:** `npx vitest run src/lab/sdf-zombie/webgpu/sector-debris.test.ts src/lab/sdf-zombie/webgpu/sector-ray.test.ts`
  — PASS; `npm run typecheck`.
- [ ] **Step 7: Commit:**
  `git add src/lab/sdf-zombie/debris-ground.ts src/lab/sdf-zombie/webgpu/sector-debris.ts src/lab/sdf-zombie/webgpu/sector-debris.test.ts src/lab/sdf-zombie/webgpu/game-hit-trace.ts`
  → `feat(levels): the debris ground — sector floors and walls for loose pieces (pure)`.

**Interface notes for Tasks 2–8 (after the Task 1 review):** `bounce` takes an optional 6th argument `radius`
(metres, default 0) — pass the piece's collision radius so its edge, not its centre, meets the wall. `ceilAt?(x, z)`
is optional on `DebrisGround` (Infinity under sky, NaN off the map); a stepper that clamps to a ceiling reads it as
`ground.ceilAt?.(x, z) ?? Infinity` and treats NaN as no ceiling. Fake grounds in tests may omit it. Spawners follow
the "Spawns start inside the level" decision.

---

## Task 2: Gib chunks on sector floors

Covers every chunk stepper in the game: the SDF chunks, flesh bits and the snapped eye (`game-tick.ts` chunk loop),
mesh gibs including torn meat and the brain (`game-mesh-gibs.ts`), sprite pieces (`gib-sprite-pieces.ts`), and the
bake trigger (`chunkSettled`), because all of them go through `stepChunk` + `chunkCollidersAt`.

**Files:** `src/lab/sdf-zombie/gib-chunks.ts`, `src/lab/sdf-zombie/gib-chunks.test.ts`,
`src/lab/sdf-zombie/webgpu/game-hit-trace.ts`, `src/lab/sdf-zombie/webgpu/game-seams-fx.ts` (`chunkStates` reports
`floorY`).

- [ ] **Step 1: Failing tests** — append to `src/lab/sdf-zombie/gib-chunks.test.ts` (fake grounds, no fixture):

```ts
import type { DebrisGround } from './debris-ground';
import { chunkSupportOffset } from './gib-chunks';

const LEDGE: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };   // a 1 m ledge for x < 0
const run = (c: Chunk, s: number, col: ChunkColliders) => { for (let i = 0; i < s * 60; i++) c = stepChunk(c, 1 / 60, col); return c; };

describe('stepChunk on a debris ground (sector levels)', () => {
  it('settles on the floor under it, not on y = 0', () => {
    const c = run(makeChunk('armL', [-0.5, 1.6, 0], [0, 0, 0], 0.12, [0, 1, 0], makeRng(3)), 4, { ground: LEDGE });
    expect(c.floorY).toBe(1);
    expect(c.pos[1]).toBeCloseTo(1 + chunkSupportOffset(c), 4);
    expect(chunkSettled(c)).toBe(true);
  });
  it('slides off the ledge and lands on the lower floor', () => {
    const c = run(makeChunk('armL', [-0.3, 1.2, 0], [1.5, 0, 0], 0.12, [0, 1, 0], makeRng(4)), 4, { ground: LEDGE });
    expect(c.pos[0]).toBeGreaterThan(0);
    expect(c.floorY).toBe(0);
    expect(c.pos[1]).toBeCloseTo(chunkSupportOffset(c), 4);
    expect(chunkSettled(c)).toBe(true);
  });
  it('stops at a wall the ground reports, however fast', () => {
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (prev, next, vel, r, f) => (prev[0] < 1 && next[0] >= 1
        ? { pos: [0.99, next[1], next[2]], vel: [-vel[0] * r, vel[1], vel[2] * f], normal: [-1, 0, 0] } : null),
    };
    let c = makeChunk('torso', [0, 0.5, 0], [20, 0, 0], 0.12, [0, 1, 0], makeRng(5));
    for (let i = 0; i < 120; i++) { c = stepChunk(c, 1 / 60, { ground: wall }); expect(c.pos[0]).toBeLessThan(1); }
  });
  it('keeps its last floor off the map', () => {
    const holed: DebrisGround = { floorAt: (x) => (x > 2 ? NaN : 0.5), bounce: () => null };
    const c = run(makeChunk('torso', [1.5, 0.8, 0], [2, 0, 0], 0.12, [0, 1, 0], makeRng(6)), 3, { ground: holed });
    expect(c.pos[0]).toBeGreaterThan(2);
    expect(c.floorY).toBe(0.5);
    expect(c.pos[1]).toBeGreaterThanOrEqual(0.5);
  });
  it('without a ground: no floorY key and the same numbers as before', () => {
    const a = run(makeChunk('armL', [0, 2, 0], [1, 0, 0.5], 0.12, [0, 1, 0], makeRng(7)), 2, {});
    const b = run(makeChunk('armL', [0, 2, 0], [1, 0, 0.5], 0.12, [0, 1, 0], makeRng(7)), 2, { boxes: [] });
    expect('floorY' in a).toBe(false);
    expect(a).toEqual(b);
  });
});
```

  (Use the test file's existing rng helper if it has one instead of `makeRng` — read the file's top; `makeRng` is in
  `./wander`.) Run `npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts` — the new block FAILS (`ground` unknown).

- [ ] **Step 2: Implement in `gib-chunks.ts`.**
  - `Chunk` gains `/** SECTOR levels: the floor the chunk last stood over (stepChunk writes it only when given a
    ground). Absent = the y = 0 plane. */ floorY?: number;`
  - `ChunkColliders` gains `/** SECTOR levels (plan 3b): the floor under the chunk's CURRENT x/z and the sector walls.
    Absent: the y = 0 plane, as before. */ ground?: DebrisGround;` (import the type from `./debris-ground`).
  - In `stepChunk`, after the boxes block and before the ceiling:

```ts
  const ground = colliders?.ground;
  // SECTOR WALLS (plan 3b): the step's move from where the chunk was, after the boxes. A fast piece meets the wall
  // it would have crossed (the probe is a segment), stops short and bounces with the wall restitution.
  if (ground) {
    const b = ground.bounce(c.pos, [x, y, z], [vx, vy, vz], wallRest, FLOOR_FRICTION, c.radius);
    if (b) { x = b.pos[0]; y = b.pos[1]; z = b.pos[2]; vx = b.vel[0]; vy = b.vel[1]; vz = b.vel[2]; }
  }
```

  - The floor: replace `if (y < floorOffset) { y = floorOffset; …` with

```ts
  // THE FLOOR UNDER THE CHUNK NOW (sector levels: read at this step's x/z, so a piece off a ledge falls to the lower
  // floor); room levels: the y = 0 plane, the same arithmetic as before.
  const floorY = ground ? landingFloor(ground, x, z, c.floorY ?? 0) : 0;
  const floorLine = ground ? floorY + floorOffset : floorOffset;
  if (y < floorLine) {
    y = floorLine;
```

    and the post-topple re-seat `if (y < postFloor) y = postFloor;` becomes
    `const post = ground ? floorY + postFloor : postFloor; if (y < post) y = post;`.
  - The output: `const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, quat, angVel, ...(ground ? { floorY } : {}) };`
  - `chunkSettled`: `const base = c.floorY === undefined ? chunkSupportOffset(c) : c.floorY + chunkSupportOffset(c);`
    then `if (!(c.pos[1] <= base + 1e-4)) return false;`.
- [ ] **Step 3: Wire the game.** `game-hit-trace.ts` `chunkCollidersAt` returns `ChunkColliders` (import the type):

```ts
export function chunkCollidersAt(ctx: GameContext, pos: Vec3): ChunkColliders {
  const ground = debrisGround(ctx);
  const boxes = ctx.world.colliders, ceilingY = ceilingAt(ctx, pos[0], pos[2]);
  return ground ? { boxes, ceilingY, ground } : { boxes, ceilingY };
}
```

  No other call site changes (game-tick, game-mesh-gibs and the sprite pieces all call it) — except the SPAWNS: where
  the game makes a chunk, flesh bit, mesh gib or sprite piece on a sector level, seed `floorY` with the body's floor
  and clamp the spawn point with `sectorHitBetween(ctx, bodyCentre, spawnPos)` (see the decision "Spawns start inside
  the level"), so a gib never starts inside a wall or the column. Gate it with a test on the clamp helper (pure: put
  it beside `debrisGround` in `game-hit-trace.ts` as `clampSpawnInside(ctx, from, to, radius)`, or a pure twin taking
  the map and ground, tested on the fixture). In `game-seams-fx.ts`
  `chunkStates` add `floorY: c.state.floorY ?? 0` to the marched rows (sprite rows: add it in `spritePieceStates` the
  same way if it builds rows from `p.state`).
- [ ] **Step 4:** `npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts src/lab/sdf-zombie/webgpu/gib-sprite-pieces*.test.ts src/lab/sdf-zombie/flesh-bits.test.ts src/lab/sdf-zombie/gib-launch.test.ts`
  (adjust to what exists) — all PASS, the pre-existing tests unchanged; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(gore): gib chunks land on the sector floor under them and stop at sector walls`.

---

## Task 3: Blood drops and splats on the floor under them

**Files:** `src/lab/sdf-zombie/blood-sim.ts`, `src/lab/sdf-zombie/blood-sim.test.ts`, `src/lab/sdf-zombie/blood-view.ts`,
`src/lab/sdf-zombie/webgpu/blood-view-gpu.ts`, `src/lab/sdf-zombie/webgpu/goo-layer.ts`,
`src/lab/sdf-zombie/webgpu/game-tick.ts` (the `stepBlood` call, ~1243).

- [ ] **Step 1: Failing tests** — append to `blood-sim.test.ts`:

```ts
import type { DebrisGround } from './debris-ground';

const STEP: DebrisGround = { floorAt: (x) => (x < 0 ? 0.75 : -0.5), bounce: () => null };
const drop = (pos: [number, number, number], vel: [number, number, number]): Droplet =>
  ({ pos, vel, age: 0, life: 5, size: 0.01, kind: 'drop' });

describe('stepBlood on a debris ground (sector levels)', () => {
  it('a drop lands and stamps on the floor under it', () => {
    const sim = createBloodSim();
    sim.droplets.push(drop([-0.5, 2, 0], [0, 0, 0]), drop([0.5, 2, 0], [0, 0, 0]));
    const rng = makeRng(1);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, STEP);
    expect(sim.droplets).toHaveLength(0);
    for (const s of sim.splats) expect(s.pos[1]).toBe(s.pos[0] < 0 ? 0.75 : -0.5);
    expect(sim.splats.some((s) => s.pos[1] === -0.5)).toBe(true);
  });
  it('never stamps a splat on a floor it is not over (a jittered splat across an edge is skipped)', () => {
    const sim = createBloodSim();
    for (let k = 0; k < 40; k++) sim.droplets.push(drop([-0.01, 1.2, k * 0.05], [0, 0, 0]));
    const rng = makeRng(2);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, STEP);
    for (const s of sim.splats) expect(s.pos[1]).toBe(STEP.floorAt(s.pos[0], s.pos[2]));
  });
  it('a drop that hits a wall stops there and runs down to that floor', () => {
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (prev, next, vel) => (prev[0] < 1 && next[0] >= 1
        ? { pos: [0.99, next[1], next[2]], vel: [0, vel[1], 0], normal: [-1, 0, 0] } : null),
    };
    const sim = createBloodSim();
    sim.droplets.push(drop([0, 1.5, 0], [6, 0, 0]));
    const rng = makeRng(3);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, wall);
    expect(sim.splats.every((s) => s.pos[0] < 1 + 0.3)).toBe(true);   // at the wall's foot (± the splat jitter)
  });
  it('the same RNG draws with or without a ground on a flat floor', () => {
    const flat: DebrisGround = { floorAt: () => 0, bounce: () => null };
    const a = createBloodSim(), b = createBloodSim();
    burst(a, [0, 1, 0], makeRng(9)); burst(b, [0, 1, 0], makeRng(9));
    const ra = makeRng(10), rb = makeRng(10);
    for (let i = 0; i < 300; i++) { stepBlood(a, 1 / 60, ra); stepBlood(b, 1 / 60, rb, undefined, undefined, flat); }
    expect(b.splats).toEqual(a.splats);
  });
});
```

  (Import `makeRng` from `./wander` if the file has no rng helper; `burst` is already imported.) Run — FAIL.

- [ ] **Step 2: Implement in `blood-sim.ts`.**
  - `Droplet` gains `/** SECTOR levels: the floor the drop was last over (stepBlood writes it only with a ground). */ floorY?: number;`
  - `stepBlood(sim, dt, rng, flow?, surfaces?, ground?: DebrisGround)`. Before integrating, when `ground` and not
    `surfaces`, copy the start into a module scratch (`const PREV: [number, number, number] = [0, 0, 0]` at module
    level — no allocation per drop). The landing branch becomes three-way, the room branch untouched:

```ts
    if (surfaces) {
      // … unchanged …
    } else if (ground) {
      // SECTOR LEVELS (plan 3b): a wall stops the drop dead (x/z) — it runs down the wall to that wall's floor; the
      // floor is read under the drop NOW, so a drop off a ledge falls to the lower floor.
      const b = ground.bounce(PREV, d.pos, d.vel, 0, 0);
      if (b) { d.pos[0] = b.pos[0]; d.pos[2] = b.pos[2]; d.vel[0] = 0; d.vel[2] = 0; }
      const f = landingFloor(ground, d.pos[0], d.pos[2], d.floorY ?? 0);
      d.floorY = f;
      if (d.pos[1] <= f + 0.01 || d.age >= d.life) {
        if (d.kind !== 'mist') stamp(sim, d.pos, rng, d.kind, ground, f);
        sim.droplets.splice(i, 1);
      }
    } else if (d.pos[1] <= 0.01 || d.age >= d.life) {
      // … unchanged …
    }
```

  - `stamp(sim, at, rng, kind = 'drop', ground?: DebrisGround, floorY = 0)`: draw every random number in the old
    order whether or not a splat is kept, and skip a splat whose jittered centre is over a different floor:

```ts
function stamp(sim: BloodSim, at: Vec3, rng: () => number, kind: 'drop' | 'scrap' = 'drop',
  ground?: DebrisGround, floorY = 0): void {
  const scale = kind === 'scrap' ? SCRAP_TUNING.splatScale : 1;
  const ox = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const oz = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const keep = (x: number, z: number) => !ground || Math.abs(landingFloor(ground, x, z, NaN) - floorY) <= 0.02;
  const x1 = at[0] + ox, z1 = at[2] + oz;
  const size1 = (0.12 + rng() * 0.18) * scale, yaw1 = rng() * Math.PI * 2;
  if (keep(x1, z1)) sim.splats.push({ pos: [x1, floorY, z1], size: size1, yaw: yaw1 });
  if (rng() < BLOOD_SPLAT.secondChance / 0x10000) {
    const x2 = at[0] - ox * 0.6, z2 = at[2] - oz * 0.6;
    const size2 = (0.1 + rng() * 0.12) * scale, yaw2 = rng() * Math.PI * 2;
    if (keep(x2, z2)) sim.splats.push({ pos: [x2, floorY, z2], size: size2, yaw: yaw2 });
  }
  while (sim.splats.length > MAX_SPLATS) sim.splats.shift();
}
```

    (Same draws, same order, same values: the room path's splats are bit-identical, `floorY` defaults to 0.)
- [ ] **Step 3: Draw splats at their y.** `blood-view-gpu.ts` splat loop: `p.set(sp.pos[0], sp.pos[1] + 0.005 + i * 0.0001, sp.pos[2])`;
  `blood-view.ts` the same line; `goo-layer.ts`: `const x = sp.pos[0], y = sp.pos[1] + 0.02, z = sp.pos[2];` (~2431)
  and `tooSmall(gr / 2, sp.pos[0], sp.pos[1] + 0.02, sp.pos[2])` / `p.set(sp.pos[0], sp.pos[1] + 0.02, sp.pos[2])`
  (~2507). (`0 + 0.005` is exactly `0.005`: room levels draw the same matrices.)
- [ ] **Step 4: Wire** `game-tick.ts` ~1243: `stepBlood(ctx.vfx.bloodSim, cdt, rngStreams.bleed, undefined, ctx.vfx.surfaceBlood?.enabled ? ctx.vfx.surfaceBlood : undefined, debrisGround(ctx) ?? undefined);`
- [ ] **Step 5:** `npx vitest run src/lab/sdf-zombie/blood-sim.test.ts src/lab/sdf-zombie/webgpu/goo-layer*.test.ts src/lab/sdf-zombie/webgpu/blood*.test.ts`
  — PASS, the byte-identity pins unchanged; typecheck.
- [ ] **Step 6: Commit** `feat(gore): blood drops and floor splats on the sector floor under them; drops stop at walls`.

---

## Task 4: Entrails on the floor under each node

**Files:** `src/lab/sdf-zombie/entrails.ts`, `src/lab/sdf-zombie/entrails.test.ts`, `src/lab/sdf-zombie/webgpu/game-bleed.ts`.

Spawns: a rope's nodes are seeded with the body's floor as `floorY`, and each node's start is clamped inside the level
with the Task 2 spawn clamp (`clampSpawnInside` / `sectorHitBetween` from the body centre), per the decision "Spawns
start inside the level".

- [ ] **Step 1: Failing test** in `entrails.test.ts`:

```ts
import type { DebrisGround } from './debris-ground';

describe('stepGutChain on a debris ground', () => {
  it('a detached rope lies on the floor under each node: on the ledge and hanging off it', () => {
    const ledge: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };
    let c = detachGutChain(makeGutChain([-0.1, 1.3, 0] /* , the file's usual args */));
    for (let i = 0; i < 600 && !c.settled; i++) c = stepGutChain(c, 1 / 60, ledge);
    for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(ledge.floorAt(n.pos[0], n.pos[2]) - 1e-9);
    expect(Math.min(...c.nodes.map((n) => n.pos[1]))).toBeLessThan(1);           // something hangs past the edge
  });
  it('without a ground the floor is y = 0 as before', () => {
    let a = detachGutChain(makeGutChain([0, 0.5, 0] /* , … */)), b = a;
    for (let i = 0; i < 120; i++) { a = stepGutChain(a, 1 / 60); b = stepGutChain(b, 1 / 60, undefined); }
    expect(b).toEqual(a);
  });
});
```

  (Copy `makeGutChain`'s argument list from an existing test in the file.) Run — FAIL.

- [ ] **Step 2: Implement.** `stepGutChain(c: GutChain, dt: number, ground?: DebrisGround)`. After the integration
  loop, before the constraint iterations, when `ground`: `const base = landingFloor(ground, nodes[0]!.pos[0], nodes[0]!.pos[2], 0);`
  and `const floors = ground ? nodes.map(n => landingFloor(ground, n.pos[0], n.pos[2], base)) : null;` (once per
  step — nodes move millimetres inside the iterations; `base` likewise only when `ground`). The floor line inside the
  loop:

```ts
    // Floor, inside the constraint loop so a resting chain does not jitter. Sector levels: the floor under each node.
    if (floors) { for (let i = 0; i < nodes.length; i++) { const n = nodes[i]!, f = floors[i]!; if (n.pos[1] < f) n.pos = [n.pos[0], f, n.pos[2]]; } }
    else for (const n of nodes) if (n.pos[1] < 0) n.pos = [n.pos[0], 0, n.pos[2]];
```

- [ ] **Step 3: Wire** `game-bleed.ts` `stepGutRopes`: `stepGutChain(entry.chain, dt, debrisGround(ctx) ?? undefined)`.
- [ ] **Step 4:** `npx vitest run src/lab/sdf-zombie/entrails*.test.ts` — PASS; typecheck. **Commit**
  `feat(gore): entrails lie on the sector floor under each node`.

---

## Task 5: Dropped guns, shed kit pieces and casings

**Files:** `src/lab/sdf-zombie/prop-drop.ts` (+ `prop-drop.test.ts`), `src/lab/sdf-zombie/webgpu/held-prop.ts`,
`src/lab/sdf-zombie/webgpu/shotgun-casings.ts` (+ `shotgun-casings.test.ts`), `src/lab/sdf-zombie/webgpu/kit-damage.ts`,
`src/lab/sdf-zombie/webgpu/kit-overlay.ts`, `src/lab/sdf-zombie/webgpu/character-view.ts`, `src/lab/sdf-zombie/webgpu/game-spawn.ts`.
Off-limits: `game-actor.ts` (Task 6).

Spawns: a released gun, a shed kit piece and an ejected casing seed `floorY` with the body's (or the shooter's) floor,
and their start is clamped inside the level with the Task 2 spawn clamp from the body centre, per the decision
"Spawns start inside the level". Casings pass radius 0 (the 1 cm skin covers them).

- [ ] **Step 1: Failing tests.** `prop-drop.test.ts`:

```ts
import type { DebrisGround } from './debris-ground';
const LEDGE: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };

it('a released gun rests on the floor under it and falls off a ledge', () => {
  let s = releaseProp([-0.2, 1.6, 0], [0, 0, 0, 1], [1.2, 0, 0], 3);
  for (let i = 0; i < 300 && !s.resting; i++) s = stepDrop(s, 1 / 60, 0, LEDGE);
  expect(s.resting).toBe(true);
  expect(s.pos[0]).toBeGreaterThan(0);
  expect(s.pos[1]).toBeCloseTo(DROP.floorPad, 6);
  expect(s.floorY).toBe(0);
});
it('a gun dropped on the ledge rests on it', () => {
  let s = releaseProp([-0.6, 1.6, 0], [0, 0, 0, 1], [0, 0, 0], 3);
  for (let i = 0; i < 300 && !s.resting; i++) s = stepDrop(s, 1 / 60, 0, LEDGE);
  expect(s.pos[1]).toBeCloseTo(1 + DROP.floorPad, 6);
});
it('without a ground: no floorY key', () => {
  const s = stepDrop(releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 0, 0], 3), 1 / 60, 0);
  expect('floorY' in s).toBe(false);
});
```

  `shotgun-casings.test.ts`, in the 'spent shell debris' block:

```ts
it('rests on the floor under the shell (sector levels)', () => {
  const cases = createShotgunCasings(4);
  const ground = { floorAt: (x: number) => (x < 2.3 ? 0.5 : -1), bounce: () => null };
  cases.eject([2, 1.4, 3], [1, 0, 0]);
  for (let i = 0; i < 360; i++) cases.step(1 / 60, ground);
  const [s] = cases.debris();
  expect(s!.resting).toBe(true);
  expect(s!.pos[1]).toBeCloseTo(ground.floorAt(s!.pos[0]) + .012, 5);
  cases.dispose();
});
```

  Run `npx vitest run src/lab/sdf-zombie/prop-drop.test.ts src/lab/sdf-zombie/webgpu/shotgun-casings.test.ts` — FAIL.

- [ ] **Step 2: `prop-drop.ts`.** `DropState` gains `floorY?: number`. `stepDrop(s, dt, floorY, ground?: DebrisGround)`:

```ts
  let vel: Vec3 = [s.vel[0], s.vel[1] + DROP.gravity * dt, s.vel[2]];
  let pos = add(s.pos, scale(vel, dt));
  if (ground) {
    const b = ground.bounce(s.pos, pos, vel, DROP.restitution, DROP.friction, DROP.radius /* a half-extent; add to DROP */);
    if (b) { pos = b.pos; vel = b.vel; }
  }
  const base = ground ? landingFloor(ground, pos[0], pos[2], s.floorY ?? floorY) : floorY;
  const rest = base + DROP.floorPad;
  const keep = ground ? { floorY: base } : {};
  // … the rest unchanged, both returns spread `...keep` …
```

- [ ] **Step 3: `held-prop.ts`.** `step(dt, floorY, ground?)` passes `ground` to `stepDrop`; add to the interface
  `/** The released prop's pose (null while held) and whether it is resting — the debris seam. */ dropped(): { pos: Vec3; resting: boolean } | null;`
  returning `drop ? { pos: [...drop.pos], resting: drop.resting } : null`.
- [ ] **Step 4: `shotgun-casings.ts`.** `Shell` gains `floorY: number` (0 at eject). `step(dt: number, ground?: DebrisGround)`;
  in the sub-step, keep the start (`const sx = shell.pos.x, sy = shell.pos.y, sz = shell.pos.z;` before
  `addScaledVector`) and then:

```ts
          let floor = 0;
          if (ground) {
            const b = ground.bounce([sx, sy, sz], [shell.pos.x, shell.pos.y, shell.pos.z],
              [shell.vel.x, shell.vel.y, shell.vel.z], .3, .58);
            if (b) { shell.pos.set(b.pos[0], b.pos[1], b.pos[2]); shell.vel.set(b.vel[0], b.vel[1], b.vel[2]); }
            floor = shell.floorY = landingFloor(ground, shell.pos.x, shell.pos.z, shell.floorY);
          }
          if (shell.pos.y <= floor + .012) {
            shell.pos.y = floor + .012;
```

  and add `debris(): { pos: Vec3; resting: boolean }[]` returning every live shell's position and flag.
- [ ] **Step 5: `kit-damage.ts` / `kit-overlay.ts`.** `update(body, wounds, bodyYaw, dt, armor?, ground?: DebrisGround | null)`;
  each drop keeps `floorY` (init 0); in the drop loop keep the centre before the move, apply
  `ground.bounce(start, centre, velocity, .22, .6, radius)` (radius: the piece's bounds half-extent in x/z) to `d.mesh.position` / `d.velocity` when given, then

```ts
        const lift = ground ? (d.floorY = landingFloor(ground, d.mesh.position.x, d.mesh.position.z, d.floorY)) + .01 : .01;
        if (bounds.min.y < lift) {
          d.mesh.position.y += lift - bounds.min.y;
```

  and add `debris(): { x: number; z: number; minY: number; resting: boolean }[]` (the world bounds' min y per drop).
  `kit-overlay.ts`: the `pose` damage option gains `ground?: DebrisGround | null`, passed through to `update`; expose
  `debris()` from the damage view (empty when none).
- [ ] **Step 6: `character-view.ts`.** `CharacterViewOpts` gains `/** SECTOR levels: what dropped equipment lands on
  (plan 3b). Absent on room levels: the y = 0 plane. */ ground?: DebrisGround;`. In `pose`:
  `casings?.step(dt, opts.ground);`, `heldProp.step(Math.min(dt, 1 / 30), 0, opts.ground);`, and the kit's damage
  option `ground: opts.ground ?? null`. `CharacterView` gains

```ts
  /** What this body has dropped (the debris seam): casings, the released gun, shed kit pieces. */
  debris(): { casings: { pos: Vec3; resting: boolean }[]; prop: { pos: Vec3; resting: boolean } | null;
    kit: { x: number; z: number; minY: number; resting: boolean }[] };
```

- [ ] **Step 7: `game-spawn.ts`** `createCharacterView({ …, ...(sectorGround ? { ground: debrisGround(ctx)! } : {}) })`
  (`sectorGround` is already computed at ~91).
- [ ] **Step 8:** `npx vitest run src/lab/sdf-zombie/prop-drop.test.ts src/lab/sdf-zombie/webgpu/shotgun-casings.test.ts src/lab/sdf-zombie/webgpu/held-prop*.test.ts src/lab/sdf-zombie/webgpu/kit-damage*.test.ts src/lab/sdf-zombie/webgpu/character-view*.test.ts`
  (what exists) — PASS; typecheck. **Commit** `feat(gore): dropped guns, shed kit and casings land on the sector floor and stop at walls`.

---

## Task 6: Bodies fall off ledges; corpses meet the floor under each point

**Files:** `src/lab/sdf-zombie/motion.ts`, `src/lab/sdf-zombie/motion-floor.test.ts`, `src/lab/sdf-zombie/rig.ts`
(+ `rig.test.ts`), `src/lab/sdf-zombie/webgpu/game-actor.ts`.

- [ ] **Step 1: Failing tests** in `motion-floor.test.ts` (it already has the joints helpers and digests):
  - **The fall:** a zombie stepped with `floorAt: () => 0` for 1 s, then `floorAt: () => -3`: `state.floorY` reaches
    −3 within 0.85 s (a free fall of 3 m takes 0.78 s; easing at 6 m/s would take 0.5 s per 3 m — assert the
    trajectory instead: after 0.2 s the drop is < 0.3 m (gravity ½·9.81·0.2² = 0.196), after 0.9 s it is exactly −3
    and `state.floorVel` is 0).
  - **A step down still eases:** `floorAt` 0 → −0.5: `floorY` moves at ≤ 6 m/s and `floorVel` stays 0.
  - **No floorAt:** the recorded digests unchanged and `'floorVel' in state` is false.
  - **Per-point contact:** `applyFloorContact(points, 0.1, undefined, undefined, (x) => (x > 0 ? -0.9 : 0.1))` keeps a
    point at (0.5, −0.5) (it is above its own floor −0.9) and lifts a point at (−0.5, 0.05) to 0.1; with no fifth
    argument the output equals the old call's.
  In `rig.test.ts`: `constrainRigBends(state, 0, (x) => (x > 0 ? -1 : 0))` lets a forearm over x > 0 hang below 0
  (the fallback does not fire), and `constrainRigBends(state, 0)` is unchanged.
  Run `npx vitest run src/lab/sdf-zombie/motion-floor.test.ts src/lab/sdf-zombie/rig.test.ts` — FAIL.
- [ ] **Step 2: `motion.ts`.**

```ts
/** A floor drop bigger than this FALLS under gravity instead of easing (spec §6.2's step rule, 24 Doom units). */
export const FALL_DROP_M = 0.75;
export const FALL_GRAVITY = 9.81;
```

  `MotionState` gains `/** Sector levels: the body's vertical speed while it falls off a ledge (m/s, ≤ 0). Absent on
  room levels. */ floorVel?: number;`. The floor block:

```ts
  let feetY = state.floorY;
  let floorVel = state.floorVel ?? 0;
  if (cfg.floorAt) {
    const want = cfg.floorAt(wander.pos[0], wander.pos[2]);
    if (Number.isFinite(want)) {
      if (floorVel < 0 || want < feetY - FALL_DROP_M) {
        // A DROP (a ledge, a pit, a blast's knock over the edge): fall, land on the floor.
        floorVel -= FALL_GRAVITY * dt;
        feetY = Math.max(want, feetY + floorVel * dt);
        if (feetY === want) floorVel = 0;
      } else {
        const max = FLOOR_EASE_MPS * dt;
        feetY = Math.abs(want - feetY) <= max ? want : feetY + Math.sign(want - feetY) * max;
      }
    }
  }
```

  and `nextState` adds `...(cfg.floorAt ? { floorVel } : {})`. Update the `FLOOR_EASE_MPS` doc comment ("drops over
  FALL_DROP_M fall").
  `applyFloorContact(points, groundY, restitution = …, friction = …, floorAt?: (x: number, z: number) => number)`:
  `const g = floorAt ? floorAt(p.pos[0], p.pos[2]) : groundY;` and every `groundY` inside the map callback becomes `g`.
- [ ] **Step 3: `rig.ts`.** `constrainRigBends(state, floorY?, floorAt?: (x: number, z: number) => number)`:
  `const fy = floorAt ? floorAt(pos[0], pos[2]) : floorY;` and the condition reads
  `if (fy !== undefined && pos[1] < fy && mid.pos[1] >= fy)` (replace `floorY` inside that block by `fy`).
- [ ] **Step 4: `game-actor.ts`** (~1700–1708, where `f.collapsed`): on sector levels (`ground` = `opts.ground`, ~686)
  build one per-point floor and pass it to both:

```ts
      // SECTOR LEVELS (plan 3b): a corpse meets the floor under each point — an arm over a ledge hangs down it — but
      // never climbs more than FALL_DROP_M (a ledge wall is not a floor). Relative to the body's own plane f.floorY.
      const pointFloor = ground && f.collapsed ? (x: number, z: number): number => {
        const d = ground.floorAt(x, z) - state.floorY;
        return f.floorY + (!Number.isFinite(d) || d > FALL_DROP_M ? 0 : d);
      } : undefined;
      if (f.collapsed) points = applyFloorContact(points, f.floorY, undefined, undefined, pointFloor);
      // … constrainRigBends({ … }, f.collapsed ? f.floorY : undefined, pointFloor)
```

  (`state` is the actor's motion state the 3a code reads at ~1433 and ~1637 — use whatever name is in scope there.
  `actor.ts` (lab) keeps its call.)
- [ ] **Step 5:** `npx vitest run src/lab/sdf-zombie/motion*.test.ts src/lab/sdf-zombie/rig*.test.ts src/lab/sdf-zombie/collapse.test.ts src/lab/sdf-zombie/soldier-*.test.ts src/lab/sdf-zombie/webgpu/game-actor*.test.ts`
  (globs to what exists) — PASS, snapshots unchanged; `npm run test:changed`; typecheck. **Commit**
  `feat(actors): bodies fall off ledges; corpses meet the floor under each point`.

---

## Task 7: The burn pile and the blast's floor distance

**Files:** `src/lab/sdf-zombie/webgpu/game-burning.ts`, `src/lab/sdf-zombie/webgpu/game-dynamite-step.ts`.

- [ ] **Step 1: `game-burning.ts` `updateCards`** (~411–438): `const floorY = standingFloor(ctx.world.level.ground, p.pos[0], p.pos[2]);`
  (import from `./level-ground`; it returns exactly 0 on `FLAT_GROUND`) and `groundY: floorY` in BOTH the `lodFrames`
  and `cardFrames` pushes. (If `updateCards` has no `ctx` in scope, pass the ground in from the burning module's
  creator — read how `game-burning.ts` gets its other ctx state.)
- [ ] **Step 2: `game-dynamite-step.ts` `detonateAt`**: replace the `floorDistM` line and its comment:

```ts
    // The blast's height over the floor under it (sector levels: that sector's floor; room levels: y = 0, the old
    // value exactly) — the resolver's air-vs-ground burst choice.
    floorDistM: Math.max(0, at[1] - standingFloor(ctx.world.level.ground, at[0], at[2])),
```

  (`standingFloor` returns 0 on room levels, and `x - 0 === x`.)
- [ ] **Step 3:** `npx vitest run src/lab/sdf-zombie/webgpu/flame-cards.test.ts src/lab/sdf-zombie/explosion-aoe.test.ts`
  — PASS; typecheck. **Commit** `fix(levels): burn piles and blast bursts read the sector floor`.

---

## Task 8: Dynamite on sector floors and walls

**Files:** `src/lab/sdf-zombie/dynamite-flight.ts` (+ `dynamite-flight.test.ts`), `src/lab/sdf-zombie/webgpu/game-dynamite-step.ts`,
`src/lab/sdf-zombie/webgpu/game-dynamite-throw.ts`.

- [ ] **Step 1: Failing tests** in `dynamite-flight.test.ts`:

```ts
import type { DebrisGround } from './debris-ground';
const LEDGE: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };
const fly = (s: FlightState, sec: number, world: FlightWorld) => { for (let i = 0; i < sec * 60 && !detonated(s); i++) s = stepFlight(s, 1 / 60, null, world); return s; };

it('a bundle rolls off a ledge and rests on the lower floor', () => {
  const s = fly(makeFlight([-0.5, 1.2, 0], [2, 0, 0], { impactMode: false, fuseSec: 30 }), 4, { ground: LEDGE });
  expect(s.pos[0]).toBeGreaterThan(0);
  expect(s.pos[1]).toBe(0);
  expect(s.floorY).toBe(0);
});
it('a bundle lobbed onto the ledge rests on it', () => {
  const s = fly(makeFlight([-2, 3, 0], [0.5, 0, 0], { impactMode: false, fuseSec: 30 }), 4, { ground: LEDGE });
  expect(s.pos[1]).toBe(1);
});
it('a thrown bundle bounces off a sector wall', () => {
  const wall: DebrisGround = { floorAt: () => 0, bounce: (prev, next, vel, r) => (prev[0] < 1 && next[0] >= 1
    ? { pos: [0.99, next[1], next[2]], vel: [-vel[0] * r, vel[1], vel[2]], normal: [-1, 0, 0] } : null) };
  let s = makeFlight([0, 1, 0], [25, 2, 0], { impactMode: false, fuseSec: 30 });
  for (let i = 0; i < 120; i++) { s = stepFlight(s, 1 / 60, null, { ground: wall }); expect(s.pos[0]).toBeLessThan(1); }
});
it('no ground: no floorY key, the same flight as before', () => {
  const a = fly(makeFlight([0, 1, 0], [3, 2, 1]), 2, {});
  expect('floorY' in a).toBe(false);
});
```

  Run — FAIL.

- [ ] **Step 2: `dynamite-flight.ts`.** `FlightWorld` gains `/** SECTOR levels (plan 3b): floor under the bundle and the
  sector walls. Absent: the y = 0 plane. */ ground?: DebrisGround;`; `FlightState` gains `floorY?: number`. In
  `stepSub`, after drag and BEFORE the floor block:

```ts
  const ground = world.ground;
  let hit = false;
  const contactSpeeds: number[] = [];
  if (ground) {
    const b = ground.bounce(s.pos, pos, vel, T.elastic, 1, radius /* the bundle's collision radius */);
    if (b) {
      pos[0] = b.pos[0]; pos[2] = b.pos[2]; vel[0] = b.vel[0]; vel[2] = b.vel[2];
      hit = true;
      contactSpeeds.push(Math.abs(vel[0] * b.normal[0] + vel[2] * b.normal[2]));
    }
  }
  const floor = ground ? landingFloor(ground, pos[0], pos[2], s.floorY ?? 0) : 0;
  if (pos[1] <= floor) {
    pos[1] = floor;
    // … the old floor body …
```

  (move the existing `let hit` / `contactSpeeds` declarations up to here; the rest unchanged) and every return of
  `stepSub` spreads `...(ground ? { floorY: floor } : {})`. Update the `FlightState.pos` doc ("the floor under it").
- [ ] **Step 3: `game-dynamite-step.ts` `stepDynamite`:**
  `const g = debrisGround(ctx); const world = { colliders: ctx.world.colliders, ceilM: ceilingAt(…), ...(g ? { ground: g } : {}) };`
- [ ] **Step 4: `game-dynamite-throw.ts` `throwBundle`:** on a sector level the origin must be in the open from the
  eye (the hand can sit past a wall the player hugs — the same trap 3a fixed for rounds):

```ts
  // SECTOR LEVELS: a hand past the wall the player hugs would start the bundle in the void. Start it at the wall,
  // 5 cm back toward the eye.
  const eye = eyeOf(ctx.player.player);
  const wallHit = sectorHitBetween(ctx, eye, origin);
  if (wallHit) {
    const d = Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) || 1;
    const back = Math.min(0.05 / d, wallHit.t);
    for (let k = 0; k < 3; k++) origin[k] = eye[k]! + (origin[k]! - eye[k]!) * (wallHit.t - back);
  }
```

  (Adapt to `origin`'s actual type/mutability in `throwBundle`.)
- [ ] **Step 5:** `npx vitest run src/lab/sdf-zombie/dynamite-flight.test.ts src/lab/sdf-zombie/webgpu/game-state-dynamite.test.ts`
  — PASS; typecheck. **Commit** `feat(levels): dynamite bounces off sector walls and rests on the floor under it`.

---

## Task 9: Debris seams

**Files:** create `src/lab/sdf-zombie/webgpu/game-seams-debris.ts`; modify `game-main.ts` (the seams list, ~5921),
`game-seams-spawn-goo.ts` (`spawnCrowd`).

- [ ] **Step 1: `createDebrisSeams(ctx)`** (pattern: `game-seams-dynamite.ts`), plain data only:

```ts
export function createDebrisSeams(ctx: GameContext) {
  return {
    /** Every loose piece and where it rests (plan 3b gate): compare each y with __sdfGame.ground(x, z).floor. */
    debris: () => ({
      chunks: ctx.bake.liveChunks.map(c => ({ id: c.id, tag: c.tag ?? null, pos: [...c.state.pos], settled: chunkSettled(c.state),
        support: chunkSupportOffset(c.state), floorY: c.state.floorY ?? 0 })),
      meshGibs: ctx.gibs.meshGibs.map(g => ({ id: g.id ?? -1, tag: g.tag, pos: [...g.state.pos], settled: chunkSettled(g.state),
        support: chunkSupportOffset(g.state), floorY: g.state.floorY ?? 0 })),
      sprites: spritePieceStates(ctx.vfx.spritePieces),
      splats: ctx.vfx.bloodSim.splats.map(s => [...s.pos]),
      droplets: ctx.vfx.bloodSim.droplets.filter(d => d.kind !== 'gut').length,
      guts: [...ctx.vfx.gutRopes.entries()].map(([id, e]) => ({ actor: id, settled: e.chain.settled,
        nodes: e.chain.nodes.map(n => [...n.pos]) })),
      equipment: ctx.world.actors.map(a => ({ actor: a.id, ...(a.character?.debris() ?? { casings: [], prop: null, kit: [] }) })),
      bundles: ctx.bake.liveBundles.map(b => ({ pos: [...b.state.pos], vel: [...b.state.vel], floorY: b.state.floorY ?? 0 })),
      pickups: ctx.world.loop ? [...ctx.world.loop.meshes.entries()].map(([id, m]) => ({ id, pos: [m.position.x, m.position.y, m.position.z] })) : [],
    }),
    /** Collapse an actor where it stands (a corpse: its gun drops, its kit falls with it). */
    collapseActor: (id: number) => {
      const a = ctx.world.actors.find(q => q.id === id);
      if (!a) return false;
      a.blast({ wounds: [], meterCredit: 0, impulse: null, forceCollapse: true });
      return true;
    },
    /** A blood burst at a point (the gib burst's droplets, rngStreams.bleed). */
    bloodBurstAt: (x: number, y: number, z: number) => { burst(ctx.vfx.bloodSim, [x, y, z], rngStreams.bleed); return ctx.vfx.bloodSim.droplets.length; },
    /** A dynamite bundle in flight with no prop (fuse in seconds; impact detonation off). */
    throwTestBundle: (x: number, y: number, z: number, vx: number, vy: number, vz: number, fuseSec = 6) => {
      ctx.bake.liveBundles.push({ state: makeFlight([x, y, z], [vx, vy, vz], { impactMode: false, fuseSec }) } as LiveBundle);
      return ctx.bake.liveBundles.length;
    },
  };
}
```

  (Check the exact field names: `a.character` (the actor's `CharacterView`, may be named differently — find what
  `game-actor.ts` exposes), `LiveBundle`'s shape in `game-state-bake.ts` (make `prop` optional if it is not), the gut
  rope map's value type.) Register it in `game-main.ts`'s seams list beside `createDynamiteSeams(ctx)`.
- [ ] **Step 2: `spawnCrowd`** (`game-seams-spawn-goo.ts` ~226): `p0 = [cxs, standingFloor(ctx.world.level.ground, cxs, czs), czs];`
  and the same for the no-region default spawn point if it writes y = 0 (`standingFloor` is 0 on room levels).
- [ ] **Step 3:** typecheck; `npm test -- game-context-coverage`; boot the fixture once with a scratch CDP driver (or
  the doom gate with `DOOM_GATE_ONLY_FIXTURE=1`) and call `__sdfGame.debris()` — it returns plain data. **Commit**
  `feat(levels): debris seams — where every loose piece rests`.

---

## Task 10: Barrels in the sector format and the converter

**Files:** `src/lab/sdf-zombie/webgpu/level-def.ts`, `src/lab/sdf-zombie/webgpu/sector-json.ts`,
`src/lab/sdf-zombie/webgpu/sector-json.test.ts` (or the file that tests `parseSectorLevel`),
`public/assets/levels/fixtures/sectors.level.json`, `scripts/levels/doom_tables.py`, `scripts/levels/doom_map.py`,
`scripts/tests/test_doom_map.py`.

- [ ] **Step 1 (TS, test first):** tests on the fixture: the parsed level has
  `barrels` = the five below, in file order; a barrel in the column (`[0, 0, -4]`) is refused with
  `barrel b9: must stand in a sector`; a duplicate id is refused (`barrel b1: duplicate id`); an unknown key on a
  barrel is refused; a file with no `barrels` key parses with `barrels` absent (`'barrels' in L === false`).
- [ ] **Step 2 (TS):** `level-def.ts`: `export interface BarrelDef { id: string; pos: Vec3 }` and on `LevelDef`
  `/** Sector levels (plan 3b): exploding barrels, feet on their floor. Absent when the file has none. */ barrels?: BarrelDef[];`
  `sector-json.ts`: `'barrels'` joins `TOP` (not `SHARED` — the room parser never sees it); parse an array of
  `{ id: string, pos: [x, y, z] }` (unknown keys, non-string ids, bad pos → errors), duplicates refused, and in the
  "markers must stand in a sector" block: `listed(j.barrels).forEach((o, i) => { if (inVoid(posOf(o))) errors.push(\`barrel ${label('barrel', o, i)}: must stand in a sector\`); });`
  Return `{ ...base, requires, sectors: map, ...(barrels.length ? { barrels } : {}) }`.
- [ ] **Step 3: The fixture** gains (clear of the gate's walks: the step walk at x 2.5, the pit walk at z −6, the column
  approach from the north):

```json
  "barrels": [
    { "id": "b1", "pos": [6.2, -1, -7.0] },
    { "id": "b2", "pos": [7.3, -1, -7.0] },
    { "id": "b3", "pos": [7.3, -1, -0.8] },
    { "id": "b4", "pos": [-3.0, 1.5, -15.0] },
    { "id": "b5", "pos": [0.0, 0, -5.6] }
  ]
```

  (b1–b2 chain, 1.1 m apart; b3 is 6.2 m from b2, outside the 3.5 m catch; b4 stands on the C ledge; b5 is south of
  the column, so a player north of it is shielded.)
- [ ] **Step 4 (Python, test first)** in `test_doom_map.py`. Append two things to `build_wad()`'s list (at the END, so
  every existing thing index and test stays put): `(64, 64, 0, 2035, 1)` — 8, a barrel in A on EASY only — and
  `(96, 96, 0, 2035, 23)` — 9, a multiplayer-only barrel in A. Then:
  - default skill 4: `out["barrels"] == [{"id": "b6", "pos": [-1.0, 0.0, 3.0]}, {"id": "b8", "pos": [0.0, 0.0, 2.0]}]`
    — the easy-only barrel is placed (barrels ignore skill), the multiplayer-only one is not;
  - `convert(tmp_path, skill=1)["barrels"]` is the same list (skill never changes barrels);
  - `test_summary_counts_kinds_and_skipped_things` now expects `stats["skipped_types"] == {}`, `stats["barrels"] == 2`,
    `stats["not_this_skill"] == 1` (the imp only: barrels never count there) and `stats["multiplayer_only"] == 2`;
  - a barrel outside every sector counts in `in_no_sector`; a WAD with no barrels has no `"barrels"` key.
  Run `python3 -m pytest scripts/tests/test_doom_map.py -q` — FAIL.
- [ ] **Step 5 (Python):** `doom_tables.py`: `THING_BARRELS = {2035}  # Doom's exploding barrel -> our toxic drum (plan 3b)`.
  `doom_map.py` in the things loop: compute `is_barrel = t["type"] in THING_BARRELS` BEFORE the flag tests; the
  multiplayer-only test stays first and applies to barrels; the skill test becomes
  `if not is_barrel and not t["flags"] & skill_bit:` (barrels are scenery: every skill); the type skip test becomes
  `if not is_spawn and not is_barrel and t["type"] not in THING_PICKUPS`; after the sector lookup,
  `if is_barrel: barrels.append({"id": f"b{ti}", "pos": pos}); continue`. `level["barrels"] = barrels` when non-empty;
  `stats["barrels"] = len(barrels)`; the module docstring and `main()`'s summary print mention barrels.
- [ ] **Step 6:** pytest PASS; regenerate E1M1
  (`python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`)
  and parse it with `npx tsx -e` + `parseSectorLevel` (as plan 1 did) — it must pass. **Report the barrel count**: the 3a
  summary skipped six 2035s at skill 4; with skill ignored the owner expects 8 — report the count and how many
  multiplayer-only barrels were still skipped (if that leaves fewer than 8, say so in the notes). `npx vitest run` the sector-json tests; typecheck. **Commit** (no generated files)
  `feat(levels): barrels in the sector format; the converter keeps Doom's barrels`.

---

## Task 11: Barrel rules and the player's blast share (pure)

**Files:** create `src/lab/sdf-zombie/webgpu/barrel-state.ts` (+ `barrel-state.test.ts`),
`src/lab/sdf-zombie/blast-player.ts` (+ `blast-player.test.ts`).

- [ ] **Step 1: Failing tests** `blast-player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BLAST_PROFILES, blastFalloffFor, playerBlastDamage } from './blast-player';
import { ROCKET, blastPlayerDamage } from './rockets';

describe('playerBlastDamage', () => {
  it('is the rocket rule exactly with the rocket numbers', () => {
    const rocket = { maxDamage: ROCKET.blastPlayerDamage, radiusM: ROCKET.blastPlayerRadius };
    for (let d = 0; d <= 4; d += 0.05) expect(playerBlastDamage(d, rocket)).toBe(blastPlayerDamage(d));
  });
  it('a barrel: 55 at the centre, quadratic, 0 from 4 m', () => {
    expect(playerBlastDamage(0, BLAST_PROFILES.barrel)).toBe(55);
    expect(playerBlastDamage(2, BLAST_PROFILES.barrel)).toBe(Math.round(55 * 0.25));
    expect(playerBlastDamage(4, BLAST_PROFILES.barrel)).toBe(0);
    expect(blastFalloffFor(9, BLAST_PROFILES.barrel)).toBe(0);
  });
});
```

  `barrel-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BARREL, barrelCentre, catchBlast, chainDelay, hitBarrel, makeBarrels, segmentHitsBarrel, stepBarrels } from './barrel-state';

const two = () => makeBarrels([{ id: 'b1', pos: [0, 0, 0] }, { id: 'b2', pos: [1.1, 0, 0] }, { id: 'b3', pos: [9, 0, 0] }]);

describe('barrels', () => {
  it('hits take HP; at 0 the barrel is lit with no delay and goes up on the next step', () => {
    let [b] = two();
    b = hitBarrel(b!, 'pellet'); expect(b.hp).toBe(BARREL.hp - BARREL.damage.pellet); expect(b.phase).toBe('intact');
    b = hitBarrel(b, 'slug'); expect(b.phase).toBe('lit'); expect(b.fuse).toBe(0);
    const s = stepBarrels([b], 1 / 60);
    expect(s.detonations).toEqual([{ id: 'b1', at: barrelCentre(b) }]);
    expect(s.barrels[0]!.phase).toBe('gone');
    expect(hitBarrel(s.barrels[0]!, 'slug')).toBe(s.barrels[0]);              // a gone barrel ignores hits
  });
  it('a blast lights barrels in reach after 0.1–0.3 s, deterministically; far ones stay', () => {
    const lit = catchBlast(two(), barrelCentre(two()[0]!), 1);
    expect(lit[0]!.phase).toBe('lit'); expect(lit[1]!.phase).toBe('lit'); expect(lit[2]!.phase).toBe('intact');
    for (const b of lit.slice(0, 2)) { expect(b.fuse).toBeGreaterThanOrEqual(0.1); expect(b.fuse).toBeLessThanOrEqual(0.3); }
    expect(lit[1]!.fuse).toBe(chainDelay('b2', 1));
    expect(catchBlast(two(), [0, 0.5, 0], 1)).toEqual(lit);
  });
  it('a shielded barrel does not catch', () => {
    const lit = catchBlast(two(), [0, 0.5, 0], 1, (_a, b) => b[0] > 1);
    expect(lit[1]!.phase).toBe('intact');
  });
  it('a chain ripples: b1 goes up, b2 a delay later', () => {
    let bs = two().map((b, i) => (i === 0 ? hitBarrel(b, 'slug') : b));
    let t = 0; const log: [string, number][] = []; let blast = 0;
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      const s = stepBarrels(bs, 1 / 60); bs = s.barrels;
      for (const d of s.detonations) { log.push([d.id, t]); bs = catchBlast(bs, d.at, ++blast); }
    }
    expect(log.map((l) => l[0])).toEqual(['b1', 'b2']);
    expect(log[1]![1] - log[0]![1]).toBeGreaterThanOrEqual(0.1 - 1 / 60);
    expect(log[1]![1] - log[0]![1]).toBeLessThanOrEqual(0.3 + 1 / 60);
  });
  it('segment vs drum: side, over the top, down into the lid, short', () => {
    const [b] = two();
    expect(segmentHitsBarrel([-2, 0.5, 0], [2, 0.5, 0], b!)).toBeCloseTo((2 - BARREL.radiusM) / 4, 9);
    expect(segmentHitsBarrel([-2, 1.2, 0], [2, 1.2, 0], b!)).toBeNull();
    expect(segmentHitsBarrel([0, 2, 0], [0, 0.5, 0], b!)).toBeCloseTo((2 - BARREL.heightM) / 1.5, 9);
    expect(segmentHitsBarrel([-2, 0.5, 0], [-1, 0.5, 0], b!)).toBeNull();
    expect(segmentHitsBarrel([0, 0.5, 0], [2, 0.5, 0], b!)).toBe(0);           // starts inside
  });
});
```

  Run `npx vitest run src/lab/sdf-zombie/blast-player.test.ts src/lab/sdf-zombie/webgpu/barrel-state.test.ts` — FAIL.

- [ ] **Step 2: Implement `blast-player.ts`:**

```ts
// src/lab/sdf-zombie/blast-player.ts
//
// THE PLAYER'S SHARE OF A BLAST (plan 2026-10-25-sector-levels-3b): the rocket's rule (rockets.ts blastFalloff —
// 1 at the epicentre, quadratic to 0 at the radius) for any blast with a profile. Rockets keep their own functions
// (proven equal in the test); barrels use BLAST_PROFILES.barrel. Dynamite has no profile: it does not hurt the
// player — enemies only (owner, 2026-10-25).
//
// Pure: no three.js, no DOM.
import type { Vec3 } from './types';

export interface BlastProfile { maxDamage: number; radiusM: number }

export const BLAST_PROFILES = {
  /** Doom's barrel kills at point-blank; ours takes half the player's 100 and some (owner may retune). */
  barrel: { maxDamage: 55, radiusM: 4.0 },
} as const satisfies Record<string, BlastProfile>;

export function blastFalloffFor(dist: number, p: BlastProfile): number {
  const u = Math.max(0, 1 - dist / p.radiusM);
  return u * u;
}

export function playerBlastDamage(dist: number, p: BlastProfile): number {
  return Math.round(p.maxDamage * blastFalloffFor(dist, p));
}

/** Blast → the player's capsule centre (feet + height / 2), the distance the rocket path measures. */
export function blastToPlayer(at: Vec3, feet: Vec3, height: number): number {
  return Math.hypot(feet[0] - at[0], feet[1] + height * 0.5 - at[1], feet[2] - at[2]);
}
```

- [ ] **Step 3: Implement `barrel-state.ts`:**

```ts
// src/lab/sdf-zombie/webgpu/barrel-state.ts
//
// EXPLODING BARRELS (spec 2026-10-24 §8, plan 2026-10-25-sector-levels-3b): hit points, hits by kind, the blast
// catch (every intact barrel within catchRadiusM of a blast, unless shielded, lights after a 0.1–0.3 s delay hashed
// from its id and the blast's count — deterministic, no RNG stream), the fuse step, and the segment-vs-drum test the
// projectiles use. A barrel shot to 0 HP is lit with fuse 0 and goes up on the NEXT stepBarrels — never inside the
// caller's pellet loop.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from '../types';

export const BARREL = {
  radiusM: 0.3,
  heightM: 0.95,
  hp: 20,
  damage: { pellet: 4, slug: 20, melee: 10, round: 3 },
  catchRadiusM: 3.5,
  chainDelaySec: [0.1, 0.3] as const,
} as const;

export type BarrelHitKind = keyof typeof BARREL.damage;
export type BarrelPhase = 'intact' | 'lit' | 'gone';
export interface BarrelState { id: string; pos: Vec3; hp: number; phase: BarrelPhase; fuse: number }

export function makeBarrels(defs: readonly { id: string; pos: Vec3 }[]): BarrelState[] {
  return defs.map(d => ({ id: d.id, pos: [d.pos[0], d.pos[1], d.pos[2]] as Vec3, hp: BARREL.hp, phase: 'intact' as const, fuse: 0 }));
}

/** Where a barrel explodes: the middle of the drum. */
export function barrelCentre(b: BarrelState): Vec3 {
  return [b.pos[0], b.pos[1] + BARREL.heightM * 0.5, b.pos[2]];
}

export function hitBarrel(b: BarrelState, kind: BarrelHitKind): BarrelState {
  if (b.phase !== 'intact') return b;
  const hp = b.hp - BARREL.damage[kind];
  return hp > 0 ? { ...b, hp } : { ...b, hp: 0, phase: 'lit', fuse: 0 };
}

/** FNV-1a 32 of `id:blast` mapped into chainDelaySec. */
export function chainDelay(id: string, blast: number): number {
  let h = 0x811c9dc5;
  const s = `${id}:${blast}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  const [lo, hi] = BARREL.chainDelaySec;
  return lo + (hi - lo) * (h / 0x100000000);
}

export function catchBlast(barrels: readonly BarrelState[], at: Vec3, blast: number,
  shielded?: (from: Vec3, to: Vec3) => boolean): BarrelState[] {
  return barrels.map(b => {
    if (b.phase !== 'intact') return b;
    const c = barrelCentre(b);
    if (Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) > BARREL.catchRadiusM) return b;
    if (shielded?.(at, c)) return b;
    return { ...b, phase: 'lit' as const, fuse: chainDelay(b.id, blast) };
  });
}

export function stepBarrels(barrels: readonly BarrelState[], dt: number): { barrels: BarrelState[]; detonations: { id: string; at: Vec3 }[] } {
  const detonations: { id: string; at: Vec3 }[] = [];
  const next = barrels.map(b => {
    if (b.phase !== 'lit') return b;
    const fuse = b.fuse - dt;
    if (fuse > 0) return { ...b, fuse };
    detonations.push({ id: b.id, at: barrelCentre(b) });
    return { ...b, fuse: 0, phase: 'gone' as const };
  });
  return { barrels: next, detonations };
}

/** Segment a→b vs the upright drum (radius + pad, feet to top): the first t in 0..1, 0 when a is inside, or null. */
export function segmentHitsBarrel(a: Vec3, b: Vec3, barrel: BarrelState, pad = 0): number | null {
  const r = BARREL.radiusM + pad, y0 = barrel.pos[1], y1 = barrel.pos[1] + BARREL.heightM;
  const ox = a[0] - barrel.pos[0], oz = a[2] - barrel.pos[2];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const inside = (t: number) => { const y = a[1] + dy * t; return y >= y0 && y <= y1; };
  if (ox * ox + oz * oz <= r * r && inside(0)) return 0;
  let best: number | null = null;
  const A = dx * dx + dz * dz;
  if (A > 1e-12) {
    const B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - r * r, disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1 && inside(t)) best = t;
    }
  }
  for (const capY of [y1, y0]) {
    if (Math.abs(dy) < 1e-12) continue;
    const t = (capY - a[1]) / dy;
    if (t < 0 || t > 1) continue;
    const x = ox + dx * t, z = oz + dz * t;
    if (x * x + z * z <= r * r && (best === null || t < best)) best = t;
  }
  return best;
}
```

- [ ] **Step 4:** both tests PASS; `npx vitest run src/lab/sdf-zombie/rockets.test.ts` unchanged. **Commit**
  `feat(levels): barrel rules and the player's blast share (pure)`.

---

## Task 12: The barrel's look

**Files:** create `src/lab/sdf-zombie/webgpu/barrel-look.ts` (+ `barrel-look.test.ts`),
`src/lab/sdf-zombie/webgpu/game-barrel-view.ts`.

- [ ] **Step 1: Failing tests** `barrel-look.test.ts`:
  - `barrelProfile()` returns `[r, y][]` from (0, 0) to (0, h − 0.01) (the recessed lid), every r ≤ `BARREL.radiusM`
    + 0.013, two hoop bulges (r = radius + 0.012) near y = h/3 and 2h/3, a rim lip (radius + 0.008) at the bottom and
    top, y non-decreasing except the lid recess at the top.
  - `barrelAlbedo(256, 256, 7)` is deterministic (two calls equal), RGBA length 256·256·4; rows in the hazard band
    (v 0.44..0.56) hold both yellow-ish (R > 150, G > 120, B < 80) and near-black (R+G+B < 90) pixels; the mean of
    v 0.6..0.9 has G > 1.4 R (toxic green); the mean luma of v < 0.1 is < 0.7 × that of v 0.6..0.9 (rust and grime at
    the foot).
  - `scorchAlpha(64)`: alpha 0 at the corners, > 200 at the centre, deterministic.
  - `stubProfile(seed)`: the bottom of `barrelProfile()` up to 0.18 m with a torn top (y jittered ±0.04, seeded).
- [ ] **Step 2: Implement `barrel-look.ts`** (pure: plain numbers and `Uint8Array`s). Albedo recipe: u around the drum,
  v up; base toxic green (58, 96, 28); vertical drips (a 1D hash noise in u, stretched in v) darker and greener;
  rust (88, 52, 26) mixed in by a 2D value noise weighted toward v < 0.15; the hazard band v ∈ [0.44, 0.56] as 45°
  stripes `((u * w + v * h) / 18 | 0) % 2` → (196, 160, 32) / (20, 20, 18), worn by the same noise; grime
  × (0.55 + 0.45 · √v). Use the file's own small hash (FNV or `Math.sin` fract, as `blood-surface.ts` does).
- [ ] **Step 3: `game-barrel-view.ts`** (three; the renderer side only):
  - `createBarrelView(ctx, b: BarrelDef, sector: number, zoneRoom: number)` → `{ group, drum, stub, explode(): void, dispose() }`.
  - Drum: `new THREE.LatheGeometry(barrelProfile().map(([r, y]) => new THREE.Vector2(r, y)), 28)`; material
    `MeshStandardNodeMaterial`: `map` = a `DataTexture` of `barrelAlbedo` (SRGB), `normalMap` / `roughnessMap` from
    `panelTextures('metalSheet', 31)` (`src/game/level/panel-textures.ts` — the walls' metal set, wrapped),
    metalness 0.35, roughness 0.7; `emissiveNode` = the albedo × the sector's light level, exactly as
    `game-sector-mesh.ts` `sectorMaterial` lights a wall: `texture(map).rgb.mul(fx.levels.element(int(sector)))`
    (`ctx.world.sectorFx`), so a drum in a dark sector is as dark as its walls.
  - Lid: a `CircleGeometry(radius − 0.02)` at y = h − 0.01 with an emissive nukage green
    `vec3(0.35, 0.9, 0.2).mul(0.45).mul(fx.glowGain)` (the pools' gain, so `sectorLight({ glowGain })` dims both).
  - `group.position` at the barrel's feet, a fixed yaw from the id hash; `userData.room = zoneRoom` on the meshes (the
    zone's light list applies, like a sector wall); added to `ctx.world.levelGroup`.
  - Stub: `LatheGeometry(stubProfile(seed))`, albedo × 0.25 (soot), hidden until `explode()`; `explode()` hides the
    drum and lid and shows the stub.
  - Scorch pool (one per runtime, not per barrel): `createScorchPool(ctx, n = 12)` → an `InstancedMesh` of a flat
    quad, `MeshStandardNodeMaterial` with `colorNode = vec4(0.02, 0.018, 0.016, texture(scorchAlphaTex).r.mul(0.85))`
    (alpha in `colorNode.w`), `transparent`, `depthWrite: false`; `add(x, y, z, size, yaw)` writes the next instance
    at y + 0.004 + i · 0.0002. Register it with the deferred router exactly as the blood splats are (find
    `bloodView` in `game-main.ts` and mirror its `router.register(…)` call).
- [ ] **Step 4:** tests PASS; typecheck. Visual check comes with Task 13's boot. **Commit**
  `feat(levels): the barrel's look — a toxic drum, its stub and the scorch`.

---

## Task 13: Barrels in play — spawn, explode, chain, hurt

**Files:** create `src/lab/sdf-zombie/webgpu/game-barrels.ts`, `src/lab/sdf-zombie/webgpu/game-seams-barrels.ts`;
modify `game-state-world.ts` (+ its coverage map), `game-level-rooms.ts`, `game-main.ts`, `game-tick.ts`,
`game-dynamite-step.ts`.

- [ ] **Step 1: State slice.** `game-state-world.ts`: `/** Sector levels (plan 3b): the level's barrels, or null. */ barrels: BarrelRuntime | null;`
  default `null`, and the coverage map entry `barrels: 'world.barrels'`. Run `npm test -- game-context-coverage` — PASS.
- [ ] **Step 2: `game-barrels.ts`:**

```ts
export interface BarrelRuntime {
  states: BarrelState[];
  /** Sim seconds since the level loaded; detonations counted for the chain hash. */
  clock: number;
  blasts: number;
  log: { id: string; t: number; cause: 'hit' | 'chain' }[];
  /** The live barrels' AABBs (pushed into ctx.world.colliders; removed when one goes). */
  liveBoxes(): Aabb[];
  hit(id: string, kind: BarrelHitKind): void;
  /** The nearest barrel the segment meets: its id and t, or null. */
  segmentHit(a: Vec3, b: Vec3, pad?: number): { id: string; t: number } | null;
  /** A blast at `at` (any blast: dynamite, a rocket, another barrel). */
  catchBlast(at: Vec3): void;
  step(dt: number): void;
}
export function createBarrelRuntime(ctx: GameContext, defs: readonly BarrelDef[]): BarrelRuntime
```

  - Build: `makeBarrels(defs)`; one view per barrel (`createBarrelView`; sector = `ground.sectorAt(x, z)`, zone room =
    `map.sectors[sector].zone + 1`); one scorch pool; one AABB per barrel
    `{ min: [x − r, y, z − r], max: [x + r, y + h, z + r] }` pushed into `ctx.world.colliders` (the same array object).
  - `shielded(from, to)` = `sectorHitBetween(ctx, [from[0], from[1] + 0.05, from[2]], to) !== null` (a probe 5 cm up so
    a blast on the floor is not "under" it).
  - `catchBlast(at)`: `this.blasts++`; `states = catchBlast(states, at, blasts, shielded)`; newly lit → log `chain`.
  - `hit(id, kind)`: `states[i] = hitBarrel(states[i], kind)`; newly lit → log `hit` (the detonation happens in `step`).
  - `step(dt)`: `clock += dt`; `const s = stepBarrels(states, dt)`; for each detonation `explode(id, at)`:
    1. remove its AABB from `ctx.world.colliders` (splice by identity), `view.explode()`, scorch at the feet
       (size 1.6 m, yaw from the id hash);
    2. `detonateAt(ctx, at)` — the dynamite blast: wounds, gibs, launches, light, VFX, kick (and through Step 4, the
       chain);
    3. the player: `const d = blastToPlayer(at, pp, PLAYER.height)`; unless
       `shielded(at, [pp[0], pp[1] + PLAYER.height * 0.5, pp[2]])`, `damagePlayer(ctx, playerBlastDamage(d, BLAST_PROFILES.barrel), 'blast')`
       when > 0 (god mode is handled inside `damagePlayer`);
    4. telemetry `barrel-explode` `{ id, x, y, z, t: clock }`.
  - `segmentHit`: the smallest `segmentHitsBarrel` t over intact barrels.
- [ ] **Step 3: Load and tick.** `game-main.ts` after `addSectorMeshes` (~772):
  `if (ctx.world.level.def?.barrels?.length) ctx.world.barrels = createBarrelRuntime(ctx, ctx.world.level.def.barrels);`
  The sector navigation build (~6121) takes `[...ctx.world.level.staticColliders, ...(ctx.world.barrels?.liveBoxes() ?? [])]`
  so enemies route round the drums (a destroyed drum's cells stay blocked: a known gap). `game-level-rooms.ts`
  `refreshGateColliders` appends `...(w.barrels?.liveBoxes() ?? [])`. `game-tick.ts`, after the rockets block
  (~1030): `ctx.world.barrels?.step(dt);`. Register `createBarrelSeams(ctx)` beside the debris seams:

```ts
export function createBarrelSeams(ctx: GameContext) {
  return {
    barrels: () => ctx.world.barrels?.states.map(b => ({ id: b.id, pos: [...b.pos], hp: b.hp, phase: b.phase, fuse: b.fuse })) ?? [],
    damageBarrel: (id: string, kind: BarrelHitKind = 'slug') => { ctx.world.barrels?.hit(id, kind); return ctx.world.barrels?.states.find(b => b.id === id)?.phase ?? null; },
    barrelLog: () => ctx.world.barrels ? { clock: ctx.world.barrels.clock, log: [...ctx.world.barrels.log] } : null,
  };
}
```

- [ ] **Step 4: `detonateAt` on sector levels** (`game-dynamite-step.ts`):
  - **Shielded bodies:** on a sector level the `bodies` list drops an actor whose torso centre
    (`a.posed().clusters.find(c => c.limb === 'torso')?.center`; keep the body when it has none) is behind sector
    geometry from `[at[0], at[1] + 0.05, at[2]]` (`sectorHitBetween`). Room levels: the list as today.
  - **Barrels catch:** at the end of `detonateAt`, `ctx.world.barrels?.catchBlast(at);` (a barrel's own detonation
    reaches here too, which is the chain).
- [ ] **Step 5: Boot and look.** `npm run dev` is not for this — boot the fixture headless with a scratch CDP driver
  (copy `boot()` from `scripts/sdf-game-doom-gate.mjs`): five drums standing on their floors (b4 on the C ledge),
  `__sdfGame.damageBarrel('b1')` → b1 goes, b2 follows 0.1–0.3 s later (`barrelLog()`), b3 stays; screenshots before
  and after (`.lab-tmp/doom/barrels-*.png`) — LOOK: green drums lit like the walls (not white), the hazard band
  readable, the stub and the scorch after. Cold-boot `drawOnce` vs the base branch (fresh profile each). Typecheck;
  `npm run test:changed`; `npm test -- game-context-coverage`. **Commit**
  `feat(levels): exploding barrels — the dynamite blast, chains, player damage, sector-shielded blasts`.

---

## Task 14: What sets a barrel off

**Files:** `src/lab/sdf-zombie/webgpu/game-tick.ts` (player pellets ~858–905, enemy rounds ~999),
`src/lab/sdf-zombie/webgpu/game-flail.ts` (the strike, ~510).

- [ ] **Step 1: Player pellets and slugs** (`game-tick.ts`): after the sector wall cut (`wallHit`) and BEFORE the
  collider test, mirror the wall cut so a body in front of the drum still takes the round:

```ts
      // BARRELS (plan 3b): the segment's first drum cuts it like a wall does — an actor in front still takes the
      // round (the actor test below runs on the cut segment); otherwise the drum takes it after the actor test.
      let barrelHit: string | null = null;
      if (!dead && ctx.world.barrels) {
        const bh = ctx.world.barrels.segmentHit(from, p.pos, p.radius);
        if (bh) {
          p.pos = [from[0] + (p.pos[0] - from[0]) * bh.t, from[1] + (p.pos[1] - from[1]) * bh.t, from[2] + (p.pos[2] - from[2]) * bh.t];
          barrelHit = bh.id;
        }
      }
```

  The collider point test is skipped when `barrelHit` (the cut end sits on the drum's box). After the actor block: if
  no actor was hit and `barrelHit`, `ctx.world.barrels!.hit(barrelHit, p.kind === 'slug' ? 'slug' : 'pellet'); dead = true;`
  (keep the existing order of the death/splice code — read the block first).
- [ ] **Step 2: Enemy rounds** (~999): before the colliders test,
  `const bh = ctx.world.barrels?.segmentHit(start, end, 0.02); if (bh) { ctx.world.barrels!.hit(bh.id, 'round'); <remove the round as a wall hit does>; continue; }`
  (place it so a round that reaches the player first still hits the player — follow the block's own order).
- [ ] **Step 3: The flail** (`game-flail.ts` strike, after `resolveStrike`): every intact barrel whose centre is within
  `FLAIL_STRIKE.reach` of the eye and `inStrikeArc(eye, aimYaw, centre, FLAIL_ARC_DEG[side])` (both exported from
  `flail-strike.ts`) takes `hit(id, 'melee')`. Two strikes pop a drum.
- [ ] **Step 4: Verify** with the scratch driver on the fixture: stand at (5.0, −1.0) in D facing b3 (yaw =
  `Math.atan2(dx, -dz)`, pitch to the drum's centre), `__sdfGame.fire()` → b3 `lit`/`gone` within 1 s (8 pellets × 4 ≥
  20, or one slug); in E1M1 let a soldier shoot past a drum and report whether rounds hit it (report only).
  Typecheck; `npm run test:changed`. **Commit** `feat(levels): shots, enemy rounds and the flail set barrels off`.

---

## Task 15: Gate — debris on sector floors

**Files:** `scripts/sdf-game-doom-gate.mjs` (header comment: add sections 6 and 7).

Bands: a settled chunk `pos.y − support − floor` ∈ [−0.02, +0.03]; a splat `|y − floor| ≤ 0.01`; a resting casing
`y − floor − 0.012` ∈ [−0.01, +0.01]; a resting gun `y − floor − 0.03` ∈ [−0.02, +0.02]; a resting kit piece
`minY − floor − 0.01` ∈ [−0.02, +0.03]; a settled rope: every node ≥ floor − 0.01 and its lowest node ≤ floor + 0.1;
a pickup `y − floor` = 0.25 ± 0.001; a resting bundle `|y − floor| ≤ 0.01`. "floor" is always
`__sdfGame.ground(x, z).floor` at the item's own x/z.

- [ ] **Step 1: 6a, on the fixture** (after the fixture walks, same boot):
  1. **Ledge:** `spawnTestChunk(0, 1.8, -12.6, 0.12, false, [0, 0, 2.5])` (on C, rolling toward B) → after 4 s it is
     settled, `z > -12`, `floorY` 0.5, in band. `spawnTestChunk(3.6, 0.3, -2, 0.12, false, [2.5, 0, 0])` (A → the pit
     D) → settled in D at floor −1.
  2. **Walls:** `spawnTestChunk(1, 0.3, -6.5, 0.12, false, [0, 0, -6])` (into the B riser below its top) → settled on A
     (`z > -8`, floor 0); `spawnTestChunk(0, 1, -1, 0.12, false, [0, 2, 20])` (20 m/s at the north wall) → every sample
     (rAF sampler, as section 5's rounds sampler) has `z < 0`; one into the column from the north never enters
     x −1..1, z −5..−3.
  3. **Blood:** `bloodBurstAt(0, 1.8, -12.1)` (over the C/B edge) → after 4 s `droplets` 0 and every splat in band;
     at least one splat on 1.5 and one on 0.5.
  4. **Bundle:** `throwTestBundle(0, 1.7, -13, 0, 0, 1.5, 8)` (off the C ledge) → within 3 s it leaves C (`z > -12`)
     and from then on every sample has `|y − floor(x, z)| ≤ 0.01` once its vertical speed is 0 (a resting bundle keeps
     sliding horizontally — kThing behaviour — so judge the floor, not the sector it ends in); it never crosses a
     wall (rAF sampler, as in step 2).
  5. **Surface blood on sector walls:** boot `?level=fixtures/sectors&surfaceblood=1` (or `setSurfaceBlood(true)`),
     `surfaceBloodBurst([0, 1, -1.5], [0, 1, 0.5], 24)` → `surfaceBloodStains()` has a stain whose receiver starts
     with `sector-wall` (this is the "do stains on walls need sector walls" proof).
- [ ] **Step 2: 6b, on E1M1** (`?level=doom-e1m1&god`), after section 5.4b's round sampler (a soldier has fired, so
  casings exist):
  1. `collapseActor(<that soldier>)`; pick another actor on a floor with `|floor| ≥ 0.25` (report which floor) and
     `detonate(x, floor + 0.5, z)` beside it (gibs, blood, entrails, its gun); wait 8 s.
  2. Read `debris()`; check every settled chunk / mesh gib / sprite piece, every splat, every resting casing, gun and
     kit piece, every settled rope, every pickup against the bands. Fail on any out-of-band item; report counts per
     kind and the floors they rest on (must include a non-zero floor). A piece still moving after 8 s is reported, not
     judged.
  3. SHOTS=1: `e1m1-debris-0..1.png` at the detonation site, pitch −0.5 — LOOK: nothing floating, nothing sunk.
- [ ] **Step 3: Run** `LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh`; fix what it finds (in the task
  that owns the stepper). **Commit** `test(levels): doom gate — debris rests on sector floors and stops at walls`.

---

## Task 16: Gate — barrels

**Files:** `scripts/sdf-game-doom-gate.mjs`.

- [ ] **Step 1: 7a, on the fixture with `&god=0`** (health counts):
  1. **Placed:** `barrels()` = the five fixture ids, `intact`, each `pos.y` = `ground(x, z).floor` (b4 = 1.5).
  2. **Chain + damage:** `spawnCrowd('zombie', 1, { region: { minX: 5.0, maxX: 5.6, minZ: -5.6, maxZ: -5.0 } })`;
     player pose (6.8, −4.8) on D's floor; record health and the zombie's wounds count (`actorWounds`) or presence;
     `damageBarrel('b1')`; after 1.5 s: `barrelLog()` lists b1 then b2 with a gap in 0.1–0.3 s (± one frame), b3
     still `intact`; the player's health dropped (report by how much; expect ~16 for two drums ~2.5 m away); the
     zombie took blast wounds or was gibbed; two scorches and two stubs (report via `barrels()` phases).
  3. **Shielded:** player pose (0, −2.4) north of the column, `damageBarrel('b5')` → health unchanged (the column
     shields 3.2 m), b5 gone.
  4. **Shot:** pose (5.0, −0.8) facing b3 at its centre, `fire()` → b3 `gone` within 1 s.
  5. **Raised floor:** b4 stands at 1.5 (step 1) and `damageBarrel('b4')` leaves its scorch at y 1.504 ± 0.002 (read
     the scorch instance matrix through a seam if needed, or the stub's world y).
- [ ] **Step 2: 7b, on E1M1:** `barrels()` count = the converter's (read the JSON), all on their floors;
  `damageBarrel(<one with a neighbour within 3.5 m>)` → the chain ripples (log), with `god=0` a player 2 m away loses
  health; budget at a barrel pose reported (draw calls, frame split); SHOTS `e1m1-barrels-0..2.png` before/after —
  LOOK.
- [ ] **Step 3: Run** the gate end to end twice (load average reported). **Commit**
  `test(levels): doom gate — barrels explode, chain, hurt and are shielded by walls`.

---

## Task 17: Regressions, notes, task wiki

- [ ] **Step 1: Room levels unchanged.** Run and report each (ports of your own; NEVER kill a server you did not start):
  - `scripts/sdf-game-loop-gate.sh` (Night Train: pickups, damage, death, ending)
  - `scripts/sdf-game-flat-gate.sh`
  - `scripts/sdf-game-wake-gate.sh`
  - `node scripts/sdf-game-dynamite-gate.mjs <vite> <cdp> .lab-tmp/dynamite-gate` (the throw, the gib — y = 0 path)
  - `scripts/sdf-chunk-bake-gate.sh` (settled-chunk bake: `chunkSettled` changed)
  - `scripts/sdf-game-surface-blood-gate.sh` (the surface stains)
  - `LAB_VITE_PORT=… LAB_CDP_PORT=… node scripts/sdf-game-bleed-gate.mjs parity` (bleed off is pixel-identical)
  - `scripts/sdf-game-launcher-gate.sh` (rockets: `detonateAt` changed)
  - `scripts/sdf-game-crowd-gate.mjs` — known pre-existing failure in section 4 (3a notes); report whether it is
    unchanged.
  - the arena boot `?level=arena&spawn=soldier` (a soldier fires, dies: its gun and casings rest at y 0.03 / 0.012 —
    read `debris()`).
- [ ] **Step 2: Notes** `docs/dev-notes/2026-10-25-sector-levels-3b/NOTES.md`: what was built, the y = 0 sites table
  (as fixed), the decisions above, the barrel numbers, the gate output, the shots looked at, the converter's barrel
  count, boot `drawOnce` before/after, decisions kept (dynamite does not hurt the player, by the owner's choice), gaps (destroyed drums keep their nav cells;
  room-level barrels; no barrel sound; nav does not avoid lit drums).
- [ ] **Step 3: Task wiki.** `docs/tasks/levels.md`: the sector-levels item gains 5b (debris on floors + barrels, done,
  links) and the next items (doors per the owner's sliding-door question, room-level barrels); `TASKS.md` front page
  if its "in flight" line names 3b. Commit `docs(levels): plan 3b notes — debris on sector floors, barrels`.

---

## Owner decisions (answered 2026-10-25)

1. **Dynamite does not hurt the player** — enemies only, today's behaviour. `blast-player.ts` is used by rockets
   (unchanged rule) and barrels only.
2. **Barrel numbers: the draft values** — 20 HP; pellet 4, slug 20, flail 10, enemy round 3; up to 55 to the player,
   quadratic to 0 at 4 m; chains within 3.5 m after 0.1–0.3 s. Tune after playing.
3. **All E1M1 barrels regardless of skill** (barrels are scenery): the converter ignores skill flags for barrels;
   Doom's multiplayer-only flag still skips one (the same rule as every other thing).
4. **A destroyed barrel keeps blocking enemy pathing until reload** — accepted for 3b, listed as a known gap
   (controller default).
5. **Barrels in room levels: later**, not in 3b.
