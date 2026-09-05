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
    // Move to end (most recent) by deleting and re-adding
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
      // Evict LRU (first item in Map)
      const lruKey = this.map.keys().next().value;
      if (lruKey !== undefined) {
        this.map.delete(lruKey);
      }
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
    // Return entries in MRU order (most recent last)
    // Map iteration is insertion order, and we always move accessed items to end
    return this.map.entries();
  }
}

export default LRUCache;
```

```typescript
// lru-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import LRUCache from './lru-cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(3);
  });

  describe('basic get/set', () => {
    it('should set and get a value', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing key', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should return undefined after deleting', () => {
      cache.set('a', 1);
      cache.delete('a');
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('eviction order', () => {
    it('should evict LRU when capacity is exceeded', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Cache is now full: [a, b, c] (c is MRU)
      
      cache.set('d', 4); // Should evict 'a' (LRU)
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should evict correctly after multiple operations', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      cache.set('d', 4); // Evicts 'a'
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBeUndefined();
      
      cache.set('e', 5); // Evicts 'b' (LRU now)
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
      expect(cache.get('e')).toBe(5);
    });
  });

  describe('update moves to recent', () => {
    it('should move accessed key to most recent', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Access 'a' to make it most recent
      cache.get('a');
      
      // Now 'b' is LRU, not 'a'
      cache.set('d', 4); // Should evict 'b'
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should update value and move to recent', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Update 'a' and access it
      cache.set('a', 10);
      cache.get('a');
      
      // Now 'a' is MRU, 'b' is LRU
      cache.set('d', 4); // Should evict 'b'
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('delete', () => {
    it('should delete existing key', () => {
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should return false for non-existent key', () => {
      expect(cache.delete('missing')).toBe(false);
    });

    it('should allow new insertions after deletion', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      cache.delete('b');
      cache.set('d', 4); // Should not evict, since size < capacity
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('capacity enforcement', () => {
    it('should maintain capacity limit', () => {
      const cap = 2;
      const smallCache = new LRUCache<string, number>(cap);
      
      smallCache.set('a', 1);
      smallCache.set('b', 2);
      expect(smallCache.size).toBe(2);
      
      smallCache.set('c', 3);
      expect(smallCache.size).toBe(2);
      expect(smallCache.get('a')).toBeUndefined();
      expect(smallCache.get('b')).toBe(2);
      expect(smallCache.get('c')).toBe(3);
    });

    it('should throw error for invalid capacity', () => {
      expect(() => new LRUCache<string, number>(0)).toThrow();
      expect(() => new LRUCache<string, number>(-1)).toThrow();
    });
  });

  describe('entries iteration order', () => {
    it('should return entries in MRU order', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['a', 1],
        ['b', 2],
        ['c', 3]
      ]);
    });

    it('should reflect updates in iteration order', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Access 'a' to make it MRU
      cache.get('a');
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['b', 2],
        ['c', 3],
        ['a', 1]
      ]);
    });

    it('should return empty array when cache is empty', () => {
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([]);
    });

    it('should reflect evictions in iteration', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      cache.set('d', 4); // Evicts 'a'
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['b', 2],
        ['c', 3],
        ['d', 4]
      ]);
    });
  });
});
```
