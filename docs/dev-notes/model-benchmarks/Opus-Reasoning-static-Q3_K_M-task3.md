```typescript
import { ObjectPool } from './objectPool';

describe('ObjectPool', () => {
  it('creates new objects when pool is empty', () => {
    const pool = new ObjectPool<string>(() => 'new', undefined, 0);
    expect(pool.acquire()).toBe('new');
  });

  it('recycles released objects', () => {
    const pool = new ObjectPool<string>(() => 'new', undefined, 0);
    const obj = pool.acquire();
    pool.release(obj);
    expect(pool.acquire()).toBe(obj);
  });

  it('calls reset callback on release', () => {
    let resetCalled = false;
    const pool = new ObjectPool<string>(
      () => 'new',
      () => { resetCalled = true; },
      0
    );
    const obj = pool.acquire();
    pool.release(obj);
    expect(resetCalled).toBe(true);
  });

  it('drains all objects from pool', () => {
    const pool = new ObjectPool<string>(() => 'new', undefined, 2);
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    const drained = pool.drain();
    expect(drained).toEqual([obj1, obj2]);
  });

  it('initializes pool with given size', () => {
    const pool = new ObjectPool<string>(() => 'new', undefined, 2);
    expect(pool.size).toBe(2);
  });

  it('maintains type safety', () => {
    const pool = new ObjectPool<number>(() => 0, undefined, 0);
    const num: number = pool.acquire();
    pool.release(num);
  });
});
```
