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

  /** Bone albedo, linear RGB. Blood-stained toward `deepColor` at its junction
   *  with flesh in the shader, so it never reads as a clean white decal.
   *
   *  The default is the project's OWN established bone colour, not a fresh
   *  guess: `bonewalker.blob` paints its proud spine and rib bars `color=dbc0a0`
   *  (sRGB 219,192,160 -> linear 0.71, 0.53, 0.35), chosen against a reference
   *  mesh whose bone texels measure sRGB 175,140,119. A brighter bone-white
   *  reads as plastic next to that and would make the two kinds of bone in this
   *  game disagree. */
  boneColor: Vec3;
  /** Subcutaneous fat, linear RGB. The load-bearing ramp stop: it is what makes
   *  a crater read as OPENED rather than merely stained. */
  fatColor: Vec3;
  /** Depth beneath the original skin at which dermis becomes fat, metres. */
  fatDepth: number;
  /** Depth at which fat becomes muscle, metres. */
  muscleDepth: number;
  /** 0 disables the tissue ramp and shades bit-for-bit as before it existed. */
  woundDepthAmp: number;
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
    boneColor: [0.71, 0.53, 0.35], fatColor: [0.83, 0.72, 0.42],
    fatDepth: 0.004, muscleDepth: 0.014,
    woundDepthAmp: 1,
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
    boneColor: [0.71, 0.53, 0.35], fatColor: [0.83, 0.72, 0.42],
    fatDepth: 0.004, muscleDepth: 0.014,
    woundDepthAmp: 1,
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
    boneColor: [0.71, 0.53, 0.35], fatColor: [0.83, 0.72, 0.42],
    fatDepth: 0.004, muscleDepth: 0.014,
    woundDepthAmp: 1,
  },
};

export interface LightPreset {
  keyDir: Vec3;
  keyIntensity: number;
  fillIntensity: number;
  keyColor: Vec3;
  /**
   * How far the flat fill is replaced by chromatic bounce, 0..1.
   *
   * 0 = today's behaviour exactly — `ambientAt` returns
   * `fillIntensity * keyColor` and the shading expression collapses to what
   * it was before bounce existed. This is the default for every preset, so
   * the spike ships dark: nothing moves until the lab slider moves it.
   */
  probeWeight: number;
  /**
   * Overall level of the bounce term once `probeWeight` has mixed it in.
   *
   * 1 is the house rule from the spec — bounce carries COLOUR, NOT
   * BRIGHTNESS, so the shadow side keeps the level `fillIntensity` gave it
   * and only changes hue. Raising this above 1 deliberately breaks that rule
   * and is how the owner tests whether the look actually wants genuine
   * radiosity lift instead. Keep it as an explicit knob: the negative result
   * ("chromatic alone doesn't sell it") is a real outcome of this spike.
   */
  ambientGain: number;
  /**
   * Saturation of the bounce tint, 1 = the room's hue as accumulated.
   *
   * Distinct from `ambientGain` and safer: this is exactly luminance-
   * preserving (see `ambient.ts`), so it adds colour WITHOUT lifting the
   * shadow side. It exists because a plausible room is mostly neutral — a
   * Cornell box is four white walls of six — and renormalising its
   * accumulation lands near grey.
   */
  chromaGain: number;
}

export type LightPresetName = 'practical-hard-key' | 'game-ambient';

export const LIGHT_PRESETS: Record<LightPresetName, LightPreset> = {
  // Single close bright key, almost no fill — practical-effects blowout.
  'practical-hard-key': {
    keyDir: [0.45, 0.72, 0.53],
    keyIntensity: 2.4,
    fillIntensity: 0.06,
    keyColor: [1.0, 0.96, 0.92],
    probeWeight: 0,
    // OWNER-TUNED 2026-08-25: 4, judged by eye in a red-walled box.
    //
    // This preset's fill is 0.06, so at gain 1 the chromatic ambient is ~2% of
    // the picture and the effect is invisible — measured, not guessed (4.21% of
    // pixels moving by a mean of 2.05/255). Gain 4 puts the ambient near 0.24,
    // in the same range as `game-ambient`'s 0.34, which is where it starts to
    // read. The owner's verdict at that setting: the shadow side takes the
    // room's colour and the hard-key blowout survives.
    //
    // Note this DELIBERATELY breaks the spec's "colour, not brightness" house
    // rule — gain > 1 adds level, which is what that knob exists to allow. The
    // rule was written to protect the 2.4-vs-0.06 blowout; it turns out the
    // blowout is carried by the KEY, and lifting the shadow side alone does not
    // spend it. Recorded here rather than in the spec because it is a tuned
    // number, not a principle.
    //
    // Inert until something sets probeWeight above 0. Only the lab does that,
    // and only while its enclosure is up — see the enclosure toggle's comment
    // on why bounce must be gated on a room actually existing.
    ambientGain: 4,
    chromaGain: 1,
  },
  // Mirrors the real game's sun + ambient, to check the material survives it.
  'game-ambient': {
    keyDir: [0.35, 0.86, 0.52],
    keyIntensity: 1.1,
    fillIntensity: 0.34,
    keyColor: [1.0, 0.925, 0.804],
    probeWeight: 0,
    ambientGain: 1,
    chromaGain: 1,
  },
};
