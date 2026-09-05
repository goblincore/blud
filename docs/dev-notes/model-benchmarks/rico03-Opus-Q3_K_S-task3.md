<|think|>
Looking at this request, I need to implement a TypeScript generic ObjectPool class with specific methods and write comprehensive tests.

Key requirements:
1. Constructor takes factory() => T and optional reset(t:T) => void and initialSize number
2. acquire(): T - returns object from pool, creates new if empty
3. release(t: T): void - returns object to pool, calls reset if provided
4. drain(): T[] - removes all objects from pool and returns them
5. get size(): number - returns available count

For the implementation:
- Use an array as the internal pool storage
- Factory creates new objects when pool is empty
- Reset callback is optional and called when releasing
- Drain removes all objects from the pool
- Size getter returns count of available objects

For tests:
- Test acquire creates new objects when pool is empty
- Test release/recycle functionality
- Test reset callback is called
- Test drain method
- Test initial size fill
- Test type safety (generics)

I'll implement this with proper TypeScript types and comprehensive vitest tests.
<|/think|>
```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (t: T) => void;

  constructor(factory: () => T, options?: { reset?: (t: T) => void; initialSize?: number }) {
    this.factory = factory;
    this.reset = options?.reset;

    // Pre-fill pool if initialSize is provided
    if (options?.initialSize) {
      for (let i = 0; i < options.initialSize; i++) {
        this.pool.push(this.factory());
      }
    }
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  release(t: T): void {
    if (this.reset) {
      this.reset(t);
    }
    this.pool.push(t);
  }

  drain(): T[] {
    const drained = this.pool;
    this.pool = [];
    return drained;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// ObjectPool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  it('should create new objects when pool is empty', () => {
    const createFn = vi.fn(() => ({ id: 'new-object' }));
    const pool = new ObjectPool(createFn);

    expect(pool.size).toBe(0);
    const obj1 = pool.acquire();
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(obj1.id).toBe('new-object');

    const obj2 = pool.acquire();
    expect(createFn).toHaveBeenCalledTimes(2);
    expect(obj2.id).toBe('new-object');
  });

  it('should reuse objects from pool', () => {
    const createFn = vi.fn(() => ({ id: 'reused-object' }));
    const pool = new ObjectPool(createFn);

    const obj1 = pool.acquire();
    expect(createFn).toHaveBeenCalledTimes(1);

    pool.release(obj1);
    expect(createFn).toHaveBeenCalledTimes(1); // No new creation

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1); // Same object reused
  });

  it('should call reset callback when releasing', () => {
    const resetFn = vi.fn();
    const createFn = vi.fn(() => ({ id: 'test', dirty: true }));

    const pool = new ObjectPool(createFn, { reset: resetFn });
    const obj = pool.acquire();

    pool.release(obj);
    expect(resetFn).toHaveBeenCalledWith(obj);
  });

  it('should not call reset callback when none provided', () => {
    const createFn = vi.fn(() => ({ id: 'test' }));
    const pool = new ObjectPool(createFn);
    const obj = pool.acquire();

    pool.release(obj);
    // No reset callback, should not throw
    expect(pool.size).toBe(1);
  });

  it('should drain all objects from pool', () => {
    const createFn = vi.fn(() => ({ id: 'drain-test' }));
    const pool = new ObjectPool(createFn, { initialSize: 3 });

    expect(pool.size).toBe(3);

    const drained = pool.drain();
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
  });

  it('should pre-fill pool with initialSize', () => {
    const createFn = vi.fn(() => ({ id: 'initial' }));
    const pool = new ObjectPool(createFn, { initialSize: 5 });

    expect(createFn).toHaveBeenCalledTimes(5);
    expect(pool.size).toBe(5);
  });

  it('should handle type safety with generics', () => {
    interface User {
      name: string;
      age: number;
    }

    const createUser = () => ({ name: 'test', age: 25 } as User);
    const pool = new ObjectPool<User>(createUser);

    // TypeScript should enforce the type
    const user: User = pool.acquire();
    expect(user.name).toBe('test');
    expect(user.age).toBe(25);
  });

  it('should handle complex release scenario', () => {
    const resetFn = vi.fn();
    const pool = new ObjectPool(() => ({ value: 0 }), { reset: resetFn });

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    obj1.value = 42;
    obj2.value = 99;

    pool.release(obj1);
    pool.release(obj2);

    expect(resetFn).toHaveBeenCalledTimes(2);
    expect(pool.size).toBe(2);
  });
});
```
