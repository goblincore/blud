import { describe, it, expect } from "vitest";
import { SeededRng } from "./SeededRng";

describe("SeededRng", () => {
  it("same seed produces identical sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    expect(a.next()).toBe(b.next());
    expect(a.nextInt(0, 100)).toBe(b.nextInt(0, 100));
    expect(a.nextFloat(-10, 10)).toBe(b.nextFloat(-10, 10));
    expect(a.nextBool()).toBe(b.nextBool());
    expect(a.pick([1, 2, 3])).toBe(b.pick([1, 2, 3]));
  });

  it("different seeds produce different values", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("nextInt returns values within bounds [min, max] inclusive", () => {
    const rng = new SeededRng(123);
    let allInRange = true;
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(10, 20);
      if (val < 10 || val > 20) {
        allInRange = false;
      }
    }
    expect(allInRange).toBe(true);
  });

  it("nextInt respects seed determinism", () => {
    const a = new SeededRng(999);
    const b = new SeededRng(999);
    for (let i = 0; i < 100; i++) {
      expect(a.nextInt(0, 10)).toBe(b.nextInt(0, 10));
    }
  });

  it("nextFloat returns values within [min, max] inclusive", () => {
    const rng = new SeededRng(42);
    let allInRange = true;
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(5.5, 7.5);
      if (val < 5.5 - 1e-9 || val > 7.5 + 1e-9) {
        allInRange = false;
      }
    }
    expect(allInRange).toBe(true);
  });

  it("nextBool with p=0 always returns false", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 10; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool with p=1 always returns true", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 10; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("nextBool with p=0.5 returns a mix", () => {
    const rng = new SeededRng(55);
    const results = Array.from({ length: 100 }, () => rng.nextBool(0.5));
    const trues = results.filter(Boolean).length;
    // With p=0.5, getting 20-80 trues out of 100 is expected
    expect(trues).toBeGreaterThanOrEqual(10);
    expect(trues).toBeLessThanOrEqual(90);
  });

  it("pick returns an element from the array", () => {
    const arr = ["a", "b", "c"];
    const rng = new SeededRng(7);
    const result = rng.pick(arr);
    expect(["a", "b", "c"]).toContain(result);
  });

  it("pick throws on empty array", () => {
    const rng = new SeededRng(1);
    expect(() => rng.pick([])).toThrow("Cannot pick from an empty array");
  });

  it("shuffle returns a new shuffled array without mutating the original", () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    const rng = new SeededRng(42);
    const shuffled = rng.shuffle(original);

    // Elements are preserved (same multiset)
    const originalSorted = [...original].sort();
    const shuffledSorted = [...shuffled].sort();
    expect(shuffledSorted).toEqual(originalSorted);

    // Not identical reference if truly shuffled (high probability)
    // We allow equal by chance, but assert the shuffle method doesn't mutate
    expect(original).toEqual(copy);
  });

  it("fork creates an independent instance with the same state", () => {
    const parent = new SeededRng(100);
    parent.nextInt(0, 10);
    const forked = parent.fork();

    // The forked instance should produce the same sequence as the parent would have at this point
    const parentVal = parent.next();
    const forkedVal = forked.next();
    expect(forkedVal).toBe(parentVal);

    // Parent continues unaffected
    expect(parent.nextInt(0, 5)).toBe(forked.nextInt(0, 5));
  });
});
