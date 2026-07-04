// src/sim/arenagen/grade.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { createRng } from '../rng';
import { placeCenterCover, placeMidClusters, assignMidHeights } from './cover';
import { gradePlan, gridLosClear, sightBlockers } from './grade';

const openInterior = () => {
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[z * GRID_W + x] = 1;
  return open;
};

describe('gridLosClear', () => {
  it('sees across an empty grid but not through a blocking cell', () => {
    const block = new Uint8Array(GRID_W * GRID_H);
    expect(gridLosClear(block, { cx: 2, cz: 14 }, { cx: 25, cz: 14 })).toBe(true);
    block[14 * GRID_W + 13] = 1;
    expect(gridLosClear(block, { cx: 2, cz: 14 }, { cx: 25, cz: 14 })).toBe(false);
  });
});

describe('sightBlockers', () => {
  it('excludes low cover from the blocking grid, includes mid cover and walls', () => {
    const open = openInterior();
    open[14 * GRID_W + 10] = 0; // will be low cover
    open[14 * GRID_W + 16] = 0; // will be mid cover
    const block = sightBlockers(open, [
      { cx: 10, cz: 14, w: 1, h: 1, height: 'low', clusterId: 0 },
      { cx: 16, cz: 14, w: 1, h: 1, height: 'mid', clusterId: 1 },
    ]);
    expect(block[14 * GRID_W + 10]).toBe(0); // low: see over it
    expect(block[14 * GRID_W + 16]).toBe(1); // mid: blocks
    expect(block[0]).toBe(1);                // border wall blocks
  });
});

describe('gradePlan', () => {
  it('passes a well-formed generated layout (seed sweep, most seeds)', () => {
    let passes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const open = openInterior();
      const rng = createRng(seed);
      const center = placeCenterCover(rng, open);
      const { pieces, pockets } = placeMidClusters(rng, open);
      assignMidHeights(rng, pieces);
      const report = gradePlan(open, [...center, ...pieces], pockets);
      expect(report.laneConnected).toBe(true); // cover never touches the lane
      expect(report.centerClean).toBe(true);
      if (report.pass) passes++;
    }
    expect(passes).toBeGreaterThanOrEqual(10); // grading is a filter, not a wall
  });

  it('fails an empty layout (no pockets, no cover ratio)', () => {
    const report = gradePlan(openInterior(), [], []);
    expect(report.pass).toBe(false);
    expect(report.pocketCount).toBe(0);
    expect(report.lowMidRatioOk).toBe(false);
  });
});
