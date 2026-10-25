// src/lab/sdf-zombie/webgpu/sector-ray.ts
//
// SEGMENT VS SECTOR GEOMETRY (plan 2026-10-24-sector-levels-3a Task 3): where a 3D segment a→b first
// meets a sector level's walls, floors or ceilings — for projectiles, enemy rounds and line of sight.
//
// The walk: start in the sector under a; find the line the segment leaves that sector through (the
// nearest crossing, going from the sector's side of the line to the other); inside the sector the
// height is linear, so a floor or ceiling crossing before that exit is exact; at the exit a
// one-sided line is a wall, a two-sided line is a wall where the segment's height there is under
// the higher floor (the lower part) or over the lower ceiling (the upper part — open when both
// ceilings are sky); otherwise the walk moves to the other sector. So each piece is tested against
// the floor and ceiling of the sector it is actually in.
//
// Rules worth knowing:
// - A sky ceiling (`materials.ceil === SKY_MATERIAL`) is open: the segment leaves the map upward.
//   Walls still stand above it (one-sided lines extend upward; a two-sided line is closed above the
//   lower ceiling unless both sides are sky).
// - A start outside every sector (the void, a column hole) is a wall hit at t 0 with line −1 and
//   sector −1: the void is solid. A start under its sector's floor (over a non-sky ceiling) is a
//   floor (ceil) hit at t 0. A zero-length segment is just that start test.
// - Touching is not crossing: ending exactly on a floor is open; a two-sided line passes at exactly
//   the higher floor.
// - Through a vertex the next sector is read with sectorAt just past the vertex (1e-4 m on), so a
//   diagonal through a corner reaches the sector it really enters; grazing a column's corner from
//   outside is open, aiming into it is a wall, a corner into the void is a wall.
//
// Allocation: none per call when `out` is passed (the hit is written into it, `out.point` reused);
// without `out` a hit allocates its record and point (null allocates nothing). The first call per
// SectorMap builds a per-sector line index (two Int32Arrays, cached on a WeakMap).
//
// Pure: no three.js, no DOM.

import { SKY_MATERIAL, type SectorMap } from './sector-def';
import type { SectorGround } from './sector-ground';

export type SectorHitKind = 'wall' | 'floor' | 'ceil';
export interface SectorHit {
  /** 0..1 along a→b. */
  t: number;
  point: [number, number, number];
  kind: SectorHitKind;
  /** The line hit (a wall), or −1 (a floor, a ceiling, a start in the void). */
  line: number;
  /** The sector the segment was in at the hit, or −1 (a start in the void). */
  sector: number;
}

type V3 = readonly [number, number, number];

/** Along-segment tolerance, metres: crossings this close behind the walk's position are already done. */
const T_EPS_M = 1e-7;
/** How far past a vertex the next sector is read, metres. */
const PROBE_M = 1e-4;
/** A crossing this close to a line's end (in the line's 0..1) counts as through its vertex. */
const VERTEX_U = 1e-6;
/** Slack on the line's 0..1 so a crossing exactly at a vertex is not lost to rounding. */
const U_SLACK = 1e-9;

interface LineIndex { start: Int32Array; lines: Int32Array }
const indexCache = new WeakMap<SectorMap, LineIndex>();

/** Per sector, the lines bounding it (front or back; self-lines, front === back, left out). */
function lineIndex(map: SectorMap): LineIndex {
  let idx = indexCache.get(map);
  if (idx) return idx;
  const n = map.sectors.length;
  const start = new Int32Array(n + 1);
  for (const l of map.lines) {
    if (l.front === l.back) continue;
    start[l.front + 1]!++;
    if (l.back >= 0) start[l.back + 1]!++;
  }
  for (let s = 0; s < n; s++) start[s + 1]! += start[s]!;
  const fill = start.slice(0, n);
  const lines = new Int32Array(start[n]!);
  map.lines.forEach((l, i) => {
    if (l.front === l.back) return;
    lines[fill[l.front]!++] = i;
    if (l.back >= 0) lines[fill[l.back]!++] = i;
  });
  idx = { start, lines };
  indexCache.set(map, idx);
  return idx;
}

function put(out: SectorHit | undefined, t: number, x: number, y: number, z: number,
  kind: SectorHitKind, line: number, sector: number): SectorHit {
  if (!out) return { t, point: [x, y, z], kind, line, sector };
  out.t = t; out.point[0] = x; out.point[1] = y; out.point[2] = z;
  out.kind = kind; out.line = line; out.sector = sector;
  return out;
}

/** The first place segment a→b meets sector geometry, or null when it is open all the way.
 *  Pass `out` to reuse a hit record (the per-frame path). */
export function sectorSegmentHit(map: SectorMap, ground: SectorGround, a: V3, b: V3, out?: SectorHit): SectorHit | null {
  const S = map.sectors, L = map.lines, V = map.vertices;
  const ax = a[0], ay = a[1], az = a[2];
  const dx = b[0] - ax, dy = b[1] - ay, dz = b[2] - az;

  let s = ground.sectorAt(ax, az);
  if (s < 0) return put(out, 0, ax, ay, az, 'wall', -1, -1);
  {
    const sec = S[s]!;
    if (ay < sec.floor) return put(out, 0, ax, ay, az, 'floor', -1, s);
    if (ay > sec.ceil && sec.materials.ceil !== SKY_MATERIAL) return put(out, 0, ax, ay, az, 'ceil', -1, s);
  }

  const len = Math.sqrt(dx * dx + dz * dz);
  const tEps = len > 0 ? T_EPS_M / len : 0;
  const tProbe = len > 0 ? PROBE_M / len : 0;
  const { start, lines } = lineIndex(map);
  let t0 = 0;
  let lo = -tEps;   // the first exit may sit exactly at a (a start on a line)

  for (;;) {
    // The line the segment leaves s through: the nearest crossing from s's side to the other.
    let tc = Infinity, lc = -1, uc = 0;
    if (len > 0) {
      for (let k = start[s]!, kEnd = start[s + 1]!; k < kEnd; k++) {
        const i = lines[k]!, l = L[i]!;
        const p = V[l.v[0]]!, q = V[l.v[1]]!;
        const ex = q[0] - p[0], ez = q[1] - p[1];
        const denom = dx * ez - dz * ex;   // cross(d, e); > 0: moving from the line's left (front) to its right
        if (l.front === s ? !(denom > 0) : !(denom < 0)) continue;
        const wx = p[0] - ax, wz = p[1] - az;
        const t = (wx * ez - wz * ex) / denom;
        if (t < lo || t > 1 || t >= tc) continue;
        const u = (wx * dz - wz * dx) / denom;
        if (u < -U_SLACK || u > 1 + U_SLACK) continue;
        tc = t; lc = i; uc = u;
      }
    }

    // Floor or ceiling of s before the exit (or the end).
    const sec = S[s]!;
    const t1 = lc < 0 ? 1 : tc;
    const y1 = ay + t1 * dy;
    if (y1 < sec.floor) {
      const t = Math.min(t1, Math.max(t0, (sec.floor - ay) / dy));
      return put(out, t, ax + t * dx, sec.floor, az + t * dz, 'floor', -1, s);
    }
    if (y1 > sec.ceil && sec.materials.ceil !== SKY_MATERIAL) {
      const t = Math.min(t1, Math.max(t0, (sec.ceil - ay) / dy));
      return put(out, t, ax + t * dx, sec.ceil, az + t * dz, 'ceil', -1, s);
    }
    if (lc < 0) return null;

    // Through the exit line.
    const l = L[lc]!;
    const y = ay + tc * dy;
    let n = l.front === s ? l.back : l.front;
    if (uc < VERTEX_U || uc > 1 - VERTEX_U) {
      const tp = tc + tProbe;
      n = ground.sectorAt(ax + tp * dx, az + tp * dz);
    }
    if (n !== s) {
      if (n < 0) return put(out, tc, ax + tc * dx, y, az + tc * dz, 'wall', lc, s);
      const other = S[n]!;
      const floorHi = Math.max(sec.floor, other.floor), ceilLo = Math.min(sec.ceil, other.ceil);
      const bothSky = sec.materials.ceil === SKY_MATERIAL && other.materials.ceil === SKY_MATERIAL;
      if (y < floorHi || (y > ceilLo && !bothSky)) return put(out, tc, ax + tc * dx, y, az + tc * dz, 'wall', lc, s);
      s = n;
    }
    // Each line is crossed at most once (t only grows), so the walk ends.
    t0 = tc;
    lo = tc + tEps;
  }
}

/** A reusable "is a→b blocked by sector geometry?" test for line of sight (the director, a ranged
 *  mind): one hit record per closure, so a call allocates nothing. Both ends must be inside the level
 *  (a body's eye, the player's eye): a start in the void or exactly on a one-sided wall line is a
 *  hit at t 0, so it reads as blocked. */
export function sectorSightBlocker(map: SectorMap, ground: SectorGround): (a: V3, b: V3) => boolean {
  const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
  return (a, b) => sectorSegmentHit(map, ground, a, b, out) !== null;
}
