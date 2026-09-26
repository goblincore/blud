// src/lab/sdf-zombie/motion-profile.test.ts
import { describe, it, expect } from 'vitest';
import { motionProfileFor, ZOMBIE_PROFILE, SOLDIER_PROFILE, runWeight, speedForBand, isSoldierFamily, JUGGERNAUT_PROFILE } from './motion-profile';
import { SHAMBLE, MARCH, RUN } from './gait';
import { WANDER_TUNING } from './wander';

describe('motion profiles', () => {
  it('unknown characters and the zombie get the zombie profile (shamble, reach, stock cruise)', () => {
    expect(motionProfileFor('zombie')).toBe(ZOMBIE_PROFILE);
    expect(motionProfileFor('clown')).toBe(ZOMBIE_PROFILE);
    expect(ZOMBIE_PROFILE.gait.walk).toBe(SHAMBLE);
    expect(ZOMBIE_PROFILE.gait.run).toBe(SHAMBLE);
    expect(ZOMBIE_PROFILE.cruise).toBe(WANDER_TUNING.speed);
    expect(ZOMBIE_PROFILE.carries).toBeUndefined();
  });
  it('soldier: march/run, carries, a prop, a faster cruise', () => {
    const p = motionProfileFor('soldier');
    expect(p).toBe(SOLDIER_PROFILE);
    expect(p.gait.walk).toBe(MARCH);
    expect(p.gait.run).toBe(RUN);
    expect(p.carries).toEqual({ walk: 'low', run: 'chest', fire: 'aim' });
    expect(p.prop?.url).toBe('/assets/lab/soldier-shotgun.glb');
    expect(p.cruise).toBeGreaterThan(WANDER_TUNING.speed);
  });
  it('runWeight: 0 below the band, 1 above, linear between', () => {
    const b = SOLDIER_PROFILE.runBand;
    expect(runWeight(SOLDIER_PROFILE, b.from - 0.1)).toBe(0);
    expect(runWeight(SOLDIER_PROFILE, b.to + 0.1)).toBe(1);
    expect(runWeight(SOLDIER_PROFILE, (b.from + b.to) / 2)).toBeCloseTo(0.5, 9);
    expect(runWeight(ZOMBIE_PROFILE, 99)).toBe(0);
  });
});


it('lab run control reaches the run gait even when patrol cruise is a walk', () => {
  expect(runWeight(SOLDIER_PROFILE, speedForBand(SOLDIER_PROFILE, 'run'))).toBe(1);
  expect(runWeight(SOLDIER_PROFILE, speedForBand(SOLDIER_PROFILE, 'walk'))).toBe(0);
  expect(speedForBand(ZOMBIE_PROFILE, 'run')).toBe(ZOMBIE_PROFILE.cruise);
});

it('soldier family is a trait, not a name: a renamed variant keeps it, the cultist gunner does not', () => {
  expect(isSoldierFamily(SOLDIER_PROFILE)).toBe(true);
  expect(motionProfileFor('juggernaut')).toBe(JUGGERNAUT_PROFILE);
  expect(isSoldierFamily(JUGGERNAUT_PROFILE)).toBe(true);
  expect(isSoldierFamily(motionProfileFor('cultist'))).toBe(false);
  expect(isSoldierFamily(ZOMBIE_PROFILE)).toBe(false);
  expect(isSoldierFamily(undefined)).toBe(false);
});

it('juggernaut: a slower, heavier-turning soldier that never runs', () => {
  expect(JUGGERNAUT_PROFILE.cruise).toBeLessThan(SOLDIER_PROFILE.cruise);
  expect(JUGGERNAUT_PROFILE.turnRate!).toBeLessThan(SOLDIER_PROFILE.turnRate!);
  expect(runWeight(JUGGERNAUT_PROFILE, 99)).toBe(0);
  expect(JUGGERNAUT_PROFILE.gunner).toBeDefined();
});
