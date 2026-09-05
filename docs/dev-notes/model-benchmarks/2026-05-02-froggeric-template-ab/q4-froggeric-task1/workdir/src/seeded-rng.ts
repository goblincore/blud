/**
 * Mulberry32 PRNG — a fast, simple seeded random number generator.
 *
 * @see https://gist.github.com/broof/8e8e9e30a4db3af0cc4e9761d35b1df6
 */

const MULBERRY32_MAX = 4294967296; // 2^32

export class SeededRng {
  /** Internal 32-bit state word. */
  private _seed: number;

  constructor(seed: number) {
    this._seed = seed | 0;
  }

  /**
   * Advance the PRNG and return the raw 32-bit unsigned value.
   */
  private _nextRaw(): number {
    this._seed = this._seed >>> 0;
    this._seed ^= this._seed << 16;
    this._seed ^= this._seed >>> 13;
    this._seed = this._seed >>> 0;
    this._seed ^= this._seed << 1;
    return this._seed >>> 0;
  }

  /**
   * Return a float in [0, 1).
   */
  next(): number {
    return this._nextRaw() / MULBERRY32_MAX;
  }

  /**
   * Return an integer in [min, max] (inclusive on both ends).
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`nextInt: min (${min}) > max (${max})`);
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /**
   * Return a float in [min, max).
   */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Return true with probability *p* (default 0.5).
   */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Pick a random element from *arr* using the current RNG state.
   */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('pick: array is empty');
    }
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  /**
   * Return a new array with elements randomly permuted (Fisher-Yates).
   * **Does not mutate** the original array.
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
   * Return a new independent SeededRng whose sequence will diverge
   * from this instance going forward.
   */
  fork(): SeededRng {
    const forkSeed = this._nextRaw();
    // Advance parent so fork diverges from parent's future sequence
    this.next();
    return new SeededRng(forkSeed);
  }
}
