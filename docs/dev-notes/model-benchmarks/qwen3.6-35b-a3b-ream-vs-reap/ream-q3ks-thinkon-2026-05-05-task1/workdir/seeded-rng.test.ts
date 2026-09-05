import { describe, it, expect } from "vitest";
import { SeededRng } from "./seeded-rng";

describe("SeededRng", () => {
  it("same seed produces identical sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("different seeds produce different values", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(99);
    expect(a.next()).not.toBe(b.next());
  });

  it("nextInt(min, max) stays within inclusive bounds", () => {
    const rng = new SeededRng(0);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
    }
  });

  it("nextInt(swap) handles min > max by swapping", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(30, 10);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(30);
    }
  });

  it("nextFloat(min, max) stays within [min, max)", () => {
    const rng = new SeededRng(2);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(15);
    }
  });

  it("nextFloat(swap) handles min > max by swapping", () => {
    const rng = new SeededRng(3);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(25, 5);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(25);
    }
  });

  it("nextBool(p=0) is always false", () => {
    const rng = new SeededRng(4);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool(p=1) is always true", () => {
    const rng = new SeededRng(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("pick() returns an element from the array", () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(10);
    for (let i = 0; i < 20; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it("shuffle returns new array with same elements, does not mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const rng = new SeededRng(11);
    for (let i = 0; i < 5; i++) {
      const shuffled = rng.shuffle(input);
      expect(shuffled).not.toBe(input);
      expect(shuffled.sort((a, b) => a - b)).toEqual(input);
    }
  });

  it("fork creates independent instances", () => {
    const a = new SeededRng(100);
    const b = a.fork();
    // Capture what a would produce at the fork point
    const expectedVal = a.next();
    expect(b.next()).toBe(expectedVal);
    // Verify they diverge after advancing b
    b.next();
    expect(b.next()).not.toBe(a.next());
  });

  it("same seed same sequence (full sequence comparison)", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});
