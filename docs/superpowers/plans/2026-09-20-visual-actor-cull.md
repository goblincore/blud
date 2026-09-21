# Visual-Actor Cull Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Do per-actor VISUAL upkeep (skeleton segment meshes, both hulls, wound
exclusion spheres, view time / head shape) only for actors that can be on
screen, instead of for every actor in every room — without touching simulation.

**Evidence:** `docs/dev-notes/2026-09-20-telemetry-v3/NOTES.md`. The level spawns
every room at boot (23 actors). Measured on the owner's machine: `sceneCensus()`
= 815 visible meshes, 426 of them `skeleton-segment-meshes` (one `THREE.Mesh` per
bone segment per actor), walked 3x per frame (main + 2 flashlight shadow maps);
`cpu:sdf:polys` 3-5 ms CPU, `sdf:polys` 4.7 ms GPU with ZERO bodies on screen;
`tick:occluder-hull` 1.5 ms with zero bodies on screen; `tick:burn-kit-viewtime`
1.7 ms at 23 actors vs 0.6 at 15-18.

**Architecture:** A pure, renderer-free module `visual-actor-set.ts` decides which
actors need visual upkeep: a padded view-cone test from the player's eye/yaw/pitch
(robust to a one-frame-stale cull) unioned with last frame's `visibleActors`. The
tick computes the set once into `ctx.render.visualActors`; the hulls, the wound
exclusions, the view-time loop and the skeleton mesh renderer read it. Simulation
(`body-step`, AI, encounter, crowd sync) is NOT changed.

**Tech Stack:** TypeScript, three.js WebGPU, Vitest, headless-Chrome capture
scripts (`scripts/*.mjs`). No WGSL changes.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port):** logic in pure
  renderer-free tested modules (no `three` import; plain data in, plain data
  out); state on `ctx` (`GameContext` slices), never as new `main()` bindings
  (`npm test -- game-context-coverage`); deterministic sim; plain-data seams.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only.** Capture scripts require
  `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove claims with a number** and look at the images yourself.
- Never toggle a LIGHT's `.visible`, and never parent a light under a group
  whose `.visible` toggles (it re-keys the LightsNode and rebuilds every lit
  pipeline — `df51f66a`). This plan toggles MESH visibility only.
- **SAFETY BIAS (same as the march cull in `game-world-leaves2.ts`):** a wrongly
  culled visible body is a visible bug; a wrongly kept one is only a cost. Every
  choice points at drawing too much, never too little.
- **The pixel gate.** Inside `scripts/lab-servers.sh`, with your own ports:
  `node scripts/march-hash.mjs` → room1 `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d`,
  repeat identical, wounded `1381a866703b827745486a1062240a46bee5c73f`; and
  `MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0 node scripts/march-hash.mjs` →
  `35b6d5619f7f85a52e852056a09f6c0fbfacf2c5`. BOTH rooms. A diff means behaviour
  changed: diagnose it. NEVER re-pin, widen, hash fewer pixels, or
  retry-until-green. This plan changes no shader text, so no cold compile is
  expected; if the first run reports `occupancy never went live`, rerun once with
  `MARCH_HASH_SETTLE_TRIES=2400` before concluding anything.
- Do not run two pixel gates at once.
- Kill anything you start outside a capture script in the same step.
- Append a row to `docs/dev-notes/2026-09-20-visual-actor-cull/NOTES.md` (create
  it in task 1) saying what you did, what you measured, and anything surprising.

### Task 1: Pure visual-actor selector

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/visual-actor-set.ts`
- Create: `src/lab/sdf-zombie/webgpu/visual-actor-set.test.ts`
- Create: `docs/dev-notes/2026-09-20-visual-actor-cull/NOTES.md`

- [ ] **Step 1:** Write `visual-actor-set.ts` with NO `three` import:

```ts
import type { Vec3 } from '../types';

export interface VisualViewer { eye: Vec3; yaw: number; pitch: number; fovYDeg: number; aspect: number }
export interface VisualBody { id: number; center: Vec3 }
export interface VisualCullOptions {
  /** Degrees added to the half-angle of the view cone. Covers a fast mouse
   *  flick between the tick that builds the set and the frame that draws it. */
  marginDeg: number;
  /** Bounding radius of a posed body around `center`, metres. */
  bodyRadiusM: number;
  /** Always keep a body this close, whatever its angle (it can be behind the
   *  player and still throw a flashlight shadow / be turned to in one frame). */
  alwaysWithinM: number;
}
export const VISUAL_CULL_DEFAULTS: VisualCullOptions = { marginDeg: 35, bodyRadiusM: 1.3, alwaysWithinM: 3 };

/** Ids of the bodies that need visual upkeep this tick. */
export function selectVisualActors(
  viewer: VisualViewer, bodies: readonly VisualBody[], alsoKeep: ReadonlySet<number>,
  opts: VisualCullOptions = VISUAL_CULL_DEFAULTS,
): Set<number>;
```

  The forward vector MUST match the game's convention, copied from `aimDir` in
  `game-weapon-leaves.ts`: `[sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)]`.
  Cone half-angle = half the DIAGONAL field of view (from `fovYDeg` and `aspect`)
  + `marginDeg`. A body is kept when `angle(forward, center - eye) - asin(min(1,
  bodyRadiusM / dist)) <= halfAngle`, or `dist <= alwaysWithinM`, or its id is in
  `alsoKeep`. Distance 0 is kept.
- [ ] **Step 2:** `visual-actor-set.test.ts` (Vitest). Cover: a body dead ahead is
  kept; a body directly behind at 10 m is dropped; the same body at 2 m is kept
  (`alwaysWithinM`); a body just outside the raw FOV but inside the margin is
  kept; a large near body whose CENTRE is outside the cone but whose radius
  reaches in is kept; an id in `alsoKeep` is kept whatever its position; pitch is
  honoured (a body far above the view when looking level is dropped, kept when
  looking up); yaw convention check — with `yaw = 0` forward is `-Z`, with
  `yaw = PI/2` forward is `+X`.
- [ ] **Step 3:** `npm test -- visual-actor-set` and `npx tsc --noEmit` pass.
  Create the NOTES.md with a header and your row. Commit.

### Task 2: Wire the set into the tick, the hulls and the skeleton meshes

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts`
- Create: `src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.test.ts` (none exists today)
- Modify: the `GameContext` render-state slice that declares `visibleActors` (find with `grep -rn "visibleActors:" src/lab/sdf-zombie/webgpu/game-state-*.ts`) and its test
- Modify: `src/lab/sdf-zombie/webgpu/game-seams-render.ts` (the A/B seam)
- Modify: `docs/dev-notes/2026-09-20-visual-actor-cull/NOTES.md`

- [ ] **Step 1: state + switch.** Add to the render slice, beside `visibleActors`:
  `visualActors: Set<ZombieActor>` (empty set initially) and
  `visualCullEnabled: boolean` (default `true`). Boot param `?visualcull=0` turns
  it off — parse it through `boot-params.ts` (`parseIntParam`-style: the default
  is what you get when the parameter is ABSENT). Seam on `__sdfGame`:
  `setVisualCull(on: boolean)` and `visualCull(): { enabled, visual, total }`.
- [ ] **Step 2: compute the set once per tick.** In `tick`, immediately AFTER the
  `ctx.telemetry.telemetry.end('body-step', bodyTiming)` line and before the
  `tick:burn-kit-viewtime` lap, build the set: viewer from
  `eyeOf(ctx.player.player)`, `ctx.player.player.yaw/pitch`, the camera's `fov`
  and `aspect`; bodies from each actor's torso cluster centre
  (`a.posed().clusters.find(c => c.limb === 'torso')?.center`); `alsoKeep` = the
  ids of LAST frame's `ctx.render.visibleActors`. An actor with NO torso cluster
  (mid-gib, exotic body) is ALWAYS kept. When `visualCullEnabled` is false the
  set is every actor. Give it its own lap: `lap('region', 'tick:visual-set')`.
- [ ] **Step 3: view time / head shape.** In the `for (const a of
  ctx.world.actors) { a.view.setTime(now); ... setHeadShape ... }` loop, skip
  actors not in the set. Do NOT touch the `a.character.pose(...)` kit loop above
  it UNLESS you first prove `pose()` is stateless across calls (it takes `dt`;
  kit release / dropped-gun physics may integrate). If it is stateful, leave it
  and say so in NOTES.md.
- [ ] **Step 4: hulls + wound exclusions.** In BOTH hull blocks (the live one
  after the `tick:occluder-hull` lap and the `frozenHullBuilt` one), replace
  `ctx.world.actors` with the visual set's actors for `outerHull.update(...)`,
  `occluderHull.update(...)` posed lists AND the `flatMap` that builds the wound
  exclusion spheres. Build the filtered array ONCE per tick and reuse it.
- [ ] **Step 5: skeleton segment meshes.** `mesh-renderer.ts` `update(entries,
  owners)` gains an optional third argument `shown?: ReadonlySet<unknown>`
  (owners to draw). Inside the per-segment loop, when `shown` is given and does
  not contain the segment's owner: set `mesh.visible = false`, count it in
  `stats.hidden`, and `return` BEFORE the pose writes — exactly the path a
  non-live segment already takes. Eyes are children of the segment mesh, so they
  hide with it. Do NOT change slot indexing (entries stay one per actor, in
  actor order) — only visibility. If the renderer cannot be constructed under
  Vitest (it builds a node material), move the per-segment decision into a tiny
  exported pure helper in the same file — `segmentDrawn(live: boolean, owner:
  unknown, shown?: ReadonlySet<unknown>): boolean` — call it from the loop, and
  test THAT plus whatever of `update` is constructible. In `game-main.ts` pass
  `ctx.render.visualActors` as `shown`, and build the `craters` list in that
  block from the visual set only. Add tests: a hidden owner's meshes are
  invisible and receive no pose write; re-showing the owner restores visibility
  and the current pose in the same `update`; `stats.hidden` counts them.
- [ ] **Step 6: telemetry.** Add `visualActors: ctx.render.visualActors.size` to
  the per-frame `state` object in `telemetryFrame` (beside `visibleBodies`).
- [ ] **Step 7: gates.** `npx tsc --noEmit`; `npm test -- visual-actor-set
  mesh-renderer game-context-coverage game-state boot-params`; the pixel gate,
  BOTH rooms, identical to the pinned hashes (see Rules).
- [ ] **Step 8: measure, headless, one page, A/B by the seam** (never across
  page loads — `docs` dead end: cross-load perf comparisons are noise). Boot
  `/sdf-game.html?seed=7`, wait for `__warmGate.phase === 'ready'`, then for each
  of `setVisualCull(false)` and `setVisualCull(true)`, alternating off/on/off/on,
  wait 2 s and record `__sdfGame.sceneCensus().visible` and
  `__sdfGame.visualCull()`. Report the four readings. Expected: visible meshes
  drop by several hundred with the cull on. Write the numbers into NOTES.md.
  Take one screenshot with the cull on and LOOK at it: bodies in view must have
  flesh, skeleton and shadows.
- [ ] **Step 9:** Commit.

## Acceptance Criteria

- Simulation untouched: no change to `body-step`, AI, encounter or crowd sync.
- Pixel gate identical in both rooms.
- `sceneCensus().visible` measurably lower with the cull on, numbers in NOTES.md.
- `?visualcull=0` and `setVisualCull(false)` restore the old behaviour exactly.
