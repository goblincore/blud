// src/lab/sdf-zombie/webgpu/crowd-spawn.test.ts
//
// Pins for the crowd bench's spawn grid (perf task 7f). Pure-CPU: no GPU, no
// page. The grid must spread copies so the bench measures bodies-in-a-room
// rather than N stacked on the room's single spawn point.
import { describe, it, expect } from 'vitest';
import { crowdGridPoints, FLOOR_INSET_M, REGION_INSET_M, type FloorRect } from './crowd-spawn';

// Room 1's interior ground rect (game-level.ts: -OUTER .. -BAND_HALF) and its
// single spawn point. The bench's canonical crowded room.
const ROOM1: FloorRect = { minX: -8.8, maxX: -0.8, minZ: -8.8, maxZ: -0.8 };
const P0 = [-4.8, 0, -4.8] as const;

describe('crowdGridPoints', () => {
  it('returns p0 verbatim for n = 1', () => {
    expect(crowdGridPoints(P0, 1, 1.2, ROOM1)).toEqual([[P0[0], P0[1], P0[2]]]);
  });

  it('returns [] for n <= 0', () => {
    expect(crowdGridPoints(P0, 0, 1.2, ROOM1)).toEqual([]);
    expect(crowdGridPoints(P0, -3, 1.2, ROOM1)).toEqual([]);
  });

  it('spreads 8 copies on a grid, all inside the floor, none coincident', () => {
    const pts = crowdGridPoints(P0, 8, 1.2, ROOM1);
    expect(pts).toHaveLength(8);
    for (const [x, y, z] of pts) {
      expect(x).toBeGreaterThanOrEqual(ROOM1.minX + FLOOR_INSET_M - 1e-9);
      expect(x).toBeLessThanOrEqual(ROOM1.maxX - FLOOR_INSET_M + 1e-9);
      expect(z).toBeGreaterThanOrEqual(ROOM1.minZ + FLOOR_INSET_M - 1e-9);
      expect(z).toBeLessThanOrEqual(ROOM1.maxZ - FLOOR_INSET_M + 1e-9);
      expect(y).toBe(P0[1]);
    }
    // No two copies closer than `spacing` in the ground plane.
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i]![0] - pts[j]![0];
        const dz = pts[i]![2] - pts[j]![2];
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1.2 - 1e-6);
      }
    }
  });

  it('keeps a full square grid centred on p0 and counts 3 columns for n = 8', () => {
    // A perfect square (n = 9, 3x3) is exactly centred on p0.
    const square = crowdGridPoints(P0, 9, 1.2, ROOM1);
    const cx = square.reduce((s, p) => s + p[0], 0) / square.length;
    const cz = square.reduce((s, p) => s + p[2], 0) / square.length;
    expect(cx).toBeCloseTo(P0[0], 6);
    expect(cz).toBeCloseTo(P0[2], 6);
    // cols = ceil(sqrt(8)) = 3 -> the first row is 3 distinct x values.
    const pts = crowdGridPoints(P0, 8, 1.2, ROOM1);
    expect(new Set(pts.slice(0, 3).map((p) => p[0])).size).toBe(3);
  });

  it('fits 24 copies at 0.9 m in a 3.5 x 7 m region, none closer than spacing', () => {
    // The distance-crowd scene's far-half strip (perf task, 2026-09-14): the
    // region is caller-authored and already inset from the room walls, so the
    // grid centres on it and chooses columns to fit its 3.5 m span. Four
    // columns x six rows at 0.9 m spans 2.7 x 4.5 m — it fits the region at
    // the raw bounds, where the 0.5 m standoff alone could not (2.5 m usable
    // < 2.7 m). Nobody may be closer than the requested spacing either way.
    const region: FloorRect = { minX: -1.75, maxX: 1.75, minZ: -3.5, maxZ: 3.5 };
    const pts = crowdGridPoints([0, 0, 0], 24, 0.9, region, { centre: [0, 0], inset: REGION_INSET_M });
    expect(pts).toHaveLength(24);
    for (const [x, y, z] of pts) {
      expect(x).toBeGreaterThanOrEqual(region.minX - 1e-9);
      expect(x).toBeLessThanOrEqual(region.maxX + 1e-9);
      expect(z).toBeGreaterThanOrEqual(region.minZ - 1e-9);
      expect(z).toBeLessThanOrEqual(region.maxZ + 1e-9);
      expect(y).toBe(0);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i]![0] - pts[j]![0];
        const dz = pts[i]![2] - pts[j]![2];
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(0.9 - 1e-6);
      }
    }
  });

  it('centres a region grid on the region centre and keeps a 1-body control unclamped', () => {
    const region: FloorRect = { minX: 2, maxX: 9, minZ: 10, maxZ: 17 };
    const one = crowdGridPoints([5, 0, 13], 1, 0.9, region, { centre: [5.5, 13.5], inset: REGION_INSET_M });
    expect(one).toEqual([[5.5, 0, 13.5]]);
    const pts = crowdGridPoints([5, 0, 13], 9, 0.9, region, { centre: [5.5, 13.5], inset: REGION_INSET_M });
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    expect(cx).toBeCloseTo(5.5, 6);
    expect(cz).toBeCloseTo(13.5, 6);
  });

  it('clamps grid points inside a narrow floor', () => {
    const narrow: FloorRect = { minX: -2, maxX: 0, minZ: -2, maxZ: 0 };
    const pts = crowdGridPoints([-1, 0, -1], 4, 1.2, narrow);
    for (const [x, , z] of pts) {
      expect(x).toBeGreaterThanOrEqual(narrow.minX + FLOOR_INSET_M - 1e-9);
      expect(x).toBeLessThanOrEqual(narrow.maxX - FLOOR_INSET_M + 1e-9);
      expect(z).toBeGreaterThanOrEqual(narrow.minZ + FLOOR_INSET_M - 1e-9);
      expect(z).toBeLessThanOrEqual(narrow.maxZ - FLOOR_INSET_M + 1e-9);
    }
  });
});
