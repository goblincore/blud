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

/** Mid ring: 4–6 clusters of 2–3 pieces, each with a shared open pocket on the
 *  outward side. Enemy pathing funnels into pockets → dynamite payoff; the
 *  player reads pockets as throw targets while backpedaling to the lane. */
export function placeMidClusters(
  rng: SimRng, open: Uint8Array,
): { pieces: CoverPiece[]; pockets: Pocket[] } {
  const anchors = cellsInRing('mid');
  const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2;
  const target = 4 + randomInt(rng, 3); // 4–6 clusters
  const pieces: CoverPiece[] = [];
  const pockets: Pocket[] = [];
  const reserved = new Set<number>(); // pocket cells no later cluster may carve
  let clusterId = 0;
  for (let attempt = 0; clusterId < target && attempt < 160; attempt++) {
    const a = anchors[randomInt(rng, anchors.length)]!;
    // Outward = dominant axis away from grid center; perpendicular spreads the cluster.
    const ox = a.cx - hx, oz = a.cz - hz;
    const dir = Math.abs(ox) >= Math.abs(oz)
      ? { dx: Math.sign(ox) || 1, dz: 0 }
      : { dx: 0, dz: Math.sign(oz) || 1 };
    const perp = { dx: dir.dz, dz: dir.dx };
    const n = 2 + randomInt(rng, 2); // 2–3 pieces
    const cells: Cell[] = [
      { cx: a.cx, cz: a.cz },
      { cx: a.cx + perp.dx, cz: a.cz + perp.dz },
    ];
    if (n === 3) cells.push({ cx: a.cx - perp.dx, cz: a.cz - perp.dz });
    if (cells.some((c) => ringOf(c.cx, c.cz) !== 'mid')) continue;
    if (cells.some((c) => reserved.has(c.cz * GRID_W + c.cx))) continue;
    // Pocket candidates: the far (outward) side of the cluster.
    const pocketCand: Cell[] = [
      { cx: a.cx + dir.dx, cz: a.cz + dir.dz },
      { cx: a.cx + dir.dx + perp.dx, cz: a.cz + dir.dz + perp.dz },
      { cx: a.cx + dir.dx - perp.dx, cz: a.cz + dir.dz - perp.dz },
      { cx: a.cx + 2 * dir.dx, cz: a.cz + 2 * dir.dz },
    ].filter((c) => ringOf(c.cx, c.cz) === 'mid' && open[c.cz * GRID_W + c.cx] === 1);
    if (pocketCand.length < 2) continue;
    if (!clearAround(open, cells)) continue;
    if (!tryCarve(open, cells)) continue;
    for (const c of cells)
      pieces.push({ cx: c.cx, cz: c.cz, w: 1, h: 1, height: 'low', clusterId });
    const size = Math.min(pocketCand.length, 2 + randomInt(rng, 3)); // 2–4 cells
    const pocketCells = pocketCand.slice(0, size);
    for (const c of pocketCells) reserved.add(c.cz * GRID_W + c.cx);
    pockets.push({ clusterId, cells: pocketCells });
    clusterId++;
  }
  return { pieces, pockets };
}

/** Promote 2–4 mid-ring pieces to sightline breakers, never adjacent
 *  (Chebyshev > 2 apart). Everything else stays lob-over low. */
export function assignMidHeights(rng: SimRng, pieces: CoverPiece[]): void {
  if (pieces.length === 0) return;
  const target = 2 + randomInt(rng, 3); // 2–4
  const chosen: CoverPiece[] = [];
  for (let attempt = 0; chosen.length < target && attempt < 60; attempt++) {
    const p = pieces[randomInt(rng, pieces.length)]!;
    if (p.height === 'mid') continue;
    if (chosen.some((q) => Math.abs(q.cx - p.cx) <= 2 && Math.abs(q.cz - p.cz) <= 2)) continue;
    p.height = 'mid';
    chosen.push(p);
  }
}
