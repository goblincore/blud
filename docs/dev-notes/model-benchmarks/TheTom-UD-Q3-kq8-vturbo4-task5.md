```typescript
// lru-cache.ts

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    // Move to end (most recent) by deleting and re-adding
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Update existing key and move to end
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict LRU (first item in Map insertion order)
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    // Map iteration is in insertion order.
    // Since we delete and re-add on get/set, the order is LRU -> MRU.
    // MRU order means MRU first, so we need to reverse or iterate backwards.
    // But IterableIterator expects forward iteration.
    // We can create an array and reverse it, or use a custom iterator.
    // For simplicity and correctness, let's return an iterator over reversed entries.
    const entriesArray = Array.from(this.map.entries()).reverse();
    return entriesArray[Symbol.iterator]();
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('should set and get values', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('should return undefined for non-existent keys', () => {
    const cache = new LRUCache(2);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should evict least recently used item when capacity is exceeded', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // Should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('should update existing key and move it to most recent', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // Update 'a', move to MRU
    expect(cache.get('a')).toBe(10);
    cache.set('c', 3); // Should evict 'b' (LRU), not 'a'
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(10);
    expect(cache.get('c')).toBe(3);
  });

  it('should delete keys', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
  });

  it('should enforce capacity', () => {
    const cache = new LRUCache(1);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('should return entries in MRU order', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Order: a (LRU), b, c (MRU)
    const entries = Array.from(cache.entries());
    expect(entries).toEqual([
      ['c', 3],
      ['b', 2],
      ['a', 1],
    ]);
  });

  it('should update entries order on get', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // Move 'a' to MRU
    const entries = Array.from(cache.entries());
    // Order: b (LRU), c, a (MRU)
    expect(entries).toEqual([
      ['a', 1],
      ['c', 3],
      ['b', 2],
    ]);
  });

  it('should return correct size', () => {
    const cache = new LRUCache(2);
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
  });

  it('should handle has method correctly', () => {
    const cache = new LRUCache(2);
    expect(cache.has('a')).toBe(false);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
  });
});
```
