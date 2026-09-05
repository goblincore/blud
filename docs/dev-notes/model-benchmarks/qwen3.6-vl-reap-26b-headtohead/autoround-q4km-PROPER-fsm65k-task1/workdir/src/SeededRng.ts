/**
 * SeededRng — a wrapper around the Mulberry32 PRNG.
 *
 * Mulberry32 is a fast, 32-bit PRNG suitable for games and simulations.
 * It is NOT cryptographically secure.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = this.state + 0x6d2b f52f | 0;
    // eslint-disable-next-line no-bitwise
    this.state = (this.state ^ (this.state << 16)) >>> 0;
    this.state = this.state + 0x02d2 dd3b | 0;
    // eslint-disable-next-line no-bitwise
    this.state = (this.state ^ (this.state >>> 5)) >>> 0;
    return (this.state >>> 0) / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    const index = Math.floor(this.next() * arr.length);
    return arr[index];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  fork(): SeededRng {
    return new SeededRng(this.state);
  }
}
