import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  it("basic get/set round-trips", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });

  it("get returns undefined for missing keys", () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.get("x")).toBeUndefined();
  });

  it("evicts least-recently-used item when capacity exceeded", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // inserting "c" should evict "a" (LRU)
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("update moves existing key to most-recently-used", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // touching "a" makes it the most recent
    cache.get("a");
    // inserting "c" should evict "b" (now LRU)
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("update via set also moves key to most-recently-used", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 99); // re-set "a" — moves to MRU
    cache.set("c", 3); // should evict "b"
    expect(cache.get("a")).toBe(99);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("delete removes key and returns true", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
  });

  it("delete returns false for missing key", () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.delete("x")).toBe(false);
  });

  it("capacity enforcement: never exceeds max entries", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(3);
    cache.set("d", 4); // evicts "a"
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
  });

  it("entries iteration in MRU order (most recent first)", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("b"); // "b" is now MRU
    const entries = [...cache.entries()];
    expect(entries).toEqual([
      ["b", 2], // MRU
      ["c", 3],
      ["a", 1], // LRU
    ]);
  });

  it("entries on empty cache yields nothing", () => {
    const cache = new LRUCache<string, number>(2);
    expect([...cache.entries()]).toEqual([]);
  });

  it("entries after delete reflects removal", () => {
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

  it("capacity enforcement with repeated sets to same key", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("a", 2); // re-set, no eviction
    cache.set("b", 3); // no eviction
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(2);
    expect(cache.get("b")).toBe(3);
  });

  it("works with number keys", () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, "one");
    cache.set(2, "two");
    cache.set(3, "three"); // evicts 1 (LRU)
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe("two");
    expect(cache.get(3)).toBe("three");
  });

  it("constructor throws for non-positive capacity", () => {
    expect(() => new LRUCache(0)).toThrow();
    expect(() => new LRUCache(-1)).toThrow();
  });
});
