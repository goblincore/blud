import { describe, it, expect } from 'vitest';
import { nextSpikeDelaySec, SpikeConfig } from './ambient';

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ambient spike scheduler', () => {
  const cfg: SpikeConfig = { minSec: 20, maxSec: 40 };

  it('returns a delay within [min,max] for any RNG output', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const d = nextSpikeDelaySec(cfg, rng);
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(40);
    }
  });

  it('uniform-ish distribution over 10k samples', () => {
    const rng = mulberry32(7);
    let sum = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) sum += nextSpikeDelaySec(cfg, rng);
    const mean = sum / N;
    expect(mean).toBeGreaterThan(29);
    expect(mean).toBeLessThan(31);
  });

  it('equal min/max always returns that value', () => {
    const rng = mulberry32(1);
    expect(nextSpikeDelaySec({ minSec: 5, maxSec: 5 }, rng)).toBe(5);
  });
});
