<!-- thinking (767 chars) -->

The user wants me to create a TypeScript generic ObjectPool<T> class with specific requirements, along with vitest tests. Let me think through the design:

1. **ObjectPool<T>** - A generic pool for reusing objects of type T
2. **Constructor** takes:
   - `factory: () => T` - Creates new objects when pool is empty
   - `reset?: (t: T) => void` - Optional reset function
   - `initialSize?: number` - Optional initial number of objects to pre-populate
3. **Methods**:
   - `acquire(): T` - Get an object from pool (create new if empty)
   - `release(t: T): void` - Return object to pool (call reset if provided)
   - `drain(): T[]` - Remove and return all objects from pool
   - `get size(): number` - Get available count

Let me write the implementation and tests.


<!-- answer (4420 chars) -->
```typescript
// src/object-pool.ts

export class ObjectPool<T> {
  private pool: T[];
  private readonly factory: () => T;
  private readonly reset?: (t: T) => void;

  constructor(
    factory: () => T,
    options?: { reset?: (t: T) => void; initialSize?: number }
  ) {
    this.factory = factory;
    this.reset = options?.reset;
    this.pool = [];

    if (options?.initialSize) {
      for (let i = 0; i < options.initialSize; i++) {
        this.pool.push(this.factory());
      }
    }
  }

  acquire(): T {
    if (this.pool.length === 0) {
      return this.factory();
    }
    return this.pool.pop()!;
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
// src/__tests__/object-pool.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from '../object-pool';

describe('ObjectPool', () => {
  describe('acquire', () => {
    it('creates new object when pool is empty', () => {
      const pool = new ObjectPool(() => ({ id: Math.random() }));
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();

      expect(obj1).not.toBe(obj2);
      expect(typeof obj1).toBe('object');
    });

    it('returns pooled object when available', () => {
      const obj = { id: 1 };
      const pool = new ObjectPool(() => ({ id: 2 }));
      pool.release(obj);

      const retrieved = pool.acquire();
      expect(retrieved).toBe(obj);
    });
  });

  describe('release and recycle', () => {
    it('returns object to pool', () => {
      const pool = new ObjectPool(() => ({ id: 0 }));
      const obj = pool.acquire();
      pool.release(obj);

      expect(pool.size).toBe(1);
    });

    it('reuses released object on next acquire', () => {
      const obj = { id: 1 };
      const pool = new ObjectPool(() => ({ id: 2 }));
      pool.release(obj);

      expect(pool.acquire()).toBe(obj);
    });
  });

  describe('reset callback', () => {
    it('calls reset function when releasing', () => {
      const resetFn = vi.fn();
      const pool = new ObjectPool(
        () => ({ value: 0 }),
        { reset: resetFn }
      );

      const obj = pool.acquire();
      pool.release(obj);

      expect(resetFn).toHaveBeenCalledWith(obj);
    });

    it('does not call reset when not provided', () => {
      const resetFn = vi.fn();
      const pool = new ObjectPool(() => ({ value: 0 }));

      const obj = pool.acquire();
      pool.release(obj);

      expect(resetFn).not.toHaveBeenCalled();
    });
  });

  describe('drain', () => {
    it('removes all objects from pool', () => {
      const pool = new ObjectPool(() => ({ id: 0 }));
      pool.acquire();
      pool.acquire();
      pool.acquire();

      const drained = pool.drain();

      expect(pool.size).toBe(0);
      expect(drained).toHaveLength(3);
    });

    it('returns array of drained objects', () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const pool = new ObjectPool(() => ({ id: 0 }));
      pool.release(obj1);
      pool.release(obj2);

      const drained = pool.drain();

      expect(drained).toContain(obj1);
      expect(drained).toContain(obj2);
    });

    it('pool is empty after drain', () => {
      const pool = new ObjectPool(() => ({ id: 0 }));
      pool.acquire();

      pool.drain();
      pool.release({ id: 0 });

      const drained = pool.drain();
      expect(drained).toHaveLength(1);
    });
  });

  describe('initial size fill', () => {
    it('pre-populates pool with given size', () => {
      const factory = vi.fn(() => ({ id: 0 }));
      new ObjectPool(factory, { initialSize: 5 });

      expect(factory).toHaveBeenCalledTimes(5);
    });

    it('returns correct size from pre-populated pool', () => {
      const pool = new ObjectPool(() => ({ id: 0 }), { initialSize: 3 });

      expect(pool.size).toBe(3);
    });
  });

  describe('type safety', () => {
    interface User {
      name: string;
      age: number;
    }

    it('enforces type safety with generics', () => {
      const pool = new ObjectPool<User>(() => ({ name: 'test', age: 0 }));
      const user: User = pool.acquire();

      expect(user.name).toBe('test');
      expect(typeof user.age).toBe('number');
    });
  });
});
```