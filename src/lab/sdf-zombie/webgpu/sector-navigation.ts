// src/lab/sdf-zombie/webgpu/sector-navigation.ts
//
// NAVIGATION OVER SECTOR GROUND (spec 2026-10-24-doom-sector-levels-design.md §6.3): the grid core of
// grid-navigation.ts, with standing and travel read from the sectors.
//
// A body of `radius` stands on the highest floor its disc touches (Doom's floorz): the sector under
// its centre and both sides of every line within `radius`. So a body overhanging a ledge stands on
// the ledge, and only drops once it is clear of it. It stands at p when
//   - p is over a sector and the ceiling there leaves SECTOR_HEADROOM_M above that floor;
//   - no line that blocks at that feet height (sector-ground's step / headroom rule) is within radius;
//   - no box overlapping feet .. feet + 1.8 m, inflated by radius, holds p.
// Travel samples every 0.12 m: each sample stands, and the feet rise at most SECTOR_STEP_M between
// samples (any drop is fine).
//
// Pure: no three.js, no DOM.

import type { Aabb } from './game-level';
import type { Vec3 } from '../types';
import type { WanderBounds } from '../wander';
import { createGridNavigation, type EncounterNavigation } from './grid-navigation';
import type { SectorGround } from './sector-ground';
import { SECTOR_HEADROOM_M, SECTOR_STEP_M, zoneName, type SectorMap } from './sector-def';

const STEP = 0.4;
const SAMPLE_M = 0.12;
const BODY_H = 1.8;

/** Squared distance from (px, pz) to the segment a -> b. */
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return ex * ex + ez * ez;
}

export function createSectorNavigation(map: SectorMap, ground: SectorGround, rooms: readonly { id: number; name: string }[],
  boxes: readonly Aabb[], radius = 0.34): EncounterNavigation {
  const V = map.vertices, S = map.sectors, Ls = map.lines;
  const r2 = radius * radius;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of V) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const bounds: WanderBounds = { minX, maxX, minZ, maxZ };

  // Each line's box, to cut a cell's candidate lines down to those near a point or segment.
  const box = Float64Array.from(Ls.flatMap(l => {
    const [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
    return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
  }));
  const near = (x0: number, z0: number, x1: number, z1: number): number[] =>
    ground.linesNear(x0, z0, x1, z1).filter(i => box[4 * i]! <= x1 && box[4 * i + 2]! >= x0 && box[4 * i + 1]! <= z1 && box[4 * i + 3]! >= z0);
  /** Whether the segment p -> q touches line i (endpoints included). */
  const crosses = (i: number, px: number, pz: number, qx: number, qz: number): boolean => {
    const [ax, az] = V[Ls[i]!.v[0]]!, [bx, bz] = V[Ls[i]!.v[1]]!;
    const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), d2 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
    const d3 = (qx - px) * (az - pz) - (qz - pz) * (ax - px), d4 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px);
    return d1 * d2 <= 0 && d3 * d4 <= 0;
  };
  /** The feet height of a body centred at (x, z) over sector s, or NaN when it cannot stand there.
   *  `cand` holds (at least) every line within radius. Feet: the highest floor the disc touches. */
  const probe = (x: number, z: number, s: number, cand: readonly number[]): number => {
    if (s < 0) return NaN;
    let feet = S[s]!.floor, close = false;
    for (const i of cand) {
      const l = Ls[i]!, [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
      if (segDist2(x, z, ax, az, bx, bz) >= r2) continue;
      close = true;
      if (l.back >= 0) feet = Math.max(feet, S[l.front]!.floor, S[l.back]!.floor);
    }
    if (S[s]!.ceil - feet < SECTOR_HEADROOM_M) return NaN;
    if (close)
      for (const w of ground.blockingNear(x, z, radius, feet))
        if (segDist2(x, z, w.ax, w.az, w.bx, w.bz) < r2) return NaN;
    for (const b of boxes)
      if (b.min[1] < feet + BODY_H && b.max[1] > feet
        && x > b.min[0] - radius && x < b.max[0] + radius && z > b.min[2] - radius && z < b.max[2] + radius) return NaN;
    return feet;
  };
  const canStand = (p: Vec3): boolean => {
    const x = p[0], z = p[2];
    const sector = ground.sectorAt(x, z);
    return sector >= 0 && Number.isFinite(probe(x, z, sector, near(x - radius, z - radius, x + radius, z + radius)));
  };
  // One candidate-line query per segment; the sector is looked up at the start and again only after
  // a sample step touches a line (sectorAt is the expensive part).
  const canTravel = (a: Vec3, b: Vec3): boolean => {
    const ax = a[0], az = a[2], bx = b[0], bz = b[2];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SAMPLE_M));
    const cand = near(Math.min(ax, bx) - radius, Math.min(az, bz) - radius, Math.max(ax, bx) + radius, Math.max(az, bz) + radius);
    let s = ground.sectorAt(ax, az), feet = NaN, px = ax, pz = az;
    // No line near the segment: one sector, one floor, nothing to cross; only the boxes vary.
    if (cand.length === 0 && boxes.length === 0) return Number.isFinite(probe(ax, az, s, cand));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (i > 0 && cand.some(l => crosses(l, px, pz, x, z))) s = ground.sectorAt(x, z);
      const next = probe(x, z, s, cand);
      if (!Number.isFinite(next) || next - feet > SECTOR_STEP_M) return false;
      feet = next; px = x; pz = z;
    }
    return true;
  };
  const roomIds = new Map(rooms.map(r => [r.name, r.id]));
  const roomAt = (p: Vec3): number => {
    const s = ground.sectorAt(p[0], p[2]);
    return s < 0 ? 0 : roomIds.get(zoneName(S[s]!.zone)) ?? 0;
  };
  /** The floor of the sector under p (NaN off the map). */
  const floorAt = (p: Vec3): number => ground.floorAt(p[0], p[2]);
  return createGridNavigation({ bounds, step: STEP, canStand, canTravel, roomAt, floorAt });
}
