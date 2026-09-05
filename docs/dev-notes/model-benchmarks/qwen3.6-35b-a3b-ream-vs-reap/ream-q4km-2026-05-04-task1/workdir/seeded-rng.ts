/**
 * Seeded PRNG using the Mulberry32 algorithm.
 * All methods are deterministic for a given seed.
 */

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Initialize Mulberry32 state (must be uint32)
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    // Mulberry32: a = (a + s) | 0; t = Math.imul(a ^ (a >>> 16), 1 | a);
    // return (t ^ (t >>> 22)) / 0x40000000;
    this.state |= 0;
    const x = (this.state += 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t ^ (t >>> 22)) | 0;
    // Convert to [0, 1) by dividing by 2^32
    return ((t >>> 0) / 0x100000000) as number;
  }

  /** Returns a random integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    if (min > max) [min, max] = [max, min];
    const range = max - min + 1;
    if (range <= 0) return min;
    if (range === 1) return min;
    if (range === 0x100000000) {
      return min + (this.next() * range) | 0;
    }
    // Rejection sampling to avoid modulo bias
    const limit = (0x100000000 % range);
    let r;
    do {
      r = this.next() * 0x100000000;
    } while (r < limit);
    return min + (Math.floor(r) % range);
  }

  /** Returns a random float in [min, max]. */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns true with probability p, false otherwise. */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Returns a random element from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("pick called on empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Returns a new array with elements randomly shuffled (Fisher-Yates). Non-mutating. */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Creates a new independent SeededRng seeded from the current internal state. */
  fork(): SeededRng {
    const newState = this.state; // capture current state
    return new SeededRng(newState);
  }
}
