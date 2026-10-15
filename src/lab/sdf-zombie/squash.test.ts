// src/lab/sdf-zombie/squash.test.ts
import { describe, it, expect } from 'vitest';
import { SQUASH_GAIN, squashAxes, squashMove, squashPlane, squashPoint, squashRestPrim, squashShape } from './squash';
import { sdPrimitive } from './validate';
import { add, dot, normalize, scale, sub } from './vec';
import type { Primitive, Vec3 } from './types';

const prim = (over: Partial<Primitive>): Primitive => ({
  a: [0.01, 1.2, 0.05], b: [0.04, 1.17, 0.09], radius: 0.012, scale: [1.3, 0.6, 1.1], blendK: 0.004, limb: 'head', cluster: 0,
  ...over,
} as Primitive);

/** Points on a prim's surface: bisect along rays out of its midpoint. */
function surfacePoints(p: Primitive, n = 40): Vec3[] {
  const mid = scale(add(p.a, p.b), 0.5);
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, phi = k * 2.399963;
    const z = 1 - 2 * u, r = Math.sqrt(1 - z * z);
    const dir = normalize([r * Math.cos(phi), r * Math.sin(phi), z]);
    let lo = 0, hi = 0.2;
    if (sdPrimitive(mid, p) >= 0 || sdPrimitive(add(mid, scale(dir, hi)), p) <= 0) continue;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (sdPrimitive(add(mid, scale(dir, m)), p) < 0) lo = m; else hi = m;
    }
    out.push(add(mid, scale(dir, (lo + hi) / 2)));
  }
  return out;
}

describe('squash axes', () => {
  it('is null at weight 0, without a weight, and for a non-finite weight: nothing moves', () => {
    expect(squashAxes(0)).toBeNull();
    expect(squashAxes(undefined)).toBeNull();
    expect(squashAxes(Number.NaN)).toBeNull();
    expect(squashAxes(Infinity)).toBeNull();
  });

  it('+ is wider, shorter and deeper; - is narrower, taller and shallower (linear in the weight)', () => {
    const s = squashAxes(1)!, t = squashAxes(-0.5)!;
    expect(s[0]).toBeCloseTo(1 + SQUASH_GAIN[0], 12);
    expect(s[0]).toBeGreaterThan(1); expect(s[1]).toBeLessThan(1); expect(s[2]).toBeGreaterThan(1);
    expect(t[0]).toBeLessThan(1); expect(t[1]).toBeGreaterThan(1);
    expect(t[1]).toBeCloseTo(1 - 0.5 * SQUASH_GAIN[1], 12);
    expect(squashAxes(-50)!.every(v => v >= 0.2)).toBe(true);
  });
});

describe('squashing a prim is the exact affine image of it', () => {
  const c: Vec3 = [0, 1.235, 0.003];
  const s = squashAxes(0.8)!;
  const CASES: [string, Primitive][] = [
    ['anisotropic capsule', prim({})],
    ['tapered', prim({ radiusB: 0.006 })],
    ['bent', prim({ bend: [0, -0.012, 0.01] })],
    ['bent and tapered', prim({ bend: [0.004, 0.006, -0.01], radiusB: 0.02, scale: [0.8, 1.1, 1.4] })],
    ['box', prim({ box: { round: 0.3 } } as Partial<Primitive>)],
    ['point ellipsoid', prim({ b: [0.01, 1.2, 0.05], scale: [1.33, 0.56, 1.25] })],
  ];
  it.each(CASES)('%s: every surface point maps onto the squashed prim\'s surface', (_n, p) => {
    const q = squashRestPrim(p, c, s);
    const pts = surfacePoints(p);
    expect(pts.length).toBeGreaterThan(30);
    for (const x of pts) expect(Math.abs(sdPrimitive(squashPoint(x, c, s), q))).toBeLessThan(1e-9);
  });

  it('squashShape scales the axes and the bend, and leaves radius, taper and blend', () => {
    const p = prim({ bend: [0.01, 0.02, 0.03], radiusB: 0.004 });
    const q = squashShape(p, [2, 3, 4]);
    expect(q.scale).toEqual([p.scale[0] * 2, p.scale[1] * 3, p.scale[2] * 4]);
    expect(q.bend).toEqual([0.01 * 2, 0.02 * 3, 0.03 * 4]);
    expect([q.radius, q.radiusB, q.blendK, q.a, q.b]).toEqual([p.radius, p.radiusB, p.blendK, p.a, p.b]);
    expect('bend' in squashShape(prim({}), [2, 3, 4])).toBe(false);
  });

  it('a clip plane maps as a plane: points on it stay on it', () => {
    const n = normalize([0.2, -1, 0.3]), d = -0.7;
    const pl = squashPlane(n, d, c, s);
    expect(Math.hypot(...pl.normal)).toBeCloseTo(1, 12);
    // Three points on the plane.
    const p0 = scale(n, d);
    for (const off of [[0, 0, 0], [0.05, 0, 0], [0, 0, 0.07], [0.03, 0, -0.02]] as Vec3[]) {
      const x = sub(add(p0, off), scale(n, dot(n, off)));
      expect(dot(n, x)).toBeCloseTo(d, 12);
      expect(dot(pl.normal, squashPoint(x, c, s))).toBeCloseTo(pl.offset, 12);
    }
  });

  it('the move is (S - I)(x - c), and the point map is x plus the move', () => {
    const x: Vec3 = [0.03, 1.13, 0.09];
    for (let k = 0; k < 3; k++) expect(squashPoint(x, c, s)[k]).toBeCloseTo(x[k]! + squashMove(x, c, s)[k]!, 15);
    expect(squashPoint(c, c, s)).toEqual(c);
  });
});
