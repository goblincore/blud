import { LRUCache } from './LRUCache';
import { describe, it, expect } from 'vitest';

// --- LRUCache Implementation ---

class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;
  private keyOrder: K[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.keyOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this._moveToRecent(key);
    return value;
  }

  set(key: K, value: V): void {
    const overCapacity = this.map.size >= this.capacity;
    if (this.map.has(key)) {
      this._moveToRecent(key);
      this.map.set(key, value);
      return;
    }
    if (overCapacity) {
      this._evictLRU();
    }
    this.map.set(key, value);
    this.keyOrder.push(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const found = this.map.delete(key);
    if (found) {
      const idx = this.keyOrder.indexOf(key);
      if (idx !== -1) this.keyOrder.splice(idx, 1);
    }
    return found;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    const reversedOrder = [...this.keyOrder].reverse();
    const self = this;
    return {
      next: () => {
        const idx = this._entriesIdx++;
        if (idx >= reversedOrder.length) return { done: true } as IteratorResult<[K, V]>;
        const key = reversedOrder[idx];
        const val = self.map.get(key)!;
        return { done: false, value: [key, val] };
      },
      [Symbol.iterator]: () => this.entries()
    };
  }

  private _moveToRecent(key: K): void {
    const idx = this.keyOrder.indexOf(key);
    if (idx !== -1) this.keyOrder.splice(idx, 1);
    this.keyOrder.push(key);
  }

  private _evictLRU(): void {
    if (this.keyOrder.length === 0) return;
    const lruKey = this.keyOrder.shift();
    if (lruKey) this.map.delete(lruKey);
  }
}

// --- Tests ---

describe('LRUCache', () => {
  it('basic get and set', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
  });

  it('eviction order', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('c')).toBe(3);
  });

  it('update moves to recent', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('b', 99);
    cache.set('d', 4);
    expect(cache.get('b')).toBe(99);
    expect(cache.has('b')).toBe(true);
  });

  it('delete', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(1);
  });

  it('capacity enforcement', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('x', 10);
    cache.set('y', 20);
    expect(cache.has('x')).toBe(false);
    expect(cache.get('y')).toBe(20);
  });

  it('entries iteration order', () => {
    const cache = new LRUCache<string, string>(3);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.get('b');
    const entries = Array.from(cache.entries());
    expect(entries[0]).toEqual(['b', '2']);
    expect(entries[1]).toEqual(['c', '3']);
    expect(entries[2]).toEqual(['a', '1']);
  });
});
