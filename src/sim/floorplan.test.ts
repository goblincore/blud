// src/sim/floorplan.test.ts
import { describe, it, expect } from 'vitest';
import { CELL_M, GRID_W, GRID_H, cellToWorld, generateFloorplan, type Floorplan } from './floorplan';

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

describe('generateFloorplan — rooms', () => {
  it('is a pure function of the seed (same seed → identical grid + rooms)', () => {
    const a = generateFloorplan(2026);
    const b = generateFloorplan(2026);
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.rooms).toEqual(b.rooms);
  });

  it('always contains exactly one arena room as room 0', () => {
    for (const seed of [1, 2, 7, 42, 2026, 99999]) {
      const fp = generateFloorplan(seed);
      expect(fp.rooms.length).toBeGreaterThanOrEqual(2);
      expect(fp.rooms[0]!.kind).toBe('arena');
      expect(fp.arenaRoomId).toBe(0);
      const arena = fp.rooms[0]!;
      expect(arena.w).toBeGreaterThanOrEqual(9);
      expect(arena.h).toBeGreaterThanOrEqual(9);
    }
  });

  it('keeps a solid 1-cell border (no open cell on the grid edge)', () => {
    const fp = generateFloorplan(2026);
    const open = (cx: number, cz: number) => fp.open[cz * fp.gridW + cx] === 1;
    for (let i = 0; i < fp.gridW; i++) {
      expect(open(i, 0)).toBe(false);
      expect(open(i, fp.gridH - 1)).toBe(false);
      expect(open(0, i)).toBe(false);
      expect(open(fp.gridW - 1, i)).toBe(false);
    }
  });

});

describe('generateFloorplan — connectivity', () => {
  // Flood-fill the open grid from the player start; every room center must be reached.
  function reachableFromStart(fp: ReturnType<typeof generateFloorplan>): Set<number> {
    const seen = new Set<number>();
    const stack = [fp.start.cell.cx * 1 + 0, fp.start.cell.cz]; // placeholder
    const sx = fp.start.cell.cx, sz = fp.start.cell.cz;
    const key = (cx: number, cz: number) => cz * fp.gridW + cx;
    const open = (cx: number, cz: number) =>
      cx >= 0 && cz >= 0 && cx < fp.gridW && cz < fp.gridH && fp.open[key(cx, cz)] === 1;
    const work = [[sx, sz]];
    seen.add(key(sx, sz));
    while (work.length) {
      const [cx, cz] = work.pop()!;
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]] as const) {
        if (open(nx, nz) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); work.push([nx, nz]); }
      }
    }
    void stack;
    return seen;
  }

  it('every room center is reachable from the player start', () => {
    for (const seed of [1, 2, 7, 42, 2026, 99999, 123456]) {
      const fp = generateFloorplan(seed);
      const seen = reachableFromStart(fp);
      for (const r of fp.rooms) {
        const ccx = r.cx + (r.w >> 1), ccz = r.cz + (r.h >> 1);
        expect(seen.has(ccz * fp.gridW + ccx)).toBe(true);
      }
    }
  });
});
