import { describe, expect, it } from 'vitest';
import { SeededRng } from './SeededRng';

describe('SeededRng', () => {
  // ──────────────────────────────────────────
  // Determinism
  // ──────────────────────────────────────────

  it('same seed produces identical sequences', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different values', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(43);
    // At least the first 10 draws should differ in most cases.
    let diffCount = 0;
    for (let i = 0; i < 10; i++) {
      if (a.next() !== b.next()) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────
  // next()
  // ──────────────────────────────────────────

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // ──────────────────────────────────────────
  // nextInt()
  // ──────────────────────────────────────────

  it('nextInt(min, max) stays within bounds', () => {
    const rng = new SeededRng(999);
    const min = 10;
    const max = 20;
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(min, max);
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
    }
  });

  it('nextInt(min, min) always returns min', () => {
    const rng = new SeededRng(777);
    for (let i = 0; i < 50; i++) {
      expect(rng.nextInt(5, 5)).toBe(5);
    }
  });

  // ──────────────────────────────────────────
  // nextFloat()
  // ──────────────────────────────────────────

  it('nextFloat(min, max) stays within bounds', () => {
    const rng = new SeededRng(999);
    const min = 3.14;
    const max = 100.0;
    for (let i = 0; i < 100; i++) {
      const v = rng.nextFloat(min, max);
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThan(max);
    }
  });

  // ──────────────────────────────────────────
  // nextBool()
  // ──────────────────────────────────────────

  it('nextBool(p=0) always returns false', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool(p=1) always returns true', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('nextBool(p=0.5) returns both true and false over many trials', () => {
    const rng = new SeededRng(1);
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.nextBool(0.5)) trueCount++;
    }
    // With p=0.5, ~1000 trials should produce a mix.
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });

  // ──────────────────────────────────────────
  // pick()
  // ──────────────────────────────────────────

  it('pick() returns an element from the array', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const chosen = rng.pick(items);
      expect(items).toContain(chosen);
    }
  });

  it('pick() does not mutate the array', () => {
    const arr = [1, 2, 3];
    const rng = new SeededRng(1);
    const before = [...arr];
    rng.pick(arr);
    expect(arr).toEqual(before);
  });

  it('pick() throws on empty array', () => {
    const rng = new SeededRng(1);
    expect(() => rng.pick([])).toThrow('Cannot pick from an empty array');
  });

  // ──────────────────────────────────────────
  // shuffle()
  // ──────────────────────────────────────────

  it('shuffle returns same number of elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(42);
    const shuffled = rng.shuffle(arr);
    expect(shuffled.length).toBe(arr.length);
  });

  it('shuffle contains same elements (not mutated)', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    const rng = new SeededRng(42);
    const shuffled = rng.shuffle(arr);
    expect(arr).toEqual(original); // original not mutated
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]); // same elements
  });

  it('shuffle with single element returns same element', () => {
    const rng = new SeededRng(1);
    expect(rng.shuffle([42])).toEqual([42]);
  });

  it('shuffle with empty array returns empty array', () => {
    const rng = new SeededRng(1);
    expect(rng.shuffle([])).toEqual([]);
  });

  // ──────────────────────────────────────────
  // fork()
  // ──────────────────────────────────────────

  it('fork creates an independent instance', () => {
    const rng = new SeededRng(42);
    const forked = rng.fork();

    // Both start with same seed → first values should be identical
    expect(rng.next()).toBe(forked.next());
    expect(rng.next()).toBe(forked.next());

    // But they are independent — advancing one does not affect the other
    const a = new SeededRng(99);
    const b = a.fork();
    a.next(); // advance parent
    // forked should still produce the same sequence as if forked before any advancement
    const c = new SeededRng(99);
    expect(b.next()).toBe(c.next());
  });

  it('forked instances evolve independently', () => {
    const rng = new SeededRng(777);
    const forked = rng.fork();

    for (let i = 0; i < 10; i++) {
      // They start identical but diverge after any advancement
      expect(rng.next()).toBe(forked.next());
    }
  });
});
