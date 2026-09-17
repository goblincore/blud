import { describe, it, expect } from 'vitest';
import { createBurnState, igniteBurn, extinguishBurn, stepBurn } from './burn-state';

const T = { igniteSec: 0.5, extinguishSec: 0.25, charRate: 0.4 };

describe('burn state', () => {
  it('starts cold', () => {
    const s = createBurnState();
    expect(s).toEqual({ burn: 0, burnSec: 0, char: 0, alight: false });
  });

  it('ramps burn to 1 over igniteSec and no further', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 0.25, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, 0.25, T);
    expect(s.burn).toBeCloseTo(1, 6);
    stepBurn(s, 1, T);
    expect(s.burn).toBe(1);
  });

  it('accumulates burnSec and char only while burning, and char never falls', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);            // burn saturates at 1 partway through
    expect(s.burnSec).toBeCloseTo(1, 6);
    const charAtOne = s.char;
    expect(charAtOne).toBeGreaterThan(0);
    extinguishBurn(s);
    stepBurn(s, 1, T);            // decays to cold
    expect(s.burn).toBe(0);
    expect(s.char).toBeGreaterThanOrEqual(charAtOne);
    const cold = s.char;
    stepBurn(s, 5, T);            // cold bodies stop accumulating
    expect(s.char).toBe(cold);
    expect(s.burnSec).toBe(0);
  });

  it('char saturates at 1', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 60, T);
    expect(s.char).toBe(1);
  });

  it('decays to 0 over extinguishSec and survives junk dt', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);
    extinguishBurn(s);
    stepBurn(s, 0.125, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, Number.NaN, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, -3, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
  });
});
