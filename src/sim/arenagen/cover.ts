// src/sim/arenagen/cover.ts
// Dynamite-graded cover placement. Mutates the occupancy grid (carves solids).
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import { randomInt, type SimRng } from '../rng';
import { ringOf, cellsInRing } from './rings';
import type { CoverPiece, Pocket } from './types';

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

/** 3 cells × 2 m = 6 m — the structural tall-wall/maze ban from the spec. */
export const MAX_WALL_RUN = 3;

/** Longest contiguous interior solid run through (cx,cz), row or column. */
export function maxRunAt(open: Uint8Array, cx: number, cz: number): number {
  let n = 0, m = 0;
  for (let x = cx - 1; x >= 1 && open[idx(x, cz)] === 0; x--) n++;
  for (let x = cx + 1; x <= GRID_W - 2 && open[idx(x, cz)] === 0; x++) m++;
  const row = 1 + n + m;
  n = 0; m = 0;
  for (let z = cz - 1; z >= 1 && open[idx(cx, z)] === 0; z--) n++;
  for (let z = cz + 1; z <= GRID_H - 2 && open[idx(cx, z)] === 0; z++) m++;
  return Math.max(row, 1 + n + m);
}

function pieceCells(cx: number, cz: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let z = cz; z < cz + h; z++) for (let x = cx; x < cx + w; x++) out.push({ cx: x, cz: z });
  return out;
}

/** No pre-existing interior solid within the 8-neighbourhood of any cell
 *  (border walls exempt) — keeps distinct cover pieces from fusing. */
function clearAround(open: Uint8Array, cells: Cell[]): boolean {
  const inSet = (x: number, z: number) => cells.some((c) => c.cx === x && c.cz === z);
  for (const c of cells)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.cx + dx, z = c.cz + dz;
        if (x < 1 || z < 1 || x > GRID_W - 2 || z > GRID_H - 2) continue;
        if (!inSet(x, z) && open[idx(x, z)] === 0) return false;
      }
  return true;
}

/** Carve cells solid iff all are open and no resulting run exceeds
 *  MAX_WALL_RUN; rolls back and returns false otherwise. */
function tryCarve(open: Uint8Array, cells: Cell[]): boolean {
  for (const c of cells) if (open[idx(c.cx, c.cz)] !== 1) return false;
  for (const c of cells) open[idx(c.cx, c.cz)] = 0;
  for (const c of cells)
    if (maxRunAt(open, c.cx, c.cz) > MAX_WALL_RUN) {
      for (const u of cells) open[idx(u.cx, u.cz)] = 1;
      return false;
    }
  return true;
}

/** Center stage: 1–3 LOW pieces only — nothing here breaks a dynamite arc. */
export function placeCenterCover(rng: SimRng, open: Uint8Array): CoverPiece[] {
  const anchors = cellsInRing('center');
  const target = 1 + randomInt(rng, 3);
  const placed: CoverPiece[] = [];
  for (let attempt = 0; placed.length < target && attempt < 60; attempt++) {
    const a = anchors[randomInt(rng, anchors.length)]!;
    const horiz = randomInt(rng, 2) === 0;
    const w = horiz ? 2 : 1, h = horiz ? 1 : 2;
    const cells = pieceCells(a.cx, a.cz, w, h);
    if (cells.some((c) => ringOf(c.cx, c.cz) !== 'center')) continue;
    if (placed.some((p) => Math.abs(p.cx - a.cx) <= 3 && Math.abs(p.cz - a.cz) <= 3)) continue;
    if (!clearAround(open, cells)) continue;
    if (!tryCarve(open, cells)) continue;
    placed.push({ cx: a.cx, cz: a.cz, w, h, height: 'low', clusterId: -1 });
  }
  return placed;
}
