// src/sim/rng.ts
/**
 * Deterministic PRNG for the sim. Same mulberry32 algorithm as
 * src/game/rng.ts, but the state is a plain object so it can live inside
 * SimState — cloned for rollback and hashed by the determinism harness.
 * The sim NEVER calls Math.random; all sim randomness flows through here.
 */
export interface SimRng {
  a: number; // 32-bit state; advanced by every draw
}

export function createRng(seed: number): SimRng {
  return { a: seed >>> 0 };
}

/** Advance the state and return a uint32. */
export function nextU32(r: SimRng): number {
  r.a = (r.a + 0x6d2b79f5) | 0;
  let t = Math.imul(r.a ^ (r.a >>> 15), 1 | r.a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Float in [0, 1). For sim use only where a float ratio is acceptable; prefer
 *  chance()/randomInt() for branch/range decisions that must stay integer. */
export function random(r: SimRng): number {
  return nextU32(r) / 4294967296;
}

/** Blood's Chance(n): n is 16.16 fixed-point (0x10000 = 100%). */
export function chance(r: SimRng, fixed16: number): boolean {
  return random(r) < fixed16 / 0x10000;
}

/** Uniform integer in [0, n). Requires n > 0. Unbiased (float-scaled, mirroring
 *  Blood's rand()*n>>15) — avoids the modulo bias of nextU32()%n. */
export function randomInt(r: SimRng, n: number): number {
  return Math.floor(random(r) * n);
}
