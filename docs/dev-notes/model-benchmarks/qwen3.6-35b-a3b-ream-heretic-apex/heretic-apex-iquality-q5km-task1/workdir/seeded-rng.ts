/**
 * Seeded PRNG using Mulberry32 algorithm.
 * No external dependencies.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Returns a random float in [min, max). */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns true with probability p (default 0.5). */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Picks a random element from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("pick() requires a non-empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Returns a shuffled copy of the array (Fisher-Yates, non-mutating). */
  shuffle<T>(arr: readonly T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** Creates a new independent SeededRng from the current internal state. */
  fork(): SeededRng {
    return new SeededRng(this.state);
  }
}
