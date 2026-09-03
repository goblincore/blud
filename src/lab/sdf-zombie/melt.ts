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

// ——— THE PRIM TRANSFORM (task 2) ————————————————————————————————————————

import type { Primitive, Vec3 } from './types';

export interface MeltBodyTuning {
  /** Y the pooled goo settles at. A puddle has depth; zero reads as a decal. */
  poolHeight: number;
  /** yScale at full melt. 0.25 is a disc that still has a top surface. */
  crush: number;
  /** Metres pushed outward from the body's vertical axis at full melt. */
  spread: number;
  /**
   * blendK at full melt. The authored flesh runs 0.007–0.02; 0.11 is well
   * past the point where neighbouring limbs stop being separable, which is
   * what makes the puddle ONE surface instead of a heap of sausages.
   */
  fuseK: number;
}

export const MELT_TUNING_BODY: MeltBodyTuning = {
  poolHeight: 0.085,
  crush: 0.25,
  spread: 0.16,
  fuseK: 0.11,
};

/** Endpoint Y in the canonical order: prim i contributes 2i (a), 2i+1 (b). */
export function endpointHeights(prims: readonly Primitive[]): number[] {
  const out: number[] = [];
  for (const p of prims) { out.push(p.a[1]); out.push(p.b[1]); }
  return out;
}

/** meltInit for a real body — canonical endpoint order comes from the prims. */
export function meltInitBody(
  prims: readonly Primitive[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  return meltInit(endpointHeights(prims), floorY, tuning);
}

/**
 * Rest flesh prims in, melted flesh prims out. Never mutates the input, never
 * reorders (the fold order is load-bearing — see BuiltBody.prims), and never
 * sees a bone prim: bones live in BuiltBody.bonePrims and are handled by
 * melt-bones.ts.
 *
 * Scalar quantities (radius, scale, blendK) use the prim's MEAN endpoint
 * progress, while positions use each endpoint's OWN progress. That split is
 * what produces the stretch: a prim whose lower end has melted and whose
 * upper end has not gets pulled long while it is still only half-fused.
 */
export function applyMelt(
  prims: readonly Primitive[],
  s: MeltState,
  body: MeltBodyTuning = MELT_TUNING_BODY,
): Primitive[] {
  if (s.t <= 0) return prims.map(p => p);
  return prims.map((p, i) => {
    const ua = endpointProgress(s, i * 2);
    const ub = endpointProgress(s, i * 2 + 1);
    const u = (ua + ub) / 2;
    const yScale = lerp(p.scale[1], p.scale[1] * body.crush, u);
    // r ∝ 1/sqrt(yScale) keeps r² · yScale constant — the crushed disc gets
    // wider by exactly what it lost in height. This is the whole reason the
    // puddle ends up broader than the body: the volume has to go somewhere.
    const shrink = yScale / (p.scale[1] || 1);
    return {
      ...p,
      a: meltPoint(p.a, ua, body),
      b: meltPoint(p.b, ub, body),
      radius: p.radius / Math.sqrt(shrink || 1),
      ...(p.radiusB !== undefined ? { radiusB: p.radiusB / Math.sqrt(shrink || 1) } : {}),
      scale: [p.scale[0], yScale, p.scale[2]] as Vec3,
      blendK: lerp(p.blendK, body.fuseK, u),
    };
  });
}

/**
 * Drop one endpoint toward the pool and push it out from the body axis.
 *
 * The descent is CLAMPED to never rise: an endpoint already below poolHeight
 * (a foot resting under the puddle surface) stays where it stood rather than
 * being lifted up to the pool plane. Goo does not climb out of the floor.
 */
function meltPoint(p: Vec3, u: number, body: MeltBodyTuning): Vec3 {
  const y = Math.min(p[1], lerp(p[1], body.poolHeight, u));
  // Outward from the vertical axis through the origin (the body's own root).
  // A point exactly on the axis has no direction to go, so it stays — which
  // is correct: the spine should pool where it stood.
  const r = Math.hypot(p[0], p[2]);
  const push = r > 1e-6 ? (body.spread * u) / r : 0;
  return [p[0] * (1 + push), y, p[2] * (1 + push)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
