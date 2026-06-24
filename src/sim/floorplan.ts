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

// ─── corridor carving + connectivity ───────────────────────────────────────────

const EXTRA_LOOPS = 2;

function roomCenter(r: Room): Cell { return { cx: r.cx + (r.w >> 1), cz: r.cz + (r.h >> 1) }; }

/** Carve an L-shaped, 1-cell-wide corridor between two room centers. */
function carveCorridor(open: Uint8Array, gridW: number, a: Cell, b: Cell): void {
  let x = a.cx, z = a.cz;
  while (x !== b.cx) { open[cellIndex(gridW, x, z)] = 1; x += x < b.cx ? 1 : -1; }
  while (z !== b.cz) { open[cellIndex(gridW, x, z)] = 1; z += z < b.cz ? 1 : -1; }
  open[cellIndex(gridW, x, z)] = 1;
}

function connectRooms(rng: SimRng, open: Uint8Array, rooms: Room[]): void {
  if (rooms.length < 2) return;
  const centers = rooms.map(roomCenter);
  const dist2 = (a: number, b: number): number => {
    const dx = centers[a]!.cx - centers[b]!.cx, dz = centers[a]!.cz - centers[b]!.cz;
    return dx * dx + dz * dz;
  };
  // Prim-like MST from room 0 (the arena) → spanning tree guarantees reachability.
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let best = -1, from = -1, bestD = Infinity;
    for (const c of connected) {
      for (let r = 0; r < rooms.length; r++) {
        if (connected.has(r)) continue;
        const d = dist2(c, r);
        if (d < bestD) { bestD = d; best = r; from = c; }
      }
    }
    if (best < 0) break;
    carveCorridor(open, GRID_W, centers[from]!, centers[best]!);
    connected.add(best);
  }
  // A few extra loop edges for flanking (Blood maps are looped, not tree-like — spec §5.1).
  for (let e = 0; e < EXTRA_LOOPS && rooms.length > 2; e++) {
    const a = randomInt(rng, rooms.length);
    const b = randomInt(rng, rooms.length);
    if (a !== b) carveCorridor(open, GRID_W, centers[a]!, centers[b]!);
  }
}

// ─── player start + enemy spawns ──────────────────────────────────────────────

const ARENA_SPAWNS = 5;
const ROOM_SPAWNS_MAX = 3; // 0..2

/** Blood facing angle (0..2047) that points from cell A toward cell B. */
function bloodAngleToward(from: Cell, to: Cell): number {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const theta = Math.atan2(-dx, -dz); // facing (-sinθ,-cosθ) ∝ (dx,dz)
  return Math.round((((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2)) % 2048;
}

function chooseStart(rooms: Room[]): { cell: Cell; angBlood: number; roomId: number } {
  const ac = roomCenter(rooms[0]!);
  let startRoom = 0, far = -1;
  for (let r = 1; r < rooms.length; r++) {
    const c = roomCenter(rooms[r]!);
    const d = (c.cx - ac.cx) ** 2 + (c.cz - ac.cz) ** 2;
    if (d > far) { far = d; startRoom = r; }
  }
  const sc = roomCenter(rooms[startRoom]!);
  return { cell: sc, angBlood: bloodAngleToward(sc, ac), roomId: startRoom };
}

function placeSpawns(rng: SimRng, rooms: Room[], startRoomId: number): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (const r of rooms) {
    if (r.id === startRoomId) continue; // keep the player's start room clear
    const n = r.kind === 'arena' ? ARENA_SPAWNS : randomInt(rng, ROOM_SPAWNS_MAX);
    for (let i = 0; i < n; i++) {
      const cx = r.cx + 1 + randomInt(rng, Math.max(1, r.w - 2));
      const cz = r.cz + 1 + randomInt(rng, Math.max(1, r.h - 2));
      spawns.push({ cell: { cx, cz }, roomId: r.id });
    }
  }
  return spawns;
}

/** Synthesize a single-floor map from a seed. Pure: same seed → identical grid
 *  and room list. Room 0 is always the guaranteed large arena. The RNG stream
 *  is XOR-mixed away from the sim-step stream so map generation and simulation
 *  randomness never desync each other. */
export function generateFloorplan(seed: number): Floorplan {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  const rooms = placeRooms(rng, open);
  connectRooms(rng, open, rooms);
  const start = chooseStart(rooms);
  const spawns = placeSpawns(rng, rooms, start.roomId);
  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms, spawns,
    start: { cell: start.cell, angBlood: start.angBlood },
    arenaRoomId: 0,
  };
}

// ─── wall baking (grid → merged AABBs) ───────────────────────────────────────

/** Axis-aligned rectangle in world meters (XZ footprint). */
export interface MeterRect { minX: number; maxX: number; minZ: number; maxZ: number; }

/** Bake the occupancy grid into merged wall rectangles (world meters). A solid
 *  cell is a wall iff it borders an open cell (4-neighbourhood); consecutive
 *  wall cells in a row are fused into one rect (greedy horizontal merge) to keep
 *  the AABB count low (clip + LOS iterate this set every tic). */
export function bakeWallRectsMeters(fp: Floorplan): MeterRect[] {
  const { open, gridW, gridH, cellMeters } = fp;
  const originX = -(gridW * cellMeters) / 2;
  const originZ = -(gridH * cellMeters) / 2;
  const isOpen = (cx: number, cz: number) =>
    cx >= 0 && cz >= 0 && cx < gridW && cz < gridH && open[cz * gridW + cx] === 1;
  const isWall = (cx: number, cz: number) =>
    open[cz * gridW + cx] === 0 &&
    (isOpen(cx - 1, cz) || isOpen(cx + 1, cz) || isOpen(cx, cz - 1) || isOpen(cx, cz + 1));

  const rects: MeterRect[] = [];
  for (let cz = 0; cz < gridH; cz++) {
    let run = -1;
    for (let cx = 0; cx <= gridW; cx++) {
      const wall = cx < gridW && isWall(cx, cz);
      if (wall && run < 0) run = cx;
      else if (!wall && run >= 0) {
        rects.push({
          minX: originX + run * cellMeters,
          maxX: originX + cx * cellMeters,
          minZ: originZ + cz * cellMeters,
          maxZ: originZ + (cz + 1) * cellMeters,
        });
        run = -1;
      }
    }
  }
  return rects;
}

/** Sim collision geometry (fp units) — the array fed to stepSim/clipMoveXZ/losClear. */
export function bakeSimGeometry(fp: Floorplan): SimAABB[] {
  return bakeWallRectsMeters(fp).map((r) => ({
    minX: fpFromMeters(r.minX), maxX: fpFromMeters(r.maxX),
    minZ: fpFromMeters(r.minZ), maxZ: fpFromMeters(r.maxZ),
  }));
}
