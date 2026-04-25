import { describe, it, expect } from 'vitest';
import { burnRemainingSec, dotDamageThisFrame, isExpired, StuckFlare } from './stuck-flare';
import { BURN } from '../gibs/tuning';

describe('burnRemainingSec', () => {
  it('returns full duration at spawn time', () => {
    const rem = burnRemainingSec(10, 10, 6);
    expect(rem).toBe(6);
  });

  it('returns 0 at end of duration', () => {
    const rem = burnRemainingSec(10, 16, 6);
    expect(rem).toBe(0);
  });

  it('returns half at midpoint', () => {
    const rem = burnRemainingSec(10, 13, 6);
    expect(rem).toBe(3);
  });

  it('clamps to 0 past expiry', () => {
    const rem = burnRemainingSec(10, 20, 6);
    expect(rem).toBe(0);
  });
});

describe('dotDamageThisFrame', () => {
  it('returns dt * dps', () => {
    expect(dotDamageThisFrame(0.016, 8)).toBeCloseTo(0.128, 5);
    expect(dotDamageThisFrame(1.0, 8)).toBe(8);
    expect(dotDamageThisFrame(0.5, 10)).toBe(5);
  });

  it('returns 0 for dt=0', () => {
    expect(dotDamageThisFrame(0, 8)).toBe(0);
  });
});

describe('isExpired', () => {
  it('false before duration', () => {
    expect(isExpired(10, 15.9, 6)).toBe(false);
  });

  it('true at duration boundary', () => {
    expect(isExpired(10, 16, 6)).toBe(true);
  });

  it('true after duration', () => {
    expect(isExpired(10, 20, 6)).toBe(true);
  });
});

describe('StuckFlare', () => {
  // Mock RigidBody for position tracking tests
  function mockBody(x: number, y: number, z: number) {
    return {
      translation: () => ({ x, y, z }),
    } as any;
  }

  it('update() returns true while alive', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    expect(flare.update(11)).toBe(true);
  });

  it('update() follows attached body position', () => {
    const body = mockBody(3, 5, 7);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    flare.update(11);
    expect(flare.pos).toEqual({ x: 3, y: 5, z: 7 });
  });

  it('update() returns false when expired', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, 10);
    // duration = BURN.durationSec = 6
    expect(flare.update(16)).toBe(false);
    expect(flare.isExtinguished()).toBe(true);
  });

  it('damageThisTick() returns dt*dps while attached and burning', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    const dmg = flare.damageThisTick(0.016);
    expect(dmg).toBeCloseTo(BURN.dpsPerFlare * 0.016, 5);
  });

  it('damageThisTick() returns 0 when detached (no body)', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, 10);
    expect(flare.damageThisTick(0.016)).toBe(0);
  });

  it('damageThisTick() returns 0 when extinguished', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    flare.update(16); // expire
    expect(flare.isExtinguished()).toBe(true);
    expect(flare.damageThisTick(0.016)).toBe(0);
  });

  it('damageThisTick() still returns damage when detach() is called but body was set (conservative: detach clears body)', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    flare.detach();
    expect(flare.damageThisTick(0.016)).toBe(0);
  });

  it('detach() clears body but flare continues burning at last position', () => {
    const body = mockBody(5, 2, 5);
    const flare = new StuckFlare('f1', { x: 5, y: 2, z: 5 }, body, 10);
    // Move body
    const body2 = mockBody(7, 3, 8);
    // attach to new body (simulate)
    flare.detach();
    // Position stays at last known (before detach, last update was at time 10)
    expect(flare.attachedBody).toBeNull();
    expect(flare.isExtinguished()).toBe(false);
    // update() without body — position unchanged from last
    const oldPos = { ...flare.pos };
    flare.update(11);
    expect(flare.pos).toEqual(oldPos);
  });

  it('multiple flares on same body stack additively', () => {
    const body = mockBody(0, 0, 0);
    const f1 = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, 10);
    const f2 = new StuckFlare('f2', { x: 0, y: 0, z: 0 }, body, 10);
    const totalDmg = f1.damageThisTick(1.0) + f2.damageThisTick(1.0);
    expect(totalDmg).toBe(BURN.dpsPerFlare * 2);
  });
});
