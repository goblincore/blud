// src/lab/sdf-zombie/webgpu/rng.ts
//
// NAMED SEEDED RNG STREAMS (determinism stage 1, 2026-09-14).
//
// Why a module and not the inline LCG the fire path already used: the sim must
// be a pure function of (seed, inputs, fixed dt), and "one global stream per
// feature" is what makes a divergence traceable. The reload arc, the muzzle
// flash and the blood/gore draws are INDEPENDENT subsystems; if they share one
// counter, adding a gore draw silently shifts every later reload arc and the
// seed no longer means what it says.
//
// Four streams, each derived by hashing the ONE demo seed with a per-stream
// salt, so a single `?seed=` (or the recorded `.dem` seed) moves all of them
// together while none can move another. Draining `fx` 100 times does not change
// what `reload` returns — that property is pinned by rng.test.ts, because a
// shared-lazy-init bug is exactly the kind that survives review.
//
// WHERE THE SEED COMES FROM. `setRngSeed(seed)` is called ONCE at boot, from
// `?seed=` when present and otherwise `Date.now() & 0x7fffffff` (logged), so:
//   - normal play is as varied as the old Math.random() it replaces;
//   - a bench leg or a replay passes `?seed=` and every repeat draws the same
//     stream, which is what lets two runs produce an identical census.
//
// Do NOT reseed mid-run. The value of a stream is that its sequence is a pure
// function of the seed and the number of draws already taken.
import { mulberry32 } from '../melt-bones';

/** The four independent, named streams the gameplay path draws from. */
export interface RngStreams {
  /** Bleed: wound gouts, trails, splat stamps — the whole blood sim. */
  bleed: () => number;
  /** Visual FX that can still move a light: muzzle flash, smoke puffs. */
  fx: () => number;
  /** Reload-arc variation when `pinnedReloadSeed` is not set. */
  reload: () => number;
  /** Everything else sim-affecting: pellet seeds, gore/chunk tumble. */
  misc: () => number;
}

/** Per-stream salt. Any distinct odd constants work; these are the golden-ratio
 *  and murmur finalizer mixes, chosen only so the four streams are unrelated. */
const SALT = {
  bleed: 0x9e3779b9,
  fx: 0x85ebca6b,
  reload: 0xc2b2ae35,
  misc: 0x27d4eb2f,
} as const;

/** Build four independent streams from one seed. Reproducible per seed. */
export function createRngStreams(seed: number): RngStreams {
  const s = seed >>> 0;
  return {
    bleed: mulberry32((s ^ SALT.bleed) >>> 0),
    fx: mulberry32((s ^ SALT.fx) >>> 0),
    reload: mulberry32((s ^ SALT.reload) >>> 0),
    misc: mulberry32((s ^ SALT.misc) >>> 0),
  };
}

/** The seed the page boots with when `?seed=` is absent — the same constant the
 *  old inline LCG used, kept so a seedless boot is still reproducible per build
 *  for tests that predate `?seed=`. `setRngSeed` overrides it. */
export const DEFAULT_DEMO_SEED = 0x5df1;

/**
 * The live streams the game reads. Mutated in place by `setRngSeed` so a module
 * import stays valid across the reseed — call sites always write
 * `rngStreams.bleed()`, never destructure it, or a reseed would be missed.
 */
export const rngStreams: RngStreams = createRngStreams(DEFAULT_DEMO_SEED);

/** Reseed all four streams at once. Returns the normalised seed. */
export function setRngSeed(seed: number): number {
  const s = seed >>> 0;
  const next = createRngStreams(s);
  rngStreams.bleed = next.bleed;
  rngStreams.fx = next.fx;
  rngStreams.reload = next.reload;
  rngStreams.misc = next.misc;
  return s;
}

/** A uint32 seed derived from a unit draw, for consumers that want a seed
 *  rather than a float (e.g. a per-projectile mulberry32). */
export function seedFromUnit(unit: number): number {
  return (unit * 0x100000000) >>> 0;
}
