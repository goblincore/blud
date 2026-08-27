import { describe, it, expect, vi } from 'vitest';
import { binResiduals, fitPrims, projectToSurface, sampleBodySurface } from './ring-fit';
import { ringBasis } from './ref-align';
import { sdBody } from './validate';
import type { Primitive, ClusterInfo, ResolvedBone } from './types';

/**
 * One upright capsule, radius 0.1, from y=0 to y=1.
 *
 * ClusterInfo requires id/limb/center/radius as well as start/count/alive —
 * write the whole literal rather than casting a subset, so a future field
 * addition breaks here loudly instead of being silently cast away.
 */
function oneCapsule(scale: [number, number, number] = [1, 1, 1]): {
  prims: Primitive[]; clusters: ClusterInfo[];
} {
  const prims: Primitive[] = [{
    a: [0, 0, 0], b: [0, 1, 0], radius: 0.1, scale,
    blendK: 0.01, limb: 'torso', cluster: 0, bone: 'spine1', src: 42,
  }];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0.5, 0], radius: 1, alive: true },
  ];
  return { prims, clusters };
}

describe('projectToSurface', () => {
  it('lands a point on the zero level set', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.4, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });

  it('converges from inside as well as outside', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.01, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });
});

describe('sampleBodySurface', () => {
  it('returns points on the surface, grouped by the bone they came from', () => {
    const body = oneCapsule();
    const byBone = sampleBodySurface(body, 200);
    const pts = byBone.get('spine1')!;
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts) expect(Math.abs(sdBody(p, body))).toBeLessThan(1e-5);
  });

  it('reflects anisotropy — a deep=2 capsule reaches twice as far in z', () => {
    const byBone = sampleBodySurface(oneCapsule([1, 1, 2]), 400);
    const pts = byBone.get('spine1')!;
    const maxX = Math.max(...pts.map((p) => Math.abs(p[0])));
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(maxZ / maxX).toBeGreaterThan(1.7);
  });
});

/**
 * Anisotropy regression. The ratio-2 fixture above is too gentle to catch the
 * real failure: `sdPrimitive` multiplies by minScale, so the field under-reports
 * distance by minScale/maxScale and Newton degrades from quadratic to LINEAR
 * convergence at that rate. A fixed 24-step budget then runs out, and the points
 * it fails to land are exactly the ones at the major-axis extremes — where the
 * gradient is shortest. Those get dropped by the `< 1e-6` filter, so the sample
 * set silently shrinks INWARD and every measurement taken off it under-reports.
 *
 * Measured at 24 steps before the per-prim budget existed: ratio 4 kept 218/400
 * and reached 0.39035 against an analytic 0.4; ratio 10 kept 197/400 and reached
 * 0.28926 against 0.3. Both are caught by pinning reach to within 1%.
 */
describe('sampleBodySurface anisotropy', () => {
  it('loses no points and reaches the analytic extent at ratio 4', () => {
    const body = oneCapsule([1, 1, 4]);
    const pts = sampleBodySurface(body, 400).get('spine1')!;
    expect(pts.length).toBeGreaterThan(396);
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(Math.abs(maxZ - 0.4) / 0.4).toBeLessThan(0.01);
  });

  it('loses no points and reaches the analytic extent at ratio 10', () => {
    const body = oneCapsule([0.3, 1, 3]);
    const pts = sampleBodySurface(body, 400).get('spine1')!;
    expect(pts.length).toBeGreaterThan(396);
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(Math.abs(maxZ - 0.3) / 0.3).toBeLessThan(0.01);
  });

  /**
   * No silent caps. The step budget is capped, so a pathological ratio can
   * still lose points — but a biased sample set must never be able to pass for
   * a complete one. Warn, do not throw: a later task sampling a real body
   * should degrade rather than die.
   */
  it('warns rather than silently dropping points when the budget is exhausted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pts = sampleBodySurface(oneCapsule([0.005, 1, 1]), 200).get('spine1')!;
      expect(pts.length).toBeLessThan(200);
      expect(warn).toHaveBeenCalled();
      const msg = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(msg).toContain('spine1');
      expect(msg).toContain('200');
    } finally {
      warn.mockRestore();
    }
  });
});

/** Two blended capsules stacked on one bone — exercises the blend seam. */
function twoCapsules(radius0 = 0.1): {
  prims: Primitive[]; clusters: ClusterInfo[]; bones: Map<string, ResolvedBone>;
} {
  const prims: Primitive[] = [
    { a: [0, 0.0, 0], b: [0, 0.5, 0], radius: radius0, scale: [1, 1, 1],
      blendK: 0.03, limb: 'torso', cluster: 0, bone: 'spine1', src: 10 },
    { a: [0, 0.5, 0], b: [0, 1.0, 0], radius: 0.09, scale: [1, 1, 1],
      blendK: 0.03, limb: 'torso', cluster: 0, bone: 'spine1', src: 11 },
  ];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 2, center: [0, 0.5, 0], radius: 1, alive: true },
  ];
  const bones = new Map<string, ResolvedBone>([['spine1', { head: [0, 0, 0], tail: [0, 1, 0] }]]);
  return { prims, clusters, bones };
}

describe('binResiduals', () => {
  it('reports near-zero residual when the body IS the reference', () => {
    const body = twoCapsules();
    const bins = binResiduals(sampleBodySurface(body, 300), body, body.bones);
    expect(bins.size).toBe(2);
    for (const bin of bins.values()) {
      const meanAbs = bin.samples.reduce((s, x) => s + Math.abs(x.d), 0) / bin.samples.length;
      expect(meanAbs).toBeLessThan(1e-4);
    }
  });

  it('reports a proud body as negative residual', () => {
    const ref = sampleBodySurface(twoCapsules(0.10), 300);  // reference at r=0.10
    const fat = twoCapsules(0.12);                          // ours is 20mm fatter
    const bins = binResiduals(ref, fat, fat.bones);
    const bin = bins.get(0)!;
    const mean = bin.samples.reduce((s, x) => s + x.d, 0) / bin.samples.length;
    expect(mean).toBeLessThan(-0.005);                      // negative == proud
  });

  it('flags the blend seam', () => {
    const body = twoCapsules();
    const bins = binResiduals(sampleBodySurface(body, 400), body, body.bones);
    // Both prims sit within blendK of each other at y=0.5, so neither should
    // report a zero blend-dominated fraction.
    expect(bins.get(0)!.blendDominated).toBeGreaterThan(0);
    expect(bins.get(0)!.blendDominated).toBeLessThan(1);
  });

  it('bins theta in the basis that ringBasis defines', () => {
    const body = twoCapsules();
    // The frame theta is measured in is the one ringBasis returns for the
    // prim's OWN axis — not some ad-hoc basis, and not the bone's length.
    const b = ringBasis(body.prims[0]!.a, body.prims[0]!.b);
    const bin = binResiduals(sampleBodySurface(body, 200), body, body.bones).get(0)!;
    for (const k of ['e1', 'e2', 'u'] as const) {
      for (let i = 0; i < 3; i++) expect(bin.basis[k][i]).toBeCloseTo(b[k]![i]!, 12);
    }
    const thetas = bin.samples.map((s) => s.theta);
    expect(Math.min(...thetas)).toBeLessThan(-2);
    expect(Math.max(...thetas)).toBeGreaterThan(2);
    // ...and it spans the WHOLE circle, not just the two extremes: every
    // quadrant of that basis is populated.
    const quads = new Set(thetas.map((t) => `${Math.sign(Math.cos(t))},${Math.sign(Math.sin(t))}`));
    expect(quads.size).toBeGreaterThanOrEqual(4);
  });

  it('drops a point whose nearest prim rides a different bone', () => {
    const body = twoCapsules();
    // Same geometry, but every reference point is offered under a bone name
    // that neither prim belongs to.
    const pts = sampleBodySurface(body, 200).get('spine1')!;
    const bones = new Map<string, ResolvedBone>([['neck', { head: [0, 0, 0], tail: [0, 1, 0] }]]);
    const bins = binResiduals(new Map([['neck', pts]]), body, bones);
    for (const bin of bins.values()) {
      expect(bin.samples.length).toBe(0);
      expect(bin.crossBone).toBeGreaterThan(0);
    }
  });
});

/** One capsule on a 45-degree bone — the case the old axis rule mishandled. */
function diagonalCapsule(): {
  prims: Primitive[]; clusters: ClusterInfo[]; bones: Map<string, ResolvedBone>;
} {
  const k = Math.SQRT1_2;
  const prims: Primitive[] = [{
    a: [0, 0, 0], b: [k, k, 0], radius: 0.1, scale: [1, 1, 1],
    blendK: 0.01, limb: 'armL', cluster: 0, bone: 'upperarm.l', src: 20,
  }];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'armL', start: 0, count: 1, center: [k / 2, k / 2, 0], radius: 1, alive: true },
  ];
  const bones = new Map<string, ResolvedBone>([['upperarm.l', { head: [0, 0, 0], tail: [k, k, 0] }]]);
  return { prims, clusters, bones };
}

/** The synthetic reference: a point set sampled off a body we declare to be truth. */
const sample = sampleBodySurface;

/** Fit a perturbed body against a reference sampled from the unperturbed one. */
function roundTrip(perturb: (b: ReturnType<typeof twoCapsules>) => void) {
  const truth = twoCapsules();
  const reference = sample(truth, 600);
  const ours = twoCapsules();
  perturb(ours);
  return fitPrims(binResiduals(reference, ours, ours.bones), ours);
}

describe('fitPrims — ground truth round trip', () => {
  it('NEGATIVE CONTROL: suggests nothing when the body already matches', () => {
    for (const one of roundTrip(() => {})) {
      expect(one.r).toBeUndefined();
      expect(one.scales).toBeUndefined();
      expect(one.offset).toBeUndefined();
    }
  });

  it('recovers a known radius error', () => {
    const p0 = roundTrip((b) => { b.prims[0]!.radius = 0.092; }).find((x) => x.prim === 0)!;
    expect(p0.r).toBeDefined();
    expect(p0.r!.from).toBeCloseTo(0.092, 6);
    expect(p0.r!.to).toBeGreaterThan(0.0975);
    expect(p0.r!.to).toBeLessThan(0.1025);
  });

  it('recovers a known anisotropy error on a vertical bone', () => {
    const p0 = roundTrip((b) => { b.prims[0]!.scale = [1, 1, 1.25]; }).find((x) => x.prim === 0)!;
    const deep = p0.scales?.find((s) => s.axis === 'deep');
    expect(deep).toBeDefined();
    expect(deep!.to).toBeGreaterThan(0.94);
    expect(deep!.to).toBeLessThan(1.06);
  });

  it('does NOT suggest a component the data cannot see', () => {
    // `tall` runs along a vertical bone, so every sample has w_1 ~ 0 and its
    // column is rank-deficient. Suggesting it would be reading noise.
    const p0 = roundTrip((b) => { b.prims[0]!.scale = [1, 1, 1.25]; }).find((x) => x.prim === 0)!;
    expect(p0.scales?.some((s) => s.axis === 'tall')).toBeFalsy();
  });

  it('REGRESSION: recovers anisotropy on a DIAGONAL bone', () => {
    // The removed held/solved rule got this wrong: a 45-degree bone's basis is
    // a near-even mix of wide and tall, so attributing cos2t to one axis is
    // about half right. This test is the reason that rule was replaced.
    const truth = diagonalCapsule();
    const reference = sample(truth, 600);
    const ours = diagonalCapsule();
    ours.prims[0]!.scale = [1, 1, 1.3];
    const p0 = fitPrims(binResiduals(reference, ours, ours.bones), ours).find((x) => x.prim === 0)!;
    const deep = p0.scales?.find((s) => s.axis === 'deep');
    expect(deep).toBeDefined();
    expect(deep!.to).toBeGreaterThan(0.92);
    expect(deep!.to).toBeLessThan(1.08);
  });

  /**
   * ADDED, and the reason: the REGRESSION test above does NOT discriminate.
   *
   * The removed rule dropped the world axis most aligned with the bone, HELD
   * the first survivor and SOLVED the second — so for a bone along (k, k, 0) it
   * dropped x, held `tall` and solved `deep`, and its e2 came out exactly world
   * z. The perturbation above is on `deep`. The old rule would therefore have
   * attributed the whole cos-2-theta term to `deep` and got the right answer by
   * luck; that test passes under both rules and proves nothing on its own.
   *
   * Move the SAME error to `wide` and the two rules separate cleanly. The old
   * rule could only ever name one axis — `deep` — so it would have reported a
   * large `deep` change to explain an error `deep` had no part in. The fit
   * puts the change in the wide/tall pair, which for this bone are EXACTLY
   * degenerate (`w_0^2 == w_1^2` in every sample, so the two columns are
   * proportional). Which of the pair it names is arbitrary and is not asserted;
   * that the surface it describes is right, and that `deep` is untouched, are
   * the claims.
   *
   * `deep` IS ASSERTED THROUGH ITS WORLD SEMI-AXIS `A = r * s_deep`, NOT
   * THROUGH `s_deep`. This was `Math.abs(deep.to - 1) < 0.02` and that was the
   * wrong quantity: only the semi-axes are measurable at all (see fitPrims'
   * header on the exact rank deficiency), and `regauge` deliberately moves
   * magnitude between `r` and the scales, so the fit is free to change
   * `s_deep` without changing the surface — which is exactly what it does here,
   * reporting r 0.1 -> 0.0939 with s_deep 1.0569. Reconstructing the removed
   * held/solved rule and running it on these same bins: it drops x, holds
   * `tall`, solves `deep`, and lands deep's semi-axis at 0.086362 — 13.64% off
   * truth, against 0.74% for the fit. The window is unchanged at 2%; it is the
   * quantity that was wrong, and the reformulation still separates the two
   * rules by a factor of 18.
   */
  it('REGRESSION: does not blame the axis the old rule always blamed', () => {
    const truth = diagonalCapsule();
    const reference = sample(truth, 600);
    const ours = diagonalCapsule();
    ours.prims[0]!.scale = [1.3, 1, 1];
    const p0 = fitPrims(binResiduals(reference, ours, ours.bones), ours).find((x) => x.prim === 0)!;
    const deep = p0.scales?.find((s) => s.axis === 'deep');
    const rTo = p0.r?.to ?? ours.prims[0]!.radius;
    expect(Math.abs((rTo * (deep?.to ?? 1)) / 0.1 - 1)).toBeLessThan(0.02);
    expect(p0.scales?.some((s) => s.axis === 'wide' || s.axis === 'tall')).toBe(true);
  });

  it('recovers a known lateral offset', () => {
    const p0 = roundTrip((b) => {
      b.prims[0]!.a = [0.006, 0.0, 0];
      b.prims[0]!.b = [0.006, 0.5, 0];
    }).find((x) => x.prim === 0)!;
    expect(p0.offset).toBeDefined();
    expect(p0.offset!.delta[0]).toBeLessThan(-0.004);
    expect(p0.offset!.delta[0]).toBeGreaterThan(-0.008);
    expect(Math.abs(p0.offset!.delta[2])).toBeLessThan(0.002);
  });

  it('IS PROVEN TO FAIL under a perturbation it should catch', () => {
    // If this ever passes, the fitter has stopped measuring anything.
    const p0 = roundTrip((b) => { b.prims[0]!.radius = 0.060; }).find((x) => x.prim === 0)!;
    expect(p0.r).toBeDefined();
    expect(Math.abs(p0.r!.to - 0.060)).toBeGreaterThan(0.02);
  });

  it('skips primitives it cannot model, and says which', () => {
    const reference = sample(twoCapsules(), 300);
    const ours = twoCapsules();
    ours.prims[1]!.bend = [0, 0, 0.02];
    const p1 = fitPrims(binResiduals(reference, ours, ours.bones), ours).find((x) => x.prim === 1)!;
    expect(p1.skipped).toMatch(/bend/i);
    expect(p1.r).toBeUndefined();
  });
});

/**
 * One capsule of length 1 along a chosen WORLD axis, so the seeding plane can
 * be checked against a bone that does not run along y.
 */
function axisCapsule(
  dir: 0 | 1 | 2,
  scale: [number, number, number] = [1, 1, 1],
): { prims: Primitive[]; clusters: ClusterInfo[] } {
  const b: [number, number, number] = [0, 0, 0];
  b[dir] = 1;
  const center: [number, number, number] = [0, 0, 0];
  center[dir] = 0.5;
  const prims: Primitive[] = [{
    a: [0, 0, 0], b, radius: 0.1, scale,
    blendK: 0.01, limb: 'torso', cluster: 0, bone: 'spine1', src: 42,
  }];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 1, center, radius: 1, alive: true },
  ];
  return { prims, clusters };
}

/**
 * Reach of a sample set along world component `k`, as the 10th largest |value|.
 *
 * NOT the plain maximum, and the difference is the whole test. Seed i = 0 of
 * the golden spiral has theta exactly 0, which for an x-aligned bone puts it
 * exactly ON the medial axis; `gradient`'s central difference cancels there,
 * it takes its `[0, 1, 0]` fallback, and that ONE point walks out to |y| = r
 * all by itself. Measured on the broken sampler: the top ten |y| of 400
 * samples were `0.100000` followed by nine exact zeros. A max-based assertion
 * is satisfied by that single accident and proves nothing about the ring.
 */
function reach(pts: readonly (readonly number[])[], k: number): number {
  return pts.map((p) => Math.abs(p[k]!)).sort((a, b) => b - a)[9] ?? 0;
}

/**
 * REGRESSION: the ring must be seeded in the plane perpendicular to the
 * PRIMITIVE'S OWN AXIS, not the world xz-plane.
 *
 * The original seed was `[cos(theta)*sx, 0, sin(theta)*sz]` — hardcoded to
 * world xz with y pinned to zero. That is only perpendicular for a bone
 * running along world y. For a bone along world z the seed's z component
 * pushes ALONG the bone and its y component is identically zero, so the
 * "ring" collapses to a line segment swept down the axis: every sample came
 * back with |y| = 0.0000 exactly, and `scale [1,1,1]` and `[1,2,1]` produced
 * IDENTICAL output. A `tall=` error on such a bone was not merely mismeasured,
 * it was invisible. The x-aligned bone is the same collapse with one stray
 * point on it — see `reach`.
 *
 * This is not hypothetical: `foot` is authored `dir=fwd` (world z) and
 * `clavicle` is `dir=side` (world x). Both are in scope for the fit, and
 * neither could ever have been validated before this test.
 */
describe('sampleBodySurface ring plane', () => {
  for (const [dir, name] of [[2, 'z'], [0, 'x']] as const) {
    it(`sees a tall= error on a ${name}-aligned bone`, () => {
      const round = sampleBodySurface(axisCapsule(dir, [1, 1, 1]), 400).get('spine1')!;
      const tall = sampleBodySurface(axisCapsule(dir, [1, 2, 1]), 400).get('spine1')!;
      // The isotropic capsule reaches its own radius in y...
      expect(reach(round, 1)).toBeGreaterThan(0.095);
      // ...and doubling `tall` reaches twice as far. Both are 0 before the fix.
      expect(reach(tall, 1) / reach(round, 1)).toBeGreaterThan(1.7);
    });

    it(`spans the full circle around a ${name}-aligned bone`, () => {
      const pts = sampleBodySurface(axisCapsule(dir), 400).get('spine1')!;
      // Both components perpendicular to the bone must reach the radius, and
      // reach it with a real population of points rather than one stray.
      for (const k of [0, 1, 2].filter((c) => c !== dir)) {
        expect(reach(pts, k)).toBeGreaterThan(0.095);
      }
    });
  }
});
