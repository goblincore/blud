// src/lab/sdf-zombie/webgpu/censer-blur.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_CHAIN_SAMPLES, CENSER_HAFT_BLUR_GAIN, angularVelocity, censerBlurActive, censerMotionState, chainRodStates,
  scaleMotion, scaledPrior, type Pose,
} from './censer-blur';
import { gibPriorState, isGibSelectedForBlur } from './gib-motion-blur';
import { qFromAxisAngle, type Quat } from '../vec';
import type { Vec3 } from '../types';

const ID: Quat = [0, 0, 0, 1];
const mag = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe('censerMotionState', () => {
  it('a pure translation gives the right vel and zero angVel', () => {
    const s = censerMotionState({ pos: [0, 1, 0], quat: ID }, { pos: [0.2, 1, -0.1], quat: ID }, 0.02, 0.07);
    expect(s.vel[0]).toBeCloseTo(10, 9);
    expect(s.vel[1]).toBeCloseTo(0, 9);
    expect(s.vel[2]).toBeCloseTo(-5, 9);
    expect(s.angVel).toEqual([0, 0, 0]);
    expect(s.pos).toEqual([0.2, 1, -0.1]);
    expect(s.squash).toBe(0);
    expect(s.support).toEqual([{ c: [0, 0, 0], r: 0.07 }]);
    expect(isGibSelectedForBlur(s)).toBe(true);
  });

  it('a 90°/s spin gives |angVel| ≈ π/2 about the spin axis', () => {
    const dt = 1 / 60;
    const prev: Pose = { pos: [0, 1, 0], quat: qFromAxisAngle([0, 0, 1], 0.3) };
    const cur: Pose = { pos: [0, 1, 0], quat: qFromAxisAngle([0, 0, 1], 0.3 + (Math.PI / 2) * dt) };
    const s = censerMotionState(prev, cur, dt, 0.07);
    expect(mag(s.angVel)).toBeCloseTo(Math.PI / 2, 6);
    expect(s.angVel[2]).toBeGreaterThan(0);
    expect(mag(s.vel)).toBe(0);
    // It is the convention gibPriorState integrates backwards: prior ≈ prev.
    const prior = gibPriorState(s, dt);
    for (let i = 0; i < 4; i++) expect(prior.quat[i]).toBeCloseTo(prev.quat[i]!, 6);
  });

  it('dt <= 0 gives zero motion (and is not selected for blur)', () => {
    for (const dt of [0, -0.01, Number.NaN]) {
      const s = censerMotionState({ pos: [0, 1, 0], quat: ID }, { pos: [1, 1, 0], quat: qFromAxisAngle([0, 1, 0], 1) }, dt, 0.07);
      expect(s.vel).toEqual([0, 0, 0]);
      expect(s.angVel).toEqual([0, 0, 0]);
      expect(isGibSelectedForBlur(s)).toBe(false);
    }
  });

  it('the shortest arc never takes the long way (q and −q)', () => {
    const dt = 0.1;
    const a = qFromAxisAngle([0, 1, 0], 0.2);
    const b = qFromAxisAngle([0, 1, 0], 0.3);
    const bNeg: Quat = [-b[0], -b[1], -b[2], -b[3]];
    const w1 = angularVelocity(a, b, dt);
    const w2 = angularVelocity(a, bNeg, dt);
    expect(mag(w1)).toBeCloseTo(1, 6);
    expect(mag(w2)).toBeCloseTo(1, 6);
    expect(w2[1]).toBeCloseTo(w1[1], 6);
    // A 350° turn is a −10° turn.
    const c = qFromAxisAngle([0, 1, 0], 0.2 + (350 * Math.PI) / 180);
    const w3 = angularVelocity(a, c, 1);
    expect(w3[1]).toBeCloseTo((-10 * Math.PI) / 180, 6);
  });
});

describe('chainRodStates', () => {
  it('velocity interpolates from the knot to the ring', () => {
    const dt = 0.01;
    // Knot still, ring moves +x at 20 m/s.
    const s = chainRodStates([0, 1, 0], [0, 0.5, 0], [0, 1, 0], [0.2, 0.5, 0], dt);
    expect(s).toHaveLength(CENSER_CHAIN_SAMPLES);
    const vx = s.map(c => c.vel[0]);
    for (let i = 1; i < vx.length; i++) expect(vx[i]!).toBeGreaterThan(vx[i - 1]!);
    expect(vx[vx.length - 1]!).toBeLessThan(20);
    expect(vx[0]!).toBeGreaterThan(0);
    // Each sample spans its share of the rod, and it rotates with the rod.
    const span = Math.hypot(0.2, 0.5);
    expect(s[0]!.radius).toBeCloseTo(span / CENSER_CHAIN_SAMPLES / 2, 6);
    expect(mag(s[0]!.angVel)).toBeGreaterThan(0);
  });

  it('a still chain has no motion', () => {
    const s = chainRodStates([0, 1, 0], [0, 0.5, 0], [0, 1, 0], [0, 0.5, 0], 1 / 60);
    for (const c of s) { expect(mag(c.vel)).toBe(0); expect(mag(c.angVel)).toBe(0); }
  });
});

describe('censerBlurActive', () => {
  it('only while swinging', () => {
    expect(censerBlurActive('idle')).toBe(false);
    expect(censerBlurActive('pending')).toBe(false);
    expect(censerBlurActive('windup')).toBe(true);
    expect(censerBlurActive('stroke')).toBe(true);
    expect(censerBlurActive('recover')).toBe(true);
  });
});

describe('scaleMotion', () => {
  it('scales both velocities and keeps the pose', () => {
    const s = censerMotionState(
      { pos: [0, 0, 0], quat: ID }, { pos: [1, 0, 0], quat: qFromAxisAngle([0, 1, 0], 0.5) }, 0.1, 0.03);
    const h = scaleMotion(s, CENSER_HAFT_BLUR_GAIN);
    expect(h.vel[0]).toBeCloseTo(10 * CENSER_HAFT_BLUR_GAIN, 9);
    expect(mag(h.angVel)).toBeCloseTo(5 * CENSER_HAFT_BLUR_GAIN, 6);
    expect(h.pos).toEqual(s.pos);
    expect(h.quat).toEqual(s.quat);
    expect(CENSER_HAFT_BLUR_GAIN).toBeLessThan(1);
  });
});

describe('scaledPrior', () => {
  it('pulls the prior toward the current position by the gain', () => {
    expect(scaledPrior([1, 2, 3], [0, 0, 0], 0.5)).toEqual([0.5, 1, 1.5]);
    expect(scaledPrior([1, 2, 3], [0, 0, 0], 0)).toEqual([0, 0, 0]);
    expect(scaledPrior([1, 2, 3], [0, 0, 0], 1)).toEqual([1, 2, 3]);
  });
});
