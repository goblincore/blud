// src/sim/geometry.test.ts
import { describe, it, expect } from 'vitest';
import { type SimAABB, clipMoveXZ } from './geometry';
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
