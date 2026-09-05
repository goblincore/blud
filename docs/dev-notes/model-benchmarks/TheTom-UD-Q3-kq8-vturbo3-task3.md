```typescript
// ObjectPool.ts
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
// ObjectPool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  it('should create new objects when empty', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool<number>(factory as any);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(obj1).not.toBe(obj2);
  });

  it('should release and recycle objects', () => {
    const factory = vi.fn(() => ({ value: 0 }));
    const pool = new ObjectPool(factory as any);

    const obj = pool.acquire();
    expect(pool.size).toBe(0);

    pool.release(obj);
    expect(pool.size).toBe(1);

    const reusedObj = pool.acquire();
    expect(reusedObj).toBe(obj);
    expect(pool.size).toBe(0);
  });

  it('should call reset callback on release', () => {
    const reset = vi.fn();
    const factory = vi.fn(() => ({ count: 5 }));
    const pool = new ObjectPool(factory as any, reset as any);

    const obj = pool.acquire();
    obj.count = 10;
    pool.release(obj);

    expect(reset).toHaveBeenCalledWith({ count: 10 });
  });

  it('should drain all objects from pool', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory as any, undefined, 3);

    const drained = pool.drain();
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
  });

  it('should fill pool with initial size', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const pool = new ObjectPool(factory as any, undefined, 5);

    expect(pool.size).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it('should be type safe', () => {
    interface User {
      name: string;
      age: number;
    }

    const factory = (): User => ({ name: 'John', age: 30 });
    const reset = (u: User) => { u.name = ''; u.age = 0; };
    const pool = new ObjectPool<User>(factory, reset);

    const user: User = pool.acquire();
    expect(user.name).toBe('John');
    expect(user.age).toBe(30);

    pool.release(user);
    expect(pool.size).toBe(1);
  });
});
```
