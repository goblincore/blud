import { describe, it, expect } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  it("same seed produces the same sequence", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    }
  });

  it("different seeds produce different values", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 6);
  });

  describe("nextInt", () => {
    it("returns values within [min, max] inclusive", () => {
      const rng = new SeededRng(123);
      for (let i = 0; i < 1000; i++) {
        const value = rng.nextInt(10, 20);
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThanOrEqual(20);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it("throws when min > max", () => {
      const rng = new SeededRng(1);
      expect(() => rng.nextInt(10, 5)).toThrow(
        "nextInt: min (10) > max (5)",
      );
    });

    it("works with equal min/max", () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 10; i++) {
        expect(rng.nextInt(5, 5)).toBe(5);
      }
    });
  });

  describe("nextFloat", () => {
    it("returns values within [min, max)", () => {
      const rng = new SeededRng(456);
      for (let i = 0; i < 1000; i++) {
        const value = rng.nextFloat(3.14, 6.28);
        expect(value).toBeGreaterThanOrEqual(3.14);
        expect(value).toBeLessThan(6.28);
      }
    });

    it("throws when min >= max", () => {
      const rng = new SeededRng(1);
      expect(() => rng.nextFloat(5, 3)).toThrow(
        "nextFloat: min (5) >= max (3)",
      );
    });
  });

  describe("nextBool", () => {
    it("p = 0 always returns false", () => {
      const rng = new SeededRng(789);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it("p = 1 always returns true", () => {
      const rng = new SeededRng(790);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it("default p = 0.5 returns a mix", () => {
      const rng = new SeededRng(999);
      const results = Array.from({ length: 200 }, () => rng.nextBool());
      const trueCount = results.filter((b) => b).length;
      expect(trueCount).toBeGreaterThan(50);
      expect(trueCount).toBeLessThan(150);
    });
  });

  describe("pick", () => {
    it("returns an element from the array", () => {
      const items = ["a", "b", "c", "d", "e"];
      const rng = new SeededRng(42);
      const result = rng.pick(items);
      expect(items).toContain(result);
    });

    it("throws on empty array", () => {
      const rng = new SeededRng(1);
      expect(() => rng.pick([])).toThrow("pick: array is empty");
    });
  });

  describe("shuffle", () => {
    it("returns a new array with same elements", () => {
      const original = [1, 2, 3, 4, 5];
      const rng = new SeededRng(42);
      const shuffled = rng.shuffle(original);
      expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      expect(shuffled).not.toBe(original);
    });

    it("does not mutate the original array", () => {
      const original = [1, 2, 3, 4, 5];
      const copy = [...original];
      const rng = new SeededRng(42);
      rng.shuffle(original);
      expect(original).toEqual(copy);
    });
  });

  describe("fork", () => {
    it("creates an independent rng from current state", () => {
      const rng1 = new SeededRng(42);
      rng1.next(); // consume one value
      const rng2 = rng1.fork();

      // forked rng should reproduce the sequence from the fork point
      expect(rng2.next()).toBeCloseTo(rng1.next(), 10);
      expect(rng2.next()).toBeCloseTo(rng1.next(), 10);
    });

    it("forked rng reproduces sequence from the fork point", () => {
      const parent = new SeededRng(42);

      // Consume some values on parent
      parent.next();
      parent.next();

      // Fork captures the parent's state at this moment
      const fork = parent.fork();

      // Fork should reproduce the same sequence as continuing from
      // the parent's state at the fork point
      const forkNext1 = fork.next();
      const forkNext2 = fork.next();

      // Advance parent from the same point and compare
      const parentNext1 = parent.next();
      const parentNext2 = parent.next();

      // At the fork point, parent and fork share the same state.
      // fork.next() advances fork's state; parent.next() advances parent's state.
      // Since they started at the same state and advanced equally (1 step each),
      // fork.next() and parent.next() should produce the same values.
      expect(forkNext1).toBeCloseTo(parentNext1, 6);
      expect(forkNext2).toBeCloseTo(parentNext2, 6);
    });

    it("fork creates an independent copy of state", () => {
      const parent = new SeededRng(42);
      parent.next();
      parent.next();
      const fork = parent.fork();

      // Parent continues independently
      const parentA = parent.next();
      const parentB = parent.next();

      // Fork continues independently from its captured state
      const forkA = fork.next();
      const forkB = fork.next();

      // Fork's values match what parent would produce from the fork point
      expect(forkA).toBeCloseTo(parentA, 6);
      expect(forkB).toBeCloseTo(parentB, 6);
    });
  });
});
