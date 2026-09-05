import { LRUCache } from '../src/lru-cache';

describe('LRUCache', () => {
  describe('basic get/set', () => {
    test('set and get single item', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    test('get missing key returns undefined', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.get('x')).toBeUndefined();
    });

    test('set and get multiple items', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('eviction order', () => {
    test('evicts least recently used item when capacity exceeded', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      // Touch 'a' to make 'b' the least recently used
      cache.get('a');
      // 'b' should be evicted
      cache.set('c', 3);
      expect(cache.has('b')).toBe(false);
      expect(cache.get('c')).toBe(3);
    });

    test('eviction follows access order, not insertion order', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 'b' is now most recently used -> 'a' should be evicted next
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
    });
  });

  describe('update moves to recent', () => {
    test('updating value moves access to recent', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 'a' was least recently accessed -> 'c' is now most recent
      // Touch 'c' to push 'b' as evicted next
      cache.get('c');
      // Now 'b' should be evicted
      cache.set('d', 4);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    test('set with existing key updates value and moves to recent', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10);
      // 'a' was just updated, so 'b' should be evicted next
      cache.set('c', 3);
      expect(cache.has('b')).toBe(false);
      expect(cache.get('a')).toBe(10);
    });
  });

  describe('delete', () => {
    test('delete existing key returns true', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.has('a')).toBe(false);
    });

    test('delete missing key returns false', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete('x')).toBe(false);
    });

    test('delete evicts item immediately', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 'b' should be evicted
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
    });
  });

  describe('capacity enforcement', () => {
    test('capacity 0 allows no items', () => {
      const cache = new LRUCache<string, number>(0);
      cache.set('a', 1);
      expect(cache.size).toBe(0);
    });

    test('capacity 1 allows single item', () => {
      const cache = new LRUCache<string, number>(1);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
    });

    test('capacity 0 evicts immediately', () => {
      const cache = new LRUCache<string, number>(0);
      cache.set('a', 1);
      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
    });
  });

  describe('entries iteration', () => {
    test('entries in MRU order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // access 'a'
      cache.get('b'); // access 'b' (most recent)
      // Expected order: 'b', 'a', 'c'
      const entries = [];
      for (const [k, v] of cache.entries()) {
        entries.push([k, v]);
      }
      expect(entries).toEqual([
        ['b', 2],
        ['a', 1],
        ['c', 3],
      ]);
    });

    test('entries updates access order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);
      cache.set('f', 6);

      cache.get('a'); // touch 'a'
      cache.get('b'); // touch 'b'

      // Order: 'f', 'b', 'a', 'e', 'd'
      const entries = [];
      for (const [k, v] of cache.entries()) {
        entries.push([k, v]);
      }
      expect(entries).toEqual([
        ['f', 6],
        ['e', 5],
        ['b', 2],
        ['a', 1],
        ['d', 4],
      ]);
    });
  });
});
