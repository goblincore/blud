import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("stores and retrieves a value", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("returns undefined for missing key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("x")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("evicts the LRU item when capacity is exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // "a" is LRU; adding "c" should evict it
      cache.set("c", 3);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("evicts the correct LRU among many inserts", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("1", 1);
      cache.set("2", 2);
      cache.set("3", 3);
      // Cache: 1 < 2 < 3 (3 is MRU)
      cache.set("4", 4);
      // "1" is LRU → evicted
      // Cache: 2 < 3 < 4

      expect(cache.get("1")).toBeUndefined();
      expect(cache.get("2")).toBe(2);
      expect(cache.get("3")).toBe(3);
      expect(cache.get("4")).toBe(4);
    });
  });

  describe("update moves key to most-recent", () => {
    it("re-set moves key to MRU position", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // a is LRU, b is MRU
      cache.set("a", 10);
      // Now b is LRU, a is MRU
      cache.set("c", 3);
      // b should be evicted (it's the new LRU)

      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(10);
      expect(cache.get("c")).toBe(3);
    });

    it("get also moves key to MRU position", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // a=LRU, b, c=MRU

      cache.get("b"); // promote b to MRU → order: a < c < b

      cache.set("d", 4); // evicts "a" (now LRU)

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("delete", () => {
    it("removes a key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.delete("a")).toBe(false);
    });

    it("delete frees capacity for new insert", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      // Now cache has room; "b" is only entry
      cache.set("c", 3);

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("capacity enforcement", () => {
    it("size reflects current number of entries", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.size).toBe(0);
      cache.set("a", 1);
      expect(cache.size).toBe(1);
      cache.set("b", 2);
      expect(cache.size).toBe(2);
      cache.delete("a");
      expect(cache.size).toBe(1);
    });

    it("capacity is respected after deletes and re-inserts", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      cache.set("c", 3);
      cache.set("d", 4); // evicts "b" (LRU), not "c"

      expect(cache.size).toBe(2);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("entries iteration", () => {
    it("returns entries in MRU order (most recent first)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // MRU order: c, b, a

      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("reflects updates during iteration", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // promote "a" → MRU order: b, a

      const entries = [...cache.entries()];
      expect(entries).toEqual([["a", 1], ["b", 2]]);
    });

    it("empty cache yields no entries", () => {
      const cache = new LRUCache<string, number>(1);
      expect([...cache.entries()]).toEqual([]);
    });
  });
});
