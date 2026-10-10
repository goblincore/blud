// src/lab/sdf-zombie/webgpu/level-tier.test.ts
import { describe, expect, it } from 'vitest';
import { buildLightList, packLightList, LIST_LIGHTS_AT, LIGHT_VEC4S, type ListLight, type LightSource } from './light-list';
import {
  LEVEL_PICKS, cheapLevelIndices, decodeCone, distanceAttenuation, isLevelCheap, levelCutoff, levelDecay,
  levelIrradiance, spotFactor,
} from './level-tier';

const light = (over: Partial<ListLight> = {}): ListLight => ({
  kind: 'point', profile: 5, pos: [0, 2, 0], color: [1, 0.5, 0.25], intensity: 1, range: 12,
  axis: [0, -1, 0], cosOuter: 1, cosInner: 1, roomMask: 0, bodyNorm: 1, coverZero: 0, ...over,
});

describe('isLevelCheap — which lights the cheap tier takes', () => {
  it('takes fire-mood lights and shadowless tubes, never beacons or shadowed tubes', () => {
    expect(isLevelCheap({ mood: 'fire' })).toBe(true);
    expect(isLevelCheap({ fixture: 'bulb', mood: 'fire' })).toBe(true);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady', shadow: false })).toBe(true);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady' })).toBe(false);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady', shadow: true })).toBe(false);
    expect(isLevelCheap({ fixture: 'beacon', mood: 'dead' })).toBe(false);
    expect(isLevelCheap({ fixture: 'beacon', mood: 'fire', shadow: false })).toBe(false);
    expect(isLevelCheap({ mood: 'steady' })).toBe(false);
  });
});

describe('cheapLevelIndices — a room\'s cheap lights, as list indices', () => {
  const out = new Array<number>(LEVEL_PICKS).fill(0);
  it('returns the flagged lights that reach the room, in list order, padded with -1', () => {
    const list = [
      light({ levelCheap: true, roomMask: 1 << 5 }),   // 0: room 5, cheap
      light({ roomMask: 1 << 5 }),                     // 1: room 5, not cheap
      light({ levelCheap: true, roomMask: 1 << 3 }),   // 2: room 3
      light({ levelCheap: true, roomMask: 0 }),        // 3: any room
    ];
    expect(cheapLevelIndices(list, 5, out)).toBe(2);
    expect(out).toEqual([0, 3, -1, -1, -1, -1, -1, -1]);
    expect(cheapLevelIndices(list, 3, out)).toBe(2);
    expect(out.slice(0, 3)).toEqual([2, 3, -1]);
    expect(cheapLevelIndices(list, 9, out)).toBe(1);
    expect(out.slice(0, 2)).toEqual([3, -1]);
  });
  it('caps at LEVEL_PICKS and never writes past it', () => {
    const list = Array.from({ length: 12 }, () => light({ levelCheap: true }));
    expect(cheapLevelIndices(list, 1, out)).toBe(LEVEL_PICKS);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('an empty list clears the picks', () => {
    out.fill(3);
    expect(cheapLevelIndices([], 1, out)).toBe(0);
    expect(out.every(v => v === -1)).toBe(true);
  });
});

describe('the falloff twins match three\'s formulas', () => {
  it('distanceAttenuation: 1/max(d^decay, 0.01) x window, or no window at cutoff 0', () => {
    expect(distanceAttenuation(2, 0, 2)).toBeCloseTo(0.25, 9);
    expect(distanceAttenuation(0.05, 0, 2)).toBeCloseTo(100, 9);           // 0.0025 clamps to 0.01
    const w = Math.pow(1 - Math.pow(2 / 8, 4), 2);
    expect(distanceAttenuation(2, 8, 1.2)).toBeCloseTo((1 / Math.pow(2, 1.2)) * w, 9);
    expect(distanceAttenuation(9, 8, 1.2)).toBe(0);                          // past the cutoff
  });
  it('spotFactor: smoothstep(cosOuter, cosInner, cos), guarded against a zero-width penumbra', () => {
    expect(spotFactor(0.5, 0.8, 0.9)).toBe(0);
    expect(spotFactor(0.95, 0.8, 0.9)).toBe(1);
    expect(spotFactor(0.85, 0.8, 0.9)).toBeCloseTo(0.5, 9);
    expect(Number.isFinite(spotFactor(0.9, 0.9, 0.9))).toBe(true);
  });
  it('kind decides decay and cutoff: spots 1.2 with the list range, points 2 with none', () => {
    expect(levelDecay('spot')).toBe(1.2);
    expect(levelDecay('point')).toBe(2);
    expect(levelCutoff({ kind: 'spot', range: 6 })).toBe(6);
    expect(levelCutoff({ kind: 'point', range: 12 })).toBe(0);
  });
});

describe('levelIrradiance — one light\'s contribution to a surface point', () => {
  it('a point light straight above a floor point: n.L 1, colour / d^2', () => {
    const e = levelIrradiance(light({ pos: [0, 2, 0], color: [1, 0.5, 0.25] }), [0, 0, 0], [0, 1, 0]);
    expect(e[0]).toBeCloseTo(0.25, 9); expect(e[1]).toBeCloseTo(0.125, 9); expect(e[2]).toBeCloseTo(0.0625, 9);
  });
  it('a surface facing away gets nothing', () => {
    expect(levelIrradiance(light(), [0, 0, 0], [0, -1, 0])).toEqual([0, 0, 0]);
  });
  it('a spot lights inside its cone and not outside it', () => {
    const spot = light({ kind: 'spot', pos: [0, 3, 0], axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), range: 6.6 });
    const inside = levelIrradiance(spot, [0, 0, 0], [0, 1, 0]);
    const outside = levelIrradiance(spot, [6, 0, 0], [0, 1, 0]);
    expect(inside[0]).toBeGreaterThan(0);
    expect(outside).toEqual([0, 0, 0]);
  });
});

describe('decodeCone — the WGSL and the CPU read the packed cone the same way', () => {
  it('round-trips packLightList\'s cone within the 1e-3 the packing keeps', () => {
    const src: LightSource = { kind: 'spot', profile: 'tube', pos: [0, 3, 0], color: [1, 1, 1], intensity: 1, range: 6.6,
      axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45) };
    const list = buildLightList([src]);
    const floats = packLightList(list);
    const cone = floats[(LIST_LIGHTS_AT + 2) * 4 + 3]!;
    const c = decodeCone(cone);
    expect(c.cosOuter).toBeCloseTo(Math.cos(0.6), 2);
    expect(Math.abs(c.cosOuter - Math.cos(0.6))).toBeLessThan(1.1e-3);
    expect(c.cosInner).toBeCloseTo(Math.cos(0.45), 3);
    expect(LIGHT_VEC4S).toBe(4);
  });
});
