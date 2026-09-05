```typescript
class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    this.capacity = capacity;
    this.map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, update and move to end
    if (this.map.has(key)) {
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
    // Return entries in MRU order (most recently used first)
    // Map stores in insertion order (LRU first, MRU last)
    // We need to reverse the order
    const entries = Array.from(this.map.entries());
    return entries.reverse()[Symbol.iterator]();
  }
}

// Vitest tests
import { describe, it, expect } from "vitest";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("should set and get values", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("should return undefined for non-existent keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("a")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("should evict least recently used item", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3); // Should evict "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("should evict the correct LRU item when multiple items exist", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // "a" is now most recent
      cache.set("d", 4); // Should evict "b" (LRU)
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to recent", () => {
    it("should move updated key to most recent position", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 3); // Update "a", making it most recent
      cache.set("c", 4); // Should evict "b" (LRU)
      expect(cache.get("a")).toBe(3);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(4);
    });

    it("should update value without evicting", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 3);
      expect(cache.size).toBe(2);
      expect(cache.get("a")).toBe(3);
      expect(cache.get("b")).toBe(2);
    });
  });

  describe("delete", () => {
    it("should delete existing key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.size).toBe(1);
    });

    it("should return false for non-existent key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete("a")).toBe(false);
    });

    it("should handle delete then set correctly", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      cache.set("c", 3); // Should not evict "b"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("capacity enforcement", () => {
    it("should maintain capacity limit", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.size).toBe(2);
    });

    it("should work with capacity of 1", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.size).toBe(1);
    });

    it("should not allow capacity less than 1", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow();
      expect(() => new LRUCache<string, number>(-1)).toThrow();
    });
  });

  describe("entries iteration order", () => {
    it("should return entries in MRU order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([["c", 3], ["b", 2], ["a", 1]]);
    });

    it("should reflect updates in iteration order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // Move "a" to MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([["a", 1], ["c", 3], ["b", 2]]);
    });

    it("should return empty array for empty cache", () => {
      const cache = new LRUCache<string, number>(2);
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([]);
    });

    it("should reflect deletions in iteration", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.delete("b");
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([["c", 3], ["a", 1]]);
    });
  });
});
```
