import { describe, it, expect } from "vitest";
import { LRUCache } from "./LRUCache";

describe("LRUCache", () => {
  it("basic get/set", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBeUndefined();
  });

  it("evicts least-recently-used item", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("update moves key to most recent", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" updated → becomes most recent
    cache.set("c", 3); // evicts "b" (LRU), not "a"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("c")).toBe(3);
  });

  it("delete removes entry", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("nonexistent")).toBe(false);
  });

  it("capacity enforcement", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(3);

    cache.set("d", 4);
    expect(cache.size).toBe(3); // still 3, evicted "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.get("d")).toBe(4);
  });

  it("entries returns items in MRU order", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    const entries = [...cache.entries()];
    // MRU order: most recent first → c, b, a
    expect(entries).toEqual([["c", 3], ["b", 2], ["a", 1]]);
  });

  it("access order affects eviction", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // "a" becomes most recent
    cache.set("d", 4); // evicts "b" (now LRU), not "a"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.get("d")).toBe(4);
  });

  it("has returns correct booleans", () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.has("x")).toBe(false);
    cache.set("x", 1);
    expect(cache.has("x")).toBe(true);
    cache.delete("x");
    expect(cache.has("x")).toBe(false);
  });
});
