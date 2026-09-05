import { describe, it, expect } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("sets and gets a value", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("missing")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("evicts least recently used item when capacity is exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // "a" is LRU
      expect(cache.get("a")).toBe(1); // move "a" to MRU
      cache.set("c", 3); // evicts "b" (now LRU)
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
      expect(cache.get("c")).toBe(3);
    });

    it("evicts the true LRU (most recently inserted without access)", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // "a" is LRU
      cache.set("c", 3); // evicts "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("update moves to recent", () => {
    it("updating an existing key moves it to MRU", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // update "a", now MRU; "b" is LRU
      cache.set("c", 3); // evicts "b"
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(10);
      expect(cache.get("c")).toBe(3);
    });

    it("get on existing key moves it to MRU without changing value", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // "a" is now MRU; "b" is LRU
      cache.set("c", 3); // evicts "b"
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("delete", () => {
    it("deletes an existing key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size).toBe(1);
    });

    it("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.delete("b")).toBe(false);
      expect(cache.size).toBe(1);
    });
  });

  describe("capacity enforcement", () => {
    it("never exceeds capacity", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(1, "a");
      cache.set(2, "b");
      cache.set(3, "c");
      expect(cache.size).toBe(3);
      cache.set(4, "d"); // should evict one
      expect(cache.size).toBe(3);
    });

    it("capacity of 1 works correctly", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
    });
  });

  describe("entries iteration order", () => {
    it("returns entries in MRU order (oldest to newest)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
    });

    it("iteration order reflects get reordering", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // move "a" to MRU
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["b", 2],
        ["c", 3],
        ["a", 1],
      ]);
    });

    it("iteration order reflects set update", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("b", 20); // move "b" to MRU
      const result = Array.from(cache.entries());
      expect(result).toEqual([
        ["a", 1],
        ["c", 3],
        ["b", 20],
      ]);
    });
  });

  describe("has", () => {
    it("returns true for existing keys", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
    });

    it("returns false for non-existing keys", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.has("b")).toBe(false);
    });
  });
});
