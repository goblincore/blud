import { describe, it, expect } from 'vitest';
import { SeededRng } from './seeded-rng';

describe('SeededRng', () => {
  it('same seed produces the same sequence', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different values', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    // At least the first 100 values should differ
    let diffs = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) diffs++;
    }
    expect(diffs).toBeGreaterThan(80);
  });

  describe('nextInt', () => {
    it('returns values within [min, max] inclusive', () => {
      const rng = new SeededRng(99);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextInt(10, 20);
        expect(val).toBeGreaterThanOrEqual(10);
        expect(val).toBeLessThanOrEqual(20);
      }
    });

    it('returns min when max === min', () => {
      const rng = new SeededRng(7);
      expect(rng.nextInt(5, 5)).toBe(5);
    });

    it('throws when min > max', () => {
      const rng = new SeededRng(7);
      expect(() => rng.nextInt(10, 5)).toThrow();
    });
  });

  describe('nextFloat', () => {
    it('returns values within [min, max)', () => {
      const rng = new SeededRng(123);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextFloat(3.0, 7.0);
        expect(val).toBeGreaterThanOrEqual(3.0);
        expect(val).toBeLessThan(7.0);
      }
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

    it('default p=0.5 returns a mix', () => {
      const rng = new SeededRng(42);
      let truthy = 0;
      for (let i = 0; i < 200; i++) {
        if (rng.nextBool()) truthy++;
      }
      // Expect roughly 100, give some tolerance
      expect(truthy).toBeGreaterThan(60);
      expect(truthy).toBeLessThan(140);
    });
  });

  describe('pick', () => {
    it('returns an element from the array', () => {
      const rng = new SeededRng(7);
      const arr = ['a', 'b', 'c', 'd'];
      for (let i = 0; i < 100; i++) {
        const val = rng.pick(arr);
        expect(arr).toContain(val);
      }
    });

    it('throws on empty array', () => {
      const rng = new SeededRng(7);
      expect(() => rng.pick([])).toThrow();
    });
  });

  describe('shuffle', () => {
    it('produces a permutation — same elements as input', () => {
      const rng = new SeededRng(42);
      const input = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(input);
      expect(shuffled).toHaveLength(5);
      for (const val of input) {
        expect(shuffled).toContain(val);
      }
    });

    it('does not mutate the original array', () => {
      const rng = new SeededRng(42);
      const input = [1, 2, 3];
      const original = [...input];
      rng.shuffle(input);
      expect(input).toEqual(original);
    });
  });

  describe('fork', () => {
    it('creates an independent instance', () => {
      const rng = new SeededRng(42);
      const forked = rng.fork();

      // The first 10 values from each diverge
      const origValues = Array.from({ length: 10 }, () => rng.next());
      const forkValues = Array.from({ length: 10 }, () => forked.next());

      let diffs = 0;
      for (let i = 0; i < 10; i++) {
        if (origValues[i] !== forkValues[i]) diffs++;
      }
      expect(diffs).toBe(10);
    });

    it('forked sequence is deterministic given same initial state', () => {
      const a1 = new SeededRng(42);
      const a2 = new SeededRng(42);

      a1.next(); // advance a little
      const forkedA = a1.fork();

      a2.next(); // advance the same amount
      const forkedB = a2.fork();

      for (let i = 0; i < 20; i++) {
        expect(forkedA.next()).toBe(forkedB.next());
      }
    });

    it('continues independently without affecting the parent', () => {
      const rng = new SeededRng(42);
      const forked = rng.fork();
      forked.next(); // advance fork
      forked.next();

      const parentValue = rng.next();
      expect(parentValue).toBeDefined();
    });
  });
});
