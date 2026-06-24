// src/sim/floorplan.ts
// Determinism firewall: plain data only — NO 'three', NO Rapier, NO src/game/**.
// Imports limited to sibling sim modules.
import { createRng, randomInt, type SimRng } from './rng';
import { fpFromMeters } from './fp';
import type { SimAABB } from './geometry';

export const CELL_M = 2;    // meters per grid cell
export const GRID_W = 28;   // cells across (→ 56 m total, ~52 m open arena)
export const GRID_H = 28;   // cells deep

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

// ─── arena-first generation ───────────────────────────────────────────────────
// Slice-1 feel pivot (2026-06-24): the room-and-corridor dungeon felt worse than
// the original handcrafted arena — narrow 2 m corridors, fragmented space, and a
// "big" room smaller than the 40 m original. Arena-first instead: ONE big open
// arena fills the whole interior, with procedurally scattered cover islands.
// Variety comes from the cover layout, not a room maze. (Satellite alcoves are a
// later iteration once the core open-arena feel is dialed in.)

const COVER_MIN = 5;          // cover islands per map
const COVER_MAX = 9;
const COVER_CELL_MIN = 1;     // cover block size in cells (× CELL_M = 2..6 m)
const COVER_CELL_MAX = 3;
const COVER_SPACING = 2;      // min open cells kept between cover blocks
const SPAWN_CLEAR = 4;        // cells around the player start kept clear of cover
const ENEMY_SPAWNS = 8;

const cellIndex = (gridW: number, cx: number, cz: number) => cz * gridW + cx;

/** Blood facing angle (0..2047) that points from cell A toward cell B. */
function bloodAngleToward(from: Cell, to: Cell): number {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const theta = Math.atan2(-dx, -dz); // facing (-sinθ,-cosθ) ∝ (dx,dz)
  return Math.round((((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2)) % 2048;
}

/** Player start: the midpoint of a random interior edge, facing the arena
 *  centre — you spawn looking into the open space. */
function chooseStart(rng: SimRng): { cell: Cell; angBlood: number } {
  const ccx = GRID_W >> 1, ccz = GRID_H >> 1;
  const edge = randomInt(rng, 4);
  const cell: Cell =
    edge === 0 ? { cx: ccx, cz: 2 } :
    edge === 1 ? { cx: ccx, cz: GRID_H - 3 } :
    edge === 2 ? { cx: 2, cz: ccz } :
                 { cx: GRID_W - 3, cz: ccz };
  return { cell, angBlood: bloodAngleToward(cell, { cx: ccx, cz: ccz }) };
}

/** Scatter solid cover blocks across the open arena — spaced apart and clear of
 *  the player's spawn pocket. Mutates `open` (sets cover cells back to solid). */
function scatterCover(rng: SimRng, open: Uint8Array, start: Cell): void {
  const target = COVER_MIN + randomInt(rng, COVER_MAX - COVER_MIN + 1);
  const placed: Array<{ cx: number; cz: number; w: number; h: number }> = [];
  for (let attempt = 0; placed.length < target && attempt < target * 20; attempt++) {
    const w = COVER_CELL_MIN + randomInt(rng, COVER_CELL_MAX - COVER_CELL_MIN + 1);
    const h = COVER_CELL_MIN + randomInt(rng, COVER_CELL_MAX - COVER_CELL_MIN + 1);
    const cx = 2 + randomInt(rng, GRID_W - 4 - w);
    const cz = 2 + randomInt(rng, GRID_H - 4 - h);
    // keep the spawn pocket clear
    if (Math.abs(cx + w / 2 - (start.cx + 0.5)) < SPAWN_CLEAR &&
        Math.abs(cz + h / 2 - (start.cz + 0.5)) < SPAWN_CLEAR) continue;
    // spacing vs already-placed cover
    let clash = false;
    for (const p of placed) {
      if (cx - COVER_SPACING < p.cx + p.w && cx + w + COVER_SPACING > p.cx &&
          cz - COVER_SPACING < p.cz + p.h && cz + h + COVER_SPACING > p.cz) { clash = true; break; }
    }
    if (clash) continue;
    placed.push({ cx, cz, w, h });
    for (let z = cz; z < cz + h; z++)
      for (let x = cx; x < cx + w; x++) open[cellIndex(GRID_W, x, z)] = 0;
  }
}

/** Scatter enemy spawn points on open floor cells, away from the player start. */
function placeSpawns(rng: SimRng, open: Uint8Array, start: Cell): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (let attempt = 0; spawns.length < ENEMY_SPAWNS && attempt < ENEMY_SPAWNS * 30; attempt++) {
    const cx = 2 + randomInt(rng, GRID_W - 4);
    const cz = 2 + randomInt(rng, GRID_H - 4);
    if (open[cellIndex(GRID_W, cx, cz)] !== 1) continue;                          // open floor only (not cover)
    if (Math.abs(cx - start.cx) + Math.abs(cz - start.cz) < SPAWN_CLEAR + 2) continue; // not on the player
    spawns.push({ cell: { cx, cz }, roomId: 0 });
  }
  return spawns;
}

/** Synthesize a single-floor map: one big open arena filling the interior, with
 *  procedurally scattered cover islands. Pure: same seed → identical grid. The
 *  RNG stream is XOR-mixed away from the sim-step stream so map generation and
 *  simulation randomness never desync each other. */
export function generateFloorplan(seed: number): Floorplan {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  // Open the whole interior; the 1-cell border ring stays solid = arena walls.
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[cellIndex(GRID_W, x, z)] = 1;

  const arena: Room = { id: 0, cx: 1, cz: 1, w: GRID_W - 2, h: GRID_H - 2, kind: 'arena' };
  const start = chooseStart(rng);
  scatterCover(rng, open, start.cell);
  open[cellIndex(GRID_W, start.cell.cx, start.cell.cz)] = 1; // guarantee the start cell is open
  const spawns = placeSpawns(rng, open, start.cell);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms: [arena], spawns,
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

// ─── fingerprint (determinism hook) ───────────────────────────────────────────

/** FNV-1a hash over the occupancy grid + room rects — a stable map fingerprint
 *  for the determinism harness (same seed → same number on every client). */
export function floorplanFingerprint(fp: Floorplan): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; };
  for (let i = 0; i < fp.open.length; i++) mix(fp.open[i]!);
  for (const r of fp.rooms) { mix(r.cx); mix(r.cz); mix(r.w); mix(r.h); mix(r.kind === 'arena' ? 1 : 0); }
  return h >>> 0;
}
