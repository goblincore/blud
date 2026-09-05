```typescript
// src/SeededRng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is a 32-bit unsigned integer
    this.state = seed >>> 0;
  }

  /**
   * Mulberry32 PRNG
   * Returns a float in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + (t ^ (t >>> 7));
    return ((t ^ (t >>> 6)) >>> 0) / 4294967296;
  }

  /**
   * Returns an integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    if (min > max) [min, max] = [max, min];
    const range = max - min + 1;
    if (range <= 0) return min;
    const rand = Math.floor(this.next() * range);
    return min + rand;
  }

  /**
   * Returns a float in [min, max] inclusive
   */
  nextFloat(min: number, max: number): number {
    if (min > max) [min, max] = [max, min];
    return min + this.next() * (max - min);
  }

  /**
   * Returns true with probability p, false otherwise
   */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Picks a random element from the array
   */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Cannot pick from empty array");
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /**
   * Returns a new array with elements shuffled using Fisher-Yates algorithm.
   * Does not mutate the original array.
   */
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Creates a new SeededRng instance with a seed derived from the current state.
   * This allows for branching or forking the RNG.
   */
  fork(): SeededRng {
    // Generate a new seed based on current state
    const newSeed = (this.state * 0x6d2b79f5 + 1) >>> 0;
    return new SeededRng(newSeed);
  }
}
```

```typescript
// src/SeededRng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from './SeededRng';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    
    const values1: number[] = [];
    const values2: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      values1.push(rng1.next());
      values2.push(rng2.next());
    }
    
    expect(values1).toEqual(values2);
  });

  it('different seeds produce different values', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(43);
    
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it('nextInt returns values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('nextInt handles min > max by swapping', () => {
    const rng = new SeededRng(42);
    const val = rng.nextInt(20, 10);
    expect(val).toBeGreaterThanOrEqual(10);
    expect(val).toBeLessThanOrEqual(20);
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(1.5, 2.5);
      expect(val).toBeGreaterThanOrEqual(1.5);
      expect(val).toBeLessThanOrEqual(2.5);
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

  it('nextBool with p=0.5 returns both true and false', () => {
    const rng = new SeededRng(42);
    let hasTrue = false;
    let hasFalse = false;
    
    for (let i = 0; i < 100; i++) {
      if (rng.nextBool(0.5)) hasTrue = true;
      else hasFalse = true;
    }
    
    expect(hasTrue).toBe(true);
    expect(hasFalse).toBe(true);
  });

  it('pick returns element from array', () => {
    const rng = new SeededRng(42);
    const arr = ['a', 'b', 'c'];
    
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('pick throws on empty array', () => {
    const rng = new SeededRng(42);
    expect(() => rng.pick([])).toThrow('Cannot pick from empty array');
  });

  it('shuffle returns new array with same elements', () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    const shuffled = rng.shuffle(arr);
    
    expect(shuffled).toHaveLength(arr.length);
    expect(shuffled.sort((a, b) => a - b)).toEqual(original.sort((a, b) => a - b));
  });

  it('shuffle does not mutate original array', () => {
    const rng = new SeededRng(42);
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    rng.shuffle(arr);
    
    expect(arr).toEqual(original);
  });

  it('fork creates independent instance', () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();
    
    const values1: number[] = [];
    const values2: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      values1.push(rng1.next());
      values2.push(rng2.next());
    }
    
    // Forked RNG should produce different sequence than original
    expect(values1).not.toEqual(values2);
    
    // But same seed should produce same sequence
    const rng3 = new SeededRng(42);
    const values3: number[] = [];
    for (let i = 0; i < 10; i++) {
      values3.push(rng3.next());
    }
    
    expect(values1).toEqual(values3);
  });

  it('forked RNG maintains independence from parent', () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();
    
    // Generate some values from both
    const val1a = rng1.next();
    const val2a = rng2.next();
    const val1b = rng1.next();
    const val2b = rng2.next();
    
    // Values should be different between independent instances
    expect(val1a).not.toBe(val2a);
    expect(val1b).not.toBe(val2b);
    
    // Parent's next call should not affect child's sequence
    const rng1Copy = new SeededRng(42);
    const rng2Copy = rng1Copy.fork();
    
    const val1aCopy = rng1Copy.next();
    const val2aCopy = rng2Copy.next();
    const val1bCopy = rng1Copy.next();
    const val2bCopy = rng2Copy.next();
    
    expect(val1a).toBe(val1aCopy);
    expect(val2a).toBe(val2aCopy);
    expect(val1b).toBe(val1bCopy);
    expect(val2b).toBe(val2bCopy);
  });
});
```
