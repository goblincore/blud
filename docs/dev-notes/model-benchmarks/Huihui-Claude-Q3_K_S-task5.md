```typescript
class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map: Map<K, V>;
  private readonly insertionOrder: K[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.insertionOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recent)
      this.insertionOrder.splice(this.insertionOrder.indexOf(key), 1);
      this.insertionOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.set(key, value);
      this.insertionOrder.splice(this.insertionOrder.indexOf(key), 1);
      this.insertionOrder.push(key);
    } else {
      if (this.map.size >= this.capacity) {
        const lru = this.insertionOrder.shift()!;
        this.map.delete(lru);
      }
      this.map.set(key, value);
      this.insertionOrder.push(key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const existed = this.map.delete(key);
    if (existed) {
      this.insertionOrder.splice(this.insertionOrder.indexOf(key), 1);
    }
    return existed;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.insertionOrder.map(key => [key, this.map.get(key)!] as [K, V])[Symbol.iterator]();
  }
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru';

describe('LRUCache', () => {
  it('basic get/set', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('eviction order - least recent first', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('update moves to most recent', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('a', 10); // 'a' moves to end
    cache.set('d', 4);   // evicts 'b', not 'a'
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('delete removes item', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('missing')).toBe(false);
  });

  it('capacity enforcement', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    cache.set('d', 4);
    expect(cache.size).toBe(2);
  });

  it('entries iteration order', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('a', 10); // moves 'a' to end
    const entries = [...cache.entries()];
    expect(entries).toEqual([['b', 2], ['c', 3], ['a', 10]]);
  });
});
```
