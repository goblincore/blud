// src/lab/sdf-zombie/mesher-comparison/field-slice.ts
//
// GROUND-TRUTH cross-sections for the DC chamfer follow-up (2026-09-15).
//
// The point of this module is to stop judging the intended chamfer/groove shape
// by whichever mesher's silhouette looks nicer. It samples the SAME
// `ScalarField` closure the meshers sample, on a dense 2-D slice, and extracts
// the zero set with an explicitly BRACKETED bisection (marching squares finds
// the crossing cell edge, bisection then pins the crossing). The dense field
// contour is the reference; a mesh is only ever sliced for comparison against
// it.
//
// ACCURACY LIMITS (stated so a slice cannot be read as exact):
//   * The field is NOT a Euclidean distance (Blud's composed fields under-report
//     where prims are anisotropic or blends are wide), so the zero set is the
//     only thing this module treats as meaningful; field |values| are residuals.
//   * The contour is a piecewise-LINEAR connection of bisected edge crossings,
//     so between crossings it is a chord. Sub-sample the polygon, not the field.
//   * The reference is only as good as its `resolution`; it is far finer than
//     any tested cell but is still an approximation of the true curve.
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

export interface FieldContour {
  readonly segments: readonly Segment[];
  readonly resolution: number;
  readonly samples: number;
  /** Number of bisection-refined edge crossings (the bracketed zero set). */
  readonly crossings: number;
  /**
   * Crossings the bisection could not drive to |f| < `tol`: the field jumps
   * across zero (e.g. `sdGroove`'s band gate). The LOCATION is still bracketed
   * correctly; only the field value is non-zero there.
   */
  readonly jumpCrossings: number;
  readonly window: SliceWindow;
  /** Max |field| at a refined crossing (metres) — the bracketing quality. */
  readonly maxResidualAtCrossing: number;
}

export function planePoint(plane: SlicePlane, u: number, v: number): Vec3 {
  const p: [number, number, number] = [0, 0, 0];
  p[plane.fixedAxis] = plane.fixedValue;
  p[plane.uAxis] = u;
  p[plane.vAxis] = v;
  return p;
}

/**
 * Bisect a sign change on the segment pa->pb to `tol` in the field value (or
 * `maxIters`), returning the interpolated parameter t in [0,1]. This is the
 * bracketing step: every reported crossing is bracketed by two finite samples
 * of opposite sign.
 */
function bisectT(f: (p: Vec3) => number, pa: Vec3, pb: Vec3, tol: number, maxIters: number): { t: number; fv: number } {
  let da = f(pa), db = f(pb);
  if ((da < 0) === (db < 0)) return { t: 0.5, fv: (da + db) / 2 };
  let lo = 0, hi = 1;
  for (let it = 0; it < maxIters; it++) {
    const t = lo + (hi - lo) * (da / (da - db));
    const m: Vec3 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
    const dm = f(m);
    if (!Number.isFinite(dm)) break;
    if (Math.abs(dm) < tol) return { t, fv: dm };
    if ((dm < 0) === (da < 0)) { lo = t; da = dm; } else { hi = t; db = dm; }
  }
  return { t: lo + (hi - lo) * (da / (da - db)), fv: da };
}

/**
 * Dense marching-squares contour of `field(p) === 0` on the slice. Crossings
 * are refined by bisection to `tol` (default 1e-6 m); `resolution` is the
 * sample spacing. Ambiguous marching-squares cells are resolved by the
 * bilinear centre sign (the standard asymptotic-decider-free rule).
 */
export function fieldContour(
  field: ScalarField, plane: SlicePlane, window: SliceWindow, resolution: number,
  opts: { tol?: number; maxIters?: number } = {},
): FieldContour {
  if (resolution <= 0 || !Number.isFinite(resolution)) throw new Error(`fieldContour: resolution must be finite and positive (got ${resolution})`);
  const tol = opts.tol ?? 1e-6;
  const maxIters = opts.maxIters ?? 60;
  const nu = Math.max(1, Math.ceil((window.uMax - window.uMin) / resolution));
  const nv = Math.max(1, Math.ceil((window.vMax - window.vMin) / resolution));
  const du = (window.uMax - window.uMin) / nu;
  const dv = (window.vMax - window.vMin) / nv;

  const values = new Float64Array((nu + 1) * (nv + 1));
  let samples = 0;
  for (let j = 0; j <= nv; j++) {
    const v = window.vMin + dv * j;
    for (let i = 0; i <= nu; i++) {
      const u = window.uMin + du * i;
      values[j * (nu + 1) + i] = field.field(planePoint(plane, u, v));
      samples++;
    }
  }
  const at = (i: number, j: number): number => values[j * (nu + 1) + i]!;
  const uOf = (i: number): number => window.uMin + du * i;
  const vOf = (j: number): number => window.vMin + dv * j;

  let crossings = 0;
  let jumpCrossings = 0;
  let maxResidualAtCrossing = 0;
  const segments: Segment[] = [];

  const recordCrossing = (fv: number): void => {
    crossings++;
    if (!Number.isFinite(fv)) return;
    maxResidualAtCrossing = Math.max(maxResidualAtCrossing, Math.abs(fv));
    if (Math.abs(fv) > tol) jumpCrossings++;
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
    const r = bisectT(field.field, pa, pb, tol, maxIters);
    recordCrossing(r.fv);
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
    const r = bisectT(field.field, pa, pb, tol, maxIters);
    recordCrossing(r.fv);
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
  return { segments, resolution: Math.min(du, dv), samples, crossings, jumpCrossings, window, maxResidualAtCrossing };
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
