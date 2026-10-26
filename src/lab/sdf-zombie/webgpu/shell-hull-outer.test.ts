import { describe, it, expect } from 'vitest';
import { buildOuterHullInstances, SPHERE_CHAIN_INFLATE, taperedChain } from './shell-hull-outer';
import zombieSrc from '../characters/zombie.blob?raw';
import cultistSrc from '../characters/cultist.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { clothVariantSrc } from './bench-cloth';
import { PROXY_VERTS, proxyIndices, writeProxyCone, type ProxyCone } from './cloth-proxy';
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

  it('reaches a sharp box corner, not just the capsule radius', () => {
    // radius 0.06, round 0 (dead-sharp): corner reach = sqrt(3)*0.06, vs a
    // capsule's plain 0.06. blendK zeroed out so blendReach contributes
    // nothing and the difference is attributable to the box term alone.
    // Emitted sphere radius = reach * SPHERE_CHAIN_INFLATE.
    const b = built([prim({ blendK: 0, box: { round: 0 } })]);
    const hull = buildOuterHullInstances([b]);
    const expectedReach = 0.06 * Math.sqrt(3);
    expect(hull.length).toBeGreaterThan(0);
    for (const s of hull)
      expect(s.radius).toBeGreaterThanOrEqual(expectedReach * SPHERE_CHAIN_INFLATE - 1e-9);
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

/** Fires rays inward from a sphere round `b` and returns the worst escape of a first surface hit from the hull. */
function worstEscape(b: BuiltBody, hull: { centre: Vec3; radius: number }[], centre: Vec3, R = 2.0, rays = 900,
  outside: (p: Vec3) => number = (p) => sdHull(p, hull)) {
  let worst = -Infinity, found = 0;
  for (let i = 0; i < rays; i++) {
    const y = 1 - (i / (rays - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (3 - Math.sqrt(5)) * i;
    const dir: Vec3 = [Math.cos(th) * r, y, Math.sin(th) * r];
    const from: Vec3 = [centre[0] + dir[0] * R, centre[1] + dir[1] * R, centre[2] + dir[2] * R];
    let t = 0;
    for (let s = 0; s < 300 && t < 2 * R; s++) {
      const q: Vec3 = [from[0] - dir[0] * t, from[1] - dir[1] * t, from[2] - dir[2] * t];
      const d = sdBody(q, b);
      if (d < 1e-4) { found++; worst = Math.max(worst, outside(q)); break; }
      t += Math.max(d, 1e-4);
    }
  }
  return { worst, found };
}

describe('the TAPER-AWARE chain (SDF-cloth cost spike)', () => {
  it('contains a strongly tapered cone, sampled on its whole surface', () => {
    // A skirt-like round cone: 0.05 at the top, 0.30 at the hem, 0.8 long.
    const b = built([prim({ b: [0, -0.8, 0], radius: 0.05, radiusB: 0.30, blendK: 0.01 })]);
    const hull = buildOuterHullInstances([b]);
    const { worst, found } = worstEscape(b, hull, [0, -0.4, 0], 1.5, 1500);
    expect(found).toBeGreaterThan(1000);
    expect(worst, `the cone escaped its hull by ${worst} m`).toBeLessThan(0);
  });

  it('holds the cone in well under the room the max-radius chain took (54%)', () => {
    const chain = taperedChain([0, 0, 0], [0, -0.8, 0], 0.05, 0.30, 0.01)!;
    const R = 0.31 * SPHERE_CHAIN_INFLATE, n = Math.ceil(0.8 / 0.31);
    const old = Array.from({ length: n + 1 }, (_, i) => ({ centre: [0, -0.8 * i / n, 0] as Vec3, radius: R }));
    // The union's volume on a 2 cm grid (sums of sphere volumes would count the overlaps).
    const union = (h: { centre: Vec3; radius: number }[]) => {
      let c = 0;
      for (let x = -0.45; x <= 0.45; x += 0.02) for (let y = -1.25; y <= 0.45; y += 0.02) for (let z = -0.45; z <= 0.45; z += 0.02)
        if (sdHull([x, y, z], h) < 0) c++;
      return c;
    };
    expect(union(chain)).toBeLessThan(0.6 * union(old));
  });

  it('falls back (null) when the thin end would need too many spheres', () => {
    expect(taperedChain([0, 0, 0], [0, 1, 0], 0.001, 0.2, 0)).toBeNull();
  });

  // The cloth variants are the content this was written for: a skirt and capelet on the hem pendulum, and five
  // shell tubes. Each must stay inside its hull everywhere a ray can find it.
  it.each(['robe', 'trousers'] as const)('contains the zombie in %s', (v) => {
    const doc = parseBlob(clothVariantSrc(zombieSrc, v));
    const b = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
    const hull = buildOuterHullInstances([b]);
    const { worst, found } = worstEscape(b, hull, [0, 0.9, 0]);
    expect(found).toBeGreaterThan(200);
    expect(worst, `the ${v} zombie escaped its hull by ${worst} m`).toBeLessThan(0);
  });
});

/** Signed distance-ish to a convex proxy mesh: the largest face-plane value (negative inside). */
function proxyOutside(c: ProxyCone): (p: Vec3) => number {
  const pos = new Float32Array(PROXY_VERTS * 3);
  writeProxyCone(c, pos, 0);
  const idx = proxyIndices();
  const pl: number[][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map(i => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]);
    const e1 = v[1]!.map((x, i) => x - v[0]![i]!), e2 = v[2]!.map((x, i) => x - v[0]![i]!);
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l < 1e-9) continue;
    pl.push([n[0]! / l, n[1]! / l, n[2]! / l, (n[0]! * v[0]![0]! + n[1]! * v[0]![1]! + n[2]! * v[0]![2]!) / l]);
  }
  return (p) => Math.max(...pl.map(q => q[0]! * p[0] + q[1]! * p[1] + q[2]! * p[2] - q[3]!));
}

describe('CLOTH PROXIES in the outer hull (cloth-proxy.ts)', () => {
  it.each(['robe', 'trousers', 'cultist'] as const)('the %s body stays inside spheres + proxies', (v) => {
    const doc = parseBlob(v === 'cultist' ? cultistSrc : clothVariantSrc(zombieSrc, v));
    const b = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
    const proxies: ProxyCone[] = [];
    const hull = buildOuterHullInstances([b], { shellProxies: proxies });
    expect(proxies.length).toBe({ robe: 2, trousers: 5, cultist: 5 }[v]);
    const inside = proxies.map(proxyOutside);
    const { worst, found } = worstEscape(b, hull, [0, 0.9, 0], 2.0, 1500,
      (p) => Math.min(sdHull(p, hull), ...inside.map(f => f(p))));
    expect(found).toBeGreaterThan(300);
    expect(worst, `the ${v} zombie escaped spheres + proxies by ${worst} m`).toBeLessThan(0);
  });

  it('takes the shells OUT of the sphere chain', () => {
    const doc = parseBlob(clothVariantSrc(zombieSrc, 'robe'));
    const b = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
    const withSpheres = buildOuterHullInstances([b]).length;
    const withProxies = buildOuterHullInstances([b], { shellProxies: [] }).length;
    expect(withProxies).toBeLessThan(withSpheres);
  });
});
