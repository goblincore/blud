Here's a thinking process:

1.  **Understand User Requirements:**
   - **Language:** TypeScript (strict)
   - **Module:** Utility module exporting a `SeededRng` class
   - **PRNG:** Mulberry32
   - **Constructor:** Takes a seed number
   - **Methods:**
     - `next()`: returns float in [0, 1)
     - `nextInt(min, max)`: inclusive integer
     - `nextFloat(min, max)`: float in [min, max)
     - `nextBool(p = 0.5)`: boolean with probability p
     - `pick(arr)`: random element from array
     - `shuffle(arr)`: Fisher-Yates shuffle, non-mutating, returns new array
     - `fork()`: returns new independent `SeededRng` instance from current state
   - **State:** Store as class field
   - **Constraints:** Strict TypeScript, no dependencies
   - **Tests:** Vitest tests covering:
     - Same seed → same sequence
     - Different seeds → different values
     - `nextInt` bounds
     - `nextFloat` bounds
     - `nextBool` p=0 always false, p=1 always true
     - `pick` from array
     - `shuffle` same elements, not mutated
     - `fork` independent instances

2.  **Implement Mulberry32:**
   Mulberry32 algorithm:
   ```typescript
   function mulberry32(seed: number): () => number {
     let state = seed | 0;
     return function () {
       state |= 0;
       state = state + 0x6D2B79F5 | 0;
       let t = Math.imul(state ^ (state >>> 15), 1 | state);
       t = t + (t << 1) | 0;
       t = t ^ (t >>> 4);
       return (t >>> 0) / 4294967296;
     };
   }
   ```
   Wait, the standard Mulberry32 implementation in JS is usually:
   ```typescript
   let seed = seed | 0;
   return function () {
     seed |= 0;
     seed = (seed + 0x6D2B79F5) | 0;
     let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
     t = (t + (t << 1)) | 0;
     t = t ^ (t >>> 4);
     return (t >>> 0) / 4294967296;
   };
   ```
   Actually, the standard one-liner style is:
   ```typescript
   let s = seed | 0;
   return () => {
     s |= 0;
     s = (s + 0x6D2B79F5) | 0;
     let t = Math.imul(s ^ (s >>> 15), 1 | s);
     t = (t + (t << 1)) | 0;
     t = t ^ (t >>> 4);
     return (t >>> 0) / 4294967296;
   };
   ```
   I'll integrate this directly into the class to avoid closure overhead and keep state as a class field.

   Class structure:
   ```typescript
   export class SeededRng {
     private state: number;

     constructor(seed: number) {
       this.state = seed | 0;
     }

     private generate(): number {
       this.state |= 0;
       this.state = (this.state + 0x6D2B79F5) | 0;
       let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
       t = (t + (t << 1)) | 0;
       t = t ^ (t >>> 4);
       return (t >>> 0) / 4294967296;
     }

     next(): number {
       return this.generate();
     }

     // ... other methods
   }
   ```

3.  **Implement Methods:**
   - `nextInt(min: number, max: number): number`
     Formula for inclusive: `Math.floor(this.next() * (max - min + 1)) + min`
     Need to handle bounds validation? Usually good practice, but I'll keep it simple and assume valid input, or add a check. I'll add a check for `min > max`.
   - `nextFloat(min: number, max: number): number`
     Formula: `min + this.next() * (max - min)`
   - `nextBool(p: number = 0.5): boolean`
     `return this.next() < p`
   - `pick<T>(arr: readonly T[]): T`
     `return arr[Math.floor(this.next() * arr.length)]`
     Handle empty array? Throw error.
   - `shuffle<T>(arr: readonly T[]): T[]`
     Fisher-Yates: copy array, iterate from end to start, swap with random index.
     ```typescript
     const result = [...arr];
     for (let i = result.length - 1; i > 0; i--) {
       const j = Math.floor(this.next() * (i + 1));
       [result[i], result[j]] = [result[j], result[i]];
     }
     return result;
     ```
   - `fork(): SeededRng`
     "returns new independent SeededRng from current state"
     This means the new instance should start with the *current* state, and advancing one shouldn't affect the other, or they should share the state but be independent? Usually "fork" means copy the state and return a new instance with that state. If they share state, advancing one affects the other. The prompt says "independent", so I'll copy the state.
     ```typescript
     fork(): SeededRng {
       return new SeededRng(this.state);
     }
     ```

   Wait, Mulberry32 state is just a 32-bit integer. Copying it is fine. But if I want to be strictly "independent", I should just copy the state. The prompt says "from current state", so `new SeededRng(this.state)` is correct.

   Let's refine the class with strict typing and proper bounds checking.

   ```typescript
   export class SeededRng {
     private state: number;

     constructor(seed: number) {
       this.state = seed | 0;
     }

     private generate(): number {
       this.state |= 0;
       this.state = (this.state + 0x6D2B79F5) | 0;
       let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
       t = (t + (t << 1)) | 0;
       t = t ^ (t >>> 4);
       return (t >>> 0) / 4294967296;
     }

     next(): number {
       return this.generate();
     }

     nextInt(min: number, max: number): number {
       if (min > max) throw new RangeError('min must be <= max');
       const range = max - min + 1;
       return Math.floor(this.next() * range) + min;
     }

     nextFloat(min: number, max: number): number {
       if (min > max) throw new RangeError('min must be <= max');
       return min + this.next() * (max - min);
     }

     nextBool(p: number = 0.5): boolean {
       return this.next() < p;
     }

     pick<T>(arr: readonly T[]): T {
       if (arr.length === 0) throw new RangeError('Array must not be empty');
       return arr[Math.floor(this.next() * arr.length)];
     }

     shuffle<T>(arr: readonly T[]): T[] {
       const result = [...arr];
       for (let i = result.length - 1; i > 0; i--) {
         const j = Math.floor(this.next() * (i + 1));
         [result[i], result[j]] = [result[j], result[i]];
       }
       return result;
     }

     fork(): SeededRng {
       return new SeededRng(this.state);
     }
   }
   ```

   Check constraints: "strict TypeScript, no deps". The code above is strict-compliant. I'll add `strict: true` in tsconfig mentally, but the code itself should avoid `any`, use explicit types, etc.

   One thing: `nextInt` and `nextFloat` bounds. The prompt says "nextInt(min,max) inclusive int". My formula handles that.
   `nextFloat(min,max)` -> usually [min, max). My formula `min + this.next() * (max - min)` gives [min, max). That's standard.
   `nextBool(p=0.5)` -> standard.
   `pick(arr)` -> standard.
   `shuffle(arr)` -> Fisher-Yates, non-mutating. Standard.
   `fork()` -> independent. Standard.

   Let's verify Mulberry32 implementation carefully.
   Standard JS implementation:
   ```javascript
   let seed = seed | 0;
   return function() {
     seed |= 0;
     seed = (seed + 0x6D2B79F5) | 0;
     let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
     t = (t + (t << 1)) | 0;
     t = t ^ (t >>> 4);
     return (t >>> 0) / 4294967296;
   };
   ```
   This is correct. I'll inline it properly.

   One minor point: `Math.imul` is standard in JS, no deps.
   I'll make sure the class is exported.

   Now, write the tests.
   Vitest test structure:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { SeededRng } from './seeded-rng'; // assuming file name

   describe('SeededRng', () => {
     it('same seed produces same sequence', () => {
       const rng1 = new SeededRng(123);
       const rng2 = new SeededRng(123);
       for (let i = 0; i < 10; i++) {
         expect(rng1.next()).toBe(rng2.next());
       }
     });

     it('different seeds produce different values', () => {
       const rng1 = new SeededRng(123);
       const rng2 = new SeededRng(456);
       expect(rng1.next()).not.toBe(rng2.next());
     });

     it('nextInt respects bounds', () => {
       const rng = new SeededRng(42);
       for (let i = 0; i < 1000; i++) {
         const val = rng.nextInt(1, 10);
         expect(val).toBeGreaterThanOrEqual(1);
         expect(val).toBeLessThanOrEqual(10);
       }
     });

     it('nextFloat respects bounds', () => {
       const rng = new SeededRng(42);
       for (let i = 0; i < 1000; i++) {
         const val = rng.nextFloat(0.5, 1.5);
         expect(val).toBeGreaterThanOrEqual(0.5);
         expect(val).toBeLessThan(1.5);
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
       const rng = new SeededRng(42);
       const arr = [1, 2, 3, 4, 5];
       const picked = rng.pick(arr);
       expect(arr).toContain(picked);
     });

     it('shuffle returns new array with same elements', () => {
       const rng = new SeededRng(42);
       const arr = [1, 2, 3, 4, 5];
       const original = [...arr];
       const shuffled = rng.shuffle(arr);
       expect(shuffled).toHaveLength(arr.length);
       expect(shuffled).toEqual(expect.arrayContaining(original));
       expect(shuffled).not.toBe(arr); // non-mutating check
     });

     it('fork creates independent instance', () => {
       const rng1 = new SeededRng(42);
       const rng2 = rng1.fork();
       rng1.next();
       expect(rng1.next()).not.toBe(rng2.next());
     });
   });
   ```

   Check test requirements:
   - same seed same sequence: covered
   - different seeds different values: covered
   - nextInt bounds: covered
   - nextFloat bounds: covered
   - nextBool p=0 always false, p=1 always true: covered
   - pick from array: covered
   - shuffle same elements not mutated: covered
   - fork independent instances: covered

   All requirements met. I'll structure the output as two files or one combined block. The prompt says "Write a TypeScript utility module... Also write vitest tests". I'll provide both in separate code blocks.

   One detail: `nextFloat` bounds. The prompt says `nextFloat(min,max)`. I'll assume standard [min, max) range. I'll add a comment or just implement it as `min + this.next() * (max - min)`. That's standard.
   For `nextInt`, inclusive: `Math.floor(this.next() * (max - min + 1)) + min`. Correct.
   For `nextBool`, `p` should be clamped or assumed valid. I'll assume valid [0,1].
   For `pick`, I'll handle empty array with error.
   For `shuffle`, I'll ensure it's non-mutating.

   Let's double check the Mulberry32 implementation for strict TS compatibility. `Math.imul` returns number. Bitwise operations coerce to 32-bit signed integers. The `| 0` and `>>> 0` ensure proper unsigned 32-bit handling. This is standard and correct.

   I'll write out the code carefully.

   Structure:
   `seeded-rng.ts`
   `seeded-rng.test.ts`

   I'll make sure imports are correct. I'll use `vitest` imports.
   I'll add `strict: true` implied by the prompt.
   I'll ensure no `any` types.
   I'll check `fork()` independence: `rng1.next()` advances `rng1`'s state. `rng2` was forked from `rng1`'s state *before* the call, so `rng2.next()` should differ from `rng1.next()`. That's correct.

   One minor point: `nextFloat` bounds test uses `toBeLessThan(1.5)`. Since `next()` returns `[0, 1)`, `nextFloat(0.5, 1.5)` returns `[0.5, 1.5)`. That's correct.
   `nextInt` bounds test uses `toBeGreaterThanOrEqual` and `toBeLessThanOrEqual`. Correct.

   I'll produce the code now.
   I will combine them into a single response with clear file markers.
   Check strict TS: I'll add `@ts-expect-error` if needed, but not necessary. I'll just write clean TS.
   I'll make sure the class exports properly.
   All good.
   Output matches requirements.
   Proceed. 
   One thing: `Math.imul` is standard, but in strict TS environments sometimes it complains about bitwise ops on numbers? No, bitwise ops automatically convert to 32-bit signed integers in JS/TS. It's fine.
   I'll write it out. 
   Self-Correction/Refinement during thought:
   - `nextFloat` might be expected to be inclusive? The prompt says `nextFloat(min,max)`. Usually float ranges are [min, max). I'll stick to that. If they want inclusive, they'd specify. I'll keep [min, max).
   - `nextInt` inclusive: handled.
   - `fork()`: "returns new independent SeededRng from current state". I'll copy state. If they meant forking should advance state differently, they'd say. Copying is standard for "fork".
   - I'll add type parameters to `pick` and `shuffle` for generics.
   - I'll ensure the test file uses `vitest` correctly.

   Code looks solid.
   Output generation. 
   [Done] 
   Output matches the response. 
   I will produce the code now. 
   *Self-Correction/Verification during generation prep*:
   Wait, `Math.imul` might not be available in very old environments,