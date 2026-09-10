import { describe, it, expect } from 'vitest';
import {
  fieldParity, fieldTargetHeight, fieldJitterNdcY, fieldRowSource, fieldHeldNeighbours,
  fieldRingDepth, fieldPixelFraction, FIELD_COUNT,
} from './field-render';

describe('fieldParity', () => {
  it('alternates every frame', () => {
    // NB: an explicit arrow, NOT `.map(fieldParity)` — since the n-field
    // generalisation fieldParity's second argument is `fields`, so `map`
    // would hand it the array INDEX and the divisor would silently become
    // 0/1/2/3/4. The two-argument signature makes the bare reference a trap.
    expect([0, 1, 2, 3, 4].map((f) => fieldParity(f))).toEqual([0, 1, 0, 1, 0]);
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

// ---------------------------------------------------------------------------
// N-FIELD GENERALISATION (2026-09-10). The whole point of `fields` is that
// 3 and 4 make the march target a third / quarter as tall, so the dominant
// pass pays a third / quarter of the pixels. The gate on shipping it is that
// `fields = 2` stays BIT-IDENTICAL — these are the tests that hold that line,
// plus the coverage invariant a deeper field must not break.
// ---------------------------------------------------------------------------

/** Every divisor worth generalising to: the shipped 2, plus the 3 and 4 that
 *  buy the -54%-class win. */
const FIELD_COUNTS = [2, 3, 4] as const;
/** A full height that is divisible by 2 and 4 but NOT by 3, so the round-up
 *  path is exercised (600/3 = 200 exactly; 601 is the awkward one). */
const HEIGHTS = [600, 601, 480, 539] as const;

describe('FIELD_COUNT', () => {
  it('is 2, the shipped divisor', () => {
    expect(FIELD_COUNT).toBe(2);
  });
});

describe('two fields stay BIT-IDENTICAL to the pre-generalisation functions', () => {
  it('fieldParity(2) reproduces `frameIndex % 2` for every frame', () => {
    for (let f = 0; f < 64; f++) expect(fieldParity(f, 2)).toBe(f % 2);
  });
  it('fieldTargetHeight(2) reproduces `max(1, ceil(h / 2))`', () => {
    for (let h = 1; h < 900; h++) {
      expect(fieldTargetHeight(h, 2)).toBe(Math.max(1, Math.ceil(h / 2)));
    }
  });
  it('fieldJitterNdcY(2) reproduces `(parity ? 1 : -1) / fullHeight`', () => {
    for (const H of HEIGHTS) {
      expect(fieldJitterNdcY(0, H, 2)).toBeCloseTo(-1 / H, 15);
      expect(fieldJitterNdcY(1, H, 2)).toBeCloseTo(1 / H, 15);
    }
  });
  it('fieldRowSource(2) reproduces `{ fresh: y % 2 === parity, targetRow: floor(y/2) }`', () => {
    for (const H of HEIGHTS) {
      for (let y = 0; y < H; y++) {
        for (const parity of [0, 1]) {
          expect(fieldRowSource(y, parity, 2)).toEqual({
            fresh: (y % 2) === parity,
            targetRow: Math.floor(y / 2),
          });
        }
      }
    }
  });
  it('fieldHeldNeighbours(2) reproduces the hand-derived `floor(y/2) - parity` form', () => {
    for (const H of HEIGHTS) {
      for (let y = 0; y < H; y++) {
        for (const parity of [0, 1]) {
          // HELD ROWS ONLY. That is the function's whole domain — both the
          // old form and this one are derivations for a row the current field
          // did NOT draw, and for a fresh row they legitimately disagree
          // (y=0/parity=0: old {0,1}, new {-1,0}). No caller asks about a
          // fresh row, which is why nothing ever noticed.
          if (fieldRowSource(y, parity, 2).fresh) continue;
          const base = Math.floor(y / 2) - parity;
          expect(fieldHeldNeighbours(y, parity, 2)).toEqual({ above: base, below: base + 1 });
        }
      }
    }
  });
  it('the defaults are the two-field answers — a call site passing nothing is unchanged', () => {
    for (const H of HEIGHTS) {
      for (let y = 0; y < H; y++) {
        expect(fieldRowSource(y, 1)).toEqual(fieldRowSource(y, 1, 2));
        expect(fieldHeldNeighbours(y, 1)).toEqual(fieldHeldNeighbours(y, 1, 2));
      }
    }
    expect(fieldParity(7)).toBe(fieldParity(7, 2));
    expect(fieldTargetHeight(601)).toBe(fieldTargetHeight(601, 2));
    expect(fieldJitterNdcY(1, 600)).toBe(fieldJitterNdcY(1, 600, 2));
  });
});

describe('the coverage invariant, generalised to N fields', () => {
  for (const fields of FIELD_COUNTS) {
    it(`every output row is fresh exactly once per ${fields} frames`, () => {
      for (const H of HEIGHTS) {
        const seen = new Map<number, number>();
        for (let frame = 0; frame < fields; frame++) {
          const field = fieldParity(frame, fields);
          for (let y = 0; y < H; y++) {
            if (fieldRowSource(y, field, fields).fresh) {
              seen.set(y, (seen.get(y) ?? 0) + 1);
            }
          }
        }
        // Every row covered, and never twice.
        expect(seen.size).toBe(H);
        for (const [, n] of seen) expect(n).toBe(1);
      }
    });

    it(`field ${fields}: each field owns exactly the rows where row % ${fields} === field`, () => {
      for (let y = 0; y < 97; y++) {
        for (let field = 0; field < fields; field++) {
          expect(fieldRowSource(y, field, fields).fresh).toBe(y % fields === field);
        }
      }
    });

    it(`field ${fields}: targetRow never leaves the shortened target`, () => {
      for (const H of HEIGHTS) {
        const th = fieldTargetHeight(H, fields);
        for (let y = 0; y < H; y++) {
          expect(fieldRowSource(y, 0, fields).targetRow).toBeLessThan(th);
        }
      }
    });
  }
});

describe('the jitter spaces the fields exactly one full-res row apart', () => {
  for (const fields of FIELD_COUNTS) {
    it(`field ${fields}: adjacent fields are 2/H apart and the spread is (fields-1)*2/H`, () => {
      for (const H of HEIGHTS) {
        const js = Array.from({ length: fields }, (_, f) => fieldJitterNdcY(f, H, fields));
        for (let f = 1; f < fields; f++) {
          expect(js[f]! - js[f - 1]!).toBeCloseTo(2 / H, 15);
        }
        const spread = js[fields - 1]! - js[0]!;
        expect(spread).toBeCloseTo((fields - 1) * (2 / H), 15);
      }
    });

    it(`field ${fields}: is symmetric about zero, so no field is the biased one`, () => {
      for (const H of HEIGHTS) {
        const sum = Array.from({ length: fields }, (_, f) => fieldJitterNdcY(f, H, fields))
          .reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(0, 15);
      }
    });
  }
});

describe('the held row is genuinely bracketed by the named fresh rows', () => {
  for (const fields of FIELD_COUNTS) {
    it(`field ${fields}: above/below are consecutive, both fresh, and straddle the held row`, () => {
      for (const H of HEIGHTS) {
        const th = fieldTargetHeight(H, fields);
        for (let frame = 0; frame < fields; frame++) {
          const field = fieldParity(frame, fields);
          for (let y = 0; y < H; y++) {
            if (fieldRowSource(y, field, fields).fresh) continue;
            const { above, below } = fieldHeldNeighbours(y, field, fields);
            if (above < 0 || below >= th) continue;   // the caller clamps; edges are its business
            expect(below - above).toBe(1);
            // The named rows really are field-owned output rows...
            expect(above * fields + field).toBeLessThan(y);
            expect(below * fields + field).toBeGreaterThan(y);
            // ...and there is no field-owned row between them and y.
            expect(below * fields + field - y).toBeLessThanOrEqual(fields);
            expect(y - (above * fields + field)).toBeLessThanOrEqual(fields);
          }
        }
      }
    });
  }
});

describe('the ring depth a deeper field needs', () => {
  it('is fields - 1: two fields need the one retained buffer we already have', () => {
    expect(fieldRingDepth(2)).toBe(1);
    expect(fieldRingDepth(3)).toBe(2);
    expect(fieldRingDepth(4)).toBe(3);
  });
});

describe('the pixel fraction each divisor buys', () => {
  it('is 1/fields: this is the number to quote when predicting a win', () => {
    expect(fieldPixelFraction(2)).toBe(0.5);
    expect(fieldPixelFraction(3)).toBeCloseTo(1 / 3, 15);
    expect(fieldPixelFraction(4)).toBe(0.25);
  });
});
