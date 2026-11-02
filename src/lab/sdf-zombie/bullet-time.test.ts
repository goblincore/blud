import { describe, expect, it } from 'vitest';
import {
  BULLET_TIME, BULLET_TIME_DEFAULTS, BULLET_TIME_KNOBS, BULLET_TIME_RANGES, airScaleAt, applyBulletTimeTuning, bulletTimeFromParams,
  bulletTimeKnobs, goreBoostAt, makeBulletTime, pickWakes, scalesAt, stepBulletTime, toggleBulletTime, worldScaleAt,
  type BulletTimeTuning,
} from './bullet-time';

describe('bullet time ramp', () => {
  it('runs the world at full speed until toggled', () => {
    const s = makeBulletTime();
    expect(stepBulletTime(s, 1 / 30)).toBe(1);
    expect(s.intensity).toBe(0);
  });

  it('eases to worldScale over rampSec of real time, and back out', () => {
    const s = makeBulletTime();
    toggleBulletTime(s);
    const half = stepBulletTime(s, BULLET_TIME.rampSec / 2);
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(BULLET_TIME.worldScale);
    expect(stepBulletTime(s, BULLET_TIME.rampSec)).toBeCloseTo(BULLET_TIME.worldScale, 9);
    toggleBulletTime(s);
    expect(stepBulletTime(s, BULLET_TIME.rampSec)).toBe(1);
  });

  it('maps intensity endpoints exactly', () => {
    expect(worldScaleAt(0)).toBe(1);
    expect(worldScaleAt(1)).toBeCloseTo(BULLET_TIME.worldScale, 12);
    expect(worldScaleAt(1, BULLET_TIME.shotScale)).toBeCloseTo(BULLET_TIME.shotScale, 12);
  });
});

describe('scalesAt', () => {
  it('is all 1 at normal time', () => {
    expect(scalesAt(0)).toEqual({ move: 1, aim: 1, fire: 1, reload: 1, shot: 1, air: 1 });
  });
  it('fully in: each player scale at its own knob, its shots at shotScale, the jump hang absolute at airScale', () => {
    const s = scalesAt(1);
    expect(s.move).toBeCloseTo(BULLET_TIME.moveScale, 12);
    expect(s.aim).toBeCloseTo(BULLET_TIME.aimScale, 12);
    expect(s.fire).toBeCloseTo(BULLET_TIME.fireScale, 12);
    expect(s.reload).toBeCloseTo(BULLET_TIME.reloadScale, 12);
    expect(s.shot).toBeCloseTo(BULLET_TIME.shotScale, 12);
    expect(s.move * s.air).toBeCloseTo(BULLET_TIME.airScale, 12);
  });
  it('ships the original numbers: every player scale 0.35 (the 0.66 / 0.6 try was reverted), the apex hang 0.2', () => {
    expect(BULLET_TIME_DEFAULTS.moveScale).toBe(0.35);
    expect(BULLET_TIME_DEFAULTS.reloadScale).toBe(0.35);
    expect(BULLET_TIME_DEFAULTS.aimScale).toBe(0.35);
    expect(BULLET_TIME_DEFAULTS.fireScale).toBe(0.35);
    expect(BULLET_TIME_DEFAULTS.airScale).toBe(0.2);
    expect(BULLET_TIME_DEFAULTS.shotScale).toBe(0.5);
    expect(BULLET_TIME_DEFAULTS.worldScale).toBe(0.2);
  });
});

describe('applyBulletTimeTuning (the console seam / panel / ?bt_* validation)', () => {
  const fresh = (): BulletTimeTuning => JSON.parse(JSON.stringify(BULLET_TIME_DEFAULTS));
  it('applies in-range finite values and returns every knob', () => {
    const T = fresh();
    const r = applyBulletTimeTuning({ moveScale: 0.8, reloadScale: 0.5, rampSec: 0.6 }, T);
    expect(r.rejected).toEqual([]);
    expect(T.moveScale).toBe(0.8);
    expect(T.reloadScale).toBe(0.5);
    expect(T.rampSec).toBe(0.6);
    expect(Object.keys(r.tuning).sort()).toEqual([...BULLET_TIME_KNOBS].sort());
    expect(r.tuning.moveScale).toBe(0.8);
  });
  it('refuses (does not clamp) NaN, Infinity, strings, out-of-range and unknown keys', () => {
    const T = fresh();
    const r = applyBulletTimeTuning({ moveScale: NaN, aimScale: Infinity, fireScale: '0.5', reloadScale: 0, shotScale: 1.5, bogus: 1 }, T);
    expect(r.rejected).toHaveLength(6);
    expect(bulletTimeKnobs(T)).toEqual(bulletTimeKnobs(fresh()));
  });
  it('accepts the range ends and nothing past them', () => {
    for (const k of BULLET_TIME_KNOBS) {
      const [lo, hi] = BULLET_TIME_RANGES[k];
      expect(applyBulletTimeTuning({ [k]: lo, }, fresh()).rejected).toEqual([]);
      expect(applyBulletTimeTuning({ [k]: hi }, fresh()).rejected).toEqual([]);
      expect(applyBulletTimeTuning({ [k]: hi + 0.01 }, fresh()).rejected).toHaveLength(1);
    }
  });
  it('reset restores the defaults, then applies anything else in the same call', () => {
    const T = fresh();
    applyBulletTimeTuning({ moveScale: 0.9, aimScale: 0.9 }, T);
    const r = applyBulletTimeTuning({ reset: true, aimScale: 0.5 }, T);
    expect(T.moveScale).toBe(BULLET_TIME_DEFAULTS.moveScale);
    expect(T.aimScale).toBe(0.5);
    expect(r.rejected).toEqual([]);
  });
  it('a null / absent partial is a read', () => {
    const T = fresh();
    expect(applyBulletTimeTuning(undefined, T)).toEqual({ tuning: bulletTimeKnobs(T), rejected: [] });
  });
  it('the live tuning starts at the defaults and is a separate object', () => {
    expect(bulletTimeKnobs(BULLET_TIME)).toEqual(bulletTimeKnobs(BULLET_TIME_DEFAULTS as unknown as BulletTimeTuning));
    expect(BULLET_TIME).not.toBe(BULLET_TIME_DEFAULTS);
  });
});

describe('bulletTimeFromParams', () => {
  it('maps ?bt_* onto knobs and drops empty / non-numeric ones', () => {
    expect(bulletTimeFromParams('?bt_move=0.66&bt_reload=0.6&bt_aim=&bt_fire=x&bt_ramp=0.5'))
      .toEqual({ moveScale: 0.66, reloadScale: 0.6, rampSec: 0.5 });
    expect(bulletTimeFromParams(new URLSearchParams('bt_world=0.1&bt_shot=0.4&bt_air=0.3')))
      .toEqual({ worldScale: 0.1, shotScale: 0.4, airScale: 0.3 });
    expect(bulletTimeFromParams('')).toEqual({});
  });
});

describe('airScaleAt (the jump eases into the apex hang and back)', () => {
  const J = 6;
  it('runs at the movement pace on the ground, at takeoff/landing speed and outside bullet time', () => {
    expect(airScaleAt(1, 0, true, J)).toBe(1);
    expect(airScaleAt(1, J, false, J)).toBe(1);
    expect(airScaleAt(1, -J * 1.5, false, J)).toBe(1);
    expect(airScaleAt(0, 0, false, J)).toBe(1);
  });
  it('reaches the absolute airScale at the apex, monotonically', () => {
    expect(airScaleAt(1, 0, false, J) * scalesAt(1).move).toBeCloseTo(BULLET_TIME.airScale, 12);
    const a = airScaleAt(1, J * 0.75, false, J), b = airScaleAt(1, J * 0.25, false, J);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(airScaleAt(1, -J * 0.25, false, J)).toBeCloseTo(b, 12);
  });
});

describe('pickWakes', () => {
  const eye = [0, 0, 0] as const;
  it('is empty at normal time', () => {
    expect(pickWakes([{ pos: [0, 0, -5], heavy: false }], eye, 0)).toEqual([]);
  });

  it('keeps the nearest in-range sources, skipping the muzzle', () => {
    const src = [
      { pos: [0, 0, -0.5] as const, heavy: false }, // at the muzzle: skipped
      ...[2, 9, 3, 7, 5, 40].map(z => ({ pos: [0, 0, -z] as const, heavy: false })),
    ];
    const w = pickWakes(src, eye, 1);
    expect(w.map(x => -x.pos[2])).toEqual([2, 3, 5, 7]);
    expect(w[0]!.strength).toBeCloseTo(BULLET_TIME.wakeStrength, 9);
  });

  it("ranks incoming shots before the player's own, which are faint", () => {
    const src = [
      { pos: [0, 0, -2] as const, heavy: false, own: true },
      { pos: [0, 0, -3] as const, heavy: false, own: true },
      ...[8, 9, 10].map(z => ({ pos: [0, 0, -z] as const, heavy: false })),
    ];
    const w = pickWakes(src, eye, 1);
    expect(w.map(x => -x.pos[2])).toEqual([8, 9, 10, 2]);
    expect(w[3]!.strength).toBeCloseTo(BULLET_TIME.wakeStrength * BULLET_TIME.ownWakeMul, 9);
    expect(pickWakes(src.slice(0, 2), eye, 1, { ...BULLET_TIME, ownWakeMul: 0 })).toEqual([]);
  });
});

describe('goreBoostAt', () => {
  it('is null outside bullet time so the shipped spawns stay bit-identical', () => {
    expect(goreBoostAt(0)).toBeNull();
  });
  it('is the full boost fully in', () => {
    expect(goreBoostAt(1)).toEqual({ ...BULLET_TIME.gore });
  });
});
