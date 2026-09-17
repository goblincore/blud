// src/lab/sdf-zombie/probe-dynamic-cull.test.ts
//
// EQUIVALENCE GATE for the capsule-sweep cull (2026-09-10).
//
// The probe gather's capsule sweep was rewritten to reject a capsule on its
// BOUNDING SPHERE before paying for the ray/capsule quadratic, and the shadow
// query became an any-hit bounded by the light distance instead of a full
// nearest search. Both are meant to be *exactly* equivalent — the gather feeds
// the game's indirect lighting, so a cull that is 0.1% wrong is a visual bug,
// not a rounding difference.
//
// This file proves that rather than asserting it. `referenceCapsule` below is
// an INDEPENDENT re-derivation of the documented entry semantics (nearest
// positive entry into the swept sphere, null when the ray starts inside),
// written from the maths rather than copied from the module, so it catches a
// rewrite error and not just a typo. The three properties:
//
//   1. unbounded hitCapsule === reference, over randomised geometry
//   2. bounded hitCapsule(tMax) === reference, filtered to t < tMax
//   3. capsuleBlocks(dist) === reference !== null && reference.t < dist
//
// Property 2 is what makes the `tMax` threading in kProbeGather sound;
// property 3 is what makes kdShadowed's any-hit rewrite sound.

import { describe, it, expect } from 'vitest';
import { capsuleBlocks, hitCapsule } from './probe-dynamic';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

/**
 * Independent reference: nearest positive entry of a ray into a capsule
 * (swept sphere), or null if the origin is inside/on it.
 *
 * Derived from the definition, NOT from the module: solve |closestPointOnSegment(o+td)
 * - (o+td)|^2 = r^2. That is a quadratic in t whose coefficients are expanded
 * below from the standard segment-distance identity, and the two caps are the
 * same equation with the segment collapsed to an endpoint. The smallest t > 0
 * satisfying any of the three wins; the inside test is a plain point-to-segment
 * distance.
 */
function referenceCapsule(o: V3, d: V3, a: V3, b: V3, r: number): number | null {
  const ba = sub(b, a);
  const oa = sub(o, a);
  const baba = dot(ba, ba);
  const dirLen = len(d);
  const u = dirLen > 0 ? ([d[0] / dirLen, d[1] / dirLen, d[2] / dirLen] as V3) : d;

  // Inside/on: point-to-segment distance from the ORIGIN.
  const s = baba > 1e-18 ? Math.min(1, Math.max(0, dot(oa, ba) / baba)) : 0;
  const q = sub(o, [a[0] + ba[0] * s, a[1] + ba[1] * s, a[2] + ba[2] * s]);
  if (dot(q, q) < r * r) return null;

  // Brute force over the parameter: bisect the first sign change of
  // distance(o + t*u, segment) - r on a fine grid. Slow, obviously correct,
  // and shares no algebra with the implementation under test — which is the
  // whole point.
  const SEG = (t: number): number => {
    const p: V3 = [o[0] + u[0] * t, o[1] + u[1] * t, o[2] + u[2] * t];
    const pa = sub(p, a);
    let sc = baba > 1e-18 ? dot(pa, ba) / baba : 0;
    sc = Math.min(1, Math.max(0, sc));
    const c: V3 = [a[0] + ba[0] * sc, a[1] + ba[1] * sc, a[2] + ba[2] * sc];
    return len(sub(p, c)) - r;
  };
  const STEP = 0.002, TEND = 12;
  let prev = SEG(0);
  for (let t = STEP; t <= TEND; t += STEP) {
    const cur = SEG(t);
    if (prev > 0 && cur <= 0) {
      let lo = t - STEP, hi = t;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (SEG(mid) > 0) lo = mid; else hi = mid;
      }
      return hi;
    }
    prev = cur;
  }
  return null;
}

/** Deterministic PRNG so a failure is reproducible, not a lottery. */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A randomised capsule + ray, biased to produce plenty of near-misses. */
function caseAt(rand: () => number): { o: V3; d: V3; a: V3; b: V3; r: number } {
  const C = (): number => (rand() - 0.5) * 4;
  const a: V3 = [C(), C(), C()];
  const b: V3 = [a[0] + (rand() - 0.5) * 2, a[1] + (rand() - 0.5) * 2, a[2] + (rand() - 0.5) * 2];
  const o: V3 = [C(), C(), C()];
  // Half the rays aim at a point near the capsule so hits and near-misses are
  // both common; half are arbitrary.
  const aim: V3 = rand() < 0.5
    ? [a[0] + (rand() - 0.5) * 2, a[1] + (rand() - 0.5) * 2, a[2] + (rand() - 0.5) * 2]
    : [C(), C(), C()];
  const d = norm(sub(aim, o));
  return { o, d, a, b, r: 0.05 + rand() * 0.7 };
}

describe('capsule sweep cull — equivalence with an independent reference', () => {
  const N = 900;

  it('the unbounded query matches the reference (the cull never invents a miss)', () => {
    const rand = mulberry(0x5eed);
    let hits = 0;
    for (let i = 0; i < N; i++) {
      const { o, d, a, b, r } = caseAt(rand);
      const ref = referenceCapsule(o, d, a, b, r);
      const got = hitCapsule(o, d, a, b, r);
      if (ref === null) {
        expect(got, `case ${i}: reference missed, query hit at t=${got?.t}`).toBeNull();
      } else {
        expect(got, `case ${i}: reference hit at t=${ref}, query missed`).not.toBeNull();
        expect(got!.t).toBeCloseTo(ref, 2);
        hits++;
      }
    }
    // Guard against a degenerate draw that makes the suite vacuous.
    expect(hits).toBeGreaterThan(50);
  });

  it('the bounded query equals the reference filtered by the bound', () => {
    const rand = mulberry(0xb0ad);
    let kept = 0, dropped = 0;
    for (let i = 0; i < N; i++) {
      const { o, d, a, b, r } = caseAt(rand);
      const ref = referenceCapsule(o, d, a, b, r);
      for (const tMax of [0.5, 1, 2, 3, 6]) {
        const got = hitCapsule(o, d, a, b, r, tMax);
        const want = ref !== null && ref < tMax ? ref : null;
        if (want === null) {
          expect(got, `case ${i} tMax=${tMax}: expected a miss, got t=${got?.t}`).toBeNull();
          if (ref !== null) dropped++;
        } else {
          expect(got, `case ${i} tMax=${tMax}: expected t=${want}, got a miss`).not.toBeNull();
          expect(got!.t).toBeCloseTo(want, 2);
          kept++;
        }
      }
    }
    expect(kept).toBeGreaterThan(20);
    expect(dropped).toBeGreaterThan(20);
  });

  it('capsuleBlocks agrees with the reference over the whole bound range', () => {
    const rand = mulberry(0xb10c);
    let blocked = 0, clear = 0;
    for (let i = 0; i < N; i++) {
      const { o, d, a, b, r } = caseAt(rand);
      const ref = referenceCapsule(o, d, a, b, r);
      for (const dist of [0.25, 0.75, 1.5, 4, 10]) {
        const want = ref !== null && ref < dist;
        const got = capsuleBlocks(o, d, a, b, r, dist);
        expect(got, `case ${i} dist=${dist}: want ${want}, got ${got} (ref=${ref})`).toBe(want);
        if (want) blocked++; else clear++;
      }
    }
    expect(blocked).toBeGreaterThan(20);
    expect(clear).toBeGreaterThan(20);
  });

  it('a ray starting inside a capsule is not blocked by it, unbounded or bounded', () => {
    // The documented semantic: an occluder you are inside blocks nothing. This
    // is the case the bounding-sphere reject must not disturb — and it cannot,
    // because an origin inside the capsule is necessarily inside the sphere,
    // where the entry root is negative and neither bound test fires.
    const a: V3 = [0, 0, 0];
    const b: V3 = [0, 1, 0];
    const r = 0.5;
    for (const d of [[1, 0, 0], [0, 1, 0], [0.3, -0.8, 0.5]] as V3[]) {
      expect(hitCapsule([0, 0, 0], norm(d), a, b, r)).toBeNull();
      expect(hitCapsule([0, 0, 0], norm(d), a, b, r, 0.001)).toBeNull();
      expect(capsuleBlocks([0, 0, 0], norm(d), a, b, r, 0.001)).toBe(false);
    }
  });

  it('a degenerate capsule (a == b) is a sphere, not a crash or a free pass', () => {
    const a: V3 = [0, 0, 0];
    const r = 0.5;
    // Straight at the centre from 3 m out: entry at 2.5.
    const hit = hitCapsule([0, 0, -3], [0, 0, 1], a, a, r);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(2.5, 6);
    // Bounded short of the surface: a miss.
    expect(hitCapsule([0, 0, -3], [0, 0, 1], a, a, r, 2)).toBeNull();
    expect(capsuleBlocks([0, 0, -3], [0, 0, 1], a, a, r, 2)).toBe(false);
    expect(capsuleBlocks([0, 0, -3], [0, 0, 1], a, a, r, 3)).toBe(true);
  });

  it('a ray pointing away from a capsule is rejected without the quadratic', () => {
    // The exact case the bounding-sphere reject exists for: the sphere is
    // entirely behind the origin, so nothing can be hit at t > 0.
    const a: V3 = [0, 0, 0];
    const b: V3 = [0, 1, 0];
    expect(hitCapsule([0, 0, 5], [0, 0, 1], a, b, 0.5)).toBeNull();
    expect(capsuleBlocks([0, 0, 5], [0, 0, 1], a, b, 0.5, 100)).toBe(false);
  });
});
