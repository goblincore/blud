import { describe, it, expect } from 'vitest';
import { SeededRng } from './SeededRng';

describe('SeededRng', () => {
  it('same seed produces identical sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 1e-9);
    }
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    expect(rng1.next()).not.toEqual(rng2.next());
  });

  describe('nextInt', () => {
    it('returns value within bounds [min, max]', () => {
      const rng = new SeededRng(99);
      for (let i = 0; i < 100; i++) {
        const value = rng.nextInt(10, 20);
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThanOrEqual(20);
      }
    });

    it('throws if min > max', () => {
      const rng = new SeededRng(42);
      expect(() => rng.nextInt(10, 5)).toThrow(RangeError);
    });
  });

  describe('nextFloat', () => {
    it('returns value within bounds [min, max]', () => {
      const rng = new SeededRng(99);
      for (let i = 0; i < 100; i++) {
        const value = rng.nextFloat(1.5, 3.5);
        expect(value).toBeGreaterThanOrEqual(1.5 - 1e-9);
        expect(value).toBeLessThanOrEqual(3.5 + 1e-9);
      }
    });

    it('throws if min > max', () => {
      const rng = new SeededRng(42);
      expect(() => rng.nextFloat(10, 5)).toThrow(RangeError);
    });
  });

  describe('nextBool', () => {
    it('p=0 always returns false', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it('p=1 always returns true', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it('p=0.5 returns mix of booleans', () => {
      const rng = new SeededRng(42);
      let falseCount = 0;
      let trueCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (rng.nextBool()) trueCount++;
        else falseCount++;
      }
      expect(trueCount).toBeGreaterThan(0);
      expect(falseCount).toBeGreaterThan(0);
    });
  });

  describe('pick', () => {
    it('returns an element from the array', () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    });

    it('throws on empty array', () => {
      const rng = new SeededRng(42);
      expect(() => rng.pick([])).toThrow(RangeError);
    });
  });

  describe('shuffle', () => {
    it('returns a shuffled copy with same elements', () => {
      const rng = new SeededRng(42);
      const original = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(original);
      expect(shuffled).not.toBe(original);
      expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not mutate the original array', () => {
      const rng = new SeededRng(42);
      const original = [1, 2, 3, 4, 5];
      const copyBefore = [...original];
      rng.shuffle(original);
      expect(original).toEqual(copyBefore);
    });
  });

  describe('fork', () => {
    it('returns an independent instance', () => {
      const rng = new SeededRng(42);
      const forked = rng.fork();
      expect(forked.next()).not.toBeCloseTo(rng.next(), 1e-9);
    });

    it('forked and parent evolve independently', () => {
      const rng = new SeededRng(42);
      rng.next();
      const forked = rng.fork();
      const parentVal = rng.next();
      const forkVal = forked.next();
      expect(parentVal).not.toEqual(forkVal);
    });
  });
});
