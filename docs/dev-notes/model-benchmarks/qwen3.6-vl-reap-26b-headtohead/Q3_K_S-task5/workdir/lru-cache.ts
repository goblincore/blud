export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;
  private accessOrder: K[];

  constructor(capacity: number) {
    if (capacity < 0 || !Number.isFinite(capacity)) {
      throw new Error("Capacity must be a positive finite number");
    }
    this.capacity = capacity;
    this.map = new Map<K, V>();
    this.accessOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to most-recently-used
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      this.accessOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Update existing key
      this.map.set(key, value);
      // Move to most-recently-used
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      this.accessOrder.push(key);
    } else {
      // New key
      if (this.capacity === 0) return; // Cannot store with zero capacity
      if (this.map.size === this.capacity) {
        // Evict least-recently-used (first in accessOrder)
        const lruKey = this.accessOrder.shift();
        if (lruKey !== undefined) {
          this.map.delete(lruKey);
        }
      }
      this.map.set(key, value);
      this.accessOrder.push(key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    if (this.map.delete(key)) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return true;
    }
    return false;
  }

  get size(): number {
    return this.map.size;
  }

  *entries(): IterableIterator<[K, V]> {
    // Iterate in most-recently-used order (last = most recent)
    for (let i = this.accessOrder.length - 1; i >= 0; i--) {
      const key = this.accessOrder[i];
      const value = this.map.get(key);
      if (value !== undefined) {
        yield [key, value];
      }
    }
  }
}
