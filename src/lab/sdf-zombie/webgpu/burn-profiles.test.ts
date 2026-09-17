import { describe, it, expect } from 'vitest';
import { BURN_TUNING, burnPresets, resolveBurnTuning, type BurnTuning } from './burn-profiles';
import { stepBurn, createBurnState } from '../burn-state';

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

  it('is accepted by stepBurn as a BurnRates value (BurnTuning is a structural superset)', () => {
    const tuning: BurnTuning = BURN_TUNING;
    const state = createBurnState();
    state.alight = true;
    expect(() => stepBurn(state, 1 / 60, tuning)).not.toThrow();
  });
});
