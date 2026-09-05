import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("should store and retrieve values", () => {
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
    it("should evict the least recently used item when capacity is exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache: [a, b]  (b is most recent)
      cache.set("c", 3);
      // cache: [b, c]  (a evicted)
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("should evict in correct order with multiple evictions", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // cache: [a, b, c]
      cache.set("d", 4);
      // evicts a -> [b, c, d]
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);

      cache.set("e", 5);
      // evicts b (LRU, not accessed) -> [c, d, e]
      expect(cache.has("b")).toBe(false);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to most recent", () => {
    it("should move updated key to most recent position", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache: [a, b]
      cache.set("a", 10);
      // cache: [b, a]  — a moved to end (most recent)
      cache.set("c", 3);
      // evicts b (LRU) -> [a, c]
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
      expect(cache.get("a")).toBe(10);
    });

    it("should move accessed key to most recent via get", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache: [a, b]
      cache.get("a");
      // cache: [b, a]  — a moved to end by get
      cache.set("c", 3);
      // evicts b (LRU) -> [a, c]
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
    });
  });

  describe("delete", () => {
    it("should remove a key and return true", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
    });

    it("should return false for missing key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete("missing")).toBe(false);
    });

    it("should not evict after delete frees space", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      // cache: [b]
      cache.set("c", 3);
      // should NOT evict b since size < capacity
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
      expect(cache.size).toBe(2);
    });
  });

  describe("capacity enforcement", () => {
    it("should enforce capacity on set", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "a");
      cache.set(2, "b");
      cache.set(3, "c");
      expect(cache.size).toBe(2);
    });

    it("should enforce capacity after delete and re-set", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "a");
      cache.set(2, "b");
      cache.set(3, "c");
      cache.delete(1);
      cache.set(4, "d");
      expect(cache.size).toBe(2);
    });

    it("should throw on invalid capacity", () => {
      expect(() => new LRUCache(0)).toThrow("Capacity must be a positive number");
      expect(() => new LRUCache(-1)).toThrow("Capacity must be a positive number");
    });
  });

  describe("entries iteration order", () => {
    it("should yield entries in MRU order (most recent last)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      const result = Array.from(cache.entries());
      // a is LRU (first), c is MRU (last)
      expect(result).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
    });

    it("should reflect update order via entries", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // a moves to MRU
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["b", 2],
        ["a", 10],
      ]);
    });

    it("should yield entries in MRU order after eviction", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3); // evicts a
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["b", 2],
        ["c", 3],
      ]);
    });

    it("should yield entries in MRU order after get", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // a moves to MRU
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["b", 2],
        ["c", 3],
        ["a", 1],
      ]);
    });
  });
});
