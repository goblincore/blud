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
//
// DEVIATION FROM THE PLAN (2026-09-02, dispatch task 1): the plan's verbatim
// vertex = mean of edge crossings FAILED the BAND COVERAGE test at 6.0%
// (limit 1%). Cause: anisotropic prim scales make mapBody under-report Euclid
// distance by the group distortion factor (march.wgsl.ts ~1690; zombie torso
// ~1.64x, deep smin fillets worse — measured directional derivative ~0.3 in
// the groin/ankle blends), so the field=band iso sits up to band*distort from
// the flesh and a 2*band walk cannot reach it. Even a curved 8-substep
// gradient walk fails 3.4%. Fix: after the mean-of-crossings vertex, Newton
// walk it INWARD along the gradient to field = VERT_PULL_TARGET * band
// (measured: 0.6 passes at 0.48% fails, max vertex move 1.6 cells, all
// vertices still at field > 0 — outside the flesh, hull still conservative).
// The WGSL kernel must transliterate this pull too.
import type { Vec3 } from '../types';

/** Fine cells per block edge. The kernel's workgroup is [BLOCK, BLOCK, BLOCK]. */
export const BLOCK = 4;
/** Sentinel in the cell->vertex grid: this cell owns no vertex. */
export const NO_VERT = 0xffffffff;
/** cellEdge bits. Edge e leaves corner 0 along +axis. */
export const EDGE_X_CROSS = 1, EDGE_X_IN2OUT = 2;
export const EDGE_Y_CROSS = 4, EDGE_Y_IN2OUT = 8;
export const EDGE_Z_CROSS = 16, EDGE_Z_IN2OUT = 32;

/** Sub-iso vertex pull target, as a fraction of band (header deviation note).
 *  Shared with the WGSL kernel — change both in the same commit. */
export const VERT_PULL_TARGET = 0.6;
/** Max Newton iterations for the pull. */
export const VERT_PULL_ITERS = 10;

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

export interface HullSoup {
  /** Triangle soup, 3 floats per vertex, world space. */
  positions: Float32Array;
  vertCount: number;
  /** One position per surface cell (the quad corners), for tests/parity. */
  cellPositions: Float32Array;
  cellVerts: number;
  blocksLive: number;
  blocksTotal: number;
  /** Quads whose four cells were not all surface cells (must be 0). */
  droppedQuads: number;
  overflow: boolean;
  cellKind(i: number, j: number, k: number): 'surface' | 'interior' | 'exterior' | 'skipped';
}

export function gradientOf(field: (p: Vec3) => number, p: Vec3, h: number): Vec3 {
  const g: [number, number, number] = [
    field([p[0] + h, p[1], p[2]]) - field([p[0] - h, p[1], p[2]]),
    field([p[0], p[1] + h, p[2]]) - field([p[0], p[1] - h, p[2]]),
    field([p[0], p[1], p[2] + h]) - field([p[0], p[1], p[2] - h]),
  ];
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

/** The 12 cube edges as corner-index pairs; corner bit order = x | y<<1 | z<<2. */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],   // along x
  [0, 2], [1, 3], [4, 6], [5, 7],   // along y
  [0, 4], [1, 5], [2, 6], [3, 7],   // along z
];

/**
 * Sparse surface nets over the band-shifted field. Two passes, exactly as the
 * kernels do it: (1) per live block, per cell: vertex + edge bits; dead
 * blocks write edge bits 0. (2) per cell with edge bits: one quad per
 * crossing +axis edge, linking the four cells around that edge.
 */
export function extractHullSoup(
  field: (p: Vec3) => number, grid: HullGrid, band: number, distort: number,
  maxCellVerts = 65536,
): HullSoup {
  const g = (p: Vec3) => field(p) - band;
  const [nx, ny, nz] = grid.dims;
  const cellCount = nx * ny * nz;
  const cellVert = new Uint32Array(cellCount).fill(NO_VERT);
  const cellEdge = new Uint8Array(cellCount);
  const kind = new Uint8Array(cellCount); // 0 skipped, 1 exterior, 2 interior, 3 surface
  const cellPositions = new Float32Array(maxCellVerts * 3);
  let cellVerts = 0;
  let overflow = false;

  // Corner cache: corners are shared by 8 cells; evaluate each once.
  const cx = nx + 1, cy = ny + 1;
  const corner = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(NaN);
  const cornerVal = (i: number, j: number, k: number) => {
    const idx = (k * cy + j) * cx + i;
    let v = corner[idx]!;
    if (Number.isNaN(v)) { v = g(cornerPos(grid, i, j, k)); corner[idx] = v; }
    return v;
  };
  const cellIndex = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const blocks: [number, number, number] = [nx / BLOCK, ny / BLOCK, nz / BLOCK];
  let blocksLive = 0;
  const blocksTotal = blocks[0] * blocks[1] * blocks[2];

  // ---- pass 1: vertices + edge bits -------------------------------------
  for (let bz = 0; bz < blocks[2]; bz++) for (let by = 0; by < blocks[1]; by++) for (let bx = 0; bx < blocks[0]; bx++) {
    const live = blockLive(g, grid, [bx, by, bz], distort);
    if (live) blocksLive++;
    for (let lk = 0; lk < BLOCK; lk++) for (let lj = 0; lj < BLOCK; lj++) for (let li = 0; li < BLOCK; li++) {
      const i = bx * BLOCK + li, j = by * BLOCK + lj, k = bz * BLOCK + lk;
      const ci = cellIndex(i, j, k);
      if (!live) { cellEdge[ci] = 0; cellVert[ci] = NO_VERT; kind[ci] = 0; continue; }
      const v = [
        cornerVal(i, j, k),         cornerVal(i + 1, j, k),
        cornerVal(i, j + 1, k),     cornerVal(i + 1, j + 1, k),
        cornerVal(i, j, k + 1),     cornerVal(i + 1, j, k + 1),
        cornerVal(i, j + 1, k + 1), cornerVal(i + 1, j + 1, k + 1),
      ];
      let neg = 0;
      for (let c = 0; c < 8; c++) if (v[c]! < 0) neg |= 1 << c;
      let bits = 0;
      if (((neg >> 0) & 1) !== ((neg >> 1) & 1)) bits |= EDGE_X_CROSS | (v[0]! < 0 ? EDGE_X_IN2OUT : 0);
      if (((neg >> 0) & 1) !== ((neg >> 2) & 1)) bits |= EDGE_Y_CROSS | (v[0]! < 0 ? EDGE_Y_IN2OUT : 0);
      if (((neg >> 0) & 1) !== ((neg >> 4) & 1)) bits |= EDGE_Z_CROSS | (v[0]! < 0 ? EDGE_Z_IN2OUT : 0);
      cellEdge[ci] = bits;
      if (neg === 0 || neg === 0xff) {
        cellVert[ci] = NO_VERT; kind[ci] = neg === 0 ? 1 : 2; continue;
      }
      // mean of edge crossings
      let sx = 0, sy = 0, sz = 0, n = 0;
      const base = cornerPos(grid, i, j, k);
      for (const [a, b] of EDGES) {
        const va = v[a]!, vb = v[b]!;
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
        const bxx = b & 1, byy = (b >> 1) & 1, bzz = (b >> 2) & 1;
        sx += ax + (bxx - ax) * t; sy += ay + (byy - ay) * t; sz += az + (bzz - az) * t; n++;
      }
      if (cellVerts >= maxCellVerts) { overflow = true; cellVert[ci] = NO_VERT; kind[ci] = 3; continue; }
      const id = cellVerts++;
      // Sub-iso pull: see the header deviation note. Newton steps of the
      // field's own value (sphere-tracing style, so compressed regions
      // under-step, never overshoot past the target), capped at half a cell
      // per step. Vertices never cross the flesh: the loop stops with
      // field >= VERT_PULL_TARGET * band > 0.
      let p: Vec3 = [
        base[0] + (sx / n) * grid.cell,
        base[1] + (sy / n) * grid.cell,
        base[2] + (sz / n) * grid.cell,
      ];
      for (let it = 0; it < VERT_PULL_ITERS; it++) {
        const fp = field(p);
        const err = fp - band * VERT_PULL_TARGET;
        if (err <= 1e-4) break;
        const dir = gradientOf(field, p, 1e-3);
        const step = Math.min(err, grid.cell / 2);
        p = [p[0] - dir[0] * step, p[1] - dir[1] * step, p[2] - dir[2] * step];
      }
      cellPositions[id * 3] = p[0];
      cellPositions[id * 3 + 1] = p[1];
      cellPositions[id * 3 + 2] = p[2];
      cellVert[ci] = id; kind[ci] = 3;
    }
  }

  // ---- pass 2: quads ---------------------------------------------------------
  // Around the +x edge of cell (i,j,k) sit cells (i,j,k) (i,j-1,k) (i,j-1,k-1)
  // (i,j,k-1); that cyclic order has normal +x (right-hand, y toward z).
  // Cyclic symmetry gives y: (k,i) and z: (i,j) orderings.
  const positions = new Float32Array(maxCellVerts * 3 * 6 * 3);
  let vertCount = 0;
  let droppedQuads = 0;
  const pushV = (id: number) => {
    positions[vertCount * 3] = cellPositions[id * 3]!;
    positions[vertCount * 3 + 1] = cellPositions[id * 3 + 1]!;
    positions[vertCount * 3 + 2] = cellPositions[id * 3 + 2]!;
    vertCount++;
  };
  const emitQuad = (q: [number, number, number, number], flip: boolean) => {
    const [a, b, c, d] = flip ? [q[0], q[3], q[2], q[1]] : q;
    pushV(a); pushV(b); pushV(c);
    pushV(a); pushV(c); pushV(d);
  };
  const vertAt = (i: number, j: number, k: number) =>
    (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? NO_VERT : cellVert[cellIndex(i, j, k)]!;

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const bits = cellEdge[cellIndex(i, j, k)]!;
    if (bits === 0) continue;
    if (bits & EDGE_X_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i, j - 1, k), vertAt(i, j - 1, k - 1), vertAt(i, j, k - 1)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_X_IN2OUT) === 0);
    }
    if (bits & EDGE_Y_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i, j, k - 1), vertAt(i - 1, j, k - 1), vertAt(i - 1, j, k)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_Y_IN2OUT) === 0);
    }
    if (bits & EDGE_Z_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i - 1, j, k), vertAt(i - 1, j - 1, k), vertAt(i, j - 1, k)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_Z_IN2OUT) === 0);
    }
  }

  return {
    positions: positions.subarray(0, vertCount * 3),
    vertCount,
    cellPositions: cellPositions.subarray(0, cellVerts * 3),
    cellVerts, blocksLive, blocksTotal, droppedQuads, overflow,
    cellKind(i, j, k) {
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 'skipped';
      return (['skipped', 'exterior', 'interior', 'surface'] as const)[kind[cellIndex(i, j, k)]!]!;
    },
  };
}
