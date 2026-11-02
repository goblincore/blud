// src/lab/sdf-zombie/meat-pool.ts
//
// MEAT POOL: the bookkeeping behind the torn meat mesh pool (meat pool pass, 2026-10-29). Pure: no renderer.
//
// Each torn meat chunk (webgpu/game-meat-gib.ts) used to be a NEW three Mesh. A new mesh is a new render object in
// three's WebGPU renderer (keyed by object + material + render context + light list): its bindings and uniform
// buffers were made in the frame the chunk first drew — the gore frame — and read as sdf:polys +1-3 ms on E1M1. The
// pool keeps every chunk mesh it ever made, keyed by what its render object depends on (variant, size bucket,
// material), hands a free one back out on the next throw, and takes it back when the chunk leaves (the meat cap's
// eviction, a cast rebuild). The play-step pre-warm makes and draws one of each key the live bodies can throw, so
// the first volley finds its meshes and render objects built.
//
// `?meatpool=0` restores the old path (a new mesh per chunk, the scaled copies warmed without a mesh pool).

let meatPool = true;
/** `?meatpool=0` restores the old torn-meat path (see the header). */
export function meatPoolOn(search: string): boolean {
  return new URLSearchParams(search).get('meatpool') !== '0';
}
export function setMeatPool(on: boolean): void { meatPool = on; }
export function meatPoolEnabled(): boolean { return meatPool; }

/** Meshes the pre-warm makes for each key: one. A volley's chunks round-robin the variants, so they rarely share a
 *  key; a second chunk of a key grows the pool in the gore frame (and stays in it). */
export const MEAT_WARM_PER_KEY = 1;

/** The pool key: what a chunk mesh's render object depends on. */
export function meatPoolKey(variant: number, size: number, materialId: number): string {
  return `${variant}:${size.toFixed(3)}:${materialId}`;
}

export interface KeyedPool<T> {
  /** A free object of `key`, taken off the free list, or undefined (the caller makes one and `adopt`s it). */
  take(key: string): T | undefined;
  /** Count a new object of `key` the caller made (live, not free). */
  adopt(key: string, obj: T): void;
  /** Hand a live object back. An object the pool never adopted, or one already free, is ignored (returns false). */
  give(obj: T): boolean;
  /** Objects of `key` made so far, live and free. */
  made(key: string): number;
  /** Free objects of `key`. */
  free(key: string): number;
  /** Every object made, live and free. */
  readonly size: number;
}

export function createKeyedPool<T>(): KeyedPool<T> {
  const freeLists = new Map<string, T[]>();
  const madeBy = new Map<string, number>();
  const keyOf = new Map<T, string>();
  const isFree = new Set<T>();
  return {
    take(key) {
      const list = freeLists.get(key);
      const obj = list?.pop();
      if (obj !== undefined) isFree.delete(obj);
      return obj;
    },
    adopt(key, obj) {
      if (keyOf.has(obj)) return;
      keyOf.set(obj, key);
      madeBy.set(key, (madeBy.get(key) ?? 0) + 1);
    },
    give(obj) {
      const key = keyOf.get(obj);
      if (key === undefined || isFree.has(obj)) return false;
      isFree.add(obj);
      let list = freeLists.get(key);
      if (!list) { list = []; freeLists.set(key, list); }
      list.push(obj);
      return true;
    },
    made: (key) => madeBy.get(key) ?? 0,
    free: (key) => freeLists.get(key)?.length ?? 0,
    get size() { return keyOf.size; },
  };
}
