import { describe, it, expect } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  describe("deterministic seeding", () => {
    it("same seed produces same sequence", () => {
      const a = new SeededRng(42);
      const b = new SeededRng(42);
      expect(a.next()).toBe(b.next());
      expect(a.next()).toBe(b.next());
      expect(a.nextInt(0, 100)).toBe(b.nextInt(0, 100));
    });

    it("different seeds produce different values", () => {
      const a = new SeededRng(42);
      const b = new SeededRng(137);
      expect(a.next()).not.toBe(b.next());
    });
  });

  describe("nextInt", () => {
    it("returns values within [min, max] inclusive", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(10, 20);
        expect(val).toBeGreaterThanOrEqual(10);
        expect(val).toBeLessThanOrEqual(20);
      }
    });

    it("returns min when min === max", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 10; i++) {
        expect(rng.nextInt(5, 5)).toBe(5);
      }
    });
  });

  describe("nextFloat", () => {
    it("returns values in [min, max)", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextFloat(3.14, 7.28);
        expect(val).toBeGreaterThanOrEqual(3.14);
        expect(val).toBeLessThan(7.28);
      }
    });
  });

  describe("nextBool", () => {
    it("p = 0 always returns false", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it("p = 1 always returns true", () => {
      const SeededRng2 = SeededRng;
      const rng = new SeededRng2(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });
  });

  describe("pick", () => {
    it("returns an element from the array", () => {
      const rng = new SeededRng(42);
      const arr = ["a", "b", "c", "d"];
      for (let i = 0; i < 50; i++) {
        const picked = rng.pick(arr);
        expect(arr).toContain(picked);
      }
    });

    it("throws on empty array", () => {
      const rng = new SeededRng(42);
      expect(() => rng.pick([])).toThrow("non-empty");
    });
  });

  describe("shuffle", () => {
    it("returns a new array with same elements (non-mutating)", () => {
      const rng = new SeededRng(42);
      const original = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(original);
      expect(shuffled).not.toBe(original);
      expect(shuffled.length).toBe(original.length);
      expect(shuffled.sort((a, b) => a - b)).toEqual(original.sort((a, b) => a - b));
    });

    it("does not mutate the original array", () => {
      const rng = new SeededRng(42);
      const original = [1, 2, 3];
      const before = [...original];
      rng.shuffle(original);
      expect(original).toEqual(before);
    });
  });

  describe("fork", () => {
    it("creates an independent instance", () => {
      const rng = new SeededRng(42);
      rng.next(); // advance state
      const forked = rng.fork();
      // forked starts from same state, so next() matches
      expect(forked.next()).toBe(rng.next());
      // but advancing forked doesn't affect rng's sequence
      forked.next();
      // forked has now consumed 2 steps, rng has consumed 1
      expect(forked.next()).not.toBe(rng.next());
    });

    it("forked sequence is independent from parent", () => {
      const rng = new SeededRng(123);
      rng.next();
      const forked = rng.fork();
      rng.next();
      const forkedVals = [forked.next(), forked.next(), forked.next()];
      const parentVals = [rng.next(), rng.next(), rng.next()];
      expect(forkedVals).not.toEqual(parentVals);
    });
  });
});
