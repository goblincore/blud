/**
 * A generic LRU (Least Recently Used) cache implemented with a doubly-linked list + hash map.
 * All operations are O(1).
 */
export class LRUCache<K, V> {
  private capacity: number;
  private size = 0;
  private head: Node<K, V> | null = null; // MRU end
  private tail: Node<K, V> | null = null; // LRU end
  private map = new Map<K, Node<K, V>>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Move accessed node to MRU position (head)
    this._moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      // Update value and move to MRU
      existing.value = value;
      this._moveToHead(existing);
      return;
    }

    // Evict LRU if at capacity
    if (this.size >= this.capacity && this.tail !== null) {
      this._removeTail();
    }

    // Insert new node at MRU position (head)
    const node = new Node(key, value);
    this._addToHead(node);
    this.map.set(key, node);
    this.size++;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this._detach(node);
    this.map.delete(key);
    this.size--;
    return true;
  }

  get size(): number {
    return this.size;
  }

  /**
   * Returns entries in MRU order (most recent first).
   */
  *entries(): IterableIterator<[K, V]> {
    let current = this.head;
    while (current !== null) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  // --- Internal helpers ---

  private _addToHead(node: Node<K, V>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head !== null) this.head.prev = node;
    this.head = node;
    if (this.tail === null) this.tail = node;
  }

  private _moveToHead(node: Node<K, V>): void {
    if (node === this.head) return; // Already MRU

    this._detach(node);
    this._addToHead(node);
  }

  private _detach(node: Node<K, V>): void {
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.prev = null;
    node.next = null;
  }

  private _removeTail(): void {
    if (this.tail === null) return;
    const removed = this.tail;
    this.tail = removed.prev;
    if (this.tail !== null) {
      this.tail.next = null;
    } else {
      // Cache is now empty
      this.head = null;
    }
    removed.prev = null;
    this.map.delete(removed.key);
    this.size--;
  }
}

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
