// src/sim/arenagen/rings.ts
// Radial zoning via Chebyshev distance → square rings matching the square arena.
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import type { Ring } from './types';

export const CENTER_MAX = 0.40; // r ≤ 0.40 → center stage
export const MID_MAX = 0.75;    // 0.40 < r ≤ 0.75 → mid ring; beyond → perimeter lane

export function ringOf(cx: number, cz: number): Ring {
  if (cx <= 0 || cz <= 0 || cx >= GRID_W - 1 || cz >= GRID_H - 1) return 'wall';
  const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2; // 13.5 on the 28-grid
  const half = (GRID_W - 2) / 2;                       // 13 interior half-width
  const r = Math.max(Math.abs(cx - hx), Math.abs(cz - hz)) / half;
  return r <= CENTER_MAX ? 'center' : r <= MID_MAX ? 'mid' : 'perimeter';
}

export function cellsInRing(ring: Ring): Cell[] {
  const out: Cell[] = [];
  for (let cz = 0; cz < GRID_H; cz++)
    for (let cx = 0; cx < GRID_W; cx++)
      if (ringOf(cx, cz) === ring) out.push({ cx, cz });
  return out;
}
