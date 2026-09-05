```typescript
class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.map = new Map();
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
      // Evict LRU (first item in Map)
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
    // Map iterator yields in insertion order, which is MRU order (most recent last)
    // The question asks for MRU order. In a typical LRU cache, the "most recent" is the last accessed.
    // If we want to return entries in MRU order (most recent first), we need to reverse.
    // However, "entries(): IterableIterator<[K,V]> in MRU order" is ambiguous.
    // Usually, iteration order is either LRU->MRU or MRU->LRU.
    // Let's assume MRU order means most recently used comes first in the iteration.
    const entriesArray = Array.from(this.map.entries());
    // Reverse to get MRU first (since Map stores in insertion/access order, last is MRU)
    entriesArray.reverse();
    return entriesArray[Symbol.iterator]();
  }
}

export { LRUCache };
```

```typescript
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('should initialize with correct capacity and size 0', () => {
    const cache = new LRUCache<number, string>(3);
    expect(cache.size).toBe(0);
  });

  it('should set and get values', () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, 'one');
    expect(cache.get(1)).toBe('one');
  });

  it('should return undefined for non-existent keys', () => {
    const cache = new LRUCache<number, string>(3);
    expect(cache.get(1)).toBeUndefined();
  });

  it('should evict LRU item when capacity is exceeded', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'one');
    cache.set(2, 'two');
    cache.set(3, 'three'); // Evicts key 1 (LRU)
    
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe('two');
    expect(cache.get(3)).toBe('three');
  });

  it('should update existing key and move to most recent', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'one');
    cache.set(2, 'two');
    cache.set(1, 'one-updated'); // Moves key 1 to MRU
    
    // Now LRU is key 2
    cache.set(3, 'three'); // Evicts key 2 (LRU)
    
    expect(cache.get(1)).toBe('one-updated');
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBe('three');
  });

  it('should delete keys', () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, 'one');
    cache.set(2, 'two');
    
    expect(cache.delete(1)).toBe(true);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.size).toBe(1);
    
    expect(cache.delete(99)).toBe(false);
  });

  it('should enforce capacity', () => {
    const cache = new LRUCache<number, string>(1);
    cache.set(1, 'one');
    cache.set(2, 'two');
    
    expect(cache.size).toBe(1);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe('two');
  });

  it('should iterate entries in MRU order', () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, 'one');
    cache.set(2, 'two');
    cache.set(3, 'three');
    
    const entries = Array.from(cache.entries());
    // Most recent is 3, then 2, then 1
    expect(entries).toEqual([[3, 'three'], [2, 'two'], [1, 'one']]);
  });

  it('should iterate entries in MRU order after updates', () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, 'one');
    cache.set(2, 'two');
    cache.set(3, 'three');
    cache.set(1, 'one-updated'); // 1 is now MRU
    
    const entries = Array.from(cache.entries());
    // MRU order: 1, 3, 2
    expect(entries).toEqual([[1, 'one-updated'], [3, 'three'], [2, 'two']]);
  });

  it('should handle has method', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'one');
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
  });

  it('should handle capacity 1', () => {
    const cache = new LRUCache<number, string>(1);
    cache.set(1, 'one');
    cache.set(2, 'two');
    expect(cache.size).toBe(1);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe('two');
    cache.set(1, 'one');
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe('one');
  });
});
```
