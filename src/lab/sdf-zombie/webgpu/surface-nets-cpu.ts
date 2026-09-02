// src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts
//
// CPU REFERENCE for the surface-nets hull extraction (hull-refine spec §4).
// The WGSL kernels in surface-nets.wgsl.ts are a transliteration of this
// file; every constant they share is exported from here and pinned by
// surface-nets.wgsl.test.ts. Change one, change both, in the same commit.
//
// FIELD CONVENTION: field(p) < 0 is inside. The hull is the iso-surface of
// g(p) = field(p) - band, i.e. the flesh inflated outward by `band`, so the
// true surface lies INSIDE the hull and a fragment on the hull reaches it by
// walking inward at most ~2*band (spec §5).
import type { Vec3 } from '../types';

/** Fine cells per block edge. The kernel's workgroup is [BLOCK, BLOCK, BLOCK]. */
export const BLOCK = 4;
/** Sentinel in the cell->vertex grid: this cell owns no vertex. */
export const NO_VERT = 0xffffffff;
/** cellEdge bits. Edge e leaves corner 0 along +axis. */
export const EDGE_X_CROSS = 1, EDGE_X_IN2OUT = 2;
export const EDGE_Y_CROSS = 4, EDGE_Y_IN2OUT = 8;
export const EDGE_Z_CROSS = 16, EDGE_Z_IN2OUT = 32;

export interface HullGrid {
  /** World-space corner (0,0,0). */
  min: [number, number, number];
  cell: number;
  /** Fine cells per axis; each a multiple of BLOCK. */
  dims: [number, number, number];
  /** True when an axis hit maxDim — the hull may be cut off. */
  clamped: boolean;
}

/**
 * Grid that contains the body bounds plus band plus one cell of slack on
 * every side, rounded up to whole blocks and re-centred on `centre`.
 */
export function fitHullGrid(
  centre: Vec3, half: Vec3, cell: number, band: number, maxDim = 160,
): HullGrid {
  const dims: [number, number, number] = [0, 0, 0];
  let clamped = false;
  for (let i = 0; i < 3; i++) {
    const extent = half[i]! * 2 + 2 * (band + cell);
    let n = Math.ceil(extent / cell);
    n = Math.ceil(n / BLOCK) * BLOCK;
    if (n > maxDim) { n = maxDim; clamped = true; }
    dims[i] = Math.max(BLOCK, n);
  }
  const min: [number, number, number] = [
    centre[0] - (dims[0] * cell) / 2,
    centre[1] - (dims[1] * cell) / 2,
    centre[2] - (dims[2] * cell) / 2,
  ];
  return { min, cell, dims, clamped };
}

export function cornerPos(grid: HullGrid, i: number, j: number, k: number): Vec3 {
  return [grid.min[0] + i * grid.cell, grid.min[1] + j * grid.cell, grid.min[2] + k * grid.cell];
}

export function blockCentre(grid: HullGrid, b: readonly [number, number, number]): Vec3 {
  const h = (BLOCK * grid.cell) / 2;
  return [
    grid.min[0] + b[0] * BLOCK * grid.cell + h,
    grid.min[1] + b[1] * BLOCK * grid.cell + h,
    grid.min[2] + b[2] * BLOCK * grid.cell + h,
  ];
}

/**
 * Block-live test (plan deviation 1). `g` is the band-shifted field. A block
 * can contain a zero crossing only if |g(centre)| <= halfDiag, because g is a
 * lower bound on distance to its own zero set in both signs (|g| <= dist,
 * the sphere-tracing property), scaled by the group distortion factor.
 * The +cell margin covers the wound lip, where applyWounds' smax fillet is
 * known to overstate distance (see WOUND_SHADOW's note in march.wgsl.ts).
 */
export function blockLive(
  g: (p: Vec3) => number, grid: HullGrid, b: readonly [number, number, number], distort: number,
): boolean {
  const halfDiag = Math.sqrt(3) * (BLOCK * grid.cell) / 2;
  const v = g(blockCentre(grid, b));
  return Math.abs(v) <= halfDiag * distort + grid.cell;
}
