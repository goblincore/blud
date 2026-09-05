```typescript
// src/SeededRng.ts

export class SeededRng {
  private _state: number;

  constructor(seed: number) {
    this._state = seed;
  }

  next(): number {
    this._state = this._state | 0;
    this._state = this._state ^ (this._state << 13);
    this._state = this._state ^ (this._state >> 17);
    this._state = this._state ^ (this._state << 5);
    return (this._state >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  fork(): SeededRng {
    return new SeededRng(this._state);
  }
}
```

```typescript
// src/SeededRng.test.ts
import { describe, it, expect } from "vitest";
import { SeededRng } from "./SeededRng";

describe("SeededRng", () => {
  it("same seed produces same sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("different seeds produce different values", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(43);
    expect(a.next()).not.toBe(b.next());
  });

  it("nextInt returns inclusive range", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(1, 5);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it("nextFloat returns within bounds", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat(10.5, 20.5);
      expect(v).toBeGreaterThanOrEqual(10.5);
      expect(v).toBeLessThanOrEqual(20.5);
    }
  });

  it("nextBool p=0 always false", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it("nextBool p=1 always true", () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it("pick returns element from array", () => {
    const rng = new SeededRng(42);
    const arr = ["a", "b", "c", "d"];
    for (let i = 0; i < 100; i++) {
      const val = rng.pick(arr);
      expect(arr).toContain(val);
    }
  });

  it("shuffle returns new array with same elements", () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);
    expect(shuffled).not.toBe(original);
    expect(shuffled).toHaveLength(original.length);
    expect(shuffled.sort()).toEqual(original.sort());
  });

  it("fork returns independent instance", () => {
    const rng = new SeededRng(42);
    rng.next();
    const forked = rng.fork();
    forked.next();
    forked.next();
    expect(rng.next()).not.toBe(forked.next());
  });
});
```
