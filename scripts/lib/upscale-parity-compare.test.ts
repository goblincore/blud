import { describe, expect, it } from 'vitest';
import type { FloatImage } from '../../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';
import { compareReconstruction } from './upscale-parity-compare';

const img = (values: number[][]): FloatImage => ({ w: values.length, h: 1, c: 4, data: Float32Array.from(values.flat()) });

describe('G3 parity comparison', () => {
  const theirs = img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10, 0, 0, 0.25]]);
  const margins = Float32Array.from([0.5, -0.5, 0.5]);

  it('passes identical reconstructions', () => {
    expect(compareReconstruction(img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10, 0, 0, 0.25]]), theirs, margins))
      .toEqual({ pixels: 3, covered: 2, maxRelRgb: 0, depthMismatch: 0, coverageMismatch: 0, coverageMismatchFar: 0, pass: true });
  });

  it('measures colour relative to max(1, |theirs|)', () => {
    const r = compareReconstruction(img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10.002, 0, 0, 0.25]]), theirs, margins);
    expect(r.maxRelRgb).toBeCloseTo(2e-4, 6);
    expect(r.pass).toBe(false);
  });

  it('requires exact depth', () => {
    const r = compareReconstruction(img([[1, 2, 3, 0.5000001], [0, 0, 0, 1], [10, 0, 0, 0.25]]), theirs, margins);
    expect(r.depthMismatch).toBe(1);
    expect(r.pass).toBe(false);
  });

  it('tolerates coverage flips only inside the band', () => {
    const flipped = img([[1, 2, 3, 0.5], [5, 5, 5, 0.3], [10, 0, 0, 0.25]]);
    expect(compareReconstruction(flipped, theirs, Float32Array.from([0.5, 5e-4, 0.5])).pass).toBe(true);
    const far = compareReconstruction(flipped, theirs, Float32Array.from([0.5, -0.2, 0.5]));
    expect(far).toMatchObject({ coverageMismatch: 1, coverageMismatchFar: 1, pass: false });
  });

  it('refuses mismatched sizes', () => {
    expect(() => compareReconstruction(img([[0, 0, 0, 1]]), theirs, margins)).toThrow(/vs/);
  });
});
