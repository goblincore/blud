```typescript
// lru-cache.ts

type Node<K, V> = {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
};

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V>; // Most recently used
  private tail: Node<K, V>; // Least recently used

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map<K, Node<K, V>>();

    // Dummy head and tail for easier double-linked list operations
    this.head = { key: null as any, value: null as any, prev: null, next: null };
    this.tail = { key: null as any, value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // Move node to head (most recent)
  private moveToHead(node: Node<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  // Remove a node from the doubly linked list
  private removeNode(node: Node<K, V>): void {
    const prev = node.prev;
    const next = node.next;

    if (prev) prev.next = next;
    if (next) next.prev = prev;
  }

  // Add a node right after head
  private addToHead(node: Node<K, V>): void {
    node.next = this.head.next;
    node.prev = this.head;
    if (this.head.next) {
      this.head.next.prev = node;
    }
    this.head.next = node;
  }

  // Remove the node before tail (least recently used)
  private removeTail(): Node<K, V> | null {
    const lru = this.tail.prev;
    if (lru && lru !== this.head) {
      this.removeNode(lru);
      return lru;
    }
    return null;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      return undefined;
    }
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existingNode = this.map.get(key);
    if (existingNode) {
      existingNode.value = value;
      this.moveToHead(existingNode);
      return;
    }

    const newNode: Node<K, V> = {
      key,
      value,
      prev: null,
      next: null,
    };

    this.map.set(key, newNode);
    this.addToHead(newNode);

    if (this.map.size > this.capacity) {
      const lruNode = this.removeTail();
      if (lruNode) {
        this.map.delete(lruNode.key);
      }
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  // Returns an iterator over [key, value] pairs in MRU order (most recent first)
  entries(): IterableIterator<[K, V]> {
    const result: [K, V][] = [];
    let current = this.head.next;
    while (current && current !== this.tail) {
      result.push([current.key, current.value]);
      current = current.next;
    }
    return result[Symbol.iterator]();
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  let cache: LRUCache<number, string>;

  beforeEach(() => {
    cache = new LRUCache(3);
  });

  describe('basic get/set', () => {
    it('should set and get a value', () => {
      cache.set(1, 'a');
      expect(cache.get(1)).toBe('a');
    });

    it('should return undefined for non-existent key', () => {
      expect(cache.get(1)).toBeUndefined();
    });
  });

  describe('eviction order', () => {
    it('should evict the least recently used item when capacity is exceeded', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');
      // Cache: [1, 2, 3] (MRU <- 3 <- 2 <- 1 -> LRU)
      // Actually, order of insertion: 1 (LRU), 2, 3 (MRU)

      cache.set(4, 'd'); // Should evict 1 (LRU)
      expect(cache.has(1)).toBe(false);
      expect(cache.get(2)).toBe('b');
      expect(cache.get(3)).toBe('c');
      expect(cache.get(4)).toBe('d');
    });

    it('should evict correct item after accessing some keys', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      // Access key 1, making it MRU
      cache.get(1);
      // Order: 2 (LRU), 3, 1 (MRU)

      cache.set(4, 'd'); // Should evict 2 (LRU)
      expect(cache.has(2)).toBe(false);
      expect(cache.get(1)).toBe('a');
      expect(cache.get(3)).toBe('c');
      expect(cache.get(4)).toBe('d');
    });
  });

  describe('update moves to recent', () => {
    it('should move updated key to most recent position', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      // Update key 1
      cache.set(1, 'a-updated');
      // Order: 2 (LRU), 3, 1 (MRU)

      cache.set(4, 'd'); // Should evict 2 (LRU)
      expect(cache.has(2)).toBe(false);
      expect(cache.get(1)).toBe('a-updated');
      expect(cache.get(3)).toBe('c');
      expect(cache.get(4)).toBe('d');
    });

    it('should update value without changing order if accessed', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      cache.get(1); // Move 1 to MRU
      // Order: 2 (LRU), 3, 1 (MRU)

      cache.set(1, 'a-new'); // Update 1, already MRU
      // Order remains: 2 (LRU), 3, 1 (MRU)

      cache.set(4, 'd'); // Evict 2
      expect(cache.has(2)).toBe(false);
      expect(cache.get(1)).toBe('a-new');
    });
  });

  describe('delete', () => {
    it('should delete an existing key', () => {
      cache.set(1, 'a');
      expect(cache.delete(1)).toBe(true);
      expect(cache.has(1)).toBe(false);
      expect(cache.get(1)).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      expect(cache.delete(1)).toBe(false);
    });

    it('should delete correctly affecting eviction order', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      cache.delete(2);
      // Cache has 1, 3. 3 is MRU, 1 is LRU.

      cache.set(4, 'd'); // Should evict 1 (LRU)
      expect(cache.has(1)).toBe(false);
      expect(cache.get(3)).toBe('c');
      expect(cache.get(4)).toBe('d');
    });
  });

  describe('capacity enforcement', () => {
    it('should maintain correct size after evictions', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');
      expect(cache.size).toBe(3);

      cache.set(4, 'd');
      expect(cache.size).toBe(3);
      expect(cache.has(1)).toBe(false);
    });

    it('should handle capacity of 1', () => {
      const smallCache = new LRUCache(1);
      smallCache.set(1, 'a');
      expect(smallCache.get(1)).toBe('a');

      smallCache.set(2, 'b');
      expect(smallCache.get(1)).toBeUndefined();
      expect(smallCache.get(2)).toBe('b');
    });
  });

  describe('entries iteration order', () => {
    it('should return entries in MRU order', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        [3, 'c'],
        [2, 'b'],
        [1, 'a'],
      ]);
    });

    it('should reflect updates in order', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      cache.get(1); // Move 1 to MRU

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        [1, 'a'],
        [3, 'c'],
        [2, 'b'],
      ]);
    });

    it('should return empty array when cache is empty', () => {
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([]);
    });

    it('should reflect deletions in order', () => {
      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c');

      cache.delete(2);

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        [3, 'c'],
        [1, 'a'],
      ]);
    });
  });
});
```
