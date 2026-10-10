// src/lab/sdf-zombie/webgpu/near-light-pick.test.ts
import { describe, expect, it } from 'vitest';
import { CONE_FLOOR, distanceFalloff, nearLightWeight, pickNearLights, type NearLightCand } from './near-light-pick';

const point = (id: number, x: number, power = 1, distance = 0, decay = 2): NearLightCand =>
  ({ id, kind: 'point', pos: [x, 0, 0], power, distance, decay });
const spotDown = (id: number, x: number, power = 1, distance = 6): NearLightCand =>
  ({ id, kind: 'spot', pos: [x, 2.5, 0], power, distance, decay: 1, axis: [0, -1, 0], cosOuter: Math.cos(0.5) });

describe('distanceFalloff: three\'s punctual falloff', () => {
  it('is the inverse power law with no cutoff, capped near the light', () => {
    expect(distanceFalloff(2, 0, 2)).toBeCloseTo(0.25, 12);
    expect(distanceFalloff(0.01, 0, 2)).toBe(100);
  });
  it('is exactly zero at and beyond the cutoff', () => {
    expect(distanceFalloff(5.72, 5.72, 1)).toBe(0);
    expect(distanceFalloff(9, 5.72, 1)).toBe(0);
    expect(distanceFalloff(3, 5.72, 1)).toBeGreaterThan(0);
  });
});

describe('nearLightWeight', () => {
  it('is zero for an unlit light and for one out of range, so neither can take a slot', () => {
    expect(nearLightWeight(point(1, 1, 0), [0, 0, 0])).toBe(0);
    expect(nearLightWeight(point(1, 20, 5, 16), [0, 0, 0])).toBe(0);
  });
  it('ranks a spot whose cone holds the point above the same spot aimed away, which still ranks', () => {
    const under = nearLightWeight(spotDown(1, 0), [0, 1.6, 0]);
    const beside = nearLightWeight({ ...spotDown(1, 0), pos: [0.9, 2.5, 0] }, [0, 1.6, 0]);
    const away = nearLightWeight({ ...spotDown(1, 0), axis: [0, 1, 0] }, [0, 1.6, 0]);
    expect(under).toBeGreaterThan(beside);
    expect(away).toBeGreaterThan(0);
    expect(away / under).toBeCloseTo(CONE_FLOOR, 6);
  });
});

describe('pickNearLights', () => {
  const at: [number, number, number] = [0, 0, 0];
  it('takes the strongest at the point, by kind, and leaves spare slots empty', () => {
    const cands = [point(10, 8), point(11, 1), point(12, 3), spotDown(20, 0), point(13, 2, 0)];
    const p = pickNearLights(cands, at, { point: 2, spot: 2 });
    expect(new Set(p.point)).toEqual(new Set([11, 12]));
    expect(p.spot).toEqual([20, -1]);
  });
  it('does not depend on the order of the candidates', () => {
    const cands = [point(1, 1), point(2, 1), point(3, 1), point(4, 5)];
    const a = pickNearLights(cands, at, { point: 2, spot: 0 });
    const b = pickNearLights([...cands].reverse(), at, { point: 2, spot: 0 });
    expect(a.point).toEqual([1, 2]);
    expect(b.point).toEqual([1, 2]);
  });
  it('keeps a light in its slot while it stays chosen, and gives a leaver\'s slot to the newcomer', () => {
    const first = pickNearLights([point(1, 1), point(2, 2), point(3, 9)], at, { point: 2, spot: 0 });
    expect(first.point).toEqual([1, 2]);
    // The eye moves: light 1 falls behind light 3; light 2 stays. Light 2 must stay in slot 1.
    const next = pickNearLights([point(1, 30), point(2, 2), point(3, 1)], at, { point: 2, spot: 0 }, first);
    expect(next.point).toEqual([3, 2]);
  });
  it('a light that goes dark leaves its slot empty when nothing else is in reach', () => {
    const first = pickNearLights([point(1, 1)], at, { point: 2, spot: 0 });
    const next = pickNearLights([point(1, 1, 0)], at, { point: 2, spot: 0 }, first);
    expect(next.point).toEqual([-1, -1]);
  });
});
