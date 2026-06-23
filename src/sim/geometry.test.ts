// src/sim/geometry.test.ts
import { describe, it, expect } from 'vitest';
import { type SimAABB, clipMoveXZ, losClear, buildArenaGeometry } from './geometry';
import { fpFromMeters } from './fp';

// A single wall AABB occupying x ∈ [5,6] m (full z range for the test).
function wallAt(minXm: number, maxXm: number, minZm: number, maxZm: number): SimAABB {
  return {
    minX: fpFromMeters(minXm), maxX: fpFromMeters(maxXm),
    minZ: fpFromMeters(minZm), maxZ: fpFromMeters(maxZm),
  };
}

describe('clipMoveXZ — axis-separated wall slide (radius-aware)', () => {
  const r = fpFromMeters(0.3); // player radius
  const wall = [wallAt(5, 6, -10, 10)];

  it('passes through open space unchanged', () => {
    const from = { x: fpFromMeters(0), z: fpFromMeters(0) };
    const out = clipMoveXZ(from, fpFromMeters(1), 0, r, wall);
    expect(out.x).toBe(fpFromMeters(1));
    expect(out.z).toBe(0);
  });

  it('stops at a wall when moving into it on X (blocked, with radius gap)', () => {
    const from = { x: fpFromMeters(4), z: fpFromMeters(0) };
    // try to move +2m in X (to x=6), into the wall at x=5; should stop at 5 - r.
    const out = clipMoveXZ(from, fpFromMeters(2), 0, r, wall);
    expect(out.x).toBe(fpFromMeters(5) - r);
    expect(out.z).toBe(0);
  });

  it('slides along the wall: blocked X, free Z', () => {
    const from = { x: fpFromMeters(4), z: fpFromMeters(0) };
    const out = clipMoveXZ(from, fpFromMeters(2), fpFromMeters(3), r, wall);
    expect(out.x).toBe(fpFromMeters(5) - r); // X blocked
    expect(out.z).toBe(fpFromMeters(3));     // Z slides freely
  });

  it('is deterministic / order-independent across multiple AABBs', () => {
    const walls = [wallAt(5, 6, -10, 10), wallAt(-6, -5, -10, 10)];
    const a = clipMoveXZ({ x: 0, z: 0 }, fpFromMeters(10), 0, r, walls);
    const b = clipMoveXZ({ x: 0, z: 0 }, fpFromMeters(10), 0, r, [...walls].reverse());
    expect(a).toEqual(b);
  });
});

describe('losClear — deterministic segment-vs-AABB line-of-sight', () => {
  const geo = buildArenaGeometry();
  const y = fpFromMeters(1.2); // eye height (AABBs are full-height columns → Y ignored)

  it('is clear across open floor', () => {
    // Corridor west of the obstacle cluster: x=-6, z ∈ [-6,-4]. Obstacle 3 sits
    // at x ∈ [-6.5,-5.5] but its z footprint is [2,6], so this segment misses it.
    expect(
      losClear(fpFromMeters(-6), y, fpFromMeters(-6),
               fpFromMeters(-6), y, fpFromMeters(-4), geo),
    ).toBe(true);
  });

  it('is blocked when the segment crosses an obstacle', () => {
    // Straight along z=-3 from x=-8 to x=0 pierces obstacle 1
    // (center (-4,-3), footprint x ∈ [-5,-3], z ∈ [-4,-2]).
    expect(
      losClear(fpFromMeters(-8), y, fpFromMeters(-3),
               fpFromMeters(0),  y, fpFromMeters(-3), geo),
    ).toBe(false);
  });
});
