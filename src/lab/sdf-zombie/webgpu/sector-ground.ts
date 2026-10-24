// src/lab/sdf-zombie/webgpu/sector-ground.ts
//
// SECTOR GROUND (spec 2026-10-24-doom-sector-levels-design.md §6.1–§6.2): which sector is under a
// point (even-odd crossing over that sector's lines, candidates from a uniform grid), its floor
// and ceiling, and which lines block a body. A two-sided line blocks when the opening between the
// two sectors is under SECTOR_HEADROOM_M or the higher floor is over SECTOR_STEP_M above the feet;
// the same rule both ways, so drops are open and climbs are not.
//
// Pure: no three.js, no DOM. The Rust port implements the same rule.

import type { LevelGround, WallSeg } from './level-ground';
import { SECTOR_HEADROOM_M, SECTOR_STEP_M, type SectorMap } from './sector-def';

const CELL_M = 4;

export interface SectorGround extends LevelGround {
  /** The sector index under (x, z), or -1. */
  sectorAt(x: number, z: number): number;
}

export function buildSectorGround(map: SectorMap): SectorGround {
  const V = map.vertices, S = map.sectors, L = map.lines;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of V) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL_M));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL_M));
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / CELL_M)));
  const row = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / CELL_M)));
  const sectorCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const lineCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const forCells = (x0: number, z0: number, x1: number, z1: number, f: (cell: number) => void) => {
    for (let r = row(z0); r <= row(z1); r++) for (let c = col(x0); c <= col(x1); c++) f(r * cols + c);
  };

  const sectorLines: number[][] = S.map(() => []);
  L.forEach((l, i) => {
    if (l.front !== l.back) { sectorLines[l.front]!.push(i); if (l.back >= 0) sectorLines[l.back]!.push(i); }
    const [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
    forCells(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), cell => lineCells[cell]!.push(i));
  });
  sectorLines.forEach((ls, s) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of ls) for (const vi of L[i]!.v) {
      const [x, z] = V[vi]!;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    if (ls.length > 0) forCells(x0, z0, x1, z1, cell => sectorCells[cell]!.push(s));
  });

  const inside = (s: number, x: number, z: number): boolean => {
    let odd = false;
    for (const i of sectorLines[s]!) {
      const [ax, az] = V[L[i]!.v[0]]!, [bx, bz] = V[L[i]!.v[1]]!;
      if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
    }
    return odd;
  };
  const sectorAt = (x: number, z: number): number => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return -1;
    for (const s of sectorCells[row(z) * cols + col(x)]!) if (inside(s, x, z)) return s;
    return -1;
  };
  const blocks = (i: number, feetY: number): boolean => {
    const l = L[i]!;
    if (l.back < 0) return true;
    const a = S[l.front]!, b = S[l.back]!;
    const lo = Math.max(a.floor, b.floor), hi = Math.min(a.ceil, b.ceil);
    return hi - lo < SECTOR_HEADROOM_M || lo - feetY > SECTOR_STEP_M;
  };

  return {
    sectorAt,
    floorAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.floor; },
    ceilAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.ceil; },
    blockingNear(x, z, r, feetY) {
      const out: WallSeg[] = [];
      const seen = new Set<number>();
      forCells(x - r, z - r, x + r, z + r, cell => {
        for (const i of lineCells[cell]!) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (!blocks(i, feetY)) continue;
          const [ax, az] = V[L[i]!.v[0]]!, [bx, bz] = V[L[i]!.v[1]]!;
          out.push({ ax, az, bx, bz });
        }
      });
      return out;
    },
  };
}
