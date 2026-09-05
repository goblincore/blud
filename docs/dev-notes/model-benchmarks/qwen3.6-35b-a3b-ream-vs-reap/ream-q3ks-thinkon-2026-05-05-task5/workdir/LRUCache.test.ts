import { describe, it, expect } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("sets and gets a value", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.get("x")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("evicts LRU when over capacity", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Cache: [a:1, b:2, c:3]

      cache.set("d", 4);
      // Should evict "a" (LRU)
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("evicts correct LRU when accesses shuffle order", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Cache: [a:1, b:2, c:3]

      cache.get("a");
      // Cache: [b:2, c:3, a:1] — "a" moved to MRU end

      cache.set("d", 4);
      // Evicts "b" (now the true LRU)
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to recent", () => {
    it("updating value moves key to MRU end", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Cache: [a:1, b:2, c:3]

      cache.set("a", 10);
      // "a" moves to MRU end
      // Cache: [b:2, c:3, a:10]

      cache.set("d", 4);
      // Evicts "b" (now LRU)
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(10);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("setting existing key moves it to MRU without evicting new items", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.set("b", 20);
      // Just moves "b" to MRU, no eviction
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(20);
      expect(cache.get("c")).toBe(3);
      expect(cache.size).toBe(3);
    });
  });

  describe("delete", () => {
    it("removes existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.delete("b")).toBe(true);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.size).toBe(2);
    });

    it("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete("x")).toBe(false);
    });
  });

  describe("capacity enforcement", () => {
    it("respects capacity limit", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.size).toBe(2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("handles capacity of 1", () => {
      const cache = new LRUCache<number, string>(1);
      cache.set(1, "one");
      cache.set(2, "two");

      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("two");
      expect(cache.size).toBe(1);
    });

    it("handles capacity of 0", () => {
      const cache = new LRUCache<string, number>(0);
      cache.set("a", 1);
      expect(cache.size).toBe(0);
      expect(cache.get("a")).toBeUndefined();
    });
  });

  describe("entries iteration order", () => {
    it("returns entries in MRU order (most recent last)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Cache: [a:1, b:2, c:3]

      cache.get("a");
      // Cache: [b:2, c:3, a:1]

      cache.set("d", 4);
      // Cache: [c:3, a:1, d:4]
      expect(cache.get("b")).toBeUndefined();

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["c", 3],
        ["a", 1],
        ["d", 4],
      ]);
    });

    it("returns entries in insertion order for fresh cache", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
    });
  });
});
