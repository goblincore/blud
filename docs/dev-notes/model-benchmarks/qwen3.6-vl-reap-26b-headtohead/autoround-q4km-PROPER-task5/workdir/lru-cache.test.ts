import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("stores and retrieves a value", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "one");
      expect(cache.get(1)).toBe("one");
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<number, string>(2);
      expect(cache.get(99)).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("evicts the least-recently-used item when at capacity", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "one");
      cache.set(2, "two");
      // Cache: 1, 2  (2 is MRU, 1 is LRU)

      cache.set(3, "three"); // evicts 1

      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two");
      expect(cache.get(3)).toBe("three");
    });

    it("evicts in correct order with three slots", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      // Cache: 1, 2, 3  (3 is MRU)

      cache.set(4, "four"); // evicts 1
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two");
      expect(cache.get(3)).toBe("three");
      expect(cache.get(4)).toBe("four");
    });
  });

  describe("update moves to most-recent", () => {
    it("updating an existing key moves it to MRU", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      // Cache order: 1, 2, 3

      cache.set(2, "two-updated"); // update → 2 becomes MRU
      // Cache order: 1, 3, 2

      cache.set(4, "four"); // evicts 1 (now LRU)
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two-updated");
      expect(cache.get(3)).toBe("three");
      expect(cache.get(4)).toBe("four");
    });

    it("get() also moves key to MRU", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      // Cache order: 1, 2, 3

      cache.get(1); // 1 moves to MRU → order: 2, 3, 1

      cache.set(4, "four"); // evicts 2 (now LRU)
      expect(cache.get(1)).toBe("one");
      expect(cache.get(2)).toBeUndefined();
      expect(cache.get(3)).toBe("three");
      expect(cache.get(4)).toBe("four");
    });
  });

  describe("delete", () => {
    it("removes a key and returns true", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      expect(cache.delete(1)).toBe(true);
      expect(cache.get(1)).toBeUndefined();
      expect(cache.size).toBe(1);
    });

    it("returns false for non-existent key", () => {
      const cache = new LRUCache<number, string>(3);
      expect(cache.delete(99)).toBe(false);
    });

    it("delete adjusts LRU order so the right item is evicted next", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      // order: 3→2→1

      cache.delete(3); // remove MRU
      // order: 2→1

      cache.set(4, "four"); // no eviction, size=3
      // order: 4→2→1

      cache.set(5, "five"); // evicts 1 (LRU)
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two");
      expect(cache.get(3)).toBeUndefined();
      expect(cache.get(4)).toBe("four");
      expect(cache.get(5)).toBe("five");
    });
  });

  describe("capacity enforcement", () => {
    it("never exceeds capacity", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      cache.set(4, "four");
      cache.set(5, "five");

      expect(cache.size).toBe(2);
      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(false);
      expect(cache.has(3)).toBe(false);
      expect(cache.has(4)).toBe(true);
      expect(cache.has(5)).toBe(true);
    });

    it("capacity-1 cache always holds only the latest item", () => {
      const cache = new LRUCache<number, string>(1);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");

      expect(cache.size).toBe(1);
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBeUndefined();
      expect(cache.get(3)).toBe("three");
    });

    it("throws on invalid capacity", () => {
      expect(() => new LRUCache<string, string>(0)).toThrow(
        "Capacity must be at least 1"
      );
      expect(() => new LRUCache<string, string>(-1)).toThrow(
        "Capacity must be at least 1"
      );
    });
  });

  describe("entries iteration order", () => {
    it("returns entries from MRU to LRU", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");
      // MRU → LRU: 3, 2, 1

      const entries = [...cache.entries()];
      expect(entries).toEqual([
        [3, "three"],
        [2, "two"],
        [1, "one"],
      ]);
    });

    it("updates iteration order after get() moves a node", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three");

      cache.get(1); // 1 moves to MRU → order: 1, 3, 2

      const entries = [...cache.entries()];
      expect(entries).toEqual([
        [1, "one"],
        [3, "three"],
        [2, "two"],
      ]);
    });

    it("returns empty array for empty cache", () => {
      const cache = new LRUCache<number, string>(2);
      expect([...cache.entries()]).toEqual([]);
    });

    it("reflects evictions in iteration", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "one");
      cache.set(2, "two");
      cache.set(3, "three"); // evicts 1

      const entries = [...cache.entries()];
      expect(entries).toEqual([
        [3, "three"],
        [2, "two"],
      ]);
    });
  });
});
