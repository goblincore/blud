```typescript
// lru-cache.ts

class Node<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: Node<K, V> | null = null,
    public next: Node<K, V> | null = null
  ) {}
}

export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, Node<K, V>>();
  private head: Node<K, V>; // Most recently used
  private tail: Node<K, V>; // Least recently used

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than 0");
    }
    this.capacity = capacity;
    
    // Dummy head and tail nodes
    this.head = new Node<K, V>(null as any, null as any);
    this.tail = new Node<K, V>(null as any, null as any);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private removeFromNode(node: Node<K, V>): void {
    const prev = node.prev!;
    const next = node.next!;
    prev.next = next;
    next.prev = prev;
  }

  private addToHead(node: Node<K, V>): void {
    const next = this.head.next!;
    this.head.next = node;
    node.prev = this.head;
    node.next = next;
    next.prev = node;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      return undefined;
    }
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    if (this.map.size >= this.capacity) {
      this.evictLRU();
    }

    const newNode = new Node(key, value);
    this.addToHead(newNode);
    this.map.set(key, newNode);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }
    this.removeFromNode(node);
    this.map.delete(key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  *entries(): IterableIterator<[K, V]> {
    let current = this.head.next;
    while (current !== this.tail) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  private moveToHead(node: Node<K, V>): void {
    this.removeFromNode(node);
    this.addToHead(node);
  }

  private evictLRU(): void {
    const lruNode = this.tail.prev!;
    this.removeFromNode(lruNode);
    this.map.delete(lruNode.key);
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('should handle basic get/set', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(undefined);
  });

  it('should evict least recently used item when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    // Cache is full: a (LRU), b (MRU)
    cache.set('c', 3);
    
    // 'a' should be evicted
    expect(cache.get('a')).toBe(undefined);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('should move accessed item to most recent on get', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    // Access 'a', making it MRU. 'b' becomes LRU.
    cache.get('a');
    
    // Add 'c', should evict 'b'
    cache.set('c', 3);
    
    expect(cache.get('b')).toBe(undefined);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('should update value and move to most recent on set existing key', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    // Update 'a', making it MRU. 'b' becomes LRU.
    cache.set('a', 10);
    
    // Add 'c', should evict 'b'
    cache.set('c', 3);
    
    expect(cache.get('b')).toBe(undefined);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('c')).toBe(3);
  });

  it('should support delete', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBe(undefined);
    expect(cache.size).toBe(1);
    
    // Deleting non-existent key
    expect(cache.delete('a')).toBe(false);
  });

  it('should enforce capacity', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    
    cache.delete('a');
    expect(cache.size).toBe(1);
    
    cache.set('d', 4);
    expect(cache.size).toBe(2);
  });

  it('should iterate entries in MRU order', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    // Order: c (MRU), b, a (LRU)
    const entries = Array.from(cache.entries());
    expect(entries).toEqual([
      ['c', 3],
      ['b', 2],
      ['a', 1]
    ]);
  });

  it('should update iteration order on get/set', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    // Access 'a', making it MRU. Order: a, c, b
    cache.get('a');
    
    let entries = Array.from(cache.entries());
    expect(entries).toEqual([
      ['a', 1],
      ['c', 3],
      ['b', 2]
    ]);
    
    // Update 'c', making it MRU. Order: c, a, b
    cache.set('c', 30);
    
    entries = Array.from(cache.entries());
    expect(entries).toEqual([
      ['c', 30],
      ['a', 1],
      ['b', 2]
    ]);
  });
});
```
