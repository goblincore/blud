```typescript
class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error('Capacity must be at least 1');
    }
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    // Move to most recently used
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict LRU (first entry in Map iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[K, V]> {
    // Return in MRU order (most recent first)
    // Map iteration is LRU -> MRU, so we reverse it
    const entries = Array.from(this.cache.entries());
    entries.reverse();
    return entries[Symbol.iterator]();
  }
}

export { LRUCache };
```

```typescript
import { describe, it, expect } from 'vitest';
import { LRUCache } from './LRUCache';

describe('LRUCache', () => {
  describe('basic get/set', () => {
    it('should set and get a value', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get('a')).toBe(undefined);
    });
  });

  describe('eviction order', () => {
    it('should evict the least recently used item when capacity is exceeded', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('should evict based on access order, not insertion order', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // 'a' becomes most recent, 'b' becomes LRU
      cache.set('c', 3); // evicts 'b'
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(undefined);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('update moves to recent', () => {
    it('should update value and move key to most recently used', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10); // 'a' is updated, becomes MRU
      cache.set('c', 3); // evicts 'b' (LRU)
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBe(undefined);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete a key and return true', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBe(undefined);
    });

    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete('a')).toBe(false);
    });

    it('should free up space for new inserts', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.delete('a');
      cache.set('c', 3); // should not evict 'b'
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('capacity enforcement', () => {
    it('should maintain capacity limit', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size).toBe(3);
      cache.set('d', 4); // evicts 'a'
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe(undefined);
    });

    it('should work with capacity of 1', () => {
      const cache = new LRUCache<string, number>(1);
      cache.set('a', 1);
      cache.set('b', 2); // evicts 'a'
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(2);
    });
  });

  describe('entries iteration order', () => {
    it('should return entries in MRU order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('should reflect updates in order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // 'a' becomes MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('should reflect deletions', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.delete('b');
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['c', 3],
        ['a', 1],
      ]);
    });
  });
});
```
