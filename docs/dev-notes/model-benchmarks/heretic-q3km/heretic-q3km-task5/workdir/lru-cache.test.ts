import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  describe('basic get/set', () => {
    it('stores and retrieves values', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('returns undefined for missing keys', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get('missing')).toBe(undefined);
    });

    it('overwrites existing value', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
    });

    it('handles arbitrary key types', () => {
      const cache = new LRUCache<object, string>(2);
      const k1 = { id: 1 };
      const k2 = { id: 2 };
      cache.set(k1, 'hello');
      cache.set(k2, 'world');
      expect(cache.get(k1)).toBe('hello');
      expect(cache.get(k2)).toBe('world');
    });
  });

  describe('eviction order', () => {
    it('evicts the least recently used item', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      // 'a' is LRU
      cache.set('c', 3); // evicts 'a'
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('evicts in correct order with capacity 1', () => {
      const cache = new LRUCache<string, number>(1);
      cache.set('a', 1);
      cache.set('b', 2); // evicts 'a'
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(2);
    });

    it('evicts oldest after multiple inserts', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // MRU order: c, b, a  (a is LRU)
      cache.set('d', 4); // evicts 'a'
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('access moves to most recent', () => {
    it('get moves key to MRU position', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Order: c (MRU), b, a (LRU)
      cache.get('a'); // 'a' becomes MRU: c, b, a
      cache.set('d', 4); // evicts 'b' (now LRU)
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(undefined);
    });

    it('set on existing key moves to MRU', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 10); // 'a' becomes MRU: c, b, a
      cache.set('d', 4); // evicts 'b' (now LRU)
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBe(undefined);
    });
  });

  describe('delete', () => {
    it('removes a key', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.delete('b')).toBe(true);
      expect(cache.get('b')).toBe(undefined);
    });

    it('returns false for missing key', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete('missing')).toBe(false);
    });

    it('delete moves access pattern correctly', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.delete('b'); // b removed
      cache.set('d', 4); // evicts 'a' (LRU)
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('has', () => {
    it('returns true for present key', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
    });

    it('returns false for missing key', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.has('missing')).toBe(false);
    });

    it('returns true after get moves key', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      expect(cache.has('a')).toBe(true);
    });
  });

  describe('size', () => {
    it('returns correct count', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
    });

    it('reflects evictions', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      expect(cache.size).toBe(2);
    });

    it('reflects deletions', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.delete('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('entries iteration (MRU order)', () => {
    it('yields entries from MRU to LRU', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // MRU order: c, b, a
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('reflects access order after get', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // 'a' becomes MRU
      const entries = [...cache.entries()];
      // MRU order: c, b, a  (a moved to front)
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('reflects access order after set', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 10); // 'a' becomes MRU
      const entries = [...cache.entries()];
      // MRU order: c, b, a
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 10],
      ]);
    });

    it('empty cache yields empty array', () => {
      const cache = new LRUCache<string, number>(2);
      expect([...cache.entries()]).toEqual([]);
    });

    it('reflects deletion in iteration', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.delete('b');
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ['c', 3],
        ['a', 1],
      ]);
    });

    it('reflects eviction in iteration', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      const entries = [...cache.entries()];
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
      ]);
    });
  });

  describe('capacity enforcement', () => {
    it('never exceeds capacity', () => {
      const cache = new LRUCache<string, number>(2);
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, i);
        expect(cache.size).toBeLessThanOrEqual(2);
      }
    });

    it('correctly maintains capacity with interleaved get/set', () => {
      const cache = new LRUCache<string, number>(3);
      for (let i = 0; i < 50; i++) {
        cache.set(`k${i}`, i);
        cache.get(`k${i}`);
        cache.get(`k${i + 1}`);
        expect(cache.size).toBeLessThanOrEqual(3);
      }
    });
  });
});
