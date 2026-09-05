```typescript
import { ObjectPool } from './ObjectPool';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ObjectPool', () => {
  let pool: ObjectPool<{ id: number }>;
  let acquireLog: number[];
  let releaseLog: number[];

  beforeEach(() => {
    acquireLog = [];
    releaseLog = [];

    pool = new ObjectPool(
      () => {
        const id = acquireLog.length;
        acquireLog.push(id);
        return { id };
      },
      (obj) => {
        releaseLog.push(obj.id);
        obj.id = -1; // simulate reset
      },
      3
    );
  });

  it('should create new objects when the pool is empty', () => {
    const pool2 = new ObjectPool(
      () => {
        const id = acquireLog.length;
        acquireLog.push(id);
        return { id };
      }
    );

    const obj = pool2.acquire();
    expect(obj).toBeDefined();
    expect(acquireLog).toContain(0);
  });

  it('should recycle objects via release and return the same instance', () => {
    const obj1 = pool.acquire();
    const id1 = obj1.id;

    pool.release(obj1);

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1);
    expect(releaseLog).toContain(id1);
    expect(obj2.id).toBe(-1); // reset callback was called
  });

  it('should call reset callback when releasing', () => {
    let resetCalled = false;
    const poolWithReset = new ObjectPool(
      () => ({ id: 1 }),
      () => { resetCalled = true; }
    );

    const obj = poolWithReset.acquire();
    poolWithReset.release(obj);

    expect(resetCalled).toBe(true);
  });

  it('drain should return all available objects and clear the pool', () => {
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    pool.release(obj1);
    pool.release(obj2);

    const drained = pool.drain();
    expect(drained).toHaveLength(2);
    expect(drained).toContain(obj1);
    expect(drained).toContain(obj2);

    const afterDrain = pool.acquire();
    expect(afterDrain).toBeDefined();
    expect(afterDrain).not.toBe(obj1);
  });

  it('should pre-fill pool with initialSize objects', () => {
    const initialPool = new ObjectPool(
      () => {
        const id = acquireLog.length;
        acquireLog.push(id);
        return { id };
      },
      undefined,
      3
    );

    const obj1 = initialPool.acquire();
    const obj2 = initialPool.acquire();
    const obj3 = initialPool.acquire();

    expect(acquireLog).toHaveLength(3);
    expect(obj1).toBeDefined();
    expect(obj2).toBeDefined();
    expect(obj3).toBeDefined();
  });

  it('should be type-safe', () => {
    const typedPool = new ObjectPool<{ value: string }>(() => ({ value: 'test' }));
    const obj = typedPool.acquire();
    // @ts-expect-error - should not accept wrong type
    typedPool.release({ wrong: true });
  });
});
```
