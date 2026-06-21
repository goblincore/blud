// src/sim/hash.ts
import type { SimState } from './state';

/**
 * Stable FNV-1a-style 32-bit hash of the serializable sim state. Field order is
 * fixed and array iteration is in index order, so the hash is deterministic
 * across runs/peers. This is the determinism harness's fingerprint; extend it
 * field-for-field as SimState grows in later plans.
 */
export function hashSimState(s: SimState): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };

  mix(s.tic);
  mix(s.rng.a);
  for (const b of s.bodies) {
    mix(b.x); mix(b.y); mix(b.z);
    mix(b.vx); mix(b.vy); mix(b.vz);
  }

  const p = s.player;
  mix(p.x); mix(p.y); mix(p.z); mix(p.vy);
  mix(p.yaw); mix(p.pitch); mix(p.grounded ? 1 : 0); mix(p.prevButtons);

  return h >>> 0;
}
