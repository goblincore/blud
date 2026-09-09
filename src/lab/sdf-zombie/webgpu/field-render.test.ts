import { describe, it, expect } from 'vitest';
import { fieldParity, fieldTargetHeight, fieldJitterNdcY, fieldRowSource, fieldHeldNeighbours } from './field-render';

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

describe('fieldHeldNeighbours', () => {
  it('brackets the held row with the two fresh rows on either side of it, for both parities', () => {
    // parity 0: fresh rows are even (2r). Held row 5 is between fresh 4 (r=2) and 6 (r=3).
    expect(fieldHeldNeighbours(5, 0)).toEqual({ above: 2, below: 3 });
    // parity 1: fresh rows are odd (2r+1). Held row 4 is between fresh 3 (r=1) and 5 (r=2).
    expect(fieldHeldNeighbours(4, 1)).toEqual({ above: 1, below: 2 });
  });
  it('the fresh rows it names really are fresh, and really are one output row either side', () => {
    for (const parity of [0, 1] as const) {
      for (let y = 1; y < 40; y++) {
        if (fieldRowSource(y, parity).fresh) continue;
        const { above, below } = fieldHeldNeighbours(y, parity);
        expect(2 * above + parity).toBe(y - 1);
        expect(2 * below + parity).toBe(y + 1);
      }
    }
  });
});
