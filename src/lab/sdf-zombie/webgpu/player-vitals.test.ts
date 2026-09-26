// src/lab/sdf-zombie/webgpu/player-vitals.test.ts
import { describe, expect, it } from 'vitest';
import {
  VITALS, applyDamage, bitesInReach, heal, makeVitals, segmentHitsCapsule, stepVitals,
} from './player-vitals';

describe('vitals', () => {
  it('starts full and alive', () => {
    expect(makeVitals()).toEqual({ health: VITALS.maxHealth, meleeInvulnSec: 0, dead: false, hurtAge: Infinity });
  });

  it('takes damage and marks the hit', () => {
    const v = applyDamage(makeVitals(), 12, 'pellet');
    expect(v.health).toBe(VITALS.maxHealth - 12);
    expect(v.hurtAge).toBe(0);
    expect(v.meleeInvulnSec).toBe(0);
  });

  it('ignores a second melee hit inside the invulnerability window, but not pellets', () => {
    let v = applyDamage(makeVitals(), 10, 'melee');
    expect(v.meleeInvulnSec).toBe(VITALS.meleeInvulnSec);
    expect(applyDamage(v, 10, 'melee').health).toBe(v.health);
    expect(applyDamage(v, 3, 'pellet').health).toBe(v.health - 3);
    v = stepVitals(v, VITALS.meleeInvulnSec + 0.01);
    expect(applyDamage(v, 10, 'melee').health).toBe(v.health - 10);
  });

  it('dies at zero and stays dead', () => {
    const v = applyDamage(makeVitals(), 500, 'pellet');
    expect(v).toMatchObject({ health: 0, dead: true });
    expect(applyDamage(v, 5, 'pellet')).toBe(v);
    expect(heal(v, 50)).toBe(v);
  });

  it('heals up to the maximum', () => {
    const hurt = applyDamage(makeVitals(), 40, 'pellet');
    expect(heal(hurt, 25).health).toBe(VITALS.maxHealth - 15);
    expect(heal(hurt, 1000).health).toBe(VITALS.maxHealth);
  });

  it('ages the hurt timer and never goes negative on invulnerability', () => {
    const v = stepVitals(applyDamage(makeVitals(), 5, 'melee'), 10);
    expect(v.meleeInvulnSec).toBe(0);
    expect(v.hurtAge).toBe(10);
  });
});

describe('segmentHitsCapsule', () => {
  const feet = [0, 0, 0] as const;
  const r = 0.32, h = 1.75;
  it('hits a pellet crossing the chest', () => {
    expect(segmentHitsCapsule([-1, 1.2, 0], [1, 1.2, 0], feet, r, h)).toBe(true);
  });
  it('misses a pellet passing a metre to the side', () => {
    expect(segmentHitsCapsule([-1, 1.2, 1], [1, 1.2, 1], feet, r, h)).toBe(false);
  });
  it('misses a pellet over the head', () => {
    expect(segmentHitsCapsule([-1, 2.3, 0], [1, 2.3, 0], feet, r, h)).toBe(false);
  });
  it('hits a pellet that starts and ends inside', () => {
    expect(segmentHitsCapsule([0.1, 1, 0], [0.1, 1, 0], feet, r, h)).toBe(true);
  });
  it('hits a fast pellet whose frame segment jumps across the body', () => {
    expect(segmentHitsCapsule([0, 1, -0.8], [0, 1, 0.8], feet, r, h)).toBe(true);
  });
});

describe('bitesInReach', () => {
  it('bites from live zombies within reach only', () => {
    const z = [
      { id: 1, pos: [0.5, 0, 0] as [number, number, number], down: false },
      { id: 2, pos: [2, 0, 0] as [number, number, number], down: false },
      { id: 3, pos: [0.2, 0, 0.2] as [number, number, number], down: true },
    ];
    expect(bitesInReach([0, 0, 0], z, VITALS.biteReach)).toEqual([1]);
  });
});
