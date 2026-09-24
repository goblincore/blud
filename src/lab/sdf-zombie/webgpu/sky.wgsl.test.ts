import { describe, expect, it } from 'vitest';
import { SKY_COLOR } from './sky.wgsl';
import { SKY_BAND_FALLOFF, SKY_BAND_GAIN, SKY_BELOW_GAIN, SKY_GRADIENT_EXP, SKY_HALO_GAIN } from './sky-color';

describe('SKY_COLOR pins its twin', () => {
  it('shares the twin constants', () => {
    for (const [k, v] of Object.entries({ SKY_GRADIENT_EXP, SKY_BAND_FALLOFF, SKY_BAND_GAIN, SKY_BELOW_GAIN, SKY_HALO_GAIN })) {
      expect(SKY_COLOR, k).toContain(v.toFixed(v % 1 === 0 ? 1 : String(v).split('.')[1]!.length));
    }
  });
  it('is one function', () => {
    expect(SKY_COLOR.match(/\bfn\s+\w+/g)).toEqual(['fn skyColor']);
  });
});
