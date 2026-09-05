import { LRU } from "./lru-cache.ts";

export class LRUCache<K, V> {
  private _cache: Map<K, V> = new Map();

  constructor(private _capacity: number) {
    this._capacity = _capacity;
  }

  get capacity(): number {
    return this._capacity;
  }

  get size(): number {
    return this._cache.size;
  }

  get(key: K): V | undefined {
    if (!this._cache.has(key)) {
      return undefined;
    }
    const value = this._cache.get(key)!;
    this._cache.delete(key);
    this._cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this._cache.set(key, value);
  }

  has(key: K): boolean {
    return this._cache.has(key);
  }

  delete(key: K): boolean {
    return this._cache.delete(key);
  }

  entries(): IterableIterator<[K, V]> {
    return this._cache.entries();
  }
}
