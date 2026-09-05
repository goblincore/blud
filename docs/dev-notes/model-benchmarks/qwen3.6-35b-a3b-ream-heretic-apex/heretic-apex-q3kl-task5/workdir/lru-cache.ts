export class LRUCache<K, V> {
  private readonly cap: number;
  private readonly order: K[] = [];
  private readonly store: Map<K, V> = new Map();

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("Capacity must be a positive integer");
    this.cap = capacity;
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    this.order = [
      ...this.order.filter((k) => k !== key),
      key,
    ];
    return this.store.get(key);
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.order = [
        ...this.order.filter((k) => k !== key),
        key,
      ];
      this.store.set(key, value);
      return;
    }
    if (this.order.length >= this.cap) {
      const lru = this.order.shift()!;
      this.store.delete(lru);
    }
    this.order.push(key);
    this.store.set(key, value);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    if (!this.store.has(key)) return false;
    this.store.delete(key);
    this.order = this.order.filter((k) => k !== key);
    return true;
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[K, V]> {
    const order = this.order;
    const store = this.store;
    let i = order.length - 1;
    return {
      next(): IteratorResult<[K, V]> {
        if (i < 0) return { done: true } as IteratorResult<[K, V]>;
        const key = order[i]!;
        i--;
        return { done: false, value: [key, store.get(key)!] } as IteratorResult<[K, V]>;
      },
      [Symbol.iterator]() {
        return this;
      },
    };
  }
}
