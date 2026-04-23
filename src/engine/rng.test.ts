import { describe, it, expect } from 'vitest';
import { SeededRng } from './rng';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(12345);

    const values1: number[] = [];
    const values2: number[] = [];

    for (let i = 0; i < 5; i++) {
      values1.push(rng1.next());
      values2.push(rng2.next());
    }

    expect(values1).toEqual(values2);
  });

  it('different seeds produce different first values', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(54321);

    expect(rng1.next()).not.toBe(rng2.next());
  });

  it('nextInt respects min/max bounds', () => {
    const rng = new SeededRng(12345);
    const min = 10;
    const max = 20;

    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
    }
  });

  it('nextFloat respects min/max bounds', () => {
    const rng = new SeededRng(12345);
    const min = 10.5;
    const max = 20.5;

    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThan(max);
    }
  });

  it('nextBool with p=0 always false', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always true', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns only elements from the array', () => {
    const rng = new SeededRng(12345);
    const arr = ['a', 'b', 'c', 'd'];

    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle contains same elements, does not mutate input', () => {
    const rng = new SeededRng(12345);
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(original);

    // Same elements (sorted), different order (probably)
    expect([...shuffled].sort()).toEqual([...original].sort());
    expect(shuffled).not.toBe(original); // different reference
    expect(original).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input not mutated
  });

  it('fork produces independent instances from same state', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = rng1.fork();

    // Fork seeds from current state, so initial sequence is identical
    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    // Both sequences are deterministic and reproducible
    expect(seq1).toEqual(seq2);

    // But they are independent objects — advancing one doesn't affect the other
    const a = new SeededRng(42);
    const b = a.fork();
    a.next(); a.next(); a.next(); // advance a 3 times
    const aVal = a.next();
    b.next(); // advance b 1 time
    const bVal = b.next();
    // Different positions in the stream → different values
    expect(aVal).not.toBe(bVal);
  });
});
