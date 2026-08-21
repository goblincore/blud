// src/lab/sdf-zombie/taper.test.ts
//
// The tapered primitive and the chamfer fold — the two shapes `.blob` could
// not make.
//
// Before these, the format had exactly one primitive (an axis-scaled capsule)
// and exactly one fold (the quadratic smooth-min, with `blendK: 0` as the sole
// alternative). Between them that ruled out every SHARP feature: smooth-min
// rounds any tip it touches, so the sharpest authorable thing was a small
// sphere, and the only alternative to a fillet was a raw boolean seam. The
// goblin's hooked nose is two ellipsoids faked into a hook that reads as a
// bump in profile, and that is the format's limit showing, not the author's.
import { describe, it, expect } from 'vitest';
import { sdPrimitive, smin, sminChamfer } from './validate';
import type { Primitive, Vec3 } from './types';

const prim = (over: Partial<Primitive> = {}): Primitive => ({
  a: [0, 0, 0], b: [0, 1, 0], radius: 0.2, scale: [1, 1, 1],
  blendK: 0, limb: 'torso', cluster: 0, ...over,
});

describe('tapered primitive', () => {
  // The formula has to reduce to the capsule it replaces, or every existing
  // character silently changes shape the day someone adds a taper next to it.
  it('with radiusB equal to radius is the capsule it replaces', () => {
    const plain = prim();
    const same = prim({ radiusB: 0.2 });
    for (const p of [[0, 0.5, 0], [0.5, 0.5, 0], [0, -0.4, 0], [0.3, 1.4, 0.2]] as Vec3[])
      expect(sdPrimitive(p, same), `at ${p}`).toBeCloseTo(sdPrimitive(p, plain), 9);
  });

  // THE POINT OF THE WHOLE THING. radiusB 0 puts the surface exactly at `b` —
  // a true point. The capsule reads -0.2 there, because `b` is its centre.
  it('with radiusB 0 makes a TRUE POINT at b', () => {
    expect(sdPrimitive([0, 1, 0], prim({ radiusB: 0 }))).toBeCloseTo(0, 9);
    expect(sdPrimitive([0, 1, 0], prim())).toBeCloseTo(-0.2, 9);
  });

  it('measures true distance beyond the point', () => {
    // 0.3 past the tip along the axis is 0.3 of air.
    expect(sdPrimitive([0, 1.3, 0], prim({ radiusB: 0 }))).toBeCloseTo(0.3, 6);
  });

  // A cone narrows along its length; a capsule does not. Sampling the same
  // offset from the axis at two heights separates them, and this is what
  // actually reads on screen as a taper.
  it('narrows along its axis', () => {
    const cone = prim({ radiusB: 0.02 });
    const near = sdPrimitive([0.1, 0.15, 0], cone);
    const far = sdPrimitive([0.1, 0.85, 0], cone);
    expect(far).toBeGreaterThan(near + 0.08);
    const cap = prim();
    expect(sdPrimitive([0.1, 0.85, 0], cap)).toBeCloseTo(sdPrimitive([0.1, 0.15, 0], cap), 9);
  });

  it('handles a widening taper too, not only a narrowing one', () => {
    const flare = prim({ radius: 0.02, radiusB: 0.2 });
    expect(sdPrimitive([0.1, 0.85, 0], flare))
      .toBeLessThan(sdPrimitive([0.1, 0.15, 0], flare) - 0.08);
  });

  // Degenerate input must not poison the fold. A blob whose `tip=` is zero has
  // a === b, and the round-cone divisions would produce NaN — one NaN in a
  // smooth-min fold takes the entire body with it.
  it('does not produce NaN when both ends coincide', () => {
    const dot = prim({ b: [0, 0, 0], radiusB: 0 });
    const d = sdPrimitive([0, 0.5, 0], dot);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(0.5 - 0.2, 6); // the larger of the two radii
  });

  it('still respects the ellipsoid scale', () => {
    const wide = prim({ radiusB: 0, scale: [2, 1, 1] });
    expect(sdPrimitive([0, 1, 0], wide)).toBeCloseTo(0, 6);
    // minScale multiplies the result exactly as it does for a capsule.
    expect(sdPrimitive([0, 1.3, 0], wide)).toBeCloseTo(0.3, 6);
  });
});

describe('chamfer fold', () => {
  it('degenerates to a plain min at k = 0, exactly like smin', () => {
    expect(sminChamfer(0.3, 0.7, 0)).toBe(0.3);
    expect(sminChamfer(0.3, 0.7, 0)).toBe(smin(0.3, 0.7, 0));
  });

  it('only ever adds material — never more than min', () => {
    for (const [a, b] of [[0.1, 0.2], [-0.3, 0.05], [0, 0], [1, -1]] as const)
      expect(sminChamfer(a, b, 0.05)).toBeLessThanOrEqual(Math.min(a, b) + 1e-12);
  });

  // THE DEFINING PROPERTY. A chamfer's blend surface is a PLANE, so inside the
  // blend the result depends only on `a + b` — move material from one field to
  // the other and the answer does not change. The quadratic smooth-min is a
  // curve and does not have this property. This is the difference between a
  // crease and a fillet, stated in a way a test can see.
  it('blends along a FLAT bevel — the result depends only on a + b', () => {
    const k = 0.05;
    const pairs: [number, number][] = [[0.00, 0.04], [0.01, 0.03], [0.02, 0.02]];
    const vals = pairs.map(([a, b]) => sminChamfer(a, b, k));
    for (const v of vals) expect(v).toBeCloseTo(vals[0]!, 12);
    // ...and smin genuinely differs across the same set, so the assertion above
    // is not just describing arithmetic both profiles happen to share.
    const round = pairs.map(([a, b]) => smin(a, b, k));
    expect(Math.max(...round) - Math.min(...round)).toBeGreaterThan(1e-4);
  });

  it('differs from the round fold wherever the two surfaces actually meet', () => {
    expect(sminChamfer(0.01, 0.01, 0.05)).not.toBeCloseTo(smin(0.01, 0.01, 0.05), 6);
  });

  it('leaves far-apart surfaces alone', () => {
    // Well outside the blend reach, a union is a union in either profile.
    expect(sminChamfer(0.02, 9.0, 0.05)).toBeCloseTo(0.02, 9);
  });
});
