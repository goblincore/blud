// src/sim/rng.test.ts
import { describe, it, expect } from 'vitest';
import { createRng, nextU32, random, chance, randomInt } from './rng';

describe('sim rng — determinism & serializable state', () => {
  it('same seed → same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it('different seed → different sequence', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(nextU32(a)).not.toBe(nextU32(b));
  });

  it('state is plain serializable data and can be resumed', () => {
    const r = createRng(99);
    nextU32(r); nextU32(r);
    const resumed = { a: r.a };          // snapshot the state
    const a1 = nextU32(r);
    const a2 = nextU32(resumed);
    expect(a2).toBe(a1);                 // resuming the snapshot reproduces
  });

  it('random() is in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = random(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('chance(0) is never true, chance(0x10000) is always true', () => {
    const r = createRng(7);
    for (let i = 0; i < 50; i++) {
      expect(chance(r, 0)).toBe(false);
      expect(chance(r, 0x10000)).toBe(true);
    }
  });

  it('randomInt(n) is in [0, n)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = randomInt(r, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
