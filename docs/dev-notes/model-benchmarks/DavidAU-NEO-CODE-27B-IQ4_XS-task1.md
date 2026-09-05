```typescript
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  private mulberry32(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next(): number {
    return this.mulberry32();
  }

  nextInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextBool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  fork(): SeededRng {
    const newRng = new SeededRng(this.state);
    // Advance state to ensure independence if desired, 
    // but usually fork implies starting from current state or advancing it.
    // The prompt says "independent SeededRng from current state".
    // To ensure independence, we should advance the current RNG's state 
    // so that the forked one doesn't just replay the exact same sequence 
    // starting from the same point if the original continues.
    // However, standard fork often means "snapshot". 
    // Let's advance the current state to ensure the original continues independently.
    this.next(); 
    return newRng;
  }
}
```
