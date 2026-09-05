/**
 * SeededRng — a wrapper around the Mulberry32 PRNG.
 * Mulberry32 is a fast, compact 32-bit PRNG suitable for games and
 * reproducible simulations.  It is NOT cryptographically secure.
 */

export class SeededRng {
  /**
   * Internal 32-bit state, kept unsigned via >>> 0 conversions.
   */
  private state: number;

  constructor(seed: number) {
    // Seed is masked to 32 bits (signed → unsigned)
    this.state = (seed | 0) >>> 0;
  }

  // ── Core PRNG ────────────────────────────────────────────────

  /**
   * Mulberry32 step: mutates internal state and returns a uint32 in
   * [0, 2³²).
   */
  private mulberry32Step(): number {
    let s = this.state | 0;

    s = (s + 0x12345678) | 0;
    let i = s ^ (s >>> 13);
    i = (i + 0xdeadbeef) | 0;
    i = i ^ (i << 18);

    // Extract the raw 32-bit unsigned value
    this.state = ((i >>> 0) ^ (s >>> 0)) >>> 0;

    return this.state;
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Returns a float in [0, 1).
   */
  next(): number {
    return this.mulberry32Step() / 0x100000000;
  }

  /**
   * Returns a random integer in [min, max] (inclusive on both ends).
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /**
   * Returns a float in [min, max).
   */
  nextFloat(min: number, max: number): number {
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    return min + this.next() * (max - min);
  }

  /**
   * Returns true with probability `p` (default 0.5).
   */
  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  /**
   * Returns a random element from `arr`, or undefined if empty.
   */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /**
   * Returns a shallow-copied, Fisher-Yates-shuffled version of `arr`.
   * The original array is NOT mutated.
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
   * Forks the RNG: creates a brand-new SeededRng seeded from the
   * *current state* of this instance.  The child and parent advance
   * independently after this point.
   */
  fork(): SeededRng {
    // Capture a snapshot of state so the parent is unaffected
    const snapshot = this.state;
    // Advance parent state once (so fork != identity)
    this.mulberry32Step();
    return new SeededRng(snapshot);
  }
}
