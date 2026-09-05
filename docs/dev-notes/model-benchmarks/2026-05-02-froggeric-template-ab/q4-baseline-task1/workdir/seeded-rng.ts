/**
 * Seeded PRNG using the Mulberry32 algorithm.
 * All methods are deterministic given the same initial seed.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure state is a 32-bit unsigned integer
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = this.state + 0x6d2b785f | 0;
    const t = Math.imul(this.state ^ (this.state >>> 16), 0x89e08510) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Returns a random integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Returns a random float in [min, max). */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns true with probability `p`. */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks a random element from `arr`. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from an empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Returns a new array with elements shuffled via Fisher-Yates. Does not mutate the input. */
  shuffle<T>(arr: readonly T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Forks the current RNG into a new independent SeededRng.
   * The current instance is unaffected.
   */
  fork(): SeededRng {
    return new SeededRng(this.state);
  }
}
