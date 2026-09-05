import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool';

describe('ObjectPool', () => {
  // -- helpers ----------------------------------------------------------

  function makeCounterPool() {
    let i = 0;
    return new ObjectPool(() => ++i, (n) => {
      // no-op reset for primitive
    });
  }

  // -- acquire ----------------------------------------------------------

  it('creates a new object when the pool is empty', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const a = pool.acquire();
    const b = pool.acquire();
    // two distinct objects (no pre-warm)
    expect(a).not.toBe(b);
  });

  it('returns pooled objects on subsequent acquires', () => {
    const pool = new ObjectPool(() => ({}), (o: any) => {
      o.r = true;
    });
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a); // same reference returned
  });

  it('pops from the end (LIFO)', () => {
    const pool = new ObjectPool(() => ({}));
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    pool.release(a);
    pool.release(b);
    pool.release(c);

    const firstReturned = pool.acquire();
    expect(firstReturned).toBe(c); // most recently released first
  });

  // -- release / recycle ------------------------------------------------

  it('returns an object to the pool via release', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const obj = pool.acquire();
    expect(pool.size).toBe(0);
    pool.release(obj);
    expect(pool.size).toBe(1);
  });

  it('calls the reset callback on release', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ v: 42 }), reset);
    const obj = pool.acquire();
    obj.v = 99;
    pool.release(obj);
    expect(reset).toHaveBeenCalledWith(obj);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('skips reset when no resetFn is provided', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const obj = pool.acquire();
    pool.release(obj); // should not throw
    expect(pool.size).toBe(1);
  });

  // -- drain ------------------------------------------------------------

  it('drain returns all pooled objects and empties the pool', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);

    const drained = pool.drain();
    expect(drained).toEqual([a, b]);
    expect(pool.size).toBe(0);
  });

  it('drain on an empty pool returns empty array', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const drained = pool.drain();
    expect(drained).toEqual([]);
    expect(pool.size).toBe(0);
  });

  it('drained objects are independent of the pool', () => {
    const pool = new ObjectPool(() => ({ v: 0 }));
    const obj = pool.acquire();
    pool.release(obj);

    const [drained] = pool.drain();
    expect(drained).toBe(obj);

    // releasing again should not cause duplicates
    pool.release(obj);
    expect(pool.size).toBe(1);
  });

  // -- initial size (pre-warm) -----------------------------------------

  it('pre-warms the pool to initialSize', () => {
    const pool = new ObjectPool(() => ({}), undefined, 5);
    expect(pool.size).toBe(5);
  });

  it('can acquire from the pre-warmed pool', () => {
    const pool = new ObjectPool(() => ({}), undefined, 3);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.size).toBe(1);
    expect(a).not.toBe(b);
    // still one left
    const c = pool.acquire();
    expect(pool.size).toBe(0);
  });

  it('acquire creates new objects when pre-warmed pool is exhausted', () => {
    const factory = vi.fn(() => ({}));
    const pool = new ObjectPool(factory, undefined, 2);

    expect(factory).toHaveBeenCalledTimes(2); // pre-warm

    pool.acquire();
    pool.acquire();
    expect(factory).toHaveBeenCalledTimes(2); // pool empty

    pool.acquire(); // should create a new one
    expect(factory).toHaveBeenCalledTimes(3);
  });

  // -- size getter ------------------------------------------------------

  it('size reflects available count after acquire/release', () => {
    const pool = new ObjectPool(() => ({}));
    expect(pool.size).toBe(0);

    pool.acquire();
    expect(pool.size).toBe(0);

    pool.release(pool.acquire());
    expect(pool.size).toBe(1);
  });

  // -- type safety ------------------------------------------------------

  it('preserves type safety for custom class', () => {
    class Sprite {
      x = 0;
      y = 0;
      reset() {
        this.x = 0;
        this.y = 0;
      }
    }

    const pool = new ObjectPool(() => new Sprite(), (s) => s.reset());

    const sprite = pool.acquire();
    sprite.x = 10;
    sprite.y = 20;

    // Type system knows sprite is Sprite
    const resetCall = vi.spyOn(sprite, 'reset');
    pool.release(sprite);

    // reset was called, properties cleared
    expect(sprite.x).toBe(0);
    expect(sprite.y).toBe(0);
    expect(resetCall).toHaveBeenCalled();
  });

  it('type safety with readonly fields', () => {
    type Entity = readonly { id: number; label: string };
    const pool = new ObjectPool(() => ({ id: 0, label: '' }));

    const e: Entity = pool.acquire();
    // Type system enforces shape
    expect(e.id).toBe(0);
    expect(e.label).toBe('');
    pool.release(e);
    expect(pool.size).toBe(1);
  });
});
