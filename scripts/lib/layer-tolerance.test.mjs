// scripts/lib/layer-tolerance.test.mjs
//
// The sub-LSB tolerance boundary for `probeDyn`, and the lines it must never
// cross. The layer being tolerated is the one whose ZEROING shipped the
// black-silhouette bug the frame hash was built for, so "what is NOT tolerated"
// is the more important half of this file.

import { describe, expect, it } from 'vitest';
import { SUBLSB_TOLERANT, layerStatsAgree, near } from './layer-tolerance.mjs';

/** A probeDyn reading, as the recorder stamps it — the measured 2026-09-18 values. */
const layer = (over = {}) => ({
  hash: 'h', floats: 6400,
  stats: {
    nonZero: 6388, nonFinite: 0, zeroFractionMillionths: 1875,
    min: -0.540611, max: 3.54491, sampled: 6400,
    ...over,
  },
});

describe('SUBLSB_TOLERANT', () => {
  it('covers probeDyn and NOTHING else', () => {
    // marchTarget and instances must stay exact: a tolerance there would hide a
    // real rendering change.
    expect([...SUBLSB_TOLERANT]).toEqual(['probeDyn']);
  });
});

describe('what IS tolerated', () => {
  it('a different hash when every statistic agrees', () => {
    // The measured case: hashes 2143084656 vs 4125444763, stats identical.
    expect(layerStatsAgree(layer(), layer())).toBe(true);
  });

  it('min/max drift within 1e-5 relative', () => {
    expect(layerStatsAgree(layer(), layer({ max: 3.54491 * (1 + 5e-6) }))).toBe(true);
  });
});

describe('what is NOT tolerated', () => {
  it('REFUSES two dead layers — the case that matters most', () => {
    expect(layerStatsAgree(layer({ nonZero: 0 }), layer({ nonZero: 0 }))).toBe(false);
  });

  it('refuses when one side went dead', () => {
    expect(layerStatsAgree(layer(), layer({ nonZero: 0 }))).toBe(false);
  });

  it('refuses a different nonZero count', () => {
    expect(layerStatsAgree(layer(), layer({ nonZero: 6316 }))).toBe(false);
  });

  it('refuses non-finite values', () => {
    expect(layerStatsAgree(layer(), layer({ nonFinite: 3 }))).toBe(false);
  });

  it('refuses a different zero fraction', () => {
    expect(layerStatsAgree(layer(), layer({ zeroFractionMillionths: 965820 }))).toBe(false);
  });

  it('refuses min/max drift beyond 1e-5 relative', () => {
    expect(layerStatsAgree(layer(), layer({ max: 3.6 }))).toBe(false);
    expect(layerStatsAgree(layer(), layer({ min: -5.03129 }))).toBe(false);
  });

  it('refuses a different sample or float count', () => {
    expect(layerStatsAgree(layer(), layer({ sampled: 3200 }))).toBe(false);
    expect(layerStatsAgree(layer(), { ...layer(), floats: 3200 })).toBe(false);
  });

  it('refuses a missing reading', () => {
    expect(layerStatsAgree(layer(), undefined)).toBe(false);
    expect(layerStatsAgree(undefined, layer())).toBe(false);
  });
});

describe('near', () => {
  it('is safe at zero and rejects non-finite', () => {
    expect(near(0, 0)).toBe(true);
    expect(near(0, 1)).toBe(false);
    expect(near(NaN, NaN)).toBe(false);
    expect(near(Infinity, Infinity)).toBe(false);
  });
});
