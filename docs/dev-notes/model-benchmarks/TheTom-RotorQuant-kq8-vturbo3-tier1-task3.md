```typescript
import { vi, expect, it, describe } from 'vitest';

export class ObjectPool<T> {
  private available: T[];
  private factory: () => T;
  private resetFn?: (t: T) => void;

  constructor(factory: () => T, resetFn?: (t: T) => void, initialSize: number = 0) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.available = [];
    for (let i = 0; i < initialSize; i++) {
      this.available.push(this.factory());
    }
  }

  acquire(): T {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return this.factory();
  }

  release(t: T): void {
    if (this.resetFn) {
      this.resetFn(t);
    }
    this.available.push(t);
  }

  drain(): T[] {
    const items = this.available.splice(0, this.available.length);
    return items;
  }

  get size(): number {
    return this.available.length;
  }
}

// Tests
describe('ObjectPool', () => {
  it('acquire creates when empty', () => {
    const create = vi.fn(() => ({ id: Date.now() }));
    const pool = new ObjectPool(create);
    const obj = pool.acquire();
    expect(create).toHaveBeenCalledTimes(1);
    expect(obj).toBeDefined();
  });

  it('release/recycle', () => {
    const create = vi.fn(() => ({ id: 1 }));
    const pool = new ObjectPool(create);
    const obj = pool.acquire();
    expect(pool.size).toBe(0);
    pool.release(obj);
    expect(pool.size).toBe(1);
    const obj2 = pool.acquire();
    expect(obj2).toBe(obj);
  });

  it('reset callback', () => {
    const reset = vi.fn();
    const create = vi.fn(() => ({ val: 0 }));
    const pool = new ObjectPool(create, reset, 1);
    const obj = pool.acquire();
    expect(reset).not.toHaveBeenCalled();
    pool.release(obj);
    expect(reset).toHaveBeenCalledWith(obj);
  });

  it('drain', () => {
    const create = vi.fn(() => ({}));
    const pool = new ObjectPool(create, undefined, 3);
    const drained = pool.drain();
    expect(drained).toHaveLength(3);
    expect(pool.size).toBe(0);
  });

  it('initial size fill', () => {
    const create = vi.fn(() => ({}));
    const pool = new ObjectPool(create, undefined, 5);
    expect(pool.size).toBe(5);
  });

  it('type safety', () => {
    interface MyObj { a: number; b: string; }
    const pool = new ObjectPool<MyObj>(() => ({ a: 1, b: '2' }));
    const obj: MyObj = pool.acquire();
    expect(typeof obj.a).toBe('number');
    expect(typeof obj.b).toBe('string');
  });
});
```
