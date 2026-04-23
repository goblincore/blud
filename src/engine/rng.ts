export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is treated as unsigned 32-bit integer
    this.state = seed | 0;
  }

  private mulberry32(): number {
    let state = this.state | 0;
    state = (state + 0x6D2B79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.state = ((t ^ (t >>> 14)) >>> 0);
    return (this.state >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    const r = this.next();
    // Map [0, 1) to [min, max] inclusive
    // max - min + 1 gives the range size
    const range = max - min + 1;
    const integer = Math.floor(r * range);
    return min + integer;
  }

  nextFloat(min: number, max: number): number {
    if (min > max) {
      throw new Error('min must be less than or equal to max');
    }
    const r = this.next();
    return min + r * (max - min);
  }

  nextBool(probability: number = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    const index = this.nextInt(0, arr.length - 1);
    return arr[index];
  }

  shuffle<T>(arr: T[]): T[] {
    const arrCopy = [...arr];
    for (let i = arrCopy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arrCopy[i], arrCopy[j]] = [arrCopy[j], arrCopy[i]];
    }
    return arrCopy;
  }

  fork(): SeededRng {
    // Create a new instance with the current state as seed
    // This ensures the new RNG is independent but derived from current state
    return new SeededRng(this.state);
  }
}
