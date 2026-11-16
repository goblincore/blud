import { describe, expect, it } from 'vitest';
import { ROCKET_LIGHT, nearestRockets, nozzleOf, rocketLightGainFrom, rocketLightLevel } from './rocket-light';
import type { Vec3 } from '../types';

describe('rocket light', () => {
  it('sits behind the rocket, along its flight', () => {
    const p = nozzleOf([1, 2, 3], [0, 0, -10]);
    expect(p[0]).toBeCloseTo(1); expect(p[1]).toBeCloseTo(2); expect(p[2]).toBeCloseTo(3 + ROCKET_LIGHT.backM);
    expect(nozzleOf([1, 2, 3], [0, 0, 0])).toEqual([1, 2, 3]);
  });

  it('ramps up off the muzzle, then burns between 1 - depth and 1', () => {
    expect(rocketLightLevel(0, 0)).toBe(0);
    expect(rocketLightLevel(-1, 0)).toBe(0);
    expect(rocketLightLevel(ROCKET_LIGHT.rampSec / 2, 0)).toBeLessThan(rocketLightLevel(ROCKET_LIGHT.rampSec, 0) + 1e-9);
    let lo = 1, hi = 0;
    for (let t = ROCKET_LIGHT.rampSec; t < 2; t += 0.004) {
      const l = rocketLightLevel(t, 0.7);
      lo = Math.min(lo, l); hi = Math.max(hi, l);
    }
    expect(lo).toBeGreaterThanOrEqual(1 - ROCKET_LIGHT.flicker - 1e-9);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(ROCKET_LIGHT.flicker * 0.5);   // it does flicker
    expect(rocketLightLevel(1, 0, 0)).toBe(1);
  });

  it('gives the pool to the rockets nearest the eye, nearest first, without reordering the input', () => {
    const src = [{ pos: [5, 0, 0] as Vec3 }, { pos: [1, 0, 0] as Vec3 }, { pos: [9, 0, 0] as Vec3 }, { pos: [2, 0, 0] as Vec3 }];
    expect(nearestRockets(src, [0, 0, 0], 2).map(s => s.pos[0])).toEqual([1, 2]);
    expect(nearestRockets(src.slice(0, 1), [0, 0, 0], 2)).toHaveLength(1);
    expect(src.map(s => s.pos[0])).toEqual([5, 1, 9, 2]);
  });

  it('reads ?rocketlight= as a clamped gain, 1 by default', () => {
    expect(rocketLightGainFrom('')).toBe(1);
    expect(rocketLightGainFrom('?rocketlight=0')).toBe(0);
    expect(rocketLightGainFrom('?rocketlight=2')).toBe(2);
    expect(rocketLightGainFrom('?rocketlight=99')).toBe(4);
    expect(rocketLightGainFrom('?rocketlight=-1')).toBe(1);
    expect(rocketLightGainFrom('?rocketlight=x')).toBe(1);
  });
});
