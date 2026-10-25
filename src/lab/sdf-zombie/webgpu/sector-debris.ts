// src/lab/sdf-zombie/webgpu/sector-debris.ts
//
// THE SECTOR DEBRIS GROUND (plan 2026-10-25-sector-levels-3b Task 1): DebrisGround for a sector level. floorAt is the
// sector floor; bounce is ONE horizontal sectorSegmentHit probe from the step's start to its end at the START height
// (a segment test, so a fast piece cannot tunnel a wall), run on past the end by the piece's radius so its leading
// edge meets the wall, and the piece's CENTRE is put max(radius, WALL_SKIN_M) from the line hit.
// Horizontal at the start height on purpose, and that height clamped into the start sector's open band
// [floor, ceil] (no top under sky): the probe meets only walls — a riser it is lower than, a lip it is higher than, a
// one-sided line — never the floor or ceiling of the sector it is in (those are the vertical clamp's business, read
// at the end x/z), and a piece that ended last step above its ceiling or below its floor still meets this step's
// walls. Cached per SectorMap.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from '../types';
import type { DebrisGround, WallBounce } from '../debris-ground';
import { SKY_MATERIAL, type SectorMap } from './sector-def';
import type { SectorGround } from './sector-ground';
import { sectorSegmentHit, type SectorHit } from './sector-ray';

/** How far short of a wall a stopped piece is put, metres (keeps the next step's start off the line). */
export const WALL_SKIN_M = 0.01;

const cache = new WeakMap<SectorMap, DebrisGround>();

export function sectorDebrisGround(map: SectorMap, ground: SectorGround): DebrisGround {
  const cached = cache.get(map);
  if (cached) return cached;
  const S = map.sectors;
  const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  const g: DebrisGround = {
    floorAt: (x, z) => ground.floorAt(x, z),
    ceilAt(x, z) {
      const s = ground.sectorAt(x, z);
      if (s < 0) return NaN;
      const sec = S[s]!;
      return sec.materials.ceil === SKY_MATERIAL ? Infinity : sec.ceil;
    },
    bounce(prev, next, vel, restitution, friction, radius = 0): WallBounce | null {
      const dx = next[0] - prev[0], dz = next[2] - prev[2];
      if (dx === 0 && dz === 0) return null;
      const s = ground.sectorAt(prev[0], prev[2]);
      if (s < 0) return null;
      // Probe inside the start sector's open band: a piece above its ceiling (or below its floor) would
      // otherwise read as a ceiling (floor) hit at t 0 and skip every wall this step.
      const sec = S[s]!;
      const top = sec.materials.ceil === SKY_MATERIAL ? Infinity : sec.ceil;
      const y = Math.min(top, Math.max(sec.floor, prev[1]));
      const stop = Math.max(radius, WALL_SKIN_M);
      // The probe runs on past next by the radius, so the piece's leading edge meets the wall, not its centre.
      const ext = radius > 0 ? radius / Math.hypot(dx, dz) : 0;
      a[0] = prev[0]; a[1] = y; a[2] = prev[2];
      b[0] = next[0] + dx * ext; b[1] = y; b[2] = next[2] + dz * ext;
      const h = sectorSegmentHit(map, ground, a, b, out, s);
      if (!h || h.kind !== 'wall' || h.line < 0) return null;
      const ln = map.lines[h.line]!;
      const v0 = map.vertices[ln.v[0]]!, v1 = map.vertices[ln.v[1]]!;
      // (−ez, ex) points into the line's front (left) side; flip it when the piece came from the back.
      let nx = -(v1[1] - v0[1]), nz = v1[0] - v0[0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (ln.front !== h.sector) { nx = -nx; nz = -nz; }
      const vn = vel[0] * nx + vel[2] * nz;
      const tx = vel[0] - vn * nx, tz = vel[2] - vn * nz;
      const rn = vn < 0 ? -vn * restitution : vn;
      // Where the centre's own path is `stop` from the line (the line is straight, so the distance is linear in
      // t), clamped to the step; a centre already closer than that is pushed out along the normal.
      const dist0 = nx * (prev[0] - h.point[0]) + nz * (prev[2] - h.point[2]);
      const dn = dx * nx + dz * nz;   // < 0: the step runs toward the wall
      const tc = dn < 0 ? Math.min(1, Math.max(0, (stop - dist0) / dn)) : 0;
      const push = stop - (dist0 + tc * dn);
      return {
        pos: [prev[0] + tc * dx + push * nx, next[1], prev[2] + tc * dz + push * nz] as Vec3,
        vel: [tx * friction + rn * nx, vel[1], tz * friction + rn * nz] as Vec3,
        normal: [nx, 0, nz] as Vec3,
      };
    },
  };
  cache.set(map, g);
  return g;
}

/** SPAWNS START INSIDE THE LEVEL (plan 3b): a piece spawned at `to` from a body whose centre is `from` (inside the
 *  map). If from → to meets sector geometry (a wall, a column, the floor, a ceiling), the piece goes at the hit point
 *  pulled WALL_SKIN_M + radius back toward `from` (at `from` itself when the hit is closer than that); otherwise `to`
 *  is returned as is (the same reference). A `from` off the map or outside its sector's band (a hit at t 0) has
 *  nothing to judge against: `to` unchanged. */
export function clampSpawnInsideMap(map: SectorMap, ground: SectorGround, from: Vec3, to: Vec3, radius = 0): Vec3 {
  const h = sectorSegmentHit(map, ground, from, to);
  if (!h || h.t <= 0) return to;
  const dx = h.point[0] - from[0], dy = h.point[1] - from[1], dz = h.point[2] - from[2];
  const d = Math.hypot(dx, dy, dz);
  const pull = WALL_SKIN_M + radius;
  if (d <= pull) return [from[0], from[1], from[2]];
  const k = (d - pull) / d;
  return [from[0] + dx * k, from[1] + dy * k, from[2] + dz * k];
}

/** A POINT spawn on a sector level (plan 3b: blood gouts and wound drops): `to` clamped inside from the body centre
 *  `from` (clampSpawnInsideMap; unclamped with no body) and the floor to seed the spawn with — the BODY's floor (the
 *  floor the drops fall toward from a limb poking over a riser or through a wall), else the floor under the point,
 *  else undefined (off the map with no body: the stepper's own fallback). */
export function seatSpawnInsideMap(
  map: SectorMap, ground: SectorGround, from: Vec3 | null, to: Vec3, radius = 0,
): { pos: Vec3; floorY: number | undefined } {
  const pos = from ? clampSpawnInsideMap(map, ground, from, to, radius) : to;
  const body = from ? ground.floorAt(from[0], from[2]) : NaN;
  const own = ground.floorAt(pos[0], pos[2]);
  return { pos, floorY: Number.isFinite(body) ? body : Number.isFinite(own) ? own : undefined };
}
