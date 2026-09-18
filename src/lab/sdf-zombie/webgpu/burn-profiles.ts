// src/lab/sdf-zombie/webgpu/burn-profiles.ts
//
// THE TUNING RECORD for burning bodies, shared by the flame lab, its panel and
// (spec 2) the game, so a look tuned in the lab is the same look in the game.
// Pattern copied from impact-splash-profiles.ts: flat numbers, named presets,
// one clamp that non-finite input cannot get through.

import { BLAST_REFRACTION } from '../blast-refraction';

export interface BurnTuning {
  /** Seconds from ignition to fully alight. */
  igniteSec: number;
  /** Seconds from extinguish to cold. */
  extinguishSec: number;
  /** Char accumulated per second at full burn (1 = fully black). */
  charRate: number;
  /** Emissive multiplier on the surface fire. */
  fireGain: number;
  /** Rest-space frequency of the fire noise (higher = finer flame cells). */
  noiseScale: number;
  /** Rest-space units per second the fire noise scrolls upward. */
  riseSpeed: number;
  /** How much of the surface stays dark char at full burn, 0..1. */
  charPatch: number;
  /** Peak intensity of the per-body fire light. */
  lightPeak: number;
  /** Fire-light flicker depth, 0..1. */
  lightFlicker: number;
  /** Glow (bloom) gain applied to the extracted bright pass. */
  glowGain: number;
  /** Luminance above which a pixel contributes to glow. */
  glowThreshold: number;
  /** Peak heat-wobble offset, in UV units. */
  distortStrength: number;
  /** Fraction of the surface carrying flame at once, 0..1. */
  fireCoverage: number;
  /** How far the flesh thins to show bone at full char, 0..1. */
  skeletonShow: number;
}

export const BURN_TUNING: BurnTuning = Object.freeze({
  igniteSec: 0.45, extinguishSec: 0.8, charRate: 0.22,
  // 2026-09-17 fix pass: gain and charPatch raised from 1.6/0.35 after the
  // probe captures -- at the old values a fresh body read as pink flesh with
  // sparse fire dots instead of the engulfed reference look (dark char between
  // flames). charPatch 0.55 is what makes between-flame skin read as soot.
  fireGain: 2.8, noiseScale: 7, riseSpeed: 1.8, charPatch: 0.55,
  lightPeak: 26, lightFlicker: 0.35,
  glowGain: 0.5, glowThreshold: 0.75,
  distortStrength: 0.006,
  fireCoverage: 0.9,
  // 0.7 (fix pass task 3): at the plan's 0.5 the probe capture showed pale
  // hints on shoulder and shin only -- the skull did not read. 0.7 at char
  // 0.6 gives skelK 0.42, which reads as bone through soot; probed 0.8 and
  // it stayed legible, but 0.7 leaves the preset room above it (ember is
  // the late-stage more-bone look). skelK is 0 on a fresh body by
  // construction, so this never paints an unburnt body.
  skeletonShow: 0.7,
});

/** The clamp range for every field, as data.
 *
 *  These bounds are the load-bearing part of this module: the panel's sliders
 *  read their ranges from here (so the two can't drift), and the table-driven
 *  test walks every field at both rails, which a hand-written clamp list makes
 *  easy to leave half-covered.
 *
 *  `igniteSec`'s floor is above the caller's dt clamp (1/30 s) on purpose —
 *  burn-state.ts's char trapezoid is only exact while no single step overshoots
 *  the burn = 1 clamp, so lowering this floor breaks an invariant documented in
 *  that file. `distortStrength`'s ceiling is BLAST_REFRACTION.maxOffsetUv, the
 *  hard clamp post-aa's warp applies anyway. */
export const BURN_BOUNDS: Readonly<Record<keyof BurnTuning, readonly [number, number]>> = Object.freeze({
  igniteSec: [0.05, 4], extinguishSec: [0.05, 4], charRate: [0, 2],
  fireGain: [0, 4], noiseScale: [0.5, 40], riseSpeed: [0, 8], charPatch: [0, 1],
  lightPeak: [0, 120], lightFlicker: [0, 1],
  glowGain: [0, 2], glowThreshold: [0, 4],
  distortStrength: [0, BLAST_REFRACTION.maxOffsetUv],
  fireCoverage: [0, 1], skeletonShow: [0, 1],
});

export const burnPresets: Readonly<Record<'blood' | 'ember' | 'inferno', BurnTuning>> = Object.freeze({
  // The default look, by definition — `blood` exists so the panel can offer a
  // way back to it after a tuning session, not to describe a second look.
  blood: Object.freeze({ ...BURN_TUNING }),
  // Late-stage: mostly charred with fire only in the cracks.
  ember: Object.freeze({ ...BURN_TUNING, charRate: 0.5, fireGain: 1.1, charPatch: 0.6, lightPeak: 14, glowGain: 0.35, fireCoverage: 0.5, skeletonShow: 0.8 }),
  // Over the top, for judging the ceiling of the effect.
  inferno: Object.freeze({ ...BURN_TUNING, fireGain: 3.4, noiseScale: 5, riseSpeed: 2.6, charPatch: 0.2, lightPeak: 42, glowGain: 0.8, distortStrength: 0.012, fireCoverage: 0.95, skeletonShow: 0.35 }),
});

const BURN_FIELDS = Object.keys(BURN_TUNING) as (keyof BurnTuning)[];

export function resolveBurnTuning(p: Partial<BurnTuning> = {}): BurnTuning {
  const out = {} as BurnTuning;
  for (const key of BURN_FIELDS) {
    const [min, max] = BURN_BOUNDS[key];
    const v = p[key];
    out[key] = v !== undefined && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : BURN_TUNING[key];
  }
  return out;
}
