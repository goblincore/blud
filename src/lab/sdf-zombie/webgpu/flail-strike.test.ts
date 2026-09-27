// src/lab/sdf-zombie/webgpu/flail-strike.test.ts
//
import { describe, expect, it } from 'vitest';
import { FLAIL_STRIKE, inStrikeArc, resolveStrike, snapToSurface, viewToWorld, type StrikeActor } from './flail-strike';
import type { Vec3 } from '../types';

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
});
