import { describe, it, expect } from 'vitest';
import { SeededRng } from './seeded-rng';

// ── Determinism: same seed → same sequence ──────────────────────

describe('determinism', () => {
  it('same seed produces identical sequences', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    for (let i = 0; i < 20; i++) {
      expect(rng1.nextInt(0, 100)).toBe(rng2.nextInt(0, 100));
    }
  });

  it('same seed produces identical floats too', () => {
    const a = new SeededRng(7);
    const b = new SeededRng(7);

    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBeCloseTo(b.next(), 10);
    }
  });
});

// ── Different seeds → different values ──────────────────────────

describe('different seeds', () => {
  it('different seeds yield different sequences', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);

    // With overwhelming probability, the first few values differ
    let diffCount = 0;
    for (let i = 0; i < 50; i++) {
      if (rng1.nextInt(0, 100) !== rng2.nextInt(0, 100)) {
        diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(40);
  });
});

// ── nextInt ─────────────────────────────────────────────────────

describe('nextInt', () => {
  it('returns value within [min, max]', () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('handles min > max by swapping', () => {
    const rng = new SeededRng(1);
    const v = rng.nextInt(20, 10);
    expect(v).toBeGreaterThanOrEqual(10);
    expect(v).toBeLessThanOrEqual(20);
  });

  it('single-element range always returns that element', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 50; i++) {
      expect(rng.nextInt(5, 5)).toBe(5);
    }
  });
});

// ── nextFloat ───────────────────────────────────────────────────

describe('nextFloat', () => {
  it('returns value within [min, max)', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextFloat(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it('handles min > max by swapping', () => {
    const rng = new SeededRng(1);
    const v = rng.nextFloat(15, 5);
    expect(v).toBeGreaterThanOrEqual(5);
    expect(v).toBeLessThan(15);
  });

  it('point range always returns min', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 50; i++) {
      expect(rng.nextFloat(7, 7)).toBe(7);
    }
  });
});

// ── nextBool ────────────────────────────────────────────────────

describe('nextBool', () => {
  it('p=0 always returns false', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('p=1 always returns true', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('p=0.5 returns both true and false over many calls', () => {
    const rng = new SeededRng(55);
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.nextBool(0.5)) trueCount++;
    }
    // Should be roughly 500 ± reasonable deviation
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });
});

// ── pick ─────────────────────────────────────────────────────────

describe('pick', () => {
  it('returns element from non-empty array', () => {
    const rng = new SeededRng(1);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 30; i++) {
      const el = rng.pick(arr);
      expect(el).toBeDefined();
      expect(arr).toContain(el);
    }
  });

  it('returns undefined for empty array', () => {
    const rng = new SeededRng(1);
    expect(rng.pick([])).toBeUndefined();
  });
});

// ── shuffle ─────────────────────────────────────────────────────

describe('shuffle', () => {
  it('preserves same elements (permutation)', () => {
    const rng = new SeededRng(1);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(arr);

    expect(shuffled).toHaveLength(arr.length);
    expect(new Set(shuffled)).toEqual(new Set(arr));
  });

  it('does NOT mutate the original array', () => {
    const rng = new SeededRng(1);
    const arr = [1, 2, 3, 4, 5];
    const before = [...arr];
    rng.shuffle(arr);
    expect(arr).toEqual(before);
  });

  it('empty array returns empty array', () => {
    const rng = new SeededRng(1);
    expect(rng.shuffle([])).toEqual([]);
  });
});

// ── fork ─────────────────────────────────────────────────────────

describe('fork', () => {
  it('fork produces an independent RNG', () => {
    const parent = new SeededRng(42);
    const child = parent.fork();

    // Parent and child diverge immediately
    expect(parent.nextInt(0, 100)).not.toBe(child.nextInt(0, 100));

    // They each advance independently
    const pVals = Array.from({ length: 10 }, () => parent.nextInt(0, 100));
    const cVals = Array.from({ length: 10 }, () => child.nextInt(0, 100));
    expect(pVals).not.toEqual(cVals);
  });

  it('multiple forks from same parent are independent', () => {
    const parent = new SeededRng(1);
    const f1 = parent.fork();
    const f2 = parent.fork();
    const f3 = parent.fork();

    // Compare several values so collision is vanishingly unlikely
    for (let i = 0; i < 20; i++) {
      expect(f1.nextInt(0, 1000)).not.toBe(f2.nextInt(0, 1000));
    }
    for (let i = 0; i < 20; i++) {
      expect(f2.nextInt(0, 1000)).not.toBe(f3.nextInt(0, 1000));
    }
  });
});
