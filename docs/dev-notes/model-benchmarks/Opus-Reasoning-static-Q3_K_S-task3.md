```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private available: T[] = [];
  private factory: () => T;
  private reset?: (t: T) => void;

  constructor(factory: () => T, options?: { reset?: (t: T) => void; initialSize?: number }) {
    this.factory = factory;
    if (options?.reset) this.reset = options.reset;
    if (options?.initialSize) {
      for (let i = 0; i < options.initialSize; i++) {
        this.available.push(this.factory());
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
  }

  drain(): T[] {
    const items = [...this.available];
    this.available = [];
    return items;
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
  it("acquire creates new object when pool is empty", () => {
    const pool = new ObjectPool(() => ({ id: Math.random() }));
    const obj = pool.acquire();
    expect(obj).toBeDefined();
  });

  it("release returns object to pool", () => {
    const pool = new ObjectPool(() => ({ id: 1 }));
    const obj = pool.acquire();
    pool.release(obj);
    expect(pool.size).toBe(1);
  });

  it("reset callback is called when releasing", () => {
    let resetCalled = false;
    const pool = new ObjectPool(
      () => ({ id: 1, dirty: true }),
      { reset: (t: { id: number; dirty: boolean }) => { t.dirty = false; resetCalled = true; } }
    );
    const obj = pool.acquire();
    pool.release(obj);
    expect(resetCalled).toBe(true);
  });

  it("drain removes all objects and returns them", () => {
    const pool = new ObjectPool(() => ({ id: 1 }));
    pool.acquire();
    pool.acquire();
    const drained = pool.drain();
    expect(drained.length).toBe(2);
    expect(pool.size).toBe(0);
  });

  it("initialSize fills pool on construction", () => {
    const pool = new ObjectPool(() => ({ id: 1 }), { initialSize: 3 });
    expect(pool.size).toBe(3);
  });

  it("type safety: pool enforces T type", () => {
    const pool = new ObjectPool<{ id: number }>(() => ({ id: 42 }));
    const obj: { id: number } = pool.acquire();
    expect(obj.id).toBe(42);
  });
});
```
