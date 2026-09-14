// src/lab/sdf-zombie/webgpu/crowd-spawn.ts
//
// Pure spawn-placement math for the crowd bench seam (perf task 7f).
//
// WHY THIS EXISTS. `__sdfGame.spawnDebugCharacter` places each copy at
// `starts[actorsInRoom % starts.length]`, and room 1 has exactly ONE spawn
// point. So a BENCH_CROWD=N prelude stacked all N debug zombies on the same
// metre of floor — for the instanced crowd proxy that is the worst possible
// scene: every pixel of the proxy box folds the union of N coincident bodies
// (8 x ~37 groups in one tile, over the 64-entry cap). The game never
// produces that scene. This module lays copies on a square grid so the bench
// measures bodies-in-a-room, which is what it claims to measure.
//
// Pure data, no three.js, no DOM: the placement is unit-testable and the
// game page and its test agree by construction.

import type { Vec3 } from '../types';

/** An interior ground rectangle in metres (the room's own min/max bounds). */
export interface FloorRect {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** Keep grid points this far inside the floor rectangle, so a body cannot be
 *  clamped onto (or through) a wall. Matches the standoff the encounter
 *  director and the debug teleports already use. */
export const FLOOR_INSET_M = 0.6;

/**
 * Lay `n` copies on a square, row-major grid centred on `p0`, `spacing`
 * metres apart, every point clamped `FLOOR_INSET_M` inside `floor`.
 *
 * - `n <= 0` returns `[]`.
 * - `n === 1` returns `p0` verbatim (no clamp) — a single copy is the caller's
 *   explicit position, and the bench's one-body control must not move.
 * - `y` is always `p0[1]` (the room floor height).
 *
 * `cols = ceil(sqrt(n))`; the grid is centred on `p0` in both axes with
 * `(cols - 1) / 2` and `(rows - 1) / 2` offsets, so the centroid is `p0`.
 */
export function crowdGridPoints(
  p0: readonly [number, number, number],
  n: number,
  spacing: number,
  floor: FloorRect,
): Vec3[] {
  if (n <= 0) return [];
  if (n === 1) return [[p0[0], p0[1], p0[2]]];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const minX = floor.minX + FLOOR_INSET_M;
  const maxX = floor.maxX - FLOOR_INSET_M;
  const minZ = floor.minZ + FLOOR_INSET_M;
  const maxZ = floor.maxZ - FLOOR_INSET_M;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = p0[0] + (col - (cols - 1) / 2) * spacing;
    const z = p0[2] + (row - (rows - 1) / 2) * spacing;
    out.push([
      Math.min(maxX, Math.max(minX, x)),
      p0[1],
      Math.min(maxZ, Math.max(minZ, z)),
    ]);
  }
  return out;
}
