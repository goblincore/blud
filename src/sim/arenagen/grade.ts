// src/sim/arenagen/grade.ts
// Dynamite scoring: verifies emergent properties placement can't guarantee.
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import { ringOf, cellsInRing } from './rings';
import type { CoverPiece, Pocket, GradeReport } from './types';

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

export const SIGHTLINE_MIN = 0.55;
export const POCKET_MIN = 2;
export const POCKET_CELLS_MIN = 6;

/** Blocking grid for sightlines: solids minus LOW cover — a 1 m lob-over
 *  piece doesn't break eye-height LOS; mid cover and walls do. */
export function sightBlockers(open: Uint8Array, cover: CoverPiece[]): Uint8Array {
  const block = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < open.length; i++) block[i] = open[i] === 0 ? 1 : 0;
  for (const p of cover)
    if (p.height === 'low')
      for (let z = p.cz; z < p.cz + p.h; z++)
        for (let x = p.cx; x < p.cx + p.w; x++) block[idx(x, z)] = 0;
  return block;
}

/** Cell-center ray march (half-cell steps); true if no blocking cell crossed. */
export function gridLosClear(block: Uint8Array, a: Cell, b: Cell): boolean {
  const x0 = a.cx + 0.5, z0 = a.cz + 0.5, x1 = b.cx + 0.5, z1 = b.cz + 0.5;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t), cz = Math.floor(z0 + (z1 - z0) * t);
    if (block[cz * GRID_W + cx] === 1) return false;
  }
  return true;
}

export function gradePlan(
  open: Uint8Array, cover: CoverPiece[], pockets: Pocket[],
): GradeReport {
  // Backpedal: the perimeter lane must be one connected open circuit.
  const laneCells = cellsInRing('perimeter').filter((c) => open[idx(c.cx, c.cz)] === 1);
  const laneSet = new Set(laneCells.map((c) => idx(c.cx, c.cz)));
  let laneConnected = laneSet.size === cellsInRing('perimeter').length && laneSet.size > 0;
  if (laneConnected) {
    const seen = new Set<number>([idx(laneCells[0]!.cx, laneCells[0]!.cz)]);
    const q: Cell[] = [laneCells[0]!];
    while (q.length > 0) {
      const c = q.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = idx(c.cx + dx, c.cz + dz);
        if (laneSet.has(k) && !seen.has(k)) { seen.add(k); q.push({ cx: c.cx + dx, cz: c.cz + dz }); }
      }
    }
    laneConnected = seen.size === laneSet.size;
  }

  // Sightlines: sampled lane cells → sampled open center cells, height-aware.
  const block = sightBlockers(open, cover);
  const sources = laneCells.filter((_, i) => i % 3 === 0);
  const targets = cellsInRing('center')
    .filter((c) => open[idx(c.cx, c.cz)] === 1 && (c.cx + c.cz) % 2 === 0);
  let clear = 0, total = 0;
  for (const s of sources) for (const t of targets) { total++; if (gridLosClear(block, s, t)) clear++; }
  const sightline = total === 0 ? 0 : clear / total;

  const midCount = cover.filter((p) => p.height === 'mid').length;
  const lowCount = cover.length - midCount;
  const pocketCells = pockets.reduce((s, p) => s + p.cells.length, 0);
  const lowMidRatioOk = midCount >= 2 && midCount <= 4 && lowCount >= 2 * midCount;
  const centerClean = !cover.some(
    (p) => p.height === 'mid' && ringOf(p.cx, p.cz) === 'center',
  );

  return {
    sightline,
    pocketCount: pockets.length,
    pocketCells,
    laneConnected,
    lowMidRatioOk,
    centerClean,
    pass: sightline >= SIGHTLINE_MIN && pockets.length >= POCKET_MIN &&
      pocketCells >= POCKET_CELLS_MIN && laneConnected && lowMidRatioOk && centerClean,
  };
}
