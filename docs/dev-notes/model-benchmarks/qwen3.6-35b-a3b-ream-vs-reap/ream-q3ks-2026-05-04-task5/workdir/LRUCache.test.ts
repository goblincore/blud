import { describe, it, expect } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  describe("basic get/set", () => {
    it("should store and retrieve a value", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.get("missing")).toBeUndefined();
    });
  });

  describe("eviction order", () => {
    it("should evict the least recently used item when capacity is exceeded", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // "a" is LRU, should be evicted
      cache.set("d", 4);
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("should evict LRU even if a middle key was accessed recently", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("b"); // "b" is now MRU
      cache.set("d", 4);
      // "a" is LRU and should be evicted
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("update moves to recent", () => {
    it("should move updated key to most recently used", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // "a" is LRU, "c" is MRU
      cache.set("a", 10); // update "a" to be MRU
      cache.set("d", 4);
      // "b" should be evicted (now LRU), "a" survives
      expect(cache.get("a")).toBe(10);
      expect(cache.has("b")).toBe(false);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should not evict when updating an existing key", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // update, no eviction
      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBe(2);
      expect(cache.size).toBe(2);
    });
  });

  describe("delete", () => {
    it("should remove an existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.delete("b")).toBe(true);
      expect(cache.has("b")).toBe(false);
      expect(cache.get("b")).toBeUndefined();
    });

    it("should return false for missing keys", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete("missing")).toBe(false);
    });
  });

  describe("capacity enforcement", () => {
    it("should enforce capacity of 1", () => {
      const cache = new LRUCache<string, string>(1);
      cache.set("a", "1");
      cache.set("b", "2");
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.size).toBe(1);
    });

    it("should not allow capacity of 0", () => {
      expect(() => new LRUCache<string, string>(0)).toThrow("Capacity must be at least 1");
    });
  });

  describe("entries iteration order", () => {
    it("should return entries in MRU order (most recent first)", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    it("entries should reflect get() moving keys to MRU", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a"); // "a" moves to MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["a", 1],
        ["c", 3],
        ["b", 2],
      ]);
    });

    it("entries should reflect set() updates moving keys to MRU", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("a", 10); // update "a" to MRU
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["a", 10],
        ["c", 3],
        ["b", 2],
      ]);
    });

    it("entries should reflect after deletion", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.delete("b");
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ["c", 3],
        ["a", 1],
      ]);
    });
  });
});
