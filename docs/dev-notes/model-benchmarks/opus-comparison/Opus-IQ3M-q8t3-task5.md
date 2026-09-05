<!-- thinking (1012 chars) -->

Let me think through this carefully.

I need to design a test suite for a generic LRUCache<K,V> class.

Key requirements:
- Constructor takes capacity number
- get(key): V | undefined (moves to most recent)
- set(key, value): void (evicts LRU if over capacity)
- has(key): boolean
- delete(key): boolean
- get size(): number
- entries(): IterableIterator<[K,V]> in MRU order
- Must evict least-recently-used item when capacity exceeded

I'll use vitest for testing.

Let me design the implementation:
- Use a doubly-linked list for O(1) operations
- Use a Map for O(1) key lookup
- Head marker for most-recent, tail marker for least-recent

For testing:
1. Basic get/set - create cache, set values, get them back
2. Eviction order - fill beyond capacity, verify LRU was evicted
3. Update moves to recent - get/set same key, verify order changed
4. Delete - verify removal
5. Capacity enforcement - ensure size never exceeds capacity
6. Entries iteration order - verify MRU-first ordering

Let me implement this.

<!-- answer (6640 chars) -->
Here's a complete LRUCache implementation with vitest tests:

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
  private head: Node<K, V>;
  private tail: Node<K, V>;
  private size: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be positive");
    }
    this.capacity = capacity;
    this.map = new Map();
    this.size = 0;
    // Sentinel nodes
    this.head = new Node(null as unknown as K, null as unknown as V);
    this.tail = new Node(null as unknown as K, null as unknown as V);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private removeNode(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private addToFront(node: Node<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private moveToFront(node: Node<K, V>): void {
    this.removeNode(node);
    this.addToFront(node);
  }

  private removeTail(): Node<K, V> {
    const node = this.tail.prev!;
    this.removeNode(node);
    return node;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToFront(existing);
      return;
    }

    if (this.size === this.capacity) {
      const evicted = this.removeTail();
      this.map.delete(evicted.key);
      this.size--;
    }

    const newNode = new Node(key, value);
    this.map.set(key, newNode);
    this.addToFront(newNode);
    this.size++;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    this.size--;
    return true;
  }

  get size(): number {
    return this.size;
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    let current = this.head.next;
    while (current && current !== this.tail) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  entries(): IterableIterator<[K, V]> {
    return this[Symbol.iterator]();
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("should store and retrieve values", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
    });

    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.get("nonexistent")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("should evict LRU when capacity exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3); // Should evict "a"
      
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("update moves to recent", () => {
    it("should move updated key to most recent", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // Move "a" to most recent
      cache.set("c", 3); // Should evict "b" (LRU)
      
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    it("should update value and move to recent", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // Update and move to recent
      cache.set("c", 3); // Should evict "b" (LRU)
      
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
      expect(cache.get("a")).toBe(10);
    });
  });

  describe("delete", () => {
    it("should delete existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
      expect(cache.size).toBe(1);
    });

    it("should return false for missing key", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete("nonexistent")).toBe(false);
    });
  });

  describe("capacity enforcement", () => {
    it("should never exceed capacity", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4);
      
      expect(cache.size).toBe(2);
    });

    it("should throw for invalid capacity", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow();
      expect(() => new LRUCache<string, number>(-1)).toThrow();
    });
  });

  describe("entries iteration", () => {
    it("should return entries in MRU order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1]
      ]);
    });

    it("should reflect updates in order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // Move "a" to front
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["a", 10],
        ["b", 2]
      ]);
    });
  });
});
```

**Test coverage includes:**
1. ✅ **Basic get/set** - Store and retrieve values, undefined for missing keys
2. ✅ **Eviction order** - LRU item evicted when capacity exceeded
3. ✅ **Update moves to recent** - get() moves to MRU; set() updates and moves to MRU
4. ✅ **Delete** - Removes item and returns correct boolean
5. ✅ **Capacity enforcement** - Size never exceeds capacity; invalid capacity throws
6. ✅ **Entries iteration order** - Returns items in MRU-first order
