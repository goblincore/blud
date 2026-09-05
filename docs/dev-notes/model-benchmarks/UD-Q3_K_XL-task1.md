```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Initialize state from seed using a simple mixing function
    this.state = seed | 0;
  }

  /**
   * Returns a random float in [0, 1)
   */
  next(): number {
    // Mulberry32 implementation
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state ^ (this.state >>> 15);
    t = (t + (t << 1)) | 0;
    t = t ^ (t >>> 7);
    t = (t + (t << 6)) | 0;
    this.state = t ^ (t >>> 15);
    
    // Return value in [0, 1)
    const result = (this.state >>> 0) / 4294967296;
    return result;
  }

  /**
   * Returns a random integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be <= max');
    }
    const range = max - min + 1;
    if (range <= 0) {
      throw new Error('Invalid range');
    }
    const randomValue = this.next() * range;
    return min + Math.floor(randomValue);
  }

  /**
   * Returns a random float in [min, max)
   */
  nextFloat(min: number, max: number): number {
    if (min >= max) {
      throw new Error('min must be < max');
    }
    return min + this.next() * (max - min);
  }

  /**
   * Returns true with probability p, false otherwise
   */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Picks a random element from an array
   */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Array must not be empty');
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /**
   * Returns a new array with elements shuffled (Fisher-Yates)
   * Does not mutate the original array
   */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Creates a new independent SeededRng from the current state
   */
  fork(): SeededRng {
    // Create a new instance with a derived seed from current state
    const newSeed = this.state ^ 0x5ed6e3af;
    return new SeededRng(newSeed);
  }
}
```

```typescript
// tests/SeededRng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/SeededRng';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    
    let differentCount = 0;
    for (let i = 0; i < 100; i++) {
      const val1 = rng1.next();
      const val2 = rng2.next();
      if (val1 !== val2) {
        differentCount++;
      }
    }
    
    // Expect most values to be different
    expect(differentCount).toBeGreaterThan(50);
  });

  it('nextInt returns values within bounds', () => {
    const rng = new SeededRng(123);
    const min = 5;
    const max = 10;
    
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(123);
    const min = 1.5;
    const max = 3.5;
    
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThan(max);
    }
  });

  it('nextBool with p=0 always returns false', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always returns true', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns element from array', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(123);
    
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements but potentially different order', () => {
    const original = [1, 2, 3, 4, 5];
    const rng = new SeededRng(123);
    const shuffled = rng.shuffle(original);
    
    // Check same elements
    expect(shuffled.sort()).toEqual(original.sort());
    
    // Check original array is not mutated
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it('fork creates independent instances', () => {
    const rng1 = new SeededRng(42);
    const forked = rng1.fork();
    
    // They should produce different sequences
    let differentCount = 0;
    for (let i = 0; i < 100; i++) {
      const val1 = rng1.next();
      const val2 = forked.next();
      if (val1 !== val2) {
        differentCount++;
      }
    }
    
    expect(differentCount).toBeGreaterThan(0);
    
    // Verify that the original rng can continue producing values
    const val1AfterFork = rng1.next();
    expect(typeof val1AfterFork).toBe('number');
  });
});
```
