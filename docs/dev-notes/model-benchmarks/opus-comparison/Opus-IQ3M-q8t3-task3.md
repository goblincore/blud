<!-- thinking (189 chars) -->

Let me think through this carefully.

I need to analyze the problem: coding assistant. Be concise, produce clean working TypeScript. No explanations unless asked.

And generate a solution.

<!-- answer (3065 chars) -->
```typescript
// ObjectPool.ts
export class ObjectPool<T> {
  private pool: T[];
  private readonly factory: () => T;
  private readonly resetFn?: (t: T) => void;

  constructor(factory: () => T, resetFn?: (t: T) => void, initialSize: number = 0) {
    this.factory = factory;
    this.resetFn = resetFn;
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
    if (this.resetFn) {
      this.resetFn(t);
    }
    this.pool.push(t);
  }

  drain(): T[] {
    const drained = [...this.pool];
    this.pool = [];
    return drained;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// ObjectPool.test.ts
import { describe, it, expect } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  it('should create new objects when pool is empty', () => {
    let createCount = 0;
    const pool = new ObjectPool(() => {
      createCount++;
      return { id: createCount };
    });

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();

    expect(obj1).toEqual({ id: 1 });
    expect(obj2).toEqual({ id: 2 });
    expect(pool.size).toBe(0);
  });

  it('should reuse objects via release and acquire', () => {
    const pool = new ObjectPool(() => ({ id: Math.random() }));

    const obj1 = pool.acquire();
    pool.release(obj1);

    const obj2 = pool.acquire();
    expect(obj1).toBe(obj2);
  });

  it('should call reset callback when releasing', () => {
    let resetCalled = false;
    const pool = new ObjectPool(
      () => ({ id: 0, reset: false }),
      (obj) => {
        resetCalled = true;
        obj.reset = true;
      }
    );

    const obj = pool.acquire();
    expect(obj.reset).toBe(false);

    pool.release(obj);
    expect(resetCalled).toBe(true);
    expect(obj.reset).toBe(true);
  });

  it('should drain all objects from pool', () => {
    const pool = new ObjectPool(() => ({ id: 0 }));
    pool.acquire();
    pool.acquire();
    pool.acquire();

    const drained = pool.drain();
    expect(drained.length).toBe(3);
    expect(pool.size).toBe(0);
  });

  it('should fill pool with initial size', () => {
    let created = 0;
    const pool = new ObjectPool(() => {
      created++;
      return { id: created };
    }, undefined, 5);

    expect(created).toBe(5);
    expect(pool.size).toBe(5);

    const obj = pool.acquire();
    expect(pool.size).toBe(4);
    expect(obj.id).toBeLessThanOrEqual(5);
  });

  it('should maintain type safety', () => {
    interface Person {
      name: string;
      age: number;
    }

    const pool = new ObjectPool<Person>(() => ({
      name: 'test',
      age: 0,
    }));

    const person = pool.acquire();
    person.name = 'Alice';
    person.age = 30;

    pool.release(person);

    const retrieved = pool.acquire();
    expect(retrieved.name).toBe('Alice');
    expect(retrieved.age).toBe(30);
  });
});
```
