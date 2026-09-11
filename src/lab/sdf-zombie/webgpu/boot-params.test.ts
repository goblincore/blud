import { describe, it, expect } from 'vitest';
import { parseFloatParam, parseIntParam, hasParam } from './boot-params';

// Regression gate for the 2026-09-10 visual regression: the probe-gather
// diagnostic seams booted every UNPARAMETERISED page with zero rays and an
// empty light list, because `Number(null) === 0` passed the `>= 0` guard. The
// dynamic probe layer went fully zero and characters in the player's room
// rendered as black silhouettes.

describe('parseIntParam — absent is NOT zero', () => {
  it('returns null for an ABSENT parameter, never 0', () => {
    // The exact bug. `Number(null)` is 0, and 0 is a valid seam value, so this
    // assertion is the one that would have caught it.
    expect(parseIntParam(null, { min: 0, max: 64 })).toBeNull();
    expect(parseIntParam(null, { min: 0, max: 64 })).not.toBe(0);
  });

  it('returns null for an EMPTY parameter, which `Number("")` also turns into 0', () => {
    expect(parseIntParam('', { min: 0, max: 64 })).toBeNull();
    expect(parseIntParam('   ', { min: 0, max: 64 })).toBeNull();
  });

  it('returns a REAL 0 when zero is explicitly asked for — the diagnostic mode', () => {
    // The other half of the contract: `?dynrays=0` must still work, because
    // that is the wrong-frame-on-purpose mode the cost split is measured with.
    expect(parseIntParam('0', { min: 0, max: 64 })).toBe(0);
    expect(parseIntParam('0', { min: 0, max: 64 })).not.toBeNull();
  });

  it('rejects non-numeric and NaN instead of coercing them to a default', () => {
    expect(parseIntParam('abc', { min: 0, max: 64 })).toBeNull();
    expect(parseIntParam('NaN', { min: 0, max: 64 })).toBeNull();
    expect(parseIntParam('12abc', { min: 0, max: 64 })).toBeNull();
    expect(parseIntParam('Infinity', { min: 0, max: 64 })).toBeNull();
  });

  it('clamps above max rather than rejecting, so a too-large value still works', () => {
    expect(parseIntParam('9999', { min: 0, max: 64 })).toBe(64);
    expect(parseIntParam('4.9', { min: 0, max: 64 })).toBe(4);
  });

  it('returns null below min — this is how ?proberate escaped the bug by luck', () => {
    // proberate uses min 1, so the 0 produced by an absent param failed its
    // test and it happened to get the right answer for the wrong reason.
    // Expressing the rule as `min` makes that luck into a guarantee.
    expect(parseIntParam('0', { min: 1, max: 4 })).toBeNull();
    expect(parseIntParam('1', { min: 1, max: 4 })).toBe(1);
    expect(parseIntParam('7', { min: 1, max: 4 })).toBe(4);
  });

  it('the three shipped seams all resolve to their defaults when absent', () => {
    // Proves the actual boot paths a bare page takes: every one must be null,
    // so the caller supplies the shipped value (32 rays, every light, rate 2).
    const dynRays = parseIntParam(null, { min: 0, max: 64 });
    const dynLights = parseIntParam(null, { min: 0, max: 1024 });
    const probeRate = parseIntParam(null, { min: 1, max: 4 });
    expect(dynRays).toBeNull();
    expect(dynLights).toBeNull();
    expect(probeRate).toBeNull();
    // And the shipped defaults they fall back to are the NON-diagnostic ones.
    expect(dynRays ?? 32).toBe(32);
    expect(dynLights ?? Number.MAX_SAFE_INTEGER).toBe(Number.MAX_SAFE_INTEGER);
    expect(probeRate ?? 2).toBe(2);
  });

  it('fixes the pre-existing ?tracerlightslots default, which was silently 0', () => {
    // Same bug class, found by auditing rather than by a playtest: the old
    // expression was `Number.isFinite(Number(null)) && Number(null) >= 0`, both
    // true, so an absent param produced 0 instead of the intended default of 2
    // — tracer lights never fed the gather's dynamic light list on a bare page.
    expect(parseIntParam(null, { min: 0, max: 8 }) ?? 2).toBe(2);
    // An explicit 0 must still switch them OFF, which is the whole reason the
    // guard cannot simply require > 0.
    expect(parseIntParam('0', { min: 0, max: 8 }) ?? 2).toBe(0);
    expect(parseIntParam('5', { min: 0, max: 8 }) ?? 2).toBe(5);
  });
});

describe('hasParam', () => {
  it('separates presence from value', () => {
    expect(hasParam(null)).toBe(false);
    expect(hasParam('')).toBe(true);   // `?frozen` with no value IS present
    expect(hasParam('0')).toBe(true);  // and so is an explicit zero
  });
});

describe('parseFloatParam — the same contract, for fractional seams', () => {
  // `?dynblend` (R1 verification seam) is the first fractional boot parameter.
  // The `Number(null) === 0` trap is about the RAW STRING, not about whether the
  // value has a fraction: 0 is a legitimate blend (the record is never updated,
  // i.e. the afterglow is frozen), so absent must still be distinguishable.
  it('returns null for absent/empty/unparseable, never 0', () => {
    expect(parseFloatParam(null, { min: 0, max: 1 })).toBeNull();
    expect(parseFloatParam('', { min: 0, max: 1 })).toBeNull();
    expect(parseFloatParam('  ', { min: 0, max: 1 })).toBeNull();
    expect(parseFloatParam('abc', { min: 0, max: 1 })).toBeNull();
    expect(parseFloatParam('NaN', { min: 0, max: 1 })).toBeNull();
  });

  it('KEEPS the fraction, which is the whole reason it is not parseIntParam', () => {
    expect(parseFloatParam('0.5', { min: 0, max: 1 })).toBe(0.5);
    expect(parseFloatParam('0.35', { min: 0, max: 1 })).toBe(0.35);
    // The seam this exists for: 1 = the record IS this frame's estimate.
    expect(parseFloatParam('1', { min: 0, max: 1 })).toBe(1);
    // And 0 is a real mode (a frozen afterglow), not "absent".
    expect(parseFloatParam('0', { min: 0, max: 1 })).toBe(0);
    expect(parseFloatParam('0', { min: 0, max: 1 })).not.toBeNull();
  });

  it('clamps to the range and rejects below the floor', () => {
    expect(parseFloatParam('2', { min: 0, max: 1 })).toBe(1);
    expect(parseFloatParam('-0.5', { min: 0, max: 1 })).toBeNull();
  });
});
