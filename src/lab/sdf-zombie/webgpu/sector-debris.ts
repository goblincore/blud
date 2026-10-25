// src/lab/sdf-zombie/webgpu/sector-debris.ts
//
// THE SECTOR DEBRIS GROUND (plan 2026-10-25-sector-levels-3b Task 1): DebrisGround for a sector level. floorAt is the
// sector floor; bounce is ONE horizontal sectorSegmentHit probe from the step's start to its end at the START height
// (a segment test, so a fast piece cannot tunnel a wall), stopping the piece WALL_SKIN_M short of the line hit.
// Horizontal at the start height on purpose: a resting piece is above its own floor, so the probe meets only walls —
// a riser it is lower than, a lip it is higher than, a one-sided line — never the floor or ceiling of the sector it
// is in (those are the vertical clamp's business, read at the end x/z). Cached per SectorMap.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from '../types';
import type { DebrisGround, WallBounce } from '../debris-ground';
import type { SectorMap } from './sector-def';
import type { SectorGround } from './sector-ground';
import { sectorSegmentHit, type SectorHit } from './sector-ray';

/** How far short of a wall a stopped piece is put, metres (keeps the next step's start off the line). */
export const WALL_SKIN_M = 0.01;

const cache = new WeakMap<SectorMap, DebrisGround>();

export function sectorDebrisGround(map: SectorMap, ground: SectorGround): DebrisGround {
  const cached = cache.get(map);
  if (cached) return cached;
  const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  const g: DebrisGround = {
    floorAt: (x, z) => ground.floorAt(x, z),
    bounce(prev, next, vel, restitution, friction): WallBounce | null {
      if (prev[0] === next[0] && prev[2] === next[2]) return null;
      if (Number.isNaN(ground.floorAt(prev[0], prev[2]))) return null;
      a[0] = prev[0]; a[1] = prev[1]; a[2] = prev[2];
      b[0] = next[0]; b[1] = prev[1]; b[2] = next[2];
      const h = sectorSegmentHit(map, ground, a, b, out);
      if (!h || h.kind !== 'wall' || h.line < 0) return null;
      const ln = map.lines[h.line]!;
      const v0 = map.vertices[ln.v[0]]!, v1 = map.vertices[ln.v[1]]!;
      let nx = -(v1[1] - v0[1]), nz = v1[0] - v0[0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (nx * (prev[0] - h.point[0]) + nz * (prev[2] - h.point[2]) < 0) { nx = -nx; nz = -nz; }
      const vn = vel[0] * nx + vel[2] * nz;
      const tx = vel[0] - vn * nx, tz = vel[2] - vn * nz;
      const rn = vn < 0 ? -vn * restitution : vn;
      return {
        pos: [h.point[0] + nx * WALL_SKIN_M, next[1], h.point[2] + nz * WALL_SKIN_M] as Vec3,
        vel: [tx * friction + rn * nx, vel[1], tz * friction + rn * nz] as Vec3,
        normal: [nx, 0, nz] as Vec3,
      };
    },
  };
  cache.set(map, g);
  return g;
}
