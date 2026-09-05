```typescript
// lru-cache.ts

class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    // Move to end (most recent)
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Update existing key, move to end
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict LRU (first item in map)
      const lruKey = this.map.keys().next().value;
      this.map.delete(lruKey);
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
    // Return entries in MRU order (most recent first)
    // Map iteration order is insertion order (LRU to MRU)
    // We need MRU to LRU, so reverse
    const entriesArray = Array.from(this.map.entries());
    let index = entriesArray.length - 1;
    const self = this;

    return {
      next(): IteratorResult<[K, V]> {
        if (index < 0) {
          return { done: true, value: undefined as any };
        }
        const entry = entriesArray[index];
        index--;
        return { done: false, value: entry };
      },
      [Symbol.iterator]() {
        return this;
      }
    };
  }
}

export default LRUCache;
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import LRUCache from './lru-cache';

describe('LRUCache', () => {
  describe('basic get/set', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('eviction order', () => {
    it('should evict LRU item when capacity exceeded', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Evicts 'a'
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('should evict based on access order', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // 'a' becomes most recent
      cache.set('c', 3); // Evicts 'b' (LRU)
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('update moves to recent', () => {
    it('should update value and move to most recent', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10); // Update 'a', move to MRU
      cache.set('c', 3); // Evicts 'b'
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete existing key and return true', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should return false for non-existing key', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete('a')).toBe(false);
    });
  });

  describe('capacity enforcement', () => {
    it('should maintain size within capacity', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size).toBe(2);
    });

    it('should handle capacity of 1', () => {
      const cache = new LRUCache<string, number>(1);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(1);
      expect(cache.get('a')).toBeUndefined();
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
      expect(entries).toEqual([['c', 3], ['b', 2], ['a', 1]]);
    });

    it('should reflect updates in iteration order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // 'a' becomes MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([['a', 1], ['c', 3], ['b', 2]]);
    });

    it('should return empty array for empty cache', () => {
      const cache = new LRUCache<string, number>(2);
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([]);
    });
  });

  describe('has method', () => {
    it('should return true for existing key', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
    });

    it('should return false for non-existing key', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.has('a')).toBe(false);
    });
  });
});
```
