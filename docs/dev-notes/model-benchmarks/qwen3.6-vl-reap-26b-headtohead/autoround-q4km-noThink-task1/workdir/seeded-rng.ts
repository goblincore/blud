/**
 * Seeded random number generator using the Mulberry32 PRNG algorithm.
 * Mulberry32 is a fast, simple, 32-bit PRNG with a full period of 2^32.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a pseudo-random float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b7920) | 0;
    const t = (this.state ^ (this.state >>> 16)) * 0x82857243 | 0;
    const v = t ^ (t >>> 16);
    // t is signed; >>> 0 reinterprets bits as unsigned so the ratio
    // spans the full [0, 1) interval rather than being capped at 0.5.
    return (v >>> 0) / 0x1_000_000_00;
  }

  /** Returns a pseudo-random integer in [min, max] (inclusive on both ends). */
  nextInt(min: number, max: number): number {
    if (min > max) throw new Error(`nextInt: min (${min}) > max (${max})`);
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Returns a pseudo-random float in [min, max). */
  nextFloat(min: number, max: number): number {
    if (min >= max) throw new Error(`nextFloat: min (${min}) >= max (${max})`);
    return min + this.next() * (max - min);
  }

  /** Returns true with probability p, false otherwise. Default p = 0.5. */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks a random element from *arr* (non-mutating). */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick: array is empty");
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  /** Returns a shallow-copied copy of *arr* with elements shuffled via
   * Fisher-Yates (non-mutating). */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Forks a new independent SeededRng from the *current* internal state.
   * The returned instance advances its own state independently without
   * affecting this instance (or vice-versa).
   */
  fork(): SeededRng {
    // Snapshot the current state, then advance *this* instance so the fork
    // starts from a different but derived seed.
    const snapshot = this.state;
    this.next(); // advance current state
    return new SeededRng(snapshot);
  }
}
