export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure state is a positive 32-bit integer
    this.state = seed >>> 0;
  }

  private mulberry32(): number {
    let s = this.state | 0;
    s = (s + 0x6d2c79f2) | 0;
    let t =
      (s ^ (s >>> 13) ^ (s << 27)) | 0;
    t = (t + (t << 15)) | 0;
    this.state = (t ^ (t << 12)) >>> 0;
    return this.state / 4294967296;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    return this.mulberry32();
  }

  /** Returns a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new RangeError("min must be <= max");
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /** Returns a float in [min, max]. */
  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new RangeError("min must be <= max");
    }
    return min + this.next() * (max - min);
  }

  /** Returns true with probability p (default 0.5). */
  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Returns a random element from the array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new RangeError("Array must not be empty");
    }
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  /** Returns a new array with elements shuffled (non-mutating). */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /** Returns a new SeededRng instance with an independent state derived from the current state. */
  fork(): SeededRng {
    const newState = this.mulberry32();
    return new SeededRng(newState);
  }
}
