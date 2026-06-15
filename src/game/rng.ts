/** Injectable PRNG returning a float in [0, 1). Production passes Math.random;
 *  tests pass a seeded mulberry32 for determinism. Threading this through the
 *  ported pure logic (instead of bare Math.random) is what keeps a future
 *  deterministic netcode core reachable. */
export type Rng = () => number;

/** Small, fast, well-distributed seeded PRNG. Same algorithm previously inlined
 *  in chunks.test.ts; promoted here as the single seedable source. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** NotBlood `Chance(n)`: n is a 16.16 fixed-point probability where 0x10000 = 100%,
 *  0x8000 = 50%, 0x4000 = 25%. Returns true with probability n/0x10000. */
export function chance(rng: Rng, fixed16: number): boolean {
  return rng() < fixed16 / 0x10000;
}
