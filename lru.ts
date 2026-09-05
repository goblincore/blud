/**
 * A generic least-recently-used (LRU) cache.
 *
 * `get()` promotes the accessed key to most-recently-used (MRU).
 * `set()` promotes the key to MRU and evicts the least-recently-used (LRU)
 * entry when the cache is already at capacity.
 *
 * `entries()` yields `[K, V]` pairs in **MRU-first** order (newest → oldest).
 */
export class LRUCache<K, V> {
  private readonly cap: number;
  private readonly order: K[];   // oldest → newest (head = LRU, tail = MRU)
  private readonly map: Map<K, V>;

  constructor(capacity: number) {
    this.cap = Math.max(1, Math.trunc(capacity));
    this.order = [];
    this.map = new Map();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    this.promote(key);
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.set(key, value);
      this.promote(key);
    } else {
      if (this.map.size >= this.cap) {
        this.evict();
      }
      this.map.set(key, value);
      this.order.push(key);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const found = this.map.delete(key);
    if (found) {
      this.order.splice(this.order.indexOf(key), 1);
    }
    return found;
  }

  get size(): number {
    return this.map.size;
  }

  /** Yields `[K, V]` in **MRU → LRU** order (most recent first). */
  *entries(): IterableIterator<[K, V]> {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const key = this.order[i];
      const value = this.map.get(key);
      if (value !== undefined) {
        yield [key, value];
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // internals
  // ──────────────────────────────────────────────────────────────────────────

  /** Move *key* to the tail (MRU) of the order list. */
  private promote(key: K): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1 && idx < this.order.length - 1) {
      this.order.splice(idx, 1);
      this.order.push(key);
    }
  }

  /** Evict the LRU (head) entry. */
  private evict(): void {
    const lru = this.order.shift();
    if (lru !== undefined) {
      this.map.delete(lru);
    }
  }
}
