// src/lab/sdf-zombie/mesher-comparison/types.ts
//
// Shared contracts for the Blobforge mesher comparison (2026-09-15 dispatch
// task 1). This directory is an EXPERIMENT: nothing here is imported by the
// production meshers, the renderer, or the bake pipeline. The shipped
// extractors (`../webgpu/surface-nets-cpu.ts`, `../webgpu/surface-nets-compute.ts`)
// are untouched.
//
// FIELD CONVENTION, fixed for every method in this comparison:
//   * `field(p) < 0` inside, `> 0` outside, exactly 0 on the surface.
//   * Units are METRES; frame is world space.
//   * ALL methods sample the SAME `ScalarField.field` closure. There is no
//     per-method translation of the shape, and no mesher is allowed to
//     substitute an approximating proxy field.
//   * `field` is NOT guaranteed to be a true Euclidean distance. Blud's
//     composed fields under-report distance where prim scales are anisotropic
//     and around smooth-min fillets (see `../webgpu/march-step-soundness.test.ts`
//     and the header of `../webgpu/surface-nets-cpu.ts`). For that reason
//     `|field(v)|` is reported as a FIELD RESIDUAL, never as a millimetre
//     geometric error. Geometric error is measured against an independent
//     reference where one exists (see metrics.ts).

import type { Vec3 } from '../types';

export type MethodId = 'surface-nets' | 'marching-cubes' | 'dual-contouring';

export const METHOD_IDS: readonly MethodId[] = [
  'surface-nets', 'marching-cubes', 'dual-contouring',
];

export interface FieldBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface ScalarField {
  /** Stable fixture id, e.g. `control-sphere`, `zombie-head`. */
  readonly id: string;
  /** Always metres; explicit so a result cannot be silently interpreted as mm. */
  readonly units: 'meters';
  /** Signed field. Negative inside. See the file header. */
  field(p: Vec3): number;
  /**
   * The extraction domain. The intended CLOSED surface must lie strictly
   * inside this box with at least one cell of padding on every side, so a
   * boundary-intersection count is a fixture bug rather than a mesher defect.
   */
  readonly bounds: FieldBounds;
  /**
   * True only for the analytic controls, where `field` IS the exact Euclidean
   * distance to the intended surface (sphere, rounded box). False for every
   * Blud-composed field.
   */
  readonly analyticDistance: boolean;
  /** Deterministic provenance: source file, pose, revision, region, etc. */
  readonly meta: Readonly<Record<string, string | number | boolean | null>>;
}

/** A field wrapper that counts every sample AND every non-finite result. */
export interface CountedField {
  readonly field: ScalarField;
  readonly count: () => number;
  /** Number of field evaluations that returned NaN or ±Infinity. */
  readonly nonFinite: () => number;
  /** First position whose field value was non-finite, or null. */
  readonly firstNonFinite: () => Vec3 | null;
}

export function countedField(field: ScalarField): CountedField {
  let n = 0;
  let bad = 0;
  let firstBad: Vec3 | null = null;
  const wrapped: ScalarField = {
    ...field,
    field(p: Vec3): number {
      n++;
      const v = field.field(p);
      if (!Number.isFinite(v)) {
        bad++;
        if (firstBad === null) firstBad = [p[0], p[1], p[2]];
      }
      return v;
    },
  };
  return { field: wrapped, count: () => n, nonFinite: () => bad, firstNonFinite: () => firstBad };
}

/**
 * Build an invalid-reason string for a run whose shared field returned
 * non-finite samples. Returns undefined when every sample was finite.
 * Centralised so all three methods report the same wording and the first
 * offending position.
 */
export function nonFiniteReason(c: CountedField): string | undefined {
  const n = c.nonFinite();
  if (n === 0) return undefined;
  const p = c.firstNonFinite();
  const at = p ? ` first at [${p.map(v => v.toFixed(4)).join(', ')}]` : '';
  return `non-finite field samples (${n})${at}`;
}

export interface GridSpec {
  readonly min: Vec3;
  readonly cell: number;
  readonly dims: readonly [number, number, number];
}

/**
 * An indexed triangle mesh, the single output shape every method produces.
 * `indices` are triangle triples, wound counter-clockwise as seen from
 * outside (right-hand normal points outward). `normals` are per-vertex
 * normals sampled from the same field (not face normals), when the method
 * produces them.
 */
export interface IndexedMesh {
  readonly method: MethodId;
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  /** Field samples spent producing this mesh (corners + refinement + normals). */
  fieldEvals: number;
  /** Actual grid used; null for methods with no global grid. */
  grid: GridSpec | null;
  /**
   * True when the output must NOT rank as a success: empty, non-finite,
   * truncated, or over a hard cell budget. A method that bails sets this and
   * supplies `invalidReason`.
   */
  invalid: boolean;
  invalidReason?: string;
  /** Fixed-size buffer overflow (surface nets cell-vertex table). */
  overflow: boolean;
  /**
   * Quads/cells of INTENDED surface the method could not connect (surface
   * nets drops, DC missing dual vertices). This is DROPPED GEOMETRY, not a
   * benign fallback: a nonzero value marks the mesh invalid unless the method
   * documents a legitimate cause.
   */
  dropped: number;
  /**
   * Benign per-cell fallbacks that produced FINITE geometry (e.g. a singular
   * QEF falling back to its mass point). Diagnostic only; does NOT invalidate.
   */
  fallbacks?: number;
  /** Method-specific extra counters (block stats, QEF fallbacks, ...). */
  detail?: Readonly<Record<string, number>>;
}

export interface MethodOptions {
  /** Cell size in metres; identical across methods for one comparison row. */
  readonly cell: number;
  /**
   * Explicit shared grid. When present every method samples EXACTLY these
   * corners at the same `cell`, which is how the comparison guarantees
   * identical bounds/resolution (surface nets needs dims that are multiples
   * of its BLOCK, so the harness fits one aligned grid and passes it here).
   */
  readonly grid?: GridSpec;
  /** Surface nets: iso band subtracted from the field. Production bake uses 0. */
  readonly band?: number;
  /**
   * Surface nets: `blockLive` distortion factor. Production settled-chunk
   * bake passes 1 (`chunk-bake-geometry.ts`). A larger value (or Infinity)
   * disables block pruning and is used only for the labelled unpruned control.
   */
  readonly distort?: number;
  /** Dual contouring: bisection/refinement iterations per crossing edge. */
  readonly bisectionIterations?: number;
  /** Dual contouring: clamp the QEF vertex into its cell AABB. Default true. */
  readonly clampToCell?: boolean;
  /**
   * Dual contouring: central-difference step (metres) used for each Hermite
   * sample's normal. Default is `cell * 0.5` (the historical port behaviour).
   * Upstream ALICE-SDF uses a FIXED `0.001 m`; exposing the step lets the
   * experiment separate normal-accuracy from one-vertex-per-cell resolution
   * without changing the default. Non-finite or non-positive values are
   * ignored (the default is used).
   */
  readonly normalEpsilon?: number;
  /**
   * Dual contouring: optional per-crossed-cell diagnostic. Used by the
   * chamfer follow-up to tally QEF clamps/fallbacks INSIDE a region, since
   * aggregate counts alone cannot say whether a clamp sits on the feature
   * being diagnosed. Pure observation; it cannot change the mesh.
   */
  readonly dcCellDiagnostic?: (d: {
    readonly cellMin: Vec3;
    readonly cellMax: Vec3;
    readonly clamped: boolean;
    readonly fellBack: boolean;
    readonly rmsPlaneDistance: number;
  }) => void;
  /**
   * Surface nets: max cells that may own a vertex. Defaults to an area-based
   * estimate (see the adapter); exceeding it flags the mesh invalid rather
   * than silently truncating.
   */
  readonly maxCellVerts?: number;
}

export function fitGrid(field: ScalarField, cell: number): GridSpec {
  const dims: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const span = field.bounds.max[i]! - field.bounds.min[i]!;
    dims[i] = Math.max(1, Math.ceil(span / cell));
  }
  return { min: [field.bounds.min[0], field.bounds.min[1], field.bounds.min[2]], cell, dims };
}

/**
 * A grid over `field.bounds` whose dims are rounded UP to a multiple of
 * `block` (4, the surface-nets workgroup edge). `min` is untouched and the
 * box only grows on the + side, so a field padded by at least one cell keeps
 * its surface strictly interior. All three methods share this grid.
 */
export function fitAlignedGrid(field: ScalarField, cell: number, block = 4): GridSpec {
  const dims: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const span = field.bounds.max[i]! - field.bounds.min[i]!;
    let n = Math.max(1, Math.ceil(span / cell));
    n = Math.ceil(n / block) * block;
    dims[i] = n;
  }
  return { min: [field.bounds.min[0], field.bounds.min[1], field.bounds.min[2]], cell, dims };
}

export function gridPoint(grid: GridSpec, i: number, j: number, k: number): Vec3 {
  return [
    grid.min[0] + i * grid.cell,
    grid.min[1] + j * grid.cell,
    grid.min[2] + k * grid.cell,
  ];
}

export function gridCornerCount(grid: GridSpec): number {
  return (grid.dims[0] + 1) * (grid.dims[1] + 1) * (grid.dims[2] + 1);
}

export function gridCellCount(grid: GridSpec): number {
  return grid.dims[0] * grid.dims[1] * grid.dims[2];
}

/**
 * True only when a mesh may be ranked, compared or exported as a successful
 * run. Invalid meshes (non-finite samples, overflow, dropped geometry, empty
 * output) must still be reported as diagnostics but never as a result.
 */
export function meshRankable(mesh: IndexedMesh): boolean {
  return !mesh.invalid;
}
