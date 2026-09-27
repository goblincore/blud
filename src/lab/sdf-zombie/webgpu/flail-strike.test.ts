// src/lab/sdf-zombie/webgpu/flail-strike.test.ts
//
import { describe, expect, it } from 'vitest';
import { FLAIL_STRIKE, inStrikeArc, resolveStrike, snapToSurface, snapToSurfaceResidual, viewToWorld, type StrikeActor } from './flail-strike';
import type { Vec3 } from '../types';

/** Standard polynomial smooth-min (k = blend radius). */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

const EYE: Vec3 = [0, 1.62, 0];
const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const ball = (id: number, c: Vec3, r = 0.3): StrikeActor => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
/** A vertical capsule from a to b, radius r. */
const capsule = (id: number, a: Vec3, b: Vec3, r: number): StrikeActor => ({
  id, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  field: (p) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / (ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2)));
    return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t) - r;
  },
});

describe('viewToWorld', () => {
  it('maps view −z to the facing, x to the right, y to up (yaw 0, pitch 0)', () => {
    const f0 = viewToWorld(EYE, 0, 0, [0, 0, -1]);
    expect(f0[0]).toBeCloseTo(0, 9); expect(f0[1]).toBeCloseTo(1.62, 9); expect(f0[2]).toBeCloseTo(-1, 9);
    const r = viewToWorld(EYE, 0, 0, [1, 0, 0]);
    expect(r[0]).toBeCloseTo(1, 9); expect(r[2]).toBeCloseTo(0, 9);
    expect(viewToWorld(EYE, 0, 0, [0, 1, 0])[1]).toBeCloseTo(2.62, 9);
  });
  it('turns with yaw (yaw π/2 faces +x) and pitches with pitch', () => {
    const f = viewToWorld(EYE, Math.PI / 2, 0, [0, 0, -1]);
    expect(f[0]).toBeCloseTo(1, 9); expect(f[2]).toBeCloseTo(0, 9);
    const up = viewToWorld(EYE, 0, Math.PI / 2, [0, 0, -1]);
    expect(up[1]).toBeCloseTo(2.62, 9);
  });
});

describe('inStrikeArc', () => {
  it('takes a zombie in front within reach, and one hugging the player', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -1.5])).toBe(true);
    expect(inStrikeArc(EYE, 0, [0, 1.1, -0.03])).toBe(true);
  });
  it('refuses one too far or too wide', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -2.2])).toBe(false);
    const a = (70 * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(a) * 1.2, 1.1, -Math.cos(a) * 1.2])).toBe(false);
    const b = ((FLAIL_STRIKE.arcDeg - 5) * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(b) * 1.2, 1.1, -Math.cos(b) * 1.2])).toBe(true);
  });
});

describe('snapToSurface', () => {
  it('lands on the skin of a sphere and of a capsule (within 5 mm)', () => {
    const s = ball(1, [0, 1.1, -1.5]);
    const p = snapToSurface(s.field, [0.1, 1.3, -1.0]);
    expect(Math.abs(s.field(p))).toBeLessThan(0.005);
    const c = capsule(2, [0, 0.4, -1.5], [0, 1.4, -1.5], 0.18);
    const q = snapToSurface(c.field, [0.3, 1.0, -1.2]);
    expect(Math.abs(c.field(q))).toBeLessThan(0.005);
  });
});

describe('resolveStrike', () => {
  it('hits every actor in the arc, at a surface point, with a unit direction from the eye', () => {
    const impact: Vec3 = [0, 1.2, -1.2];
    const hits = resolveStrike(EYE, 0, impact, [
      ball(1, [0, 1.1, -1.5]), ball(2, [0.6, 1.1, -1.4]), ball(3, [0, 1.1, -3]),
    ]);
    expect(hits.map(h => h.actorId)).toEqual([1, 2]);
    for (const h of hits) expect(len(h.dir)).toBeCloseTo(1, 9);
    expect(Math.abs(Math.hypot(hits[0]!.point[0], hits[0]!.point[1] - 1.1, hits[0]!.point[2] + 1.5) - 0.3)).toBeLessThan(0.005);
  });
  it('hits nothing when nothing is in the arc (a whoosh)', () => {
    expect(resolveStrike(EYE, 0, [0, 1.2, -1.2], [ball(1, [0, 1.1, 1.5])])).toEqual([]);
  });
  it('returns no hit for an actor whose field goes non-finite', () => {
    const broken: StrikeActor = { id: 9, centre: [0, 1.1, -1.5], field: () => NaN };
    expect(resolveStrike(EYE, 0, [0, 1.2, -1.2], [broken])).toEqual([]);
  });
});

describe('snapToSurfaceResidual on a LOOSE field (gradient magnitude != 1)', () => {
  it('converges within 5 mm from 1 m out on a 0.4x-scaled sphere field', () => {
    const c: Vec3 = [0, 1.1, -1.5], r = 0.3;
    const trueField = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
    const loose = (p: Vec3) => 0.4 * trueField(p);
    const start: Vec3 = [c[0], c[1] + r + 1.0, c[2]]; // 1 m out from the skin
    const { point, residual } = snapToSurfaceResidual(loose, start);
    expect(residual).toBeLessThan(0.01);
    expect(Math.abs(trueField(point))).toBeLessThan(0.005);
  });
  it('converges on a smooth union of two spheres (smin, k = 0.1)', () => {
    const c1: Vec3 = [0, 1.1, -1.5], c2: Vec3 = [0.3, 1.1, -1.5], r = 0.25;
    const field = (p: Vec3) => smin(
      Math.hypot(p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]) - r,
      Math.hypot(p[0] - c2[0], p[1] - c2[1], p[2] - c2[2]) - r,
      0.1,
    );
    const { point, residual } = snapToSurfaceResidual(field, [0.15, 1.1, -1.0]);
    expect(residual).toBeLessThan(0.005);
    expect(Math.abs(field(point))).toBeLessThan(0.005);
  });
  it('reports an infinite residual (never a NaN point) when the field goes non-finite', () => {
    const { residual } = snapToSurfaceResidual(() => NaN, [0, 1, 0]);
    expect(residual).toBe(Infinity);
  });
});

describe('resolveStrike placement on a two-part body (torso + forward-hanging head)', () => {
  // A vertical torso capsule with a head sphere drooping forward (toward the
  // player, +z) and low, its jaw jutting out near chest height — the shape
  // that made the old nearest-Euclidean-point snap land on the face.
  const torsoA: Vec3 = [0, 0.9, -1.5], torsoB: Vec3 = [0, 1.6, -1.5], torsoR = 0.28;
  const headC: Vec3 = [0, 1.55, -1.05], headR = 0.22;
  const torsoSdf = (p: Vec3) => {
    const ab: Vec3 = [torsoB[0] - torsoA[0], torsoB[1] - torsoA[1], torsoB[2] - torsoA[2]];
    const ap: Vec3 = [p[0] - torsoA[0], p[1] - torsoA[1], p[2] - torsoA[2]];
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - torsoR;
  };
  const headSdf = (p: Vec3) => Math.hypot(p[0] - headC[0], p[1] - headC[1], p[2] - headC[2]) - headR;
  const bodySdf = (p: Vec3) => Math.min(torsoSdf(p), headSdf(p));
  const zombie: StrikeActor = { id: 7, centre: [0, 1.25, -1.5], field: bodySdf };

  it('lands a chest-height strike on the torso, not the head', () => {
    // 0.36 m in front of the torso's front face (z = -1.5 + 0.28 = -1.22).
    const impact: Vec3 = [0, 1.25, -0.86];
    const hits = resolveStrike(EYE, 0, impact, [zombie]);
    expect(hits).toHaveLength(1);
    expect(Math.abs(torsoSdf(hits[0]!.point))).toBeLessThan(0.02);
    expect(headSdf(hits[0]!.point)).toBeGreaterThan(0.05);
  });

  it('lands a hit on the front of a hugging actor, not its back', () => {
    const a: Vec3 = [0, 0.9, -0.2], b: Vec3 = [0, 1.6, -0.2], r = 0.28;
    const hugger = capsule(8, a, b, r);
    const impact: Vec3 = [0, 1.25, -0.36];
    const hits = resolveStrike(EYE, 0, impact, [hugger]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point[2]).toBeGreaterThan(-0.2); // front half, not the -0.48 back wall
  });
});
