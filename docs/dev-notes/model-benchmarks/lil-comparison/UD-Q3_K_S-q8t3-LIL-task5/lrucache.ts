class Node<K, V> {
  public key!: K;
  public value!: V;
  public prev: Node<K, V> | null = null;
  public next: Node<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

export class LRUCache<K, V> {
  private capacity: number;
  private _count: number;
  private map: Map<K, Node<K, V>>;
  private head: Node<K, V>; // most recent sentinel
  private tail: Node<K, V>; // least recent sentinel

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("Capacity must be positive");
    this.capacity = capacity;
    this._count = 0;
    this.map = new Map();

    // Circular sentinel-linked list: head ↔ … ↔ tail
    this.head = new Node<K, V>(undefined as any, undefined as any);
    this.tail = new Node<K, V>(undefined as any, undefined as any);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private detach(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
    node.prev = null;
    node.next = null;
  }

  private pushFront(node: Node<K, V>): void {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  /** Move an existing node to the most-recent position. */
  private makeMostRecent(node: Node<K, V>): void {
    this.detach(node);
    this.pushFront(node);
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    this.makeMostRecent(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.makeMostRecent(existing);
      return;
    }

    if (this._count === this.capacity) {
      // Evict LRU (node right before tail)
      const lru = this.tail.prev!;
      this.detach(lru);
      this.map.delete(lru.key);
      this._count--;
    }

    const node = new Node(key, value);
    this.map.set(key, node);
    this.pushFront(node);
    this._count++;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.detach(node);
    this.map.delete(key);
    this._count--;
    return true;
  }

  get size(): number {
    return this._count;
  }

  /** Yield [key, value] pairs from MRU → LRU. */
  *entries(): IterableIterator<[K, V]> {
    let cur = this.head.next;
    while (cur !== this.tail) {
      yield [cur.key, cur.value];
      cur = cur.next;
    }
  }
}
