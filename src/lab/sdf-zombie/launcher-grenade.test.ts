import { describe, expect, it } from 'vitest';
import { GRENADE, grenadeLaunchVelocity, makeGrenade, stepGrenade } from './launcher-grenade';
import type { Vec3 } from './types';

const never = () => false;
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe('grenadeLaunchVelocity', () => {
  it('leaves at muzzle speed, raised by the lob in the aim\'s own vertical plane', () => {
    const v = grenadeLaunchVelocity([1, 0, 0]);
    expect(len(v)).toBeCloseTo(GRENADE.speedMps, 6);
    expect(Math.atan2(v[1], Math.hypot(v[0], v[2]))).toBeCloseTo(GRENADE.lobRad, 6);
    expect(v[2]).toBeCloseTo(0, 9);
    expect(v[0]).toBeGreaterThan(0);
  });

  it('keeps the aim\'s heading for an off-axis aim (free aim, not the camera forward)', () => {
    const aim: Vec3 = [0.3, -0.2, -0.9];
    const v = grenadeLaunchVelocity(aim);
    expect(Math.atan2(v[0], -v[2])).toBeCloseTo(Math.atan2(aim[0], -aim[2]), 9);
    const aimPitch = Math.atan2(aim[1], Math.hypot(aim[0], aim[2]));
    expect(Math.atan2(v[1], Math.hypot(v[0], v[2]))).toBeCloseTo(aimPitch + GRENADE.lobRad, 9);
  });

  it('does not tilt a vertical aim and never flips past straight up', () => {
    expect(grenadeLaunchVelocity([0, 1, 0])).toEqual([0, GRENADE.speedMps, 0]);
    const v = grenadeLaunchVelocity([1e-3, 1, 0]);
    expect(v[1]).toBeGreaterThan(0);
    expect(v[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('stepGrenade', () => {
  it('arcs under gravity: rises on the lob, then falls below the launch height', () => {
    let s = makeGrenade([0, 1.5, 0], [0, 0, -1]);
    let peak = s.pos[1];
    for (let i = 0; i < 12; i++) { s = stepGrenade(s, 1 / 60, {}, never).state; peak = Math.max(peak, s.pos[1]); }
    expect(peak).toBeGreaterThan(1.5);
    expect(s.pos[2]).toBeLessThan(-4);
    for (let i = 0; i < 30 && !s.detonated; i++) s = stepGrenade(s, 1 / 60, {}, never).state;
    expect(s.pos[1]).toBeLessThan(1.5);
  });

  it('detonates on a body on the sub-step that reaches it, not a frame later', () => {
    const s = makeGrenade([0, 1.5, 0], [0, 0, -1]);
    const body = (_from: Vec3, to: Vec3) => to[2] <= -3;
    const r = stepGrenade(s, 0.25, {}, body);
    expect(r.cause).toBe('body');
    expect(r.boom![2]).toBeLessThanOrEqual(-3);
    expect(r.boom![2]).toBeGreaterThan(-3 - GRENADE.speedMps / 120 - 1e-6);
    expect(r.lastOpen[2]).toBeGreaterThan(-3);
  });

  it('detonates on a wall past the safe distance', () => {
    const wall = { min: [-5, 0, -6.2] as Vec3, max: [5, 4, -6] as Vec3 };
    let r = stepGrenade(makeGrenade([0, 1.5, 0], [0, 0, -1]), 0.25, { colliders: [wall] }, never);
    for (let i = 0; i < 4 && !r.boom; i++) r = stepGrenade(r.state, 0.25, { colliders: [wall] }, never);
    expect(r.cause).toBe('flight');
    expect(r.boom![2]).toBeGreaterThan(-6.1);
    expect(r.boom![2]).toBeLessThan(-5.8);
  });

  it('a shot into the floor at the feet bounces instead of going off inside the safe distance', () => {
    const spawn: Vec3 = [0, 0.2, 0];
    let r = stepGrenade(makeGrenade(spawn, [0, -1, -0.05]), 1 / 60, {}, never);
    for (let t = 0; !r.boom && t < 5; t += 1 / 60) r = stepGrenade(r.state, 1 / 60, {}, never);
    expect(r.boom).not.toBeNull();
    expect(Math.hypot(r.boom![0] - spawn[0], r.boom![1] - spawn[1], r.boom![2] - spawn[2])).toBeGreaterThanOrEqual(0.7);
  });

  it('the fuse sets off a grenade that never meets anything it may detonate on', () => {
    // Straight up: it comes back down onto its own spawn, inside the safe distance, and settles there.
    let r = stepGrenade(makeGrenade([0, 0.5, 0], [0, 1, 0]), 1 / 60, {}, never);
    let t = 1 / 60;
    while (!r.boom && t < 5) { r = stepGrenade(r.state, 1 / 60, {}, never); t += 1 / 60; }
    expect(r.boom).not.toBeNull();
    expect(r.state.fuse).toBeLessThanOrEqual(0);
    expect(t).toBeCloseTo(GRENADE.fuseSec, 1);
  });

  it('clamps a long frame and is deterministic', () => {
    const s = makeGrenade([0, 1.5, 0], [0.2, 0.1, -1]);
    const a = stepGrenade(s, 5, {}, never), b = stepGrenade(s, GRENADE.maxStepSec, {}, never);
    expect(a.state).toEqual(b.state);
  });
});
