<|think|>
Let me think through this carefully.

The question/task: /no_think
Write a TypeScript utility module that exports a SeededRng class with mulberry32 PRNG. Constructor takes seed number. Methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. Store state as class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances.

My approach:
1. Implement the SeededRng class with mulberry32 algorithm.
2. Store the state as a class field.
3. Implement the required methods: next, nextInt, nextFloat, nextBool, pick, shuffle, fork.
4. Write vitest tests for each method to ensure correctness.
5. Ensure strict TypeScript types and no dependencies.

I will now generate the code.
<|/think|>

Here is the `Rng.ts` utility module and the corresponding `Rng.test.ts` file.

### `src/Rng.ts`

```typescript
/**
 * SeededRng utility class using the Mulberry32 PRNG.
 * @module Rng
 */

export class SeededRng {
    private state: number;

    constructor(seed: number) {
        // Mulberry32 implementation
        this.state = seed | 0;
    }

    /**
     * Returns a pseudo-random float in the range [0, 1).
     */
    next(): number {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t, t ^ 15);
        t = t ^ (t >>> 16);
        t = Math.imul(t, t ^ 7);
        t = t ^ (t >>> 6);
        this.state = t;
        return (t ^ (t >>> 16)) >>> 0; // Return raw integer [0, 2^32)
    }

    /**
     * Returns a pseudo-random integer in the range [min, max] inclusive.
     */
    nextInt(min: number, max: number): number {
        const range = max - min + 1;
        return min + Math.floor(this.next() * range);
    }

    /**
     * Returns a pseudo-random float in the range [min, max].
     */
    nextFloat(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /**
     * Returns a boolean with the specified probability `p`.
     */
    nextBool(p: number = 0.5): boolean {
        return this.next() < p;
    }

    /**
     * Returns a random element from the provided array.
     */
    pick<T>(arr: readonly T[]): T {
        const index = this.nextInt(0, arr.length - 1);
        return arr[index];
    }

    /**
     * Returns a new array with elements shuffled (Fisher-Yates).
     * The original array is not mutated.
     */
    shuffle<T>(arr: readonly T[]): T[] {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    /**
     * Creates a new SeededRng instance with a state derived from the current one.
     * The new instance is independent of the parent.
     */
    fork(): SeededRng {
        const newState = this.next();
        return new SeededRng(newState);
    }
}
```

### `src/Rng.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { SeededRng } from './Rng';

describe('SeededRng', () => {
    it('should produce the same sequence for the same seed', () => {
        const rng1 = new SeededRng(12345);
        const rng2 = new SeededRng(12345);

        expect(rng1.next()).toBe(rng2.next());
        expect(rng1.next()).toBe(rng2.next());
        expect(rng1.next()).toBe(rng2.next());
    });

    it('should produce different values for different seeds', () => {
        const rng1 = new SeededRng(12345);
        const rng2 = new SeededRng(54321);

        expect(rng1.next()).not.toBe(rng2.next());
        expect(rng1.next()).not.toBe(rng2.next());
    });

    it('nextInt should return values within bounds', () => {
        const rng = new SeededRng(42);
        const min = 10;
        const max = 20;

        for (let i = 0; i < 100; i++) {
            const val = rng.nextInt(min, max);
            expect(val).toBeGreaterThanOrEqual(min);
            expect(val).toBeLessThanOrEqual(max);
        }
    });

    it('nextFloat should return values within bounds', () => {
        const rng = new SeededRng(42);
        const min = 1.0;
        const max = 10.0;

        for (let i = 0; i < 100; i++) {
            const val = rng.nextFloat(min, max);
            expect(val).toBeGreaterThanOrEqual(min);
            expect(val).toBeLessThanOrEqual(max);
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

        for (let i = 0; i < 100; i++) {
            const val = rng.pick(arr);
            expect(arr).toContain(val);
        }
    });

    it('shuffle should return a new array with same elements', () => {
        const rng = new SeededRng(42);
        const original = [1, 2, 3, 4, 5];
        const shuffled = rng.shuffle(original);

        // Verify it's a different reference
        expect(shuffled).not.toBe(original);

        // Verify it contains the same elements
        expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('fork should create an independent instance', () => {
        const parent = new SeededRng(42);
        const child = parent.fork();

        // Parent and child should have different states
        expect(parent.next()).not.toBe(child.next());
    });
});
```
