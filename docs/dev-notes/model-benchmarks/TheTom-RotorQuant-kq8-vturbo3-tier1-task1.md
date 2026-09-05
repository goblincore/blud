```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t =
      this.state ^ (this.state >>> 15);
    t = (t + (t << 15)) | 0;
    t = t ^ (t >>> 7);
    return (t >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    if (min > max) throw new Error("min must be <= max");
    const range = max - min + 1;
    if (range <= 0) throw new Error("Invalid range");
    return Math.floor(this.next() * range) + min;
  }

  nextFloat(min: number, max: number): number {
    if (min >= max) throw new Error("min must be < max");
    return this.next() * (max - min) + min;
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Array must not be empty");
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    const arrCopy = [...arr];
    for (let i = arrCopy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arrCopy[i], arrCopy[j]] = [arrCopy[j], arrCopy[i]];
    }
    return arrCopy;
  }

  fork(): SeededRng {
    return new SeededRng(this.next() * 4294967296);
  }
}
```

```typescript
// src/SeededRng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from './SeededRng';

describe('SeededRng', () => {
  it('same seed yields same sequence', () => {
    const r1 = new SeededRng(12345);
    const r2 = new SeededRng(12345);
    
    for (let i = 0; i < 10; i++) {
      expect(r1.next()).toBe(r2.next());
    }
  });

  it('different seeds yield different values', () => {
    const r1 = new SeededRng(12345);
    const r2 = new SeededRng(54321);
    
    expect(r1.next()).not.toBe(r2.next());
  });

  it('nextInt returns values within bounds', () => {
    const rng = new SeededRng(1);
    const min = 10;
    const max = 20;
    
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(1);
    const min = 10.5;
    const max = 20.5;
    
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThan(max);
    }
  });

  it('nextBool(p=0) always false', () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool(p=1) always true', () => {
    const rng = new SeededR3(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns element from array', () => {
    const rng = new SeededRng(1);
    const arr = [1, 2, 3, 4, 5];
    
    for (let i = 0; i < 100; i++) {
      const val = rng.pick(arr);
      expect(arr).toContain(val);
    }
  });

  it('shuffle does not mutate original array', () => {
    const rng = new SeededRng(1);
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    
    rng.shuffle(arr);
    expect(arr).toEqual(original);
  });

  it('fork creates independent instance', () => {
    const rng1 = new SeededRng(1);
    const rng2 = rng1.fork();
    
    // Advance rng1
    rng1.next();
    rng1.next();
    
    // rng2 should not be affected
    expect(rng2.next()).not.toBe(rng1.next());
  });
});
```
