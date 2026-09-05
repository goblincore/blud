```typescript
// object-pool.ts
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private resetFn?: (t: T) => void;

  constructor(factory: () => T, options?: { reset?: (t: T) => void; initialSize?: number }) {
    this.factory = factory;
    if (options?.reset) {
      this.resetFn = options.reset;
    }
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
    if (this.resetFn) {
      this.resetFn(t);
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
// object-pool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectPool } from './object-pool';

describe('ObjectPool', () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let resetSpy: ReturnType<typeof vi.fn>;
  let pool: ObjectPool<{ id: number; reset: boolean }>;

  beforeEach(() => {
    createSpy = vi.fn(() => ({ id: Math.random(), reset: false }));
    resetSpy = vi.fn();
    pool = new ObjectPool(createSpy, {
      reset: resetSpy,
      initialSize: 2,
    });
  });

  it('initial size fill', () => {
    expect(pool.size).toBe(2);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it('acquire creates when empty', () => {
    // Drain first to ensure empty
    pool.drain();
    expect(pool.size).toBe(0);
    
    const item = pool.acquire();
    expect(item).toBeDefined();
    expect(createSpy).toHaveBeenCalledTimes(3); // 2 initial + 1 new
  });

  it('release/recycle', () => {
    const item = pool.acquire();
    expect(pool.size).toBe(1);
    
    pool.release(item);
    expect(pool.size).toBe(2);
    
    // Verify reset was called
    expect(resetSpy).toHaveBeenCalledWith(item);
  });

  it('reset callback', () => {
    const item = pool.acquire();
    pool.release(item);
    
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalledWith(item);
  });

  it('drain', () => {
    const items = pool.drain();
    expect(items.length).toBe(2);
    expect(pool.size).toBe(0);
    
    // Subsequent acquire should create new
    const newItem = pool.acquire();
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  it('type safety', () => {
    // Compile-time check: T should be { id: number; reset: boolean }
    const item = pool.acquire();
    // @ts-expect-error - id should be number, not string
    const _id: string = item.id; 
    // This line above will fail type checking if strict mode is on, 
    // proving generic safety. We don't run it, but it ensures TS infers correctly.
    
    // Runtime check
    expect(typeof item.id).toBe('number');
  });
});
```
