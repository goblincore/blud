import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru";

// ──────────────────────────────────────────────────────────────────────────────
// Basic get / set
// ──────────────────────────────────────────────────────────────────────────────

describe("basic get/set", () => {
  it("returns undefined for a missing key", () => {
    const c = new LRUCache<string, number>(2);
    expect(c.get("x")).toBeUndefined();
  });

  it("returns the value after set", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("overwrites an existing key's value", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.get("a")).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Eviction order
// ──────────────────────────────────────────────────────────────────────────────

describe("eviction order", () => {
  it("evicts the LRU item when capacity is exceeded", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    // cache: [a, b]  (a = LRU, b = MRU)
    c.set("c", 3);
    // eviction should drop "a"
    expect(c.has("a")).toBe(false);
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("respects capacity = 1", () => {
    const c = new LRUCache<string, number>(1);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.has("a")).toBe(false);
    expect(c.get("b")).toBe(2);
  });

  it("does not evict when under capacity", () => {
    const c = new LRUCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Update moves to most-recently-used
// ──────────────────────────────────────────────────────────────────────────────

describe("update moves to recent", () => {
  it("updating a key promotes it to MRU", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    // [a, b]
    c.set("a", 10); // promote "a" to MRU
    c.set("c", 3); // now "b" should evict (it's LRU)
    expect(c.has("a")).toBe(true);
    expect(c.get("a")).toBe(10);
    expect(c.has("b")).toBe(false);
    expect(c.get("c")).toBe(3);
  });

  it("get() also promotes to MRU", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    // [a, b]
    c.get("a"); // promote "a"
    // [b, a]  — now "b" is LRU
    c.set("c", 3);
    expect(c.has("b")).toBe(false); // "b" evicted
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// delete
// ──────────────────────────────────────────────────────────────────────────────

describe("delete", () => {
  it("removes a key and returns true", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.delete("a")).toBe(true);
    expect(c.has("a")).toBe(false);
    expect(c.size).toBe(1);
  });

  it("returns false for a missing key", () => {
    const c = new LRUCache<string, number>(2);
    expect(c.delete("x")).toBe(false);
  });

  it("delete frees a slot for a new entry", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a"); // free slot
    c.set("c", 3); // should NOT evict "b"
    expect(c.get("c")).toBe(3);
    expect(c.get("b")).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Capacity enforcement
// ──────────────────────────────────────────────────────────────────────────────

describe("capacity enforcement", () => {
  it("clamps zero capacity to 1", () => {
    const c = new LRUCache<string, number>(0);
    expect(c.cap).toBe(1);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size).toBe(1);
  });

  it("clamps negative capacity to 1", () => {
    const c = new LRUCache<string, number>(-5);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size).toBe(1);
  });

  it("evicts oldest when set over capacity", () => {
    const c = new LRUCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4); // evicts "a"
    expect(c.has("a")).toBe(false);
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.get("d")).toBe(4);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// entries() iteration order (MRU → LRU)
// ──────────────────────────────────────────────────────────────────────────────

describe("entries()", () => {
  it("yields entries in MRU-first order", () => {
    const c = new LRUCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    // order: [a, b, c] — MRU = c
    const result = [...c.entries()];
    expect(result).toEqual([
      ["c", 3],
      ["b", 2],
      ["a", 1],
    ]);
  });

  it("respects get() promotion", () => {
    const c = new LRUCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a"); // promote "a" to MRU → [b, c, a]
    const result = [...c.entries()];
    expect(result).toEqual([
      ["a", 1],
      ["c", 3],
      ["b", 2],
    ]);
  });

  it("is empty when cache is empty", () => {
    const c = new LRUCache<string, number>(2);
    expect([...c.entries()]).toEqual([]);
  });
});
