<|think|>
Let me think through this carefully.

The question/task: /no_think
Write a TypeScript utility module that exports a SeededRng class with mulberry32 PRNG. Constructor takes seed number. Methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. Store state as class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances.

My reasoning: Implementation

I'll implement a SeededRng class using the mulberry32 algorithm:

1. Constructor takes a seed number
2. Implements mulberry32 PRNG with:
   - next() returns float [0,1)
   - nextInt(min, max) for inclusive integers
   - nextFloat(min, max) for floating-point numbers
   - nextBool(p=0.5) for boolean with probability
   - pick(arr) to select random element
   - shuffle(arr) for Fisher-Yates non-mutating shuffle
   - fork() to create new independent SeededRng instance

I'll also write comprehensive vitest tests covering all the requirements:
- Same seed produces same sequence
- Different seeds produce different values
- nextInt bounds checking
- nextFloat bounds checking
- nextBool with p=0 and p=1
- pick from array
- shuffle doesn't mutate original array
- fork() creates independent instances

Let me implement this:
<|/think|>

```typescript
// src/rng.ts

/**
 * SeededRng class with mulberry32 PRNG implementation
 * 
 * Provides deterministic random number generation with configurable seed.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /**
   * Returns a random float in range [0, 1)
   */
  next(): number {
    this.state = this.state | 0;
    this.state = this.state ^ (this.state << 13);
    this.state = this.state ^ (this.state >>> 17);
    this.state = this.state ^ (this.state << 5);
    return (this.state >>> 0) / 4294967296;
  }

  /**
   * Returns a random integer in range [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /**
   * Returns a random float in range [min, max)
   */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a boolean with specified probability p
   */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Returns a random element from array
   */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /**
   * Returns a new array with elements shuffled using Fisher-Yates algorithm
   * Does NOT mutate the original array
   */
  shuffle<T>(arr: T[]): T[] {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Creates a new SeededRng instance with a derived seed
   */
  fork(): SeededRng {
    const newSeed = this.next();
    return new SeededRng(newSeed);
  }
}
```

```typescript
// __tests__/rng.test.ts

import { describe, it, expect } from "vitest";
import { SeededRng } from "../src/rng";

describe("SeededRng", () => {
  it("same seed produces same sequence", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
  });

  it("different seeds produce different values", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);

    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
  });

  it("nextInt returns values within bounds", () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextInt(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it("nextFloat returns values within bounds", () => {
    const rng = new SeededRng(456);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextFloat(1.5, 4.5);
      expect(value).toBeGreaterThanOrEqual(1.5);
      expect(value).toBeLessThanOrEqual(4.5);
    }
  });

  it("nextBool(p=0) always returns false", () => {
    const rng = new SeededRng(789);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool(p=1) always returns true", () => {
    const rng = new SeededRng(101);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("pick returns element from array", () => {
    const rng = new SeededRng(111);
    const arr = ["a", "b", "c", "d"];
    
    for (let i = 0; i < 100; i++) {
      const value = rng.pick(arr);
      expect(arr).toContain(value);
    }
  });

  it("shuffle returns same elements without mutating original", () => {
    const rng = new SeededRng(222);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);

    // Original array should remain unchanged
    expect(original).toEqual([1, 2, 3, 4, 5]);
    
    // Shuffled array should contain same elements
    const shuffledSorted = [...shuffled].sort();
    const originalSorted = [...original].sort();
    expect(shuffledSorted).toEqual(originalSorted);
  });

  it("fork() creates independent instances", () => {
    const rng1 = new SeededRng(333);
    const rng2 = rng1.fork();

    // They should produce different sequences
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
    expect(rng1.next()).not.toBeCloseTo(rng2.next(), 10);
  });
});
```
