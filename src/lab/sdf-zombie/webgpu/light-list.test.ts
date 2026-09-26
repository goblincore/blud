import { describe, expect, it } from 'vitest';
import { LIST_CAP, LIST_HEADER, LIST_LIGHTS_AT, LIST_VEC4S, buildLightList, packLightList, type LightSource } from './light-list';
import { PROFILE_ID } from './light-profiles';

const tube = (x: number, i: number): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, 0], color: [0.8, 0.9, 1], intensity: i, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), room: 3 });

describe('light list (spec §4)', () => {
  it('drops dark lights and caps at 32, keeping the strongest', () => {
    const src = Array.from({ length: 40 }, (_, i) => tube(i, i));   // i = 0 is dark
    const l = buildLightList(src);
    expect(l.length).toBe(LIST_CAP);
    expect(l.every(x => x.intensity > 0)).toBe(true);
    expect(Math.min(...l.map(x => x.intensity))).toBe(8);
  });
  it('is deterministic: ties keep source order', () => {
    const a = buildLightList([tube(1, 5), tube(2, 5)]);
    expect(a.map(x => x.pos[0])).toEqual([1, 2]);
  });
  it('folds the level gain and tint into the colour', () => {
    // intensity 2 x gain 1.5 = 3; the tint is normalised by its largest channel (hue only)
    const [l] = buildLightList([{ ...tube(0, 2), levelGain: 1.5, levelTint: [1, 0.5, 0.5] }]);
    expect(l!.color[0]).toBeCloseTo(0.8 * 3, 5);
    expect(l!.color[1]).toBeCloseTo(0.9 * 3 * 0.5, 5);
    expect(l!.color[2]).toBeCloseTo(1 * 3 * 0.5, 5);
    expect(l!.intensity).toBe(3);
  });
  it('packs the header and the documented lanes', () => {
    const f = packLightList(buildLightList([tube(1, 2)]));
    expect(f.length).toBe(LIST_VEC4S * 4);
    expect(f[LIST_HEADER * 4]).toBe(1);
    const o = LIST_LIGHTS_AT * 4;
    expect(f[o + 3]).toBe(1);                       // kind spot
    expect(f[o + 7]).toBe(6);                       // range
    expect(f[o + 12]).toBe(PROFILE_ID.tube);        // profile
    expect(f[o + 13]).toBe(-1);                     // no shadow slot in plan 1
    const cone = f[o + 11]!;
    expect(Math.floor(cone) / 1000).toBeCloseTo(Math.cos(0.6), 2);
    expect((cone - Math.floor(cone)) / 0.999).toBeCloseTo(Math.cos(0.45), 3);
  });
  it('directional lights store a unit direction', () => {
    const f = packLightList(buildLightList([{ kind: 'directional', profile: 'window', pos: [3, 1, 0], color: [1, 1, 1], intensity: 4, range: 0, room: -1 }]));
    const o = LIST_LIGHTS_AT * 4;
    expect(Math.hypot(f[o]!, f[o + 1]!, f[o + 2]!)).toBeCloseTo(1, 5);
    expect(f[o + 3]).toBe(2);
  });
  it('clamps an inverted spot cone to a hard edge: cosInner >= cosOuter (review fix, Task 3)', () => {
    const [l] = buildLightList([{ ...tube(0, 5), cosOuter: Math.cos(0.45), cosInner: Math.cos(0.6) }]);
    expect(l!.cosInner).toBe(l!.cosOuter);
    expect(l!.cosOuter).toBe(Math.cos(0.45));
    const [ok] = buildLightList([tube(0, 5)]);
    expect(ok!.cosInner).toBe(Math.cos(0.45));
    expect(ok!.cosOuter).toBe(Math.cos(0.6));
  });
});
