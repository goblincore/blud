<!-- reasoning_content (17235 chars) -->
Here's a thinking process:

1.  **Analyze User Request:**
   - **Language:** TypeScript
   - **Class:** `ObjectPool<T>`
   - **Constructor:** `factory: () => T`, `reset?: (t: T) => void`, `initialSize?: number`
   - **Methods:**
     - `acquire(): T` - returns an object from pool, creates new if empty
     - `release(t: T): void` - returns object to pool, calls reset if provided
     - `drain(): T[]` - removes and returns all objects from pool
     - `size: number` (getter) - returns available count
   - **Tests:** Vitest tests covering:
     - acquire creates when empty
     - release/recycle
     - reset callback
     - drain
     - initial size fill
     - type safety
   - **Constraints:** Concise, clean working TypeScript, no explanations unless asked.

2.  **Design the Class:**
   - Need a private array to store pooled objects: `private pool: T[]`
   - Constructor parameters: `factory: () => T`, `reset?: (t: T) => void`, `initialSize?: number`
   - Initialize `pool` array
   - If `initialSize` is provided, pre-fill the pool with `initialSize` objects using `factory`
   - `acquire()`: if `pool.length > 0`, return `pool.pop()`, else return `factory()`
   - `release(t: T)`: if `reset`, call `reset(t)`, then `pool.push(t)`
   - `drain()`: return `pool.splice(0)` (or `[...this.pool]` then clear, but `splice(0)` is efficient)
   - `get size()`: return `this.pool.length`

   Let's write it out mentally:
   ```typescript
   export class ObjectPool<T> {
     private pool: T[] = [];
     constructor(
       private readonly factory: () => T,
       private readonly reset?: (t: T) => void,
       initialSize: number = 0
     ) {
       for (let i = 0; i < initialSize; i++) {
         this.pool.push(this.factory());
       }
     }
     acquire(): T {
       return this.pool.length > 0 ? this.pool.pop()! : this.factory();
     }
     release(t: T): void {
       if (this.reset) this.reset(t);
       this.pool.push(t);
     }
     drain(): T[] {
       return this.pool.splice(0);
     }
     get size(): number {
       return this.pool.length;
     }
   }
   ```
   Wait, `splice(0)` returns the removed elements. That's correct. But `splice` mutates the array. That's fine since we're draining it. Alternatively, `const items = [...this.pool]; this.pool.length = 0; return items;` is safer/cleaner. I'll use `splice(0)` or the array copy approach. Actually, `splice(0)` is fine.

   Let's refine type safety: The class is generic. Tests should verify type safety (e.g., using `expectType` or just standard assertions with inferred types). Vitest doesn't have built-in `expectType`, but we can use `expectTypeOf` from `vitest` or just rely on TypeScript compiler checks. I'll use `expectTypeOf` from `vitest` if available, or just standard tests that would fail compilation if types were wrong. Actually, `vitest` has `expectTypeOf` in recent versions. I'll use standard assertions but structure tests to demonstrate type safety (e.g., assigning to specific types, method signatures).

   Wait, the prompt says "type safety". I'll write a test that checks the return type of `acquire` and `drain` are correctly inferred as `T[]`, and maybe use `expectTypeOf` if available, or just rely on TS compilation. I'll stick to standard vitest tests but ensure they compile and work. I can also add a compile-time check using `expectTypeOf` from `vitest` (imported as `expectTypeOf` from `vitest`). Actually, `vitest` exports `expectTypeOf` in newer versions. I'll use it.

   Let's draft the tests:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { ObjectPool } from './ObjectPool';

   describe('ObjectPool', () => {
     it('creates new objects when empty', () => {
       const pool = new ObjectPool(() => ({ id: Math.random() }));
       const obj1 = pool.acquire();
       const obj2 = pool.acquire();
       expect(obj1).not.toBe(obj2);
     });

     it('releases and recycles objects', () => {
       const factory = vi.fn(() => ({ val: 0 }));
       const pool = new ObjectPool(factory);
       const obj = pool.acquire();
       expect(factory).toHaveBeenCalledTimes(1);
       pool.release(obj);
       expect(pool.size).toBe(1);
       const recycled = pool.acquire();
       expect(recycled).toBe(obj);
       expect(factory).toHaveBeenCalledTimes(1); // no new creation
     });

     it('calls reset callback on release', () => {
       const reset = vi.fn();
       const pool = new ObjectPool(() => ({ count: 0 }), reset);
       const obj = pool.acquire();
       pool.release(obj);
       expect(reset).toHaveBeenCalledWith(obj);
     });

     it('drains all objects', () => {
       const pool = new ObjectPool(() => ({}));
       pool.acquire();
       pool.acquire();
       const drained = pool.drain();
       expect(drained).toHaveLength(2);
       expect(pool.size).toBe(0);
     });

     it('pre-fills with initialSize', () => {
       const factory = vi.fn(() => ({}));
       const pool = new ObjectPool(factory, undefined, 3);
       expect(pool.size).toBe(3);
       expect(factory).toHaveBeenCalledTimes(3);
     });

     it('maintains type safety', () => {
       interface User { name: string; age: number; }
       const pool = new ObjectPool<User>(() => ({ name: 'test', age: 25 }));
       const user = pool.acquire();
       expect(user.name).toBe('test'); // TS should enforce this
       const users = pool.drain();
       expect(users[0].age).toBe(25); // TS should enforce this
     });
   });
   ```

   Wait, `vi.fn()` is from vitest. I need to import it or use `import { vi } from 'vitest'`. Actually, vitest auto-provides `vi` globally, but I'll import it explicitly or rely on global. I'll use `import { describe, it, expect, vi } from 'vitest';`.

   Let's check `expectTypeOf`. Actually, standard tests are fine. The "type safety" requirement is usually satisfied by the test compiling and working with generics. I'll add a compile-time check using `expectTypeOf` if available, but it's not strictly necessary. I'll just use standard assertions. To be safe, I'll use `expectTypeOf` from `vitest` which is standard in v1+.

   Actually, `vitest` exports `expectTypeOf`. I'll use it for explicit type safety demonstration.
   But to keep it simple and robust, I'll just use standard `expect` and rely on TypeScript's type inference. The prompt says "type safety", so I'll add a test that explicitly checks types using `expectTypeOf` or just relies on TS compilation. I'll stick to standard vitest.

   Let's refine the class to be production-ready:
   ```typescript
   export class ObjectPool<T> {
     private pool: T[] = [];

     constructor(
       private readonly factory: () => T,
       private readonly reset?: (t: T) => void,
       initialSize: number = 0
     ) {
       for (let i = 0; i < initialSize; i++) {
         this.pool.push(this.factory());
       }
     }

     acquire(): T {
       return this.pool.length > 0 ? this.pool.pop()! : this.factory();
     }

     release(t: T): void {
       if (this.reset) this.reset(t);
       this.pool.push(t);
     }

     drain(): T[] {
       return this.pool.splice(0);
     }

     get size(): number {
       return this.pool.length;
     }
   }
   ```

   Wait, `splice(0)` returns `T[]`. That's correct.
   One minor thing: `initialSize` could be negative? I'll assume valid input per contract, but I can add `Math.max(0, initialSize)` if needed. Not required.

   Let's check the test for `drain`: `pool.drain()` returns `T[]`. The test checks length and size. Good.
   Test for `release/recycle`: checks that `acquire` after `release` returns the same object. Good.
   Test for `reset callback`: checks it's called. Good.
   Test for `initial size fill`: checks factory called N times and size is N. Good.
   Test for `type safety`: I'll use `expectTypeOf` to explicitly assert types, or just rely on TS. I'll use `expectTypeOf` from `vitest` for modern vitest. Actually, `expectTypeOf` is in `vitest` package. I'll import it.

   Let's structure the code properly. I'll put the class and tests in one response as requested, but typically they're separate files. I'll provide them clearly.

   One thing: `vi` is global in vitest by default, but I'll import it to be safe: `import { describe, it, expect, vi } from 'vitest';`
   Actually, `vi` is usually available globally. I'll just use `vi.fn()` without import if vitest config has globals, but to be safe I'll import it or use `import { vi } from 'vitest'`.

   Let's write out the full solution.

   Class:
   ```typescript
   export class ObjectPool<T> {
     private pool: T[] = [];

     constructor(
       private readonly factory: () => T,
       private readonly reset?: (t: T) => void,
       initialSize: number = 0
     ) {
       for (let i = 0; i < initialSize; i++) {
         this.pool.push(this.factory());
       }
     }

     acquire(): T {
       return this.pool.length > 0 ? this.pool.pop()! : this.factory();
     }

     release(t: T): void {
       if (this.reset) this.reset(t);
       this.pool.push(t);
     }

     drain(): T[] {
       return this.pool.splice(0);
     }

     get size(): number {
       return this.pool.length;
     }
   }
   ```

   Tests:
   ```typescript
   import { describe, it, expect, vi, expectTypeOf } from 'vitest';
   import { ObjectPool } from './ObjectPool';

   describe('ObjectPool', () => {
     it('creates new objects when empty', () => {
       const pool = new ObjectPool(() => ({ id: Math.random() }));
       const obj1 = pool.acquire();
       const obj2 = pool.acquire();
       expect(obj1).not.toBe(obj2);
     });

     it('releases and recycles objects', () => {
       const factory = vi.fn(() => ({ val: 0 }));
       const pool = new ObjectPool(factory);
       const obj = pool.acquire();
       expect(factory).toHaveBeenCalledTimes(1);

       pool.release(obj);
       expect(pool.size).toBe(1);

       const recycled = pool.acquire();
       expect(recycled).toBe(obj);
       expect(factory).toHaveBeenCalledTimes(1);
     });

     it('calls reset callback on release', () => {
       const reset = vi.fn();
       const pool = new ObjectPool(() => ({ count: 0 }), reset);
       const obj = pool.acquire();
       pool.release(obj);
       expect(reset).toHaveBeenCalledWith(obj);
     });

     it('drains all objects', () => {
       const pool = new ObjectPool(() => ({}));
       pool.acquire();
       pool.acquire();
       const drained = pool.drain();
       expect(drained).toHaveLength(2);
       expect(pool.size).toBe(0);
     });

     it('pre-fills with initialSize', () => {
       const factory = vi.fn(() => ({}));
       const pool = new ObjectPool(factory, undefined, 3);
       expect(pool.size).toBe(3);
       expect(factory).toHaveBeenCalledTimes(3);
     });

     it('maintains type safety', () => {
       interface User { name: string; age: number; }
       const pool = new ObjectPool<User>(() => ({ name: 'test', age: 25 }));
       const user = pool.acquire();
       expectTypeOf(user).toMatchTypeOf<User>();
       const users = pool.drain();
       expectTypeOf(users).toMatchTypeOf<User[]>();
     });
   });
   ```

   Wait, `expectTypeOf` is from `vitest`. I'll import it.
   One detail: `drain()` uses `splice(0)`. This mutates the internal array. That's fine.
   I should make sure the tests are self-contained and follow vitest best practices.
   The prompt says "Write vitest tests covering...". I'll provide both the class and the test file.

   Let's double check the `drain` implementation. `this.pool.splice(0)` returns all elements and clears the array. That's correct.
   Alternatively, `const items = [...this.pool]; this.pool.length = 0; return items;` is sometimes preferred to avoid any edge cases with `splice`, but `splice(0)` is standard and efficient. I'll stick with `splice(0)`.

   One minor improvement: `acquire()` could be written as `return this.pool.pop() ?? this.factory();` but `pop()` returns `T | undefined`, so `??` works. `this.pool.length > 0 ? this.pool.pop()! : this.factory()` is fine too. I'll use `this.pool.pop() ?? this.factory();` for brevity, but need to handle the `undefined` case. Actually, `pop()` returns `T | undefined`. `?? this.factory()` works. But `pop()!` is safer if we check length first. I'll keep the ternary.

   Let's verify type safety test: `expectTypeOf(user).toMatchTypeOf<User>()` works in vitest. Alternatively, I can just use standard assertions and rely on TS compilation, but `expectTypeOf` is explicit. I'll keep it.

   All requirements met:
   - Generic ObjectPool<T>
   - Constructor: factory, optional reset, optional initialSize
   - Methods: acquire, release, drain, size getter
   - Vitest tests: acquire creates when empty, release/recycle, reset callback, drain, initial size fill, type safety.

   I'll output the code clearly separated. No extra text.
   One thing: `vi` might need to be imported from `vitest`. I'll add `import { vi } from 'vitest';` at the top of the test file.
   I'll structure it as two code blocks: `ObjectPool.ts` and `ObjectPool.test.ts`.

   Final check of the code:
   ```typescript
   // ObjectPool.ts
   export class ObjectPool<T> {
     private pool: T[] = [];

     constructor(
       private readonly factory: () => T,
       private readonly reset?: (t: T) => void,
       initialSize: number = 0
     ) {
       for (let i = 0; i < initialSize; i++) {
         this.pool.push(this.factory());
       }
     }

     acquire(): T {
       return this.pool.length > 0 ? this.pool.pop()! : this.factory();
     }

     release(t: T): void {
       if (this.reset) this.reset(t);
       this.pool.push(t);
     }

     drain(): T[] {
       return this.pool.splice(0);
     }

     get size(): number {
       return this.pool.length;
     }
   }
   ```

   ```typescript
   // ObjectPool.test.ts
   import { describe, it, expect, vi, expectTypeOf } from 'vitest';
   import { ObjectPool } from './ObjectPool';

   describe('ObjectPool', () => {
     it('creates new objects when empty', () => {
       const pool = new ObjectPool(() => ({ id: Math.random() }));
       const obj1 = pool.acquire();
       const obj2 = pool.acquire();
       expect(obj1).not.toBe(obj2);
     });

     it('releases and recycles objects', () => {
       const factory = vi.fn(() => ({ val: 0 }));
       const pool = new ObjectPool(factory);
       const obj = pool.acquire();
       expect(factory).toHaveBeenCalledTimes(1);

       pool.release(obj);
       expect(pool.size).toBe(1);

       const recycled = pool.acquire();
       expect(recycled).toBe(obj);
       expect(factory).toHaveBeenCalledTimes(1);
     });

     it('calls reset callback on release', () => {
       const reset = vi.fn();
       const pool = new ObjectPool(() => ({ count: 0 }), reset);
       const obj = pool.acquire();
       pool.release(obj);
       expect(reset).toHaveBeenCalledWith(obj);
     });

     it('drains all objects', () => {
       const pool = new ObjectPool(() => ({}));
       pool.acquire();
       pool.acquire();
       const drained = pool.drain();
       expect(drained).toHaveLength(2);
       expect(pool.size).toBe(0);
     });

     it('pre-fills with initialSize', () => {
       const factory = vi.fn(() => ({}));
       const pool = new ObjectPool(factory, undefined, 3);
       expect(pool.size).toBe(3);
       expect(factory).toHaveBeenCalledTimes(3);
     });

     it('maintains type safety', () => {
       interface User { name: string; age: number; }
       const pool = new ObjectPool<User>(() => ({ name: 'test', age: 25 }));
       const user = pool.acquire();
       expectTypeOf(user).toMatchTypeOf<User>();
       const users = pool.drain();
       expectTypeOf(users).toMatchTypeOf<User[]>();
     });
   });
   ```

   This looks solid. I'll output it exactly as requested. No extra explanations.
   One minor point: `expectTypeOf` is available in vitest >= 1.0. I'll assume modern vitest. If not, standard TS compilation checks are enough, but I'll keep it.
   All good. Output matches request.✅
   I will present the code in two blocks: implementation and tests.
   Ready. 
   Self-Correction/Refinement during thought: 
   `drain()` using `splice(0)` is fine, but some might prefer `const items = [...this.pool]; this.pool.length = 0; return items;` to avoid any potential issues with `splice` on empty arrays (though `splice(0)` on empty returns `[]`). Both are fine. I'll stick with `splice(0)` for brevity and performance.
   The prompt says "Write vitest tests covering...". I'll provide them together.
   I'll make sure imports are correct. `vi` and `expectTypeOf` from `vitest`.
   All set. Output matches. 
   Proceeds. 
   [Output Generation] -> *Proceeds*
   *(Self-Correction/Verification during generation prep)*: 
   Wait, `expectTypeOf` might not be strictly necessary for "type safety", but it's good practice. I'll keep it. 
   The code is clean, concise, and meets all constraints. 
   Output matches the final refined version.✅
   Generating. 
   [Output] -> *Code blocks*
   (Note: I'll format it cleanly as requested)
   `ObjectPool.ts`
   `ObjectPool.test.ts`
   Done. 
   [Output Generation] (matches the refined version)
   *(Done.)*

<!-- content (2422 chars) -->
```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[] = [];

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (t: T) => void,
    initialSize: number = 0
  ) {
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  acquire(): T {
    return this.pool.length > 0 ? this.pool.pop()! : this.factory();
  }

  release(t: T): void {
    if (this.reset) this.reset(t);
    this.pool.push(t);
  }

  drain(): T[] {
    return this.pool.splice(0);
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// ObjectPool.test.ts
import { describe, it, expect, vi, expectTypeOf } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  it('creates new objects when empty', () => {
    const pool = new ObjectPool(() => ({ id: Math.random() }));
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    expect(obj1).not.toBe(obj2);
  });

  it('releases and recycles objects', () => {
    const factory = vi.fn(() => ({ val: 0 }));
    const pool = new ObjectPool(factory);
    const obj = pool.acquire();
    expect(factory).toHaveBeenCalledTimes(1);

    pool.release(obj);
    expect(pool.size).toBe(1);

    const recycled = pool.acquire();
    expect(recycled).toBe(obj);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('calls reset callback on release', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ count: 0 }), reset);
    const obj = pool.acquire();
    pool.release(obj);
    expect(reset).toHaveBeenCalledWith(obj);
  });

  it('drains all objects', () => {
    const pool = new ObjectPool(() => ({}));
    pool.acquire();
    pool.acquire();
    const drained = pool.drain();
    expect(drained).toHaveLength(2);
    expect(pool.size).toBe(0);
  });

  it('pre-fills with initialSize', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, undefined, 3);
    expect(pool.size).toBe(3);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('maintains type safety', () => {
    interface User { name: string; age: number; }
    const pool = new ObjectPool<User>(() => ({ name: 'test', age: 25 }));
    const user = pool.acquire();
    expectTypeOf(user).toMatchTypeOf<User>();
    const users = pool.drain();
    expectTypeOf(users).toMatchTypeOf<User[]>();
  });
});
```
