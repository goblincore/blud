import { describe, expect, it } from 'vitest';
import { collectLightSources } from './game-light-list-leaves';

describe('collectLightSources', () => {
  it('maps lamps, tubes, window light, flashlight and flashes to typed sources', () => {
    const s = collectLightSources({
      lamps: [{ pos: [0, 2, 0], color: [1, 0.8, 0.6], intensity: 3, range: 8, room: 2, tube: null, gain: undefined, tint: undefined, mood: 'steady' },
              { pos: [1, 2.2, 0], color: [0.8, 0.9, 1], intensity: 7, range: 6, room: 2, tube: { axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9 }, gain: 1.5, tint: undefined, mood: 'flicker' }],
      window: { dir: [0.9, 0.3, 0.15], color: [0.72, 0.82, 1], intensity: 20, room: 2 },
      flashlight: { pos: [0, 1.6, 0], axis: [0, 0, -1], color: [1, 1, 1], intensity: 90, range: 16, cosOuter: 0.8, cosInner: 0.93 },
      flashes: [{ pos: [0, 1.4, -1], intensity: 35, fire: false }, { pos: [3, 1, 0], intensity: 5, fire: true }],
    });
    expect(s.map(x => `${x.kind}:${x.profile}`)).toEqual(['point:lamp', 'spot:tube', 'directional:window', 'spot:flashlight', 'point:muzzle', 'point:fire']);
    expect(s[1]!.levelGain).toBe(1.5);
    expect(s[3]!.room).toBe(-1);
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
    expect(s[0]).toMatchObject({ axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9, levelTint: [1, 0.5, 0.5], room: 2, range: 6 });
    expect(s[1]).toMatchObject({ axis: [0, 0, -1], cosOuter: 0.8, cosInner: 0.93, range: 16 });
  });
});
