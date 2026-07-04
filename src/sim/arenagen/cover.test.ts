// src/sim/arenagen/cover.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { createRng } from '../rng';
import { ringOf } from './rings';
import { maxRunAt, placeCenterCover, MAX_WALL_RUN } from './cover';

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
