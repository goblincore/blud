import { describe, it, expect } from 'vitest';
import { VHS_PRESETS, effectiveSmear, POST_VHS_WGSL } from './post-vhs';

describe('VHS_PRESETS', () => {
  it('matches the club-mutant soft preset exactly — it is the source of truth', () => {
    expect(VHS_PRESETS.soft).toEqual({
      intensity: 0.7, blurAmount: 0.45, noiseAmount: 0.04, gradeAmount: 0.55,
      warpAmount: 1.25, warpFrequency: 1.5, warpSpeed: 0.25,
      chromaAmount: 0.6, chromaJitter: 0.6, motionThreshold: 0.12,
      chromaBurstChance: 0.02, chromaBurstStrength: 0.6, chromaBurstRate: 12,
    });
  });
  it('orders the three presets by escalating chroma', () => {
    expect(VHS_PRESETS.soft.chromaAmount).toBeLessThan(VHS_PRESETS.balanced.chromaAmount);
    expect(VHS_PRESETS.balanced.chromaAmount).toBeLessThan(VHS_PRESETS.chaotic.chromaAmount);
  });
  it('has every term defined on every preset', () => {
    const keys = Object.keys(VHS_PRESETS.soft);
    for (const p of ['soft', 'balanced', 'chaotic'] as const) {
      expect(Object.keys(VHS_PRESETS[p]).sort()).toEqual(keys.sort());
      for (const k of keys) expect(Number.isFinite((VHS_PRESETS[p] as never as Record<string, number>)[k])).toBe(true);
    }
  });
});

describe('effectiveSmear', () => {
  it('suppresses smear while VHS owns temporal blending', () => {
    expect(effectiveSmear(0.25, true)).toBe(0);
  });
  it('passes the user setting through when VHS is off', () => {
    expect(effectiveSmear(0.25, false)).toBe(0.25);
    expect(effectiveSmear(0, false)).toBe(0);
  });
  it('never mutates the user setting — off after on restores it', () => {
    const user = 0.4;
    effectiveSmear(user, true);
    expect(effectiveSmear(user, false)).toBe(0.4);
  });
});

describe('POST_VHS_WGSL', () => {
  it('starts with its main fn — three anchors the wgslFn parse at ^', () => {
    expect(POST_VHS_WGSL.trimStart().startsWith('fn postVhs')).toBe(true);
  });
  it('declares the terms the preset table drives', () => {
    for (const term of ['intensity', 'blurAmount', 'noiseAmount', 'gradeAmount',
      'warpAmount', 'chromaAmount']) {
      expect(POST_VHS_WGSL).toContain(term);
    }
  });
  it('is WGSL, not GLSL — no leftover GLSL types or samplers', () => {
    expect(POST_VHS_WGSL).not.toContain('texture2D(');
    expect(POST_VHS_WGSL).not.toContain('sampler2D');
    expect(POST_VHS_WGSL).not.toMatch(/\bvarying\b/);
    expect(POST_VHS_WGSL).not.toMatch(/\bvec3 [a-zA-Z]/);
  });
  it('prefixes every helper per the house convention (boneHash, postAaOetf)', () => {
    // An unprefixed helper collides the first time this shader shares a
    // material with another that defines the same name.
    const fns = [...POST_VHS_WGSL.matchAll(/\bfn\s+([A-Za-z0-9_]+)\s*\(/g)].map(m => m[1]!);
    expect(fns.length).toBeGreaterThan(1);
    for (const f of fns) expect(f.startsWith('postVhs')).toBe(true);
  });
  it('has balanced braces', () => {
    const open = (POST_VHS_WGSL.match(/\{/g) ?? []).length;
    const close = (POST_VHS_WGSL.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});
