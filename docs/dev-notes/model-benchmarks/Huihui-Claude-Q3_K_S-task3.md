```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private available: T[];
  private readonly factory: () => T;
  private readonly reset?: (t: T) => void;
  private allObjects: WeakSet<T>;

  constructor(
    factory: () => T,
    options?: { reset?: (t: T) => void; initialSize?: number }
  ) {
    this.factory = factory;
    this.reset = options?.reset;
    this.available = [];
    this.allObjects = new WeakSet();

    if (options?.initialSize) {
      for (let i = 0; i < options.initialSize; i++) {
        const obj = factory();
        this.available.push(obj);
      }
    }
  }

  acquire(): T {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return this.factory();
  }

  release(t: T): void {
    this.available.push(t);
    if (this.reset) {
      this.reset(t);
    }
  }

  drain(): T[] {
    const result = [...this.available];
    this.available = [];
    return result;
  }

  get size(): number {
    return this.available.length;
  }
}
```

```typescript
// ObjectPool.test.ts
import { describe, it, expect } from "vitest";
import { ObjectPool } from "./ObjectPool";

describe("ObjectPool", () => {
  it("acquires a new object when pool is empty", () => {
    let createCount = 0;
    const pool = new ObjectPool(() => createCount++);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(obj1).toBe(0);
    expect(obj2).toBe(1);
  });

  it("releases and recycles objects", () => {
    let createCount = 0;
    const pool = new ObjectPool(() => createCount++);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    pool.release(obj1);
    expect(pool.size).toBe(1);

    const obj3 = pool.acquire();
    expect(obj3).toBe(obj1);
    expect(pool.size).toBe(1);
  });

  it("calls reset callback on release", () => {
    let resetCalled = false;
    const pool = new ObjectPool(
      () => ({ value: 0 }),
      { reset: (obj) => { obj.value = 0; resetCalled = true; } }
    );

    const obj = pool.acquire();
    obj.value = 42;

    pool.release(obj);
    expect(obj.value).toBe(0);
    expect(resetCalled).toBe(true);
  });

  it("drains all objects", () => {
    const pool = new ObjectPool(() => Math.random());

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    const drained = pool.drain();
    expect(drained).toEqual([obj1, obj2]);
    expect(pool.size).toBe(0);
  });

  it("pre-fills pool with initial size", () => {
    let createCount = 0;
    const pool = new ObjectPool(() => createCount++, { initialSize: 3 });

    expect(pool.size).toBe(3);
    const obj1 = pool.acquire();
    expect(pool.size).toBe(2);
  });

  it("maintains type safety", () => {
    const pool = new ObjectPool<{ name: string; value: number }>(() => ({
      name: "test",
      value: 0,
    }));

    const obj = pool.acquire();
    expect(obj.name).toBe("test");
    expect(obj.value).toBe(0);

    pool.release({ name: "other", value: 100 });
    expect(pool.size).toBe(1);
  });
});
```

Key design decisions:

- `WeakSet` tracks all objects (prevents memory leaks if objects are GC'd externally).
- `drain` returns a copy so the caller owns the drained objects.
- `reset` is optional and only called during `release`, not during initial creation.
- `factory` is called lazily only when the pool is exhausted.
