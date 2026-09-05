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

export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, Node<K, V>>();
  private readonly head = new Node<K, V>(null as K, null as V);
  private readonly tail = new Node<K, V>(null as K, null as V);

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private moveToRecent(node: Node<K, V>): void {
    this.detach(node);
    this.attachBeforeTail(node);
  }

  private detach(node: Node<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
  }

  private attachBeforeTail(node: Node<K, V>): void {
    const beforeTail = this.tail.prev!;
    beforeTail.next = node;
    node.prev = beforeTail;
    node.next = this.tail;
    this.tail.prev = node;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToRecent(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToRecent(existing);
      return;
    }

    if (this.map.size >= this.capacity) {
      const lru = this.head.next!;
      this.detach(lru);
      this.map.delete(lru.key);
    }

    const newNode = new Node(key, value);
    this.attachBeforeTail(newNode);
    this.map.set(key, newNode);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.detach(node);
    this.map.delete(key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    const result: [K, V][] = [];
    let current = this.head.next;
    while (current && current !== this.tail) {
      result.push([current.key, current.value]);
      current = current.next;
    }
    // Return MRU order (most recent first)
    result.reverse();
    const iterator = result[Symbol.iterator]();
    return iterator as IterableIterator<[K, V]>;
  }
}
