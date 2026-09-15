// src/lab/sdf-zombie/mesher-comparison/field-slice.ts
//
// GROUND-TRUTH cross-sections for the DC chamfer follow-up (2026-09-15).
//
// The point of this module is to stop judging the intended chamfer/groove shape
// by whichever mesher's silhouette looks nicer. It samples the SAME
// `ScalarField` closure the meshers sample, on a dense 2-D slice, and extracts
// the zero set with an explicitly BRACKETED refinement (marching squares finds
// the crossing cell edge; a safeguarded false-position/bisection hybrid then
// pins the crossing). The dense field contour is the reference; a mesh is only
// ever sliced for comparison against it.
//
// BRACKETING GUARANTEES (tightened after review, 2026-09-15):
//   * A reported crossing always lies between two FINITE samples of opposite
//     sign, and refinement continues until the bracket's ACTUAL spatial width
//     is <= `spatialTol`. Value `tol` never terminates refinement: a small
//     residual at one sample does NOT bound the spatial error of an arbitrary
//     field, so treating it as convergence fabricates certainty (a 400 mm
//     location error can sit at |f| ~ 1e-10). The sole non-spatial early exit
//     is an EXACT evaluated zero (`f === 0`), returned as an exact root with a
//     vanishing bracket.
//   * Exhausting `maxIters` before the width target THROWS `FieldContourError`
//     (nonconvergence) rather than silently emitting a crossing that is not
//     spatially pinned.
//   * The reported residual is the field evaluated AT the returned crossing,
//     never a stale bracket-endpoint value.
//   * `maxEndpointJump` is |f(right) - f(left)| of the FINAL opposite-sign
//     bracket samples, never the original grid-edge endpoints. An exact-root
//     termination reports a vanishing jump rather than the initial distance.
//   * A non-finite sample anywhere the reference depends on it (grid node,
//     edge endpoint, refinement point) REJECTS the contour: `fieldContour`
//     throws `FieldContourError` rather than emitting a crossing it cannot
//     vouch for.
//   * `unresolvedCrossings` is deliberately conservative. A crossing whose
//     field value could not be driven below `tol` may be a genuine sign
//     boundary (a discontinuity, where no zero exists) OR a continuous but
//     badly conditioned field. Residual alone does NOT prove a discontinuity;
//     the `sdGroove` rim is established by that operator's band-gate formula
//     plus the one-sided bracket samples recorded here (`maxEndpointJump`).
//
// ACCURACY LIMITS (stated so a slice cannot be read as exact):
//   * The field is NOT a Euclidean distance (Blud's composed fields under-report
//     where prims are anisotropic or blends are wide), so the zero set is the
//     only thing this module treats as meaningful; field |values| are residuals.
//   * The contour is a piecewise-LINEAR connection of refined edge crossings,
//     so between crossings it is a chord. Sub-sample the polygon, not the field.
//   * The reference is only as good as its `resolution`; it is far finer than
//     any tested cell but is still an approximation of the true curve. It is a
//     fixed, documented resolution per evidence run, not an adaptive solver.
//   * A mesh slice cuts triangles with a plane and yields straight segments; it
//     is the mesh's own geometry, not a corrected version of it.

import { marchingCubes } from './marching-cubes';
import type { IndexedMesh, ScalarField } from './types';
import type { Vec3 } from '../types';

export type Axis = 0 | 1 | 2;

/**
 * A 2-D slice: the plane `p[fixedAxis] === fixedValue`, drawn with world
 * `uAxis` as image-X and `vAxis` as image-Y. The three axes must be distinct.
 */
export interface SlicePlane {
  readonly fixedAxis: Axis;
  readonly fixedValue: number;
  readonly uAxis: Axis;
  readonly vAxis: Axis;
}

export interface SliceWindow {
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
}

export interface Segment {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
}

/**
 * Thrown when a non-finite field sample would otherwise be baked into the
 * reference contour. The reference must never accept a NaN/Infinity sample as
 * ground truth, so this is a hard rejection, not a flag.
 */
export class FieldContourError extends Error {
  readonly nonFiniteSamples: number;
  constructor(message: string, nonFiniteSamples = 0) {
    super(message);
    this.name = 'FieldContourError';
    this.nonFiniteSamples = nonFiniteSamples;
  }
}

export interface FieldContour {
  readonly segments: readonly Segment[];
  readonly resolution: number;
  readonly samples: number;
  /** Number of refined edge crossings (the bracketed zero set). */
  readonly crossings: number;
  /** Crossings whose |field| AT THE RETURNED POINT was driven to <= `tol`. */
  readonly resolvedCrossings: number;
  /**
   * Crossings whose |field| at the returned point stayed above `tol`.
   *
   * CONSERVATIVE: this counts an unresolved residual, which may be a true
   * sign-boundary (discontinuity) or a continuous but ill-conditioned field.
   * It is not, on its own, a discontinuity classification. The location is
   * still bracketed to `spatialTol`; only the field value is non-zero there.
   */
  readonly unresolvedCrossings: number;
  readonly window: SliceWindow;
  /** Max |field| AT the returned crossing (metres) — the residual quality. */
  readonly maxResidualAtCrossing: number;
  /**
   * Max |f(right) - f(left)| of the FINAL opposite-sign bracket samples at a
   * crossing (every crossing, resolved or not) — not the initial grid-edge
   * endpoints. A large finite jump across a spatially pinned (~`spatialTol`)
   * bracket is the one-sided evidence that the crossing sits on a sign
   * boundary rather than a plain zero; it is recorded alongside the operator's
   * own formula, never used as the sole proof of discontinuity.
   */
  readonly maxEndpointJump: number;
  /** Target upper bound on a crossing bracket's width, in metres. */
  readonly spatialTol: number;
  /** Largest bracket width actually achieved at a crossing, in metres. */
  readonly maxBracketWidth: number;
}

export function planePoint(plane: SlicePlane, u: number, v: number): Vec3 {
  const p: [number, number, number] = [0, 0, 0];
  p[plane.fixedAxis] = plane.fixedValue;
  p[plane.uAxis] = u;
  p[plane.vAxis] = v;
  return p;
}

interface CrossingRefinement {
  /** Parameter in [0,1] along pa->pb of the returned crossing. */
  readonly t: number;
  /** Field AT the returned point; never a stale bracket-endpoint value. */
  readonly fv: number;
  /** Final bracket width in metres (`(hi-lo) * |pb-pa|`); 0 only for an exact root. */
  readonly bracketWidth: number;
  /**
   * |f(hi) - f(lo)| of the FINAL opposite-sign bracket samples. 0 when an
   * exact zero was located (a vanishing bracket has no one-sided jump to report).
   */
  readonly endpointJump: number;
}

/**
 * Refine a bracketed sign change on the segment pa->pb.
 *
 * Safeguarded false-position: a secant step is taken only when it lands in the
 * middle half of the bracket, otherwise a midpoint bisection is forced. Either
 * way the bracket contracts by at least 25% per iteration, so the returned
 * crossing is spatially pinned even when the secant step stalls or the field
 * jumps (a discontinuity).
 *
 * The ONLY stopping condition is the ACTUAL spatial width reaching
 * `spatialTol`; an exact evaluated zero (`f === 0`) short-circuits as an exact
 * root. `tol` does not stop anything — it is applied by the caller to classify
 * the returned residual. Exhausting `maxIters` before the width target throws
 * `FieldContourError` (this function must never claim a spatial guarantee it
 * did not reach).
 *
 * Returns null (never a fabricated crossing) when an endpoint is non-finite,
 * the segment is not sign-bracketed, or a refinement sample is non-finite.
 */
function refineCrossing(
  f: (p: Vec3) => number, pa: Vec3, pb: Vec3,
  spatialTol: number, maxIters: number,
): CrossingRefinement | null {
  const da = f(pa), db = f(pb);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  // An endpoint that is EXACTLY zero is an exact root, not a bracket collapse.
  if (da === 0) return { t: 0, fv: 0, bracketWidth: 0, endpointJump: 0 };
  if (db === 0) return { t: 1, fv: 0, bracketWidth: 0, endpointJump: 0 };
  if ((da < 0) === (db < 0)) return null;
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  const pointAt = (t: number): Vec3 => [
    pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t,
  ];
  let lo = 0, hi = 1, flo = da, fhi = db;
  let exactT: number | null = null;
  let converged = false;
  for (let it = 0; it < maxIters; it++) {
    const w = hi - lo;
    if (w * len <= spatialTol) { converged = true; break; }
    let t = lo + w * (flo / (flo - fhi)); // false position
    // Forced contraction: reject a secant step in an outer quarter, because it
    // can stall (discontinuity) or creep (badly conditioned) and never pin the
    // crossing. A midpoint step halves the bracket unconditionally.
    if (!Number.isFinite(t) || t <= lo + 0.25 * w || t >= hi - 0.25 * w) t = lo + 0.5 * w;
    const fm = f(pointAt(t));
    if (!Number.isFinite(fm)) return null;
    // Exact zero: a genuine exact root, so stop with a vanishing bracket. This
    // is NOT a value-tolerance stop — `tol` is never consulted here.
    if (fm === 0) { exactT = t; converged = true; break; }
    if ((fm < 0) === (flo < 0)) { lo = t; flo = fm; } else { hi = t; fhi = fm; }
  }
  if (!converged) {
    throw new FieldContourError(
      `fieldContour: crossing refinement exhausted maxIters=${maxIters} before reaching spatialTol=${spatialTol} m; refusing to report an unpinned crossing`,
    );
  }
  // Exact root: report it as exact (residual 0). There is no one-sided jump to
  // measure across a vanishing bracket, so `endpointJump` must not resurrect
  // the original grid-edge distance.
  if (exactT !== null) return { t: exactT, fv: 0, bracketWidth: 0, endpointJump: 0 };
  // The bracket now has width <= spatialTol, so every candidate below lies
  // within the spatial tolerance of the sign boundary. Evaluate the midpoint
  // and return the candidate closest to the zero set, so `fv` is a measurement
  // AT the returned point (not a stale endpoint). The reported jump is between
  // the FINAL bracket samples, which are the actual one-sided values.
  const tm = 0.5 * (lo + hi);
  const fm = f(pointAt(tm));
  if (!Number.isFinite(fm)) return null;
  let bestT = lo, bestF = flo, bestAbs = Math.abs(flo);
  for (const [t, v] of [[hi, fhi], [tm, fm]] as [number, number][]) {
    if (Number.isFinite(v) && Math.abs(v) < bestAbs) { bestAbs = Math.abs(v); bestT = t; bestF = v; }
  }
  return { t: bestT, fv: bestF, bracketWidth: (hi - lo) * len, endpointJump: Math.abs(fhi - flo) };
}

/**
 * Dense marching-squares contour of `field(p) === 0` on the slice. Crossings
 * are refined by safeguarded false-position/bisection until their bracket's
 * ACTUAL width is <= `spatialTol` (default 1e-6 m); `resolution` is the sample
 * spacing and `tol` only classifies the returned residual (`resolvedCrossings`),
 * it never stops refinement. Exhausting `maxIters` before the width target
 * throws `FieldContourError` rather than claiming an unpinned crossing.
 * Ambiguous marching-squares cells are resolved by the bilinear centre sign
 * (the standard asymptotic-decider-free rule).
 */
export function fieldContour(
  field: ScalarField, plane: SlicePlane, window: SliceWindow, resolution: number,
  opts: { tol?: number; spatialTol?: number; maxIters?: number } = {},
): FieldContour {
  if (resolution <= 0 || !Number.isFinite(resolution)) throw new Error(`fieldContour: resolution must be finite and positive (got ${resolution})`);
  const tol = opts.tol ?? 1e-6;
  if (!Number.isFinite(tol) || tol < 0) throw new Error(`fieldContour: tol must be finite and non-negative (got ${tol})`);
  const spatialTol = opts.spatialTol ?? 1e-6;
  if (spatialTol <= 0 || !Number.isFinite(spatialTol)) throw new Error(`fieldContour: spatialTol must be finite and positive (got ${spatialTol})`);
  const maxIters = opts.maxIters ?? 80;
  if (!Number.isInteger(maxIters) || maxIters <= 0) throw new Error(`fieldContour: maxIters must be a positive integer (got ${maxIters})`);
  const nu = Math.max(1, Math.ceil((window.uMax - window.uMin) / resolution));
  const nv = Math.max(1, Math.ceil((window.vMax - window.vMin) / resolution));
  const du = (window.uMax - window.uMin) / nu;
  const dv = (window.vMax - window.vMin) / nv;

  const values = new Float64Array((nu + 1) * (nv + 1));
  let samples = 0;
  let nonFiniteSamples = 0;
  for (let j = 0; j <= nv; j++) {
    const v = window.vMin + dv * j;
    for (let i = 0; i <= nu; i++) {
      const u = window.uMin + du * i;
      const fv = field.field(planePoint(plane, u, v));
      if (!Number.isFinite(fv)) nonFiniteSamples++;
      values[j * (nu + 1) + i] = fv;
      samples++;
    }
  }
  if (nonFiniteSamples > 0) {
    throw new FieldContourError(
      `fieldContour: field returned ${nonFiniteSamples} non-finite sample(s) on the reference grid; refusing to emit ground truth`, nonFiniteSamples,
    );
  }
  const at = (i: number, j: number): number => values[j * (nu + 1) + i]!;
  const uOf = (i: number): number => window.uMin + du * i;
  const vOf = (j: number): number => window.vMin + dv * j;

  let crossings = 0;
  let resolvedCrossings = 0;
  let unresolvedCrossings = 0;
  let maxResidualAtCrossing = 0;
  let maxEndpointJump = 0;
  let maxBracketWidth = 0;
  const segments: Segment[] = [];

  const recordCrossing = (r: CrossingRefinement): void => {
    crossings++;
    maxResidualAtCrossing = Math.max(maxResidualAtCrossing, Math.abs(r.fv));
    maxBracketWidth = Math.max(maxBracketWidth, r.bracketWidth);
    // The one-sided jump is recorded for EVERY crossing, not just unresolved
    // ones: a sign-boundary (sdGroove's gate) can still be spatially resolved
    // to a near-zero value while its two bracket samples differ by the whole
    // gate jump. The jump plus the operator's formula is the discontinuity
    // evidence; the residual is a separate, weaker signal.
    maxEndpointJump = Math.max(maxEndpointJump, r.endpointJump);
    if (Math.abs(r.fv) <= tol) {
      resolvedCrossings++;
    } else {
      unresolvedCrossings++;
    }
  };

  // Cache an edge crossing by its lower grid endpoint + orientation (h/v).
  const hCache = new Map<number, [number, number]>();
  const vCache = new Map<number, [number, number]>();
  const hEdge = (i: number, j: number): [number, number] => {
    const key = j * (nu + 1) + i;
    const hit = hCache.get(key);
    if (hit) return hit;
    const pa = planePoint(plane, uOf(i), vOf(j));
    const pb = planePoint(plane, uOf(i + 1), vOf(j));
    const r = refineCrossing(field.field, pa, pb, spatialTol, maxIters);
    if (!r) throw new FieldContourError(`fieldContour: refinement produced a non-finite/invalid crossing on h-edge (${i},${j}); rejecting the reference contour`);
    recordCrossing(r);
    const out: [number, number] = [uOf(i) + du * r.t, vOf(j)];
    hCache.set(key, out);
    return out;
  };
  const vEdge = (i: number, j: number): [number, number] => {
    const key = j * (nu + 1) + i;
    const hit = vCache.get(key);
    if (hit) return hit;
    const pa = planePoint(plane, uOf(i), vOf(j));
    const pb = planePoint(plane, uOf(i), vOf(j + 1));
    const r = refineCrossing(field.field, pa, pb, spatialTol, maxIters);
    if (!r) throw new FieldContourError(`fieldContour: refinement produced a non-finite/invalid crossing on v-edge (${i},${j}); rejecting the reference contour`);
    recordCrossing(r);
    const out: [number, number] = [uOf(i), vOf(j) + dv * r.t];
    vCache.set(key, out);
    return out;
  };

  const push = (a: [number, number], b: [number, number]): void => { segments.push({ a, b }); };

  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const bl = at(i, j) < 0, br = at(i + 1, j) < 0, tr = at(i + 1, j + 1) < 0, tl = at(i, j + 1) < 0;
      const code = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const e0 = (): [number, number] => hEdge(i, j);       // bottom bl-br
      const e1 = (): [number, number] => vEdge(i + 1, j);   // right br-tr
      const e2 = (): [number, number] => hEdge(i, j + 1);   // top tl-tr
      const e3 = (): [number, number] => vEdge(i, j);       // left bl-tl
      const centre = (at(i, j) + at(i + 1, j) + at(i, j + 1) + at(i + 1, j + 1)) / 4 < 0;
      switch (code) {
        case 1: push(e3(), e0()); break;
        case 2: push(e0(), e1()); break;
        case 3: push(e3(), e1()); break;
        case 4: push(e1(), e2()); break;
        case 6: push(e0(), e2()); break;
        case 7: push(e3(), e2()); break;
        case 8: push(e2(), e3()); break;
        case 9: push(e2(), e0()); break;
        case 11: push(e2(), e1()); break;
        case 12: push(e1(), e3()); break;
        case 13: push(e1(), e0()); break;
        case 14: push(e0(), e3()); break;
        case 5: // bl + tr inside
          if (centre) { push(e0(), e1()); push(e2(), e3()); } else { push(e3(), e0()); push(e1(), e2()); }
          break;
        case 10: // br + tl inside
          if (centre) { push(e3(), e0()); push(e1(), e2()); } else { push(e0(), e1()); push(e2(), e3()); }
          break;
      }
    }
  }
  return {
    segments, resolution: Math.min(du, dv), samples,
    crossings, resolvedCrossings, unresolvedCrossings, window,
    maxResidualAtCrossing, maxEndpointJump, spatialTol, maxBracketWidth,
  };
}

/** Intersect one mesh with the slice plane, returning world-space (u,v) segments. */
export function meshSliceSegments(mesh: IndexedMesh, plane: SlicePlane, window?: SliceWindow): Segment[] {
  const out: Segment[] = [];
  const p = mesh.positions;
  const idx = mesh.indices;
  const P = (i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const inWindow = (a: [number, number], b: [number, number]): boolean => {
    if (!window) return true;
    const inU = (x: number): boolean => x >= window.uMin && x <= window.uMax;
    const inV = (y: number): boolean => y >= window.vMin && y <= window.vMax;
    return (inU(a[0]) && inV(a[1])) || (inU(b[0]) && inV(b[1]));
  };
  for (let t = 0; t < idx.length; t += 3) {
    const v: [Vec3, Vec3, Vec3] = [P(idx[t]!), P(idx[t + 1]!), P(idx[t + 2]!)];
    const d: [number, number, number] = [v[0][plane.fixedAxis] - plane.fixedValue, v[1][plane.fixedAxis] - plane.fixedValue, v[2][plane.fixedAxis] - plane.fixedValue];
    const pts: Vec3[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!;
      const da = d[e]!, db = d[(e + 1) % 3]!;
      if ((da < 0) === (db < 0)) continue;
      const s = da / (da - db);
      pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
    }
    if (pts.length < 2) continue;
    // A triangle can produce 3 intersection points when the plane is coplanar
    // with an edge; take the two most distant to make one segment.
    let best = 0, bestD = -1;
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
      const dd = Math.hypot(pts[a]![0] - pts[b]![0], pts[a]![1] - pts[b]![1], pts[a]![2] - pts[b]![2]);
      if (dd > bestD) { bestD = dd; best = a * 10 + b; }
    }
    const ia = Math.floor(best / 10), ib = best % 10;
    if (bestD <= 1e-12) continue;
    const A: [number, number] = [pts[ia]![plane.uAxis]!, pts[ia]![plane.vAxis]!];
    const B: [number, number] = [pts[ib]![plane.uAxis]!, pts[ib]![plane.vAxis]!];
    if (inWindow(A, B)) out.push({ a: A, b: B });
  }
  return out;
}

function pointSegDist2(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + dx * t, qy = a[1] + dy * t;
  return (p[0] - qx) ** 2 + (p[1] - qy) ** 2;
}

/** Nearest segment distance from a 2-D point (brute force; slices are small). */
export function nearestSegmentDistance(p: readonly [number, number], segs: readonly Segment[]): number {
  let best = Infinity;
  for (const s of segs) {
    const d = pointSegDist2(p, s.a, s.b);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Sample points along a segment set at ~`spacing`. */
export function sampleSegments(segs: readonly Segment[], spacing: number, core?: SliceWindow): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segs) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const n = Math.max(1, Math.ceil(len / Math.max(spacing, 1e-9)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p: [number, number] = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      if (core && !(p[0] >= core.uMin && p[0] <= core.uMax && p[1] >= core.vMin && p[1] <= core.vMax)) continue;
      out.push(p);
    }
  }
  return out;
}

export interface SliceDistanceStats {
  readonly samples: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

function stats(values: number[]): SliceDistanceStats {
  if (values.length === 0) return { samples: 0, median: NaN, p95: NaN, max: NaN };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { samples: s.length, median: at(0.5), p95: at(0.95), max: s[s.length - 1]! };
}

/**
 * Symmetric nearest-segment distance between a tested slice and the reference
 * contour, in the slice's own units (metres). This is a 2-D polyline-to-
 * polyline distance on ONE plane; it is a regional diagnostic, not a surface
 * error and not a Hausdorff bound.
 */
export function sliceSymDistance(tested: readonly Segment[], reference: readonly Segment[], spacing: number, core?: SliceWindow): { testedToRef: SliceDistanceStats; refToTested: SliceDistanceStats } {
  const tPts = sampleSegments(tested, spacing, core);
  const rPts = sampleSegments(reference, spacing, core);
  const t2r = tPts.map(p => nearestSegmentDistance(p, reference));
  const r2t = rPts.map(p => nearestSegmentDistance(p, tested));
  return { testedToRef: stats(t2r), refToTested: stats(r2t) };
}

/**
 * A local reference mesh: marching cubes on an explicit fine grid over
 * `region`, independent of the shared comparison grid. Approximate (it is a
 * mesh); use the dense field contour for the cross-section shape.
 */
export function buildLocalReferenceMesh(field: ScalarField, region: { min: Vec3; max: Vec3 }, cell: number): IndexedMesh {
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil((region.max[0] - region.min[0]) / cell)),
    Math.max(1, Math.ceil((region.max[1] - region.min[1]) / cell)),
    Math.max(1, Math.ceil((region.max[2] - region.min[2]) / cell)),
  ];
  return marchingCubes(field, { cell, grid: { min: region.min, cell, dims } });
}
