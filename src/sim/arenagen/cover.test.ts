// src/sim/arenagen/cover.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { createRng } from '../rng';
import { ringOf } from './rings';
import {
  maxRunAt,
  placeCenterCover,
  placeMidClusters,
  assignMidHeights,
  MAX_WALL_RUN,
} from './cover';

const openInterior = () => {
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[z * GRID_W + x] = 1;
  return open;
};

describe('maxRunAt', () => {
  it('measures a horizontal solid run through a cell', () => {
    const open = openInterior();
    for (const cx of [10, 11, 12]) open[14 * GRID_W + cx] = 0;
    expect(maxRunAt(open, 11, 14)).toBe(3);
  });
});

describe('placeCenterCover', () => {
  it('places 1–3 low pieces, all inside the center stage', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const pieces = placeCenterCover(createRng(seed), open);
      expect(pieces.length).toBeGreaterThanOrEqual(1);
      expect(pieces.length).toBeLessThanOrEqual(3);
      for (const p of pieces) {
        expect(p.height).toBe('low');
        for (let z = p.cz; z < p.cz + p.h; z++)
          for (let x = p.cx; x < p.cx + p.w; x++) {
            expect(ringOf(x, z)).toBe('center');
            expect(open[z * GRID_W + x]).toBe(0); // carved solid
          }
      }
    }
  });

  it('never creates a solid run longer than MAX_WALL_RUN', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      placeCenterCover(createRng(seed), open);
      for (let cz = 1; cz < GRID_H - 1; cz++)
        for (let cx = 1; cx < GRID_W - 1; cx++)
          if (open[cz * GRID_W + cx] === 0)
            expect(maxRunAt(open, cx, cz)).toBeLessThanOrEqual(MAX_WALL_RUN);
    }
  });
});

describe('placeMidClusters', () => {
  it('places 4–6 clusters of 2–3 one-cell pieces, all in the mid ring, each with a 2–4 cell open pocket', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const { pieces, pockets } = placeMidClusters(createRng(seed), open);
      const clusterIds = new Set(pieces.map((p) => p.clusterId));
      expect(clusterIds.size).toBeGreaterThanOrEqual(4);
      expect(clusterIds.size).toBeLessThanOrEqual(6);
      for (const p of pieces) expect(ringOf(p.cx, p.cz)).toBe('mid');
      for (const pk of pockets) {
        expect(pk.cells.length).toBeGreaterThanOrEqual(2);
        expect(pk.cells.length).toBeLessThanOrEqual(4);
        for (const c of pk.cells) expect(open[c.cz * GRID_W + c.cx]).toBe(1); // pockets stay open
      }
      expect(pockets.length).toBe(clusterIds.size); // one pocket per cluster
    }
  });

  it('pockets face away from the grid center (outward of their cluster anchor)', () => {
    const open = openInterior();
    const { pieces, pockets } = placeMidClusters(createRng(42), open);
    const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2;
    for (const pk of pockets) {
      const anchor = pieces.find((p) => p.clusterId === pk.clusterId)!;
      const aDist = Math.max(Math.abs(anchor.cx - hx), Math.abs(anchor.cz - hz));
      for (const c of pk.cells) {
        const cDist = Math.max(Math.abs(c.cx - hx), Math.abs(c.cz - hz));
        expect(cDist).toBeGreaterThanOrEqual(aDist); // never closer to center than the cluster
      }
    }
  });
});

describe('assignMidHeights', () => {
  it('flags 2–4 pieces as mid, never within Chebyshev 2 of each other', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const { pieces } = placeMidClusters(createRng(seed), open);
      assignMidHeights(createRng(seed ^ 0xbeef), pieces);
      const mids = pieces.filter((p) => p.height === 'mid');
      expect(mids.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < mids.length; i++)
        for (let j = i + 1; j < mids.length; j++) {
          const d = Math.max(Math.abs(mids[i]!.cx - mids[j]!.cx), Math.abs(mids[i]!.cz - mids[j]!.cz));
          expect(d).toBeGreaterThan(2);
        }
    }
  });
});
