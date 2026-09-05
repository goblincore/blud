/**
 * SeededRng — Mulberry32 PRNG wrapper with utility methods.
 *
 * @see https://codegolf.stackexchange.com/a/35373/25647
 */
export class SeededRng {
  private _state: number;

  constructor(seed: number) {
    // Mask to unsigned 32-bit integer
    this._state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this._state = (this._state + 0x6b64aa5e) >>> 0;
    let t = this._state * 0x4b7a32e0;
    t = (t ^ (t >>> 15)) * 0x94d044bb;
    return ((t ^ (t >>> 7)) >>> 0) * (1 / 0x100000000);
  }

  /** Returns a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    const range = max - min + 1;
    const r = this.next();
    return min + Math.floor(r * range);
  }

  /** Returns a float in [min, max). */
  nextFloat(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    return min + this.next() * (max - min);
  }

  /** Returns a boolean with probability p of being true. Defaults 0.5. */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks one random element from an array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new RangeError("pick() called on empty array");
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  /** Returns a new array with elements shuffled (Fisher–Yates). Does not mutate the input. */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr] as T[];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Returns a **new** SeededRng that continues the same sequence from the current point.
   * The original instance is not advanced.
   */
  fork(): SeededRng {
    return new SeededRng(this._state);
  }

  /** Returns the current internal state for inspection. */
  getState(): number {
    return this._state;
  }
}
