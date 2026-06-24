// src/sim/floorplan.test.ts
import { describe, it, expect } from 'vitest';
import { CELL_M, GRID_W, GRID_H, cellToWorld, type Floorplan } from './floorplan';

function emptyFloorplan(): Floorplan {
  return {
    seed: 0, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open: new Uint8Array(GRID_W * GRID_H), rooms: [], spawns: [],
    start: { cell: { cx: 0, cz: 0 }, angBlood: 0 }, arenaRoomId: 0,
  };
}

describe('cellToWorld', () => {
  it('centers the grid on the world origin', () => {
    const fp = emptyFloorplan();
    // The center-most cell boundary should straddle x=0. Cell (gridW/2) starts at x=0.
    const a = cellToWorld(fp, GRID_W / 2, GRID_H / 2);
    expect(a.x).toBeCloseTo(CELL_M / 2);
    expect(a.z).toBeCloseTo(CELL_M / 2);
  });

  it('maps cell 0 to the negative corner', () => {
    const fp = emptyFloorplan();
    const c = cellToWorld(fp, 0, 0);
    expect(c.x).toBeCloseTo(-(GRID_W * CELL_M) / 2 + CELL_M / 2);
  });
});
