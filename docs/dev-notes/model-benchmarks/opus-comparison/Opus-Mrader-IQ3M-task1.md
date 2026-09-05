<!-- thinking (521 chars) -->

Let me think through this carefully.

I need to create:
1. A SeededRng class with mulberry32 PRNG
2. A vitest test file covering all the specified cases

For mulberry32, I'll implement the standard algorithm:
- Initialize state from seed
- next() method that returns float [0,1)
- nextInt(min,max) inclusive
- nextFloat(min,max)
- nextBool(p=0.5)
- pick(arr) - random element
- shuffle(arr) - Fisher-Yates non-mutating
- fork() - returns new independent SeededRng from current state

Let me implement this step by step.


<!-- answer (3775 chars) -->
Here's the implementation:

```typescript
// src/seeded-rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed & 0xffffffff;
  }

  private mulberry32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.mulberry32() * range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.mulberry32() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.mulberry32() < p;
  }

  pick<T>(arr: T[]): T {
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
// tests/seeded-rng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/seeded-rng';

describe('SeededRng', () => {
  it('same seed should produce same sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    
    const values1 = Array.from({ length: 10 }, () => rng1.next());
    const values2 = Array.from({ length: 10 }, () => rng2.next());
    
    expect(values1).toEqual(values2);
  });

  it('different seeds should produce different values', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    
    const value1 = rng1.next();
    const value2 = rng2.next();
    
    expect(value1).not.toBe(value2);
  });

  it('nextInt should return values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('nextFloat should return values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextFloat(0.5, 1.5);
      expect(value).toBeGreaterThanOrEqual(0.5);
      expect(value).toBeLessThanOrEqual(1.5);
    }
  });

  it('nextBool with p=0 should always return false', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 should always return true', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick should return an element from the array', () => {
    const rng = new SeededRng(42);
    const arr = ['a', 'b', 'c', 'd'];
    const picked = rng.pick(arr);
    expect(arr).toContain(picked);
  });

  it('shuffle should return same elements but not mutate original', () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const originalCopy = [...original];
    const shuffled = rng.shuffle(original);
    
    expect(shuffled).not.toEqual(originalCopy);
    expect(original).toEqual(originalCopy);
  });

  it('fork should create independent instance', () => {
    const rng1 = new SeededRng(42);
    const rng1Value1 = rng1.next();
    const forked = rng1.fork();
    const forkedValue = forked.next();
    const rng1Value2 = rng1.next();
    
    expect(forkedValue).toBe(rng1Value1);
    expect(rng1Value2).toBe(forkedValue);
  });
});
```