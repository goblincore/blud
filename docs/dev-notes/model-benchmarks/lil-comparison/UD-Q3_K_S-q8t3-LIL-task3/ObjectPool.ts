/**
 * A generic, zero-allocation ObjectPool for reusing expensive objects.
 *
 * Usage:
 *   const pool = new ObjectPool(() => new Sprite(), (s) => s.reset());
 *   const sprite = pool.acquire();
 *   pool.release(sprite);
 */
export class ObjectPool<T> {
  private pool: T[];
  private factory: () => T;
  private resetFn?: (obj: T) => void;

  constructor(
    factory: () => T,
    resetFn?: (obj: T) => void,
    initialSize = 0
  ) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.pool = [];
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /** Get an object from the pool, creating a new one if none available. */
  acquire(): T {
    if (this.pool.length === 0) {
      return this.factory();
    }
    return this.pool.pop()!;
  }

  /** Return an object to the pool, calling reset if configured. */
  release(obj: T): void {
    if (this.resetFn) {
      this.resetFn(obj);
    }
    this.pool.push(obj);
  }

  /** Remove and return all pooled objects (pool becomes empty). */
  drain(): T[] {
    const drained = this.pool;
    this.pool = [];
    return drained;
  }

  /** Number of objects currently available in the pool. */
  get size(): number {
    return this.pool.length;
  }
}
