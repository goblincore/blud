<|think|>
Let me implement a TypeScript LRU Cache class with all the required functionality.

Key design decisions:
1. Use a doubly-linked list with a Map for O(1) operations
2. Map to track nodes for O(1) lookup
3. Doubly-linked list maintains access order (MRU at head, LRU at tail)
4. When accessing a node, move it to the head
5. When evicting, remove the tail node

Implementation plan:
- Create Node class for the doubly-linked list
- Use a Map to store key-to-node mappings
- Track head and tail pointers
- Implement all required methods

Let me write the implementation and tests.
<|/think|>

```typescript
// lru-cache.ts

class Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V> | null = null;
  private tail: Node<K, V> | null = null;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than 0");
    }
    this.capacity = capacity;
    this.map = new Map<K, Node<K, V>>();
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
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    const newNode = new Node(key, value);
    this.map.set(key, newNode);
    this.addToHead(newNode);

    if (this.map.size > this.capacity) {
      this.evictLRU();
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

  entries(): IterableIterator<[K, V]> {
    const result: [K, V][] = [];
    let current = this.head;
    while (current) {
      result.push([current.key, current.value]);
      current = current.next;
    }
    return result[Symbol.iterator]();
  }

  private addToHead(node: Node<K, V>): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: Node<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: Node<K, V>): void {
    if (this.head === node) return;

    this.removeNode(node);
    this.addToHead(node);
  }
}
```

```typescript
// lru-cache.test.ts

import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("should set and get values", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
    });

    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("missing")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("should evict least recently used item", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      // Access "a" to make it most recent
      cache.get("a");

      // "b" should be evicted (least recently used)
      cache.set("c", 3);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });

    it("should evict the correct LRU when cache is full", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // "b" is LRU (accessed before "c")
      cache.set("d", 4);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to recent", () => {
    it("should move updated key to most recent", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update "a" - this moves "a" to most recent position
      cache.set("a", 10);

      // Now "b" is LRU, not "a"
      cache.set("d", 4);

      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("delete", () => {
    it("should delete a key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.has("a")).toBe(false);
    });

    it("should return false for missing key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete("missing")).toBe(false);
    });

    it("should trigger eviction after delete", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      cache.delete("a");
      cache.set("c", 3);

      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("a")).toBeUndefined();
    });
  });

  describe("capacity enforcement", () => {
    it("should maintain capacity limit", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.size).toBe(2);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    it("should throw for invalid capacity", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow(
        "Capacity must be greater than 0"
      );
      expect(() => new LRUCache<string, number>(-1)).toThrow(
        "Capacity must be greater than 0"
      );
    });
  });

  describe("entries iteration order", () => {
    it("should return entries in MRU order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // "a" is LRU, "c" is MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("should reflect updates in iteration", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update "a" to move it to MRU
      cache.set("a", 10);

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["a", 10],
        ["c", 3],
        ["b", 2],
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle single capacity", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
    });

    it("should handle repeated sets on same key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("a", 2);

      expect(cache.get("a")).toBe(2);
      expect(cache.size).toBe(1);
    });
  });
});
```

**Implementation Notes:**

- **Doubly-linked list** maintains access order: head = MRU, tail = LRU
- **Map** provides O(1) lookup by key
- **moveToHead()** reorders nodes on access (get/set)
- **evictLRU()** removes the tail node when capacity is exceeded
- All operations are O(1) time complexity
- `entries()` returns an iterator from head to tail (MRU to LRU order)
