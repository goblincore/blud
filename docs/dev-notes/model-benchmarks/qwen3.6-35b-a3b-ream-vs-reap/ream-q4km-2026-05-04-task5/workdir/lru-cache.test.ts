import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  /* ── basic get / set ───────────────────────────────────────────── */

  it("stores and retrieves a value", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.get("missing")).toBeUndefined();
  });

  /* ── eviction order ────────────────────────────────────────────── */

  it("evicts the least-recently-used item when capacity is exceeded", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // "a" is LRU
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);

    // Now set "b" again so it becomes MRU, "a" is still MRU after get
    // Let's do a cleaner test:
    const cache2 = new LRUCache<string, number>(2);
    cache2.set("a", 1);
    cache2.set("b", 2);
    // LRU = "a", MRU = "b"
    cache2.set("c", 3);
    expect(cache2.has("a")).toBe(false); // evicted
    expect(cache2.get("b")).toBe(2);
    expect(cache2.get("c")).toBe(3);
  });

  it("evicts in FIFO order when no gets happen", () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(3, "c");
    cache.set(4, "d"); // evicts 1
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(3)).toBe(true);
    expect(cache.has(4)).toBe(true);
    cache.set(5, "e"); // evicts 2
    expect(cache.has(2)).toBe(false);
  });

  /* ── update moves to recent ────────────────────────────────────── */

  it("updating a key moves it to MRU", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" is now MRU, "b" is LRU
    cache.set("c", 3);
    expect(cache.has("b")).toBe(false); // "b" evicted
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });

  it("get also moves key to MRU, preventing eviction", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" becomes MRU
    cache.set("c", 3); // "b" is now LRU, gets evicted
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  /* ── delete ────────────────────────────────────────────────────── */

  it("delete returns true and removes the key", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("x", 10);
    expect(cache.delete("x")).toBe(true);
    expect(cache.has("x")).toBe(false);
    expect(cache.get("x")).toBeUndefined();
  });

  it("delete on missing key returns false", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("x", 10);
    expect(cache.delete("y")).toBe(false);
    expect(cache.size).toBe(1);
  });

  it("delete removes a middle entry and evicts the true LRU next time", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // order: a(LRU) -> b -> c(MRU), size=3 full
    cache.delete("b"); // order: a(LRU) -> c(MRU), size=2
    cache.set("d", 4); // size 2→3, no eviction. order: c(LRU) -> d(MRU)
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
    // now a is LRU
    cache.set("e", 5); // evicts a, order: d(LRU) -> e(MRU)
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
    expect(cache.has("e")).toBe(true);
  });

  /* ── capacity enforcement ──────────────────────────────────────── */

  it("never exceeds its capacity", () => {
    const cache = new LRUCache<string, number>(3);
    for (let i = 0; i < 100; i++) {
      cache.set(`k${i}`, i);
      expect(cache.size).toBeLessThanOrEqual(3);
    }
  });

  it("throws on zero or negative capacity", () => {
    expect(() => new LRUCache(0)).toThrow("LRUCache capacity must be >= 1");
    expect(() => new LRUCache(-5)).toThrow("LRUCache capacity must be >= 1");
  });

  it("size reflects the actual number of entries", () => {
    const cache = new LRUCache<string, number>(3);
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    expect(cache.size).toBe(1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
    cache.delete("a");
    expect(cache.size).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2); // evicted "b", added "c"
    cache.set("d", 4);
    expect(cache.size).toBe(3);
  });

  /* ── entries iteration order ───────────────────────────────────── */

  it("yields entries in MRU order (most recent first)", () => {
    const cache = new LRUCache<string, number>(5);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    const result = [...cache.entries()];
    expect(result).toEqual([
      ["c", 3],
      ["b", 2],
      ["a", 1],
    ]);
  });

  it("update via set reorders in entries()", () => {
    const cache = new LRUCache<string, number>(5);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" becomes MRU
    const result = [...cache.entries()];
    expect(result).toEqual([
      ["a", 10],
      ["b", 2],
    ]);
  });

  it("get reorders in entries()", () => {
    const cache = new LRUCache<string, number>(5);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // move "a" to MRU
    const result = [...cache.entries()];
    expect(result).toEqual([
      ["a", 1],
      ["c", 3],
      ["b", 2],
    ]);
  });

  it("delete removes from iteration", () => {
    const cache = new LRUCache<string, number>(5);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    const result = [...cache.entries()];
    expect(result).toEqual([["b", 2]]);
  });

  it("returns empty iterator when cache is empty", () => {
    const cache = new LRUCache<string, number>(2);
    expect([...cache.entries()]).toEqual([]);
  });

  /* ── generic types ─────────────────────────────────────────────── */

  it("works with number keys", () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, "one");
    cache.set(2, "two");
    expect(cache.get(1)).toBe("one"); // 1 now MRU, 2 is LRU
    cache.set(3, "three"); // evicts 2 (LRU)
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
    expect(cache.has(3)).toBe(true);
  });

  it("works with object keys (reference identity)", () => {
    const cache = new LRUCache<object, number>(2);
    const k1 = { id: 1 };
    cache.set(k1, 10);
    expect(cache.get(k1)).toBe(10);
    // Different object with same structure should not match
    expect(cache.get({ id: 1 })).toBeUndefined();
  });
});
