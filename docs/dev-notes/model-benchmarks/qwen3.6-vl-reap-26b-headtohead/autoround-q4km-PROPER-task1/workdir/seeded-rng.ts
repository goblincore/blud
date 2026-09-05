/**
 * Mulberry32 PRNG with a deterministic 32-bit state.
 *
 * SeededRng exposes a simple API for reproducible random values.
 * The internal state is stored in a plain number field so that
 * `fork()` can snapshot and clone it.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Normalise seed to a 32-bit signed integer (Mulberry32 requirement)
    this.state = seed | 0;
  }

  /** Returns the next state value as a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b782f) | 0;
    let t = (this.state ^ (this.state >>> 15)) * (1 | this.state);
    t = (t + ((t ^ t) * 7)) | 0;
    t = (t + 4294967296 - ((t ^ t) * 12)) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Returns a random integer in [min, max] (both inclusive). */
  nextInt(min: number, max: number): number {
    if (min > max) throw new Error(`nextInt: min (${min}) > max (${max})`);
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Returns a random float in [min, max). */
  nextFloat(min: number, max: number): number {
    if (min >= max) throw new Error(`nextFloat: min (${min}) >= max (${max})`);
    return min + this.next() * (max - min);
  }

  /** Returns true with probability `p`, false otherwise. */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks a random element from `arr`. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick: array is empty");
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  /** Returns a new array with elements shuffled (Fisher-Yates, non-mutating). */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Returns a new independent SeededRng seeded from the current state. */
  fork(): SeededRng {
    const snapshot = this.state | 0;
    return new SeededRng(snapshot);
  }
}
