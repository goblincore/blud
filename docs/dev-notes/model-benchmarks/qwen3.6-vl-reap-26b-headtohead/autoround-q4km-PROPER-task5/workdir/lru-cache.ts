class Node<K, V> {
  public key: K;
  public value: V;
  public prev: Node<K, V> | null = null;
  public next: Node<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

export class LRUCache<K, V> {
  private head: Node<K, V> | null;  // most recent
  private tail: Node<K, V> | null;  // least recent
  private capacity: number;
  private size: number;
  private nodeMap: Map<K, Node<K, V>>;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    this.capacity = capacity;
    this.size = 0;
    this.head = null;
    this.tail = null;
    this.nodeMap = new Map();
  }

  /**
   * Get a value by key. Returns undefined if not found.
   * Moves the accessed node to the most-recent position.
   */
  get(key: K): V | undefined {
    const node = this.nodeMap.get(key);
    if (!node) return undefined;

    this.moveToHead(node);
    return node.value;
  }

  /**
   * Set a key-value pair. Evicts the LRU item if over capacity.
   * The new/updated item becomes the most-recently used.
   */
  set(key: K, value: V): void {
    const existing = this.nodeMap.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    const newNode = new Node(key, value);

    if (this.size >= this.capacity) {
      // Evict the LRU (tail)
      this.evictTail();
    }

    this.addNode(newNode);
    this.nodeMap.set(key, newNode);
    this.size++;
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: K): boolean {
    return this.nodeMap.has(key);
  }

  /**
   * Delete a key from the cache.
   * @returns true if the key was found and removed, false otherwise.
   */
  delete(key: K): boolean {
    const node = this.nodeMap.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.nodeMap.delete(key);
    this.size--;
    return true;
  }

  /**
   * Number of items currently in the cache.
   */
  get size(): number {
    return this.size;
  }

  /**
   * Get entries in most-recently-used to least-recently-used order.
   */
  *entries(): IterableIterator<[K, V]> {
    let current = this.head;
    while (current) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  // ---- private helpers ----

  private addNode(node: Node<K, V>): void {
    // Insert at head (most recent)
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: Node<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: Node<K, V>): void {
    // If already head, nothing to do
    if (node === this.head) return;

    this.removeNode(node);

    // Re-insert at head
    this.addNode(node);
  }

  private evictTail(): void {
    if (!this.tail) return;

    const evicted = this.tail;

    if (this.tail === this.head) {
      // Single-node cache being evicted
      this.head = null;
      this.tail = null;
    } else {
      this.tail = this.tail.prev;
      if (this.tail) {
        this.tail.next = null;
      }
    }

    this.nodeMap.delete(evicted.key);
    this.size--;
  }
}
