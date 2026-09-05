/**
 * Mulberry32 PRNG implementation.
 *
 * @see https://www.jcpenne.com/blog/2021/03/25/mulberry32-a-fast-one-line-seeded-random-number-generator-in-javascript/
 */

const MULBRY32_MAGIC = 0x680d1ed1;
const MULBRY32_PHI = 0x9e377999;

class SeededRng {
  /** Internal state */
  private a: number;
  private b: number;

  /**
   * Create a new seeded random number generator.
   * @param seed - Seed value
   */
  constructor(seed: number) {
    // Initialize Mulberry32 state from seed
    this.a = seed | 0;
    this.b =
      (seed ^ MULBRY32_MAGIC ^ ((seed as number) * MULBRY32_PHI)) | 0;
  }

  /**
   * Generate next raw 32-bit unsigned integer, then normalise to [0, 1).
   * @returns Float in [0, 1)
   */
  private rawFloat(): number {
    let t = (Math.sin(this.a++) as number) * 0x100000000;
    this.a |= 0;
    this.b |= 0;
    const result = (t ^ this.b) >>> 0;
    return result / 0x100000000;
  }

  /**
   * Return a float in [0, 1).
   */
  next(): number {
    return this.rawFloat();
  }

  /**
   * Return a random integer in [min, max] (inclusive).
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    const range = max - min + 1;
    const r = this.next();
    return min + Math.floor(r * range);
  }

  /**
   * Return a float in [min, max).
   */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Return true with probability `p`, else false.
   * @param p - Probability of true, defaults to 0.5
   */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Pick a random element from an array.
   */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx];
  }

  /**
   * Return a shuffled copy of the array using Fisher-Yates.
   * Non-mutating — original array is not modified.
   */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Fork this RNG into a new independent instance.
   * Consumes one value from the parent to guarantee a unique seed,
   * ensuring the child and parent produce divergent sequences.
   */
  fork(): SeededRng {
    this.next(); // advance parent state to guarantee uniqueness
    return new SeededRng(
      (this.a | 0) ^ (this.b | 0) ^ ((this.a | 0) * (this.b | 0))
    );
  }
}

export { SeededRng };
