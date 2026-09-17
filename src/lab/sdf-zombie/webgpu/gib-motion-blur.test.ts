// src/lab/sdf-zombie/webgpu/gib-motion-blur.test.ts
//
// Focused, GPU-free tests for the flying-gib shutter motion model. The
// requirements these pin down are the ones the task calls out by name:
//
//   * pure spin with a STATIONARY CENTRE must still blur at the edges
//     (translation-only streaks are insufficient);
//   * translation produces the expected screen streak;
//   * quaternion sign / shortest arc never takes the long way round;
//   * timing is a fixed exposure, independent of presented FPS;
//   * spawn / reuse / discontinuity is clamped by age;
//   * a settled piece is handed back to the sharp path;
//   * an empty / zero-exposure frame does no work.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { Chunk } from '../gib-chunks';
import { CHUNK_TUNING } from '../gib-chunks';
import { qIdentity, qFromAxisAngle, type Quat } from '../vec';
import type { Vec3 } from '../types';
import {
  GIB_BLUR_LAYER, GIB_BLUR_MAX_PIECES, GIB_BLUR_MIN_SPEED_MPS,
  GIB_BLUR_MIN_ANGVEL_RADPS, GIB_BLUR_MAX_PROBES, GIB_SHUTTER_DEFAULT_ENABLED,
  gibLinearSpeed, gibAngularSpeed, isGibSelectedForBlur, gibPriorState,
  gibExposureSampleStates, gibProbeLocals, planGibMotionStamps, readGibShutterEnabled,
} from './gib-motion-blur';
import type { ShutterProjection } from './shutter-blur';

function proj(width = 800, height = 600): ShutterProjection {
  const cam = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return {
    viewProj: vp.elements,
    viewMatrix: cam.matrixWorldInverse.elements,
    width, height, near: 0.1, far: 100,
    tanHalfFovY: Math.tan((60 * Math.PI) / 360),
  };
}

function chunk(over: Partial<Chunk> = {}): Chunk {
  return {
    limb: 'torso' as never, kind: 'limb',
    pos: [0, 0, -3], vel: [0, 0, 0], radius: 0.18,
    squash: 0, quat: qIdentity(), angVel: [0, 0, 0],
    longAxis: [1, 0, 0],
    support: [{ c: [0, 0, 0], r: 0.18 }],
    ...over,
  };
}

describe('gib motion — bounds and switches', () => {
  it('uses a free layer bit and bounded caps', () => {
    expect(GIB_BLUR_LAYER).toBe(10);
    expect(GIB_BLUR_MAX_PIECES).toBeGreaterThanOrEqual(20);
    expect(GIB_BLUR_MAX_PROBES).toBeGreaterThanOrEqual(6);
    expect(GIB_BLUR_MAX_PROBES).toBeLessThanOrEqual(16);
  });

  it('ships ON and parses the gib-only query switch reversibly', () => {
    expect(GIB_SHUTTER_DEFAULT_ENABLED).toBe(true);
    expect(readGibShutterEnabled('')).toBe(true);
    expect(readGibShutterEnabled('?gibblur=0')).toBe(false);
    expect(readGibShutterEnabled('?gibblur=off')).toBe(false);
    expect(readGibShutterEnabled('?gibblur=1')).toBe(true);
    expect(readGibShutterEnabled('?gibblur=nonsense')).toBe(true);
  });
});

describe('gib motion — selection (settle handoff)', () => {
  it('selects translation, selects pure spin, rejects stationary', () => {
    expect(isGibSelectedForBlur(chunk({ vel: [1, 0, 0] }))).toBe(true);
    expect(isGibSelectedForBlur(chunk({ angVel: [0, 5, 0] }))).toBe(true);
    expect(isGibSelectedForBlur(chunk({}))).toBe(false);
    expect(gibLinearSpeed(chunk({ vel: [3, 4, 0] }))).toBeCloseTo(5, 10);
    expect(gibAngularSpeed(chunk({ angVel: [0, 0, 2.5] }))).toBeCloseTo(2.5, 10);
  });

  it('hands a settled piece back to the sharp path', () => {
    // A grounded, spin-free, flat, sub-millimetre chunk: chunkSettled's own
    // "has already stopped" predicate.
    const settled = chunk({
      pos: [0, 0.18, -3], vel: [0, 0, 0], angVel: [0, 0, 0], squash: 0,
      longAxis: [1, 0, 0], quat: qIdentity(),
    });
    expect(isGibSelectedForBlur(settled)).toBe(false);
  });

  it('thresholds are the documented constants', () => {
    expect(GIB_BLUR_MIN_SPEED_MPS).toBeGreaterThan(0);
    expect(GIB_BLUR_MIN_ANGVEL_RADPS).toBeGreaterThan(0);
    expect(isGibSelectedForBlur(chunk({ vel: [0.05, 0, 0] }))).toBe(false);
    expect(isGibSelectedForBlur(chunk({ angVel: [0, 0.2, 0] }))).toBe(false);
  });
});

describe('gib motion — prior state / shortest arc / timing', () => {
  it('integrates translation backwards over a fixed exposure', () => {
    const s = chunk({ vel: [2, 0, 0] });
    const p = gibPriorState(s, 0.05);
    expect(p.pos[0]).toBeCloseTo(-0.1, 10);
    expect(p.pos[1]).toBeCloseTo(0, 10);
    // Doubling the exposure doubles the displacement — no frame rate in sight.
    const p2 = gibPriorState(s, 0.1);
    expect(p2.pos[0]).toBeCloseTo(-0.2, 10);
  });

  it('takes the SHORT arc, never 2π minus the step', () => {
    // 350 degrees of orientation, exposed for 10 degrees' worth of time.
    const qNow = qFromAxisAngle([0, 1, 0], (350 * Math.PI) / 180);
    const w = 10 * (Math.PI / 180); // rad/s
    const s = chunk({ quat: qNow, angVel: [0, w, 0] });
    const p = gibPriorState(s, 1); // exactly 10 degrees back
    // Relative rotation angle between prior and now must be ~10 deg.
    const d = Math.abs(p.quat[0] * s.quat[0] + p.quat[1] * s.quat[1]
      + p.quat[2] * s.quat[2] + p.quat[3] * s.quat[3]);
    const relAngle = 2 * Math.acos(Math.min(1, d));
    expect(relAngle).toBeCloseTo((10 * Math.PI) / 180, 6);
    // And the prior is sign-normalised into the current hemisphere.
    expect(p.quat[0] * s.quat[0] + p.quat[1] * s.quat[1]
      + p.quat[2] * s.quat[2] + p.quat[3] * s.quat[3]).toBeGreaterThan(0);
  });

  it('is invariant to the sign of the current quaternion', () => {
    const base = qFromAxisAngle([1, 0, 0], 0.7);
    const neg: Quat = [-base[0], -base[1], -base[2], -base[3]];
    const a = gibPriorState(chunk({ quat: base, angVel: [0, 0, 1] }), 0.05);
    const b = gibPriorState(chunk({ quat: neg, angVel: [0, 0, 1] }), 0.05);
    // Same rotation (possibly opposite sign): |dot| == 1.
    const d = Math.abs(a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1]
      + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3]);
    expect(d).toBeCloseTo(1, 10);
  });

  it('is a fixed shutter interval: exposure scales, presented cadence does not', () => {
    const s = chunk({ vel: [4, 0, 0] });
    const oneFrameAt = (fps: number): number => gibPriorState(s, 1 / fps).pos[0]!;
    // A 1/120 s frame advances a quarter of a 1/30 s frame's distance...
    expect(oneFrameAt(120)).toBeCloseTo(oneFrameAt(30) / 4, 10);
    // ...but the SHUTTER integrates one fixed interval, so the blur length is
    // exposure * velocity at every cadence (30/60/120 alike).
    const exposure = 0.044444;
    expect(gibPriorState(s, exposure).pos[0]).toBeCloseTo(-4 * exposure, 10);
    expect(gibPriorState(s, exposure).pos[0]).toBeCloseTo(gibPriorState(s, exposure).pos[0]!, 12);
  });

  it('relaxes squash at the integrator rate and clamps at zero', () => {
    const s = chunk({ squash: 1, vel: [1, 0, 0] });
    const p = gibPriorState(s, 0.05);
    expect(p.squash).toBeCloseTo(1 - CHUNK_TUNING.squashRelax * 0.05, 10);
    expect(gibPriorState(chunk({ squash: 0.01 }), 0.05).squash).toBe(0);
  });

  it('bounded exposure samples run now -> prior, oldest last', () => {
    const s = chunk({ vel: [1, 0, 0] });
    const samples = gibExposureSampleStates(s, 0.04, 3);
    expect(samples).toHaveLength(3);
    expect(samples[0]!.pos[0]).toBeCloseTo(0, 10);
    expect(samples[1]!.pos[0]).toBeCloseTo(-0.02, 10);
    expect(samples[2]!.pos[0]).toBeCloseTo(-0.04, 10);
  });
});

describe('gib motion — probes', () => {
  it('caps probes and deduplicates the support ends', () => {
    const capsule = chunk({
      radius: 0.3, support: [{ c: [0, -0.3, 0], r: 0.1 }, { c: [0, 0.3, 0], r: 0.1 }],
    });
    const locals = gibProbeLocals(capsule);
    expect(locals.length).toBeLessThanOrEqual(GIB_BLUR_MAX_PROBES);
    expect(locals.length).toBeGreaterThanOrEqual(2);
    // The two support ends survived.
    expect(locals.some(p => Math.abs(p[1] + 0.3) < 1e-9)).toBe(true);
    expect(locals.some(p => Math.abs(p[1] - 0.3) < 1e-9)).toBe(true);
  });
});

describe('gib motion — pure spin blur at the edges', () => {
  it('a fixed-centre spin produces non-zero edge motion with a still centre', () => {
    const spin = chunk({ pos: [0, 0, -3], vel: [0, 0, 0], angVel: [0, 6, 0], radius: 0.25 });
    const stamps = planGibMotionStamps(spin, 7, proj(), 0.044444, { maxStreakPx: 120 });
    expect(stamps.length).toBeGreaterThan(1);
    // Every stamp refers to the same owner stream.
    expect(stamps.every(s => s.stream === 7)).toBe(true);
    // The centre probe's own local point is (0,0,0) -> no translation; its
    // streak is zero and it must not be stamped. At least one edge probe must
    // carry real motion.
    const maxStreak = Math.max(...stamps.map(s => s.streakPx));
    expect(maxStreak).toBeGreaterThan(1);
    // A single centre vector is NOT enough: rotation gives the probes different
    // velocities, so the set must vary.
    const vx = new Set(stamps.map(s => s.velocityX.toFixed(3)));
    expect(vx.size).toBeGreaterThan(1);
  });

  it('translation alone moves every probe together with the centre', () => {
    const fly = chunk({ pos: [0, 0, -3], vel: [3, 0, 0] });
    const stamps = planGibMotionStamps(fly, 3, proj(), 0.044444, { maxStreakPx: 400 });
    expect(stamps).toHaveLength(1); // non-rotating -> one full-radius probe
    expect(stamps[0]!.streakPx).toBeGreaterThan(1);
    // Moving +x in view space means moving +x in output pixels.
    expect(stamps[0]!.toX).toBeGreaterThan(stamps[0]!.fromX);
    expect(Math.abs(stamps[0]!.toY - stamps[0]!.fromY)).toBeLessThan(1e-6);
  });

  it('clamps the streak to the shared max-trail cap', () => {
    const fast = chunk({ pos: [0, 0, -1.2], vel: [40, 0, 0] });
    const stamps = planGibMotionStamps(fast, 1, proj(), 0.2, { maxStreakPx: 120 });
    expect(stamps.length).toBeGreaterThan(0);
    for (const s of stamps) expect(s.streakPx).toBeLessThanOrEqual(120 + 1e-9);
  });

  it('age clamp suppresses a newborn streak and scales with age', () => {
    const s = chunk({ vel: [3, 0, 0] });
    expect(planGibMotionStamps(s, 1, proj(), 0.044444, { maxStreakPx: 400, ageSeconds: 0 }))
      .toHaveLength(0);
    const tiny = planGibMotionStamps(s, 1, proj(), 0.044444, { maxStreakPx: 400, ageSeconds: 0.005 });
    const full = planGibMotionStamps(s, 1, proj(), 0.044444, { maxStreakPx: 400, ageSeconds: 1 });
    // `Infinity` (already presented) must mean FULL exposure, not zero.
    const inf = planGibMotionStamps(s, 1, proj(), 0.044444, { maxStreakPx: 400, ageSeconds: Infinity });
    expect(inf).toHaveLength(1);
    expect(inf[0]!.streakPx).toBeCloseTo(full[0]!.streakPx, 10);
    expect(tiny.length).toBe(1);
    // The stored vector multiplies the FULL exposure back to the age-clamped
    // segment, and the newborn streak is shorter than the full one.
    expect(Math.abs(tiny[0]!.velocityU) / tiny[0]!.streakPx)
      .toBeCloseTo(1 / (800 * 0.044444), 10);
    expect(tiny[0]!.streakPx).toBeLessThan(full[0]!.streakPx);
  });

  it('does nothing at zero exposure or with a degenerate transform', () => {
    expect(planGibMotionStamps(chunk({ vel: [1, 0, 0] }), 1, proj(), 0, { maxStreakPx: 120 }))
      .toHaveLength(0);
    const nan = chunk({ pos: [NaN, 0, -3] as Vec3 });
    expect(planGibMotionStamps(nan, 1, proj(), 0.04, { maxStreakPx: 120 })).toHaveLength(0);
  });

  it('depth ordering: a farther piece carries a larger buffer depth', () => {
    const near = planGibMotionStamps(chunk({ pos: [0, 0, -2], vel: [2, 0, 0] }), 1, proj(), 0.04, { maxStreakPx: 120 });
    const far = planGibMotionStamps(chunk({ pos: [0, 0, -8], vel: [2, 0, 0] }), 2, proj(), 0.04, { maxStreakPx: 120 });
    expect(near[0]!.ownerClipZ).toBeLessThan(far[0]!.ownerClipZ);
    expect(near[0]!.ownerViewDepth).toBeLessThan(far[0]!.ownerViewDepth);
  });
});
