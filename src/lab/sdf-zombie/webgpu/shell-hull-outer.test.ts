import { describe, it, expect } from 'vitest';
import { buildOuterHullInstances, SPHERE_CHAIN_INFLATE } from './shell-hull-outer';
import { sdBody } from '../validate';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { ZOMBIE } from '../body';
import type { BuiltBody, ClusterInfo, Primitive, Vec3 } from '../types';

/** Distance from `p` to the nearest point of the hull's union of spheres.
 *  Negative inside. */
function sdHull(p: Vec3, hull: { centre: Vec3; radius: number }[]): number {
  let best = Infinity;
  for (const s of hull) {
    const d = Math.hypot(p[0] - s.centre[0], p[1] - s.centre[1], p[2] - s.centre[2]) - s.radius;
    if (d < best) best = d;
  }
  return best;
}

function prim(over: Partial<Primitive> = {}): Primitive {
  return {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.06, scale: [1, 1, 1],
    blendK: 0.05, cluster: 0, limb: 'torso', op: 'add', ...over,
  } as unknown as Primitive;
}

/** A BuiltBody straight from primitives — no bones, no buildBody. The hull
 *  builder reads prims + clusters and nothing else. */
function built(prims: Primitive[]): BuiltBody {
  const cluster: ClusterInfo = {
    id: 0, limb: 'torso', start: 0, count: prims.length,
    center: [0, 0.2, 0], radius: 1, alive: true,
  } as unknown as ClusterInfo;
  return { prims, clusters: [cluster], bones: new Map() } as unknown as BuiltBody;
}

/** Bisect outward from `from` along `dir` to the real surface; null if the
 *  probe never crosses it. */
function surfaceAlong(b: BuiltBody, from: Vec3, dir: Vec3, hi = 0.6): Vec3 | null {
  let lo = 0;
  if (sdBody(from, b) >= 0) return null;
  let far = hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + far) / 2;
    const q: Vec3 = [from[0] + dir[0] * mid, from[1] + dir[1] * mid, from[2] + dir[2] * mid];
    if (sdBody(q, b) < 0) lo = mid; else far = mid;
  }
  if (lo <= 1e-6 || lo >= hi - 1e-6) return null;
  return [from[0] + dir[0] * lo, from[1] + dir[1] * lo, from[2] + dir[2] * lo];
}

const RADIAL: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

describe('buildOuterHullInstances', () => {
  it('CONTAINS the surface of a straight capsule — the middle, not just the ends', () => {
    // The occluder emits two END spheres per prim. Correct for an INNER hull,
    // wrong here: two end spheres do not cover a capsule's waist. This is the
    // test that pins the difference.
    const b = built([prim()]);
    const hull = buildOuterHullInstances([b]);
    let worst = -Infinity;
    let probes = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const axis: Vec3 = [0, 0.4 * t, 0];
      for (const dir of RADIAL) {
        const surf = surfaceAlong(b, axis, dir);
        if (!surf) continue;
        probes++;
        worst = Math.max(worst, sdHull(surf, hull));
      }
    }
    expect(probes).toBeGreaterThan(100);
    expect(worst, `a surface point escaped the hull by ${worst} m`).toBeLessThan(0);
  });

  it('contains the surface of a BENT primitive, where the chord alone would miss', () => {
    const b = built([prim({ bend: [0.12, 0, 0] })]);
    const hull = buildOuterHullInstances([b]);
    let worst = -Infinity;
    let probes = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const axis: Vec3 = [0, 0.4 * t, 0];
      for (const dir of RADIAL) {
        const surf = surfaceAlong(b, axis, dir);
        if (!surf) continue;
        probes++;
        worst = Math.max(worst, sdHull(surf, hull));
      }
    }
    expect(probes).toBeGreaterThan(20);
    expect(worst, `a bent surface point escaped the hull by ${worst} m`).toBeLessThan(0);
  });

  it('covers the smin bulge between two blended primitives', () => {
    // smin(a,b,k) = min(a,b) - h*h*k*0.25, so the blended surface can sit up
    // to k/4 OUTSIDE the union of the raw primitives. The hull must budget for
    // that or the bulge at every joint pokes through.
    const k = 0.12;
    const b = built([
      prim({ blendK: k, a: [0, 0, 0], b: [0, 0.3, 0] }),
      prim({ blendK: k, a: [0, 0.3, 0], b: [0.3, 0.3, 0] }),
    ]);
    const hull = buildOuterHullInstances([b]);
    // Probe outward through the elbow along the bisector, where the bulge is.
    const surf = surfaceAlong(b, [0, 0.3, 0], [-0.7071, -0.7071, 0]);
    expect(surf).not.toBeNull();
    expect(sdHull(surf!, hull)).toBeLessThan(0);
  });

  it('skips subtractive, groove and dead primitives', () => {
    const flesh = buildOuterHullInstances([built([prim()])]).length;
    expect(buildOuterHullInstances([built([prim(), prim({ op: 'sub' })])]).length).toBe(flesh);
    expect(buildOuterHullInstances([built([prim(), prim({ op: 'groove' })])]).length).toBe(flesh);
    expect(buildOuterHullInstances([built([prim(), prim({ dead: true })])]).length).toBe(flesh);
  });

  it('grows with shellAmp, because silhouette noise pushes the surface OUT', () => {
    const b = built([prim()]);
    const plain = buildOuterHullInstances([b], { shellAmp: 0 });
    const noisy = buildOuterHullInstances([b], { shellAmp: 0.03 });
    expect(Math.max(...noisy.map(s => s.radius)))
      .toBeGreaterThan(Math.max(...plain.map(s => s.radius)));
  });

  it('uses MAX scale, not min — the sphere must CONTAIN the ellipsoid', () => {
    // occluder-hull uses min(scale) for the opposite reason. Copying it here
    // would leave the fat axis poking out of the hull.
    const wide = buildOuterHullInstances([built([prim({ scale: [2, 1, 1] })])]);
    const unit = buildOuterHullInstances([built([prim()])]);
    expect(Math.max(...wide.map(s => s.radius)))
      .toBeGreaterThan(Math.max(...unit.map(s => s.radius)) * 1.5);
  });

  it('spaces the chain closely enough that the inflation factor is sufficient', () => {
    // Spheres of radius R*INFLATE centred every <= R along the axis must cover
    // the capsule: the worst point sits at radius R midway between centres, at
    // sqrt(R^2 + (d/2)^2). With d = R that is R*sqrt(1.25).
    expect(SPHERE_CHAIN_INFLATE).toBeGreaterThanOrEqual(Math.sqrt(1.25));
  });

  it('emits nothing for a body with no live clusters', () => {
    const b = built([prim()]);
    for (const c of b.clusters) c.alive = false;
    expect(buildOuterHullInstances([b])).toEqual([]);
  });
});

describe('containment on the SHIPPED zombie', () => {
  // The analytic bound covers ONE fold. The zombie folds ~15 primitives in a
  // fixed cluster order, so this is the test that guards the chain case on
  // real content — and on real bend, taper, shell and scale values rather
  // than the synthetic ones above.
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const hull = buildOuterHullInstances([built]);

  it('emits a workable number of spheres', () => {
    expect(hull.length).toBeGreaterThan(20);
    // Ten bodies must fit the 4096-instance buffer with room to spare.
    expect(hull.length).toBeLessThan(300);
  });

  it('contains the surface everywhere a ray can find it', () => {
    // Fire rays inward from a sphere around the body and take the first
    // surface crossing; that is exactly the set of points the march can hit,
    // which is exactly the set the hull must contain.
    let worst = -Infinity;
    let worstAt: Vec3 | null = null;
    let found = 0;
    const R = 2.0;
    const centre: Vec3 = [0, 0.9, 0];
    for (let i = 0; i < 900; i++) {
      // Deterministic Fibonacci sphere — no RNG, so a failure reproduces.
      const y = 1 - (i / 899) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = Math.PI * (3 - Math.sqrt(5)) * i;
      const dir: Vec3 = [Math.cos(th) * r, y, Math.sin(th) * r];
      const from: Vec3 = [centre[0] + dir[0] * R, centre[1] + dir[1] * R, centre[2] + dir[2] * R];
      const inward: Vec3 = [-dir[0], -dir[1], -dir[2]];
      // Sphere-trace inward to the first crossing.
      let t = 0;
      let hitT = -1;
      for (let s = 0; s < 200 && t < 2 * R; s++) {
        const q: Vec3 = [from[0] + inward[0] * t, from[1] + inward[1] * t, from[2] + inward[2] * t];
        const d = sdBody(q, built);
        if (d < 1e-4) { hitT = t; break; }
        t += Math.max(d, 1e-4);
      }
      if (hitT < 0) continue;
      found++;
      const surf: Vec3 = [
        from[0] + inward[0] * hitT, from[1] + inward[1] * hitT, from[2] + inward[2] * hitT,
      ];
      const esc = sdHull(surf, hull);
      if (esc > worst) { worst = esc; worstAt = surf; }
    }
    expect(found, 'no rays found the zombie at all').toBeGreaterThan(200);
    expect(worst, `surface escaped the hull by ${worst} m at ${JSON.stringify(worstAt)}`)
      .toBeLessThan(0);
  });
});
