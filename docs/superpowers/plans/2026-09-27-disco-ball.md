# Disco Ball Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Boiler Room disco ball becomes a mirror-tile ball that throws about 96 soft stars across the carriage's walls, floor and ceiling. The stars are white during the party, flash with the strobe, and are red afterwards, pulsing as the emergency beacons sweep the ball.

**Spec:** `docs/superpowers/specs/2026-09-27-disco-ball-design.md`. Read it first.

**Architecture:**
- **Pure logic (`disco-stars.ts`):** the directions, the ray-box hits, and the colour/intensity rule.
- **Renderer leaf:** builds one additive instanced star mesh in `lateScene` plus a WGSL mirror-tile material for the ball, and updates both each frame from the sim clock.

**Tech Stack:** TypeScript, three.js r186 WebGPU/TSL `wgslFn`, Vitest, headless CDP scripts.

## Rules

- **Pure logic** has no `three` import and its own tests. Rendering that matters is hand-written WGSL.
- **State** lives on `ctx` or in feature modules; no new `main()` bindings (`npx vitest run src/lab/sdf-zombie/webgpu/game-context.test.ts`).
- **Determinism:** the sim clock (`ctx.world.light.time`) and seeded hashes (`hash01` in `lamp-moods.ts`).
- **Allocation:** no per-frame allocation in the update.
- **Git:** never `git stash`. Another agent may commit on this branch concurrently (a flashlight fix touching `light-profiles.ts`, `compose.wgsl.ts` and `scripts/sdf-game-light-gate.mjs`), so **stage only your own files** and do not edit those three.
- **Tests:** targeted tests plus `npx tsc --noEmit`.
- **Headless only**, with `LAB_TMP=.lab-tmp` and your own ports. Never touch port 5180 or servers you didn't start.
- **Lights:** never toggle a light's `.visible`. Hiding a *mesh* is fine.
- **Commit messages** end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 1: `disco-stars.ts` (pure)

**Files:** create `src/lab/sdf-zombie/webgpu/disco-stars.ts` and `src/lab/sdf-zombie/webgpu/disco-stars.test.ts`.

**API:**

```ts
export const DISCO = { count: 96, seed: 1977, party: [1.0, 0.95, 0.85] as Vec3, starRadius: 0.07, starGrow: 0.012, fadeDist: 9, rgbScale: 1 } as const;
export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }
/** Fibonacci-sphere directions with seeded jitter, unit length, computed once. */
export function discoDirections(n?: number, seed?: number): Float32Array;          // n*3
/** Rotate dirs about Y by angle, cast from c against the box's inside; out per star: hit.xyz, normal.xyz, dist. Returns hits written. */
export function discoHits(dirs: Float32Array, angle: number, c: Vec3, box: Box, out: Float32Array): number; // out n*7
export interface BeaconView { pos: Vec3; axis: Vec3; cosOuter: number; cosInner: number; level: number; color: Vec3 }
/** The light on the ball: party lamps' level before/through the strobe, else the strongest beacon's cone coverage of the ball. */
export function discoLight(lampLevel: number, beacons: readonly BeaconView[], ball: Vec3, out: { rgb: Vec3; intensity: number }): void;
```

**Tests:**
- every direction has unit length, and the directions are spread (the mean is near zero);
- the hits lie on box faces, with inward normals, and the distance matches;
- rotating by 2π gives the same hits;
- `discoLight`:
  - lamp level 1 with no beacons gives party white, intensity 1;
  - lamp level 0 with a beacon pointing at the ball gives red, intensity > 0.9;
  - lamp level 0 with the beacon pointing away gives about 0;
  - strobe levels (e.g. 1.3) pass through, capped sensibly.

Write the tests first, run them to see them fail, implement, run them to pass, then commit: `feat(disco): pure star directions, box hits and the light rule`.

## Task 2: The star mesh, the mirror-tile ball, the wiring

**Files:** create `src/lab/sdf-zombie/webgpu/game-disco-leaves.ts` and WGSL modules (`disco-star.wgsl.ts`, `disco-tiles.wgsl.ts`). Modify the minimal wiring in `game-main.ts` (creation after the train/level art exists, the update in the tick, adoption into `lateScene` next to `adoptLightFx`/`adoptLateFx`).

- **Finding things:**
  - the ball mesh: the art object named like `disco-ball`; read `game-train-leaves.ts` and how sway kind `spin` finds it;
  - the Boiler Room box: `ctx.world.level.rooms` for the room containing the ball, with its height;
  - the lamp level and beacon views: `ctx.world.light.lamps`, i.e. room-5 lamps that aren't fire or beacon, averaged, plus the beacon spots.
- **Stars:**
  - an `InstancedMesh` of quads (one draw), additive, depthTest on, depthWrite off;
  - instance matrices are built from hit and normal (oriented flush and pushed off the surface by 5 mm), scaled by `starRadius + starGrow·dist`;
  - a per-instance attribute carries the fade; the colour uniform is `rgb·intensity`;
  - the star fragment is a soft disc in WGSL;
  - the mesh is hidden when the player isn't in room 5 or a room joined to it (use `nearRoomMask` from `game-light-list-leaves.ts`);
  - update ranges only cover live instances.
- **Ball:**
  - replace the material with a `MeshStandardNodeMaterial` or basic node material, whichever renders in forward mode. Check how other art gets node materials; avoid what the deferred router hides;
  - the colour node is WGSL: tile cells in the ball's local spherical coordinates, each with a seeded glint flaring toward the camera, tinted by `rgb·intensity`, with dark gaps;
  - it stays spinning via the existing sway.
- **Check it:** `npx tsc --noEmit`, the targeted tests, and `game-context.test.ts`.
- **Commit:** `feat(disco): mirror-tile ball and sweeping stars in the Boiler Room`.

## Task 3: Check script, sheet, cost, docs

- **Create `scripts/sdf-disco-check.mjs` and `.sh`** by copying the plumbing of `scripts/sdf-game-light-gate.mjs`: boot, clock pinning, the `setPose` / `step` seams, and the lab-servers lifecycle. The check asserts:
  - stars land in room 5, via a new seam `disco()` returning count, visibility, rgb and intensity;
  - they are white before the strobe and red after;
  - after the strobe, intensity varies across sim times as the beacons sweep;
  - the ball's material is the tile material.
- **Owner contact sheet:** `docs/dev-notes/2026-09-27-disco-ball/disco.png`, with the party before the strobe and two beacon angles after it. LOOK at it and describe it honestly.
- **Cost:** Boiler Room frame median with the stars on vs off, via a measurement seam that hides the star mesh. Interleaved rounds, and a load check under 4.
- **Docs:** `notes.md` in that folder, one line in `TASKS.md`, and the levels page entry. Check `wc -l` and `tail` afterwards.
- **Commit:** `test(disco): check script, sheet, cost; docs`.
