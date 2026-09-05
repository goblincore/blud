<!-- thinking (0 chars) -->


<!-- answer (3222 chars) -->
```typescript
// lru-cache.ts
export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;
  private order: K[];

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.map = new Map();
    this.order = [];
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    this.moveToRecent(key);
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    const isNew = !this.map.has(key);
    if (isNew && this.map.size >= this.capacity) {
      this.evictLRU();
    }
    this.map.set(key, value);
    this.moveToRecent(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    if (!this.map.has(key)) return false;
    this.map.delete(key);
    this.order = this.order.filter(k => k !== key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    const entries: [K, V][] = this.order
      .map(key => [key, this.map.get(key)!])
      .filter(([, v]) => v !== undefined);
    return entries[Symbol.iterator]();
  }

  private moveToRecent(key: K): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) {
      this.order.splice(idx, 1);
    }
    this.order.push(key);
  }

  private evictLRU(): void {
    if (this.order.length === 0) return;
    const lruKey = this.order[0];
    this.order.shift();
    this.map.delete(lruKey);
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('basic get/set', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('eviction order', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.get('b')).toBe(2);
  });

  it('update moves to recent', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(10);
  });

  it('delete', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('a')).toBe(false);
  });

  it('capacity enforcement', () => {
    const cache = new LRUCache(1);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('entries iteration order (MRU first)', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');
    const entries = Array.from(cache.entries());
    expect(entries).toEqual([
      ['a', 1],
      ['c', 3],
      ['b', 2],
    ]);
  });
});
```