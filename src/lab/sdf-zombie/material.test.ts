// src/lab/sdf-zombie/material.test.ts
import { describe, it, expect } from 'vitest';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial } from './material';

describe('flesh presets', () => {
  const names = ['henenlotter-latex', 'wet-meat', 'clay'] as const;

  it('defines all three presets', () => {
    for (const n of names) expect(FLESH_PRESETS[n]).toBeDefined();
  });

  it('gives every preset every field, all finite', () => {
    const keys: (keyof FleshMaterial)[] = [
      'baseColor', 'deepColor', 'charColor', 'specIntensity', 'specRoughness',
      'fresnelBoost', 'translucency', 'surfaceNoiseAmp', 'silhouetteNoiseAmp', 'wetness',
    ];
    for (const n of names)
      for (const k of keys) {
        const v = FLESH_PRESETS[n][k];
        expect(v, `${n}.${k}`).toBeDefined();
        for (const num of Array.isArray(v) ? v : [v]) expect(Number.isFinite(num)).toBe(true);
      }
  });

  it('orders wetness latex > meat > clay, which is the whole point of the toggle', () => {
    expect(FLESH_PRESETS['henenlotter-latex'].wetness).toBeGreaterThan(FLESH_PRESETS['clay'].wetness);
    expect(FLESH_PRESETS['wet-meat'].wetness).toBeGreaterThan(FLESH_PRESETS['clay'].wetness);
  });

  it('keeps latex smooth and meat veiny in surface noise', () => {
    expect(FLESH_PRESETS['henenlotter-latex'].surfaceNoiseAmp)
      .toBeLessThan(FLESH_PRESETS['wet-meat'].surfaceNoiseAmp);
  });

  it('keeps every silhouetteNoiseAmp inside the Lipschitz budget at stepMul 0.6', () => {
    for (const n of names)
      expect(FLESH_PRESETS[n].silhouetteNoiseAmp).toBeLessThanOrEqual((1 - 0.6) * 0.5);
  });

  it('defines both lighting presets with a key direction and intensities', () => {
    for (const n of ['practical-hard-key', 'game-ambient'] as const) {
      expect(LIGHT_PRESETS[n].keyDir).toHaveLength(3);
      expect(LIGHT_PRESETS[n].keyIntensity).toBeGreaterThan(0);
      expect(LIGHT_PRESETS[n].fillIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('makes the practical key harder and the fill weaker than game-ambient', () => {
    expect(LIGHT_PRESETS['practical-hard-key'].keyIntensity)
      .toBeGreaterThan(LIGHT_PRESETS['game-ambient'].keyIntensity);
    expect(LIGHT_PRESETS['practical-hard-key'].fillIntensity)
      .toBeLessThan(LIGHT_PRESETS['game-ambient'].fillIntensity);
  });
});
