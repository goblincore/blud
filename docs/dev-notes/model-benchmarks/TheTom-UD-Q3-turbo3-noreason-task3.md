```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (item: T) => void;

  constructor(
    factory: () => T,
    reset?: (item: T) => void,
    initialSize: number = 0
  ) {
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
  it('should create new object when pool is empty', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj = pool.acquire();
    
    expect(obj).toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  it('should return object from pool instead of creating new', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj1 = pool.acquire();
    pool.release(obj1);
    
    const obj2 = pool.acquire();
    
    expect(obj2).toBe(obj1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  it('should call reset callback when releasing', () => {
    const factory = vi.fn(() => ({ count: 0 }));
    const reset = vi.fn((obj: { count: number }) => {
      obj.count = 0;
    });
    const pool = new ObjectPool(factory, reset);
    
    const obj = pool.acquire();
    obj.count = 5;
    pool.release(obj);
    
    expect(reset).toHaveBeenCalledWith(obj);
    expect(obj.count).toBe(0);
  });

  it('should not call reset if not provided', () => {
    const factory = vi.fn(() => ({ count: 0 }));
    const reset = vi.fn();
    const pool = new ObjectPool(factory, reset);
    
    const obj = pool.acquire();
    obj.count = 5;
    pool.release(obj);
    
    expect(reset).not.toHaveBeenCalled();
    expect(obj.count).toBe(5);
  });

  it('should drain all objects from pool', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj1 = pool.acquire();
    pool.release(obj1);
    const obj2 = pool.acquire();
    pool.release(obj2);
    
    const drained = pool.drain();
    
    expect(drained).toEqual([obj1, obj2]);
    expect(pool.size).toBe(0);
  });

  it('should drain empty pool and return empty array', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const drained = pool.drain();
    
    expect(drained).toEqual([]);
    expect(pool.size).toBe(0);
  });

  it('should fill pool with initialSize objects', () => {
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
    
    const factory = (): User => ({ name: 'John', age: 30 });
    const pool = new ObjectPool<User>(factory);
    
    const user = pool.acquire();
    // TypeScript should enforce User type
    const name: string = user.name;
    const age: number = user.age;
    
    expect(user).toEqual({ name: 'John', age: 30 });
    
    pool.release({ name: 'Jane', age: 25 });
  });

  it('should handle multiple acquire/release cycles', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    const obj3 = pool.acquire();
    
    pool.release(obj1);
    pool.release(obj3);
    
    const obj4 = pool.acquire();
    const obj5 = pool.acquire();
    
    expect(obj4).toBe(obj1);
    expect(obj5).toBe(obj3);
    expect(pool.size).toBe(0);
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
```
