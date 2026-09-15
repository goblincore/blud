// src/lab/sdf-zombie/mesher-comparison/surface-nets-adapter.ts
//
// Baseline adapter for Blud's EXISTING surface-nets extractor.
//
// It calls the untouched production function
// `../webgpu/surface-nets-cpu.ts :: extractHullSoup` with the SAME field
// closure and the SAME grid the experimental meshers get, band 0 and the
// documented settled-chunk distortion (`chunk-bake-geometry.ts` passes
// `band = 0, distort = 1`). The production extractor emits a triangle SOUP
// that repeats each cell vertex once per quad; this adapter welds those
// copies by their exact float position (the same key the production bake uses
// in `bakeChunkGeometry`) so topology metrics see one vertex per cell — as
// they do for the other two methods.
//
// This file changes NOTHING about production behaviour. If a pruned run is
// suspected of culling a surface block, `distort: Infinity` gives a labelled
// UNPRUNED control (see `runComparison`), never a silent baseline change.
//
// NORMALS: production bakes geometry normals with
// `BufferGeometry.computeVertexNormals()`. For cross-method comparability the
// comparison uses central-difference FIELD normals for every method
// (documented in the dev-note), so the
// `normalSource: 'field-gradient'` choice is explicit rather than implied.

import { extractHullSoup, BLOCK } from '../webgpu/surface-nets-cpu';
import { countedField, nonFiniteReason, type GridSpec, type IndexedMesh, type MethodOptions, type ScalarField } from './types';
import { fieldNormal } from './marching-cubes';
import { countBoundaryCrossings } from './metrics';

export interface SurfaceNetsExtra {
  blocksLive: number;
  blocksTotal: number;
  cellVerts: number;
  droppedQuads: number;
  pruned: boolean;
}

export interface SurfaceNetsMesh extends IndexedMesh {
  surfaceNets: SurfaceNetsExtra;
}

/**
 * Weld a triangle soup by exact float position. Surface nets writes each cell
 * vertex verbatim into every quad corner, so an exact triple is the correct
 * identity; the production bake relies on the same fact.
 */
export function weldSoup(
  positions: Float32Array, indices?: Uint32Array,
): { positions: Float32Array; indices: Uint32Array; remap: Int32Array } {
  const vertCount = positions.length / 3;
  const out: number[] = [];
  const remap = new Int32Array(vertCount).fill(-1);
  const key = new Map<string, number>();
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
    const k = `${x},${y},${z}`;
    let id = key.get(k);
    if (id === undefined) { id = out.length / 3; key.set(k, id); out.push(x, y, z); }
    remap[i] = id;
  }
  const idx = indices ?? defaultSoupIndices(vertCount);
  const welded = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) welded[i] = remap[idx[i]!]!;
  return { positions: new Float32Array(out), indices: welded, remap };
}

const defaultSoupIndices = (vertCount: number): Uint32Array => {
  const idx = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) idx[i] = i;
  return idx;
};

/**
 * A memory-safe upper bound on surface cells: six box faces of surface at the
 * grid's cell size, plus headroom. Far above the true count for a closed blob
 * (the surface is smaller than the box) but bounded, so a mis-sized fixture
 * fails loudly instead of allocating gigabytes.
 */
export function estimateCellVertexCap(grid: GridSpec): number {
  const a = grid.dims[0] * grid.cell, b = grid.dims[1] * grid.cell, c = grid.dims[2] * grid.cell;
  const area = 2 * (a * b + b * c + a * c);
  const est = Math.ceil(area / (grid.cell * grid.cell)) + 8192;
  return Math.min(Math.max(est, 65536), 2_000_000);
}

/**
 * Per-field memo for the boundary-crossing probe. It is only needed to
 * classify surface-nets drops on a CLIPPED domain, so it runs at most once
 * per (field, grid) instead of once per timed repeat.
 */
const boundaryCrossingCache = new WeakMap<ScalarField, { sig: string; value: number }>();

function cachedBoundaryCrossings(field: ScalarField, grid: GridSpec): number {
  const sig = `${grid.min.join(',')}|${grid.cell}|${grid.dims.join('x')}`;
  const hit = boundaryCrossingCache.get(field);
  if (hit && hit.sig === sig) return hit.value;
  const value = countBoundaryCrossings(field, grid);
  boundaryCrossingCache.set(field, { sig, value });
  return value;
}

export function surfaceNets(fieldIn: ScalarField, opts: MethodOptions): SurfaceNetsMesh {
  const tracked = countedField(fieldIn);
  const { field, count } = tracked;
  const cell = opts.cell;
  const band = opts.band ?? 0;
  const distort = opts.distort ?? 1;
  const grid: GridSpec = opts.grid ?? {
    min: fieldIn.bounds.min,
    cell,
    dims: [
      Math.max(BLOCK, Math.ceil((fieldIn.bounds.max[0] - fieldIn.bounds.min[0]) / cell / BLOCK) * BLOCK),
      Math.max(BLOCK, Math.ceil((fieldIn.bounds.max[1] - fieldIn.bounds.min[1]) / cell / BLOCK) * BLOCK),
      Math.max(BLOCK, Math.ceil((fieldIn.bounds.max[2] - fieldIn.bounds.min[2]) / cell / BLOCK) * BLOCK),
    ],
  };
  const soup = extractHullSoup(p => field.field(p), {
    min: [grid.min[0], grid.min[1], grid.min[2]],
    cell: grid.cell,
    dims: [grid.dims[0], grid.dims[1], grid.dims[2]],
    clamped: false,
  }, band, distort, opts.maxCellVerts ?? estimateCellVertexCap(grid));

  const welded = weldSoup(soup.positions);
  const vertCount = welded.positions.length / 3;
  const normals = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const n = fieldNormal(field.field, [welded.positions[i * 3]!, welded.positions[i * 3 + 1]!, welded.positions[i * 3 + 2]!], cell * 0.5);
    normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2];
  }

  let invalid = false;
  let invalidReason: string | undefined;
  const nonFinite = nonFiniteReason(tracked);
  // Does the fixture's own surface intersect the extraction-domain boundary?
  // If so the domain deliberately CLIPS the solid (e.g. the character-head
  // neck cut) and surface nets cannot connect quads across that clip; those
  // drops are a fixture property, not a mesher defect. A closed, interior
  // surface (boundaryCrossings === 0) must have zero drops. Skipped entirely
  // when there are no drops, so it cannot inflate the timed hot path.
  const boundaryCrossings = soup.droppedQuads > 0 ? cachedBoundaryCrossings(fieldIn, grid) : 0;
  const droppedAtBoundary = boundaryCrossings > 0 ? soup.droppedQuads : 0;
  if (nonFinite) {
    invalid = true; invalidReason = nonFinite;
  } else if (vertCount === 0 || welded.indices.length === 0) {
    invalid = true; invalidReason = 'empty surface-nets output';
  } else if (soup.overflow) {
    invalid = true; invalidReason = 'cell-vertex table overflow';
  } else if (soup.droppedQuads > droppedAtBoundary) {
    // Closed/interior surface, or drops beyond what the clip can explain:
    // a quad over a sign-changing cell edge with a missing interior vertex is
    // an internal omission and must not rank as a success.
    const interior = soup.droppedQuads - droppedAtBoundary;
    invalid = true;
    invalidReason = interior > 0
      ? `surface nets dropped ${interior} interior quad(s) with no cell vertex (internal omission)`
      : `surface nets dropped ${soup.droppedQuads} quad(s) with no cell vertex (internal omission)`;
  } else {
    for (let i = 0; i < welded.positions.length; i++) {
      if (!Number.isFinite(welded.positions[i]!)) { invalid = true; invalidReason = 'non-finite position'; break; }
    }
  }

  return {
    method: 'surface-nets',
    positions: welded.positions,
    indices: welded.indices,
    normals,
    fieldEvals: count(),
    grid,
    invalid,
    invalidReason,
    overflow: soup.overflow,
    // DROPPED GEOMETRY only; surface nets has no benign fallback counter.
    dropped: soup.droppedQuads,
    fallbacks: 0,
    detail: {
      blocksLive: soup.blocksLive,
      blocksTotal: soup.blocksTotal,
      cellVerts: soup.cellVerts,
      droppedQuads: soup.droppedQuads,
      droppedAtBoundary,
      boundaryCrossings,
      nonFiniteSamples: tracked.nonFinite(),
      distort: Number.isFinite(distort) ? distort : -1,
    },
    surfaceNets: {
      blocksLive: soup.blocksLive,
      blocksTotal: soup.blocksTotal,
      cellVerts: soup.cellVerts,
      droppedQuads: soup.droppedQuads,
      pruned: Number.isFinite(distort),
    },
  };
}
