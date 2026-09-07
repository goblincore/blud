// src/lab/sdf-zombie/webgpu/task6-grid.test.ts
//
// CPU-ONLY regression for the task-6 driver's NDC lattice builder
// (scripts/lib/task6-grid.mjs). The inline version shipped
// `for (let dx = -6; dx <= 6; dx--)` — an update that moved AWAY from its
// own bound, so the loop never terminated and hung a 90-minute GPU gate in
// P2 before a single tube check could land. These fixtures pin:
//
// - TERMINATION: every build completes (implicit — but the unfiltered
//   census proves the full grid was walked exactly once).
// - SHAPE: the game lattice is 20 rows (dy 5..-14) x 13 columns
//   (dx -6..6) = 20 * 13 = 260 unfiltered samples.
// - BOUNDS: no emitted point may leave |ndc| <= bounds.
// - EXCLUSION: the FPV-gun exclusion disc removes exactly its disc.
// - HARD MAXIMUM: an over-constrained max throws rather than emitting an
//   unbounded sample set.
// - ORDER: rows top-to-bottom, columns left-to-right (the original intent),
//   so lattice.points[i] stays aligned with sampleSurfacePoints' output.
import { describe, it, expect } from 'vitest';
import { buildNdcLattice } from '../../../../scripts/lib/task6-grid.mjs';

const GAME_LATTICE = {
  cx: 0.1, cy: -0.05,
  dxRange: [-6, 6] as [number, number],
  dyRange: [-14, 5] as [number, number],
  step: 0.05,
};

describe('buildNdcLattice — the game tube-scan grid', () => {
  it('emits exactly 20*13 = 260 unfiltered samples and terminates', () => {
    const l = buildNdcLattice({ ...GAME_LATTICE, bounds: 10 }); // no filtering
    expect(l.unfiltered).toBe(20 * 13);
    expect(l.unfiltered).toBe(260);
    expect(l.points.length).toBe(260);
    expect(l.outOfBounds).toBe(0);
    expect(l.excluded).toBe(0);
  });
  it('walks rows top-to-bottom (dy 5 -> -14) and columns left-to-right (dx -6 -> 6)', () => {
    const l = buildNdcLattice({ cx: 0, cy: 0, dxRange: [-6, 6], dyRange: [-14, 5], step: 0.05, bounds: 10 });
    expect(l.points[0]).toEqual({ x: -0.3, y: 0.25 }); // dx=-6, dy=+5
    expect(l.points[1]).toEqual({ x: -0.25, y: 0.25 }); // dx advances within a row
    expect(l.points[13]).toEqual({ x: -0.3, y: 0.2 }); // next row, dy 5-1
    const last = l.points[l.points.length - 1]!;
    expect(last).toEqual({ x: 0.3, y: -0.7 }); // dx=+6, dy=-14
  });
  it('applies the |ndc| <= 0.95 bounds with a census of skips', () => {
    const l = buildNdcLattice({ ...GAME_LATTICE });
    expect(l.unfiltered).toBe(260);
    for (const p of l.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.95);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.95);
    }
    expect(l.points.length + l.outOfBounds + l.excluded).toBe(260);
  });
  it('the exclusion disc removes exactly the gun-neighbourhood points', () => {
    const exclude = { x: 0.1, y: -0.05, radius: 0.2 };
    const l = buildNdcLattice({ ...GAME_LATTICE, exclude });
    let inDisc = 0;
    const census = buildNdcLattice({ ...GAME_LATTICE, bounds: 10 });
    for (const p of census.points) {
      if (Math.hypot(p.x - exclude.x, p.y - exclude.y) < exclude.radius) inDisc++;
    }
    expect(l.excluded).toBe(inDisc);
    for (const p of l.points) {
      expect(Math.hypot(p.x - exclude.x, p.y - exclude.y)).toBeGreaterThanOrEqual(exclude.radius);
    }
  });
  it('enforces the hard maximum: throws instead of emitting past it', () => {
    expect(() => buildNdcLattice({ ...GAME_LATTICE, bounds: 10, max: 10 }))
      .toThrow(RangeError);
    // The thrown set never exceeded the cap — verify via a max that fits.
    const l = buildNdcLattice({ ...GAME_LATTICE, bounds: 10, max: 260 });
    expect(l.points.length).toBe(260);
    expect(() => buildNdcLattice({ ...GAME_LATTICE, bounds: 10, max: 259 }))
      .toThrow(/hard maximum/);
  });
  it('rejects degenerate inputs', () => {
    expect(() => buildNdcLattice({ ...GAME_LATTICE, step: 0 })).toThrow(RangeError);
    expect(() => buildNdcLattice({ ...GAME_LATTICE, step: -0.05 })).toThrow(RangeError);
    expect(() => buildNdcLattice({ ...GAME_LATTICE, max: 0 })).toThrow(RangeError);
  });
  it('quantises coordinates to 4 decimals (stable JSON round-trips)', () => {
    const l = buildNdcLattice({ cx: 1 / 3, cy: 2 / 7, dxRange: [-1, 1], dyRange: [-1, 1], step: 0.05, bounds: 10 });
    for (const p of l.points) {
      expect(p.x).toBe(Math.round(p.x * 10000) / 10000);
      expect(p.y).toBe(Math.round(p.y * 10000) / 10000);
    }
  });
});
