```typescript
export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    // Move to end (most recent)
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Update existing key, move to end
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict LRU (first item in Map)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
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
    // Map iteration order is insertion order (LRU at start, MRU at end)
    // We want MRU order, so return reverse iterator
    const entries = [...this.map.entries()];
    let index = entries.length - 1;

    return {
      next(): IteratorResult<[K, V]> {
        if (index >= 0) {
          return { value: entries[index--], done: false };
        }
        return { value: undefined as any, done: true };
      }
    } as IterableIterator<[K, V]>;
  }
}
```
