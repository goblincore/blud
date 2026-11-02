// src/lab/sdf-zombie/extent.test.ts
import { describe, it, expect } from 'vitest';
import { boxReach, chunkExtent, tornEndRadius, chunkSupportSpheres, supportSpheresFromPoints } from './extent';
import { qFromAxisAngle, qRotate } from './vec';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { severLimb } from './sever';
import type { Primitive, Vec3 } from './types';

describe('boxReach', () => {
  it('is 1 for a capsule', () => {
    expect(boxReach(undefined)).toBe(1);
  });

  it('is sqrt(3) for a dead-sharp box and 1 for a fully round one', () => {
    expect(boxReach({ round: 0 })).toBeCloseTo(Math.sqrt(3), 9);
    expect(boxReach({ round: 1 })).toBeCloseTo(1, 9);
  });

  it('interpolates linearly between them', () => {
    expect(boxReach({ round: 0.5 })).toBeCloseTo((Math.sqrt(3) + 1) / 2, 9);
  });
});

it('chunkExtent contains a sharp box corner', () => {
  const p: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0,
    limb: 'torso', cluster: 0, box: { round: 0 },
  };
  // The corner is at 0.1*sqrt(3) ~ 0.1732 from the origin.
  expect(chunkExtent([p], [0, 0, 0])).toBeGreaterThanOrEqual(0.1 * Math.sqrt(3) - 1e-9);
});

/** A bare add-capsule with sensible defaults for the fields under test. */
function capsule(a: Vec3, b: Vec3, radius: number, scale: Vec3 = [1, 1, 1]): Primitive {
  return { a, b, radius, scale, blendK: 0.05, limb: 'armL', cluster: 0 };
}

describe('tornEndRadius', () => {
  // An arm-like chain: two thin capsules end to end, 0.6 long, 0.055 thick.
  const arm = [
    capsule([0, 0, 0], [0.3, 0, 0], 0.055),
    capsule([0.3, 0, 0], [0.6, 0, 0], 0.05),
  ];
  const tornAt: Vec3 = [0, 0, 0]; // tore away at the shoulder end

  it('tracks the limb girth at the tear, not the limb length', () => {
    const r = tornEndRadius(arm, tornAt);
    // Wide enough to read as a torn stump across the limb's cross-section,
    // narrow enough that the carve + everted rim cannot swallow the capsule
    // silhouette (X1.16: extent-proportional radii turned limbs into blobs).
    expect(r).toBeGreaterThanOrEqual(0.055);
    expect(r).toBeLessThanOrEqual(0.055 * 2.5);
  });

  it('is invariant to the limb getting longer', () => {
    const longArm = [
      capsule([0, 0, 0], [0.6, 0, 0], 0.055),
      capsule([0.6, 0, 0], [1.2, 0, 0], 0.05),
    ];
    expect(tornEndRadius(longArm, tornAt)).toBeCloseTo(tornEndRadius(arm, tornAt), 10);
  });

  it('reads the girth at the torn end, not the far end', () => {
    // Fat hand, thin shoulder: tearing at the shoulder must use the thin girth.
    const clubArm = [
      capsule([0, 0, 0], [0.3, 0, 0], 0.04),
      capsule([0.3, 0, 0], [0.6, 0, 0], 0.12),
    ];
    expect(tornEndRadius(clubArm, tornAt)).toBeLessThanOrEqual(0.04 * 2.5);
  });

  it('accounts for per-prim ellipsoid scale', () => {
    const squashed = [capsule([0, 0, 0], [0.3, 0, 0], 0.1, [1, 0.5, 1])];
    // Effective girth is radius * min scale = 0.05.
    expect(tornEndRadius(squashed, tornAt)).toBeLessThanOrEqual(0.05 * 2.5);
  });

  it('ignores carve primitives when finding the girth', () => {
    const withCarve = [
      { ...capsule([0.001, 0, 0], [0.2, 0, 0], 0.3), op: 'sub' as const },
      ...arm,
    ];
    expect(tornEndRadius(withCarve, tornAt)).toBeCloseTo(tornEndRadius(arm, tornAt), 10);
  });

  it("stays well below the old extent-based radius on the real zombie's arm", () => {
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const { chunk } = severLimb(body, 'armL');
    const extent = chunkExtent(chunk.prims, chunk.origin);
    const shoulder = chunk.prims[0]!.a;
    const r = tornEndRadius(chunk.prims, shoulder);
    // The old formula (extent * 0.55) produced a wound bigger than the limb's
    // half-size; girth-based must come in far under it.
    expect(r).toBeLessThan(extent * 0.55 * 0.7);
    expect(r).toBeGreaterThan(0.02); // and still a visible stump, not a pinprick
  });
});

describe('chunkSupportSpheres (orientation-aware floor support)', () => {
  it('turns a capsule into two end spheres of its own girth', () => {
    const s = chunkSupportSpheres([capsule([-0.5, 0, 0], [0.5, 0, 0], 0.06)], [0, 0, 0]);
    expect(s).toHaveLength(2);
    expect(s[0]!.c).toEqual([-0.5, 0, 0]);
    expect(s[1]!.c).toEqual([0.5, 0, 0]);
    for (const q of s) expect(q.r).toBeCloseTo(0.06, 9);
    // The support reaches the thickness (0.06), NOT the half-length (0.5):
    // this is the whole point — a flat shin must not hover at half its length.
    expect(Math.max(...s.map(q => q.r))).toBeLessThan(0.1);
  });

  it('returns LOCAL centres (relative to origin)', () => {
    const s = chunkSupportSpheres([capsule([0, 0, 0], [1, 0, 0], 0.05)], [0.5, 0, 0]);
    expect(s[0]!.c).toEqual([-0.5, 0, 0]);
    expect(s[1]!.c).toEqual([0.5, 0, 0]);
  });

  it('skips carve (sub) primitives', () => {
    const prims = [
      { ...capsule([0, 0, 0], [0.2, 0, 0], 0.3), op: 'sub' as const },
      capsule([0, 0, 0], [0.4, 0, 0], 0.05),
    ];
    const s = chunkSupportSpheres(prims, [0, 0, 0]);
    expect(s).toHaveLength(2);
    for (const q of s) expect(q.r).toBeCloseTo(0.05, 9);
  });

  it('is empty for an empty prim list', () => {
    expect(chunkSupportSpheres([], [0, 0, 0])).toEqual([]);
  });

  it('falls back to one conservative extent sphere past the point budget', () => {
    const prims = Array.from({ length: 20 }, () => capsule([0, 0, 0], [0.1, 0, 0], 0.05));
    const s = chunkSupportSpheres(prims, [0, 0, 0], 8);
    expect(s).toHaveLength(1);
    expect(s[0]!.c).toEqual([0, 0, 0]);
    expect(s[0]!.r).toBeCloseTo(chunkExtent(prims, [0, 0, 0]), 9);
  });
});

describe('supportSpheresFromPoints', () => {
  // An off-centre elongated cloud: a 0.6 x 0.12 x 0.2 m box of points whose centre sits 0.9 m below the origin
  // (the torso bone asset piece: its mesh is far from what the prims claimed).
  const pts: number[] = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++)
    pts.push(-0.3 + i * 0.1, -0.96 + j * 0.06, -0.1 + k * 0.1);
  const lowest = (q: [number, number, number, number], cs: Vec3[]) => Math.min(...cs.map(c => qRotate(q, c)[1]));
  const all: Vec3[] = [];
  for (let i = 0; i < pts.length; i += 3) all.push([pts[i]!, pts[i + 1]!, pts[i + 2]!]);

  it('is empty for no points and zero-radius spheres on drawn vertices otherwise', () => {
    expect(supportSpheresFromPoints([])).toEqual([]);
    const s = supportSpheresFromPoints(pts);
    expect(s.length).toBeGreaterThan(6);
    expect(s.length).toBeLessThanOrEqual(70);
    for (const sp of s) {
      expect(sp.r).toBe(0);
      expect(all.some(v => v[0] === sp.c[0] && v[1] === sp.c[1] && v[2] === sp.c[2])).toBe(true);
    }
  });

  it('finds the lowest drawn vertex exactly at rest and within 1 cm under any orientation', () => {
    const s = supportSpheresFromPoints(pts).map(sp => sp.c);
    expect(lowest([0, 0, 0, 1], s)).toBeCloseTo(-0.96, 9);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const ax: Vec3 = [Math.sin(k * 1.7), Math.cos(k * 2.3), Math.sin(k * 0.7 + 1)];
      const h = Math.hypot(...ax);
      const q = qFromAxisAngle([ax[0] / h, ax[1] / h, ax[2] / h], k * 0.37);
      worst = Math.max(worst, lowest(q, s) - lowest(q, all));
    }
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThan(0.01);
  });
});
