/**
 * SeededRng — a deterministic PRNG powered by Mulberry32.
 *
 * All arithmetic is performed on unsigned 32-bit integers (| 0 casts)
 * to match the original algorithm's behaviour.
 */
export class SeededRng {
  private _state: number;

  /**
   * Mulberry32 state update.
   *
   * Reference:
   *   https://www.shorelabs.com/2013/04/mulberry32-a-fast-classic-psuedorandom-number-generator/
   */
  private static _nextState(state: number): number {
    let a = state | 0;
    a = (a + 0x6d0b0000) | 0;
    a = a ^ (a >>> 16);
    a = (a + (a << 8)) | 0;
    a = a ^ (a >>> 16);
    return a;
  }

  constructor(seed: number) {
    this._state = (seed | 0);
  }

  /** Returns the raw uint32 state so it can be captured and restored. */
  get state(): number {
    return this._state >>> 0;
  }

  /** Advance the internal state and return a float in [0, 1). */
  next(): number {
    this._state = SeededRng._nextState(this._state);
    return (this._state >>> 0) / 4294967296;
  }

  /** Return a random integer in [min, max] (inclusive on both ends). */
  nextInt(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Return a random float in [min, max]. */
  nextFloat(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    return min + this.next() * (max - min);
  }

  /** Return true with probability p (default 0.5). */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Pick a random element from arr (non-mutating). */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from an empty array");
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /** Return a new array with elements in random order (Fisher-Yates, non-mutating). */
  shuffle<T>(arr: readonly T[]): T[] {
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Create a new, independent SeededRng from the current state.
   * Calling fork() does not advance the calling instance's state.
   */
  fork(): SeededRng {
    return new SeededRng(this._state);
  }
}
