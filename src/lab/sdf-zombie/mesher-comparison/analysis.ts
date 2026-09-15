// src/lab/sdf-zombie/mesher-comparison/analysis.ts
//
// Turns meshes into compact, comparable records: topology, field-projected
// distance, sampled bidirectional distance to a fine reference, and thin/
// sharp-feature presence regions.
//
// Reference policy (stated so results cannot overclaim):
//   * `normalizedResidual` = |field(v)| / |grad field(v)| is the PRIMARY
//     geometric number. It needs only the field and the mesh, so it cannot
//     favour any mesher. It is a first-order estimate.
//   * `reference` = sampled bidirectional point-to-triangle distance against a
//     fine reference mesh built with marching cubes at `cell/2`, CAPPED at
//     5 mm. It is APPROXIMATE and is never called Hausdorff distance. When the
//     tested cell is already 5 mm the reference would not be finer, so it is
//     omitted and reported as "not established" rather than faked.
//   * `mutual` = pairwise sampled bidirectional distances among the three
//     methods at the SAME cell; useful for "where do they disagree" and for
//     detecting a feature one method dropped (low coverage).

import { marchingCubes } from './marching-cubes';
import { bidirectionalDistance, computeMeshStats, sampleSurfacePoints, TriBvh, vertexToMeshDistance, type BidirectionalResult, type DistStats, type MeshStats } from './metrics';
import { distStats } from './metrics';
import { gridFor, type RunId } from './runner';
import type { GridSpec, IndexedMesh, ScalarField } from './types';
import type { Vec3 } from '../types';

export interface FeatureRegion {
  readonly name: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly note: string;
}

/**
 * Feature-presence boxes, in the fixture's world frame. These are not
 * "quality" boxes; they exist so a mesh that DELETED an ear/crease/crater
 * cannot pass by having a low aggregate error.
 */
export const FEATURE_REGIONS: Record<string, readonly FeatureRegion[]> = {
  'control-sphere': [],
  'control-sharp-box': [
    { name: 'corner-+++', min: [0.09, 0.09, 0.09], max: [0.17, 0.17, 0.17], note: 'near-razor box corner' },
    { name: 'face-+x', min: [0.14, -0.04, -0.04], max: [0.17, 0.04, 0.04], note: 'flat face patch' },
  ],
  'chamfer-groove': [
    { name: 'chamfer-seam', min: [-0.02, -0.1, -0.16], max: [0.06, 0.12, 0.16], note: 'sminChamfer crease between the lobes' },
    { name: 'groove-channel', min: [-0.16, -0.04, -0.03], max: [0.16, 0.09, 0.03], note: 'sdGroove channel band' },
  ],
  'character-head': [
    { name: 'ear-l', min: [0.06, 1.23, -0.08], max: [0.21, 1.41, 0.06], note: 'thin goblin ear (+x), ~16 mm thick' },
    { name: 'ear-r', min: [-0.21, 1.23, -0.08], max: [-0.06, 1.41, 0.06], note: 'thin goblin ear (-x)' },
    { name: 'mouth-groove', min: [-0.06, 1.08, 0.03], max: [0.06, 1.18, 0.12], note: 'blob groove prim mouth line' },
  ],
  'torn-chunk': [
    { name: 'crater-rim', min: [0.05, -0.07, -0.07], max: [0.13, 0.07, 0.07], note: 'open torn-end crater' },
  ],
};

export interface SharpProbe {
  readonly name: string;
  readonly point: Vec3;
  readonly note: string;
}

/** Designated sharp creases/corners; the nearest mesh vertex is measured. */
export const SHARP_PROBES: Record<string, readonly SharpProbe[]> = {
  'control-sharp-box': [
    { name: 'corner-+++', point: [0.15, 0.15, 0.15], note: 'convex box corner' },
    { name: 'corner-+--', point: [0.15, -0.15, -0.15], note: 'convex box corner' },
    { name: 'corner--+-', point: [-0.15, 0.15, -0.15], note: 'convex box corner' },
    { name: 'corner---+', point: [-0.15, -0.15, 0.15], note: 'convex box corner' },
  ],
};

export interface SharpProbeResult {
  readonly name: string;
  readonly point: Vec3;
  /** Headline: nearest distance to the mesh TRIANGLE SURFACE (mm when printed). */
  readonly minSurfaceDistance: number;
  /** Secondary, vertex-only proximity; biased by each mesher's vertex layout. */
  readonly minVertexDistance: number;
  readonly note: string;
}

export interface FeaturePresence {
  readonly region: FeatureRegion;
  /** Mesh vertices inside the box. */
  readonly meshVerts: number;
  /** Reference vertices inside the box that have a mesh point within tol. */
  readonly referenceCovered: number;
  readonly referenceTotal: number;
  readonly coverage: number;
}

export interface ReferenceRecord {
  readonly method: string;
  readonly cell: number;
  readonly aToB: DistStats;
  readonly bToA: DistStats;
  readonly coverageAinB: number;
  readonly coverageBinA: number;
  readonly samples: number;
  readonly tolerance: number;
  /** Bias note, so the number cannot be read as neutral ground truth. */
  readonly caveat: string;
}

export interface MethodAnalysis {
  readonly run: RunId;
  readonly method: string;
  readonly invalid: boolean;
  readonly invalidReason?: string;
  readonly overflow: boolean;
  /**
   * True only when this row may be ranked/compared/exported as a success.
   * False for invalid meshes: their reference/feature/probe metrics are not
   * computed and the CLI must not write them as geometry.
   */
  readonly rankable: boolean;
  /** DROPPED GEOMETRY (unconnected intended surface); not benign fallbacks. */
  readonly droppedCells: number;
  /** Benign finite fallbacks (e.g. singular QEF -> mass point). Diagnostics only. */
  readonly fallbacks: number;
  readonly cell: number;
  readonly grid: readonly [number, number, number];
  readonly verts: number;
  readonly tris: number;
  readonly fieldEvals: number;
  readonly topology: MeshStats;
  /** |field(v)| — a residual, not a geometric error. */
  readonly fieldResidual: DistStats;
  /** |field(v)| / |grad| — primary first-order geometric estimate. */
  readonly normalizedResidual: DistStats;
  /**
   * |field| sampled at TRIANGLE SURFACE points (vertices + triangle
   * centroids). For `exactDistance` fixtures this is an actual distance at
   * those samples; otherwise it is a residual and NOT millimetres of error.
   */
  readonly surfaceResidual: DistStats;
  /** True when surfaceResidual is an exact distance (analytic controls only). */
  readonly surfaceSampleExact: boolean;
  /** Exact only when the fixture is analytic; else identical caveat to normalized. */
  readonly exactDistance: boolean;
  /** Vertices further than 10% of the cell from the field zero set (gradient projection). */
  readonly verticesOffSurface: number;
  readonly reference: ReferenceRecord | null;
  readonly features: readonly FeaturePresence[];
  readonly sharpProbes: readonly SharpProbeResult[];
  readonly timingsMs: readonly number[];
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

export interface AnalysisOptions {
  /** Dilate the feature boxes so a coarse cell is not counted as missing. */
  readonly featureDilationCells?: number;
  /** Tolerance as a multiple of cell for coverage. */
  readonly coverageTolCells?: number;
  /** Reference cell cap. Reference is skipped unless cell/2 >= this. */
  readonly maxReferenceCell?: number;
  /** Random seed for sampling. */
  readonly seed?: number;
}

const inside = (p: Vec3, b: { min: Vec3; max: Vec3 }): boolean =>
  p[0] >= b.min[0] && p[0] <= b.max[0] &&
  p[1] >= b.min[1] && p[1] <= b.max[1] &&
  p[2] >= b.min[2] && p[2] <= b.max[2];

export function featurePresence(
  fixtureId: string, mesh: IndexedMesh, reference: IndexedMesh | null, cell: number, opts: AnalysisOptions,
): FeaturePresence[] {
  const regions = FEATURE_REGIONS[fixtureId] ?? [];
  if (regions.length === 0) return [];
  const dil = cell * (opts.featureDilationCells ?? 0.5);
  const tol = cell * (opts.coverageTolCells ?? 1.0);
  const refBvh = reference ? new TriBvh(reference) : null;
  const meshBvh = new TriBvh(mesh);
  const out: FeaturePresence[] = [];
  for (const region of regions) {
    const b = { min: region.min, max: region.max };
    let meshVerts = 0;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      if (inside([mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!], b)) meshVerts++;
    }
    let referenceTotal = 0, referenceCovered = 0;
    if (reference) {
      const bd = {
        min: [region.min[0] - dil, region.min[1] - dil, region.min[2] - dil] as Vec3,
        max: [region.max[0] + dil, region.max[1] + dil, region.max[2] + dil] as Vec3,
      };
      for (let i = 0; i < reference.positions.length / 3; i++) {
        const p: Vec3 = [reference.positions[i * 3]!, reference.positions[i * 3 + 1]!, reference.positions[i * 3 + 2]!];
        if (!inside(p, bd)) continue;
        referenceTotal++;
        if (refBvh && meshBvh && Math.sqrt(meshBvh.nearestDist2(p)) <= tol) referenceCovered++;
      }
    }
    out.push({
      region, meshVerts, referenceCovered, referenceTotal,
      coverage: referenceTotal ? referenceCovered / referenceTotal : NaN,
    });
  }
  return out;
}

export function buildReferenceMesh(field: ScalarField, cell: number, maxReferenceCell = 0.005): { mesh: IndexedMesh; cell: number } | null {
  const refCell = Math.max(cell / 2, maxReferenceCell);
  if (refCell >= cell) return null; // would not be finer than the tested mesh
  const grid = gridFor(field, refCell);
  const mesh = marchingCubes(field, { cell: refCell, grid });
  if (mesh.invalid) return null;
  return { mesh, cell: refCell };
}

export function analyzeMesh(
  runId: RunId, mesh: IndexedMesh, field: ScalarField, fixtureId: string,
  timing: { timesMs: readonly number[]; medianMs: number; minMs: number; maxMs: number },
  reference: { mesh: IndexedMesh; cell: number } | null,
  opts: AnalysisOptions = {},
): MethodAnalysis {
  const stats = computeMeshStats(mesh, { field, grid: mesh.grid });
  const cell = mesh.grid?.cell ?? 0;
  const tol = cell * (opts.coverageTolCells ?? 1.0);
  const rankable = !mesh.invalid;

  // Reference distance, only when the reference is genuinely finer. Skipped
  // entirely for an invalid mesh: a fabricated/truncated output must not be
  // compared or ranked as if it were a real surface.
  let reference2: ReferenceRecord | null = null;
  if (rankable && reference && reference.cell < cell) {
    const r = bidirectionalDistance(mesh, reference.mesh, 4000, tol, opts.seed ?? 4242);
    reference2 = {
      method: reference.mesh.method, cell: reference.cell,
      aToB: r.aToB, bToA: r.bToA,
      coverageAinB: r.coverageAinB, coverageBinA: r.coverageBinA,
      samples: r.sampleCount, tolerance: r.tolerance,
      caveat: 'sampled bidirectional point-to-triangle distance; reference is marching cubes at cell/2 (capped at 5 mm) and is itself approximate. Not Hausdorff. Reference resolution differs per ladder step, so matched-ERROR cost is NOT established.',
    };
  }

  // Vertices off the field zero set by more than 10% of a cell, using the
  // gradient-normalised residual (first-order distance).
  const h = Math.max(cell, 0.001) * 0.5;
  let off = 0;
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const v: Vec3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
    const fv = field.field(v);
    const gx = field.field([v[0] + h, v[1], v[2]]) - field.field([v[0] - h, v[1], v[2]]);
    const gy = field.field([v[0], v[1] + h, v[2]]) - field.field([v[0], v[1] - h, v[2]]);
    const gz = field.field([v[0], v[1], v[2] + h]) - field.field([v[0], v[1], v[2] - h]);
    const gl = Math.hypot(gx, gy, gz) / (2 * h);
    const d = gl > 1e-9 ? Math.abs(fv) / gl : Math.abs(fv);
    if (d > 0.1 * cell) off++;
  }

  return {
    run: runId,
    method: mesh.method,
    invalid: mesh.invalid,
    invalidReason: mesh.invalidReason,
    overflow: mesh.overflow,
    rankable,
    droppedCells: mesh.dropped,
    fallbacks: mesh.fallbacks ?? 0,
    cell: mesh.grid?.cell ?? 0,
    grid: mesh.grid ? [mesh.grid.dims[0], mesh.grid.dims[1], mesh.grid.dims[2]] : [0, 0, 0],
    verts: mesh.positions.length / 3,
    tris: mesh.indices.length / 3,
    fieldEvals: mesh.fieldEvals,
    topology: stats,
    fieldResidual: stats.fieldResidual,
    normalizedResidual: stats.normalizedResidual,
    surfaceResidual: surfaceSampleResidual(mesh, field),
    surfaceSampleExact: field.analyticDistance,
    exactDistance: field.analyticDistance,
    verticesOffSurface: off,
    reference: reference2,
    features: rankable ? featurePresence(fixtureId, mesh, reference?.mesh ?? null, cell, opts) : [],
    sharpProbes: rankable ? sharpProbes(fixtureId, mesh) : [],
    timingsMs: timing.timesMs,
    medianMs: timing.medianMs,
    minMs: timing.minMs,
    maxMs: timing.maxMs,
  };
}

/**
 * |field| sampled at mesh VERTICES and TRIANGLE CENTROIDS. Vertex-only
 * residuals depend on each mesher's vertex distribution (DC concentrates
 * vertices at creases, so its vertex set is not a uniform surface sample),
 * which is exactly why this adds triangle interiors. For `exactDistance`
 * fields the value is the true distance to the analytic surface at those
 * sample points; for Blud-composed fields it is a residual, not millimetres
 * of geometric error.
 */
export function surfaceSampleResidual(mesh: IndexedMesh, field: ScalarField, maxTris = 200_000): DistStats {
  const values: number[] = [];
  const verts = mesh.positions.length / 3;
  for (let i = 0; i < verts; i++) {
    values.push(Math.abs(field.field([mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!])));
  }
  const tris = mesh.indices.length / 3;
  const stride = Math.max(1, Math.ceil(tris / maxTris));
  for (let t = 0; t < tris; t += stride) {
    const a = mesh.indices[t * 3]!, b = mesh.indices[t * 3 + 1]!, c = mesh.indices[t * 3 + 2]!;
    const p: Vec3 = [
      (mesh.positions[a * 3]! + mesh.positions[b * 3]! + mesh.positions[c * 3]!) / 3,
      (mesh.positions[a * 3 + 1]! + mesh.positions[b * 3 + 1]! + mesh.positions[c * 3 + 1]!) / 3,
      (mesh.positions[a * 3 + 2]! + mesh.positions[b * 3 + 2]! + mesh.positions[c * 3 + 2]!) / 3,
    ];
    values.push(Math.abs(field.field(p)));
  }
  return distStats(values);
}

function sharpProbes(fixtureId: string, mesh: IndexedMesh): SharpProbeResult[] {
  const probes = SHARP_PROBES[fixtureId] ?? [];
  if (probes.length === 0) return [];
  const bvh = new TriBvh(mesh);
  return probes.map(p => ({
    name: p.name,
    point: p.point,
    minSurfaceDistance: Math.sqrt(bvh.nearestDist2(p.point)),
    minVertexDistance: minVertexDistanceTo(mesh, p.point),
    note: p.note,
  }));
}

function minVertexDistanceTo(mesh: IndexedMesh, point: Vec3): number {
  let best = Infinity;
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const d = Math.hypot(
      mesh.positions[i * 3]! - point[0],
      mesh.positions[i * 3 + 1]! - point[1],
      mesh.positions[i * 3 + 2]! - point[2],
    );
    if (d < best) best = d;
  }
  return best;
}

export { distStats, sampleSurfacePoints, vertexToMeshDistance };
export type { GridSpec };
