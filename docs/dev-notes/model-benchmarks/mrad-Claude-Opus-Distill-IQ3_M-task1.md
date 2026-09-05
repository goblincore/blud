```ts
// src/seeded-rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  private next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.next();
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  fork(): SeededRng {
    const snapshot = this.state;
    const child = new SeededRng(0);
    child.state = snapshot;
    return child;
  }
}
```

```ts
// tests/seeded-rng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/seeded-rng';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different values', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('nextInt returns values within bounds inclusive', () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(2.0, 4.0);
      expect(val).toBeGreaterThanOrEqual(2.0);
      expect(val).toBeLessThanOrEqual(4.0);
    }
  });

  it('nextBool with p=0 always returns false', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always returns true', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns an element from the array', () => {
    const rng = new SeededRng(42);
    const arr = [10, 20, 30, 40];
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements, not mutated', () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);
    expect(shuffled).not.toBe(original);
    expect(shuffled).toEqual([1, 2, 3, 4, 5].sort((a, b) => a - b));
  });

  it('fork creates independent instance', () => {
    const rng = new SeededRng(42);
    const forked = rng.fork();
    forked.next(); // consume one
    forked.next();
    const val1 = rng.next();
    const val2 = forked.next();
    expect(val1).not.toBe(val2);
  });
});
```
