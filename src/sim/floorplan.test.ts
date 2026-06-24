// src/sim/floorplan.test.ts
import { describe, it, expect } from 'vitest';
import {
  CELL_M, GRID_W, GRID_H, cellToWorld, generateFloorplan,
  bakeWallRectsMeters, bakeSimGeometry, floorplanFingerprint, type Floorplan,
} from './floorplan';
import { losClear } from './geometry';
import { fpFromMeters } from './fp';

const SEEDS = [1, 2, 7, 42, 2026, 99999, 123456];
const isOpen = (fp: Floorplan, cx: number, cz: number) =>
  cx >= 0 && cz >= 0 && cx < fp.gridW && cz < fp.gridH && fp.open[cz * fp.gridW + cx] === 1;

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

describe('generateFloorplan — arena', () => {
  it('is a pure function of the seed (same seed → identical grid + rooms)', () => {
    const a = generateFloorplan(2026);
    const b = generateFloorplan(2026);
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.rooms).toEqual(b.rooms);
    expect(a.spawns).toEqual(b.spawns);
  });

  it('is one big open arena (room 0) filling the interior', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      expect(fp.rooms).toHaveLength(1);
      expect(fp.rooms[0]!.kind).toBe('arena');
      expect(fp.arenaRoomId).toBe(0);
      expect(fp.rooms[0]!.w).toBe(GRID_W - 2);
      expect(fp.rooms[0]!.h).toBe(GRID_H - 2);
    }
  });

  it('opens a 40m+ arena (most of the interior is walkable)', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      const interior = (GRID_W - 2) * (GRID_H - 2);
      let open = 0;
      for (let i = 0; i < fp.open.length; i++) open += fp.open[i]!;
      expect(open / interior).toBeGreaterThan(0.8);  // cover removes <20% of the floor
      // open span in meters comfortably exceeds the original 40m arena
      expect((GRID_W - 2) * CELL_M).toBeGreaterThanOrEqual(48);
    }
  });

  it('scatters cover islands (some interior solid cells), but not a maze', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      let interiorSolid = 0;
      for (let cz = 1; cz < GRID_H - 1; cz++)
        for (let cx = 1; cx < GRID_W - 1; cx++)
          if (fp.open[cz * GRID_W + cx] === 0) interiorSolid++;
      expect(interiorSolid).toBeGreaterThan(0);                 // cover exists
      expect(interiorSolid).toBeLessThan((GRID_W - 2) * (GRID_H - 2) * 0.2); // never dominant
    }
  });

  it('keeps a solid 1-cell border (no open cell on the grid edge)', () => {
    const fp = generateFloorplan(2026);
    for (let i = 0; i < fp.gridW; i++) {
      expect(isOpen(fp, i, 0)).toBe(false);
      expect(isOpen(fp, i, fp.gridH - 1)).toBe(false);
      expect(isOpen(fp, 0, i)).toBe(false);
      expect(isOpen(fp, fp.gridW - 1, i)).toBe(false);
    }
  });
});

describe('generateFloorplan — start + spawns', () => {
  it('starts the player on an open cell, facing the arena center', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      const s = fp.start.cell;
      expect(isOpen(fp, s.cx, s.cz)).toBe(true);
      // facing vector (-sinθ,-cosθ) should point toward the arena center
      const theta = (fp.start.angBlood / 2048) * Math.PI * 2;
      const fx = -Math.sin(theta), fz = -Math.cos(theta);
      const dx = (GRID_W >> 1) - s.cx, dz = (GRID_H >> 1) - s.cz;
      expect(fx * dx + fz * dz).toBeGreaterThan(0);
    }
  });

  it('keeps the spawn pocket clear of cover (start + 4-neighbours open)', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      const s = fp.start.cell;
      for (const [nx, nz] of [[s.cx, s.cz], [s.cx - 1, s.cz], [s.cx + 1, s.cz], [s.cx, s.cz - 1], [s.cx, s.cz + 1]] as const) {
        expect(isOpen(fp, nx, nz)).toBe(true);
      }
    }
  });

  it('emits enemy spawns on open floor, none on the start cell', () => {
    for (const seed of SEEDS) {
      const fp = generateFloorplan(seed);
      expect(fp.spawns.length).toBeGreaterThan(0);
      for (const sp of fp.spawns) {
        expect(isOpen(fp, sp.cell.cx, sp.cell.cz)).toBe(true);          // open floor, not cover
        expect(sp.cell.cx === fp.start.cell.cx && sp.cell.cz === fp.start.cell.cz).toBe(false);
      }
    }
  });
});

describe('bakeSimGeometry — walls', () => {
  it('produces SimAABBs and a smaller, non-empty merged set', () => {
    const fp = generateFloorplan(2026);
    const geo = bakeSimGeometry(fp);
    expect(geo.length).toBeGreaterThan(0);
    let wallCells = 0;
    for (let cz = 0; cz < fp.gridH; cz++)
      for (let cx = 0; cx < fp.gridW; cx++)
        if (fp.open[cz * fp.gridW + cx] === 0 &&
            (isOpen(fp, cx - 1, cz) || isOpen(fp, cx + 1, cz) || isOpen(fp, cx, cz - 1) || isOpen(fp, cx, cz + 1))) wallCells++;
    expect(geo.length).toBeLessThan(wallCells); // greedy merge beats 1-box-per-cell
  });

  it('every wall rect sits on a solid cell, never inside an open cell', () => {
    const fp = generateFloorplan(2026);
    for (const r of bakeWallRectsMeters(fp)) {
      const cx = Math.floor((r.minX + (fp.gridW * fp.cellMeters) / 2) / fp.cellMeters);
      const cz = Math.floor((r.minZ + (fp.gridH * fp.cellMeters) / 2) / fp.cellMeters);
      expect(fp.open[cz * fp.gridW + cx]).toBe(0);
    }
  });

  it('walls block line-of-sight from the start out through the solid border', () => {
    const fp = generateFloorplan(2026);
    const geo = bakeSimGeometry(fp);
    const s = fp.start.cell;
    const y = fpFromMeters(1.2);
    const half = (fp.gridW * fp.cellMeters) / 2;
    const sxWorld = -half + (s.cx + 0.5) * fp.cellMeters;
    const szWorld = -half + (s.cz + 0.5) * fp.cellMeters;
    expect(
      losClear(fpFromMeters(sxWorld), y, fpFromMeters(szWorld),
               fpFromMeters(sxWorld), y, fpFromMeters(-half - 10), geo),
    ).toBe(false);
  });
});

describe('floorplanFingerprint', () => {
  it('is identical for the same seed', () => {
    expect(floorplanFingerprint(generateFloorplan(2026)))
      .toBe(floorplanFingerprint(generateFloorplan(2026)));
  });
  it('differs across seeds', () => {
    expect(floorplanFingerprint(generateFloorplan(1)))
      .not.toBe(floorplanFingerprint(generateFloorplan(2)));
  });
});
