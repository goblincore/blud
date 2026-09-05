import { describe, it, expect } from 'vitest';
import { SeededRng } from './seeded-rng';

describe('SeededRng', () => {
  describe('determinism', () => {
    it('same seed produces the same sequence', () => {
      const a = new SeededRng(42);
      const b = new SeededRng(42);
      for (let i = 0; i < 10; i++) {
        expect(a.next()).toBe(b.next());
      }
    });

    it('different seeds produce different values', () => {
      const a = new SeededRng(42);
      const b = new SeededRng(43);
      expect(a.next()).not.toBe(b.next());
    });
  });

  describe('nextInt', () => {
    it('returns value within [min, max] inclusive', () => {
      const rng = new SeededRng(0);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
        expect(Number.isInteger(val)).toBe(true);
      }
    });

    it('nextInt with same range and seed produces same values', () => {
      const a = new SeededRng(99);
      const b = new SeededRng(99);
      for (let i = 0; i < 10; i++) {
        expect(a.nextInt(0, 100)).toBe(b.nextInt(0, 100));
      }
    });
  });

  describe('nextFloat', () => {
    it('returns value within [min, max)', () => {
      const rng = new SeededRng(0);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextFloat(10, 20);
        expect(val).toBeGreaterThanOrEqual(10);
        expect(val).toBeLessThan(20);
      }
    });
  });

  describe('nextBool', () => {
    it('p=0 always returns false', () => {
      const rng = new SeededRng(12345);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it('p=1 always returns true', () => {
      const rng = new SeededRng(12345);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it('p=0.5 returns boolean values', () => {
      const rng = new SeededRng(42);
      const results: boolean[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(rng.nextBool(0.5));
      }
      // Not every value should be the same for a decent distribution
      const hasTrue = results.some(Boolean);
      const hasFalse = results.some((v) => !v);
      expect(hasTrue).toBe(true);
      expect(hasFalse).toBe(true);
    });
  });

  describe('pick', () => {
    it('returns an element from the array', () => {
      const arr = [10, 20, 30, 40, 50];
      const rng = new SeededRng(7);
      for (let i = 0; i < 100; i++) {
        const picked = rng.pick(arr);
        expect(arr).toContain(picked);
      }
    });

    it('single element array always returns that element', () => {
      const rng = new SeededRng(1);
      expect(rng.pick([42])).toBe(42);
    });
  });

  describe('shuffle', () => {
    it('contains the same elements as the original', () => {
      const original = [1, 2, 3, 4, 5];
      const rng = new SeededRng(55);
      for (let i = 0; i < 100; i++) {
        const shuffled = rng.shuffle(original);
        expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
      }
    });

    it('does not mutate the original array', () => {
      const original = [1, 2, 3, 4, 5];
      const copy = [...original];
      const rng = new SeededRng(55);
      rng.shuffle(original);
      expect(original).toEqual(copy);
    });

    it('same seed produces identical shuffle', () => {
      const a = new SeededRng(77);
      const b = new SeededRng(77);
      const arr = [1, 2, 3, 4, 5];
      expect(a.shuffle(arr)).toEqual(b.shuffle(arr));
    });
  });

  describe('fork', () => {
    it('produces a new instance that diverges from the original after calls', () => {
      const rng = new SeededRng(100);
      rng.next();
      const forked = rng.fork();
      forked.next();
      // forked advanced one more step, so its next() should differ from original
      const rng2 = new SeededRng(100);
      rng2.next();
      expect(rng2.next()).not.toBe(forked.next());
    });

    it('forked instance reproduces sequence from captured state', () => {
      const rng = new SeededRng(200);
      rng.next();
      rng.next();
      const forked = rng.fork();
      const forkedValue = forked.next();

      // Advance a fresh RNG to the same captured state
      const fresh = new SeededRng(200);
      expect(fresh.next()).not.toBe(forkedValue);
      fresh.next();
      expect(fresh.next()).toBe(forkedValue);
    });

    it('each fork captures the same state at the same point', () => {
      const rng = new SeededRng(300);
      rng.next();
      rng.next();
      const fork1 = rng.fork();
      const fork2 = rng.fork();
      expect(fork1.next()).toBe(fork2.next());
    });
  });
});
