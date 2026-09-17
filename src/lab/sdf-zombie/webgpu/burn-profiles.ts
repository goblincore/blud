// src/lab/sdf-zombie/webgpu/burn-profiles.ts
//
// THE TUNING RECORD for burning bodies, shared by the flame lab, its panel and
// (spec 2) the game, so a look tuned in the lab is the same look in the game.
// Pattern copied from impact-splash-profiles.ts: flat numbers, named presets,
// one clamp that non-finite input cannot get through.

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
}

export const BURN_TUNING: BurnTuning = {
  igniteSec: 0.45, extinguishSec: 0.8, charRate: 0.22,
  fireGain: 1.6, noiseScale: 7, riseSpeed: 1.8, charPatch: 0.35,
  lightPeak: 26, lightFlicker: 0.35,
  glowGain: 0.5, glowThreshold: 0.75,
  distortStrength: 0.006,
};

export const burnPresets: Record<'blood' | 'ember' | 'inferno', BurnTuning> = {
  // Closest to the NotBlood burning-run frames: bright, busy, mostly fire.
  blood: { ...BURN_TUNING },
  // Late-stage: mostly charred with fire only in the cracks.
  ember: { ...BURN_TUNING, charRate: 0.5, fireGain: 1.1, charPatch: 0.6, lightPeak: 14, glowGain: 0.35 },
  // Over the top, for judging the ceiling of the effect.
  inferno: { ...BURN_TUNING, fireGain: 2.6, noiseScale: 5, riseSpeed: 2.6, charPatch: 0.2, lightPeak: 42, glowGain: 0.8, distortStrength: 0.012 },
};

export function resolveBurnTuning(p: Partial<BurnTuning> = {}): BurnTuning {
  const bounded = (v: number | undefined, fallback: number, min: number, max: number) =>
    v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    igniteSec: bounded(p.igniteSec, BURN_TUNING.igniteSec, 0.05, 4),
    extinguishSec: bounded(p.extinguishSec, BURN_TUNING.extinguishSec, 0.05, 4),
    charRate: bounded(p.charRate, BURN_TUNING.charRate, 0, 2),
    fireGain: bounded(p.fireGain, BURN_TUNING.fireGain, 0, 4),
    noiseScale: bounded(p.noiseScale, BURN_TUNING.noiseScale, 0.5, 40),
    riseSpeed: bounded(p.riseSpeed, BURN_TUNING.riseSpeed, 0, 8),
    charPatch: bounded(p.charPatch, BURN_TUNING.charPatch, 0, 1),
    lightPeak: bounded(p.lightPeak, BURN_TUNING.lightPeak, 0, 120),
    lightFlicker: bounded(p.lightFlicker, BURN_TUNING.lightFlicker, 0, 1),
    glowGain: bounded(p.glowGain, BURN_TUNING.glowGain, 0, 2),
    glowThreshold: bounded(p.glowThreshold, BURN_TUNING.glowThreshold, 0, 4),
    distortStrength: bounded(p.distortStrength, BURN_TUNING.distortStrength, 0, 0.035),
  };
}
