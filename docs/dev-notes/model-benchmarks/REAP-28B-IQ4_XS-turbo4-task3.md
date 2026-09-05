```typescript
export class ObjectPool<T> {
  private pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (obj: T) => void;

  constructor(
    factory: () => T,
    options?: {
      reset?: (obj: T) => void;
      initialSize?: number;
    }
  ) {
    this.factory = factory;
    this.reset = options?.reset;
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
    const items = this.pool;
    this.pool = [];
    return items;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  it('acquire creates new object when pool is empty', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory);

    const obj = pool.acquire();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(obj).toBeDefined();
    expect(pool.size).toBe(0);
  });

  it('release/recycle returns object to pool', () => {
    const factory = vi.fn(() => ({ value: 0 }));
    const pool = new ObjectPool(factory);

    const obj = pool.acquire();
    expect(pool.size).toBe(0);

    pool.release(obj);
    expect(pool.size).toBe(1);

    const obj2 = pool.acquire();
    expect(obj).toBe(obj2); // Same reference reused
    expect(pool.size).toBe(0);
  });

  it('reset callback is called on release', () => {
    const reset = vi.fn();
    const factory = vi.fn(() => ({ count: 1 }));
    const pool = new ObjectPool(factory, { reset });

    const obj = pool.acquire();
    obj.count = 99;

    pool.release(obj);

    expect(reset).toHaveBeenCalledWith(obj);
    expect(obj.count).toBe(99); // Reset doesn't mutate unless implemented in reset
  });

  it('drain removes all objects and returns them', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, { initialSize: 3 });

    expect(pool.size).toBe(3);

    const drained = pool.drain();

    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
    expect(drained.every((_, i) => i < 3)).toBe(true); // Just sanity check
  });

  it('initial size fills pool', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, { initialSize: 5 });

    expect(pool.size).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it('type safety', () => {
    interface User {
      name: string;
    }

    const factory = () => ({ name: 'Alice' } as User);
    const pool = new ObjectPool<User>(factory);

    const user: User = pool.acquire();
    expect(user.name).toBe('Alice');

    pool.release(user);
    expect(pool.size).toBe(0);
  });
});
```
