import { describe, it, expect, vi } from 'vitest';
import { binResiduals, projectToSurface, sampleBodySurface } from './ring-fit';
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
