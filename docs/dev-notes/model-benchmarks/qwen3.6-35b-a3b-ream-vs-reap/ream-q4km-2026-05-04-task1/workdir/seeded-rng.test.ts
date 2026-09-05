import { describe, it, expect } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  describe("determinism", () => {
    it("same seed produces identical sequence", () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);
      const count = 100;
      for (let i = 0; i < count; i++) {
        expect(rng1.next()).toBe(rng2.next());
      }
    });

    it("different seeds produce different values", () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(43);
      expect(rng1.next()).not.toBe(rng2.next());
    });

    it("sequence is reproducible across instances", () => {
      const rng = new SeededRng(12345);
      const values = Array.from({ length: 10 }, () => rng.next());

      const rng2 = new SeededRng(12345);
      for (let i = 0; i < values.length; i++) {
        expect(rng2.next()).toBe(values[i]);
      }
    });
  });

  describe("nextInt", () => {
    it("returns value within [min, max] inclusive", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextInt(5, 20);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(20);
      }
    });

    it("handles min === max", () => {
      const rng = new SeededRng(42);
      const val = rng.nextInt(7, 7);
      expect(val).toBe(7);
    });

    it("handles negative ranges", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(-10, -5);
        expect(val).toBeGreaterThanOrEqual(-10);
        expect(val).toBeLessThanOrEqual(-5);
      }
    });

    it("handles crossing zero", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(-5, 5);
        expect(val).toBeGreaterThanOrEqual(-5);
        expect(val).toBeLessThanOrEqual(5);
      }
    });

    it("different seeds produce different ints", () => {
      const rng1 = new SeededRng(1);
      const rng2 = new SeededRng(2);
      expect(rng1.nextInt(0, 1000)).not.toBe(rng2.nextInt(0, 1000));
    });
  });

  describe("nextFloat", () => {
    it("returns value within [min, max)", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextFloat(0, 100);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(100);
      }
    });

    it("handles negative ranges", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextFloat(-50, -10);
        expect(val).toBeGreaterThanOrEqual(-50);
        expect(val).toBeLessThan(-10);
      }
    });

    it("handles crossing zero", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextFloat(-25, 25);
        expect(val).toBeGreaterThanOrEqual(-25);
        expect(val).toBeLessThan(25);
      }
    });

    it("min === max returns min", () => {
      const rng = new SeededRng(42);
      expect(rng.nextFloat(5, 5)).toBe(5);
    });
  });

  describe("nextBool", () => {
    it("p=0 always returns false", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it("p=1 always returns true", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it("p=0.5 approximates 50% true", () => {
      const rng = new SeededRng(42);
      const trials = 10000;
      let countTrue = 0;
      for (let i = 0; i < trials; i++) {
        if (rng.nextBool(0.5)) countTrue++;
      }
      // Check it's roughly 50% (within 10%)
      expect(countTrue / trials).toBeGreaterThan(0.4);
      expect(countTrue / trials).toBeLessThan(0.6);
    });

    it("p=0.0 is same as always false", () => {
      const rng = new SeededRng(42);
      let countTrue = 0;
      for (let i = 0; i < 1000; i++) {
        if (rng.nextBool(0.0)) countTrue++;
      }
      expect(countTrue).toBe(0);
    });
  });

  describe("pick", () => {
    it("returns an element from the array", () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    });

    it("returns different elements across calls", () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const results = new Set<number>();
      for (let i = 0; i < 100; i++) {
        results.add(rng.pick(arr));
      }
      expect(results.size).toBeGreaterThan(1);
    });

    it("throws on empty array", () => {
      const rng = new SeededRng(42);
      expect(() => rng.pick([])).toThrow("pick called on empty array");
    });

    it("works with single-element array", () => {
      const rng = new SeededRng(42);
      expect(rng.pick([42])).toBe(42);
    });

    it("deterministic: same seed picks same values", () => {
      const rng1 = new SeededRng(99);
      const rng2 = new SeededRng(99);
      const arr = ["a", "b", "c", "d"];
      for (let i = 0; i < 20; i++) {
        expect(rng1.pick(arr)).toBe(rng2.pick(arr));
      }
    });
  });

  describe("shuffle", () => {
    it("contains same elements as input", () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(arr);
      const sorted = [...shuffled].sort((a, b) => a - b);
      expect(sorted).toEqual([1, 2, 3, 4, 5]);
    });

    it("does not mutate the original array", () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const original = [...arr];
      rng.shuffle(arr);
      expect(arr).toEqual(original);
    });

    it("returns different orders across calls", () => {
      const rng = new SeededRng(42);
      const arr = [1, 2, 3, 4, 5];
      const shuffled1 = rng.shuffle(arr);
      const shuffled2 = rng.shuffle(arr);
      expect(shuffled1).not.toEqual(shuffled2);
    });

    it("deterministic: same seed produces same shuffle", () => {
      const rng1 = new SeededRng(7);
      const rng2 = new SeededRng(7);
      const arr = [1, 2, 3, 4, 5, 6];
      expect(rng1.shuffle(arr)).toEqual(rng2.shuffle(arr));
    });

    it("works with single-element array", () => {
      const rng = new SeededRng(42);
      expect(rng.shuffle([42])).toEqual([42]);
    });

    it("works with empty array", () => {
      const rng = new SeededRng(42);
      expect(rng.shuffle([])).toEqual([]);
    });

    it("works with string arrays", () => {
      const rng = new SeededRng(42);
      const arr = ["a", "b", "c"];
      const shuffled = rng.shuffle(arr);
      expect(shuffled).toContain("a");
      expect(shuffled).toContain("b");
      expect(shuffled).toContain("c");
      expect(shuffled.length).toBe(3);
    });
  });

  describe("fork", () => {
    it("produces an independent instance", () => {
      const rng1 = new SeededRng(42);
      const _val = rng1.next(); // consume one value
      const rng2 = rng1.fork();

      // forked rng should produce same sequence as a fresh rng with same seed
      const fresh = new SeededRng(rng1.state);
      // They should be equal because fork captures the current state
      expect(rng2.next()).toBe(fresh.next());
    });

    it("is independent: modifying one does not affect the other", () => {
      const rng1 = new SeededRng(42);
      const rng2 = rng1.fork();

      // Advance rng1 but not rng2 — they should diverge
      rng1.next();
      expect(rng1.next()).not.toBe(rng2.next());
    });

    it("same state captured via fork yields same sequence", () => {
      const rng = new SeededRng(42);
      const _a = rng.next();
      const _b = rng.next();
      const _c = rng.next();
      const saved = rng.fork();

      const fresh = new SeededRng(rng.state);
      for (let i = 0; i < 50; i++) {
        expect(saved.next()).toBe(fresh.next());
      }
    });

    it("fork preserves exact state for reproducible branching", () => {
      const rng1 = new SeededRng(100);
      const branch1 = rng1.fork();
      const branch2 = rng1.fork();

      for (let i = 0; i < 100; i++) {
        expect(branch1.next()).toBe(branch2.next());
      }
    });
  });
});
