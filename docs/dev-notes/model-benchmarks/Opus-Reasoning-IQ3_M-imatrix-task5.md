<antThinking>
Let me analyze this request:

1. **Topic**: TypeScript generic LRUCache class with vitest tests
2. **Requirements**:
   - Generic class LRUCache<K, V>
   - Constructor takes capacity number
   - Methods: get, set, has, delete, size getter, entries iterator
   - Evict LRU when capacity exceeded
   - vitest tests for all functionality

3. **Approach**: Use a doubly linked list + Map for O(1) operations. The Map maintains insertion/access order, and the doubly linked list tracks LRU/MRU for efficient eviction.

4. **Implementation details**:
   - Use Map to maintain access order (newest at end)
   - Use doubly linked list for O(1) removal/insertion
   - Or simpler: use Map and move keys to end on access

5. **Testing approach**:
   - Test basic get/set
   - Test eviction order (oldest evicted first)
   - Test update moves to recent
   - Test delete
   - Test capacity enforcement
   - Test entries iteration order
</antThinking>

Here's the implementation:

```typescript
// lru-cache.ts
export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be a positive number");
    }
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key);
    // Move to most recent by deleting and re-inserting
    this.map.delete(key);
    this.map.set(key, value!);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict LRU (first entry in Map)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
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
    return this.map.entries();
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('should store and retrieve values', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('should return undefined for missing keys', () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.get('nonexistent')).toBe(undefined);
  });

  it('should evict LRU item when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // Should evict 'a'
    
    expect(cache.get('a')).toBe(undefined);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('should move accessed item to most recent', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // Access 'a' to make it most recent
    
    cache.set('c', 3); // Should evict 'b', not 'a'
    
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(undefined);
    expect(cache.get('c')).toBe(3);
  });

  it('should update existing key without evicting', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // Update 'a', should not evict 'b'
    
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBe(2);
  });

  it('should delete keys', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBe(undefined);
    expect(cache.get('b')).toBe(2);
  });

  it('should return false for deleting non-existent keys', () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('should enforce capacity limit', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    expect(cache.size).toBe(2);
  });

  it('should iterate entries in MRU order', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // Make 'a' most recent
    
    const entries = Array.from(cache.entries());
    expect(entries).toEqual([['a', 1], ['c', 3], ['b', 2]]);
  });

  it('should handle capacity of 1', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('a', 1);
    cache.set('b', 2);
    
    expect(cache.get('a')).toBe(undefined);
    expect(cache.get('b')).toBe(2);
  });

  it('should return has() correctly', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('should throw error for invalid capacity', () => {
    expect(() => new LRUCache<string, number>(0)).toThrow();
    expect(() => new LRUCache<string, number>(-1)).toThrow();
  });
});
```

This implementation uses JavaScript's Map which maintains insertion order, making it ideal for LRU caching:
- `get()` moves items to the end (most recent) by deleting and re-inserting
- `set()` evicts the first item (least recent) when capacity is exceeded
- All operations are O(1) amortized
- The `entries()` iterator returns items in MRU (Most Recently Used) order
