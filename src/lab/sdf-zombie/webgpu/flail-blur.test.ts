// src/lab/sdf-zombie/webgpu/flail-blur.test.ts
import { describe, expect, it } from 'vitest';
import {
  FLAIL_BLUR, axisQuat, ballMotionState, chainSegmentStates, flailBlurActive, makeMotionState, swingAngularVelocity,
} from './flail-blur';
import { gibPriorState, isGibSelectedForBlur, planGibMotionStamps } from './gib-motion-blur';
import { qRotate } from '../vec';
import type { Vec3 } from '../types';

const mag = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('FLAIL_BLUR', () => {
  it('the look pass numbers: a small view-model gain, the chain no more smeared than a link survives', () => {
    expect(FLAIL_BLUR.ballGain).toBeGreaterThan(0);
    expect(FLAIL_BLUR.ballGain).toBeLessThanOrEqual(0.12);
    expect(FLAIL_BLUR.chainGain).toBeLessThanOrEqual(0.15);
    expect(FLAIL_BLUR.minBallSpeedMps).toBe(4);
  });
});

describe('flailBlurActive', () => {
  it('only mid-swing and above the speed threshold', () => {
    expect(flailBlurActive('idle', 20)).toBe(false);
    expect(flailBlurActive('swing', FLAIL_BLUR.minBallSpeedMps - 0.01)).toBe(false);
    expect(flailBlurActive('swing', FLAIL_BLUR.minBallSpeedMps)).toBe(true);
    expect(flailBlurActive('swing', Number.NaN)).toBe(false);
  });
});

describe('swingAngularVelocity / axisQuat', () => {
  it('a 90° turn over 0.5 s is π rad/s about the cross axis', () => {
    const w = swingAngularVelocity([0, -1, 0], [1, 0, 0], 0.5);
    expect(mag(w)).toBeCloseTo(Math.PI, 6);
    expect(w[2]).toBeGreaterThan(0);
  });
  it('dt <= 0 or parallel axes give zero', () => {
    expect(swingAngularVelocity([0, 1, 0], [1, 0, 0], 0)).toEqual([0, 0, 0]);
    expect(swingAngularVelocity([0, 1, 0], [0, 2, 0], 0.1)).toEqual([0, 0, 0]);
  });
  it('axisQuat maps +Y onto the axis, including straight down', () => {
    for (const a of [[0, -1, 0], [0.3, -0.9, 0.1], [0, 0, 1]] as Vec3[]) {
      const y = qRotate(axisQuat(a), [0, 1, 0]);
      const n = mag(a);
      for (let i = 0; i < 3; i++) expect(y[i]).toBeCloseTo(a[i]! / n, 6);
    }
  });
});

describe('ballMotionState', () => {
  it('velocity is the displacement over the unscaled dt, times the gain', () => {
    const s = ballMotionState(makeMotionState(), [0, 0, -0.5], [0.1, 0, -0.5], [0, 1, 0], [0, 1, 0], 1 / 60, 0.06, 1);
    expect(s.vel[0]).toBeCloseTo(6, 6);
    expect(s.pos).toEqual([0.1, 0, -0.5]);
    expect(s.radius).toBe(0.06);
    expect(isGibSelectedForBlur(s)).toBe(true);
    const h = ballMotionState(makeMotionState(), [0, 0, -0.5], [0.1, 0, -0.5], [0, 1, 0], [0, 1, 0], 1 / 60, 0.06, 0.5);
    expect(h.vel[0]).toBeCloseTo(3, 6);
  });
  it('a hit-stop frame (the sim moved 8% of a frame) reads 8% of the speed', () => {
    // The gate reads the raw (gain 1) speed; the smear is then scaled by FLAIL_BLUR.ballGain.
    const full = ballMotionState(makeMotionState(), [0, 0, 0], [0.2, 0, 0], [0, 1, 0], [0, 1, 0], 1 / 60, 0.06, 1);
    const stop = ballMotionState(makeMotionState(), [0, 0, 0], [0.016, 0, 0], [0, 1, 0], [0, 1, 0], 1 / 60, 0.06, 1);
    expect(mag(stop.vel) / mag(full.vel)).toBeCloseTo(0.08, 6);
    expect(flailBlurActive('swing', mag(full.vel))).toBe(true);
    expect(flailBlurActive('swing', mag(stop.vel))).toBe(false);
  });
  it('the prior the layer integrates back lands on the previous frame (gain 1, exposure = dt)', () => {
    const dt = 1 / 60;
    const s = ballMotionState(makeMotionState(), [0, 0.1, -0.6], [0.15, 0.05, -0.6], [0, 1, 0], [0.3, 1, 0], dt, 0.06, 1);
    const prior = gibPriorState(s, dt);
    expect(prior.pos[0]).toBeCloseTo(0, 9);
    expect(prior.pos[1]).toBeCloseTo(0.1, 9);
    const yPrior = qRotate(prior.quat, [0, 1, 0]);
    expect(yPrior[0]).toBeCloseTo(0, 6);
  });
});

describe('chainSegmentStates', () => {
  const nodes = (dx: number): Vec3[] => Array.from({ length: 5 }, (_, k) => [dx * k, -0.1 * k, -0.4] as Vec3);
  it('one state per segment; velocity grows toward the moving end; gain applies', () => {
    const dt = 1 / 60;
    const prev = nodes(0), cur = nodes(0.02);   // the knot still, the far end sweeping +x
    const pool = chainSegmentStates(prev, cur, 4, dt, 1);
    expect(pool).toHaveLength(4);
    for (let k = 1; k < 4; k++) expect(pool[k]!.vel[0]).toBeGreaterThan(pool[k - 1]!.vel[0]);
    expect(pool[0]!.vel[0]).toBeCloseTo((0.01 / dt), 6);
    for (const s of pool) {
      expect(s.support).toHaveLength(2);
      expect(s.radius).toBeGreaterThanOrEqual(FLAIL_BLUR.linkMinRadius);
    }
    const g = chainSegmentStates(prev, cur, 4, dt, 0.3);
    expect(g[3]!.vel[0]).toBeCloseTo(pool[3]!.vel[0] * 0.3, 6);
  });
  it('reuses the pool (no per-frame allocation) and trims to the segment count', () => {
    const pool = chainSegmentStates(nodes(0), nodes(0.01), 4, 1 / 60);
    const first = pool[0];
    const again = chainSegmentStates(nodes(0), nodes(0.01), 3, 1 / 60, 1, pool);
    expect(again).toBe(pool);
    expect(again[0]).toBe(first);
    expect(again).toHaveLength(3);
  });
  it('a still chain has no motion and is not selected', () => {
    for (const s of chainSegmentStates(nodes(0.01), nodes(0.01), 4, 1 / 60)) {
      expect(mag(s.vel)).toBe(0);
      expect(mag(s.angVel)).toBe(0);
      expect(isGibSelectedForBlur(s)).toBe(false);
    }
  });
  it('a moving segment plans stamps along its motion', () => {
    const [s] = chainSegmentStates([[0, 0, -0.5], [0, -0.1, -0.5]], [[0.1, 0, -0.5], [0.1, -0.1, -0.5]], 1, 1 / 60, 1);
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // A plain perspective (fov 90°, aspect 1, near 0.05, far 100) looking down −Z.
    const n = 0.05, f = 100;
    const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0];
    const stamps = planGibMotionStamps(s!, 7, {
      viewProj: proj, viewMatrix: view, width: 800, height: 800, near: n, far: f, tanHalfFovY: 1,
    }, 0.044, { maxStreakPx: 120 });
    expect(stamps.length).toBeGreaterThan(0);
    for (const st of stamps) expect(st.toX - st.fromX).toBeGreaterThan(0);
  });
});
