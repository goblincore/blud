/**
 * SeededRng — deterministic random number generator backed by mulberry32.
 *
 * Exported as a standalone utility module. Zero dependencies. Strict TypeScript.
 */

// ---------------------------------------------------------------------------
// Mulberry32 PRNG state (unsigned 32-bit integer)
// ---------------------------------------------------------------------------

/**
 * Mulberry32 — a fast, simple, 32-bit seeded PRNG by Brian eham.
 *
 * @param seed  initial state (any number, coerced to unsigned 32-bit)
 * @returns     a new SeededRng instance
 */
export function createSeededRng(seed: number): SeededRng {
  return new SeededRng(seed);
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class SeededRng {
  /** Mulberry32 internal state (stored as signed int32 for JS bitwise ops) */
  public state: number;

  constructor(seed: number) {
    // Coerce to unsigned 32-bit, then back to signed for bitwise ops
    this.state = seed >>> 0;
  }

  /** Returns the next float in [0, 1). */
  next(): number {
    this.state = this.state + 0x6d2b_f533 | 0;
    let t = (this.state ^ (this.state >>> 16)) * 0x8a5_06593;
    t = (t ^ (t >>> 16)) >>> 0; // coerce to unsigned before division
    return t / 4_294_967_296;
  }

  /**
   * Returns a random integer in [min, max] (inclusive).
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new RangeError(`nextInt: min (${min}) > max (${max})`);
    }
    const range = max - min + 1;
    return Math.floor(this.next() * range) + min;
  }

  /**
   * Returns a random float in [min, max) (half-open interval).
   */
  nextFloat(min: number, max: number): number {
    if (min >= max) {
      throw new RangeError(`nextFloat: min (${min}) >= max (${max})`);
    }
    return this.next() * (max - min) + min;
  }

  /**
   * Returns `true` with probability *p*, `false` otherwise.
   *
   * @param p  probability of returning `true` (default 0.5)
   */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Picks a random element from *arr* (non-empty).
   */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new RangeError("pick: array must not be empty");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /**
   * Returns a **new** array with the same elements shuffled (Fisher-Yates).
   * The original *arr* is **not** mutated.
   */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Forks a new independent `SeededRng` whose state is derived from the
   * *current* internal state.  Calling `fork()` on the parent and the child
   * will produce **different** sequences.
   */
  fork(): SeededRng {
    const child = new SeededRng(this.state);
    // Advance parent so it stays independent
    this.next();
    return child;
  }
}
