import { describe, it, expect } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("stores and retrieves a value", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get("missing")).toBeUndefined();
    });

    it("overwrites existing key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("a", 2);
      expect(cache.get("a")).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe("eviction order", () => {
    it("evicts least recently used item when capacity exceeded", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache is now: a, b (b is most recent)
      cache.set("c", 3);
      // evicts "a" (LRU)
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("evicts correct LRU among multiple items", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // cache: a, b, c
      cache.set("d", 4);
      // evicts "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to most recent", () => {
    it("updating a key moves it to most recent position", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache: a, b
      cache.set("a", 10); // "a" is now most recent: b, a
      cache.set("c", 3); // evicts "b" (LRU)
      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });

    it("accessing a key moves it to most recent position", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      // cache: a, b
      cache.get("a"); // "a" is now most recent: b, a
      cache.set("c", 3); // evicts "b" (LRU)
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("delete", () => {
    it("deletes an existing key and returns true", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.delete("a")).toBe(false);
    });

    it("does not affect eviction order", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.delete("a");
      // cache: b
      cache.set("c", 3);
      // cache: b, c
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });
  });

  describe("capacity enforcement", () => {
    it("never exceeds capacity", () => {
      const cache = new LRUCache<number, string>(2);
      cache.set(1, "a");
      cache.set(2, "b");
      cache.set(3, "c");
      expect(cache.size).toBe(2);
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("b");
      expect(cache.get(3)).toBe("c");
    });

    it("respects capacity of 1", () => {
      const cache = new LRUCache<number, string>(1);
      cache.set(1, "a");
      cache.set(2, "b");
      expect(cache.size).toBe(1);
      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe("b");
    });
  });

  describe("entries iteration order", () => {
    it("returns entries in MRU order (least recent first, most recent last)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // cache: a, b, c (c is most recent)
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
    });

    it("updates iteration order after get", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // move "a" to most recent
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["b", 2],
        ["c", 3],
        ["a", 1],
      ]);
    });

    it("updates iteration order after set on existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("a", 10); // move "a" to most recent
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ["b", 2],
        ["c", 3],
        ["a", 10],
      ]);
    });

    it("returns empty iterator for empty cache", () => {
      const cache = new LRUCache<string, number>(2);
      const entries = [...cache.entries()];
      expect(entries).toEqual([]);
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

  describe("size", () => {
    it("reflects current number of entries", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.size).toBe(0);
      cache.set("a", 1);
      expect(cache.size).toBe(1);
      cache.set("b", 2);
      expect(cache.size).toBe(2);
      cache.delete("a");
      expect(cache.size).toBe(1);
    });
  });
});
