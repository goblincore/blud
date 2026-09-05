import { describe, it, expect } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  describe("determinism", () => {
    it("same seed produces the same sequence", () => {
      const a = new SeededRng(42);
      const b = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(a.next()).toBe(b.next());
      }
    });

    it("different seeds produce different values", () => {
      const a = new SeededRng(1);
      const b = new SeededRng(2);
      expect(a.next()).not.toBe(b.next());
    });
  });

  describe("nextInt", () => {
    it("returns value within [min, max] inclusive", () => {
      const rng = new SeededRng(99);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextInt(10, 20);
        expect(val).toBeGreaterThanOrEqual(10);
        expect(val).toBeLessThanOrEqual(20);
      }
    });

    it("throws when min > max", () => {
      const rng = new SeededRng(1);
      expect(() => rng.nextInt(10, 5)).toThrow();
    });
  });

  describe("nextFloat", () => {
    it("returns value within [min, max)", () => {
      const rng = new SeededRng(7);
      for (let i = 0; i < 1000; i++) {
        const val = rng.nextFloat(3.14, 10.0);
        expect(val).toBeGreaterThanOrEqual(3.14);
        expect(val).toBeLessThan(10.0);
      }
    });

    it("throws when min >= max", () => {
      const rng = new SeededRng(1);
      expect(() => rng.nextFloat(5, 5)).toThrow();
    });
  });

  describe("nextBool", () => {
    it("p = 0 always returns false", () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it("p = 1 always returns true", () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });

    it("default p = 0.5 returns both true and false over many trials", () => {
      const rng = new SeededRng(1);
      let trueCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (rng.nextBool()) trueCount++;
      }
      // With p = 0.5, we expect ~500 trues (±2σ ≈ ±62)
      expect(trueCount).toBeGreaterThan(400);
      expect(trueCount).toBeLessThan(600);
    });
  });

  describe("pick", () => {
    it("returns an element from the array", () => {
      const arr = ["a", "b", "c", "d", "e"];
      const rng = new SeededRng(123);
      for (let i = 0; i < 100; i++) {
        const picked = rng.pick(arr);
        expect(arr).toContain(picked);
      }
    });

    it("throws on empty array", () => {
      const rng = new SeededRng(1);
      expect(() => rng.pick([] as string[])).toThrow();
    });
  });

  describe("shuffle", () => {
    it("returns a copy with the same elements (non-mutating)", () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const rng = new SeededRng(42);
      const shuffled = rng.shuffle(original);
      expect(shuffled).not.toBe(original);
      expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
      expect(original).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("produces different orders with different seeds", () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const s1 = new SeededRng(1).shuffle([...arr]);
      const s2 = new SeededRng(2).shuffle([...arr]);
      expect(s1).not.toEqual(s2);
    });
  });

  describe("fork", () => {
    it("creates an independent instance", () => {
      const rng = new SeededRng(42);
      const forked = rng.fork();

      // Each call advances only its own state
      const a1 = rng.next();
      const b1 = forked.next();
      expect(a1).not.toBe(b1);

      const a2 = rng.next();
      const b2 = forked.next();
      expect(a2).not.toBe(b2);
    });

    it("forked instances produce different values from parent", () => {
      const rng = new SeededRng(99);
      const forked = rng.fork();

      for (let i = 0; i < 50; i++) {
        expect(rng.next()).not.toBe(forked.next());
      }
    });
  });
});
