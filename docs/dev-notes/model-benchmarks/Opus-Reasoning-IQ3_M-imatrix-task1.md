<|think|>
Let me think through this carefully.

I need to create a TypeScript module with:
1. A SeededRng class using mulberry32 PRNG
2. Multiple methods (next, nextInt, nextFloat, nextBool, pick, shuffle, fork)
3. A vitest test file covering all methods
4. Strict TypeScript, no dependencies

Key implementation details:
- mulberry32 algorithm uses a 32-bit state that gets updated each call
- The state should be preserved as a class field
- fork() needs to copy the current state so the new instance is independent
- shuffle should be non-mutating (return new array)
- All bounds should be inclusive where specified

Let me write the implementation:
- mulberry32: state += 0x6D2B79F5; t = Math.imul(state ^ state >>> 15, 1 | state); t = t ^ t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
- next(): returns float in [0,1)
- nextInt(min,max): inclusive bounds
- nextFloat(min,max): [min,max)
- nextBool(p): returns true with probability p
- pick(arr): random element
- shuffle(arr): Fisher-Yates non-mutating
- fork(): new SeededRng with same state
<|/think|>

```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private mulberry32(): number {
    let t = (this.state = (this.state + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = t ^ t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error("min must be less than or equal to max");
    }
    const range = max - min + 1;
    const result = Math.floor(this.mulberry32() * range);
    return min + result;
  }

  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new Error("min must be less than or equal to max");
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
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  fork(): SeededRng {
    return new SeededRng(this.state);
  }
}
```

```typescript
// tests/SeededRng.test.ts

import { describe, it, expect } from "vitest";
import { SeededRng } from "../src/SeededRng";

describe("SeededRng", () => {
  it("same seed produces same sequence", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    }
  });

  it("different seeds produce different values", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);

    const values1 = Array.from({ length: 100 }, () => rng1.next());
    const values2 = Array.from({ length: 100 }, () => rng2.next());

    expect(values1).not.toEqual(values2);
  });

  it("nextInt returns values within bounds", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextInt(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it("nextInt includes both endpoints", () => {
    const rng = new SeededRng(42);
    let gotMin = false;
    let gotMax = false;

    for (let i = 0; i < 10000; i++) {
      const value = rng.nextInt(0, 10);
      if (value === 0) gotMin = true;
      if (value === 10) gotMax = true;
      if (gotMin && gotMax) break;
    }

    expect(gotMin).toBe(true);
    expect(gotMax).toBe(true);
  });

  it("nextFloat returns values within bounds", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextFloat(1.0, 2.0);
      expect(value).toBeGreaterThanOrEqual(1.0);
      expect(value).toBeLessThan(2.0);
    }
  });

  it("nextBool with p=0 always returns false", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool with p=1 always returns true", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("nextBool with p=0.5 returns roughly 50% true", () => {
    const rng = new SeededRng(42);
    let trueCount = 0;
    const iterations = 10000;
    for (let i = 0; i < iterations; i++) {
      if (rng.nextBool(0.5)) trueCount++;
    }
    const proportion = trueCount / iterations;
    expect(proportion).toBeGreaterThanOrEqual(0.4);
    expect(proportion).toBeLessThanOrEqual(0.6);
  });

  it("pick returns an element from the array", () => {
    const rng = new SeededRng(42);
    const arr = ["a", "b", "c", "d", "e"];
    const result = rng.pick(arr);
    expect(arr).toContain(result);
  });

  it("pick from empty array throws", () => {
    const rng = new SeededRng(42);
    expect(() => rng.pick([])).toThrow("Cannot pick from an empty array");
  });

  it("shuffle returns array with same elements", () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(arr);
    expect(shuffled).not.toBe(arr);
    expect(shuffled).toEqual([1, 2, 3, 4, 5]);
  });

  it("shuffle does not mutate original array", () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    rng.shuffle(arr);
    expect(arr).toEqual(original);
  });

  it("fork returns independent instance", () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();

    // Both should produce the same sequence initially
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    }

    // But they should diverge after fork() - actually fork creates independent copies
    // So they should continue to be identical
    // To test independence, we modify one
    const forked = new SeededRng(42);
    forked.next(); // consume one value
    forked.next(); // consume another

    const original = new SeededRng(42);
    const forkedInstance = original.fork();

    // forkedInstance should start from same state as original
    expect(forkedInstance.next()).toBeCloseTo(original.next(), 10);
  });

  it("forked instance is truly independent", () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    // Consume some values from rng1
    rng1.next();
    rng1.next();

    // fork should create independent copy
    const forked = rng2.fork();

    // forked should produce same sequence as rng2
    for (let i = 0; i < 10; i++) {
      expect(forked.next()).toBeCloseTo(rng2.next(), 10);
    }

    // But rng1 should continue independently
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    }
  });
});
```

**Key implementation details:**

1. **mulberry32 algorithm**: Uses the classic PRNG with `Math.imul` for 32-bit multiplication
2. **State management**: Stored as `state` field, initialized with `>>> 0` to ensure unsigned 32-bit
3. **next()**: Returns float in [0,1) by dividing the 32-bit result by 2³²
4. **nextInt(min,max)**: Uses floor-based mapping for inclusive bounds
5. **nextFloat(min,max)**: Linear mapping from [0,1) to [min,max)
6. **nextBool(p)**: Compares random float against probability threshold
7. **shuffle**: Fisher-Yates on a copy (`[...arr]`) to avoid mutation
8. **fork()**: Creates new SeededRng with current state value, making it independent
