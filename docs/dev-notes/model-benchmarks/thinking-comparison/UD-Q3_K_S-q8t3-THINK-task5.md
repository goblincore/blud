<!-- reasoning_content (26101 chars) -->
Here's a thinking process:

1.  **Understand User Request:**
   - **Language:** TypeScript
   - **Class:** `LRUCache<K, V>`
   - **Constructor:** Takes `capacity: number`
   - **Methods:**
     - `get(key: K): V | undefined` (moves to most recent)
     - `set(key: K, value: V): void` (evicts LRU if over capacity)
     - `has(key: K): boolean`
     - `delete(key: K): boolean`
     - `get size(): number`
     - `entries(): IterableIterator<[K, V]>` (in MRU order)
   - **Constraint:** Must evict least-recently-used item when capacity exceeded
   - **Tests:** Vitest tests covering: basic get/set, eviction order, update moves to recent, delete, capacity enforcement, entries iteration order

2.  **Design the LRU Cache:**
   - Need a doubly linked list for O(1) get/set/delete and maintaining order.
   - Need a Map for O(1) key lookup.
   - Map will store `key -> Node` (or just `key -> { value, node }` but typically Map stores key -> value directly, and we maintain a separate linked list for order. Actually, standard approach: `Map<K, V>` stores the data, and a doubly linked list stores nodes in order. But to keep it simple and efficient, I'll use a `Map<K, Node>` where Node contains key, value, prev, next. Or better: `Map<K, V>` for storage, and a doubly linked list of keys/nodes for ordering. Wait, if I use `Map<K, V>`, I can't easily remove from the linked list without storing the node in the map. So I'll store `Map<K, Node>` where Node has `key`, `value`, `prev`, `next`.
   - Actually, TypeScript's `Map` preserves insertion order, but we need custom order. So custom doubly linked list is necessary.
   - Let's define a `Node` interface: `{ key: K; value: V; prev: Node | null; next: Node | null }`
   - Head and Tail sentinel nodes for the doubly linked list.
   - Map: `Map<K, Node>`
   - Operations:
     - `get(key)`: if exists, move to head (MRU), return value. Else undefined.
     - `set(key, value)`: if exists, update value and move to head. If not exists, if at capacity, remove tail.prev (LRU), then add new node to head.
     - `has(key)`: check map.
     - `delete(key)`: remove from map and linked list.
     - `size`: map.size
     - `entries()`: iterate from head to tail, yield `[node.key, node.value]` (MRU order)

3.  **Implement LRUCache:**
   ```typescript
   class LRUCache<K, V> {
     private capacity: number;
     private map: Map<K, Node<K, V>>;
     private head: Node<K, V>;
     private tail: Node<K, V>;
     private count: number;

     private constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.count = 0;
       this.head = { key: null as any, value: null as any, prev: null, next: null };
       this.tail = { key: null as any, value: null as any, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }

     constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.count = 0;
       this.head = { key: null as any, value: null as any, prev: null, next: null };
       this.tail = { key: null as any, value: null as any, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }
     // ...
   }
   ```
   Wait, TypeScript doesn't allow multiple constructors unless they have different signatures, but here it's just one. I'll combine them.
   Actually, I can just put the initialization in the constructor.

   Let's refine the Node type and methods:
   ```typescript
   interface Node<K, V> {
     key: K;
     value: V;
     prev: Node<K, V> | null;
     next: Node<K, V> | null;
   }

   class LRUCache<K, V> {
     private capacity: number;
     private map: Map<K, Node<K, V>>;
     private head: Node<K, V>;
     private tail: Node<K, V>;
     private size: number;

     constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.size = 0;

       this.head = { key: null as any, value: null as any, prev: null, next: null };
       this.tail = { key: null as any, value: null as any, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }

     private remove(node: Node<K, V>): void {
       const prev = node.prev!;
       const next = node.next!;
       prev.next = next;
       next.prev = prev;
     }

     private addToHead(node: Node<K, V>): void {
       node.next = this.head.next;
       node.prev = this.head;
       this.head.next!.prev = node;
       this.head.next = node;
     }

     get(key: K): V | undefined {
       const node = this.map.get(key);
       if (!node) return undefined;
       this.moveToFront(node);
       return node.value;
     }

     set(key: K, value: V): void {
       const node = this.map.get(key);
       if (node) {
         node.value = value;
         this.moveToFront(node);
         return;
       }

       if (this.size >= this.capacity) {
         this.evictLRU();
       }

       const newNode: Node<K, V> = { key, value, prev: null, next: null };
       this.map.set(key, newNode);
       this.addToHead(newNode);
       this.size++;
     }

     has(key: K): boolean {
       return this.map.has(key);
     }

     delete(key: K): boolean {
       const node = this.map.get(key);
       if (!node) return false;
       this.remove(node);
       this.map.delete(key);
       this.size--;
       return true;
     }

     get size(): number {
       return this.size;
     }

     entries(): IterableIterator<[K, V]> {
       let curr = this.head.next;
       const self = this;
       return {
         [Symbol.iterator]() {
           return this;
         },
         next(): IteratorResult<[K, V]> {
           if (!curr) return { done: true, value: undefined as any };
           const result = [curr.key, curr.value] as [K, V];
           curr = curr.next;
           return { done: false, value: result };
         }
       };
     }

     private moveToFront(node: Node<K, V>): void {
       if (node.prev === this.head) return; // already MRU
       this.remove(node);
       this.addToHead(node);
     }

     private evictLRU(): void {
       const lru = this.tail.prev!;
       this.remove(lru);
       this.map.delete(lru.key);
       this.size--;
     }
   }
   ```

   Wait, `entries()` returns `IterableIterator<[K, V]>`. The implementation above is correct. I should make sure it's strictly typed.
   Actually, `IterableIterator` can just be implemented by returning an iterator object, or using a generator function. Generators are cleaner:
   ```typescript
   *entries(): IterableIterator<[K, V]> {
     let curr = this.head.next;
     while (curr !== this.tail) {
       yield [curr.key, curr.value];
       curr = curr.next;
     }
   }
   ```
   This is much cleaner and automatically implements `IterableIterator`.

   Let's double check the `set` method capacity logic. The prompt says "evicts LRU if over capacity". Usually, LRU caches allow setting when `size === capacity` by evicting first. The prompt says "evicts LRU if over capacity". I'll interpret it as: if `this.size === this.capacity`, evict before adding. Or maybe `this.size >= this.capacity`. I'll stick with `if (this.size === this.capacity) this.evictLRU();` but wait, if capacity is 0? The prompt doesn't specify, but usually capacity > 0. I'll handle capacity <= 0 by just not storing anything, or assume capacity >= 1. I'll add a check or just let it work. Actually, standard LRU: if at capacity, evict. I'll use `if (this.size === this.capacity) this.evictLRU();` but wait, if capacity is 0, it should just do nothing. I'll add `if (this.capacity <= 0) return;` or just assume valid capacity. I'll stick to standard: `if (this.size >= this.capacity) this.evictLRU();` but actually, if I just added, size becomes `this.size + 1`, so I should check before incrementing. My code checks `this.size >= this.capacity` before adding, which is correct.

   Let's refine `set`:
   ```typescript
   set(key: K, value: V): void {
     if (this.capacity <= 0) return;
     const node = this.map.get(key);
     if (node) {
       node.value = value;
       this.moveToFront(node);
       return;
     }

     if (this.size === this.capacity) {
       this.evictLRU();
     }

     const newNode: Node<K, V> = { key, value, prev: null, next: null };
     this.map.set(key, newNode);
     this.addToHead(newNode);
     this.size++;
   }
   ```

   Check `get`:
   ```typescript
   get(key: K): V | undefined {
     const node = this.map.get(key);
     if (!node) return undefined;
     this.moveToFront(node);
     return node.value;
   }
   ```

   Check `delete`:
   ```typescript
   delete(key: K): boolean {
     const node = this.map.get(key);
     if (!node) return false;
     this.remove(node);
     this.map.delete(key);
     this.size--;
     return true;
   }
   ```

   Check `has`:
   ```typescript
   has(key: K): boolean {
     return this.map.has(key);
   }
   ```

   Check `size` getter:
   ```typescript
   get size(): number {
     return this.size;
   }
   ```
   Wait, property name clash: `private size: number` and `get size(): number`. I'll rename the private field to `count` to avoid conflict.

   ```typescript
   private count: number;
   // ...
   constructor(capacity: number) {
     // ...
     this.count = 0;
     // ...
   }
   // ...
   this.count++;
   this.count--;
   // ...
   get size(): number {
     return this.count;
   }
   ```

   Let's verify `entries()` order. "in MRU order" means most recently used first. Head is MRU, tail is LRU. So iterating from `head.next` to `tail` gives MRU to LRU order. Correct.

   One detail: `IterableIterator` return type for `entries()`. The generator returns `IterableIterator<[K, V]>` automatically. I'll keep it as a generator.

   Let's assemble the full class.

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
     private count: number;

     constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.count = 0;

       this.head = { key: null as any, value: null as any, prev: null, next: null };
       this.tail = { key: null as any, value: null as any, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }

     private remove(node: Node<K, V>): void {
       const prev = node.prev!;
       const next = node.next!;
       prev.next = next;
       next.prev = prev;
     }

     private addToHead(node: Node<K, V>): void {
       node.next = this.head.next;
       node.prev = this.head;
       this.head.next!.prev = node;
       this.head.next = node;
     }

     get(key: K): V | undefined {
       const node = this.map.get(key);
       if (!node) return undefined;
       this.moveToFront(node);
       return node.value;
     }

     set(key: K, value: V): void {
       if (this.capacity <= 0) return;
       const node = this.map.get(key);
       if (node) {
         node.value = value;
         this.moveToFront(node);
         return;
       }

       if (this.count === this.capacity) {
         this.evictLRU();
       }

       const newNode: Node<K, V> = { key, value, prev: null, next: null };
       this.map.set(key, newNode);
       this.addToHead(newNode);
       this.count++;
     }

     has(key: K): boolean {
       return this.map.has(key);
     }

     delete(key: K): boolean {
       const node = this.map.get(key);
       if (!node) return false;
       this.remove(node);
       this.map.delete(key);
       this.count--;
       return true;
     }

     get size(): number {
       return this.count;
     }

     *entries(): IterableIterator<[K, V]> {
       let curr = this.head.next;
       while (curr !== this.tail) {
         yield [curr.key, curr.value];
         curr = curr.next;
       }
     }

     private moveToFront(node: Node<K, V>): void {
       if (node.prev === this.head) return;
       this.remove(node);
       this.addToHead(node);
     }

     private evictLRU(): void {
       const lru = this.tail.prev!;
       this.remove(lru);
       this.map.delete(lru.key);
       this.count--;
     }
   }
   ```

   Wait, `IterableIterator` is a built-in type. I don't need to export it, but the class should be exportable. I'll assume it's in a single file or module. The prompt says "Write a TypeScript generic LRUCache<K,V> class." I'll just provide the class.

   Now, Vitest tests.
   Requirements:
   - basic get/set
   - eviction order
   - update moves to recent
   - delete
   - capacity enforcement
   - entries iteration order

   I'll write tests using `vitest`.
   Structure:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { LRUCache } from './lru-cache'; // assume path

   describe('LRUCache', () => {
     it('basic get/set', () => { ... });
     it('eviction order', () => { ... });
     it('update moves to recent', () => { ... });
     it('delete', () => { ... });
     it('capacity enforcement', () => { ... });
     it('entries iteration order', () => { ... });
   });
   ```

   Let's draft the tests carefully.

   ```typescript
   import { describe, it, expect } from 'vitest';
   import { LRUCache } from './lru-cache'; // adjust if needed

   describe('LRUCache', () => {
     it('basic get/set', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       expect(cache.get('a')).toBe(1);
       cache.set('b', 2);
       expect(cache.get('b')).toBe(2);
     });

     it('eviction order', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('c', 3); // evicts 'a'
       expect(cache.get('a')).toBeUndefined();
       expect(cache.get('b')).toBe(2);
       expect(cache.get('c')).toBe(3);
     });

     it('update moves to recent', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('a', 10); // update a, moves to MRU
       cache.set('c', 3); // evicts 'b', not 'a'
       expect(cache.get('a')).toBe(10);
       expect(cache.get('b')).toBeUndefined();
       expect(cache.get('c')).toBe(3);
     });

     it('delete', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       expect(cache.delete('a')).toBe(true);
       expect(cache.get('a')).toBeUndefined();
       expect(cache.size).toBe(1);
       expect(cache.delete('a')).toBe(false);
     });

     it('capacity enforcement', () => {
       const cache = new LRUCache<string, number>(1);
       cache.set('a', 1);
       expect(cache.size).toBe(1);
       cache.set('b', 2);
       expect(cache.size).toBe(1);
       expect(cache.get('a')).toBeUndefined();
       expect(cache.get('b')).toBe(2);
     });

     it('entries iteration order', () => {
       const cache = new LRUCache<string, number>(3);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('c', 3);
       // MRU order: c, b, a
       const entries = Array.from(cache.entries());
       expect(entries).toEqual([['c', 3], ['b', 2], ['a', 1]]);

       cache.set('a', 10); // a moves to MRU
       const entries2 = Array.from(cache.entries());
       expect(entries2).toEqual([['a', 10], ['c', 3], ['b', 2]]);
     });
   });
   ```

   Check edge cases:
   - `capacity` 0: handled by `if (this.capacity <= 0) return;`
   - `get` on non-existent: returns undefined, doesn't throw.
   - `set` updates value and moves to front: handled.
   - `delete` returns boolean: handled.
   - `size` getter: handled.
   - `entries` order: MRU first. Handled.

   One minor thing: `IterableIterator` is a TypeScript built-in. The generator syntax `*entries(): IterableIterator<[K, V]>` is correct.
   I should make sure the class is exported properly.
   I'll combine everything into a single response.

   Let's verify the `set` method capacity logic again.
   If capacity is 2, and we have 2 items. `set('c', 3)` -> `this.count === this.capacity` (2 === 2) -> evicts LRU -> `this.count` becomes 1 -> adds new -> `this.count` becomes 2. Correct.
   What if capacity is 0? `if (this.capacity <= 0) return;` prevents adding. Correct.
   What if `get` is called on a key that exists? It moves to front and returns value. Correct.
   What if `set` is called on an existing key? It updates value and moves to front. Correct.
   What if `delete` is called on non-existent? Returns false. Correct.

   One detail: `entries()` returns `IterableIterator<[K, V]>`. The generator automatically implements this interface. TypeScript knows this.
   I'll add `export` to the class.
   I'll also make sure the Node interface is inside or outside. I'll put it inside or just inline the type. Actually, I can just use a local interface or inline the type definition. I'll keep it simple.

   Let's write out the full code.

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
     private count: number;

     constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.count = 0;

       this.head = { key: null as any, value: null as any, prev: null, next: null };
       this.tail = { key: null as any, value: null as any, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }

     private remove(node: Node<K, V>): void {
       const prev = node.prev!;
       const next = node.next!;
       prev.next = next;
       next.prev = prev;
     }

     private addToHead(node: Node<K, V>): void {
       node.next = this.head.next;
       node.prev = this.head;
       this.head.next!.prev = node;
       this.head.next = node;
     }

     get(key: K): V | undefined {
       const node = this.map.get(key);
       if (!node) return undefined;
       this.moveToFront(node);
       return node.value;
     }

     set(key: K, value: V): void {
       if (this.capacity <= 0) return;
       const node = this.map.get(key);
       if (node) {
         node.value = value;
         this.moveToFront(node);
         return;
       }

       if (this.count === this.capacity) {
         this.evictLRU();
       }

       const newNode: Node<K, V> = { key, value, prev: null, next: null };
       this.map.set(key, newNode);
       this.addToHead(newNode);
       this.count++;
     }

     has(key: K): boolean {
       return this.map.has(key);
     }

     delete(key: K): boolean {
       const node = this.map.get(key);
       if (!node) return false;
       this.remove(node);
       this.map.delete(key);
       this.count--;
       return true;
     }

     get size(): number {
       return this.count;
     }

     *entries(): IterableIterator<[K, V]> {
       let curr = this.head.next;
       while (curr !== this.tail) {
         yield [curr.key, curr.value];
         curr = curr.next;
       }
     }

     private moveToFront(node: Node<K, V>): void {
       if (node.prev === this.head) return;
       this.remove(node);
       this.addToHead(node);
     }

     private evictLRU(): void {
       const lru = this.tail.prev!;
       this.remove(lru);
       this.map.delete(lru.key);
       this.count--;
     }
   }
   ```

   Tests:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { LRUCache } from './lru-cache';

   describe('LRUCache', () => {
     it('basic get/set', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       expect(cache.get('a')).toBe(1);
       cache.set('b', 2);
       expect(cache.get('b')).toBe(2);
     });

     it('eviction order', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('c', 3);
       expect(cache.get('a')).toBeUndefined();
       expect(cache.get('b')).toBe(2);
       expect(cache.get('c')).toBe(3);
     });

     it('update moves to recent', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('a', 10);
       cache.set('c', 3);
       expect(cache.get('a')).toBe(10);
       expect(cache.get('b')).toBeUndefined();
       expect(cache.get('c')).toBe(3);
     });

     it('delete', () => {
       const cache = new LRUCache<string, number>(2);
       cache.set('a', 1);
       cache.set('b', 2);
       expect(cache.delete('a')).toBe(true);
       expect(cache.get('a')).toBeUndefined();
       expect(cache.size).toBe(1);
       expect(cache.delete('a')).toBe(false);
     });

     it('capacity enforcement', () => {
       const cache = new LRUCache<string, number>(1);
       cache.set('a', 1);
       expect(cache.size).toBe(1);
       cache.set('b', 2);
       expect(cache.size).toBe(1);
       expect(cache.get('a')).toBeUndefined();
       expect(cache.get('b')).toBe(2);
     });

     it('entries iteration order', () => {
       const cache = new LRUCache<string, number>(3);
       cache.set('a', 1);
       cache.set('b', 2);
       cache.set('c', 3);
       expect(Array.from(cache.entries())).toEqual([['c', 3], ['b', 2], ['a', 1]]);

       cache.set('a', 10);
       expect(Array.from(cache.entries())).toEqual([['a', 10], ['c', 3], ['b', 2]]);
     });
   });
   ```

   Check TypeScript strictness: `null as any` for head/tail initial keys/values is fine, but I can avoid `any` by using `null` or just typing them as `Node<K,V> | null` initially. Actually, I can just use `null` for `prev` and `next` in the sentinel nodes, and type them appropriately. But TypeScript's strict null checks might complain. I'll use `null` and type the properties as `Node<K, V> | null`.
   Let's adjust the Node interface and initialization to be strictly null-safe:
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
     private count: number;

     constructor(capacity: number) {
       this.capacity = capacity;
       this.map = new Map();
       this.count = 0;

       this.head = { key: null as unknown as K, value: null as unknown as V, prev: null, next: null };
       this.tail = { key: null as unknown as K, value: null as unknown as V, prev: null, next: null };
       this.head.next = this.tail;
       this.tail.prev = this.head;
     }
     // ...
   }
   ```
   Actually, `null as unknown as K` is a common TS workaround for sentinel nodes. Or I can just use `undefined` or a dummy value. It's fine.

   One thing: `entries()` returns `IterableIterator<[K, V]>`. The generator syntax is correct.
   I'll verify `get` and `set` signatures match the prompt exactly: `get(key: K): V | undefined`, `set(key: K, value: V): void`. Yes.
   `has(key: K): boolean` - yes.
   `delete(key: K): boolean` - yes.
   `get size(): number` - yes.
   `entries(): IterableIterator<[K, V]>` - yes.

   All constraints met.
   I will produce the final code block with both the implementation and the tests. I'll put them in separate blocks or combined as requested. The prompt says "Write a TypeScript generic LRUCache<K,V> class... Write vitest tests covering...". I'll provide both.

   One minor improvement: `IterableIterator` is built-in, so no import needed. `vitest` imports are standard.
   I'll make sure the code is clean and ready to use.

   Final check of the logic:
   - `get` moves to MRU: yes, `moveToFront` removes and adds to head.
   - `set` evicts LRU if over capacity: yes, checks `count === capacity` before adding.
   - `has`: yes.
   - `delete`: yes.
   - `size`: yes.
   - `entries`: yields from head.next to tail, which is MRU to LRU order. Prompt says "in MRU order", so first yielded should be MRU. Yes.
   - Tests cover all requested scenarios.

   Everything looks solid. I'll output the code. 
   I'll structure it as two blocks: implementation and tests. Or one combined file. I'll keep them separate for clarity.
   I'll add comments if necessary, but the prompt says "No explanations unless asked." So I'll just output the code.
   Ready. 
   Output matches the response. 
   One detail: `IterableIterator` might need to be imported? No, it's a global TypeScript type.
   All good. 
   Proceeds. 
   [Output Generation] -> *Self-Correction/Refinement during thought*: 
   Wait, `entries()` in the prompt says `entries(): IterableIterator<[K,V]>`. My generator returns exactly that. 
   The `set` method: "evicts LRU if over capacity". My code evicts when `count === capacity`. This is standard. 
   I'll make sure the types are precise. 
   I'll output exactly what's needed. 
   Code is ready. 
   Proceeds. 
   [Output Generation] -> *Output Generation* (matches the final response)
   ```typescript
   // Implementation
   ...
   // Tests
   ...
   ```
   All set. 
   Output matches response. 
   [Done] 
   *Self-Correction/Verification during generation prep*:
   I should verify that `IterableIterator` doesn't require import. It's a built-in TypeScript interface. Correct.
   The `Node` interface can be placed inside the file or just defined. I'll keep it at the top.
   I'll ensure the code is strictly TypeScript compliant.
   One thing: `null as unknown as K` is fine, but I can also use `null!` or just type the class properties as `Node<K, V> | null` initially, but the prompt says constructor takes capacity, so I'll stick to the sentinel approach. It's standard.
   I'll produce the final answer. 
   All good. 
   [Output Generation] -> *Proceeds*

<!-- content (4177 chars) -->
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
  private count: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.count = 0;

    this.head = { key: null as unknown as K, value: null as unknown as V, prev: null, next: null };
    this.tail = { key: null as unknown as K, value: null as unknown as V, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private remove(node: Node<K, V>): void {
    const prev = node.prev!;
    const next = node.next!;
    prev.next = next;
    next.prev = prev;
  }

  private addToHead(node: Node<K, V>): void {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  set(key: K, value: V): void {
    if (this.capacity <= 0) return;
    const node = this.map.get(key);
    if (node) {
      node.value = value;
      this.moveToFront(node);
      return;
    }

    if (this.count === this.capacity) {
      this.evictLRU();
    }

    const newNode: Node<K, V> = { key, value, prev: null, next: null };
    this.map.set(key, newNode);
    this.addToHead(newNode);
    this.count++;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.remove(node);
    this.map.delete(key);
    this.count--;
    return true;
  }

  get size(): number {
    return this.count;
  }

  *entries(): IterableIterator<[K, V]> {
    let curr = this.head.next;
    while (curr !== this.tail) {
      yield [curr.key, curr.value];
      curr = curr.next;
    }
  }

  private moveToFront(node: Node<K, V>): void {
    if (node.prev === this.head) return;
    this.remove(node);
    this.addToHead(node);
  }

  private evictLRU(): void {
    const lru = this.tail.prev!;
    this.remove(lru);
    this.map.delete(lru.key);
    this.count--;
  }
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('basic get/set', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    cache.set('b', 2);
    expect(cache.get('b')).toBe(2);
  });

  it('eviction order', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('update moves to recent', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('delete', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.delete('a')).toBe(false);
  });

  it('capacity enforcement', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('entries iteration order', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(Array.from(cache.entries())).toEqual([['c', 3], ['b', 2], ['a', 1]]);

    cache.set('a', 10);
    expect(Array.from(cache.entries())).toEqual([['a', 10], ['c', 3], ['b', 2]]);
  });
});
```
