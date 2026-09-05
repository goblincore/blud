import { describe, it, expect } from "vitest";
import { SeededRng, createSeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  // ------------------------------------------------------------------
  // Determinism: same seed → identical sequence
  // ------------------------------------------------------------------
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);

    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produceSeededRng factory produces identical sequence", () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);

    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  // ------------------------------------------------------------------
  // Different seeds → different values
  // ------------------------------------------------------------------
  it("different seeds produce different values", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);

    expect(a.next()).not.toBe(b.next());
  });

  it("first 100 values differ between seeds", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);

    for (let i = 0; i < 100; i++) {
      expect(a.next()).not.toBe(b.next());
    }
  });

  // ------------------------------------------------------------------
  // next() returns float in [0, 1)
  // ------------------------------------------------------------------
  it("next() returns values in [0, 1)", () => {
    const rng = new SeededRng(999);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("next() can produce values very close to 0", () => {
    // With enough samples from a good PRNG we expect values near 0
    const rng = new SeededRng(42);
    let min = 1;
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      if (v < min) min = v;
    }
    expect(min).toBeLessThan(0.01);
  });

  it("next() can produce values very close to 1", () => {
    const rng = new SeededRng(42);
    let max = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      if (v > max) max = v;
    }
    expect(max).toBeGreaterThan(0.99);
  });

  // ------------------------------------------------------------------
  // nextInt(min, max) — inclusive bounds
  // ------------------------------------------------------------------
  it("nextInt returns values within bounds", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("nextInt includes both boundaries given enough samples", () => {
    const rng = new SeededRng(42);
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 100000; i++) {
      const v = rng.nextInt(10, 20);
      if (v === 10) sawMin = true;
      if (v === 20) sawMax = true;
      if (sawMin && sawMax) break;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it("nextInt with min === max returns that value", () => {
    const rng = new SeededRng(42);
    expect(rng.nextInt(5, 5)).toBe(5);
  });

  it("nextInt throws when min > max", () => {
    const rng = new SeededRng(42);
    expect(() => rng.nextInt(10, 5)).toThrow(RangeError);
  });

  it("nextInt works with negative bounds", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(-10, -5);
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThanOrEqual(-5);
    }
  });

  // ------------------------------------------------------------------
  // nextFloat(min, max) — half-open interval [min, max)
  // ------------------------------------------------------------------
  it("nextFloat returns values in [min, max)", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it("nextFloat produces values near the lower bound", () => {
    const rng = new SeededRng(42);
    let min = Infinity;
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextFloat(5, 10);
      if (v < min) min = v;
    }
    expect(min).toBeLessThan(5.01);
  });

  it("nextFloat produces values near the upper bound", () => {
    const rng = new SeededRng(42);
    let max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextFloat(5, 10);
      if (v > max) max = v;
    }
    expect(max).toBeGreaterThan(4.99);
  });

  it("nextFloat with equal bounds throws", () => {
    const rng = new SeededRng(42);
    expect(() => rng.nextFloat(5, 5)).toThrow(RangeError);
  });

  it("nextFloat with min > max throws", () => {
    const rng = new SeededRng(42);
    expect(() => rng.nextFloat(10, 5)).toThrow(RangeError);
  });

  // ------------------------------------------------------------------
  // nextBool(p)
  // ------------------------------------------------------------------
  it("nextBool(p=0) always returns false", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool(p=1) always returns true", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("nextBool(p=0.5) returns a mix of true and false", () => {
    const rng = new SeededRng(42);
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.nextBool(0.5)) trueCount++;
    }
    expect(trueCount).toBeGreaterThan(200);
    expect(trueCount).toBeLessThan(800);
  });

  // ------------------------------------------------------------------
  // pick(arr)
  // ------------------------------------------------------------------
  it("pick returns an element from the array", () => {
    const rng = new SeededRng(42);
    const arr = [10, 20, 30, 40, 50];
    for (let i = 0; i < 100; i++) {
      const v = rng.pick(arr);
      expect(arr).toContain(v);
    }
  });

  it("pick can return any element given enough samples", () => {
    const rng = new SeededRng(42);
    const arr = ["a", "b", "c"];
    const seen = new Set<string>();
    while (seen.size < arr.length) {
      seen.add(rng.pick(arr));
    }
    expect(seen).toEqual(new Set(arr));
  });

  it("pick throws on empty array", () => {
    const rng = new SeededRng(42);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("pick works with objects", () => {
    const rng = new SeededRng(42);
    const arr = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const result = rng.pick(arr);
    expect(arr).toContainEqual(result);
  });

  // ------------------------------------------------------------------
  // shuffle(arr) — non-mutating, Fisher-Yates
  // ------------------------------------------------------------------
  it("shuffle returns an array with the same elements", () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    const result = rng.shuffle(arr);
    expect(result.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(result.length).toBe(5);
  });

  it("shuffle does not mutate the original array", () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    rng.shuffle(arr);
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });

  it("shuffle produces different orderings with different seeds", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sA = a.shuffle(arr);
    const sB = b.shuffle(arr);
    // With different seeds they'll almost certainly differ
    expect(sA).not.toEqual(sB);
  });

  it("shuffle with same seed produces same order", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(1);
    const arr = [1, 2, 3, 4, 5];
    expect(a.shuffle(arr)).toEqual(b.shuffle(arr));
  });

  it("shuffle with one element returns a single-element array", () => {
    const rng = new SeededRng(42);
    expect(rng.shuffle([42])).toEqual([42]);
  });

  it("shuffle does not mutate when called multiple times", () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3];
    rng.shuffle(arr);
    rng.shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  // ------------------------------------------------------------------
  // fork() — independent instances
  // ------------------------------------------------------------------
  it("fork creates an independent instance", () => {
    const parent = new SeededRng(42);
    const child = parent.fork();

    // Parent and child produce different values
    expect(parent.next()).not.toBe(child.next());
  });

  it("forked child continues its own independent sequence", () => {
    const parent = new SeededRng(42);
    const child = parent.fork();

    // Child should produce its own deterministic sequence
    // (different from parent's subsequent values)
    const parentValues: number[] = [];
    const childValues: number[] = [];
    for (let i = 0; i < 100; i++) {
      parentValues.push(parent.next());
      childValues.push(child.next());
    }
    // Child's sequence must not be identical to parent's post-fork sequence
    expect(parentValues).not.toEqual(childValues);
  });

  it("fork preserves parent state for future calls", () => {
    const parent = new SeededRng(42);
    const _child = parent.fork();
    const afterFork = parent.next();

    const control = new SeededRng(42);
    // Consume the same number of values before the fork point
    // (fork consumes one value from parent via next())
    control.next();
    expect(afterFork).toBe(control.next());
  });

  it("multiple forks produce different values", () => {
    const rng = new SeededRng(42);
    const fork1 = rng.fork();
    const fork2 = rng.fork();
    expect(fork1.next()).not.toBe(fork2.next());
  });

  it("forked instances produce the same sequence when seeded the same way", () => {
    const forkA = new SeededRng(42).fork();
    const forkB = new SeededRng(42).fork();
    for (let i = 0; i < 10; i++) {
      expect(forkA.next()).toBe(forkB.next());
    }
  });
});
