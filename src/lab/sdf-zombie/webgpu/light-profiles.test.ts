import { describe, expect, it } from 'vitest';
import { WINDOW_LIST_TRIM, FLASHLIGHT_LIST_TRIM, LAMP_LIST_TRIM, LIGHT_PROFILES, OLD_BEAM_GAIN, OLD_BODY_FLASH_GAIN, OLD_BODY_LAMP_GAIN, OLD_BODY_WINDOW_GAIN, OLD_KEY, PROFILE_ID, PROFILE_VEC4S, PROFILES_BY_NAME, packProfiles } from './light-profiles';

describe('light profiles (spec §5)', () => {
  it('has the six starting kinds plus the beacon, at most 8', () => {
    expect(Object.keys(PROFILE_ID)).toEqual(['tube', 'lamp', 'window', 'flashlight', 'muzzle', 'fire', 'beacon']);
    expect(LIGHT_PROFILES.length).toBeLessThanOrEqual(8);
  });
  it('beacon (Boiler Room, 7th of 8 slots): the tube\'s calibrated profile with a hard red rim', () => {
    expect(PROFILE_ID.beacon).toBe(6);
    const b = LIGHT_PROFILES[PROFILE_ID.beacon]!, t = PROFILES_BY_NAME.tube;
    expect(b).toBe(PROFILES_BY_NAME.beacon);
    expect(b.rimTint).toEqual([1.3, 0.2, 0.15]);
    expect(b.rimTint[0]).toBeGreaterThan(4 * Math.max(b.rimTint[1], b.rimTint[2]));   // red
    expect(b.backRim).toBe(2.5);
    expect({ ...b, rimTint: t.rimTint, backRim: t.backRim }).toEqual({ ...t });
    const f = packProfiles(), o = PROFILE_ID.beacon * 12;
    expect(f[o]).toBeCloseTo(t.gain, 5);
    expect([f[o + 8], f[o + 9], f[o + 10]].map(v => +v!.toFixed(4))).toEqual([1.3, 0.2, 0.15]);
  });
  it('tube starts from the tuned PRESENT constants', () => {
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!;
    expect(t.gain).toBeCloseTo(4.68 * LAMP_LIST_TRIM, 9); expect(t.viewBias).toBe(0.3); expect(t.floor).toBe(0.18);
    expect(t.backKey).toBe(0.35); expect(t.backRim).toBe(2.5); expect(t.edge).toBe(1.25); expect(t.distFall).toBe(0.06);
  });
  it('gains are the old path\'s body-key conversions (Task 10 calibration)', () => {
    expect(OLD_KEY).toBe(2.4);
    const g = (n: keyof typeof PROFILE_ID) => PROFILES_BY_NAME[n].gain;
    expect(g('tube')).toBeCloseTo(OLD_KEY * OLD_BODY_LAMP_GAIN * 1.3 * LAMP_LIST_TRIM, 9);
    expect(g('lamp')).toBeCloseTo(OLD_KEY * OLD_BODY_LAMP_GAIN * 1.1 * LAMP_LIST_TRIM, 9);
    expect(g("window")).toBeCloseTo(OLD_KEY * OLD_BODY_WINDOW_GAIN * WINDOW_LIST_TRIM, 9);
    expect(g("flashlight")).toBeCloseTo(OLD_BEAM_GAIN * FLASHLIGHT_LIST_TRIM, 9);
    expect(g('muzzle')).toBeCloseTo(OLD_BODY_FLASH_GAIN * 1.45 / 2.25, 9);
    expect(g('fire')).toBeCloseTo(OLD_BODY_FLASH_GAIN * 1.225 / 2.25, 9);
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
  it('beamShoulder (lane b.z): the flashlight moves a body onto the march beam shoulder, no other kind does (owner 2026-09-27)', () => {
    const f = packProfiles();
    for (const name of Object.keys(PROFILE_ID) as (keyof typeof PROFILE_ID)[]) {
      const want = name === 'flashlight' ? 2 : 0;
      expect(PROFILES_BY_NAME[name].beamShoulder).toBe(want);
      expect(f[PROFILE_ID[name] * 12 + 6]).toBe(want);
    }
  });
  it('coverAt (CPU-only): the flashlight judges its cone at the chest, every ceiling/wall light at the feet (owner 2026-09-27)', () => {
    for (const name of Object.keys(PROFILE_ID) as (keyof typeof PROFILE_ID)[]) {
      expect(PROFILES_BY_NAME[name].coverAt).toBe(name === 'flashlight' ? 'chest' : 'feet');
    }
  });
  it('flashlight retune (owner 2026-09-27, judged at the chest): trim 0.43 (was 2.8), distFall 0.01 (was 0.04)', () => {
    const f = PROFILES_BY_NAME.flashlight;
    expect(FLASHLIGHT_LIST_TRIM).toBe(0.43);
    expect(f.gain).toBeCloseTo(4 * 0.43, 9);
    expect(f.distFall).toBe(0.01);
    // Only the flashlight moved: the tube keeps its calibration.
    expect(PROFILES_BY_NAME.tube.distFall).toBe(0.06);
  });
  it('the table is frozen: a runtime write throws and changes nothing (review fix, Task 3)', () => {
    const t = LIGHT_PROFILES[PROFILE_ID.tube]! as { gain: number; rimTint: number[] };
    expect(() => { t.gain = 99; }).toThrow(TypeError);
    expect(() => { t.rimTint[0] = 99; }).toThrow(TypeError);
    expect(() => { (LIGHT_PROFILES as unknown as unknown[]).push({}); }).toThrow(TypeError);
    expect(() => { (PROFILES_BY_NAME as Record<string, unknown>).tube = {}; }).toThrow(TypeError);
    expect(t.gain).toBeCloseTo(4.68 * LAMP_LIST_TRIM, 9);
    expect(t.rimTint[0]).toBe(0.55);
    expect(Object.isFrozen(LIGHT_PROFILES)).toBe(true);
  });
  it('coverFloor is CPU-only: equal to floor today, never packed (review fix, Task 4)', () => {
    for (const p of LIGHT_PROFILES) expect(p.coverFloor).toBe(p.floor);
    const moved = LIGHT_PROFILES.map(p => ({ ...p, coverFloor: 0.77 }));
    expect([...packProfiles(moved)]).toEqual([...packProfiles()]);
  });
});
