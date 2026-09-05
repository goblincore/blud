```typescript
// objectPool.ts

export class ObjectPool<T> {
  private pool: T[];
  private factory: () => T;
  private reset?: (obj: T) => void;

  constructor(
    factory: () => T,
    reset?: (obj: T) => void,
    initialSize: number = 0
  ) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];

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

  release(obj: T): void {
    if (this.reset) {
      this.reset(obj);
    }
    this.pool.push(obj);
  }

  drain(): T[] {
    const drained = [...this.pool];
    this.pool = [];
    return drained;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// objectPool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './objectPool';

describe('ObjectPool', () => {
  it('should create new objects when pool is empty', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(obj1).not.toBe(obj2);
  });

  it('should return objects from pool instead of creating new ones', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory, undefined, 2);

    expect(factory).toHaveBeenCalledTimes(2);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(factory).toHaveBeenCalledTimes(2);

    pool.release(obj1);
    pool.release(obj2);

    const obj3 = pool.acquire();
    expect(obj3).toBe(obj1); // Reused

    const obj4 = pool.acquire();
    expect(obj4).toBe(obj2); // Reused
  });

  it('should call reset callback when releasing', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ count: 0 }), reset);

    const obj = pool.acquire();
    obj.count = 10;
    pool.release(obj);

    expect(reset).toHaveBeenCalledWith(obj);
  });

  it('should not call reset if no reset function provided', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ count: 0 }), undefined);

    const obj = pool.acquire();
    pool.release(obj);

    expect(reset).not.toHaveBeenCalled();
  });

  it('drain should return all objects and empty the pool', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory, undefined, 3);

    const drained = pool.drain();

    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('drain should return empty array when pool is empty', () => {
    const pool = new ObjectPool(() => ({}));

    const drained = pool.drain();

    expect(drained).toEqual([]);
    expect(pool.size).toBe(0);
  });

  it('should initialize pool with initialSize objects', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, undefined, 5);

    expect(pool.size).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it('should enforce type safety', () => {
    interface User {
      name: string;
      age: number;
    }

    const pool = new ObjectPool<User>(
      () => ({ name: 'test', age: 0 }),
      (u) => {
        u.age = 0;
      },
      1
    );

    const user: User = pool.acquire();
    expect(user.name).toBe('test');

    user.age = 25;
    pool.release(user);

    // TypeScript should prevent assigning non-User types
    // @ts-expect-error - number is not assignable to User
    pool.release(42);
  });

  it('size should reflect available objects', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, undefined, 2);

    expect(pool.size).toBe(2);

    const obj = pool.acquire();
    expect(pool.size).toBe(1);

    pool.release(obj);
    expect(pool.size).toBe(2);
  });
});
```
