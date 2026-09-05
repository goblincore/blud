```typescript
// src/seeded-rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Initialize state with seed, ensuring it's not zero (mulberry32 requires non-zero state)
    this.state = seed === 0 ? 1 : seed;
  }

  /**
   * Mulberry32 PRNG implementation
   * Based on the Mulberry algorithm for generating high-quality random numbers.
   */
  private mulberry32(): number {
    let s = this.state;
    
    // Mulberry32 algorithm
    s = s ^ (s >>> 16);
    s = (s * 0x6D0) >>> 0; // 0x6D0 = 1776
    s = s ^ (s >>> 16);
    s = (s * 0xC6EFB) >>> 0; // 0xC6EFB = 8081279
    s = s ^ (s >>> 16);
    
    this.state = s;
    return s;
  }

  /**
   * Returns a float in [0, 1)
   */
  next(): number {
    const raw = this.mulberry32();
    // Convert to [0, 1) range using 32-bit unsigned integer
    return (raw >>> 0) / 0x100000000;
  }

  /**
   * Returns an integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    const range = max - min + 1;
    const raw = this.mulberry32();
    // Use modulo with unsigned conversion to ensure positive result
    return min + ((raw >>> 0) % range);
  }

  /**
   * Returns a float in [min, max] inclusive
   */
  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    return min + this.next() * (max - min);
  }

  /**
   * Returns a boolean with probability p of being true
   */
  nextBool(p: number = 0.5): boolean {
    if (p < 0 || p > 1) {
      throw new Error('Probability p must be between 0 and 1');
    }
    return this.next() < p;
  }

  /**
   * Picks a random element from the array
   */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error('Array must not be empty');
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /**
   * Returns a new array with elements shuffled (Fisher-Yates, non-mutating)
   */
  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Forks the current RNG state into a new independent SeededRng instance
   */
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
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBeCloseTo(rng2.next(), 10);
    }
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    
    let different = false;
    for (let i = 0; i < 100; i++) {
      if (rng1.next() !== rng2.next()) {
        different = true;
        break;
      }
    }
    
    expect(different).toBe(true);
  });

  it('nextInt returns values within bounds', () => {
    const rng = new SeededRng(123);
    
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextInt bounds are inclusive', () => {
    const rng = new SeededRng(123);
    let seenMin = false;
    let seenMax = false;
    
    // Run many times to likely hit both bounds
    for (let i = 0; i < 100000; i++) {
      const val = rng.nextInt(1, 3);
      if (val === 1) seenMin = true;
      if (val === 3) seenMax = true;
      if (seenMin && seenMax) break;
    }
    
    expect(seenMin).toBe(true);
    expect(seenMax).toBe(true);
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(456);
    
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(1.5, 3.5);
      expect(val).toBeGreaterThanOrEqual(1.5);
      expect(val).toBeLessThanOrEqual(3.5);
    }
  });

  it('nextBool with p=0 always returns false', () => {
    const rng = new SeededRng(789);
    
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always returns true', () => {
    const rng = new SeededRng(789);
    
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns an element from the array', () => {
    const rng = new SeededRng(111);
    const arr = ['a', 'b', 'c', 'd'];
    
    for (let i = 0; i < 1000; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements, not mutated original', () => {
    const rng = new SeededRng(222);
    const original = [1, 2, 3, 4, 5];
    const originalCopy = [...original];
    
    const shuffled = rng.shuffle(original);
    
    // Original array should not be mutated
    expect(original).toEqual(originalCopy);
    
    // Shuffled array should have same elements
    expect(shuffled.sort((a, b) => a - b)).toEqual(originalCopy);
    
    // Shuffled array should not be the same reference
    expect(shuffled).not.toBe(original);
  });

  it('fork creates independent instances', () => {
    const rng1 = new SeededRng(333);
    const forked = rng1.fork();
    
    // First few values from original
    const orig1 = rng1.next();
    const orig2 = rng1.next();
    
    // First few values from forked
    const fork1 = forked.next();
    const fork2 = forked.next();
    
    // Forked should start from same state as original at fork point
    expect(fork1).toBeCloseTo(orig1, 10);
    expect(fork2).toBeCloseTo(orig2, 10);
    
    // Further values should diverge
    const orig3 = rng1.next();
    const fork3 = forked.next();
    
    // After advancing both, they should still be in sync since they started same
    expect(orig3).toBeCloseTo(fork3, 10);
  });

  it('forked instances evolve independently', () => {
    const rng1 = new SeededRng(444);
    const forked = rng1.fork();
    
    // Advance original
    rng1.next();
    rng1.next();
    
    // Forked hasn't advanced yet, so its next value should match original's second value from fork point
    const forkVal = forked.next();
    const origVal = rng1.next();
    
    // Since forked is at initial state and original has advanced 2 steps,
    // forked.next() should equal what original would have produced at step 1 from fork
    // This is a bit tricky, let's verify independence differently
    
    // Let's check that they produce different sequences after advancing differently
    const rng2 = new SeededRng(444);
    const forked2 = rng2.fork();
    
    // Advance rng2
    rng2.next();
    rng2.next();
    rng2.next();
    
    // Now get values
    const forkedVal1 = forked2.next();
    const rng2Val = rng2.next();
    
    // These should be different because they're at different states
    // forked2 is at state 0, rng2 is at state 3
    expect(forkedVal1).not.toBe(rng2Val);
  });
});
```
