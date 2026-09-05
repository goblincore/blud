export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly _capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    this._capacity = capacity;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Move to most recent (end of map)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key already exists, update and move to most recent
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this._capacity) {
      // Evict least recently used (first entry)
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
    // Returns entries in MRU order (most recent last)
    return this.map[Symbol.iterator]();
  }
}
