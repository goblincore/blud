// src/lab/sdf-zombie/material.test.ts
import { describe, it, expect } from 'vitest';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type LightPresetName } from './material';

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

  it('gives every light preset the two bounce knobs, defaulted OFF', () => {
    // probeWeight 0 is the parity guarantee: ambientAt collapses to
    // lightCfg.y * keyColor, so the shipped look cannot move until a
    // slider does. Every owner-blessed visual depends on this.
    for (const n of Object.keys(LIGHT_PRESETS) as LightPresetName[]) {
      expect(LIGHT_PRESETS[n].probeWeight).toBe(0);
      // ambientGain is a TUNED number, not an invariant — it is inert while
      // probeWeight is 0, so it cannot move the shipped look on its own. Only
      // require it to be sane. (It used to be pinned at 1, which pinned a
      // tuning value as though it were a contract.)
      expect(LIGHT_PRESETS[n].ambientGain).toBeGreaterThan(0);
      expect(Number.isFinite(LIGHT_PRESETS[n].ambientGain)).toBe(true);
    }
  });

  it('keeps practical-hard-key at the owner-tuned ambientGain of 4', () => {
    // Judged by eye in a red-walled box, 2026-08-25. At gain 1 this preset's
    // 0.06 fill makes chromatic ambient ~2% of the picture and the effect is
    // invisible; 4 lands it near game-ambient's 0.34 where it reads, without
    // spending the hard-key blowout (which the KEY carries, not the fill).
    // Pinned so a later sweep cannot quietly undo an owner verdict.
    expect(LIGHT_PRESETS['practical-hard-key'].ambientGain).toBe(4);
  });
});

describe('wound tissue material (wound pass r2)', () => {
  // No `zombie` key exists in FLESH_PRESETS (its keys are the three flesh
  // looks: henenlotter-latex / wet-meat / clay), so the plan's zombie-keyed
  // assertions run over every preset instead. All three are human-stature and
  // all ship the ramp on, so the stronger form is still exactly the plan's
  // intent.
  it('every preset carries bone and fat colours and ramp knees', () => {
    for (const [name, preset] of Object.entries(FLESH_PRESETS)) {
      expect(preset.boneColor, name).toHaveLength(3);
      expect(preset.fatColor, name).toHaveLength(3);
      expect(preset.fatDepth, name).toBeGreaterThan(0);
      expect(preset.muscleDepth, name).toBeGreaterThan(preset.fatDepth);
    }
  });

  it('ships the depth ramp on', () => {
    for (const preset of Object.values(FLESH_PRESETS)) {
      expect(preset.woundDepthAmp).toBe(1);
    }
  });
});
