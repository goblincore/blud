```typescript
import { describe, it, expect } from 'vitest';

class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;
  private order: K[];

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    this.capacity = capacity;
    this.map = new Map();
    this.order = [];
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      return undefined;
    }
    // Move to end (most recent)
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    return entry;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.set(key, value);
      // Move to end
      this.order = this.order.filter(k => k !== key);
      this.order.push(key);
    } else {
      if (this.map.size >= this.capacity) {
        // Evict LRU (first in order)
        const lruKey = this.order.shift();
        if (lruKey !== undefined) {
          this.map.delete(lruKey);
        }
      }
      this.map.set(key, value);
      this.order.push(key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    if (this.map.has(key)) {
      this.map.delete(key);
      this.order = this.order.filter(k => k !== key);
      return true;
    }
    return false;
  }

  get size(): number {
    return this.map.size;
  }

  *entries(): IterableIterator<[K, V]> {
    // MRU order: iterate order array backwards
    for (let i = this.order.length - 1; i >= 0; i--) {
      const key = this.order[i];
      const value = this.map.get(key);
      if (value !== undefined) {
        yield [key, value];
      }
    }
  }
}

// Tests
describe("LRUCache", () => {
  it("basic get/set", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });

  it("eviction order", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // Evicts "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("update moves to recent", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" becomes MRU
    cache.set("c", 3); // Evicts "b" (LRU)
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.get("a")).toBe(10);
  });

  it("delete", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    expect(cache.delete("a")).toBe(false);
  });

  it("capacity enforcement", () => {
    const cache = new LRUCache<string, number>(1);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(undefined);
    expect(cache.get("b")).toBe(2);
  });

  it("entries iteration order (MRU first)", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // "a" becomes MRU
    const entries = Array.from(cache.entries());
    // MRU order: a (most recent), c, b (LRU)
    expect(entries).toEqual([
      ["a", 1],
      ["c", 3],
      ["b", 2]
    ]);
  });
});
```
