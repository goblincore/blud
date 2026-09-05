```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset?: (obj: T) => void;

  constructor(factory: () => T, reset?: (obj: T) => void, initialSize: number = 0) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
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
    this.pool.length = 0;
    return items;
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
  it('should create new object when empty', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    const obj = pool.acquire();
    expect(obj).toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should reuse released objects', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    const obj1 = pool.acquire();
    expect(obj1).toEqual({ id: 1 });
    pool.release(obj1);
    expect(pool.size).toBe(1);
    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1); // Same reference
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should call reset callback on release', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ count: 0 }), reset);
    const obj = pool.acquire();
    obj.count = 10;
    pool.release(obj);
    expect(reset).toHaveBeenCalledWith(obj);
  });

  it('should drain all objects from pool', () => {
    const pool = new ObjectPool(() => ({ id: 1 }));
    pool.acquire();
    pool.acquire();
    const drained = pool.drain();
    expect(drained).toHaveLength(0); // Pool should be empty after drain
    expect(pool.size).toBe(0);
  });

  it('should pre-fill pool with initialSize', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory, undefined, 3);
    expect(pool.size).toBe(3);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('should maintain type safety', () => {
    interface User {
      name: string;
      age: number;
    }
    const pool = new ObjectPool<User>(() => ({ name: 'Alice', age: 30 }));
    const user = pool.acquire();
    // TypeScript should enforce the type
    expect(user.name).toBe('Alice');
    expect(user.age).toBe(30);
  });
});
```
