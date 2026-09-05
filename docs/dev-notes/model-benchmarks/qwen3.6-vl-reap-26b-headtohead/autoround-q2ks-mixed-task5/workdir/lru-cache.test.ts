import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('basic get and set', () => {
    const cache = new LRUCache<string, number>(3);
    expect(cache.has('a')).toBe(false);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(undefined);
  });

  it('update moves to most recent', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Access 'a' — should become most recent (adjacent to head)
    cache.get('a');
    // 'b' is now least recent (adjacent to tail)
    // Insert 'd' — should evict 'b'
    cache.set('d', 4);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(cache.get('d')).toBe(4);
  });

  it('update during set moves to recent', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Update 'a' — should become most recent
    cache.set('a', 10);
    // 'c' is now least recent
    cache.set('d', 4);
    expect(cache.has('c')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  it('delete removes item', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 'a' is least recent, 'b' in middle, 'c' most recent
    cache.delete('b');
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('evicts least recently used when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Full. Access 'a' to make it recent
    cache.get('a');
    // 'b' is LRU. Insert 'd' — should evict 'b'
    cache.set('d', 4);
    expect(cache.has('b')).toBe(false);
  });

  it('entries yields MRU order', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Touch 'a' to make it recent
    cache.get('a');
    // 'c' is most recent (adjacent to head), 'b' is least (adjacent to tail)
    const entries = [...cache.entries()];
    expect(entries).toEqual([
      ['c', 3],
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('capacity enforcement with get', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Full (capacity 2). Access 'a' to make recent.
    cache.get('a');
    // 'b' is LRU. Insert 'c' — evicts 'b'.
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('entries from empty cache', () => {
    const cache = new LRUCache<string, number>(3);
    expect([...cache.entries()].length).toBe(0);
  });

  it('delete returns false for missing key', () => {
    const cache = new LRUCache<string, number>(3);
    expect(cache.delete('a')).toBe(false);
  });

  it('capacity of 0 evicts immediately', () => {
    const cache = new LRUCache<string, number>(0);
    cache.set('a', 1);
    // Capacity 0, so after set 'a' (size 1 > 0), it should have been evicted
    expect(cache.has('a')).toBe(false);
    expect(cache.set('b', 2));
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
  });
});
