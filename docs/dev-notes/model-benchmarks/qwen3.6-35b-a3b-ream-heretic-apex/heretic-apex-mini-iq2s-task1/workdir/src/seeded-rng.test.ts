import { describe, expect, it } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  describe("determinism", () => {
    it("same seed produces same sequence", () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
      }
    });

    it("different seeds produce different values", () => {
      const rng1 = new SeededRng(1);
      const rng2 = new SeededRng(2);
      // First call should differ
      expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
    });

    it("same seed different instances produce identical first N values", () => {
      const values1: number[] = [];
      const values2: number[] = [];
      const rng1 = new SeededRng(999);
      const rng2 = new SeededRng(999);
      for (let i = 0; i < 10; i++) {
        values1.push(rng1.next());
        values2.push(rng2.next());
      }
      for (let i = 0; i < 10; i++) {
        expect(values1[i]).toBeCloseTo(values2[i], 10);
      }
    });
  });

  describe("next()", () => {
    it("returns value in [0, 1)", () => {
      const rng = new SeededRng(123);
      for (let i = 0; i < 1000; i++) {
        const val = rng.next();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it("does not repeat values (statistical check)", () => {
      const rng = new SeededRng(1);
      const seen = new Set<number>();
      for (let i = 0; i < 10000; i++) {
        seen.add(rng.next());
      }
      // Mulberry32 has period 2^32, 10000 draws should have no collision
      expect(seen.size).toBe(10000);
    });
  });

  describe("nextInt()", () => {
    it("returns value within [min, max] inclusive", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextInt(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it("handles min > max by swapping", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(10, 5);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it("returns correct range with min === max", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextInt(7, 7)).toBe(7);
      }
    });

    it("handles negative ranges", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(-5, 5);
        expect(val).toBeGreaterThanOrEqual(-5);
        expect(val).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("nextFloat()", () => {
    it("returns value in [min, max)", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextFloat(0, 10);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(10);
      }
    });

    it("handles negative ranges", () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.nextFloat(-5, 5);
        expect(val).toBeGreaterThanOrEqual(-5);
        expect(val).toBeLessThan(5);
      }
    });
  });

  describe("nextBool()", () => {
    it("p=0 always returns false", () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it("p=1 always returns true", () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it("p=0.5 returns roughly half true", () => {
      const rng = new SeededRng(42);
      let trueCount = 0;
      const trials = 10000;
      for (let i = 0; i < trials; i++) {
        if (rng.nextBool(0.5)) trueCount++;
      }
      // Should be within 10% of 50%
      expect(trueCount).toBeGreaterThan(trials * 0.4);
      expect(trueCount).toBeLessThan(trials * 0.6);
    });

    it("p=0.9 returns mostly true", () => {
      const rng = new SeededRng(42);
      let trueCount = 0;
      const trials = 1000;
      for (let i = 0; i < trials; i++) {
        if (rng.nextBool(0.9)) trueCount++;
      }
      expect(trueCount).toBeGreaterThan(trials * 0.85);
    });
  });

  describe("pick()", () => {
    it("returns an element from the array", () => {
      const arr = [1, 2, 3, 4, 5];
      const rng = new SeededRng(42);
      const result = rng.pick(arr);
      expect(arr).toContain(result);
    });

    it("returns undefined for empty array", () => {
      const rng = new SeededRng(42);
      expect(rng.pick<number>([])).toBeUndefined();
    });

    it("does not mutate the original array", () => {
      const arr = [1, 2, 3];
      const original = [...arr];
      const rng = new SeededRng(42);
      rng.pick(arr);
      expect(arr).toEqual(original);
    });
  });

  describe("shuffle()", () => {
    it("returns array with same elements", () => {
      const arr = [1, 2, 3, 4, 5];
      const rng = new SeededRng(42);
      const shuffled = rng.shuffle(arr);
      expect(shuffled).toHaveLength(arr.length);
      expect(shuffled.sort()).toEqual(arr.sort());
    });

    it("does not mutate the original array", () => {
      const arr = [1, 2, 3, 4, 5];
      const original = [...arr];
      const rng = new SeededRng(42);
      rng.shuffle(arr);
      expect(arr).toEqual(original);
    });

    it("returns different order most of the time", () => {
      const arr = [1, 2, 3, 4, 5, 6];
      const rng = new SeededRng(42);
      const shuffled = rng.shuffle(arr);
      // Very low probability that all elements stay in place
      const same = arr.every((v, i) => v === shuffled[i]);
      expect(same).toBe(false);
    });

    it("empty array shuffles to empty", () => {
      const rng = new SeededRng(42);
      expect(rng.shuffle<number>([])).toEqual([]);
    });
  });

  describe("fork()", () => {
    it("returns independent instance", () => {
      const rng1 = new SeededRng(42);
      const rng2 = rng1.fork();
      // Both should produce different sequences from here on
      for (let i = 0; i < 100; i++) {
        expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
      }
    });

    it("fork preserves parent state", () => {
      const rng = new SeededRng(42);
      const forked = rng.fork();
      // Advance both
      rng.next();
      forked.next();
      // They should produce different values
      expect(rng.next()).not.toBeCloseTo(forked.next(), 10);
    });

    it("multiple forks all independent", () => {
      const rng = new SeededRng(42);
      const fork1 = rng.fork();
      const fork2 = rng.fork();
      const fork3 = fork1.fork();
      for (let i = 0; i < 50; i++) {
        // Independent forks must not produce identical values
        expect(fork1.next()).not.toBe(fork2.next());
      }
      // fork3 is independent from fork1
      const f3 = new SeededRng(42).fork().fork();
      const f1 = new SeededRng(42).fork();
      for (let i = 0; i < 50; i++) {
        expect(f1.next()).not.toBe(f3.next());
      }
    });
  });
});
