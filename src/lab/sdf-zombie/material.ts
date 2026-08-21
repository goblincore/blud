// src/lab/sdf-zombie/material.ts
import type { Vec3 } from './types';

export interface FleshMaterial {
  baseColor: Vec3;   // exterior, linear RGB 0..1
  deepColor: Vec3;   // wound interior
  charColor: Vec3;
  specIntensity: number;
  specRoughness: number;
  fresnelBoost: number;
  translucency: number;
  surfaceNoiseAmp: number;    // perturbs the NORMAL only — free
  silhouetteNoiseAmp: number; // perturbs the DISTANCE — costs march safety
  wetness: number;            // global multiplier on spec + fresnel

  /**
   * Blotchy colour drift across the flesh, so a body is not one flat tone.
   *
   * `surfaceNoiseAmp` already perturbs the NORMAL, which reads as texture but
   * not as colour: under a broad key the whole creature stays a single hue and
   * the eye takes the silhouette as one object. This is the albedo twin —
   * `mottleColor` mixed in by an fbm sampled in REST space, the same anchor
   * the micro-detail uses, so the blotches ride a limb through gait instead of
   * swimming across it as the body moves.
   *
   * `mottleAmp` 0 disables the whole block in the shader, including its noise
   * lookup, which is why every preset here ships at 0: turning it on changes
   * how every existing body looks, and that is a per-character art decision
   * (a `.blob` `palette` block), not something a preset should impose.
   *
   * NOTE THAT IT SHIFTS THE MEAN. The blotch weight averages about 0.5, so the
   * body's average albedo lands near `mix(baseColor, mottleColor, amp * 0.5)`,
   * not at `baseColor`. Raising the amplitude on an existing character
   * therefore drags its overall colour toward `mottleColor` as well as adding
   * variation, and `baseColor` needs lifting back to compensate. That is not a
   * bug to centre out — a symmetric mottle would need a negative mix weight,
   * which extrapolates away from `mottleColor` and straight out of gamut.
   */
  mottleAmp: number;
  /**
   * fbm frequency for the mottle, in rough cycles per metre / 4 — the shader's
   * `fbm` multiplies its own input by 4 and 9 for its two octaves, so this is
   * about a quarter of the frequency it looks like. Near 1 gives patches a
   * hand-span across on a human-sized body; 5 is already freckles, and past
   * ~10 it aliases into what reads as compression noise rather than skin.
   */
  mottleScale: number;
  /** The colour the mottle mixes TOWARD, linear RGB. */
  mottleColor: Vec3;
}

export type FleshPresetName = 'henenlotter-latex' | 'wet-meat' | 'clay';

export const FLESH_PRESETS: Record<FleshPresetName, FleshMaterial> = {
  // Foam latex under a hard key: saturated, smooth, blown-out highlights.
  'henenlotter-latex': {
    baseColor: [0.82, 0.44, 0.46],
    deepColor: [0.74, 0.06, 0.10],
    charColor: [0.10, 0.07, 0.08],
    specIntensity: 0.95, specRoughness: 0.12,
    fresnelBoost: 0.85, translucency: 0.45,
    surfaceNoiseAmp: 0.06, silhouetteNoiseAmp: 0.016,
    wetness: 1.0,
    // Off in every preset — see mottleAmp's docstring. The colour is a
    // plausible starting point for a character that opts in, not a look this
    // preset wears.
    mottleAmp: 0, mottleScale: 1.2, mottleColor: [0.62, 0.24, 0.30],
  },
  // Rotten meat: darker, broader highlight, veiny, more scatter.
  'wet-meat': {
    baseColor: [0.48, 0.24, 0.22],
    deepColor: [0.55, 0.08, 0.09],
    charColor: [0.09, 0.06, 0.06],
    specIntensity: 0.80, specRoughness: 0.38,
    fresnelBoost: 0.50, translucency: 0.75,
    surfaceNoiseAmp: 0.22, silhouetteNoiseAmp: 0.018,
    wetness: 0.85,
    mottleAmp: 0, mottleScale: 1.2, mottleColor: [0.30, 0.14, 0.12],
  },
  // Claymation: matte, waxy, thumb-smushed.
  clay: {
    baseColor: [0.62, 0.46, 0.38],
    deepColor: [0.42, 0.18, 0.16],
    charColor: [0.12, 0.10, 0.09],
    specIntensity: 0.14, specRoughness: 0.88,
    fresnelBoost: 0.0, translucency: 0.0,
    surfaceNoiseAmp: 0.14, silhouetteNoiseAmp: 0.006,
    wetness: 0.1,
    mottleAmp: 0, mottleScale: 1.2, mottleColor: [0.44, 0.32, 0.24],
  },
};

export interface LightPreset {
  keyDir: Vec3;
  keyIntensity: number;
  fillIntensity: number;
  keyColor: Vec3;
}

export type LightPresetName = 'practical-hard-key' | 'game-ambient';

export const LIGHT_PRESETS: Record<LightPresetName, LightPreset> = {
  // Single close bright key, almost no fill — practical-effects blowout.
  'practical-hard-key': {
    keyDir: [0.45, 0.72, 0.53],
    keyIntensity: 2.4,
    fillIntensity: 0.06,
    keyColor: [1.0, 0.96, 0.92],
  },
  // Mirrors the real game's sun + ambient, to check the material survives it.
  'game-ambient': {
    keyDir: [0.35, 0.86, 0.52],
    keyIntensity: 1.1,
    fillIntensity: 0.34,
    keyColor: [1.0, 0.925, 0.804],
  },
};
