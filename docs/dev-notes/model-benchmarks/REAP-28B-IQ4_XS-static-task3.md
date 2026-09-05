```typescript
// object-pool.ts

type Factory<T> = () => T;
type Resetter<T> = (item: T) => void;

export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: Factory<T>;
  private resetter?: Resetter<T>;
  private initialSize: number;

  constructor(factory: Factory<T>, resetter?: Resetter<T>, initialSize: number = 0) {
    this.factory = factory;
    this.resetter = resetter;
    this.initialSize = initialSize;
    this.fillPool();
  }

  private fillPool(): void {
    for (let i = 0; i < this.initialSize; i++) {
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
    if (this.resetter) {
      this.resetter(t);
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
// object-pool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './object-pool';

describe('ObjectPool', () => {
  it('acquires a new object when pool is empty', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj = pool.acquire();
    expect(obj).toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('releases and recycles objects', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory);
    
    const obj = pool.acquire();
    expect(pool.size).toBe(0);
    
    pool.release(obj);
    expect(pool.size).toBe(1);
    
    // Re-acquire should return the same object instance
    const obj2 = pool.acquire();
    expect(obj2).toBe(obj);
    expect(factory).toHaveBeenCalledTimes(1); // No new creation
  });

  it('calls reset callback on release', () => {
    const factory = vi.fn(() => ({ value: 10 }));
    const resetter = vi.fn();
    const pool = new ObjectPool(factory, resetter);
    
    const obj = pool.acquire();
    obj.value = 20;
    
    pool.release(obj);
    
    expect(resetter).toHaveBeenCalledWith(obj);
    expect(obj.value).toBe(10); // Reset applied
  });

  it('drains all objects from the pool', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory, undefined, 3);
    
    expect(pool.size).toBe(3);
    
    const drained = pool.drain();
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
    
    // Subsequent acquire creates new
    const newObj = pool.acquire();
    expect(factory).toHaveBeenCalledTimes(4); // 3 initial + 1 new
  });

  it('fills pool with initial size', () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(factory, undefined, 5);
    
    expect(pool.size).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it('maintains type safety', () => {
    interface User {
      name: string;
      age: number;
    }
    
    const factory = (): User => ({ name: 'Alice', age: 30 });
    const pool = new ObjectPool<User>(factory);
    
    const user = pool.acquire();
    // TypeScript should enforce this
    expect(user.name).toBe('Alice');
    expect(user.age).toBe(30);
    
    // @ts-expect-error: release expects User, not number
    // pool.release(123); 
  });
});
```
