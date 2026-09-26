import { describe, expect, it } from 'vitest';
import { collectLightSources, maskRooms, nearRoomMask, type TunnelLink } from './game-light-list-leaves';
import { buildLightList, roomMaskOf } from './light-list';
import { lightPresence } from './light-pick';

describe('collectLightSources', () => {
  it('maps lamps, tubes, window light, flashlight and flashes to typed sources', () => {
    const s = collectLightSources({
      lamps: [{ pos: [0, 2, 0], color: [1, 0.8, 0.6], intensity: 3, range: 8, room: 2, tube: null, gain: undefined, tint: undefined, mood: 'steady' },
              { pos: [1, 2.2, 0], color: [0.8, 0.9, 1], intensity: 7, range: 6, room: 2, tube: { axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9 }, gain: 1.5, tint: undefined, mood: 'flicker' }],
      window: { dir: [0.9, 0.3, 0.15], color: [0.72, 0.82, 1], intensity: 20, rooms: [1, 2, 3, 4, 5, 6, 8] },
      flashlight: { pos: [0, 1.6, 0], axis: [0, 0, -1], color: [1, 1, 1], intensity: 90, range: 16, cosOuter: 0.8, cosInner: 0.93 },
      flashes: [{ pos: [0, 1.4, -1], intensity: 35, fire: false }, { pos: [3, 1, 0], intensity: 5, fire: true }],
    });
    expect(s.map(x => `${x.kind}:${x.profile}`)).toEqual(['point:lamp', 'spot:tube', 'directional:window', 'spot:flashlight', 'point:muzzle', 'point:fire']);
    expect(s[1]!.levelGain).toBe(1.5);
    expect(s[0]!.rooms).toEqual([2]);
    expect(s[2]!.rooms).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(s[3]!.rooms).toBeUndefined();   // the flashlight: any room
    expect(s[4]!.rooms).toBeUndefined();
  });
  it('a lamp with mood fire gets the fire profile; zero-intensity sources are kept (the list drops them)', () => {
    const s = collectLightSources({ lamps: [{ pos: [0, 1, 0], color: [1, 0.6, 0.3], intensity: 0, range: 5, room: 1, tube: null, mood: 'fire' }], window: null, flashlight: null, flashes: [] });
    expect(s[0]!.profile).toBe('fire');
  });
  it('fire sources (fire-mood lamps and burning-body flashes) reach only 3 m', () => {
    const s = collectLightSources({
      lamps: [{ pos: [0, 1, 0], color: [1, 0.6, 0.3], intensity: 4, range: 12, room: 1, tube: null, mood: 'fire' }],
      window: null, flashlight: null,
      flashes: [{ pos: [3, 1, 0], intensity: 5, fire: true }],
    });
    expect(s.map(x => x.range)).toEqual([3, 3]);
  });
  it('the tube cone, the flashlight cone and the level tint pass through', () => {
    const s = collectLightSources({
      lamps: [{ pos: [1, 2.2, 0], color: [1, 1, 1], intensity: 7, range: 6, room: 2, tube: { axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9 }, tint: [1, 0.5, 0.5], mood: 'steady' }],
      window: null,
      flashlight: { pos: [0, 1.6, 0], axis: [0, 0, -1], color: [1, 1, 1], intensity: 90, range: 16, cosOuter: 0.8, cosInner: 0.93 },
      flashes: [],
    });
    expect(s[0]).toMatchObject({ axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9, levelTint: [1, 0.5, 0.5], rooms: [2], range: 6 });
    expect(s[1]).toMatchObject({ axis: [0, 0, -1], cosOuter: 0.8, cosInner: 0.93, range: 16 });
  });
});

// Night Train's tunnels (public/assets/levels/night-train.level.json): 1-2-3-6-4-5-7-8 along z.
const link = (a: number, b: number, z: number): TunnelLink => ({ a, b, minX: -1, maxX: 1, minZ: z - 0.5, maxZ: z + 0.5 });
const TRAIN: TunnelLink[] = [link(1, 2, -10), link(2, 3, -20), link(3, 6, -30), link(4, 5, -50), link(5, 7, -60), link(6, 4, -40), link(7, 8, -70)];

describe('nearRoomMask (Task 6 review: the cap prefers the player\'s surroundings)', () => {
  it('the player\'s room plus every room a tunnel joins to it', () => {
    expect(maskRooms(nearRoomMask(TRAIN, 3, 0, -25))).toEqual([2, 3, 6]);
    expect(maskRooms(nearRoomMask(TRAIN, 4, 0, -45))).toEqual([4, 5, 6]);
    expect(maskRooms(nearRoomMask(TRAIN, 8, 0, -75))).toEqual([7, 8]);
  });
  it('in a tunnel (room -1): the rooms of the tunnel the player stands in; nowhere: 0 (distance only)', () => {
    expect(maskRooms(nearRoomMask(TRAIN, -1, 0, -60.2))).toEqual([5, 7]);
    expect(nearRoomMask(TRAIN, -1, 5, -60)).toBe(0);
  });
  it('a room id past the mask gives 0 (no tier), never a wrong tier', () => {
    expect(nearRoomMask([link(2, 40, 0)], 2, 0, 5)).toBe(0);
  });
});

describe('the storm window light through the list (Task 6 review: room mask)', () => {
  it('lights bodies in carriages 2 and 4, not the windowless tender (7)', () => {
    const list = buildLightList(collectLightSources({
      lamps: [], flashlight: null, flashes: [],
      window: { dir: [0.9, 0.3, 0.15], color: [0.72, 0.82, 1], intensity: 20, rooms: [1, 2, 3, 4, 5, 6, 8] },
    }), { pos: [0, 1.6, -25], nearMask: roomMaskOf([2, 3, 6]) });
    expect(list).toHaveLength(1);
    const b = (room: number) => ({ pos: [0, 0.9, 0] as [number, number, number], room, facing: [1, 0] as [number, number] });
    expect(lightPresence(list[0]!, b(2))).toBeGreaterThan(0);
    expect(lightPresence(list[0]!, b(4))).toBeGreaterThan(0);
    expect(lightPresence(list[0]!, b(7))).toBe(0);
  });
  it('an empty room set (a storm with no window lights) is any room', () => {
    const [l] = buildLightList(collectLightSources({ lamps: [], flashlight: null, flashes: [], window: { dir: [0, 1, 0], color: [1, 1, 1], intensity: 5, rooms: [] } }));
    expect(l!.roomMask).toBe(0);
  });
});
