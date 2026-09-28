// src/lab/sdf-zombie/webgpu/post-contrast.test.ts
import { describe, expect, it } from 'vitest';
import { CONTRAST_DEFAULT, CONTRAST_PIVOT_DEFAULT, CONTRAST_WGSL, sCurve } from './post-contrast.wgsl';

const enc = (c: number) => Math.pow(c, 1 / 2.2);

describe('final S-curve (post-contrast.wgsl.ts)', () => {
  it('k 0 is the identity; ships at the owner pick, gentle 0.25', () => {
    expect(CONTRAST_DEFAULT).toBe(0.25);
    for (const c of [0, 0.01, 0.2, 0.7, 1]) expect(sCurve(c, 0, CONTRAST_PIVOT_DEFAULT)).toBe(c);
  });
  it('black, white and the pivot are fixed; below sinks, above lifts', () => {
    const p = CONTRAST_PIVOT_DEFAULT, pl = Math.pow(p, 2.2);
    for (const k of [0.25, 0.5]) {
      expect(sCurve(0, k, p)).toBe(0);
      expect(sCurve(1, k, p)).toBeCloseTo(1, 9);
      expect(sCurve(pl, k, p)).toBeCloseTo(pl, 9);
      expect(sCurve(Math.pow(0.1, 2.2), k, p)).toBeLessThan(Math.pow(0.1, 2.2));
      expect(sCurve(Math.pow(0.4, 2.2), k, p)).toBeGreaterThan(Math.pow(0.4, 2.2));
    }
  });
  it('monotonic, and the darks never clamp flat (never flat black)', () => {
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const y = enc(sCurve(Math.pow(d, 2.2), 0.5, CONTRAST_PIVOT_DEFAULT));
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(enc(sCurve(Math.pow(0.05, 2.2), 0.5, CONTRAST_PIVOT_DEFAULT))).toBeGreaterThan(0.02);
  });
  it('the WGSL is the same two-sided power', () => {
    expect(CONTRAST_WGSL).toContain('let lo = pivot * pow(d / pivot, vec3<f32>(e));');
    expect(CONTRAST_WGSL).toContain('if (k <= 0.0) { return c; }');
  });
});
