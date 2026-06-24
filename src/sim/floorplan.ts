// src/sim/floorplan.ts
// Determinism firewall: plain data only — NO 'three', NO Rapier, NO src/game/**.
// Imports limited to sibling sim modules.
import { createRng, randomInt, type SimRng } from './rng';
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

// ─── room generation ──────────────────────────────────────────────────────────

const ROOM_ATTEMPTS = 14;
const ROOM_MIN = 3;            // cells
const ROOM_MAX = 7;
const ARENA_MIN = 9;
const ARENA_MAX = 13;

const cellIndex = (gridW: number, cx: number, cz: number) => cz * gridW + cx;

/** Inclusive cell range a room occupies: [cx, cx+w) × [cz, cz+h). */
function carveRoom(open: Uint8Array, gridW: number, r: Room): void {
  for (let z = r.cz; z < r.cz + r.h; z++)
    for (let x = r.cx; x < r.cx + r.w; x++) open[cellIndex(gridW, x, z)] = 1;
}

function placeRooms(rng: SimRng, open: Uint8Array): Room[] {
  const rooms: Room[] = [];
  const lo = 1, hiX = GRID_W - 1, hiZ = GRID_H - 1; // keep a solid border ring

  const fits = (cx: number, cz: number, w: number, h: number): boolean => {
    if (cx < lo || cz < lo || cx + w > hiX || cz + h > hiZ) return false;
    for (const r of rooms) {
      // reject with a 1-cell margin so rooms never touch (walls stay between them)
      if (cx - 1 < r.cx + r.w && cx + w + 1 > r.cx &&
          cz - 1 < r.cz + r.h && cz + h + 1 > r.cz) return false;
    }
    return true;
  };

  const tryPlace = (kind: RoomKind, min: number, max: number, attempts: number): boolean => {
    for (let t = 0; t < attempts; t++) {
      const w = min + randomInt(rng, max - min + 1);
      const h = min + randomInt(rng, max - min + 1);
      const cx = lo + randomInt(rng, Math.max(1, hiX - lo - w + 1));
      const cz = lo + randomInt(rng, Math.max(1, hiZ - lo - h + 1));
      if (fits(cx, cz, w, h)) {
        const r: Room = { id: rooms.length, cx, cz, w, h, kind };
        rooms.push(r); carveRoom(open, GRID_W, r);
        return true;
      }
    }
    return false;
  };

  // 1) the guaranteed large arena (placed first → best chance of fitting)
  if (!tryPlace('arena', ARENA_MIN, ARENA_MAX, 40)) {
    // Fallback: force a centered arena so the invariant "room 0 is the arena" holds.
    const w = ARENA_MIN, h = ARENA_MIN;
    const cx = (GRID_W - w) >> 1, cz = (GRID_H - h) >> 1;
    const r: Room = { id: 0, cx, cz, w, h, kind: 'arena' };
    rooms.push(r); carveRoom(open, GRID_W, r);
  }

  // 2) smaller rooms
  for (let a = 0; a < ROOM_ATTEMPTS; a++) tryPlace('room', ROOM_MIN, ROOM_MAX, 1);

  return rooms;
}

/** Synthesize a single-floor map from a seed. Pure: same seed → identical grid
 *  and room list. Room 0 is always the guaranteed large arena. The RNG stream
 *  is XOR-mixed away from the sim-step stream so map generation and simulation
 *  randomness never desync each other. */
export function generateFloorplan(seed: number): Floorplan {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  const rooms = placeRooms(rng, open);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms, spawns: [],
    start: { cell: { cx: rooms[0]!.cx, cz: rooms[0]!.cz }, angBlood: 0 },
    arenaRoomId: 0,
  };
}
