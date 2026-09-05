<|think|>
The user wants a TypeScript implementation of an LRU (Least Recently Used) Cache with specific requirements:

1. Generic class with K (key) and V (value) type parameters
2. Constructor taking capacity number
3. Methods: get, set, has, delete, size getter, entries iterator
4. Must evict LRU when capacity exceeded
5. Write vitest tests covering various scenarios

Let me implement this step by step:

1. First, I'll create the LRU Cache class using a doubly-linked list for O(1) operations
2. Then write comprehensive tests
3. The implementation needs to handle:
   - Moving items to most-recently-used on get/set
   - Evicting least-recently-used when over capacity
   - All the required methods

For the implementation, I'll use:
- A Map for O(1) lookup
- A doubly-linked list (or similar structure) to track recency
- The Map's insertion order can be leveraged, or I can implement a custom doubly-linked list

Actually, the cleanest approach is:
- Use a Map<K, Node> where Node is a doubly-linked list node
- Maintain head (most recent) and tail (least recent) pointers
- On get/set, move the node to head
- On set when over capacity, remove tail and add new node

Let me write the code:
<|/think|>

```typescript
// lru-cache.ts

class Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

export class LRU<K, V> {
  private map: Map<K, Node<K, V>> = new Map();
  private head: Node<K, V> | null = null; // most recent
  private tail: Node<K, V> | null = null; // least recent
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Move to head (most recent)
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
      // Evict LRU (tail)
      const lru = this.tail;
      if (lru) {
        this.map.delete(lru.key);
        this.removeNode(lru);
        if (lru === this.tail) this.tail = lru.prev;
      }
    }

    const newNode = new Node(key, value);
    this.map.set(key, newNode);
    this.addHead(newNode);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.map.delete(key);
    this.removeNode(node);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  *entries(): IterableIterator<[K, V]> {
    let current = this.head;
    while (current) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  private addHead(node: Node<K, V>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: Node<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  private moveToHead(node: Node<K, V>): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addHead(node);
  }
}
```

```typescript
// lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRU } from './lru-cache';

describe('LRU Cache', () => {
  it('basic get/set', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('eviction order - evicts LRU', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a' (LRU)
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('update moves to most recent', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // 'a' now most recent
    cache.set('c', 3); // evicts 'b' (LRU)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(10);
    expect(cache.get('c')).toBe(3);
  });

  it('delete removes item', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('capacity enforcement - evicts correct LRU after updates', () => {
    const cache = new LRU<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // 'a' now most recent
    cache.set('d', 4); // evicts 'b' (now LRU)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('entries iteration in MRU order', () => {
    const cache = new LRU<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // 'a' now most recent
    const entries = [...cache.entries()];
    expect(entries).toEqual([
      ['a', 1],
      ['c', 3],
      ['b', 2],
    ]);
  });

  it('has returns correct values', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('size returns correct count', () => {
    const cache = new LRU<string, number>(3);
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });

  it('evicts LRU when capacity exceeded', () => {
    const cache = new LRU<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('get/has on empty cache', () => {
    const cache = new LRU<string, number>(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.has('a')).toBe(false);
  });
});
```
