// src/sim/floorplan.ts
// Determinism firewall: plain data only — NO 'three', NO Rapier, NO src/game/**.
// Imports limited to sibling sim modules.
import { fpFromMeters } from './fp';
import type { SimAABB } from './geometry';

export const CELL_M = 2;    // meters per grid cell
export const GRID_W = 32;   // cells across (→ 64 m)
export const GRID_H = 32;   // cells deep   (→ 64 m)

export type RoomKind = 'arena' | 'room';

export interface Room {
  id: number;
  cx: number; cz: number;   // top-left cell (inclusive)
  w: number; h: number;     // size in cells
  kind: RoomKind;
}

export interface Cell { cx: number; cz: number; }

export interface SpawnPoint { cell: Cell; roomId: number; }

/** A generated single-floor map. Plain serializable data — no engine types.
 *  `open` is a gridW×gridH occupancy grid (1 = walkable floor, 0 = solid). */
export interface Floorplan {
  seed: number;
  gridW: number; gridH: number; cellMeters: number;
  open: Uint8Array;
  rooms: Room[];
  spawns: SpawnPoint[];
  start: { cell: Cell; angBlood: number };
  arenaRoomId: number;
}

/** World-space center of a grid cell, in meters. The grid is centered on the
 *  origin so the generated map drops into the existing (0,0)-centered world. */
export function cellToWorld(fp: Floorplan, cx: number, cz: number): { x: number; z: number } {
  const originX = -(fp.gridW * fp.cellMeters) / 2;
  const originZ = -(fp.gridH * fp.cellMeters) / 2;
  return { x: originX + (cx + 0.5) * fp.cellMeters, z: originZ + (cz + 0.5) * fp.cellMeters };
}
