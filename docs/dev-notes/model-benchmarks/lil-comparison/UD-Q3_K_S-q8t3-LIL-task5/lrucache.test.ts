import { describe, it, expect } from "vitest";
import { LRUCache } from "./lrucache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("stores and retrieves a value", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("z")).toBe(undefined);
    });

    it("handles set/get with different types", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(42, "answer");
      expect(cache.get(42)).toBe("answer");
    });
  });

  describe("eviction order", () => {
    it("evicts the least-recently-used item first", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache order (MRU→LRU): b, a
      cache.set("c", 3); // evicts "a"
      expect(cache.get("a")).toBe(undefined);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("evicts the oldest item in a chain", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // order: c, b, a
      cache.set("d", 4); // evicts "a"
      expect(cache.get("a")).toBe(undefined);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to most recent", () => {
    it("updating an existing key moves it to MRU", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // order: b, a
      cache.set("a", 10); // "a" jumps to front
      // order: a, b
      cache.set("c", 3); // evicts "b" (was LRU)
      expect(cache.get("b")).toBe(undefined);
      expect(cache.get("a")).toBe(10);
      expect(cache.get("c")).toBe(3);
    });

    it("set with existing key updates value without growing size", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 99);
      expect(cache.size).toBe(2);
      expect(cache.get("a")).toBe(99);
    });
  });

  describe("delete", () => {
    it("deletes an existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("x", 10);
      expect(cache.delete("x")).toBe(true);
      expect(cache.get("x")).toBe(undefined);
      expect(cache.has("x")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("returns false for missing keys", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete("nope")).toBe(false);
    });

    it("delete moves other items to correct LRU positions", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // order: c, b, a
      cache.delete("b");
      // order: c, a  (size 2)
      cache.set("d", 4);
      // order: d, c, a  (size 3)
      cache.delete("a"); // evicts a
      // order: d, c  (size 2)
      expect(cache.get("a")).toBe(undefined);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("capacity enforcement", () => {
    it("respects capacity limit", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size).toBe(2);
      cache.set("c", 3);
      expect(cache.size).toBe(2);
    });

    it("capacity of 1 works correctly", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size).toBe(1);
      expect(cache.get("a")).toBe(undefined);
      expect(cache.get("b")).toBe(2);
    });

    it("rejects zero/negative capacity", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow();
      expect(() => new LRUCache<string, number>(-1)).toThrow();
    });
  });

  describe("entries iteration order", () => {
    it("yields entries from MRU to LRU", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("reflects updates in iteration", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // "a" is now MRU

      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["a", 10],
        ["b", 2],
      ]);
    });

    it("reflects deletions in iteration", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.delete("b");

      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["c", 3],
        ["a", 1],
      ]);
    });

    it("returns empty iterator for empty cache", () => {
      const cache = new LRUCache<string, number>(3);
      const result = Array.from(cache.entries());
      expect(result).toEqual([]);
    });
  });

  describe("has", () => {
    it("returns true for present keys", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
    });

    it("returns false for absent keys", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.has("b")).toBe(false);
    });
  });
});
