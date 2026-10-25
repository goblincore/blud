// src/lab/sdf-zombie/debris-ground.ts
//
// WHAT LOOSE DEBRIS LANDS ON (plan 2026-10-25-sector-levels-3b): the floor under a piece at its CURRENT x/z and the
// walls it must not pass. Room levels pass nothing, so every stepper keeps its y = 0 plane byte for byte; sector
// levels pass webgpu/sector-debris.ts's implementation. The steppers in this folder import only this file.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from './types';

export interface WallBounce {
  pos: Vec3;
  vel: Vec3;
  /** Unit wall normal in x/z (y 0), pointing back toward where the piece came from. */
  normal: Vec3;
}

export interface DebrisGround {
  /** Floor height under (x, z); NaN off the map (a column hole, the void). */
  floorAt(x: number, z: number): number;
  /** The piece moved prev → next with velocity vel. If that move crossed a sector wall at the start height (a
   *  one-sided line, a riser higher than the piece, a lip lower than it), the piece stops 1 cm short of the wall:
   *  the normal velocity reflects × `restitution`, the tangential keeps × `friction`, y is next's. Null when nothing
   *  was crossed (or prev is off the map: nothing to judge against). */
  bounce(prev: Vec3, next: Vec3, vel: Vec3, restitution: number, friction: number): WallBounce | null;
}

/** The floor a piece at (x, z) lands on: the floor there, or `last` (its previous floor) off the map. */
export function landingFloor(g: DebrisGround, x: number, z: number, last: number): number {
  const f = g.floorAt(x, z);
  return Number.isFinite(f) ? f : last;
}
