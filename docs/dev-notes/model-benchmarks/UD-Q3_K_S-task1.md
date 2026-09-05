```typescript
// SeededRng.ts
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private mulberry32(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + (t ^ (t >>> 7));
    return (t * (t ^ (t >>> 6))) >>> 0;
  }

  next(): number {
    return this.mulberry32() / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    const maxUint = 0x100000000;
    let val: number;
    do {
      val = this.mulberry32();
    } while (val >= Math.floor(maxUint / range) * range);
    return min + (val % range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Cannot pick from empty array");
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
// SeededRng.test.ts
import { describe, it, expect } from 'vitest';
import { SeededRng } from './SeededRng';

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
      if (rng1.next() !== rng2.next()) differentCount++;
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  it('nextInt returns values within bounds inclusive', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextFloat returns values within bounds', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(1.5, 2.5);
      expect(val).toBeGreaterThanOrEqual(1.5);
      expect(val).toBeLessThanOrEqual(2.5);
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

  it('pick returns element from array', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('shuffle returns array with same elements, not mutating original', () => {
    const original = [1, 2, 3, 4, 5];
    const rng = new SeededRng(42);
    const shuffled = rng.shuffle(original);
    expect(shuffled).not.toBe(original);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('fork returns independent instance', () => {
    const rng1 = new SeededRng(42);
    const rng2 = rng1.fork();
    let different = false;
    for (let i = 0; i < 100; i++) {
      if (rng1.next() !== rng2.next()) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });
});
```
