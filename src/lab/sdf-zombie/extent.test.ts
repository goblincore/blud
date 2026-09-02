// src/lab/sdf-zombie/extent.test.ts
import { describe, it, expect } from 'vitest';
import { boxReach, chunkExtent, tornEndRadius } from './extent';
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
