// src/lab/sdf-zombie/webgpu/train-window.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { TRAIN_WINDOW } from './train-window.wgsl';

describe('train-window.wgsl', () => {
  it('declares one fn and uses the twin\'s silhouette coefficients', () => {
    expect(TRAIN_WINDOW.trim().startsWith('fn trainWindow(')).toBe(true);
    expect(TRAIN_WINDOW.match(/\bfn /g)).toHaveLength(1);
    for (const lit of ['0.55 + 0.25 * sin(', '0.12 * sin(', '2.7 + 1.3', '0.08 * sin(', '6.1 + 4.1']) expect(TRAIN_WINDOW).toContain(lit);
  });
});

describe('the storm window (dynamic light spec §3)', () => {
  it('declares one fn per string; the silhouettes match the calm view', async () => {
    const { TRAIN_STORM, STORM_HASH, STORM_NOISE } = await import('./train-window.wgsl');
    for (const [src, name] of [[TRAIN_STORM, 'trainStorm'], [STORM_HASH, 'stormHash'], [STORM_NOISE, 'stormNoise']] as const) {
      expect(src.trim().startsWith(`fn ${name}(`)).toBe(true);
      expect(src.match(/\bfn /g)).toHaveLength(1);
    }
    for (const lit of ['0.55 + 0.25 * sin(', '2.7 + 1.3', '6.1 + 4.1']) expect(TRAIN_STORM).toContain(lit);
    expect(TRAIN_STORM).toContain('stormNoise(');
    expect(TRAIN_STORM).toContain('stormHash(');
  });
});
