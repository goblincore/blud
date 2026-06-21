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
 * Build the arena sim-geometry (XZ AABBs in fp) mirroring the wall + obstacle
 * colliders in src/game/arena.ts. Keep these values in sync with that file; the
 * floor is NOT included here (handled as a y-clamp in the player step).
 *
 * Arena (meters): floorSize 40, wallThick 0.5, walls centered at ±20.
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
