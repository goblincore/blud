```typescript
// object-pool.ts
export class ObjectPool<T> {
  private pool: T[];
  private factory: () => T;
  private reset?: (t: T) => void;

  constructor(
    factory: () => T,
    reset?: (t: T) => void,
    initialSize: number = 0
  ) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
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
    const items = [...this.pool];
    this.pool = [];
    return items;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// object-pool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './object-pool';

describe('ObjectPool', () => {
  it('should create new objects when pool is empty', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(obj1).not.toBe(obj2);
    expect(pool.size).toBe(0);
  });

  it('should recycle released objects', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory);

    const obj = pool.acquire();
    expect(pool.size).toBe(0);

    pool.release(obj);
    expect(pool.size).toBe(1);

    const reused = pool.acquire();
    expect(reused).toBe(obj);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should call reset callback before returning object to pool', () => {
    const factory = vi.fn(() => ({ count: 0 }));
    const reset = vi.fn();
    const pool = new ObjectPool(factory, reset);

    const obj = pool.acquire();
    obj.count = 42;
    pool.release(obj);

    expect(reset).toHaveBeenCalledWith(obj);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('should drain all objects from the pool', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory, undefined, 3);

    expect(pool.size).toBe(3);

    const drained = pool.drain();
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);

    // New acquisitions should create fresh objects
    const fresh = pool.acquire();
    expect(factory).toHaveBeenCalledTimes(4); // 3 initial + 1 new
  });

  it('should fill pool with initial size', () => {
    const factory = vi.fn(() => ({}));
    const initialSize = 5;
    const pool = new ObjectPool(factory, undefined, initialSize);

    expect(pool.size).toBe(initialSize);
    expect(factory).toHaveBeenCalledTimes(initialSize);
  });

  it('should maintain type safety', () => {
    interface MyObj {
      value: number;
    }
    const factory = (): MyObj => ({ value: 0 });
    const pool = new ObjectPool<MyObj>(factory);

    const obj: MyObj = pool.acquire();
    // @ts-expect-error - should not allow non-MyObj types
    pool.release({ invalid: true });
    pool.release(obj);
  });
});
```
