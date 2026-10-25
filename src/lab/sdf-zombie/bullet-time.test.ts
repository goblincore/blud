import { describe, expect, it } from 'vitest';
import { BULLET_TIME, goreBoostAt, makeBulletTime, pickWakes, stepBulletTime, toggleBulletTime, worldScaleAt } from './bullet-time';

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
});

describe('goreBoostAt', () => {
  it('is null outside bullet time so the shipped spawns stay bit-identical', () => {
    expect(goreBoostAt(0)).toBeNull();
  });
  it('is the full boost fully in', () => {
    expect(goreBoostAt(1)).toEqual({ ...BULLET_TIME.gore });
  });
});
