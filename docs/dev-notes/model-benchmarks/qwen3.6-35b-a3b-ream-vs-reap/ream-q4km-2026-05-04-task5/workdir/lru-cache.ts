/** Doubly-linked list node for the LRU cache. */
class Node<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: Node<K, V> | null = null,
    public next: Node<K, V> | null = null,
  ) {}
}

/**
 * A generic LRU (Least Recently Used) cache with O(1) operations.
 *
 * entries() yields [key, value] pairs in MRU (most-recently-used) order —
 * most recent first, least recent last.
 */
export class LRUCache<K, V> {
  /** Sentinel head (newest) and tail (oldest) nodes. */
  private readonly head: Node<K, V>;
  private readonly tail: Node<K, V>;

  /** Key → node lookup. */
  private readonly map: Map<K, Node<K, V>>;

  /** Maximum number of entries the cache may hold. */
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error(`LRUCache capacity must be >= 1, got ${capacity}`);
    }
    this.capacity = capacity;

    // Circular sentinel links: head <-> tail
    this.head = new Node<K, V>(null as any, null as any);
    this.tail = new Node<K, V>(null as any, null as any);
    this.head.next = this.tail;
    this.tail.prev = this.head;

    this.map = new Map<K, Node<K, V>>();
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.map.size;
  }

  /* ── internal helpers ─────────────────────────────────────────────── */

  /** Unlink a node from the doubly-linked list. */
  private remove(node: Node<K, V>): void {
    const { prev, next } = node;
    if (prev) prev.next = next;
    if (next) next.prev = prev;
  }

  /** Insert a node immediately after head (most-recent position). */
  private addAtHead(node: Node<K, V>): void {
    const next = this.head.next;
    node.next = next;
    node.prev = this.head;
    this.head.next = node;
    next!.prev = node;
  }

  /** Evict the node just before the tail sentinel (least recent). */
  private evictLRU(): Node<K, V> | null {
    const lru = this.tail.prev;
    if (lru === this.head) return null; // empty
    this.remove(lru);
    this.map.delete(lru.key);
    return lru;
  }

  /** Move an existing node to the head (mark as recently used). */
  private moveToHead(node: Node<K, V>): void {
    this.remove(node);
    this.addAtHead(node);
  }

  /* ── public API ──────────────────────────────────────────────────── */

  /**
   * Get a value by key. Returns `undefined` if the key is absent.
   * Moves the accessed key to the most-recent position.
   */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }

  /**
   * Set a key-value pair.
   * - If the key already exists, updates the value and moves to MRU.
   * - If over capacity, evicts the LRU entry first.
   */
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
    const node = new Node(key, value);
    this.map.set(key, node);
    this.addAtHead(node);
  }

  /** Whether the cache contains the given key. */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Delete a key from the cache.
   * @returns `true` if the key existed and was removed.
   */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.remove(node);
    this.map.delete(key);
    return true;
  }

  /**
   * Return an iterator over [key, value] pairs in MRU order
   * (most recently used → least recently used).
   */
  *entries(): IterableIterator<[K, V]> {
    let current = this.head.next;
    while (current !== this.tail) {
      yield [current.key, current.value];
      current = current.next;
    }
  }
}
