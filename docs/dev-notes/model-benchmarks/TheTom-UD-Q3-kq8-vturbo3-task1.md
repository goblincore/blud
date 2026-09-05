```typescript
// utils/seeded-rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private mulberry32(): number {
    let s = this.state;
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t: number;
    t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + (t << 7) | 0) ^ t;
    return (t * t) >>> 0;
  }

  next(): number {
    return this.mulberry32() / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + (this.mulberry32() % range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Array is empty");
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
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
    const newState = this.mulberry32();
    return new SeededRng(newState);
  }
}
```

```typescript
// utils/seeded-rng.test.ts

import { describe, it, expect } from 'vitest';
import { SeededRng } from './seeded-rng';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(12345);
    
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(67890);
    
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it('nextInt returns values within bounds inclusive', () => {
    const rng = new SeededRng(42);
    const min = 5;
    const max = 10;
    
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(42);
    const min = 1.5;
    const max = 2.5;
    
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThan(max); // next() is [0,1), so max is exclusive
    }
  });

  it('nextBool with p=0 always returns false', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always returns true', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns element from array', () => {
    const rng = new SeededRng(42);
    const arr = ['a', 'b', 'c', 'd', 'e'];
    
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements', () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(original);
    
    expect(shuffled).toHaveLength(original.length);
    expect(new Set(shuffled)).toEqual(new Set(original));
  });

  it('shuffle does not mutate original array', () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5];
    const originalCopy = [...original];
    
    rng.shuffle(original);
    
    expect(original).toEqual(originalCopy);
  });

  it('fork creates independent instance', () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();
    
    // They should produce different sequences
    expect(rng1.next()).not.toBe(rng2.next());
    
    // But both should be deterministic
    const rng3 = new SeededRng(42);
    const forkedRng = rng3.fork();
    expect(forkedRng.next()).toBe(rng2.next());
  });
});
```
