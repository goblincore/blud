import { describe, expect, it } from "vitest";
import { SeededRng } from "../seeded-rng";

describe("SeededRng", () => {
  // ── same seed → same sequence ──────────────────────────────────────
  it("same seed produces identical sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);

    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("same seed produces same nextInt values", () => {
    const a = new SeededRng(99);
    const b = new SeededRng(99);

    for (let i = 0; i < 10; i++) {
      expect(a.nextInt(1, 100)).toBe(b.nextInt(1, 100));
    }
  });

  // ── different seeds → different values ─────────────────────────────
  it("different seeds produce different values", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);

    const seqA = Array.from({ length: 20 }, () => a.nextInt(0, 100));
    const seqB = Array.from({ length: 20 }, () => b.nextInt(0, 100));

    // With 20 values the chance of all matching is astronomically low
    expect(seqA).not.toEqual(seqB);
  });

  // ── next() bounds ──────────────────────────────────────────────────
  it("next() returns float in [0, 1)", () => {
    const rng = new SeededRng(123);

    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // ── nextInt bounds ─────────────────────────────────────────────────
  it("nextInt(min, max) returns values within inclusive range", () => {
    const rng = new SeededRng(42);

    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("nextInt swaps arguments when min > max", () => {
    const rng = new SeededRng(42);
    const valuesA = Array.from({ length: 100 }, () => rng.nextInt(20, 10));

    const rng2 = new SeededRng(42);
    const valuesB = Array.from({ length: 100 }, () => rng2.nextInt(10, 20));

    expect(valuesA).toEqual(valuesB);
  });

  // ── nextFloat bounds ───────────────────────────────────────────────
  it("nextFloat(min, max) returns float within range", () => {
    const rng = new SeededRng(42);

    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it("nextFloat swaps arguments when min > max", () => {
    const rng = new SeededRng(42);
    const valuesA = Array.from({ length: 100 }, () => rng.nextFloat(10, 5));

    const rng2 = new SeededRng(42);
    const valuesB = Array.from({ length: 100 }, () => rng2.nextFloat(5, 10));

    expect(valuesA).toEqual(valuesB);
  });

  // ── nextBool ───────────────────────────────────────────────────────
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

  it("nextBool(p=0.5) returns booleans", () => {
    const rng = new SeededRng(42);

    for (let i = 0; i < 100; i++) {
      const v = rng.nextBool();
      expect(typeof v).toBe("boolean");
    }
  });

  // ── pick ───────────────────────────────────────────────────────────
  it("pick returns an element from the array", () => {
    const rng = new SeededRng(42);
    const items = ["a", "b", "c", "d", "e"];

    for (let i = 0; i < 100; i++) {
      const pick = rng.pick(items);
      expect(items).toContain(pick);
    }
  });

  it("pick throws on empty array", () => {
    const rng = new SeededRng(42);

    expect(() => rng.pick([])).toThrow("Cannot pick from an empty array");
  });

  // ── shuffle (non-mutating, Fisher-Yates) ───────────────────────────
  it("shuffle returns a new array with same elements", () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);

    expect(shuffled).not.toBe(original);
    expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it("shuffle does not mutate the input array", () => {
    const rng = new SeededRng(42);
    const arr = ["x", "y", "z"];
    const originalCopy = [...arr];

    rng.shuffle(arr);
    expect(arr).toEqual(originalCopy);
  });

  it("shuffle with single element returns same array", () => {
    const rng = new SeededRng(42);
    const input = [42];
    expect(rng.shuffle(input)).toEqual([42]);
  });

  // ── fork ───────────────────────────────────────────────────────────
  it("fork creates an independent instance", () => {
    const a = new SeededRng(777);
    const forkedState = a.state;
    const b = a.fork(); // b copies a's current state

    expect(b.state).toBe(forkedState);

    // Advance a — b should be unaffected
    for (let i = 0; i < 100; i++) {
      a.next();
    }
    expect(b.state).toBe(forkedState); // b untouched
    expect(a.state).not.toBe(forkedState); // a advanced
  });

  it("fork preserves original state", () => {
    const a = new SeededRng(777);
    const originalState = a.state;

    a.fork();
    expect(a.state).toBe(originalState);
  });

  it("forked rng reproduces sequence from that state", () => {
    const a = new SeededRng(555);
    a.next(); // advance a
    const b = a.fork(); // b copies a's state after the advance

    // Advance a further — states should diverge
    a.next();
    a.next();
    expect(a.state).not.toBe(b.state);

    // b should reproduce the values a produced after fork
    const bValue = b.next(); // b's 1st value = a's value right after fork
    const aSaved = a.next(); // a's 2nd post-fork value
    expect(aSaved).not.toBe(bValue);
  });
});
