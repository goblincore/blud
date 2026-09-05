import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  describe('basic get/set', () => {
    it('should store and retrieve a value', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>(2);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should overwrite an existing key', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
    });
  });

  describe('eviction order', () => {
    it('should evict the least recently used item when capacity is exceeded', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      // Cache is now full: [a, b] (b is MRU)
      
      cache.set('c', 3);
      // Evicts 'a' (LRU), cache is now [b, c]
      
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('should evict the correct LRU when items have been accessed', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Cache: [a, b, c]
      
      // Access 'a', making it MRU: [b, c, a]
      cache.get('a');
      
      // Add 'd', evicts 'b' (now the LRU)
      cache.set('d', 4);
      
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('update moves to recent', () => {
    it('set on existing key moves it to MRU without evicting a different item', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      // Cache: [a, b], b is MRU
      
      // Update 'a', moving it to MRU: [b, a]
      cache.set('a', 10);
      
      // Add 'c', evicts 'b' (now LRU), not 'a'
      cache.set('c', 3);
      
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });

    it('get on existing key moves it to MRU', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Cache: [a, b, c]
      
      // Access 'a' making it MRU: [b, c, a]
      cache.get('a');
      
      // Add 'd', evicts 'b'
      cache.set('d', 4);
      
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
    });
  });

  describe('delete', () => {
    it('should delete an existing key and return true', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should return false for non-existent keys', () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should free space for new items after deletion', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.delete('a');
      // Now only 'b' remains, capacity available
      
      cache.set('c', 3);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('capacity enforcement', () => {
    it('should never exceed capacity', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);
      
      // a→[a], b→[a,b], c→evict a→[b,c], d→evict b→[c,d], e→evict c→[d,e]
      expect(cache.size).toBe(2);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(false);
      expect(cache.has('d')).toBe(true);
      expect(cache.has('e')).toBe(true);
    });

    it('should enforce capacity with mixed operations', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.delete('a');
      cache.set('c', 3);
      cache.set('d', 4);
      
      expect(cache.size).toBe(2);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('entries iteration order', () => {
    it('should return entries in MRU (most recently used) order', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      const entries = Array.from(cache.entries());
      // MRU order: c (most recent), b, a (least recent)
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('should reflect updated access order in entries', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Access 'a', making it MRU
      cache.get('a');
      
      const entries = Array.from(cache.entries());
      // MRU order: a (most recent), c, b (least recent)
      expect(entries).toEqual([
        ['a', 1],
        ['c', 3],
        ['b', 2],
      ]);
    });

    it('should return empty array for empty cache', () => {
      const cache = new LRUCache<string, number>(2);
      expect(Array.from(cache.entries())).toEqual([]);
    });

    it('should reflect eviction in entries', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Evicts 'a', cache is [b, c]
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
      ]);
    });
  });
});
