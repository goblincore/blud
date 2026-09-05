```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private _available: T[] = [];
  private _factory: () => T;
  private _reset?: (t: T) => void;

  constructor(factory: () => T, options?: { reset?: (t: T) => void; initialSize?: number }) {
    this._factory = factory;
    this._reset = options?.reset;
    const initialSize = options?.initialSize ?? 0;
    for (let i = 0; i < initialSize; i++) {
      this._available.push(this._factory());
    }
  }

  acquire(): T {
    if (this._available.length > 0) {
      return this._available.pop()!;
    }
    return this._factory();
  }

  release(t: T): void {
    this._available.push(t);
    this._reset?.(t);
  }

  drain(): T[] {
    const result = [...this._available];
    this._available = [];
    return result;
  }

  get size(): number {
    return this._available.length;
  }
}
```

```typescript
// ObjectPool.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { ObjectPool } from "./ObjectPool";

describe("ObjectPool", () => {
  let pool: ObjectPool<string>;
  let created: string[];
  let resetCalled: string[];

  beforeEach(() => {
    created = [];
    resetCalled = [];
  });

  it("creates new objects when pool is empty", () => {
    pool = new ObjectPool(() => {
      const value = `item-${created.length}`;
      created.push(value);
      return value;
    });

    const a = pool.acquire();
    const b = pool.acquire();

    expect(a).toBe("item-0");
    expect(b).toBe("item-1");
    expect(a).not.toBe(b);
  });

  it("reuses released objects", () => {
    pool = new ObjectPool(() => `item-${created.length}`);

    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();

    expect(b).toBe(a);
  });

  it("calls reset callback on release", () => {
    pool = new ObjectPool(
      () => ({ id: created.length++ }),
      {
        reset: (t) => {
          t.id = -1;
          resetCalled.push(String(t.id));
        },
      }
    );

    const obj = pool.acquire();
    pool.release(obj);

    expect(obj.id).toBe(-1);
    expect(resetCalled).toContain("-1");
  });

  it("drain returns all available objects and empties pool", () => {
    pool = new ObjectPool(() => `item-${created.length++}`);

    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);

    const drained = pool.drain();

    expect(drained).toHaveLength(2);
    expect(pool.size).toBe(0);
  });

  it("initialSize pre-fills the pool", () => {
    pool = new ObjectPool(
      () => `item-${created.length++}`,
      { initialSize: 3 }
    );

    expect(pool.size).toBe(3);

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    expect(pool.size).toBe(0);
  });

  it("maintains type safety", () => {
    pool = new ObjectPool(() => ({ id: created.length++, name: "test" }));

    const obj = pool.acquire();
    const id: number = obj.id;
    const name: string = obj.name;

    expect(id).toBe(0);
    expect(name).toBe("test");
  });
});
```
