// src/lab/sdf-zombie/webgpu/march-tracer.test.ts
//
// Line-for-line TS transcriptions of MARCH_BODY's relaxed sphere-tracing
// loop — the pre-fix version and the fixed one — run against analytic fields.
// The only way to unit-test the loop's boundary behaviour, since CI has no
// GPU; and the pre-fix version stays here deliberately, as the permanent
// record of what the bug WAS.
//
// THE BUG. The relaxed tracer's safety net runs one iteration late: an
// over-relaxed step can cross the surface, and the overshoot test only
// notices at the NEXT sample — but the loop broke on `t > tMax` before that
// sample happened. Harmless while tMax was the proxy-box exit (far behind the
// surface, so the retraction always got its chance). The occluder pre-pass
// made tMax a real bound that can sit millimetres behind the surface, and
// then one relaxed step could cross surface and tMax together: break,
// discard, hole. On screen: bodies shredded with black holes exactly where
// other bodies' hull spheres sat close behind the front surface — the
// interpenetrating-crowd case — while normal spreads looked fine, because
// there the nearest hull is the body's own endpoint spheres, far behind.
//
// Confirmed in the browser before fixing: same scene, occluder on, holes at
// relax 1.6 and NONE at relax 1.0 — which also refuted the rival hypothesis,
// since a mirrored occluder fetch would hole regardless of relaxation.
//
// KEEP THE FIXED TRANSCRIPTION IN SYNC WITH MARCH_BODY BY HAND. The WGSL
// string assertions at the bottom pin the guard's presence in the shader;
// this file proves the guard's semantics. Neither alone is worth much.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from './march.wgsl';

/** Analytic stand-in for mapBody: distance along a ray parameterised by t. */
type FieldAlongRay = (t: number) => number;

const HIT_EPS = 0.0012;
const STEPS = 96;

interface TraceResult { hit: boolean; t: number; samples: number }

/**
 * The loop as it shipped BEFORE the fix. `omega0` mirrors the WGSL's
 * select(): the caller passes the relax factor (1.6) or stepMul (0.6).
 */
function tracePreFix(field: FieldAlongRay, tMax: number, omega0 = 1.6, startT = 0): TraceResult {
  let omega = omega0;
  let t = Math.min(Math.max(startT, 0), tMax);
  let hit = false;
  let prevRadius = 0;
  let stepLen = 0;
  let samples = 0;
  for (let i = 0; i < STEPS; i++) {
    const d = field(t);
    samples++;
    const radius = Math.abs(d);
    const overshot = omega > 1.0 && radius + prevRadius < stepLen;
    if (overshot) {
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      if (d < HIT_EPS) { hit = true; break; }
      stepLen = d * omega;
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) { break; }
  }
  return { hit, t, samples };
}

/** The fixed loop. Identical except for the guarded tMax break. */
function trace(field: FieldAlongRay, tMax: number, omega0 = 1.6, startT = 0): TraceResult {
  let omega = omega0;
  let t = Math.min(Math.max(startT, 0), tMax);
  let hit = false;
  let prevRadius = 0;
  let stepLen = 0;
  let samples = 0;
  let clamped = false;
  for (let i = 0; i < STEPS; i++) {
    const d = field(t);
    samples++;
    const radius = Math.abs(d);
    const overshot = omega > 1.0 && radius + prevRadius < stepLen;
    if (overshot) {
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      if (d < HIT_EPS) { hit = true; break; }
      stepLen = d * omega;
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) {
      // The fix. A relaxed step may have crossed the surface AND tMax in one
      // go; the overshoot test cannot fire until the next sample, so take
      // that sample AT tMax instead of breaking first. `clamped` bounds it to
      // one extra visit, so a genuinely empty ray still terminates.
      if (omega <= 1.0 || clamped) { break; }
      t = tMax;
      clamped = true;
    }
  }
  return { hit, t, samples };
}

/** Sphere of radius 1 centred at t=5 along the ray: surface at t=4. */
const sphereAt5: FieldAlongRay = (t) => Math.abs(t - 5) - 1;

describe('the pre-fix loop, kept as the record of the bug', () => {
  it('misses a surface that one relaxed step jumps clean over', () => {
    // From t=0 the field reads 4, so the first relaxed step is 4 * 1.6 = 6.4:
    // past the surface at t=4 AND past tMax at 4.02 in one step. This miss,
    // at scale, was the hole pattern across the interpenetrating crowd.
    const r = tracePreFix(sphereAt5, 4.02);
    expect(r.hit).toBe(false);
  });

  it('was fine when tMax sat far behind the surface — why nobody had seen it', () => {
    const r = tracePreFix(sphereAt5, 100);
    expect(r.hit).toBe(true);
    expect(r.t).toBeCloseTo(4, 2);
  });
});

describe('the fixed loop', () => {
  it('finds the surface the pre-fix loop missed', () => {
    const r = trace(sphereAt5, 4.02);
    expect(r.hit).toBe(true);
    expect(r.t).toBeCloseTo(4, 2);
  });

  it('finds it however tight the hull gap is', () => {
    for (const gap of [0.05, 0.02, 0.005, 0.001]) {
      const r = trace(sphereAt5, 4 + gap);
      expect(r.hit, `gap ${gap}`).toBe(true);
      expect(r.t).toBeCloseTo(4, 2);
    }
  });

  it('agrees with the unclamped march on where the surface is', () => {
    const free = trace(sphereAt5, 100);
    const clamped = trace(sphereAt5, 4.02);
    expect(free.hit).toBe(true);
    expect(Math.abs(free.t - clamped.t)).toBeLessThan(HIT_EPS * 4);
  });

  it('still misses when the surface truly lies beyond tMax', () => {
    // Surface at 4, occluder at 3.5: something else covers this ray, and the
    // clamp SHOULD discard it. The fix must not turn honest misses into hits.
    const r = trace(sphereAt5, 3.5);
    expect(r.hit).toBe(false);
  });

  it('terminates promptly on an empty ray instead of resampling tMax forever', () => {
    // No surface anywhere. `clamped` allows exactly one visit to tMax;
    // without it the loop would pin t there and burn the whole step budget
    // resampling one point.
    const empty: FieldAlongRay = () => 10;
    const r = trace(empty, 8);
    expect(r.hit).toBe(false);
    expect(r.samples).toBeLessThanOrEqual(3);
  });

  it('leaves the plain (relax-off) path exactly as it was', () => {
    // omega0 = 0.6 is the WGSL's select() outcome with relax off. It never
    // over-steps, so the guard must never fire: same hit, same t, and the
    // same number of samples as the pre-fix loop took.
    const fixed = trace(sphereAt5, 4.02, 0.6);
    const old = tracePreFix(sphereAt5, 4.02, 0.6);
    expect(fixed.hit).toBe(true);
    expect(old.hit).toBe(true);
    expect(fixed.t).toBeCloseTo(old.t, 6);
    expect(fixed.samples).toBe(old.samples);
  });
});

describe('the WGSL carries the same guard', () => {
  // The transcription above proves the semantics; these pin that the shader
  // string actually contains the construct being proven.
  it('declares the clamped flag and uses it in the tMax break', () => {
    expect(MARCH_BODY).toContain('var clamped = false;');
    expect(MARCH_BODY).toContain('omega <= 1.0 || clamped');
    expect(MARCH_BODY).toContain('clamped = true;');
  });

  it('clamps t to tMax rather than breaking on the relaxed path', () => {
    expect(MARCH_BODY).toContain('t = tMax;');
  });
});
