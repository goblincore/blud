// src/sim/geometry.ts
import { fpFromMeters } from './fp';

/** XZ-plane axis-aligned box in fp units. Walls/obstacles are full-height, so
 *  only the XZ footprint matters for the player's horizontal clip. */
export interface SimAABB {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

interface PtXZ { x: number; z: number; }

/**
 * Move `from` by (dx, dz) fp, sliding against `boxes` with a circle of `radius`.
 * Axis-separated (Build/Doom-style clipmove): resolve X first, then Z, so a
 * diagonal move into a wall slides along it. Deterministic and order-independent
 * (each axis clamps to the nearest blocking edge). Returns the new fp position.
 *
 * Approximation: treats the player as an AABB of half-extent `radius` (square,
 * not circle). Fine for axis-aligned arena geometry; revisit for diagonal walls.
 */
export function clipMoveXZ(
  from: PtXZ, dx: number, dz: number, radius: number, boxes: SimAABB[],
): PtXZ {
  let x = from.x;
  let z = from.z;

  // — X axis —
  let nx = x + dx;
  for (const b of boxes) {
    // overlap in Z (expanded by radius)?
    if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
    if (dx > 0 && x + radius <= b.minX && nx + radius > b.minX) nx = b.minX - radius;
    else if (dx < 0 && x - radius >= b.maxX && nx - radius < b.maxX) nx = b.maxX + radius;
  }
  x = nx;

  // — Z axis (using the already-resolved x) —
  let nz = z + dz;
  for (const b of boxes) {
    if (x + radius <= b.minX || x - radius >= b.maxX) continue;
    if (dz > 0 && z + radius <= b.minZ && nz + radius > b.minZ) nz = b.minZ - radius;
    else if (dz < 0 && z - radius >= b.maxZ && nz - radius < b.maxZ) nz = b.maxZ + radius;
  }
  z = nz;

  return { x, z };
}

/**
 * Deterministic segment-vs-AABB test in the XZ plane (slab method). Returns
 * true iff the segment from (x0,z0) to (x1,z1) intersects `aabb`, boundary
 * inclusive (a segment grazing the box edge counts as a hit — conservative
 * for line-of-sight). All inputs are fp integers, so the per-axis `t` ratios are
 * exact rationals; arithmetic is deterministic IEEE-754 within safe-int range.
 *
 * Arena AABBs are full-height columns, so a 2D XZ test suffices (the caller's
 * Y coordinates are dropped by `losClear`).
 */
export function segmentHitsAABB(
  x0: number, z0: number, x1: number, z1: number, aabb: SimAABB,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;

  // — X slab —
  let txmin: number;
  let txmax: number;
  if (dx === 0) {
    // Segment parallel to Z: inside the X slab only if x0 lies within [minX,maxX].
    if (x0 < aabb.minX || x0 > aabb.maxX) return false;
    txmin = -Infinity;
    txmax = Infinity;
  } else {
    const t1 = (aabb.minX - x0) / dx;
    const t2 = (aabb.maxX - x0) / dx;
    txmin = t1 < t2 ? t1 : t2;
    txmax = t1 < t2 ? t2 : t1;
  }

  // — Z slab —
  let tzmin: number;
  let tzmax: number;
  if (dz === 0) {
    if (z0 < aabb.minZ || z0 > aabb.maxZ) return false;
    tzmin = -Infinity;
    tzmax = Infinity;
  } else {
    const t1 = (aabb.minZ - z0) / dz;
    const t2 = (aabb.maxZ - z0) / dz;
    tzmin = t1 < t2 ? t1 : t2;
    tzmax = t1 < t2 ? t2 : t1;
  }

  // Intersect both slab intervals with the segment parameter range [0,1].
  const tEnter = Math.max(txmin, tzmin, 0);
  const tExit = Math.min(txmax, tzmax, 1);
  return tEnter <= tExit;
}

/**
 * Parametric companion to {@link segmentHitsAABB}: returns the entry parameter
 * `t` in [0,1] at which the segment (x0,z0)→(x1,z1) enters `aabb`, or `Infinity`
 * if they do not intersect. `t=0` means the start point is already inside the
 * box. Used by the cultist hitscan (dude.ts) to ORDER a pellet's player-hit vs
 * its geometry-hit so a wall between the cultist and player blocks the shot.
 *
 * Same slab math as {@link segmentHitsAABB}; only the return value differs.
 */
export function segmentEnterT(
  x0: number, z0: number, x1: number, z1: number, aabb: SimAABB,
): number {
  const dx = x1 - x0;
  const dz = z1 - z0;

  // — X slab —
  let txmin: number;
  let txmax: number;
  if (dx === 0) {
    if (x0 < aabb.minX || x0 > aabb.maxX) return Infinity;
    txmin = -Infinity;
    txmax = Infinity;
  } else {
    const t1 = (aabb.minX - x0) / dx;
    const t2 = (aabb.maxX - x0) / dx;
    txmin = t1 < t2 ? t1 : t2;
    txmax = t1 < t2 ? t2 : t1;
  }

  // — Z slab —
  let tzmin: number;
  let tzmax: number;
  if (dz === 0) {
    if (z0 < aabb.minZ || z0 > aabb.maxZ) return Infinity;
    tzmin = -Infinity;
    tzmax = Infinity;
  } else {
    const t1 = (aabb.minZ - z0) / dz;
    const t2 = (aabb.maxZ - z0) / dz;
    tzmin = t1 < t2 ? t1 : t2;
    tzmax = t1 < t2 ? t2 : t1;
  }

  const tEnter = Math.max(txmin, tzmin, 0);
  const tExit = Math.min(txmax, tzmax, 1);
  if (tEnter > tExit) return Infinity;
  return tEnter;
}

/**
 * True if the eye→target segment is unobstructed by any solid geometry AABB.
 * `y0`/`y1` are accepted (eye/target heights) but unused — arena walls and
 * obstacles are full-height columns, so an XZ footprint test is sufficient.
 */
export function losClear(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  geo: SimAABB[],
): boolean {
  void y0;
  void y1;
  for (const a of geo) {
    if (segmentHitsAABB(x0, z0, x1, z1, a)) return false;
  }
  return true;
}

/**
 * Build the arena sim-geometry (XZ AABBs in fp) mirroring the wall + obstacle
 * colliders in src/game/arena.ts. Keep these values in sync with that file; the
 * floor is NOT included here (handled as a y-clamp in the player step).
 *
 * Arena (meters): floorSize 40, wallThick 0.5, walls centered at ±20.
 *
 * SYNC WARNING: these wall + obstacle AABBs mirror the colliders in
 * src/game/arena.ts (the `walls` and `obstacles` arrays). arena.ts is NOT
 * imported (determinism firewall) — if you add/move arena geometry, update
 * this function by hand or the sim collision will diverge from the visuals.
 */
export function buildArenaGeometry(): SimAABB[] {
  const boxFromCenter = (cx: number, cz: number, sx: number, sz: number): SimAABB => ({
    minX: fpFromMeters(cx - sx / 2), maxX: fpFromMeters(cx + sx / 2),
    minZ: fpFromMeters(cz - sz / 2), maxZ: fpFromMeters(cz + sz / 2),
  });
  const floorSize = 40, wallThick = 0.5;
  const wallLen = floorSize + wallThick;
  return [
    // perimeter walls: [centerX, centerZ, sizeX, sizeZ]
    boxFromCenter(0, -floorSize / 2, wallLen, wallThick),
    boxFromCenter(0,  floorSize / 2, wallLen, wallThick),
    boxFromCenter(-floorSize / 2, 0, wallThick, wallLen),
    boxFromCenter( floorSize / 2, 0, wallThick, wallLen),
    // obstacles — mirrored from src/game/arena.ts lines 104-108
    // [sx, sy, sz, px, py, pz] → boxFromCenter(px, pz, sx, sz)
    boxFromCenter(-4, -3, 2, 2),   // [2, 1, 2, -4, 0.5, -3]
    boxFromCenter(5, 2, 3, 1),     // [3, 2, 1, 5, 1, 2]
    boxFromCenter(-6, 4, 1, 4),    // [1, 0.5, 4, -6, 0.25, 4]
  ];
}
