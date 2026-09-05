import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache<K,V>", () => {
  describe("basic get/set", () => {
    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.has("a")).toBe(false);
    });

    it("should return the value for set keys", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(true);
    });

    it("should handle object keys", () => {
      const cache = new LRUCache<{ id: number }, string>(2);
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      cache.set(key1, "first");
      cache.set(key2, "second");
      expect(cache.get(key1)).toBe("first");
      expect(cache.get(key2)).toBe("second");
    });

    it("should not return value for un-set keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("missing")).toBeUndefined();
      expect(cache.has("missing")).toBe(false);
    });

    it("should be empty on construction", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.size).toBe(0);
      expect([...cache.entries()]).toEqual([]);
    });
  });

  describe("eviction order", () => {
    it("should evict LRU when capacity is exceeded", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // "a" is LRU, should be evicted
      cache.set("d", 4);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("should evict based on access order, not insertion order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Access "a" → access order: b, c, a
      cache.get("a");
      // "b" is now LRU
      cache.set("d", 4);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should evict when at capacity", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "one");
      cache.set(2, "two");
      // Full, "1" is LRU
      cache.set(3, "three");

      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two");
      expect(cache.get(3)).toBe("three");
    });

    it("should evict most-recently-used when others have been accessed", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("x", 10);
      cache.set("y", 20);
      cache.set("z", 30);
      // Access x and z → y is LRU
      cache.get("x");
      cache.get("z");
      cache.set("w", 40);

      expect(cache.get("x")).toBe(10);
      expect(cache.get("y")).toBeUndefined();
      expect(cache.get("z")).toBe(30);
      expect(cache.get("w")).toBe(40);
    });
  });

  describe("update moves to most-recently-used", () => {
    it("should update value and move key to MRU position", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // "b" is LRU, "a" is MRU
      cache.get("a");
      // Update "b" → moves to MRU
      cache.set("b", 20);

      // Now "c" is LRU
      cache.set("d", 4);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(20);
      expect(cache.get("c")).toBeUndefined();
      expect(cache.get("d")).toBe(4);
    });

    it("should not evict on update within capacity", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("a", 100);

      expect(cache.get("a")).toBe(100);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.size).toBe(3);
    });

    it("should move updated key to MRU when evicting", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Update "a" so it becomes MRU
      cache.set("a", 10);
      // "b" is LRU, should be evicted
      cache.set("d", 4);

      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("delete", () => {
    it("should remove key-value pair and return true", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
      expect(cache.get("a")).toBeUndefined();
    });

    it("should return false for non-existent key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete("missing")).toBe(false);
    });

    it("should free up space in cache", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");

      expect(cache.size).toBe(1);
      // Now can add "c"
      cache.set("c", 3);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.size).toBe(2);
    });

    it("should remove from access order so next eviction is correct", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Delete "a" so "b" is now LRU
      cache.delete("a");
      cache.set("d", 4);

      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.get("a")).toBeUndefined();
    });

    it("should handle double delete", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.delete("a")).toBe(false);
    });
  });

  describe("capacity enforcement", () => {
    it("should enforce capacity never exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.size).toBe(2);
    });

    it("should handle zero capacity", () => {
      const cache = new LRUCache<string, number>(0);
      cache.set("a", 1);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("should handle capacity of 1", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.size).toBe(1);
    });

    it("should handle set on full cache without overwriting", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // Set a new key to evict
      cache.set("c", 3);

      expect(cache.size).toBe(2);
    });
  });

  describe("entries iteration order", () => {
    it("should iterate in MRU order (most recent first)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // get("b") → accessOrder: [a, c, b]
      cache.get("b");
      // get("c") → accessOrder: [a, b, c]
      cache.get("c");
      // entries yields reverse of accessOrder: c, b, a
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("should iterate insertion order (LRU first) with no re-access", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      const entries = [...cache.entries()];
      // LRU first: a, b, c → MRU order: c, b, a
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("should reflect updates in entries", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // "a" becomes MRU
      cache.set("c", 3);  // "c" added

      const entries = [...cache.entries()];
      // MRU order: c (newest), a (updated), b
      expect(entries).toEqual([
        ["c", 3],
        ["a", 10],
        ["b", 2],
      ]);
    });

    it("should exclude deleted keys", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.delete("b");

      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["c", 3],
        ["a", 1],
      ]);
    });

    it("should be empty iterator for empty cache", () => {
      const cache = new LRUCache<string, number>(2);
      const entries = [...cache.entries()];
      expect(entries).toEqual([]);
    });

    it("should yield values consistent with get() after re-access", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.get("a");
      cache.get("b");

      const entries = [...cache.entries()];
      for (const [key, value] of entries) {
        expect(cache.get(key)).toBe(value);
      }
    });
  });

  describe("complex scenarios", () => {
    it("should handle interleaved get/set/delete operations", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // "a" is now MRU
      cache.get("a");
      cache.set("d", 4); // "b" evicted

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should handle multiple evictions", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should handle delete then re-set", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      cache.set("a", 100);

      expect(cache.get("a")).toBe(100);
      expect(cache.get("b")).toBe(2);
    });

    it("should handle get, update, delete in sequence", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a");
      cache.set("a", 10);
      cache.delete("b");
      cache.set("c", 3);

      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });
  });
});
