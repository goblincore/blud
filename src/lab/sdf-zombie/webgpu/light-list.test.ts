import { describe, expect, it } from 'vitest';
import { LIST_CAP, LIST_HEADER, LIST_LIGHTS_AT, LIST_VEC4S, ROOM_MASK_BITS, buildLightList, maskHasRoom, packLightList, roomMaskOf, type LightSource } from './light-list';
import { PROFILE_ID } from './light-profiles';

const tube = (x: number, i: number): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, 0], color: [0.8, 0.9, 1], intensity: i, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), rooms: [3] });

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
    const f = packLightList(buildLightList([{ kind: 'directional', profile: 'window', pos: [3, 1, 0], color: [1, 1, 1], intensity: 4, range: 0 }]));
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

describe('the cap prefers the player\'s surroundings (Task 6 review)', () => {
  const lamp = (x: number, z: number, i: number, room: number): LightSource => ({ kind: 'point', profile: 'lamp', pos: [x, 2, z], color: [1, 0.8, 0.6], intensity: i, range: 8, rooms: [room] });
  // Night Train shape: carriages in a line along z. The player in room 2, joined to 1 and 3.
  const rel = { pos: [0, 1.6, 0] as [number, number, number], nearMask: roomMaskOf([1, 2, 3]) };
  it('40 bright far lights and 3 dim near ones: the 3 near are kept', () => {
    const far = Array.from({ length: 40 }, (_, i) => lamp(0, -40 - i, 50, 5 + (i % 3)));
    const near = [lamp(1, 0, 0.5, 2), lamp(-1, 3, 0.4, 2), lamp(0, 8, 0.3, 3)];
    const l = buildLightList([...far, ...near], rel);
    expect(l.length).toBe(LIST_CAP);
    for (const n of near) expect(l.some(x => x.pos[2] === n.pos[2] && x.intensity === n.intensity)).toBe(true);
    // near first, then the far ones by intensity / (1 + d²): the closest far lamps win the rest
    expect(l.slice(0, 3).every(x => x.intensity < 1)).toBe(true);
    expect(Math.min(...l.slice(3).map(x => x.pos[2]))).toBe(-40 - 28);
  });
  it('without a context, the strongest win (the level-wide cap)', () => {
    const far = Array.from({ length: 40 }, (_, i) => lamp(0, -40 - i, 50, 5));
    const l = buildLightList([...far, lamp(1, 0, 0.5, 2)]);
    expect(l.some(x => x.intensity === 0.5)).toBe(false);
  });
  it('any-room lights are in the near tier; within a tier the closer light ranks first', () => {
    const flash: LightSource = { kind: 'point', profile: 'muzzle', pos: [0, 1.4, -30], color: [1, 0.81, 0.58], intensity: 35, range: 8 };
    const l = buildLightList([lamp(0, -60, 50, 7), flash, lamp(0, 1, 2, 2), lamp(0, 6, 2, 2)], rel);
    expect(l.map(x => x.pos[2])).toEqual([1, 6, -30, -60]);
  });
  it('an unknown surroundings mask (0) ranks everything by distance alone; ties keep source order', () => {
    const l = buildLightList([lamp(0, 10, 5, 7), lamp(0, 2, 5, 5), lamp(0, -2, 5, 6)], { pos: [0, 2, 0], nearMask: 0 });
    expect(l.map(x => x.pos[2])).toEqual([2, -2, 10]);
  });
});

describe('room mask (Task 6 review)', () => {
  it('a room set becomes a bitmask; absent, empty or negative = any (0)', () => {
    expect(roomMaskOf([1, 2, 3, 4, 5, 6, 8])).toBe(0b1_0111_1110);
    expect(roomMaskOf(undefined)).toBe(0);
    expect(roomMaskOf([])).toBe(0);
    expect(roomMaskOf([2, -1])).toBe(0);
  });
  it('an id past the mask widens the light to any room', () => {
    expect(roomMaskOf([ROOM_MASK_BITS])).toBe(0);
    expect(roomMaskOf([30])).toBeGreaterThan(0);
  });
  it('maskHasRoom: any-room lights and unknown-room bodies always match', () => {
    const m = roomMaskOf([2, 4]);
    expect(maskHasRoom(m, 2)).toBe(true);
    expect(maskHasRoom(m, 4)).toBe(true);
    expect(maskHasRoom(m, 7)).toBe(false);
    expect(maskHasRoom(m, 40)).toBe(false);
    expect(maskHasRoom(m, -1)).toBe(true);
    expect(maskHasRoom(0, 7)).toBe(true);
  });
  it('the list carries the mask', () => {
    const [l] = buildLightList([{ kind: 'directional', profile: 'window', pos: [1, 0.3, 0], color: [1, 1, 1], intensity: 4, range: 0, rooms: [1, 2] }]);
    expect(l!.roomMask).toBe(0b110);
  });
});
