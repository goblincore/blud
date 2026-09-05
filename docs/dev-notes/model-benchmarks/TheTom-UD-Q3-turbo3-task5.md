The user wants a TypeScript generic `LRUCache<K, V>` class with specific methods and a `capacity` constructor argument.
I need to implement:
- `constructor(capacity: number)`
- `get(key: K): V | undefined` (moves to most recent)
- `set(key: K, value: V): void` (evicts LRU if over capacity)
- `has(key: K): boolean`
- `delete(key: K): boolean`
- `get size(): number`
- `entries(): IterableIterator<[K, V]>` in MRU order

And write `vitest` tests covering:
- basic get/set
- eviction order
- update moves to recent
- delete
- capacity enforcement
- entries iteration order

I'll use a doubly linked list for O(1) operations and a `Map` for O(1) lookups.
The `entries()` method should return items in MRU order (most recently used first).

Let's define the node structure:
```typescript
interface Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}
```

Helper methods for the linked list:
- `addToHead(node)`
- `removeNode(node)`
- `moveToHead(node)`
- `removeTail()` -> returns node or null

The `Map` will store `key -> Node<K, V>`.

`get(key)`:
- If key exists, move node to head, return value.
- Else return undefined.

`set(key, value)`:
- If key exists, update value, move to head.
- Else create new node, add to head, add to map.
- If size > capacity, remove tail node from map and list.

`has(key)`:
- Check map.

`delete(key)`:
- If key exists, remove node from list and map, return true.
- Else return false.

`get size()`:
- Return map size.

`entries()`:
- Iterate from head to tail, yielding `[key, value]`. This is MRU order.

Now, the tests.
I'll write a complete file with the class and tests.
Since the user asked for vitest tests, I'll assume the test runner is configured for vitest.
I'll structure the code clearly.

Let's draft the class:

```typescript
export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V>;
  private tail: Node<K, V>;

  private constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: null as any, value: null as any, prev: null, next: null };
    this.tail = { key: null as any, value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  constructor(capacity: number) {
    // Can't have two constructors. I'll put the logic in one.
  }
}
```

Actually, I can just put the initialization in the constructor.

```typescript
export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V>;
  private tail: Node<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: null as any, value: null as any, prev: null, next: null };
    this.tail = { key: null as any, value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }
  // ... methods
}
```

Wait, `Node` interface should be defined. I'll define it outside or inside. Outside is fine.

Let's refine the methods:

```typescript
  private addToHead(node: Node<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private removeNode(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: Node<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): Node<K, V> | null {
    const node = this.tail.prev;
    if (node && node !== this.head) {
      this.removeNode(node);
      return node;
    }
    return null;
  }
```

`get(key)`:
```typescript
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }
```

`set(key, value)`:
```typescript
  set(key: K, value: V): void {
    let node = this.map.get(key);
    if (node) {
      node.value = value;
      this.moveToHead(node);
      return;
    }
    const newNode = { key, value, prev: null, next: null };
    this.map.set(key, newNode);
    this.addToHead(newNode);
    if (this.map.size > this.capacity) {
      const tail = this.removeTail();
      if (tail) this.map.delete(tail.key);
    }
  }
```

`has(key)`:
```typescript
  has(key: K): boolean {
    return this.map.has(key);
  }
```

`delete(key)`:
```typescript
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }
```

`get size()`:
```typescript
  get size(): number {
    return this.map.size;
  }
```

`entries()`:
```typescript
  entries(): IterableIterator<[K, V]> {
    const self = this;
    return {
      [Symbol.iterator]() {
        let current = self.head.next;
        return {
          next() {
            if (current === null) {
              return { done: true, value: undefined };
            }
            const value = [current.key, current.value];
            current = current.next;
            return { done: false, value };
          }
        };
      }
    };
  }
```

Wait, `IterableIterator` return type for `next()` should be `IteratorResult<[K, V]>`.
`value: undefined` should be `value: undefined` but type is `[K, V]`. Actually, `IteratorResult` is `{ done: false; value: V } | { done: true; value?: undefined }`.
So `value: undefined` is fine when `done: true`.

Let's check types.
`next(): IteratorResult<[K, V]>`
If `done: true`, `value` is optional. So `value: undefined` is fine.

Now, tests.
I'll use `vitest` syntax.
```typescript
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache'; // assuming path

describe('LRUCache', () => {
  it('basic get/set', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    expect(cache.get(1)).toBe('a');
    expect(cache.get(2)).toBe('b');
    expect(cache.get(3)).toBeUndefined();
  });

  it('eviction order', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c'); // evicts 1
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe('b');
    expect(cache.get(3)).toBe('c');
  });

  it('update moves to recent', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(1, 'a-updated'); // moves 1 to MRU
    cache.set(3, 'c'); // evicts 2
    expect(cache.get(1)).toBe('a-updated');
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBe('c');
  });

  it('delete', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    expect(cache.delete(1)).toBe(true);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.delete(1)).toBe(false);
    cache.set(3, 'c'); // evicts 2
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBe('c');
  });

  it('capacity enforcement', () => {
    const cache = new LRUCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    expect(cache.size).toBe(2);
    cache.set(4, 'd');
    expect(cache.size).toBe(2);
  });

  it('entries iteration order', () => {
    const cache = new LRUCache<number, string>(3);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    const entries = Array.from(cache.entries());
    expect(entries).toEqual([[3, 'c'], [2, 'b'], [1, 'a']]); // MRU order
  });
});
```

Wait, `entries()` returns MRU order.
If I set 1, 2, 3. List: Head <-> 1 <-> 2 <-> 3 <-> Tail.
MRU is 3. So iteration from head.next gives 1, 2, 3?
Wait, my `addToHead` adds to the front.
So after `set(1)`, list: H <-> 1 <-> T
After `set(2)`, list: H <-> 2 <-> 1 <-> T
After `set(3)`, list: H <-> 3 <-> 2 <-> 1 <-> T
Iteration from `head.next` gives 3, 2, 1. That's MRU order. Correct.

Let's double check `set` logic.
```typescript
    const newNode = { key, value, prev: null, next: null };
    this.map.set(key, newNode);
    this.addToHead(newNode);
```
Yes, `addToHead` puts it right after `head`. So `head.next` is the MRU.
Iteration goes `head.next` -> ... -> `tail.prev`. So it yields MRU to LRU. Correct.

One minor thing: `entries()` return type `IterableIterator<[K, V]>`.
The `next` method's `value` type when `done: true` is `undefined` by default in TS, but to be strictly correct:
```typescript
            next() {
              if (current === null) {
                return { done: true, value: undefined as any };
              }
              // ...
```
Actually, `IteratorResult<T>` is `{ done: false; value: T } | { done: true; value?: undefined }`.
So `value: undefined` is fine.

Let's assemble the full code.
I'll put the class and tests in one block, or separate them clearly. The prompt says "Write a TypeScript generic LRUCache... Write vitest tests...". I'll provide a single file with both, or clearly separated. I'll use a single file structure for simplicity, or export the class and then tests. I'll just write the class first, then the tests.

Wait, `Node` type should be defined.
```typescript
interface Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}
```

I'll combine everything into a clean, ready-to-use file.

Check `get` method: moves to most recent. Correct.
Check `set` method: evicts LRU if over capacity. Correct.
Check `has`: boolean. Correct.
Check `delete`: boolean. Correct.
Check `size`: getter. Correct.
Check `entries`: IterableIterator in MRU order. Correct.

One detail: `set` capacity enforcement.
If `this.map.size > this.capacity`, evict.
What if `capacity` is 0? The prompt says "capacity number", usually >0. I'll assume valid capacity. If capacity is 0, it will immediately evict. That's fine.

Let's verify `entries()` type signature.
`entries(): IterableIterator<[K, V]>`
Implementation:
```typescript
  entries(): IterableIterator<[K, V]> {
    let current = this.head.next;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        if (current === null) {
          return { done: true, value: undefined as any };
        }
        const value = [current.key, current.value];
        current = current.next;
        return { done: false, value };
      }
    };
  }
```
This is cleaner.

Wait, `current` needs to be captured correctly.
```typescript
  entries(): IterableIterator<[K, V]> {
    let current = this.head.next;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        if (current === null) {
          return { done: true, value: undefined as any };
        }
        const value = [current.key, current.value];
        current = current.next;
        return { done: false, value };
      }
    };
  }
```
This works.

Let's put it all together.

```typescript
interface Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V>;
  private tail: Node<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: null as any, value: null as any, prev: null, next: null };
    this.tail = { key: null as any, value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private addToHead(node: Node<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private removeNode(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: Node<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): Node<K, V> | null {
    const node = this.tail.prev;
    if (node && node !== this.head) {
      this.removeNode(node);
      return node;
    }
    return null;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    let node = this.map.get(key);
    if (node) {
      node.value = value;
      this.moveToHead(node);
      return;
    }
    const newNode = { key, value, prev: null, next: null };
    this.map.set(key, newNode);
    this.addToHead(newNode);
    if (this.map.size > this.capacity) {
      const tail = this.removeTail();
      if (tail) this.map.delete(tail.key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    let current = this.head.next;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        if