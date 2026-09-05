import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  it("basic get/set", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("get returns undefined for missing key", () => {
    const cache = new LRUCache(2);
    expect(cache.get("x")).toBeUndefined();
  });

  it("eviction removes least-recently-used item", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // "a" is LRU; adding "c" should evict it
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("eviction order is correct with mixed reads and writes", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // "a" is now MRU, "b" is LRU
    cache.set("d", 4); // evicts "b"
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("update existing key moves it to most-recent", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 99); // update → MRU
    cache.set("c", 3); // evicts LRU ("b")
    expect(cache.get("a")).toBe(99);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("delete removes an entry", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("delete returns false for missing key", () => {
    const cache = new LRUCache(2);
    expect(cache.delete("x")).toBe(false);
  });

  it("has returns correct boolean", () => {
    const cache = new LRUCache(2);
    expect(cache.has("a")).toBe(false);
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
  });

  it("capacity enforcement — never exceeds capacity", () => {
    const cache = new LRUCache<string, number>(3);
    for (let i = 0; i < 100; i++) {
      cache.set(`k${i}`, i);
      expect(cache.size).toBeLessThanOrEqual(3);
    }
  });

  it("entries iteration is in MRU order", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // "a" → MRU
    const result = [...cache.entries()];
    expect(result).toEqual([
      ["a", 1],
      ["c", 3],
      ["b", 2],
    ]);
  });

  it("entries is empty for empty cache", () => {
    const cache = new LRUCache(1);
    expect([...cache.entries()]).toEqual([]);
  });

  it("rejects capacity < 1", () => {
    expect(() => new LRUCache(0)).toThrow("Capacity must be >= 1");
    expect(() => new LRUCache(-5)).toThrow("Capacity must be >= 1");
  });
});
