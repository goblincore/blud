import { describe, it, expect } from 'vitest';
import { fieldParity, fieldTargetHeight, fieldJitterNdcY, fieldRowSource } from './field-render';

describe('fieldParity', () => {
  it('alternates every frame', () => {
    expect([0, 1, 2, 3, 4].map(fieldParity)).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('fieldTargetHeight', () => {
  it('is half the full height, rounded up so no row is lost', () => {
    expect(fieldTargetHeight(600)).toBe(300);
    expect(fieldTargetHeight(601)).toBe(301);
    expect(fieldTargetHeight(1)).toBe(1);
  });
});

describe('fieldJitterNdcY', () => {
  it('separates the two fields by exactly one full-res row in NDC', () => {
    const H = 600;
    const a = fieldJitterNdcY(0, H), b = fieldJitterNdcY(1, H);
    expect(Math.abs(b - a)).toBeCloseTo(2 / H, 12);
  });
  it('is symmetric about zero, so neither field is the biased one', () => {
    const H = 600;
    expect(fieldJitterNdcY(0, H)).toBeCloseTo(-fieldJitterNdcY(1, H), 12);
  });
  it('scales with resolution', () => {
    expect(Math.abs(fieldJitterNdcY(1, 300))).toBeCloseTo(2 * Math.abs(fieldJitterNdcY(1, 600)), 12);
  });
});

describe('fieldRowSource — the coverage guarantee', () => {
  const H = 600;
  it('covers every output row exactly once per parity', () => {
    for (const parity of [0, 1] as const) {
      const fresh = new Set<number>();
      for (let y = 0; y < H; y++) if (fieldRowSource(y, parity).fresh) fresh.add(y);
      expect(fresh.size).toBe(H / 2);
      for (const y of fresh) expect(y % 2).toBe(parity);
    }
  });
  it('the two parities together cover every row exactly once', () => {
    const seen = new Map<number, number>();
    for (const parity of [0, 1] as const)
      for (let y = 0; y < H; y++)
        if (fieldRowSource(y, parity).fresh) seen.set(y, (seen.get(y) ?? 0) + 1);
    expect(seen.size).toBe(H);
    for (const [, n] of seen) expect(n).toBe(1);
  });
  it('maps an output row to the right half-height target row', () => {
    expect(fieldRowSource(0, 0)).toEqual({ fresh: true, targetRow: 0 });
    expect(fieldRowSource(2, 0)).toEqual({ fresh: true, targetRow: 1 });
    expect(fieldRowSource(1, 1)).toEqual({ fresh: true, targetRow: 0 });
    expect(fieldRowSource(1, 0).fresh).toBe(false);
  });
});
