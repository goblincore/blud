/** Doubly-linked list node for O(1) insert/remove */
class Node<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: Node<K, V> | null = null,
    public next: Node<K, V> | null = null,
  ) {}
}

export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, Node<K, V>>();

  // Dummy sentinel nodes — head is MRU, tail is LRU
  private readonly head = new Node<K, V>(null! as K, null! as V);
  private readonly tail = new Node<K, V>(null! as K, null! as V);

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be >= 1");
    }
    this.capacity = capacity;
    // Link sentinels
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /* ---- public API ---- */

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this._moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this._moveToHead(existing);
      return;
    }
    const node = new Node(key, value);
    this._addNode(node);
    this.map.set(key, node);
    if (this.map.size > this.capacity) {
      const evicted = this._removeTail();
      this.map.delete(evicted.key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this._removeNode(node);
    this.map.delete(key);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  *entries(): IterableIterator<[K, V]> {
    // MRU → LRU (head → tail, skipping sentinels)
    for (let node = this.head.next; node !== this.tail; node = node.next!) {
      yield [node.key, node.value];
    }
  }

  /* ---- internal helpers ---- */

  private _addNode(node: Node<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private _removeNode(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private _removeTail(): Node<K, V> {
    const removed = this.tail.prev!;
    this._removeNode(removed);
    return removed;
  }

  /** Move an existing node right next to head (mark as MRU). */
  private _moveToHead(node: Node<K, V>): void {
    this._removeNode(node);
    this._addNode(node);
  }
}
