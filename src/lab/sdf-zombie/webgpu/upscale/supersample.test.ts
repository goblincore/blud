import { describe, expect, it } from 'vitest';
import { accumulateSamples, float32ToBase64, jitterGrid, sampleOrder } from './supersample';

describe('supersample helpers (P3 spec §1)', () => {
  it('jitterGrid is a centred stratified grid whose offsets average to zero', () => {
    const g = jitterGrid(4);
    expect(g).toHaveLength(16);
    expect([...new Set(g.map((o) => o[0]))].sort((a, b) => a - b)).toEqual([-0.375, -0.125, 0.125, 0.375]);
    const sum = g.reduce((s, o) => [s[0] + o[0], s[1] + o[1]], [0, 0]);
    expect(sum).toEqual([0, 0]);
    expect(jitterGrid(1)).toEqual([[0, 0]]);
    expect(() => jitterGrid(0)).toThrow(/positive integer/);
  });

  it('sampleOrder puts the centre-most offsets first, deterministically', () => {
    const order = sampleOrder(jitterGrid(4));
    expect(order.slice(0, 4).every((o) => Math.abs(o[0]) === 0.125 && Math.abs(o[1]) === 0.125)).toBe(true);
    expect(order[0]).toEqual([-0.125, -0.125]);
    expect(sampleOrder(jitterGrid(4))).toEqual(order);
    expect(order).toHaveLength(16);
  });

  it('accumulateSamples: majority coverage, mean colour over hits, depth from the first hit', () => {
    const px = (r: number, g: number, b: number, d: number) => [r, g, b, d];
    const miss = [0, 0, 0, 1];
    // 2x1 image, 4 samples. Pixel 0: hits in samples 0, 1, 3. Pixel 1: one hit.
    const samples = [
      new Float32Array([...px(1, 0, 0, 0.3), ...miss]),
      new Float32Array([...px(0, 1, 0, 0.4), ...miss]),
      new Float32Array([...miss, ...miss]),
      new Float32Array([...px(0, 0, 1, 0.5), ...px(1, 1, 1, 0.2)]),
    ];
    const { target, coverage } = accumulateSamples(samples, 2, 1);
    expect(Array.from(target.subarray(0, 3)).map((v) => Number(v.toFixed(6)))).toEqual([0.333333, 0.333333, 0.333333]);
    expect(target[3]).toBe(Math.fround(0.3));
    expect(Array.from(target.subarray(4, 8))).toEqual([0, 0, 0, 1]);
    expect(Array.from(coverage)).toEqual([0.75, 0.25]);
  });

  it('a tie (k = n / 2) counts as covered', () => {
    const hit = new Float32Array([0.5, 0.5, 0.5, 0.6]);
    const miss = new Float32Array([0, 0, 0, 1]);
    const { target, coverage } = accumulateSamples([miss, hit, miss, hit], 1, 1);
    expect(coverage[0]).toBe(0.5);
    expect(target[3]).toBe(Math.fround(0.6));
  });

  it('rejects samples of the wrong size', () => {
    expect(() => accumulateSamples([new Float32Array(4), new Float32Array(8)], 1, 1)).toThrow(/sample 1/);
  });

  it('float32ToBase64 round-trips', () => {
    const data = new Float32Array([1.5, -2, 0.1, 1e-7]);
    const bin = atob(float32ToBase64(data));
    const back = new Float32Array(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});
