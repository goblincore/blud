// src/lab/sdf-zombie/melt.ts
//
// MELT — the zombie liquefies where it stands. Pure: no Date.now, no
// Math.random; identical (state, dt) sequences produce identical states,
// because scripts/melt-capture.mjs steps this frame by frame and its gate
// compares runs.
//
// THE MODEL, and why it is shaped this way (spec
// docs/superpowers/specs/2026-09-03-zombie-melt-design.md):
//
// SAG IS PER-ENDPOINT, NOT PER-PRIM. Every prim is a capsule with two
// endpoints. Giving each endpoint its own progress makes capsules STRETCH as
// the lower end drops away from the upper — arms draw out into strands, the
// torso elongates as the pelvis goes first. Sagging whole prims instead
// slides a rigid body downward, which is a different and much worse effect.
//
// DESCENT IS PACED BY HEIGHT, NOT BY LIMB. A "melt front" rises through the
// body; an endpoint melts as the front reaches it. That is what makes this a
// candle (the feet liquefy and the torso settles onto the puddle) rather than
// a lift (the whole body descending together). The front leads past 1 so the
// crown still reaches full melt by progress 1.
//
// This module owns the SCHEDULE. The prim transform is applyMelt (task 2) and
// the bone release is melt-bones.ts (task 5); both read endpointProgress.

export interface MeltTuning {
  /** Progress per second. 0.625 ≈ 1.6s to full — the spec's timing. */
  rate: number;
  /**
   * How far past the top of the body the melt front travels by progress 1.
   * Must exceed 1 + softness or the crown never finishes: the front has to
   * clear the tallest endpoint by a full softness band.
   */
  frontLead: number;
  /**
   * Height band, in normalised body heights, over which an endpoint goes from
   * untouched to fully melted. Wide (0.45) fuses neighbours into one flowing
   * mass; narrow reads as a hard scan line moving up the body.
   */
  softness: number;
}

export const MELT_TUNING: MeltTuning = {
  rate: 0.625,
  frontLead: 1.55,
  softness: 0.45,
};

export interface MeltState {
  /** Overall progress 0..1. Frozen at exactly 1. */
  t: number;
  /** Normalised rest height (0 = floor, 1 = tallest endpoint) per endpoint. */
  heights: readonly number[];
  tuning: MeltTuning;
}

/**
 * @param restY   World-space rest Y of every endpoint, in the index order the
 *                caller will use for the rest of the melt.
 * @param floorY  The floor the body melts onto.
 */
export function meltInit(
  restY: readonly number[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  let top = 0;
  for (const y of restY) top = Math.max(top, y - floorY);
  // A zero-height body would divide by zero; 1 makes every height 0, i.e. the
  // whole body melts at once, which is the only sane degenerate answer.
  const span = top > 1e-6 ? top : 1;
  return {
    t: 0,
    heights: restY.map(y => (y - floorY) / span),
    tuning,
  };
}

export function stepMelt(s: MeltState, dt: number): MeltState {
  if (s.t >= 1) return s; // frozen — idempotent, per the spec's freeze
  const t = Math.min(1, s.t + s.tuning.rate * dt);
  return { ...s, t };
}

/** 0..1 melt of one endpoint. Monotonic in t; low endpoints lead high ones. */
export function endpointProgress(s: MeltState, index: number): number {
  const h = s.heights[index] ?? 0;
  const front = s.t * s.tuning.frontLead;
  const u = (front - h) / s.tuning.softness;
  return smoothstep(clamp01(u));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Hermite ease. Zero slope at both ends, so the melt starts and stops soft. */
export function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
