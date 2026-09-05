export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    // Move to most recently used (delete and re-insert at end)
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Update existing key: remove and re-insert to mark as most recent
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict least recently used (first item in Map)
      const lruKey = this.map.keys().next().value;
      this.map.delete(lruKey);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    // Map iteration order is insertion order.
    // Most recently used items are at the end.
    // Return an iterator in MRU (most recently used) order = reverse of Map order.
    const entries = Array.from(this.map.entries());
    entries.reverse();
    return entries[Symbol.iterator]();
  }
}
