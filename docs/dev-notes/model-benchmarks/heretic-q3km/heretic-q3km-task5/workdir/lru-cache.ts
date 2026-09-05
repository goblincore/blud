const HEAD = Symbol('lru-head');
const TAIL = Symbol('lru-tail');

type Node<K, V> = {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
};

export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map: Map<K, Node<K, V>>;
  private head: { key: typeof HEAD; value: never; prev: Node<K,V>|null; next: Node<K,V>|null };
  private tail: { key: typeof TAIL; value: never; prev: Node<K,V>|null; next: Node<K,V>|null };

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: HEAD, value: null as never, prev: null, next: null };
    this.tail = { key: TAIL, value: null as never, prev: null, next: null };
    this.head.prev = this.tail;
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.tail.next = this.head;
  }

  private addToFront(node: Node<K, V>): void {
    // Insert between head and head.next (i.e. right after MRU)
    const oldHeadNext = this.head!.next;
    this.head!.next = node;
    node.prev = this.head;
    node.next = oldHeadNext;
    oldHeadNext!.prev = node;
  }

  private removeNode(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToMRU(node: Node<K, V>): void {
    this.removeNode(node);
    this.addToFront(node);
  }

  private evictLRU(): void {
    // The node just before tail is the LRU
    const lru = this.tail!.prev!;
    if (lru === this.head) return; // Only sentinels left
    this.map.delete(lru.key);
    this.removeNode(lru);
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToMRU(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToMRU(existing);
      return;
    }
    const node: Node<K, V> = { key, value, prev: null, next: null };
    this.map.set(key, node);
    this.addToFront(node);
    if (this.map.size > this.capacity) {
      this.evictLRU();
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

  *entries(): IterableIterator<[K, V]> {
    // Start from MRU (right after head)
    let current = this.head!.next;
    while (current !== this.tail && current !== null) {
      yield [current.key, current.value];
      current = current.next;
    }
  }
}
