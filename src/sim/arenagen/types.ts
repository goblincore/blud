// src/sim/arenagen/types.ts
// Plain-data types for the greenfield generator. NO engine imports.
import type { Cell, Room, SpawnPoint } from '../floorplan';

export type Ring = 'wall' | 'center' | 'mid' | 'perimeter';
export type CoverHeight = 'low' | 'mid'; // low ≈ 1 m lob-over; mid = sightline breaker

export interface CoverPiece {
  cx: number; cz: number; w: number; h: number; // cells
  height: CoverHeight;
  clusterId: number; // -1 for center-stage pieces
}

/** Open cells behind a cluster (facing away from center) — the clump bait. */
export interface Pocket { clusterId: number; cells: Cell[]; }

export interface GradeReport {
  sightline: number;        // fraction of lane→center pairs with clear LOS
  pocketCount: number;
  pocketCells: number;
  laneConnected: boolean;   // perimeter lane forms one connected circuit
  lowMidRatioOk: boolean;   // 2–4 mid pieces AND low ≥ 2×mid
  centerClean: boolean;     // no mid-height cover in the center stage
  pass: boolean;
}

export interface ArenaProp { cell: Cell; kind: 'rubble' | 'prop'; }

/** Structural superset of Floorplan — assignable wherever a Floorplan is
 *  consumed (runner, bake paths) without an adapter. */
export interface ArenaPlan {
  seed: number;
  gridW: number; gridH: number; cellMeters: number;
  open: Uint8Array;         // 1 = walkable, 0 = solid (walls + ALL cover)
  rooms: Room[];
  spawns: SpawnPoint[];
  start: { cell: Cell; angBlood: number };
  arenaRoomId: number;
  cover: CoverPiece[];
  pockets: Pocket[];
  themeId: string;
  props: ArenaProp[];
  grade: GradeReport;
  attempt: number;          // which retry produced this plan (0-based)
}
