import { describe, it, expect } from 'vitest';
import { createBurnState, igniteBurn, extinguishBurn, stepBurn, forceBurn } from './burn-state';

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

  it('re-ignites mid-decay, resuming the ramp without resetting burnSec', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);                      // burn = 1, burnSec = 1
    extinguishBurn(s);
    stepBurn(s, 0.1, T);                    // burn -= 0.1/0.25 = 0.4 -> 0.6; burnSec += 0.1
    expect(s.burn).toBeCloseTo(0.6, 6);
    expect(s.burnSec).toBeCloseTo(1.1, 6);
    igniteBurn(s);
    stepBurn(s, 0.1, T);                    // burn += 0.1/0.5 = 0.2 -> 0.8, resuming from 0.6
    expect(s.burn).toBeCloseTo(0.8, 6);
    expect(s.burnSec).toBeCloseTo(1.2, 6);  // kept accumulating across the re-ignite
  });

  it('keeps accumulating burnSec through the extinguish tail while burn stays > 0, even though alight is false', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);                      // burn = 1, burnSec = 1
    extinguishBurn(s);
    expect(s.alight).toBe(false);
    stepBurn(s, 0.1, T);                    // burn -> 0.6, still > 0
    expect(s.burn).toBeGreaterThan(0);
    expect(s.burnSec).toBeCloseTo(1.1, 6);
  });

  it('does not let a NaN rate poison burn with NaN', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, { ...T, igniteSec: Number.NaN });
    expect(Number.isFinite(s.burn)).toBe(true);
    expect(s.burn).toBe(0);
  });

  it('never lets a negative charRate lower char', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);                      // burn saturates at 1, char > 0
    const charBefore = s.char;
    expect(charBefore).toBeGreaterThan(0);
    stepBurn(s, 1, { ...T, charRate: -5 }); // still alight, burn stays saturated at 1
    expect(s.char).toBe(charBefore);
  });
});

describe('forceBurn', () => {
  it('clamps burn and char, sets alight from burn, and resets burnSec', () => {
    const s = createBurnState();
    forceBurn(s, 1.5, 2);
    expect(s.burn).toBe(1);
    expect(s.char).toBe(1);
    expect(s.alight).toBe(true);
    expect(s.burnSec).toBe(0);
  });

  it('never lowers char below its current value', () => {
    const s = createBurnState();
    forceBurn(s, 0.5, 0.8);
    expect(s.char).toBe(0.8);
    forceBurn(s, 0, -1);                    // clamped new char (0) can't lower it
    expect(s.burn).toBe(0);
    expect(s.alight).toBe(false);
    expect(s.char).toBe(0.8);
    forceBurn(s, 1, 0.3);                   // a lower but valid char still can't lower it
    expect(s.char).toBe(0.8);
  });
});
