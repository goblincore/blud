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

/** Wall standoff for an EXPLICIT region. Softer than FLOOR_INSET_M because a
 *  caller-authored region has usually already been inset from the room walls
 *  (the distance bench passes `maxX - 0.5`), while the room path begins at the
 *  raw interior bounds and must make all of the standoff itself. */
export const REGION_INSET_M = 0.5;

/** Options for the region-aware grid. */
export interface GridOpts {
  /** Grid centre in the ground plane. Default: `p0`'s x/z (the room path). */
  centre?: readonly [number, number];
  /** Preferred wall standoff; the grid falls back to the raw `floor` bounds
   *  when `n` cannot fit at this standoff (see the fit rule below). */
  inset?: number;
}

/**
 * Lay `n` copies on a row-major grid, `spacing` metres apart, centred on
 * `opts.centre` (default `p0`) and bounded by `floor`.
 *
 * - `n <= 0` returns `[]`.
 * - `n === 1` returns the centre verbatim (no clamp) — a single copy is the
 *   caller's explicit position, and the bench's one-body control must not move.
 * - `y` is always `p0[1]` (the room floor height).
 *
 * COLS FIT THE REGION. The old `cols = ceil(sqrt(n))` square grid silently
 * clamped an elongated region's outer rows/columns together, putting bodies
 * closer than `spacing` (or on top of each other). The grid now chooses the
 * column count that fits the region's x span, raising it when the region is
 * wide and lowering it when the region is narrow, and never lets `rows` exceed
 * the region's z span. If `n` does not fit at `opts.inset`, the grid is
 * recomputed against the raw `floor` bounds — preserving `spacing` matters more
 * than the extra standoff, and the points still never leave the region.
 */
export function crowdGridPoints(
  p0: readonly [number, number, number],
  n: number,
  spacing: number,
  floor: FloorRect,
  opts: GridOpts = {},
): Vec3[] {
  if (n <= 0) return [];
  const cx = opts.centre ? opts.centre[0] : p0[0];
  const cz = opts.centre ? opts.centre[1] : p0[2];
  if (n === 1) return [[cx, p0[1], cz]];

  // ROOM PATH (no explicit centre): the 7f behaviour, kept bit-for-bit — a
  // sqrt-sized grid clamped onto the inset rect. `p0` is the room's own spawn
  // point and the floor is the room interior, so a too-large grid compresses
  // against the wall standoff exactly as before.
  if (!opts.centre) {
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
      const x = cx + (col - (cols - 1) / 2) * spacing;
      const z = cz + (row - (rows - 1) / 2) * spacing;
      out.push([
        Math.min(maxX, Math.max(minX, x)),
        p0[1],
        Math.min(maxZ, Math.max(minZ, z)),
      ]);
    }
    return out;
  }

  // REGION PATH (explicit centre): fit the requested count inside the region.
  // Preferred standoff first, then the raw region. A grid that fits the inset
  // rect is preferred; one that does not is rebuilt at the region edges rather
  // than clamped into collisions.
  const insets = [opts.inset ?? FLOOR_INSET_M, 0];
  for (const inset of insets) {
    const minX = floor.minX + inset;
    const maxX = floor.maxX - inset;
    const minZ = floor.minZ + inset;
    const maxZ = floor.maxZ - inset;
    const usableX = maxX - minX;
    const usableZ = maxZ - minZ;
    if (usableX < -1e-9 || usableZ < -1e-9) continue;
    const colsMax = Math.max(1, Math.floor(usableX / spacing + 1e-9) + 1);
    const rowsMax = Math.max(1, Math.floor(usableZ / spacing + 1e-9) + 1);
    const colsMin = Math.max(1, Math.ceil(n / rowsMax));
    const cols = Math.min(Math.max(Math.ceil(Math.sqrt(n)), colsMin), colsMax);
    const rows = Math.ceil(n / cols);
    if (cols > colsMax || rows > rowsMax) continue;
    const out: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx + (col - (cols - 1) / 2) * spacing;
      const z = cz + (row - (rows - 1) / 2) * spacing;
      out.push([
        Math.min(maxX, Math.max(minX, x)),
        p0[1],
        Math.min(maxZ, Math.max(minZ, z)),
      ]);
    }
    return out;
  }
  // Degenerate region (smaller than one pitch in both axes at inset 0). Fall
  // back to a single clamped point per body rather than throwing.
  return [[
    Math.min(floor.maxX, Math.max(floor.minX, cx)),
    p0[1],
    Math.min(floor.maxZ, Math.max(floor.minZ, cz)),
  ]];
}
