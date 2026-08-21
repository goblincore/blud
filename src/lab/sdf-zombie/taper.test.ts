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
import { sdBody, sdGroove, sdPrimitive, smin, sminChamfer } from './validate';
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

describe('groove', () => {
  it('leaves the surface alone away from the cutting field', () => {
    // Far from b's zero-set, `rb - abs(b)` is very negative, so the min picks
    // it and the max keeps `a`. A groove must not shift the whole surface.
    expect(sdGroove(0.02, 0.9, 0.01, 0.005)).toBeCloseTo(0.02, 9);
    expect(sdGroove(-0.05, -0.9, 0.01, 0.005)).toBeCloseTo(-0.05, 9);
  });

  it('cuts INTO the surface where the cutting field crosses it', () => {
    // On b's zero-set the channel reaches its full depth: max(a, min(a+ra, rb)).
    const cut = sdGroove(0, 0, 0.01, 0.005);
    expect(cut).toBeGreaterThan(0);          // material removed — outside now
    expect(cut).toBeCloseTo(0.005, 9);       // bounded by the width, not the depth
  });

  it('is bounded by depth, so a wide groove cannot cut arbitrarily deep', () => {
    // `min(a + ra, ...)` is the whole point of the depth term: without it a
    // large width would carve straight through the body.
    expect(sdGroove(0, 0, 0.002, 0.5)).toBeCloseTo(0.002, 9);
  });

  it('never ADDS material — a groove only subtracts', () => {
    for (const a of [-0.4, -0.02, 0, 0.02, 0.4])
      for (const b of [-0.3, -0.001, 0, 0.001, 0.3])
        expect(sdGroove(a, b, 0.01, 0.006)).toBeGreaterThanOrEqual(a - 1e-12);
  });

  // Grooves belong to the CARVE pass. A groove prim that also folded additively
  // would add a solid lump and then cut a line in it.
  it('is skipped by the additive fold and applied after it', () => {
    const base = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.2, scale: [1, 1, 1] as [number, number, number],
      blendK: 0, limb: 'torso' as const, cluster: 0,
    };
    const body = {
      prims: [
        { ...base },
        // A groove prim sitting where it will cross the sphere's surface.
        { ...base, a: [0.2, 0, 0] as [number, number, number],
          b: [0.2, 0, 0] as [number, number, number], radius: 0.02,
          op: 'groove' as const, grooveDepth: 0.01, grooveWidth: 0.006 },
      ],
      clusters: [{ id: 0, limb: 'torso' as const, start: 0, count: 2,
        center: [0, 0, 0] as [number, number, number], radius: 0.3, alive: true }],
    };
    // Dead centre of the sphere is deep inside and untouched. This is the
    // assertion the ungated hg_sdf form fails: it reports -0.19, having lifted
    // the entire interior by the groove's depth.
    expect(sdBody([0, 0, 0], body as never)).toBeCloseTo(-0.2, 6);

    // Where the two SURFACES cross, material is removed. The groove prim is
    // centred on the big sphere's surface, so this point sits on the sphere
    // (a is ~0.001) and on the groove prim's own zero-set (b is 0).
    const onSeam: [number, number, number] = [0.2, 0.02, 0];
    expect(sdBody(onSeam, body as never)).toBeGreaterThan(0.005);

    // ...and a point the same distance out but AROUND the sphere, well away
    // from the cutting field, is untouched — so the groove really is a
    // channel and not a global offset.
    const offSeam: [number, number, number] = [0, 0.2, 0.02];
    expect(sdBody(offSeam, body as never)).toBeLessThan(0.0015);
  });
});
