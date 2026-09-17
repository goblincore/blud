// What this protects: the CLAMP BOUNDS, which are the load-bearing part of the
// module — the panel's sliders read their ranges from BURN_BOUNDS, and the game
// setter will pass user numbers straight in. The preset round-trip works
// because each preset is a FULL record, so it also catches crossed keys
// (glowGain reading p.glowThreshold) wherever two defaults differ, and proves
// the defaults themselves sit inside their own bounds — which the
// "resolves to the defaults" test cannot, since the undefined path skips the
// clamp entirely.
import { describe, it, expect } from 'vitest';
import { BURN_BOUNDS, BURN_TUNING, burnPresets, resolveBurnTuning, type BurnTuning } from './burn-profiles';
import { stepBurn, createBurnState, igniteBurn } from '../burn-state';

describe('burn tuning', () => {
  it('resolves to the defaults when given nothing', () => {
    expect(resolveBurnTuning()).toEqual(BURN_TUNING);
  });

  it('bounds runtime inputs without propagating non-finite values', () => {
    const r = resolveBurnTuning({
      igniteSec: Number.NaN, charRate: Number.POSITIVE_INFINITY,
      fireGain: 999, noiseScale: -5, lightPeak: -1,
    });
    expect(r.igniteSec).toBe(BURN_TUNING.igniteSec);
    expect(r.charRate).toBe(BURN_TUNING.charRate);
    expect(r.fireGain).toBe(4);
    expect(r.noiseScale).toBe(0.5);
    expect(r.lightPeak).toBe(0);
  });

  it('keeps every preset inside the clamp (a preset must be reachable)', () => {
    for (const [name, preset] of Object.entries(burnPresets)) {
      expect(resolveBurnTuning(preset), name).toEqual(preset);
    }
  });

  it('clamps every field at both rails and falls back on junk', () => {
    // Table-driven so a field cannot be left half-covered: a hand-written list
    // of five fields is how a widened max (fireGain: [0, 40]) stays invisible.
    for (const key of Object.keys(BURN_TUNING) as (keyof BurnTuning)[]) {
      const [min, max] = BURN_BOUNDS[key];
      expect(resolveBurnTuning({ [key]: min - 1 })[key], `${key} below min`).toBe(min);
      expect(resolveBurnTuning({ [key]: max + 1 })[key], `${key} above max`).toBe(max);
      expect(resolveBurnTuning({ [key]: Number.NaN })[key], `${key} NaN`).toBe(BURN_TUNING[key]);
      expect(BURN_TUNING[key], `${key} default inside its own bounds`)
        .toBeGreaterThanOrEqual(min);
      expect(BURN_TUNING[key], `${key} default inside its own bounds`).toBeLessThanOrEqual(max);
    }
  });

  it('is accepted by stepBurn as a BurnRates value (BurnTuning is a structural superset)', () => {
    // The type annotation is the compile-level half of this; the assertions are
    // the runtime half, so the test fails if the relationship stops meaning
    // anything rather than just if stepBurn learns to throw.
    const tuning: BurnTuning = BURN_TUNING;
    const state = createBurnState();
    igniteBurn(state);
    stepBurn(state, BURN_TUNING.igniteSec, tuning);
    expect(state.burn).toBeCloseTo(1, 6);
    expect(state.char).toBeGreaterThan(0);
  });
});
