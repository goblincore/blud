// src/lab/sdf-zombie/mesher-comparison/dc-chamfer.ts
//
// Follow-up (2026-09-15) to the mesher comparison: diagnose the dual-contouring
// chamfer/groove feature. This module owns the GROUND-TRUTH regions for the
// `chamfer-groove` fixture and the measurement harness that compares DC
// variants against the dense field contour, not against a preferred mesher.
//
// GROUND TRUTH, measured from the field (see README of the follow-up note):
//   * `sminChamfer` with `blendK 0.03` has a reach of `4 * 0.03 = 0.12 m`, far
//     larger than the 0.075-0.085 m lobes, so the fold inflates the solid into
//     a broad 45-degree bevel whose top sits near y = +0.14 m (the lobes
//     themselves only reach ~0.085 m).
//   * The groove cutter is a z-aligned capsule at (x=0, y=0.02) with r=0.018,
//     so it is BURIED inside that bevel across the channel's mid-span. Its
//     `sdGroove` band (|b| < width = 11 mm) only reaches the surface near the
//     capsule caps at |z| ~ 0.13 m, where it removes two side lobes and leaves
//     a central pillar. The intended recess is therefore an ANNULAR PIT with a
//     central tab, not a square channel.
//   * `sdGroove`'s band gate makes the groove rim a SIGN BOUNDARY: just outside
//     the band the field equals the body `a` (≈ −14 mm here); just inside it the
//     value is `max(a, min(a + depth, inBand))`, which approaches 0 as the band
//     edge is approached. The field is therefore discontinuous at the gate,
//     yet the boundary is still spatially resolvable: with correct bracketing
//     the refined crossing residual is small (≤0.001 mm at the 0.2 mm
//     reference). The gate's formula plus the one-sided bracket samples
//     (`maxEndpointJump` ≈ 14 mm here) are what establish the discontinuity;
//     the residual is a separate, weaker signal. A crossing is counted as
//     `unresolvedCrossings` only when its returned-point residual exceeds
//     `tol` (e.g. a true hard step with no nearby zero) — never merely because
//     the field jumps. A signed jump is not by itself an irreducible geometric
//     error.
//
// A mesh is only ever SLICED here; the finite-difference-free density and the
// bracketing are the field's, so no mesher's silhouette defines the target.

import { dualContouring } from './dual-contouring';
import { marchingCubes } from './marching-cubes';
import { surfaceNets } from './surface-nets-adapter';
import { fieldContour, meshSliceSegments, sliceSymDistance, type FieldContour, type Segment, type SlicePlane, type SliceWindow } from './field-slice';
import { DC_BASELINE, DC_CANDIDATE, dcOptionsFor, type DcVariant } from './dc-variants';
import { analyzeMesh, buildReferenceMesh, type MethodAnalysis } from './analysis';
import { gridFor } from './runner';
import type { IndexedMesh, ScalarField } from './types';
import type { RunId } from './runner';
import type { Vec3 } from '../types';

export interface SliceRegion {
  readonly id: string;
  readonly label: string;
  readonly plane: SlicePlane;
  /** Sampling window (contains the feature with margin). */
  readonly window: SliceWindow;
  /** Distance metrics are restricted to this inset so a crop edge cannot fake an error. */
  readonly core: SliceWindow;
  readonly note: string;
}

/**
 * The `chamfer-groove` fixture's two real features. `seam` is the flat
 * chamfer bevel at z=0; `notch-*` are the annular groove pits at the capsule
 * caps (the only places the authored groove reaches the surface).
 */
export const CHAMFER_REGIONS: readonly SliceRegion[] = [
  {
    id: 'seam',
    label: 'chamfer bevel, z = 0 (x-y)',
    plane: { fixedAxis: 2, fixedValue: 0, uAxis: 0, vAxis: 1 },
    window: { uMin: -0.09, uMax: 0.15, vMin: 0.08, vMax: 0.17 },
    core: { uMin: -0.07, uMax: 0.13, vMin: 0.10, vMax: 0.16 },
    note: 'sminChamfer flat bevel. Smooth here (the buried cutter does not reach z=0).',
  },
  {
    id: 'notch-plus-z',
    label: 'groove pit, y = 0.02, +z cap (x-z)',
    plane: { fixedAxis: 1, fixedValue: 0.02, uAxis: 0, vAxis: 2 },
    window: { uMin: -0.045, uMax: 0.045, vMin: 0.09, vMax: 0.17 },
    core: { uMin: -0.038, uMax: 0.038, vMin: 0.105, vMax: 0.16 },
    note: 'sdGroove band clipping the +z surface: two side pits with a central pillar. Field rim is discontinuous.',
  },
  {
    id: 'notch-minus-z',
    label: 'groove pit, y = 0.02, -z cap (x-z)',
    plane: { fixedAxis: 1, fixedValue: 0.02, uAxis: 0, vAxis: 2 },
    window: { uMin: -0.045, uMax: 0.045, vMin: -0.17, vMax: -0.09 },
    core: { uMin: -0.038, uMax: 0.038, vMin: -0.16, vMax: -0.105 },
    note: 'Mirror of the +z pit at the other capsule cap.',
  },
];

export interface SliceRegionResult {
  readonly region: SliceRegion;
  /** Dense field contour on this slice — the reference shape. */
  readonly reference: FieldContour;
  /**
   * Bracketed crossings whose field value stayed above the reference `tol`.
   * Conservative: a residual this large is a sign-boundary OR an ill-conditioned
   * continuous field; it is not by itself a discontinuity classification.
   */
  readonly unresolvedCrossings: number;
  readonly testedToRef: { samples: number; median: number; p95: number; max: number };
  readonly refToTested: { samples: number; median: number; p95: number; max: number };
}

export interface VariantMetrics {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly normalEpsilon: number;
  readonly clampToCell: boolean;
  /** The actual mesh, for slicing/rendering/export. Never serialized directly. */
  readonly mesh: IndexedMesh;
  readonly verts: number;
  readonly tris: number;
  readonly topology: MethodAnalysis['topology'];
  readonly normalizedResidual: MethodAnalysis['normalizedResidual'];
  readonly surfaceResidual: MethodAnalysis['surfaceResidual'];
  readonly analysis: MethodAnalysis;
  /** QEF vertex clamps over ALL crossed cells. */
  readonly qefClamped: number;
  readonly qefFallbacks: number;
  readonly qefResidualMean: number;
  readonly qefResidualMax: number;
  /** Clamps whose cell centre falls inside a region core window, per region id. */
  readonly clampedInRegion: Readonly<Record<string, number>>;
  readonly cellsInRegion: Readonly<Record<string, number>>;
  readonly regions: readonly SliceRegionResult[];
}

/** Map a world point onto a region's slice plane (returns null when off-plane). */
function projectToRegion(p: SlicePlane, point: Vec3): { u: number; v: number; off: number } {
  return { u: point[p.uAxis]!, v: point[p.vAxis]!, off: point[p.fixedAxis]! - p.fixedValue };
}

function inCore(core: SliceWindow, u: number, v: number): boolean {
  return u >= core.uMin && u <= core.uMax && v >= core.vMin && v <= core.vMax;
}

/**
 * Evaluate one DC variant on one fixture/cell and slice every region against
 * its dense field contour. `analysis` is the standard comparison record, so
 * global topology/residuals carry the same caveats as the original evidence.
 */
export function evaluateVariant(
  field: ScalarField, fixtureId: string, cell: number, variant: DcVariant,
  references: readonly SliceRegionResult[], spacing?: number,
): VariantMetrics {
  const grid = gridFor(field, cell);
  const clampedInRegion: Record<string, number> = {};
  const cellsInRegion: Record<string, number> = {};
  for (const r of references) { clampedInRegion[r.region.id] = 0; cellsInRegion[r.region.id] = 0; }
  const mesh = dualContouring(field, {
    ...dcOptionsFor(variant, cell, grid),
    dcCellDiagnostic: (d) => {
      const c: Vec3 = [(d.cellMin[0] + d.cellMax[0]) / 2, (d.cellMin[1] + d.cellMax[1]) / 2, (d.cellMin[2] + d.cellMax[2]) / 2];
      for (const r of references) {
        const pr = projectToRegion(r.region.plane, c);
        if (Math.abs(pr.off) > cell * 0.51) continue;
        if (!inCore(r.region.core, pr.u, pr.v)) continue;
        cellsInRegion[r.region.id]!++;
        if (d.clamped) clampedInRegion[r.region.id]!++;
      }
    },
  });
  return finishVariant(field, fixtureId, cell, variant, mesh, references, clampedInRegion, cellsInRegion, spacing);
}

function finishVariant(
  field: ScalarField, fixtureId: string, cell: number, variant: DcVariant,
  mesh: IndexedMesh, references: readonly SliceRegionResult[],
  clampedInRegion: Record<string, number> = {}, cellsInRegion: Record<string, number> = {},
  spacing = Math.min(Math.max(cell * 0.05, 2e-4), 1e-3),
): VariantMetrics {
  const d = mesh.detail ?? {};
  const ref = buildReferenceMesh(field, cell);
  const analysis = analyzeMesh('dual-contouring' as RunId, mesh, field, fixtureId,
    { timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 }, ref);
  const regions = references.map(r => {
    const segs = meshSliceSegments(mesh, r.region.plane, r.region.window);
    const st = sliceSymDistance(segs, r.reference.segments, spacing, r.region.core);
    return {
      region: r.region,
      reference: r.reference,
      unresolvedCrossings: r.unresolvedCrossings,
      testedToRef: st.testedToRef,
      refToTested: st.refToTested,
    };
  });
  return {
    id: variant.id, label: variant.label, note: variant.note,
    normalEpsilon: variant.normalEpsilon(cell) ?? cell * 0.5,
    clampToCell: variant.clampToCell,
    mesh,
    verts: mesh.positions.length / 3, tris: mesh.indices.length / 3,
    topology: analysis.topology,
    normalizedResidual: analysis.normalizedResidual,
    surfaceResidual: analysis.surfaceResidual,
    analysis,
    qefClamped: d.qefClamped ?? 0,
    qefFallbacks: d.qefFallbacks ?? 0,
    qefResidualMean: d.qefResidualMean ?? 0,
    qefResidualMax: d.qefResidualMax ?? 0,
    clampedInRegion, cellsInRegion,
    regions,
  };
}

/**
 * Build the dense field references for every region (region-independent of
 * cell size), plus a local fine reference mesh if a caller wants a 3-D check.
 * `resolution` is the sampling spacing in metres; it must be far finer than
 * the tested cell to be a reference.
 */
export function buildRegionReferences(field: ScalarField, resolution = 0.0002): SliceRegionResult[] {
  return CHAMFER_REGIONS.map(region => {
    const reference = fieldContour(field, region.plane, region.window, resolution);
    return {
      region, reference,
      unresolvedCrossings: reference.unresolvedCrossings,
      testedToRef: { samples: 0, median: NaN, p95: NaN, max: NaN },
      refToTested: { samples: 0, median: NaN, p95: NaN, max: NaN },
    };
  });
}

/** MC / surface-nets context rows in the same shape as a variant (no QEF fields). */
export function evaluateContextMethod(
  field: ScalarField, fixtureId: string, cell: number, method: 'marching-cubes' | 'surface-nets',
  references: readonly SliceRegionResult[], spacing?: number,
): VariantMetrics {
  const grid = gridFor(field, cell);
  const mesh = method === 'marching-cubes'
    ? marchingCubes(field, { cell, grid })
    : surfaceNets(field, { cell, grid, band: 0, distort: 1 });
  const pseudo: DcVariant = {
    id: method, label: method === 'marching-cubes' ? 'marching cubes (context)' : 'surface nets (context)',
    note: 'Context only; no QEF.',
    normalEpsilon: () => 0, clampToCell: false,
  };
  return finishVariant(field, fixtureId, cell, pseudo, mesh, references, {}, {}, spacing);
}

/** Convenience: baseline + candidate + context, one cell. */
export function evaluateChamferCell(
  field: ScalarField, fixtureId: string, cell: number, variants: readonly DcVariant[], references: readonly SliceRegionResult[],
  includeContext = true, spacing?: number,
): VariantMetrics[] {
  const out = variants.map(v => evaluateVariant(field, fixtureId, cell, v, references, spacing));
  if (includeContext) {
    out.push(evaluateContextMethod(field, fixtureId, cell, 'marching-cubes', references, spacing));
    out.push(evaluateContextMethod(field, fixtureId, cell, 'surface-nets', references, spacing));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slice rasteriser (geometry evidence, no shading to hide a defect)
// ---------------------------------------------------------------------------

export interface SliceLayer {
  readonly segments: readonly Segment[];
  /** RGB 0-255. */
  readonly color: readonly [number, number, number];
  /** Draw order: later layers overwrite earlier ones. */
  readonly width?: number;
}

export interface SliceImage {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function drawSeg(rgba: Uint8Array, w: number, h: number, a: [number, number], b: [number, number], color: readonly [number, number, number], thick: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(a[0] + (b[0] - a[0]) * t);
    const y = Math.round(a[1] + (b[1] - a[1]) * t);
    for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const o = (py * w + px) * 4;
      rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = 255;
    }
  }
}

/**
 * Render a region: dark background, reference contour, then each layer. The
 * `core` window is outlined faintly so the metric region is visible and a crop
 * edge cannot be mistaken for a shape.
 */
export function renderSlice(region: SliceRegion, layers: readonly SliceLayer[], width = 480, height = 420, reference?: readonly Segment[]): SliceImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = 22; rgba[i * 4 + 1] = 24; rgba[i * 4 + 2] = 29; rgba[i * 4 + 3] = 255; }
  const win = region.window;
  const toPx = (u: number, v: number): [number, number] => [
    ((u - win.uMin) / (win.uMax - win.uMin)) * (width - 1),
    (1 - (v - win.vMin) / (win.vMax - win.vMin)) * (height - 1),
  ];
  const drawSegments = (segs: readonly Segment[], color: readonly [number, number, number], thick: number): void => {
    for (const s of segs) drawSeg(rgba, width, height, toPx(s.a[0], s.a[1]), toPx(s.b[0], s.b[1]), color, thick);
  };
  // Core rectangle outline.
  const coreC: [number, number, number] = [70, 76, 88];
  const corners: [number, number][] = [[region.core.uMin, region.core.vMin], [region.core.uMax, region.core.vMin], [region.core.uMax, region.core.vMax], [region.core.uMin, region.core.vMax]];
  for (let i = 0; i < 4; i++) drawSeg(rgba, width, height, toPx(corners[i]![0], corners[i]![1]), toPx(corners[(i + 1) % 4]![0], corners[(i + 1) % 4]![1]), coreC, 0);
  if (reference) drawSegments(reference, [225, 225, 232], 0);
  for (const layer of layers) drawSegments(layer.segments, layer.color, layer.width ?? 0);
  return { rgba, width, height };
}

export { DC_BASELINE, DC_CANDIDATE };
