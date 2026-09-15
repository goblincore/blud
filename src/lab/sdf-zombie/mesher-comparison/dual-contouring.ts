// src/lab/sdf-zombie/mesher-comparison/dual-contouring.ts
//
// ALICE-inspired dual contouring. This is a TypeScript PORT of the algorithm
// in ALICE-SDF's `src/mesh/dual_contouring.rs`, adapted to sample a Blud
// `ScalarField` closure. It is NOT a use of the native ALICE runtime (native
// timings are explicitly out of scope), and it does NOT translate Blud models
// into an ALICE SDF tree — the same `field(p)` the other two methods sample is
// the only evaluator here.
//
// ALGORITHM (ported faithfully):
//   1. Sample the field at every grid corner once.
//   2. Per cell with a sign change: for each of the 12 cube edges that
//      changes sign, refine the intersection by an iterative linear
//      (false-position/secant) interpolation — upstream calls it `bisect_edge`.
//      Each intersection's normal is a central difference of the SAME field.
//   3. Solve the regularized QEF  Sum_i (n_i . (x - x_i))^2  by a 3x3
//      Tikhonov-regularized (lambda = 0.01) Cramer solve about the mass point
//      (the centroid of the intersections), then clamp the result into the
//      cell AABB. Singular / non-finite / empty systems fall back to the mass
//      point.
//   4. Connectivity is dual: every grid edge that changes sign contributes one
//      quad over the four cells sharing it, triangulated (see DEPARTURES).
//
// DEPARTURES FROM UPSTREAM (recorded as the task requires):
//   * The upstream X/Y/Z edge loops skip the last grid layer on their own axis
//     (`x < res - 1`, ...). This port generates every grid edge whose four
//     adjacent cells exist. With the mandated one-cell padding the surface is
//     strictly interior, so the extra layer contains no crossings and the
//     outputs are identical; the general form is the standard DC edge loop.
//   * Upstream triangulates a quad by choosing the diagonal whose triangles
//     face the mean vertex normal. That choice is kept, with the (0,2)
//     diagonal winning ties exactly as upstream.
//   * Upstream samples normals through its interpreted/compiled SDF `normal`
//     function. This port always uses a central difference of the shared field
//     closure, so all three methods in the comparison see one evaluator.
//   * Names/memory layout are TypeScript idioms; the math is unchanged.

import { countedField, fitGrid, gridPoint, type GridSpec, type IndexedMesh, type MethodOptions, type ScalarField } from './types';
import { fieldNormal } from './marching-cubes';
import type { Vec3 } from '../types';

/** QEF Tikhonov regularization, matching upstream `solve_3x3_regularized`. */
export const QEF_LAMBDA = 0.01;
export const DC_MAX_VERTS = 4_000_000;

export interface QefHermite {
  readonly points: readonly Vec3[];
  readonly normals: readonly Vec3[];
}

/** Solve a 3x3 system by Cramer's rule; null when (near-)singular. */
export function solve3x3(a: number[][], b: number[]): [number, number, number] | null {
  const det =
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const replace = (col: number): number => {
    const m = a.map(row => row.slice());
    for (let r = 0; r < 3; r++) m[r]![col] = b[r]!;
    return (
      m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
      m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
      m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
    ) * inv;
  };
  const x = replace(0), y = replace(1), z = replace(2);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

/** See `qef_solve` upstream. */
export function qefSolve(
  hermite: QefHermite, cellMin: Vec3, cellMax: Vec3, clamp: boolean,
): { point: Vec3; fellBack: boolean } {
  const n = hermite.points.length;
  if (n === 0) {
    return { point: [(cellMin[0] + cellMax[0]) / 2, (cellMin[1] + cellMax[1]) / 2, (cellMin[2] + cellMax[2]) / 2], fellBack: true };
  }
  const mass: [number, number, number] = [0, 0, 0];
  for (const p of hermite.points) { mass[0] += p[0]; mass[1] += p[1]; mass[2] += p[2]; }
  mass[0] /= n; mass[1] /= n; mass[2] /= n;
  const cellCentre: Vec3 = [(cellMin[0] + cellMax[0]) / 2, (cellMin[1] + cellMax[1]) / 2, (cellMin[2] + cellMax[2]) / 2];
  if (!Number.isFinite(mass[0]) || !Number.isFinite(mass[1]) || !Number.isFinite(mass[2])) {
    return { point: cellCentre, fellBack: true };
  }

  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const nrm = hermite.normals[k]!;
    const pt = hermite.points[k]!;
    const d: Vec3 = [pt[0] - mass[0], pt[1] - mass[1], pt[2] - mass[2]];
    const rhs = nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i]![j] = ata[i]![j]! + nrm[i]! * nrm[j]!;
      atb[i] = atb[i]! + nrm[i]! * rhs;
    }
  }
  for (let i = 0; i < 3; i++) ata[i]![i] = ata[i]![i]! + QEF_LAMBDA;
  const solved = solve3x3(ata, atb);
  const fellBack = solved === null;
  const out: [number, number, number] = solved
    ? [mass[0] + solved[0], mass[1] + solved[1], mass[2] + solved[2]]
    : [mass[0], mass[1], mass[2]];
  if (!Number.isFinite(out[0]) || !Number.isFinite(out[1]) || !Number.isFinite(out[2])) {
    out[0] = cellCentre[0]; out[1] = cellCentre[1]; out[2] = cellCentre[2];
  }
  const point: Vec3 = clamp
    ? [
        Math.min(cellMax[0], Math.max(cellMin[0], out[0])),
        Math.min(cellMax[1], Math.max(cellMin[1], out[1])),
        Math.min(cellMax[2], Math.max(cellMin[2], out[2])),
      ]
    : out;
  return { point, fellBack };
}

/** Averaged unit normal of the Hermite samples; +Y when degenerate. */
function averagedNormal(hermite: QefHermite): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const n of hermite.normals) { x += n[0]; y += n[1]; z += n[2]; }
  const l = Math.hypot(x, y, z);
  if (!(l > 1e-12)) return [0, 1, 0];
  return [x / l, y / l, z / l];
}

const CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];

/** The 12 cube edges as corner index pairs, in the ported corner layout. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** See upstream `bisect_edge`. */
export function refineEdge(
  f: (p: Vec3) => number, pa: Vec3, pb: Vec3, da: number, db: number, iters: number,
): Vec3 {
  let lo: Vec3 = pa, hi: Vec3 = pb, dlo = da, dhi = db;
  for (let it = 0; it < iters; it++) {
    const denom = dlo - dhi;
    const t = denom === 0 ? 0.5 : Math.min(1, Math.max(0, dlo / denom));
    const mid: Vec3 = [
      lo[0] + (hi[0] - lo[0]) * t,
      lo[1] + (hi[1] - lo[1]) * t,
      lo[2] + (hi[2] - lo[2]) * t,
    ];
    const dm = f(mid);
    if (Math.abs(dm) < 1e-6) return mid;
    if ((dlo < 0) === (dm < 0)) { lo = mid; dlo = dm; } else { hi = mid; dhi = dm; }
  }
  const denom = dlo - dhi;
  const t = denom === 0 ? 0.5 : Math.min(1, Math.max(0, dlo / denom));
  return [
    lo[0] + (hi[0] - lo[0]) * t,
    lo[1] + (hi[1] - lo[1]) * t,
    lo[2] + (hi[2] - lo[2]) * t,
  ];
}

/**
 * Run dual contouring over `field.bounds` at `opts.cell`.
 * `opts.bisectionIterations` defaults to 6 (upstream default);
 * `opts.clampToCell` defaults to true (upstream default).
 */
export function dualContouring(fieldIn: ScalarField, opts: MethodOptions): IndexedMesh {
  const { field, count } = countedField(fieldIn);
  const cell = opts.cell;
  const bisectIters = opts.bisectionIterations ?? 6;
  const clamp = opts.clampToCell ?? true;
  const grid = opts.grid ?? fitGrid(field, cell);
  const [nx, ny, nz] = grid.dims;
  const cxm = nx + 1, cym = ny + 1, czm = nz + 1;

  const values = new Float32Array(cxm * cym * czm);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    values[(k * cym + j) * cxm + i] = field.field(gridPoint(grid, i, j, k));
  }

  const cellCount = nx * ny * nz;
  const cellVertex = new Int32Array(cellCount).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  let invalid = false;
  let invalidReason: string | undefined;
  let qefFallbacks = 0;

  const valueAt = (i: number, j: number, k: number): number => values[(k * cym + j) * cxm + i]!;

  for (let cz = 0; cz < nz && !invalid; cz++) {
    for (let cy = 0; cy < ny && !invalid; cy++) {
      for (let cx = 0; cx < nx && !invalid; cx++) {
        const corners: number[] = [];
        let neg0 = false;
        let anyCross = false;
        for (let c = 0; c < 8; c++) {
          const off = CORNER_OFFSETS[c]!;
          const v = valueAt(cx + off[0], cy + off[1], cz + off[2]);
          corners.push(v);
        }
        neg0 = corners[0]! < 0;
        for (let c = 1; c < 8; c++) if ((corners[c]! < 0) !== neg0) { anyCross = true; break; }
        if (!anyCross) continue;

        const pts: Vec3[] = [];
        const nrms: Vec3[] = [];
        for (const [c0, c1] of EDGES) {
          const da = corners[c0]!, db = corners[c1]!;
          if ((da < 0) === (db < 0)) continue;
          const o0 = CORNER_OFFSETS[c0]!, o1 = CORNER_OFFSETS[c1]!;
          const pa = gridPoint(grid, cx + o0[0], cy + o0[1], cz + o0[2]);
          const pb = gridPoint(grid, cx + o1[0], cy + o1[1], cz + o1[2]);
          const hit = refineEdge(field.field, pa, pb, da, db, bisectIters);
          pts.push(hit);
          nrms.push(fieldNormal(field.field, hit, cell * 0.5));
        }
        if (pts.length === 0) continue;

        const cellMin = gridPoint(grid, cx, cy, cz);
        const cellMax = gridPoint(grid, cx + 1, cy + 1, cz + 1);
        const solved = qefSolve({ points: pts, normals: nrms }, cellMin, cellMax, clamp);
        if (solved.fellBack) qefFallbacks++;
        if (positions.length / 3 >= DC_MAX_VERTS) {
          invalid = true; invalidReason = `vertex cap ${DC_MAX_VERTS} exceeded`; break;
        }
        const n = averagedNormal({ points: pts, normals: nrms });
        cellVertex[(cz * ny + cy) * nx + cx] = positions.length / 3;
        positions.push(solved.point[0], solved.point[1], solved.point[2]);
        normals.push(n[0], n[1], n[2]);
      }
    }
  }

  // ---- connectivity: one quad per sign-changing grid edge ----------------
  const indices: number[] = [];
  const vertexFor = (cx: number, cy: number, cz: number): number =>
    cellVertex[(cz * ny + cy) * nx + cx]!;

  const emitQuad = (q: [number, number, number, number]) => {
    const p: [Vec3, Vec3, Vec3, Vec3] = [
      [positions[q[0] * 3]!, positions[q[0] * 3 + 1]!, positions[q[0] * 3 + 2]!],
      [positions[q[1] * 3]!, positions[q[1] * 3 + 1]!, positions[q[1] * 3 + 2]!],
      [positions[q[2] * 3]!, positions[q[2] * 3 + 1]!, positions[q[2] * 3 + 2]!],
      [positions[q[3] * 3]!, positions[q[3] * 3 + 1]!, positions[q[3] * 3 + 2]!],
    ];
    const nRef: [number, number, number] = [
      normals[q[0] * 3]! + normals[q[1] * 3]! + normals[q[2] * 3]! + normals[q[3] * 3]!,
      normals[q[0] * 3 + 1]! + normals[q[1] * 3 + 1]! + normals[q[2] * 3 + 1]! + normals[q[3] * 3 + 1]!,
      normals[q[0] * 3 + 2]! + normals[q[1] * 3 + 2]! + normals[q[2] * 3 + 2]! + normals[q[3] * 3 + 2]!,
    ];
    const facing = (ia: 0 | 1 | 2 | 3, ib: 0 | 1 | 2 | 3, ic: 0 | 1 | 2 | 3): number => {
      const pa = p[ia], pb = p[ib], pc = p[ic];
      const e1: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cr: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      return cr[0] * nRef[0] + cr[1] * nRef[1] + cr[2] * nRef[2];
    };
    const split02 = Math.min(facing(0, 1, 2), facing(0, 2, 3));
    const split13 = Math.min(facing(1, 2, 3), facing(1, 3, 0));
    if (split13 > split02) indices.push(q[1], q[2], q[3], q[1], q[3], q[0]);
    else indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  };

  // X edges: base grid vertex (x,y,z) -> (x+1,y,z); cells (x, y-1|y, z-1|z).
  for (let z = 1; z < nz; z++) for (let y = 1; y < ny; y++) for (let x = 0; x < nx; x++) {
    const d0 = valueAt(x, y, z), d1 = valueAt(x + 1, y, z);
    if ((d0 < 0) === (d1 < 0)) continue;
    const q: [number, number, number, number] = [
      vertexFor(x, y - 1, z - 1), vertexFor(x, y, z - 1), vertexFor(x, y, z), vertexFor(x, y - 1, z),
    ];
    if (q.includes(-1)) continue;
    emitQuad(d0 < 0 ? q : [q[0], q[3], q[2], q[1]]);
  }
  // Y edges: base (x,y,z) -> (x,y+1,z); cells (x-1|x, y, z-1|z).
  for (let z = 1; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 1; x < nx; x++) {
    const d0 = valueAt(x, y, z), d1 = valueAt(x, y + 1, z);
    if ((d0 < 0) === (d1 < 0)) continue;
    const q: [number, number, number, number] = [
      vertexFor(x - 1, y, z - 1), vertexFor(x, y, z - 1), vertexFor(x, y, z), vertexFor(x - 1, y, z),
    ];
    if (q.includes(-1)) continue;
    emitQuad(d0 < 0 ? [q[0], q[3], q[2], q[1]] : q);
  }
  // Z edges: base (x,y,z) -> (x,y,z+1); cells (x-1|x, y-1|y, z).
  for (let z = 0; z < nz; z++) for (let y = 1; y < ny; y++) for (let x = 1; x < nx; x++) {
    const d0 = valueAt(x, y, z), d1 = valueAt(x, y, z + 1);
    if ((d0 < 0) === (d1 < 0)) continue;
    const q: [number, number, number, number] = [
      vertexFor(x - 1, y - 1, z), vertexFor(x, y - 1, z), vertexFor(x, y, z), vertexFor(x - 1, y, z),
    ];
    if (q.includes(-1)) continue;
    emitQuad(d0 < 0 ? q : [q[0], q[3], q[2], q[1]]);
  }

  const vertCount = positions.length / 3;
  if (vertCount === 0) { invalid = true; invalidReason = invalidReason ?? 'empty mesh (no cells crossed)'; }
  else if (indices.length === 0) { invalid = true; invalidReason = invalidReason ?? 'no triangles emitted'; }
  else {
    for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i]!)) { invalid = true; invalidReason = 'non-finite position'; break; }
    if (!invalid) for (let i = 0; i < normals.length; i++) if (!Number.isFinite(normals[i]!)) { invalid = true; invalidReason = 'non-finite normal'; break; }
  }

  return {
    method: 'dual-contouring',
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    fieldEvals: count(),
    grid,
    invalid,
    invalidReason,
    overflow: false,
    dropped: qefFallbacks, // reported as singular-QEF fallbacks, not lost geometry
  };
}
