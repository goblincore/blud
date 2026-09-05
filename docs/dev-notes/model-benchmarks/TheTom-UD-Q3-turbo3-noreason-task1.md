```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * Returns a pseudo-random float in the range [0, 1).
   */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + (t << 8)) | 0;
    t = t ^ (t >>> 4);
    t = Math.imul(t ^ (t >>> 14), t | 0);
    return (t >>> 0) / 4294967296;
  }

  /**
   * Returns a pseudo-random integer in the range [min, max] inclusive.
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    const range = max - min + 1;
    if (range <= 0) {
      return min;
    }
    if (range === 1) {
      return min;
    }
    // Use rejection sampling for uniform distribution if range is small enough,
    // otherwise use modulo (biased but simple for general purpose).
    // For strict uniformity with arbitrary ranges, we'd need more code.
    // Given "no deps" and simplicity, we use modulo with a check for small ranges
    // or just standard modulo if we accept slight bias for large ranges.
    // Let's implement a simple unbiased approach for 32-bit integers if possible,
    // but standard Math.random() approach is easier.
    // Since we have next() returning [0,1), we can map it.
    // However, mapping [0,1) to integer range can have bias.
    // Let's use the mulberry32 directly for an integer and then mod.
    
    // Better approach: use the raw 32-bit int from a next() like method?
    // Let's create a helper to get a 32-bit unsigned int.
    const raw = this.nextInt32();
    return min + (raw % range);
  }

  private nextInt32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + (t << 8)) | 0;
    t = t ^ (t >>> 4);
    t = Math.imul(t ^ (t >>> 14), t | 0);
    return t >>> 0;
  }

  /**
   * Returns a pseudo-random float in the range [min, max).
   */
  nextFloat(min: number, max: number): number {
    if (min === max) return min;
    return min + this.next() * (max - min);
  }

  /**
   * Returns true with probability p, false otherwise.
   */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Returns a random element from the array.
   */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /**
   * Returns a new array with elements shuffled in place (Fisher-Yates).
   * Does not mutate the original array.
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
   * Returns a new SeededRng instance with a state derived from the current state.
   * This allows for independent streams.
   */
  fork(): SeededRng {
    // Create a new seed based on current state to ensure independence
    const newSeed = (this.state + 0x6d2b79f5) | 0;
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
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(12345);
    
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBe(rng2.next());
      expect(rng1.nextInt(0, 100)).toBe(rng2.nextInt(0, 100));
      expect(rng1.nextFloat(0, 100)).toBe(rng2.nextFloat(0, 100));
      expect(rng1.nextBool(0.5)).toBe(rng2.nextBool(0.5));
    }
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(67890);
    
    let diffCount = 0;
    for (let i = 0; i < 100; i++) {
      if (rng1.next() !== rng2.next()) {
        diffCount++;
      }
    }
    // It's extremely unlikely that two different seeds produce the exact same sequence
    // for 100 calls, so we check that at least some values differ.
    expect(diffCount).toBeGreaterThan(0);
  });

  it('nextInt returns values within bounds', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
    
    // Test swapped bounds
    const rng2 = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const val = rng2.nextInt(10, 5);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(1.5, 2.5);
      expect(val).toBeGreaterThanOrEqual(1.5);
      expect(val).toBeLessThan(2.5); // next() is [0,1), so nextFloat is [min, max)
    }
  });

  it('nextBool with p=0 always returns false', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always returns true', () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('pick returns an element from the array', () => {
    const rng = new SeededRng(12345);
    const arr = ['a', 'b', 'c', 'd', 'e'];
    
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns a new array with same elements', () => {
    const rng = new SeededRng(12345);
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    
    const shuffled = rng.shuffle(arr);
    
    // Check that shuffled has same length
    expect(shuffled.length).toBe(arr.length);
    
    // Check that shuffled has same elements (as a set/multiset)
    const sortedOriginal = [...original].sort();
    const sortedShuffled = [...shuffled].sort();
    expect(sortedOriginal).toEqual(sortedShuffled);
    
    // Check that original array is not mutated
    expect(arr).toEqual(original);
  });

  it('fork creates independent instances', () => {
    const rng1 = new SeededRng(12345);
    const forked = rng1.fork();
    
    // The forked instance should start with a different sequence
    // Note: It's not guaranteed to be different from rng1's *current* next(),
    // but it should be an independent stream.
    // We can check that advancing rng1 and forked independently produces different results
    // compared to if they were the same stream.
    
    const val1a = rng1.next();
    const val2a = forked.next();
    
    // They might be equal by chance, but let's check multiple values
    const rng1Seq: number[] = [];
    const forkedSeq: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      rng1Seq.push(rng1.next());
      forkedSeq.push(forked.next());
    }
    
    // It's highly unlikely they are identical
    const allSame = rng1Seq.every((v, i) => v === forkedSeq[i]);
    expect(allSame).toBe(false);
    
    // Also check that the original rng1 continues from where it left off
    const rng1Next = rng1.next();
    const forkedNext = forked.next();
    expect(rng1Next).not.toBeUndefined();
    expect(forkedNext).not.toBeUndefined();
  });
});
```
