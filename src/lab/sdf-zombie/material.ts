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
