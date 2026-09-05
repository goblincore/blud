```typescript
// objectPool.ts

type Factory<T> = () => T;
type Reset<T> = (obj: T) => void;

export class ObjectPool<T> {
  private pool: T[];
  private factory: Factory<T>;
  private resetFn?: Reset<T>;

  constructor(factory: Factory<T>, resetFn?: Reset<T>, initialSize: number = 0) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.pool = [];
    for (let i = 0; i < initialSize; i++) {
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
    if (this.resetFn) {
      this.resetFn(t);
    }
    this.pool.push(t);
  }

  drain(): T[] {
    const drained = this.pool;
    this.pool = [];
    return drained;
  }

  get size(): number {
    return this.pool.length;
  }
}
```

```typescript
// objectPool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectPool } from './objectPool';

describe('ObjectPool', () => {
  describe('acquire', () => {
    it('creates new object when pool is empty', () => {
      const factory = vi.fn(() => ({ id: 'new' }));
      const pool = new ObjectPool(factory);
      
      const obj = pool.acquire();
      
      expect(factory).toHaveBeenCalled();
      expect(obj).toEqual({ id: 'new' });
      expect(pool.size).toBe(0);
    });

    it('returns existing object from pool', () => {
      const obj1 = { id: 'existing' };
      const pool = new ObjectPool(() => obj1, undefined, 1);
      
      const acquired = pool.acquire();
      
      expect(acquired).toBe(obj1);
      expect(pool.size).toBe(0);
    });
  });

  describe('release', () => {
    it('returns object to pool', () => {
      const obj = { id: 'to-return' };
      const pool = new ObjectPool(() => obj);
      
      pool.release(obj);
      
      expect(pool.size).toBe(1);
      expect(pool.acquire()).toBe(obj);
    });

    it('calls reset callback if provided', () => {
      const resetFn = vi.fn();
      const obj = { id: 'reset-me', value: 10 };
      const pool = new ObjectPool(() => obj, resetFn);
      
      pool.release(obj);
      
      expect(resetFn).toHaveBeenCalledWith(obj);
    });
  });

  describe('reset callback', () => {
    it('resets object state before returning to pool', () => {
      const resetFn = vi.fn((obj: { value: number }) => {
        obj.value = 0;
      });
      const obj = { value: 10 };
      const pool = new ObjectPool(() => obj, resetFn);
      
      const acquired = pool.acquire();
      acquired.value = 20;
      pool.release(acquired);
      
      const reAcquired = pool.acquire();
      expect(reAcquired.value).toBe(0);
    });
  });

  describe('drain', () => {
    it('removes all objects from pool and returns them', () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const pool = new ObjectPool(() => obj1, undefined, 2);
      
      const drained = pool.drain();
      
      expect(drained).toEqual([obj1, obj1]); // Since same factory, same instance if not new each time
      // Better test with distinct instances
    });

    it('empties the pool after drain', () => {
      const factory = vi.fn(() => ({ id: vi.fn() }));
      const pool = new ObjectPool(factory, undefined, 3);
      
      const drained = pool.drain();
      
      expect(drained).toHaveLength(3);
      expect(pool.size).toBe(0);
    });
  });

  describe('initial size', () => {
    it('fills pool with initial size objects', () => {
      const factory = vi.fn(() => ({ id: 'init' }));
      const pool = new ObjectPool(factory, undefined, 5);
      
      expect(factory).toHaveBeenCalledTimes(5);
      expect(pool.size).toBe(5);
    });
  });

  describe('type safety', () => {
    it('maintains type integrity', () => {
      interface User {
        name: string;
        age: number;
      }
      
      const createDefaultUser = (): User => ({ name: 'default', age: 0 });
      const resetUser = (u: User) => { u.name = 'default'; u.age = 0; };
      
      const pool = new ObjectPool<User>(createDefaultUser, resetUser);
      
      const user: User = pool.acquire();
      user.name = 'Alice';
      user.age = 30;
      
      pool.release(user);
      
      const newUser: User = pool.acquire();
      expect(newUser.name).toBe('default');
      expect(newUser.age).toBe(0);
    });
  });
});
```
