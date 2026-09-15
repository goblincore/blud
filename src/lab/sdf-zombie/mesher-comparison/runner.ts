// src/lab/sdf-zombie/mesher-comparison/runner.ts
//
// Method dispatch + the shared-grid harness. Every method is run against the
// SAME `ScalarField` closure on the SAME `GridSpec` (identical min, cell and
// dims), so bounds and units cannot drift between rows.

import { fitAlignedGrid, METHOD_IDS, type GridSpec, type IndexedMesh, type MethodId, type MethodOptions, type ScalarField } from './types';
import { marchingCubes } from './marching-cubes';
import { dualContouring } from './dual-contouring';
import { surfaceNets } from './surface-nets-adapter';

/** A method id plus the labelled unpruned surface-nets control. */
export type RunId = MethodId | 'surface-nets-unpruned';

export function gridFor(field: ScalarField, cell: number): GridSpec {
  return fitAlignedGrid(field, cell, 4);
}

export function optionsFor(runId: RunId, cell: number, grid: GridSpec): MethodOptions {
  const base: MethodOptions = { cell, grid };
  switch (runId) {
    // Production settled-chunk bake passes band 0, distort 1
    // (`chunk-bake-geometry.ts`). Do not change this default.
    case 'surface-nets': return { ...base, band: 0, distort: 1 };
    case 'surface-nets-unpruned': return { ...base, band: 0, distort: Infinity };
    case 'marching-cubes': return base;
    case 'dual-contouring': return { ...base, bisectionIterations: 6, clampToCell: true };
  }
}

export function runMesher(runId: RunId, field: ScalarField, opts: MethodOptions): IndexedMesh {
  switch (runId) {
    case 'surface-nets': return surfaceNets(field, opts);
    case 'surface-nets-unpruned': return surfaceNets(field, opts);
    case 'marching-cubes': return marchingCubes(field, opts);
    case 'dual-contouring': return dualContouring(field, opts);
  }
}

export interface RowResult {
  readonly fixture: string;
  readonly cell: number;
  readonly grid: GridSpec;
  readonly meshes: Partial<Record<RunId, IndexedMesh>>;
}

/** One deterministic pass of every requested method over one fixture/cell. */
export function runRow(
  field: ScalarField, cell: number, runIds: readonly RunId[] = METHOD_IDS,
): RowResult {
  const grid = gridFor(field, cell);
  const meshes: Partial<Record<RunId, IndexedMesh>> = {};
  for (const id of runIds) {
    meshes[id] = runMesher(id, field, optionsFor(id, cell, grid));
  }
  return { fixture: field.id, cell, grid, meshes };
}

export interface TimedMesh {
  readonly mesh: IndexedMesh;
  readonly timesMs: number[];
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * Warm up, then run `repeats` measured passes. Method order is rotated by the
 * repeat index so no method is always first (reduces warm-cache order bias).
 */
export function timeMeshers(
  field: ScalarField, cell: number, runIds: readonly RunId[],
  warmups = 1, repeats = 3,
): Record<string, TimedMesh> {
  const grid = gridFor(field, cell);
  const order = [...runIds];
  const out: Record<string, TimedMesh> = {};
  const push = (id: RunId, ms: number, mesh: IndexedMesh) => {
    const rec = out[id];
    if (rec) { (rec.timesMs as number[]).push(ms); (rec as { mesh: IndexedMesh }).mesh = mesh; }
    else out[id] = { mesh, timesMs: [ms], medianMs: ms, minMs: ms, maxMs: ms };
  };
  for (let w = 0; w < warmups; w++) {
    for (const id of order) {
      const opts = optionsFor(id, cell, grid);
      runMesher(id, field, opts);
    }
  }
  for (let r = 0; r < repeats; r++) {
    const rotated = order.map((_, i) => order[(i + r) % order.length]!);
    for (const id of rotated) {
      const opts = optionsFor(id, cell, grid);
      const t0 = performance.now();
      const mesh = runMesher(id, field, opts);
      push(id, performance.now() - t0, mesh);
    }
  }
  for (const id of Object.keys(out)) {
    const rec = out[id]!;
    const sorted = [...rec.timesMs].sort((a, b) => a - b);
    (rec as { medianMs: number }).medianMs = sorted[Math.floor(sorted.length / 2)]!;
    (rec as { minMs: number }).minMs = sorted[0]!;
    (rec as { maxMs: number }).maxMs = sorted[sorted.length - 1]!;
  }
  return out;
}

/** Resolution ladders, coarse -> fine, in metres. */
export const LADDERS: Record<'smoke' | 'bounded' | 'fine', readonly number[]> = {
  smoke: [0.04],
  bounded: [0.02, 0.01, 0.005],
  fine: [0.01, 0.005, 0.0025],
};
