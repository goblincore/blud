// src/lab/sdf-zombie/webgpu/burn-registry.ts
//
// WHO IS ON FIRE. A keyed, LAZY bag of BurnState — the in-game half of
// burn-state.ts, whose header says "pure and three-free so the lab, the tests
// and the game's actors all step the same numbers". This module owns the
// bookkeeping the game needs and the lab did not: an actor list that grows and
// shrinks, and a hard promise that a game which never ignites anything
// allocates nothing and writes nothing.
//
// Lazy means LAZY: `ensure` is the only allocator, and the game reaches it
// only from an ignite. A body put out keeps its entry (and therefore its
// monotonic char) until `release` — re-igniting a burnt corpse must not hand it
// a clean slate.

import {
  createBurnState, extinguishBurn, igniteBurn, killBurning, stepBurn,
  type BurnRates, type BurnState,
} from '../burn-state';

export interface BurnRegistry<K> {
  /** Tracked keys — NOT "burning now": a put-out or burnt-down body stays
   *  tracked (with its char) until it is released. */
  readonly size: number;
  has(key: K): boolean;
  get(key: K): BurnState | undefined;
  /** Create the state for `key` if absent and return it. Does NOT light it. */
  ensure(key: K): BurnState;
  /** Create-or-get and start the ignite ramp. */
  ignite(key: K): BurnState;
  /** Advance every tracked state by one clamped dt. */
  step(dt: number, rates: BurnRates): void;
  /** A tracked body was killed while burning: start the burn-down. No-op for
   *  an untracked key (a cold body does not become a charred one for free). */
  kill(key: K): void;
  /** Forget a key (actor removed or gibbed). */
  release(key: K): void;
  /** Put every tracked body out, keeping its char. */
  extinguishAll(): void;
  /** Tracked keys in insertion order. Allocates — do not call per frame. */
  keys(): K[];
  /** Visit every key that is burning or burning down. Allocation-free. */
  forEachActive(fn: (key: K, state: BurnState) => void): void;
  /** Drop everything. */
  clear(): void;
}

export function createBurnRegistry<K>(): BurnRegistry<K> {
  const states = new Map<K, BurnState>();
  return {
    get size() { return states.size; },
    has: (key) => states.has(key),
    get: (key) => states.get(key),
    ensure(key) {
      let s = states.get(key);
      if (!s) { s = createBurnState(); states.set(key, s); }
      return s;
    },
    ignite(key) {
      const s = states.get(key) ?? createBurnState();
      states.set(key, s);
      igniteBurn(s);
      return s;
    },
    step(dt, rates) {
      for (const s of states.values()) {
        // Skip a body that is neither alight nor burning down and has already
        // reached cold: stepBurn on it is a no-op, and this is the per-frame
        // hot loop. The entry (and its char) stays until release.
        if (!s.alight && !s.dying && s.burn <= 0) continue;
        stepBurn(s, dt, rates);
      }
    },
    kill(key) {
      const s = states.get(key);
      if (s) killBurning(s);
    },
    release(key) { states.delete(key); },
    extinguishAll() { for (const s of states.values()) extinguishBurn(s); },
    keys() { return [...states.keys()]; },
    forEachActive(fn) {
      for (const [key, s] of states) {
        if (s.burn > 0 || s.dying) fn(key, s);
      }
    },
    clear() { states.clear(); },
  };
}
