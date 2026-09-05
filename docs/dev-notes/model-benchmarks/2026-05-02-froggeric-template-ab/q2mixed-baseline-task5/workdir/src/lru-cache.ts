class Node<V> {
  key: unknown;
  value: V;
  prev: Node<V> | null = null;
  next: Node<V> | null = null;
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, Node<V>>;
  private head: Node<V> | null = null;
  private tail: Node<V> | null = null;

  private alloc(key: K, value: V): Node<V> {
    const node = new Node<V>();
    node.key = key;
    node.value = value;
    return node;
  }

  private detach(node: Node<V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
  }

  private attach(node: Node<V>): void {
    node.next = this.head;
    node.prev = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private detachTail(): Node<V> | null {
    const tail = this.tail;
    if (!tail) return null;
    this.detach(tail);
    if (this.head) this.head.prev = null;
    this.head = null;
    if (this.tail) this.tail.prev = null;
    this.tail = null;
    this.head = null;
    return tail;
  }

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
  }

  private ensureCapacity(): void {
    while (this.map.size >= this.capacity) {
      const tail = this.tail;
      if (!tail) return;
      this.map.delete(tail.key);
      this.detach(tail);
    }
  }

  private touch(node: Node<V>): Node<V> {
    this.detach(node);
    this.attach(node);
    return node;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    const n = this.touch(node);
    return n.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.touch(existing);
      return;
    }
    if (this.map.size >= this.capacity) {
      this.detachTail();
    }
    const node = this.alloc(key, value);
    this.map.set(key, node);
    this.attach(node);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.map.delete(key);
    this.detach(node);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    let current = this.head;
    let done = current === null;
    const it = {
      next(): { done: boolean; value: [K, V] } {
        if (done) return { done: true };
        const node = current;
        current = node!.next;
        done = current === null;
        return { done: false, value: [node.key as K, node.value] };
      },
      [Symbol.iterator]() { return this; }
    };
    return it;
  }
}
