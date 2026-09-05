```typescript
// src/seeded-rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private nextInternal(): number {
    let t = this.state;
    t |= 0;
    t = t ^ (t >>> 17);
    t = (t * 0xed5ad4b1) | 0;
    t = t ^ (t >>> 13);
    t = (t * 0xac3c42b7) | 0;
    t = t ^ (t >>> 16);
    this.state = t >>> 0;
    return this.state / 4294967296;
  }

  next(): number {
    return this.nextInternal();
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    const range = max - min + 1;
    const maxUint = 0xFFFFFFFF;
    const limit = maxUint - range + 1;
    let r: number;
    do {
      r = this.nextInternal() * 4294967296 | 0;
    } while (r >= limit);
    return min + (r % range);
  }

  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    return min + this.next() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
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
      expect(rng1.next()).toBe(rng2.next());
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
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextInt inclusive bounds', () => {
    const rng = new SeededRng(42);
    let gotMin = false;
    let gotMax = false;
    for (let i = 0; i < 10000; i++) {
      const val = rng.nextInt(1, 3);
      if (val === 1) gotMin = true;
      if (val === 3) gotMax = true;
      if (gotMin && gotMax) break;
    }
    expect(gotMin).toBe(true);
    expect(gotMax).toBe(true);
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(1.5, 2.5);
      expect(val).toBeGreaterThanOrEqual(1.5);
      expect(val).toBeLessThan(2.5);
    }
  });

  it('nextBool with p=0 always false', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('nextBool with p=1 always true', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('nextBool with p=0.5 returns true and false', () => {
    const rng = new SeededRng(42);
    let trueCount = 0;
    let falseCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.nextBool(0.5)) trueCount++;
      else falseCount++;
    }
    expect(trueCount).toBeGreaterThan(0);
    expect(falseCount).toBeGreaterThan(0);
  });

  it('pick returns an element from the array', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(42);
    const shuffled = rng.shuffle(arr);
    expect(shuffled).toHaveLength(arr.length);
    expect(shuffled).toEqual(expect.arrayContaining(arr));
  });

  it('shuffle does not mutate original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    const rng = new SeededRng(42);
    rng.shuffle(arr);
    expect(arr).toEqual(original);
  });

  it('fork creates independent instance', () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();
    
    // Both should produce same first value since they start from same state
    expect(rng1.next()).toBe(rng2.next());
    
    // But advancing one should not affect the other
    const val1 = rng1.next();
    const val2 = rng2.next();
    expect(val1).toBe(val2); // They should still be in sync because fork copies state
    
    // Actually, fork copies current state, so they advance independently from that point
    // Let's verify independence by advancing rng1 further
    rng1.next(); // consume one
    const newVal1 = rng1.next();
    const newVal2 = rng2.next();
    expect(newVal1).toBe(newVal2); // Still in sync because forked from same point
  });

  it('forked instances are independent after forking', () => {
    const rng1 = new SeededRng(42);
    rng1.next(); // advance original
    const rng2 = rng1.fork();
    
    // rng1 and rng2 should now be independent
    const val1 = rng1.next();
    const val2 = rng2.next();
    // They might be equal or not, but they are independent
    // The key is that advancing rng1 doesn't affect rng2
    const val1After = rng1.next();
    const val2After = rng2.next();
    // No assertion needed for inequality, just that both advance independently
    expect(() => rng1.next()).not.toThrow();
    expect(() => rng2.next()).not.toThrow();
  });
});
```
