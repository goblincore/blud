```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[];
  private factory: () => T;
  private reset?: (t: T) => void;

  constructor(factory: () => T, reset?: (t: T) => void, initialSize?: number) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    
    if (initialSize && initialSize > 0) {
      for (let i = 0; i < initialSize; i++) {
        this.pool.push(factory());
      }
    }
  }

  acquire(): T {
    return this.pool.pop() ?? this.factory();
  }

  release(t: T): void {
    if (this.reset) {
      this.reset(t);
    }
    this.pool.push(t);
  }

  drain(): T[] {
    const drained = [...this.pool];
    this.pool.length = 0;
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
  interface TestObj {
    id: number;
    name: string;
  }

  it('should create new objects when pool is empty', () => {
    const factory = vi.fn<TestObj>(() => ({ id: 1, name: 'test' }));
    const pool = new ObjectPool(factory);
    
    const obj = pool.acquire();
    
    expect(factory).toHaveBeenCalledTimes(1);
    expect(obj).toBe(factory.mock.results[0].value);
    expect(pool.size).toBe(0);
  });

  it('should recycle objects on release', () => {
    const factory = vi.fn<TestObj>(() => ({ id: 1, name: 'test' }));
    const pool = new ObjectPool(factory);
    
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    expect(obj1).not.toBe(obj2);
    
    pool.release(obj1);
    const obj3 = pool.acquire();
    
    expect(obj3).toBe(obj1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(pool.size).toBe(0);
  });

  it('should call reset callback on release', () => {
    const reset = vi.fn<(t: TestObj) => void>();
    const pool = new ObjectPool(() => ({ id: 1, name: 'test' }), reset);
    
    const obj = pool.acquire();
    pool.release(obj);
    
    expect(reset).toHaveBeenCalledWith(obj);
  });

  it('should drain all objects from pool', () => {
    const factory = vi.fn<TestObj>(() => ({ id: 1, name: 'test' }));
    const pool = new ObjectPool(factory);
    
    pool.acquire();
    pool.acquire();
    pool.acquire();
    
    const drained = pool.drain();
    
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('should pre-fill pool with initialSize', () => {
    const factory = vi.fn<TestObj>(() => ({ id: 1, name: 'test' }));
    const pool = new ObjectPool(factory, undefined, 3);
    
    expect(pool.size).toBe(3);
    expect(factory).toHaveBeenCalledTimes(3);
    
    const obj = pool.acquire();
    expect(obj).toBeDefined();
    expect(pool.size).toBe(2);
  });

  it('should be type safe', () => {
    class SafeObj {
      constructor(public value: number) {}
    }
    
    const pool = new ObjectPool(() => new SafeObj(42));
    const obj = pool.acquire();
    
    // TypeScript enforces type without explicit casting
    expect(obj.value).toBe(42);
    
    // @ts-expect-error - should reject incompatible types
    // pool.release({ invalid: true } as unknown as SafeObj);
  });
});
```