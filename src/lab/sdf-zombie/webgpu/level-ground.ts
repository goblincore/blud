// src/lab/sdf-zombie/webgpu/level-ground.ts
//
// THE GROUND a body stands on (spec 2026-10-24-doom-sector-levels-design.md §6.1): the floor and
// ceiling under a point and the wall lines that block a body there. Room levels stand on y = 0
// with no lines (FLAT_GROUND, so they behave exactly as before); sector levels answer from their
// sectors (sector-ground.ts). Box solids stay in the AABB collider list.
//
// Pure: no three.js, no DOM.

/** A 2D wall segment in x/z. */
export interface WallSeg { ax: number; az: number; bx: number; bz: number }

export interface LevelGround {
  /** Floor height under (x, z); NaN outside every sector. */
  floorAt(x: number, z: number): number;
  /** Ceiling height over (x, z); NaN outside every sector, Infinity when there is none. */
  ceilAt(x: number, z: number): number;
  /** Wall segments within about `r` of (x, z) that block a body whose feet are at `feetY`. */
  blockingNear(x: number, z: number, r: number, feetY: number): readonly WallSeg[];
}

const NO_SEGS: readonly WallSeg[] = [];

export const FLAT_GROUND: LevelGround = {
  floorAt: () => 0,
  ceilAt: () => Infinity,
  blockingNear: () => NO_SEGS,
};

/** Where feet placed at (x, z) stand: the floor there, or 0 outside every sector (every
 *  teleport and pose seam uses this, so room levels still place at y = 0). */
export function standingFloor(g: LevelGround, x: number, z: number): number {
  const f = g.floorAt(x, z);
  return Number.isFinite(f) ? f : 0;
}
