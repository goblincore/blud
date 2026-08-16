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

/**
 * The X1.21.2 shell-displacement shape: the same body, DENTED — the fbm has
 * pulled the surface ~0.9 amp below its smooth position. 0.016 is the lab's
 * production amplitude and 0.9 the worst |fbm| (0.6 + 0.3 octaves of a
 * [-1, 1] noise), so the dent sits 0.0144 below the smooth skin.
 */
const SHELL_AMP = 0.016;
const dentedAt5: FieldAlongRay = (t) => Math.abs(t - (5 + 0.9 * SHELL_AMP)) - 1;

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

describe('the occluder bound under shell displacement (X1.21.2)', () => {
  // The hull clears the SMOOTH surface by only (1 - shrink) of the prim
  // radius. A thin limb with 0.008 of clearance loses that argument entirely
  // once a 0.0144 dent passes behind its hull sphere: the raw occT bound cuts
  // the ray in front of the surface the march needed to find, and the pixel
  // discards — the dark-dropout half of the shell glitches.
  const occT = 4 + 0.008;              // hull entry: 0.008 inside the smooth skin
  const dentT = 4 + 0.9 * SHELL_AMP;   // 4.0144 — past the hull

  it('misses the dent when tMax stops at the raw hull distance', () => {
    // The pre-fix bound. This miss, at scale, was the dark dropout the A/B
    // isolated (occluder off, shell on: the patches vanish).
    const r = trace(dentedAt5, occT);
    expect(r.hit).toBe(false);
  });

  it('finds the dent with the bound extended by the shell amp', () => {
    // The fix: min(box, occT + woundCfg2.z). One amp covers the worst dent
    // (0.9 amp) with margin to spare.
    const r = trace(dentedAt5, occT + SHELL_AMP);
    expect(r.hit).toBe(true);
    expect(r.t).toBeCloseTo(dentT, 3);
  });

  it('still misses a surface a full amp past the hull that no fbm can cut', () => {
    // The relaxation is one amp wide, not a licence to reach anything: a
    // surface 0.03 behind the hull entry is beyond even a worst-case dent and
    // must stay an honest miss (something else covers this ray).
    const deep: FieldAlongRay = (t) => Math.abs(t - 5.03) - 1;
    expect(trace(deep, occT + SHELL_AMP).hit).toBe(false);
  });

  it('never moves a BUMP out of reach — bumps were always nearer than the hull', () => {
    // The outward half of the displacement needs no help: a proud surface at
    // 4 - 0.0144 is in front of the hull entry, so both bounds find it and
    // the relaxation changes nothing about where.
    const proud: FieldAlongRay = (t) => Math.abs(t - (5 - 0.9 * SHELL_AMP)) - 1;
    const tight = trace(proud, occT);
    const loose = trace(proud, occT + SHELL_AMP);
    expect(tight.hit && loose.hit).toBe(true);
    expect(Math.abs(tight.t - loose.t)).toBeLessThan(HIT_EPS * 4);
  });
});
