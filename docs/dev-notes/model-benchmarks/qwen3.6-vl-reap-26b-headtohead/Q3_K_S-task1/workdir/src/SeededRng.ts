/**
 * SeededRng — a deterministic, reproducible random number generator.
 *
 * Algorithm: Mulberry32 (https://stackoverflow.com/a/41699218)
 * A fast 32-bit PRNG suitable for games, simulations, and procedural content.
 */
export class SeededRng {
  private _state: number;

  constructor(seed: number) {
    this._state = seed >>> 0; // force unsigned 32-bit
  }

  /** Multiply-based hash to scramble the seed into the state. */
  private _scramble(value: number): number {
    let x: number = (value as number) >>> 0;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this._state = this._scramble(this._state + 0x6d2b8429 | 0);
    return this._state / 0x100000000;
  }

  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return Math.floor(this.next() * range) + min;
  }

  /** Returns a float in [min, max] inclusive. */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns true with probability `p` (default 0.5). */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks a random element from `arr` without mutation. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Cannot pick from an empty array");
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  /** Returns a new array with elements shuffled (Fisher-Yates), non-mutating. */
  shuffle<T>(arr: readonly T[]): T[] {
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Returns a *new* SeededRng that will produce the same sequence
   * starting from the current point. The original instance continues
   * producing its normal sequence unaffected.
   */
  fork(): SeededRng {
    return new SeededRng(this._state);
  }
}
