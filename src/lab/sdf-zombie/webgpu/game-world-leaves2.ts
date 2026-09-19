// src/lab/sdf-zombie/webgpu/game-world-leaves2.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type Wound } from '../damage'
import { type Vec3 } from '../types'
import { type ZombieActor } from './game-actor'


export function woundStreamId(ctx: GameContext, wound: Wound): number {
  let s = ctx.vfx.woundStreamIds.get(wound);
  if (s === undefined) { s = ctx.boot.nextEmitterStream++; ctx.vfx.woundStreamIds.set(wound, s); }
  return s;
}

// ---- ACTOR VISIBILITY CULL (2026-09-09) --------------------------------
//
// Before this, `setBodies` took EVERY actor in the level. The SDF proxy
// boxes ship `frustumCulled = false` ("the proxy IS the bound") so three
// culls nothing, and the GPU occluder pre-pass has been off since
// 2026-09-01 — so an enemy behind you, or behind a wall, marched like any
// other. That matters more than it used to: enemies now pursue across
// rooms, so the player's room holds more bodies than it spawns (bench
// census: room 3 spawns 3, saw 8).
//
// WHAT THIS IS NOT. Phase 0 measured the mesh-skeleton path at 0.5 ms and
// the encounter director at 0.2 ms, so there is deliberately NO simulation
// LOD here — AI, motion and rig run for every actor exactly as before, and
// cross-room pursuit is untouched. This culls only what gets MARCHED, which
// is 75-83% of the frame.
//
// WHERE THE WIN ACTUALLY IS. An off-screen proxy box clips to no fragments
// and was already nearly free, so the frustum half buys little on its own.
// The occluded case is the real one: on-screen but behind a wall, which
// rasterises a full box and marches it. Hence the clearSight test.
//
// SAFETY. A wrongly culled visible body is a visible bug; a wrongly kept one
// is only a cost. So: two sight probes (torso and head — a body leaning out
// from cover shows its head first), and becoming visible is INSTANT while
// going invisible must persist for CULL_DWELL_MS. Both biases point at
// drawing too much, never too little.
/** id -> the last time this actor was seen. Keyed by id, not index: actors
 *  are spawned and gibbed, and an index would transfer one body's grace
 *  period to another. */
/**
 * SCREEN COVERAGE ESTIMATE (2026-09-09), for telemetry only.
 *
 * The march is the dominant pass, and the one lever with a measured large
 * number is PIXEL COUNT (quartering the pixels bought -54%), so its cost
 * tracks COVERED PIXELS, not body count. NOTE the model once quoted here
 * (18.6 ms + 0.237 ms per 1k px, X1.4) predates the `'bodies'` interlace
 * halving the march target, and a 6x cut in the step budget bought only
 * -6..-31% (mostly single-digit) — the cost is per-PIXEL, not per-step. See
 * docs/dev-notes/2026-08-31-game-perf-baseline/notes.md:204-238.
 *
 * Captures record
 * `bodiesOnScreen` and `totalWounds` but nothing about area, which makes the
 * two candidate explanations for the close-up spikes indistinguishable:
 * "wounds are expensive" vs "a body filling the screen is expensive and you
 * happen to shoot things that are close".
 *
 * This is a CPU ESTIMATE, deliberately not the GPU occupancy probe: that one
 * is a readback, and the telemetry contract is no GPU waits or reads during
 * live play — measuring with it would distort what it measures. Each visible
 * body's bounding sphere is projected to screen and its disc area summed.
 *
 * KNOWN AND ACCEPTED IMPRECISION: overlapping bodies double-count, and no
 * occlusion is applied, so this OVERESTIMATES when bodies stack. It is a
 * monotonic proxy for "how much of the view is flesh", not a pixel count —
 * read it as a trend against frame time, never as an absolute.
 */

/** Recompute this frame's visible set. Called once, before the draw.
 *
 *  Dwell is measured on SIM time, not wall time (2026-09-10). In live play
 *  `tick` is called once per frame with the real frame delta, so simClockMs
 *  tracks elapsed wall time almost exactly and the 250 ms grace behaves as it
 *  always has. Under a fixed-step replay or a hand-stepped capture it becomes
 *  EXACT instead of approximate, which is the entire point. The one visible
 *  consequence: while the render lock is engaged `tick` does not run, so the
 *  clock does not advance and nothing expires out of the dwell — a frozen
 *  scene stays frozen, which is what the lock means. */
/** Run 5b: the per-body refine gate, shared by both cull modes. `centre` is
 *  the torso centre (null = no torso cluster: nothing to measure, so no
 *  twin); `kept` is the cull's verdict (always true with the cull off).
 *  Reads `sightA` for the camera. Rule: the twin is drawn only for a
 *  STANDING body (dead never refines — in either mode) inside the medium
 *  band, on screen, with hysteresis so an edge-walking body cannot flicker.
 *  Returns whether the twin is drawn. */
export function gateRefineTwin(ctx: GameContext, a: ZombieActor, centre: Vec3 | null, kept: boolean): boolean {
  const twin = a.view.refineObject;
  if (!twin) return false;
  if (!centre) { twin.visible = false; return false; }
  const dx = centre[0] - ctx.world.sightA[0], dy = centre[1] - ctx.world.sightA[1], dz = centre[2] - ctx.world.sightA[2];
  const d = Math.hypot(dx, dy, dz);
  const wasOn = twin.visible;
  const inBand = wasOn
    ? d >= ctx.render.refineBand.near - ctx.render.refineBand.hysteresis && d <= ctx.render.refineBand.far + ctx.render.refineBand.hysteresis
    : d >= ctx.render.refineBand.near && d <= ctx.render.refineBand.far;
  const on = kept && ctx.render.sdfLayer.refine && a.refineEligible() && inBand;
  twin.visible = on;
  return on;
}
