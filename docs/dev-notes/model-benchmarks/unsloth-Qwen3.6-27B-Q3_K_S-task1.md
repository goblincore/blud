```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  private mulberry32(): number {
    let t = (this.state += 0x6d2b7dd4);
    t = Math.imul(t ^ (t >>> 16), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 15), t | 4);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  fork(): SeededRng {
    const forked = new SeededRng(this.state);
    this.next(); // Advance current state to ensure independence
    return forked;
  }
}
```

```typescript
// src/SeededRng.test.ts

import { describe, it, expect } from "vitest";
import { SeededRng } from "./SeededRng";

describe("SeededRng", () => {
  it("same seed produces same sequence", () => {
    const rng1 = new SeededRng(123);
    const rng2 = new SeededRng(123);

    expect(rng1.next()).toBe(rng2.next());
    expect(rng1.next()).toBe(rng2.next());
    expect(rng1.nextInt(1, 10)).toBe(rng2.nextInt(1, 10));
  });

  it("different seeds produce different values", () => {
    const rng1 = new SeededRng(123);
    const rng2 = new SeededRng(456);

    // High probability that sequences differ
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it("nextInt respects bounds", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(1, 10);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it("nextFloat respects bounds", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(0.5, 1.5);
      expect(val).toBeGreaterThanOrEqual(0.5);
      expect(val).toBeLessThanOrEqual(1.5);
    }
  });

  it("nextBool with p=0 is always false", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool with p=1 is always true", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("pick returns element from array", () => {
    const rng = new SeededRng(1);
    const arr = [1, 2, 3];
    const picked = rng.pick(arr);
    expect(arr).toContain(picked);
  });

  it("shuffle returns same elements and does not mutate original", () => {
    const rng = new SeededRng(1);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);

    expect(original).toEqual([1, 2, 3, 4, 5]); // Not mutated
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual(original.sort());
    expect(shuffled).not.toEqual(original); // Likely different order
  });

  it("fork returns independent instance", () => {
    const rng1 = new SeededRng(1);
    const forked = rng1.fork();

    // Advance rng1
    rng1.next();
    
    // Advance forked
    forked.next();

    // They should diverge because fork advances the parent state
    expect(rng1.next()).not.toBe(forked.next());
  });
});
```
