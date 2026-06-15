import { describe, it, expect } from 'vitest';
import { mulberry32, chance, type Rng } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds give different sequences', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('chance (NotBlood Chance fixed-point)', () => {
  it('0x8000 ≈ 50% over many rolls', () => {
    const r = mulberry32(99);
    let t = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (chance(r, 0x8000)) t++;
    expect(t / N).toBeGreaterThan(0.47);
    expect(t / N).toBeLessThan(0.53);
  });

  it('0x4000 ≈ 25%', () => {
    const r = mulberry32(99);
    let t = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (chance(r, 0x4000)) t++;
    expect(t / N).toBeGreaterThan(0.22);
    expect(t / N).toBeLessThan(0.28);
  });

  it('0 is never, 0x10000 is always', () => {
    const r = mulberry32(1);
    expect(chance(r, 0)).toBe(false);
    expect(chance(r, 0x10000)).toBe(true);
  });
});
