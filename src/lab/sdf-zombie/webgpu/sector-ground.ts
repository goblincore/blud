// src/lab/sdf-zombie/webgpu/sector-ground.ts
//
// SECTOR GROUND (spec 2026-10-24-doom-sector-levels-design.md §6.1–§6.2): which sector is under a
// point (even-odd crossing over that sector's lines, candidates from a uniform grid), its floor
// and ceiling, and which lines block a body. A two-sided line blocks when the opening between the
// two sectors is under SECTOR_HEADROOM_M or the higher floor is over SECTOR_STEP_M above the feet;
// the same rule both ways, so drops are open and climbs are not.
//
// DOORS (sector-doors.ts): the ground owns the level's DoorField. A face line of a door that is not
// fully open blocks a body with its leaf pieces only (blockingNear), whatever the height rule says;
// `lineBlocks` (navigation's static rule) ignores doors, so routes run through doorways.
//
// Pure: no three.js, no DOM. The Rust port implements the same rule.

import type { LevelGround, WallSeg } from './level-ground';
import { SECTOR_HEADROOM_M, SECTOR_STEP_M, type SectorMap } from './sector-def';
import { createDoorField, type DoorField } from './sector-doors';

const CELL_M = 4;

/** Squared distance from (px, pz) to the segment a -> b. */
export function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return ex * ex + ez * ez;
}

/** The highest floor a disc (squared radius r2) centred at (x, z) over sector s touches: that
 *  sector's floor and both sides of every two-sided line in `cand` within the radius (Doom's
 *  floorz). `hit.close` is set when any line of `cand` is within the radius. Sector navigation's
 *  standing probe and SectorGround.floorUnder share this. */
export function discFloor(map: SectorMap, s: number, x: number, z: number, cand: readonly number[], r2: number,
  hit?: { close: boolean }): number {
  const V = map.vertices, S = map.sectors, Ls = map.lines;
  let feet = S[s]!.floor, close = false;
  for (const i of cand) {
    const l = Ls[i]!, [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
    if (segDist2(x, z, ax, az, bx, bz) >= r2) continue;
    close = true;
    if (l.back >= 0) feet = Math.max(feet, S[l.front]!.floor, S[l.back]!.floor);
  }
  if (hit) hit.close = close;
  return feet;
}

export interface SectorGround extends LevelGround {
  /** The sector index under (x, z), or -1. */
  sectorAt(x: number, z: number): number;
  /** The indices of the lines in the grid cells the box covers (deduplicated; a candidate set, not
   *  an exact overlap test). Corners in either order. Empty when the box misses the map. A fresh
   *  array: the caller may filter it in place. */
  linesNear(x0: number, z0: number, x1: number, z1: number): number[];
  /** Whether line i blocks a body with its feet at feetY (the rule blockingNear applies). */
  lineBlocks(i: number, feetY: number): boolean;
  /** The highest floor a disc of `radius` at (x, z) touches (discFloor); NaN off the map. */
  floorUnder(x: number, z: number, radius: number): number;
  /** The level's doors, live (every door shut until the game opens it; empty with no `doors`). */
  readonly doors: DoorField;
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
  const sectorBox = new Float64Array(S.length * 4);
  sectorLines.forEach((ls, s) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of ls) for (const vi of L[i]!.v) {
      const [x, z] = V[vi]!;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    sectorBox.set([x0, z0, x1, z1], s * 4);
    if (ls.length > 0) forCells(x0, z0, x1, z1, cell => sectorCells[cell]!.push(s));
  });

  // The even-odd rule of sector-edges.ts pointInEdges, inlined over line indices (no per-call edge arrays)
  // because sectorAt is on the per-frame path.
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
    for (const s of sectorCells[row(z) * cols + col(x)]!) {
      const b = s * 4;
      if (x < sectorBox[b]! || z < sectorBox[b + 1]! || x > sectorBox[b + 2]! || z > sectorBox[b + 3]!) continue;   // cheap reject
      if (inside(s, x, z)) return s;
    }
    return -1;
  };
  const blocks = (i: number, feetY: number): boolean => {
    const l = L[i]!;
    if (l.back < 0) return true;
    const a = S[l.front]!, b = S[l.back]!;
    const lo = Math.max(a.floor, b.floor), hi = Math.min(a.ceil, b.ceil);
    return hi - lo < SECTOR_HEADROOM_M || lo - feetY > SECTOR_STEP_M;
  };

  // Dedup by stamping lines with a per-call number (linesNear is on the navigation hot path).
  const stamp = new Uint32Array(L.length);
  let stampNow = 0;
  const linesNear = (x0: number, z0: number, x1: number, z1: number): number[] => {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), lz = Math.min(z0, z1), hz = Math.max(z0, z1);
    if (hx < minX || lx > maxX || hz < minZ || lz > maxZ) return [];
    const out: number[] = [];
    if (++stampNow === 0xffffffff) { stamp.fill(0); stampNow = 1; }
    for (let r = row(lz); r <= row(hz); r++) for (let c = col(lx); c <= col(hx); c++)
      for (const i of lineCells[r * cols + c]!) if (stamp[i] !== stampNow) { stamp[i] = stampNow; out.push(i); }
    return out;
  };

  const doors = createDoorField(map);
  return {
    doors,
    sectorAt,
    linesNear,
    lineBlocks: blocks,
    floorAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.floor; },
    floorUnder: (x, z, radius) => {
      const s = sectorAt(x, z);
      if (s < 0) return NaN;
      if (!(radius > 0)) return S[s]!.floor;
      return discFloor(map, s, x, z, linesNear(x - radius, z - radius, x + radius, z + radius), radius * radius);
    },
    ceilAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.ceil; },
    blockingNear(x, z, r, feetY) {
      const out: WallSeg[] = [];
      const seen = new Set<number>();
      forCells(x - r, z - r, x + r, z + r, cell => {
        for (const i of lineCells[cell]!) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (doors.lineDoor[i]! >= 0 && doors.open[doors.lineDoor[i]!]! < 1) { doors.leafSegs(i, out); continue; }
          if (!blocks(i, feetY)) continue;
          const [ax, az] = V[L[i]!.v[0]]!, [bx, bz] = V[L[i]!.v[1]]!;
          out.push({ ax, az, bx, bz });
        }
      });
      return out;
    },
  };
}
