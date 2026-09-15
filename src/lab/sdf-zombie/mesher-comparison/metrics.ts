// src/lab/sdf-zombie/mesher-comparison/metrics.ts
//
// Topology, field-residual and sampled geometric-distance metrics for the
// mesher comparison.
//
// TWO HONESTY RULES this file enforces:
//
//   1. `|field(v)|` is a FIELD RESIDUAL, not a Euclidean geometric error.
//      Blud fields under-report distance where prims are anisotropic and
//      around smooth-min fillets (`../webgpu/march-step-soundness.test.ts`).
//      `fieldResidual` is labelled as such in every result.
//   2. Sampled bidirectional point-to-triangle distance is APPROXIMATE. It is
//      reported with its sample count and the reference resolution, and it is
//      NEVER called Hausdorff distance. For the analytic controls the field is
//      an exact distance and `|field(v)|` is exact; that is flagged separately.

import { fieldNormal } from './marching-cubes';
import { gridPoint, type GridSpec, type IndexedMesh, type ScalarField } from './types';
import type { Vec3 } from '../types';

export interface DistStats {
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

export interface MeshStats {
  readonly method: string;
  readonly verts: number;
  readonly tris: number;
  readonly boundaryEdges: number;
  readonly nonManifoldEdges: number;
  readonly nonManifoldVertices: number;
  readonly degenerateTris: number;
  readonly duplicateFaces: number;
  readonly connectedComponents: number;
  readonly closed: boolean;
  readonly signedVolume: number;
  readonly orientationFlips: number;
  readonly fieldResidual: DistStats;
  /** Vertices with field < 0 (inside) vs >= 0 (outside the zero set). */
  readonly vertsInsideField: number;
  readonly vertsOutsideField: number;
  /**
   * First-order geometric estimate of each vertex's distance to the field's
   * zero set: |field(v)| / |grad field(v)|. For a true distance field this
   * equals `fieldResidual`; for Blud's compressed fields it corrects the
   * under-report that makes raw |field| a poor geometric number. Still an
   * ESTIMATE (first-order), and reported as such.
   */
  readonly normalizedResidual: DistStats;
  readonly fieldEvalsForResidual: number;
  /** Grid edges crossing the zero on the extraction-domain boundary. */
  readonly boundaryCrossings: number;
  readonly bboxMin: Vec3;
  readonly bboxMax: Vec3;
}

export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function distStats(values: number[]): DistStats {
  if (values.length === 0) return { count: 0, median: NaN, p95: NaN, max: NaN, mean: NaN };
  values.sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  return {
    count: values.length,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values[values.length - 1]!,
    mean: sum / values.length,
  };
}

export function triangleArea(p: Float32Array, i: number, j: number, k: number): number {
  const ax = p[i * 3]!, ay = p[i * 3 + 1]!, az = p[i * 3 + 2]!;
  const bx = p[j * 3]!, by = p[j * 3 + 1]!, bz = p[j * 3 + 2]!;
  const cx = p[k * 3]!, cy = p[k * 3 + 1]!, cz = p[k * 3 + 2]!;
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

/** Signed volume of a closed, outward-wound triangle mesh. NaN when open. */
export function signedVolume(mesh: IndexedMesh): number {
  const p = mesh.positions, idx = mesh.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
    const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function unionFind(parent: Int32Array, x: number): number {
  let r = x;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[x] !== r) { const nx = parent[x]!; parent[x] = r; x = nx; }
  return r;
}

export interface MeshStatsOptions {
  /** Field used for the residual and orientation cross-check. */
  readonly field?: ScalarField;
  /** Grid, for the boundary-crossing probe. */
  readonly grid?: GridSpec | null;
  /** Tolerance for a degenerate triangle as a fraction of cell^2 (default 1e-8). */
  readonly degenerateRel?: number;
}

export function computeMeshStats(mesh: IndexedMesh, opts: MeshStatsOptions = {}): MeshStats {
  const p = mesh.positions, idx = mesh.indices;
  const verts = p.length / 3;
  const tris = idx.length / 3;

  // --- topology: edges / boundary / non-manifold ---
  const edgeUse = new Map<number, number>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * verts + b : b * verts + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgeKey(x, y);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const n of edgeUse.values()) {
    if (n === 1) boundaryEdges++;
    else if (n > 2) nonManifoldEdges++;
  }

  // --- degenerate triangles / duplicate faces ---
  const cell = mesh.grid?.cell ?? 0;
  const areaEps = (cell > 0 ? cell * cell : 1) * (opts.degenerateRel ?? 1e-8);
  let degenerateTris = 0;
  const faceSeen = new Map<string, number>();
  let duplicateFaces = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    if (a === b || b === c || c === a) { degenerateTris++; continue; }
    if (triangleArea(p, a, b, c) <= areaEps) degenerateTris++;
    const key = [a, b, c].sort((x, y) => x - y).join('_');
    const seen = (faceSeen.get(key) ?? 0) + 1;
    faceSeen.set(key, seen);
    if (seen === 2) duplicateFaces++;
  }

  // --- connected components (over triangle vertices) ---
  const parent = new Int32Array(verts);
  for (let i = 0; i < verts; i++) parent[i] = i;
  const used = new Uint8Array(verts);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    used[a] = 1; used[b] = 1; used[c] = 1;
    const ra = unionFind(parent, a), rb = unionFind(parent, b), rc = unionFind(parent, c);
    parent[rb] = ra; parent[rc] = ra;
  }
  const roots = new Set<number>();
  for (let i = 0; i < verts; i++) if (used[i]) roots.add(unionFind(parent, i));
  const connectedComponents = roots.size;

  // --- non-manifold vertices: link graph is not one path/cycle ---
  // For a vertex v, build the LINK graph on its neighbour vertices: each
  // incident triangle (v,a,b) contributes the link edge a-b. The vertex is
  // manifold iff the link graph is CONNECTED and every node has degree 2
  // (interior) or exactly two nodes have degree 1 (boundary). Anything else is
  // two surface sheets pinched at one point.
  const link = new Map<number, Map<number, number[]>>();
  const linkEdge = (v: number, a: number, b: number) => {
    let g = link.get(v);
    if (!g) { g = new Map(); link.set(v, g); }
    const add = (x: number, y: number) => {
      const arr = g!.get(x);
      if (arr) arr.push(y); else g!.set(x, [y]);
    };
    add(a, b); add(b, a);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    linkEdge(a, b, c); linkEdge(b, c, a); linkEdge(c, a, b);
  }
  let nonManifoldVertices = 0;
  for (const g of link.values()) {
    if (g.size === 0) continue;
    let degreeOne = 0;
    let bad = false;
    for (const nbrs of g.values()) {
      const deg = nbrs.length;
      if (deg === 1) degreeOne++;
      else if (deg !== 2) { bad = true; break; }
    }
    if (bad || (degreeOne !== 0 && degreeOne !== 2)) { nonManifoldVertices++; continue; }
    // connectedness of the link graph
    const start = g.keys().next().value as number;
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of g.get(x)!) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    if (seen.size !== g.size) nonManifoldVertices++;
  }

  // --- orientation vs the field normals ---
  let orientationFlips = 0;
  const field = opts.field;
  const nrm = mesh.normals;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
    const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    let nx: number, ny: number, nz: number;
    if (nrm && nrm.length >= (b + 1) * 3) {
      nx = nrm[a * 3]! + nrm[b * 3]! + nrm[c * 3]!;
      ny = nrm[a * 3 + 1]! + nrm[b * 3 + 1]! + nrm[c * 3 + 1]!;
      nz = nrm[a * 3 + 2]! + nrm[b * 3 + 2]! + nrm[c * 3 + 2]!;
    } else if (field) {
      const n = fieldNormal(field.field, [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3], (cell || 0.01) * 0.5);
      nx = n[0]; ny = n[1]; nz = n[2];
    } else { continue; }
    if (gx * nx + gy * ny + gz * nz < 0) orientationFlips++;
  }

  // --- field residual (labelled: NOT geometric error) ---
  let residualFieldEvals = 0;
  const residuals: number[] = [];
  const normalized: number[] = [];
  let vertsInsideField = 0, vertsOutsideField = 0;
  if (field) {
    const h = (cell > 0 ? cell : 0.01) * 0.5;
    for (let i = 0; i < verts; i++) {
      const v: Vec3 = [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
      const fv = field.field(v);
      residuals.push(Math.abs(fv));
      if (fv < 0) vertsInsideField++; else vertsOutsideField++;
      const gx = field.field([v[0] + h, v[1], v[2]]) - field.field([v[0] - h, v[1], v[2]]);
      const gy = field.field([v[0], v[1] + h, v[2]]) - field.field([v[0], v[1] - h, v[2]]);
      const gz = field.field([v[0], v[1], v[2] + h]) - field.field([v[0], v[1], v[2] - h]);
      const gl = Math.hypot(gx, gy, gz) / (2 * h);
      normalized.push(gl > 1e-9 ? Math.abs(fv) / gl : Math.abs(fv));
      residualFieldEvals += 7;
    }
  }

  // --- boundary crossings (fixture/padding sanity, not a mesher defect) ---
  const boundaryCrossings = opts.grid && field ? countBoundaryCrossings(field, opts.grid) : 0;

  const bboxMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const bboxMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts; i++) for (let a = 0; a < 3; a++) {
    bboxMin[a] = Math.min(bboxMin[a]!, p[i * 3 + a]!);
    bboxMax[a] = Math.max(bboxMax[a]!, p[i * 3 + a]!);
  }

  return {
    method: mesh.method,
    verts,
    tris,
    boundaryEdges,
    nonManifoldEdges,
    nonManifoldVertices,
    degenerateTris,
    duplicateFaces,
    connectedComponents,
    closed: boundaryEdges === 0 && verts > 0,
    signedVolume: tris > 0 ? signedVolume(mesh) : NaN,
    orientationFlips,
    fieldResidual: distStats(residuals),
    vertsInsideField,
    vertsOutsideField,
    normalizedResidual: distStats(normalized),
    fieldEvalsForResidual: residualFieldEvals,
    boundaryCrossings,
    bboxMin, bboxMax,
  };
}

/** Count sign changes along the 12 edges of every boundary face of the grid. */
export function countBoundaryCrossings(field: ScalarField, grid: GridSpec): number {
  const [nx, ny, nz] = grid.dims;
  const v = (i: number, j: number, k: number) => field.field(gridPoint(grid, i, j, k));
  let n = 0;
  const edge = (a: number, b: number) => { if ((a < 0) !== (b < 0)) n++; };
  // z = 0 and z = nz faces
  for (const k of [0, nz]) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      edge(v(i, j, k), v(i + 1, j, k));
      edge(v(i, j, k), v(i, j + 1, k));
    }
  }
  // y = 0 and y = ny faces
  for (const j of [0, ny]) {
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      edge(v(i, j, k), v(i + 1, j, k));
      edge(v(i, j, k), v(i, j, k + 1));
    }
  }
  // x = 0 and x = nx faces
  for (const i of [0, nx]) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      edge(v(i, j, k), v(i, j + 1, k));
      edge(v(i, j, k), v(i, j, k + 1));
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Geometric distance: point-to-triangle + a small BVH
// ---------------------------------------------------------------------------

/** Squared distance from p to triangle (a,b,c) — Ericson, Real-Time Collision Detection. */
export function pointTriangleDist2(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const qx = apx - abx * t, qy = apy - aby * t, qz = apz - abz * t;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const qx = apx - acx * t, qy = apy - acy * t, qz = apz - acz * t;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = p[0] - (b[0] + (c[0] - b[0]) * t);
    const qy = p[1] - (b[1] + (c[1] - b[1]) * t);
    const qz = p[2] - (b[2] + (c[2] - b[2]) * t);
    return qx * qx + qy * qy + qz * qz;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = apx - abx * v - acx * w;
  const qy = apy - aby * v - acy * w;
  const qz = apz - abz * v - acz * w;
  return qx * qx + qy * qy + qz * qz;
}

interface BvhNode {
  min: [number, number, number];
  max: [number, number, number];
  left?: BvhNode;
  right?: BvhNode;
  start: number;
  count: number;
}

/** A static BVH over a triangle mesh for nearest-point queries. */
export class TriBvh {
  private readonly pts: Float32Array;
  private readonly idx: Uint32Array;
  private readonly triOrder: Uint32Array;
  private readonly centroids: Float32Array;
  private readonly root: BvhNode;

  constructor(mesh: IndexedMesh) {
    this.pts = mesh.positions;
    this.idx = mesh.indices;
    const tris = mesh.indices.length / 3;
    this.triOrder = new Uint32Array(tris);
    this.centroids = new Float32Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      this.triOrder[t] = t;
      const a = this.idx[t * 3]!, b = this.idx[t * 3 + 1]!, c = this.idx[t * 3 + 2]!;
      for (let d = 0; d < 3; d++) {
        this.centroids[t * 3 + d] = (this.pts[a * 3 + d]! + this.pts[b * 3 + d]! + this.pts[c * 3 + d]!) / 3;
      }
    }
    this.root = this.build(0, tris);
  }

  private triAabb(t: number): [[number, number, number], [number, number, number]] {
    const a = this.idx[t * 3]!, b = this.idx[t * 3 + 1]!, c = this.idx[t * 3 + 2]!;
    const mn: [number, number, number] = [Infinity, Infinity, Infinity];
    const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const v of [a, b, c]) for (let d = 0; d < 3; d++) {
      const x = this.pts[v * 3 + d]!;
      if (x < mn[d]!) mn[d] = x;
      if (x > mx[d]!) mx[d] = x;
    }
    return [mn, mx];
  }

  private build(start: number, count: number): BvhNode {
    const mn: [number, number, number] = [Infinity, Infinity, Infinity];
    const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let cmn: [number, number, number] = [Infinity, Infinity, Infinity];
    let cmx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < start + count; i++) {
      const t = this.triOrder[i]!;
      const [tmn, tmx] = this.triAabb(t);
      for (let d = 0; d < 3; d++) {
        if (tmn[d]! < mn[d]!) mn[d] = tmn[d]!;
        if (tmx[d]! > mx[d]!) mx[d] = tmx[d]!;
        const cc = this.centroids[t * 3 + d]!;
        if (cc < cmn[d]!) cmn[d] = cc;
        if (cc > cmx[d]!) cmx[d] = cc;
      }
    }
    if (count <= 8) return { min: mn, max: mx, start, count };
    const ext: [number, number, number] = [cmx[0] - cmn[0], cmx[1] - cmn[1], cmx[2] - cmn[2]];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : (ext[1]! >= ext[2]! ? 1 : 2);
    const slice = Array.from({ length: count }, (_, i) => this.triOrder[start + i]!);
    slice.sort((a, b) => this.centroids[a * 3 + axis]! - this.centroids[b * 3 + axis]!);
    for (let i = 0; i < count; i++) this.triOrder[start + i] = slice[i]!;
    const half = count >> 1;
    return {
      min: mn, max: mx, start, count: 0,
      left: this.build(start, half),
      right: this.build(start + half, count - half),
    };
  }

  private nodeDist2(p: Vec3, n: BvhNode): number {
    let d2 = 0;
    for (let i = 0; i < 3; i++) {
      const v = p[i]!;
      const lo = n.min[i]!, hi = n.max[i]!;
      if (v < lo) d2 += (lo - v) * (lo - v);
      else if (v > hi) d2 += (v - hi) * (v - hi);
    }
    return d2;
  }

  /** Squared distance from p to the nearest triangle. */
  nearestDist2(p: Vec3): number {
    let best = Infinity;
    const stack: BvhNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (this.nodeDist2(p, n) >= best) continue;
      if (n.left && n.right) { stack.push(n.left, n.right); continue; }
      for (let i = n.start; i < n.start + n.count; i++) {
        const t = this.triOrder[i]!;
        const a = this.idx[t * 3]!, b = this.idx[t * 3 + 1]!, c = this.idx[t * 3 + 2]!;
        const d2 = pointTriangleDist2(
          p,
          [this.pts[a * 3]!, this.pts[a * 3 + 1]!, this.pts[a * 3 + 2]!],
          [this.pts[b * 3]!, this.pts[b * 3 + 1]!, this.pts[b * 3 + 2]!],
          [this.pts[c * 3]!, this.pts[c * 3 + 1]!, this.pts[c * 3 + 2]!],
        );
        if (d2 < best) best = d2;
      }
    }
    return best;
  }
}

/** Deterministic 32-bit LCG so sample sets are reproducible. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

/** Vertices plus face centroids, stride-sampled to at most `max`. */
export function sampleSurfacePoints(mesh: IndexedMesh, max: number, seed = 12345): Vec3[] {
  const verts = mesh.positions.length / 3;
  const tris = mesh.indices.length / 3;
  const pool: Vec3[] = [];
  for (let i = 0; i < verts; i++) pool.push([mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!]);
  for (let t = 0; t < tris; t++) {
    const a = mesh.indices[t * 3]!, b = mesh.indices[t * 3 + 1]!, c = mesh.indices[t * 3 + 2]!;
    pool.push([
      (mesh.positions[a * 3]! + mesh.positions[b * 3]! + mesh.positions[c * 3]!) / 3,
      (mesh.positions[a * 3 + 1]! + mesh.positions[b * 3 + 1]! + mesh.positions[c * 3 + 1]!) / 3,
      (mesh.positions[a * 3 + 2]! + mesh.positions[b * 3 + 2]! + mesh.positions[c * 3 + 2]!) / 3,
    ]);
  }
  if (pool.length <= max) return pool;
  const rand = lcg(seed);
  // Deterministic reservoir sample.
  const out: Vec3[] = pool.slice(0, max);
  for (let i = max; i < pool.length; i++) {
    const j = Math.floor(rand() * (i + 1));
    if (j < max) out[j] = pool[i]!;
  }
  return out;
}

export interface BidirectionalResult {
  readonly aToB: DistStats;
  readonly bToA: DistStats;
  readonly sampleCount: number;
  /** Fraction of A's samples within `tolerance` of B. */
  readonly coverageAinB: number;
  readonly coverageBinA: number;
  readonly tolerance: number;
}

/**
 * Sampled bidirectional point-to-triangle distance between two meshes.
 * APPROXIMATE: it is a sample of surface-to-surface distance, reported with
 * the sample count. NOT Hausdorff distance.
 */
export function bidirectionalDistance(
  a: IndexedMesh, b: IndexedMesh, maxSamples: number, tolerance: number, seed = 9001,
): BidirectionalResult {
  const bvhB = new TriBvh(b);
  const bvhA = new TriBvh(a);
  const ptsA = sampleSurfacePoints(a, maxSamples, seed);
  const ptsB = sampleSurfacePoints(b, maxSamples, seed + 1);
  const da: number[] = [];
  let coverA = 0;
  for (const p of ptsA) { const d = Math.sqrt(bvhB.nearestDist2(p)); da.push(d); if (d <= tolerance) coverA++; }
  const db: number[] = [];
  let coverB = 0;
  for (const p of ptsB) { const d = Math.sqrt(bvhA.nearestDist2(p)); db.push(d); if (d <= tolerance) coverB++; }
  return {
    aToB: distStats(da),
    bToA: distStats(db),
    sampleCount: Math.min(ptsA.length, ptsB.length),
    coverageAinB: ptsA.length ? coverA / ptsA.length : NaN,
    coverageBinA: ptsB.length ? coverB / ptsB.length : NaN,
    tolerance,
  };
}

/** Max distance from the vertices of `a` to mesh `b`, plus stats. */
export function vertexToMeshDistance(a: IndexedMesh, b: IndexedMesh): DistStats {
  const bvh = new TriBvh(b);
  const n = a.positions.length / 3;
  const d: number[] = [];
  for (let i = 0; i < n; i++) {
    d.push(Math.sqrt(bvh.nearestDist2([a.positions[i * 3]!, a.positions[i * 3 + 1]!, a.positions[i * 3 + 2]!])));
  }
  return distStats(d);
}
