<!-- thinking (697 chars) -->

Let me think through this carefully.

I need to implement a SeededRng class with mulberry32 PRNG. The constructor takes a seed number. I need methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. I need to store state as a class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances.

<!-- answer (4590 chars) -->
Here are the implementations:

## `src/SeededRng.ts`

```typescript
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private mulberry32(): number {
    let t = this.state += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`min (${min}) must be less than or equal to max (${max})`);
    }
    const range = max - min + 1;
    return min + Math.floor(this.mulberry32() * range);
  }

  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new Error(`min (${min}) must be less than or equal to max (${max})`);
    }
    return min + this.mulberry32() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.mulberry32() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from an empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  fork(): SeededRng {
    return new SeededRng(this.state);
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
```

## `tests/SeededRng.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { SeededRng } from "../src/SeededRng";

describe("SeededRng", () => {
  it("same seed produces same sequence", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it("different seeds produce different values", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it("nextInt returns values within bounds inclusive", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
    }
  });

  it("nextInt always returns min when range is 0", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextInt(5, 5)).toBe(5);
    }
  });

  it("nextFloat returns values within bounds", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(10.0, 20.0);
      expect(val).toBeGreaterThanOrEqual(10.0);
      expect(val).toBeLessThanOrEqual(20.0);
    }
  });

  it("nextBool with p=0 always returns false", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool with p=1 always returns true", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("pick returns an element from the array", () => {
    const rng = new SeededRng(1);
    const arr = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it("shuffle returns array with same elements not mutated", () => {
    const rng = new SeededRng(1);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);
    expect(shuffled).not.toBe(original);
    expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it("fork creates independent instance with same state", () => {
    const rng1 = new SeededRng(42);
    const forked = rng1.fork();
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(forked.next());
    }
  });
});
```

**Key implementation notes:**

- **mulberry32**: Uses the classic 32-bit PRNG with `Math.imul` for proper 32-bit multiplication behavior
- **State masking**: `>>> 0` ensures unsigned 32-bit storage, preventing overflow issues
- **nextInt**: Uses `Math.floor(r * range)` where `r ∈ [0,1)` to get uniform distribution
- **shuffle**: Creates a shallow copy to avoid mutating the original array
- **fork**: Creates a new instance with the *current* state, not the next one, so both produce identical sequences going forward
