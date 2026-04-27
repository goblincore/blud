import { describe, it, expect, vi } from 'vitest';
import { burnRemainingSec, dotDamageThisFrame, isExpired, StuckFlare } from './stuck-flare';
import { BURN } from '../gibs/tuning';
import * as THREE from 'three';

const NOW = 10;
const DT = 0.016;

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

  it('isIgnited() returns false before ignite delay', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, NOW);
    expect(flare.isIgnited(NOW + 0.3)).toBe(false); // 0.3 < 0.6
  });

  it('isIgnited() returns true after ignite delay', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, NOW);
    expect(flare.isIgnited(NOW + 0.7)).toBe(true); // 0.7 >= 0.6
  });

  it('isIgnited() returns true at and after ignite delay boundary', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, NOW);
    // Use a clean value to avoid IEEE 754 float-edge issues (10.6 - 10 ≠ exactly 0.6)
    expect(flare.isIgnited(NOW + 0.61)).toBe(true);
    expect(flare.isIgnited(NOW + 0.59)).toBe(false);
  });

  it('damageThisTick() returns 0 before ignition', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, NOW);
    expect(flare.damageThisTick(DT, NOW + 0.3)).toBe(0);
  });

  it('damageThisTick() returns dt*dps after ignition', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, NOW);
    const dmg = flare.damageThisTick(DT, NOW + 0.7);
    expect(dmg).toBeCloseTo(BURN.dpsPerFlare * DT, 5);
  });

  it('damageThisTick() returns 0 when detached (no body)', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, NOW);
    expect(flare.damageThisTick(DT, NOW + 1.0)).toBe(0);
  });

  it('damageThisTick() returns 0 when extinguished', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, NOW);
    flare.update(NOW + 20); // expire
    expect(flare.isExtinguished()).toBe(true);
    expect(flare.damageThisTick(DT, NOW + 20)).toBe(0);
  });

  it('damageThisTick() returns 0 when detach() is called but body was set', () => {
    const body = mockBody(0, 0, 0);
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, NOW);
    flare.detach();
    expect(flare.damageThisTick(DT, NOW + 1.0)).toBe(0);
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
    const ignitedNow = NOW + 0.7;
    const f1 = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, body, NOW);
    const f2 = new StuckFlare('f2', { x: 0, y: 0, z: 0 }, body, NOW);
    const totalDmg = f1.damageThisTick(1.0, ignitedNow) + f2.damageThisTick(1.0, ignitedNow);
    expect(totalDmg).toBe(BURN.dpsPerFlare * 2);
  });
});

describe('StuckFlare billboard tracking', () => {
  function mockBody(x: number, y: number, z: number) {
    return {
      translation: () => ({ x, y, z }),
    } as any;
  }

  it('getRenderPos returns body position with Y offset', () => {
    const body = mockBody(3, 1, 5);
    const flare = new StuckFlare('f1', { x: 3, y: 1, z: 5 }, body, 10);
    flare.update(11);
    const rp = flare.getRenderPos();
    expect(rp.x).toBe(3);
    expect(rp.y).toBe(1.6); // 1.0 + 0.6 offset
    expect(rp.z).toBe(5);
  });

  it('getRenderPos works without attached body (world-space position)', () => {
    const flare = new StuckFlare('f1', { x: 10, y: 2, z: 0 }, null, 10);
    const rp = flare.getRenderPos();
    expect(rp.x).toBe(10);
    expect(rp.y).toBe(2.6);
    expect(rp.z).toBe(0);
  });

  it('disposeMesh cleans up mesh geometry and material', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, 10);
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geom, mat);
    const geomDispose = vi.spyOn(geom, 'dispose');
    const matDispose = vi.spyOn(mat, 'dispose');
    flare.mesh = mesh;
    flare.disposeMesh();
    expect(flare.mesh).toBeNull();
    expect(geomDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });

  it('mesh starts as null', () => {
    const flare = new StuckFlare('f1', { x: 0, y: 0, z: 0 }, null, 10);
    expect(flare.mesh).toBeNull();
  });
});
