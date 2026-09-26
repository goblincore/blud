import { describe, expect, it } from 'vitest';
import { LIGHT_PROFILES, PROFILE_ID, PROFILE_VEC4S, PROFILES_BY_NAME, packProfiles } from './light-profiles';

describe('light profiles (spec §5)', () => {
  it('has the six starting kinds, at most 8', () => {
    expect(Object.keys(PROFILE_ID)).toEqual(['tube', 'lamp', 'window', 'flashlight', 'muzzle', 'fire']);
    expect(LIGHT_PROFILES.length).toBeLessThanOrEqual(8);
  });
  it('tube starts from the tuned PRESENT constants', () => {
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!;
    expect(t.gain).toBe(1.3); expect(t.viewBias).toBe(0.3); expect(t.floor).toBe(0.18);
    expect(t.backKey).toBe(0.35); expect(t.backRim).toBe(2.5); expect(t.edge).toBe(1.25); expect(t.distFall).toBe(0.06);
  });
  it('window carries the cold lightning rim tint', () => {
    expect(LIGHT_PROFILES[PROFILE_ID.window]!.rimTint).toEqual([0.55, 0.75, 1.3]);
  });
  it('table order always follows PROFILE_ID, never comment order (review fix)', () => {
    expect(LIGHT_PROFILES.length).toBe(Object.keys(PROFILE_ID).length);
    for (const name of Object.keys(PROFILE_ID) as (keyof typeof PROFILE_ID)[]) {
      expect(LIGHT_PROFILES[PROFILE_ID[name]]).toBe(PROFILES_BY_NAME[name]);
    }
  });
  it('packs 8 x 3 vec4 in the documented lane order', () => {
    const f = packProfiles();
    expect(f.length).toBe(8 * PROFILE_VEC4S * 4);
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!, o = PROFILE_ID.tube * 12;
    expect([...f.slice(o, o + 4)]).toEqual([t.gain, t.viewBias, t.floor, t.backKey].map(Math.fround));
    expect([...f.slice(o + 4, o + 8)]).toEqual([t.backRim, t.spec, 0, t.specPow].map(Math.fround));
    expect([...f.slice(o + 8, o + 11)]).toEqual(t.rimTint.map(Math.fround));
  });
  it('the table is frozen: a runtime write throws and changes nothing (review fix, Task 3)', () => {
    const t = LIGHT_PROFILES[PROFILE_ID.tube]! as { gain: number; rimTint: number[] };
    expect(() => { t.gain = 99; }).toThrow(TypeError);
    expect(() => { t.rimTint[0] = 99; }).toThrow(TypeError);
    expect(() => { (LIGHT_PROFILES as unknown as unknown[]).push({}); }).toThrow(TypeError);
    expect(() => { (PROFILES_BY_NAME as Record<string, unknown>).tube = {}; }).toThrow(TypeError);
    expect(t.gain).toBe(1.3);
    expect(t.rimTint[0]).toBe(0.55);
    expect(Object.isFrozen(LIGHT_PROFILES)).toBe(true);
  });
  it('coverFloor is CPU-only: equal to floor today, never packed (review fix, Task 4)', () => {
    for (const p of LIGHT_PROFILES) expect(p.coverFloor).toBe(p.floor);
    const moved = LIGHT_PROFILES.map(p => ({ ...p, coverFloor: 0.77 }));
    expect([...packProfiles(moved)]).toEqual([...packProfiles()]);
  });
});
