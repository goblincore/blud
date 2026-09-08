// src/lab/sdf-zombie/webgpu/skeleton-spike/volume.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 3: cached segment-local bone
// distance GRIDS. One Float32 grid per BoneFieldSource, baked from the
// source's own segment-local distance() inside its contract bounds — the
// SAME field foldBoneRange computes on the GPU, sampled at regular nodes
// (node values are EXACT; only interior trilinear interpolation
// approximates). Organs never reach this module (excluded by contract).
// Bone composition is hard-min only, so per-segment grids compose with a
// plain min across segments — no smooth-union slicing problem exists on
// the bone path.
//
// OUTSIDE-GRID POLICY (spec: "Never clamp to an edge texel and pretend it
// represents arbitrary outside distance"): a query outside the node domain
// returns interp(clamp(p)) - |p - clamp(p)| - errorBound. The field is
// 1-Lipschitz, so true d(p) ≥ true d(q) - |p-q| ≥ interp(q) - errorBound
// - |p-q|: a PROVABLE LOWER BOUND, conservative for sphere tracing (it can
// slow a step, never skip a surface — and an UNDERESTIMATED bone distance
// would bulge bone through intact flesh, so provable-lower is the only
// acceptable direction). It reports `inside: false`; the composition
// helper segmentDistance() and the GPU path (volume.wgsl.ts) treat
// inside=false as a PROCEDURAL FALLBACK signal — fold the segment's prim
// rows exactly, count the fallback — never march far-field on the bound.
//
// ERROR BOUND: declared as `errorBound = cellSize`. Node values are exact;
// trilinear interpolation of a 1-Lipschitz field errs by at most
// h·√3/2 ≈ 0.87h (worst-case gradient rotation across a cell); rounded up
// to h for margin. The marcher may subtract it for conservative stepping.
// Actual max/percentile error vs the procedural oracle is MEASURED in
// volume.test.ts and reported in task-3.md — never silently folded into
// acceptance criteria.
//
// FORMAT: Float32 per node (uploaded as r32float 3D — NOT filterable in
// WebGPU, hence the manual trilinear in volume.wgsl.ts, the same choice
// the X1.26 hand volume made). No quantization error; bytes are reported
// per grid and per cache.
//
// Caching (fixture-contract.md invalidation rules): key is
// `${source.revision}@${cellSize}` — revision is the contract content
// hash, so anatomy/ratio/sever re-derives produce a NEW key and cannot
// hit a stale grid. Entries are shared across actors with the same
// revision. Explicit disposal only; the sampling path allocates nothing.
//
// Pure CPU + no three imports: vitest imports this file directly.
import type { BuildResult } from '../../build-body';
import { applyRig, type BoundRig } from '../../rig-bind';
import type { Vec3 } from '../../types';
import { len, sub } from '../../vec';
import type { BoneFieldSource, Point3 } from './contract';

/** Default bake resolution: 5 mm voxels. Finest bone radii on the zombie
 *  are ~8 mm (finger/rib tips measured in volume.test.ts); 5 mm keeps a
 *  thin rib ~3 voxels across. The 10 mm grid is the second evaluated
 *  resolution (it demonstrably misses thin structures — see tests). */
export const VOLUME_CELL = 0.005;

export interface SegmentGrid {
  /** Cache key: `${revision}@${cellSize}`. */
  key: string;
  revision: string;
  segment: string;
  /** Node counts per axis, x-fastest. */
  dims: readonly [number, number, number];
  /** Segment-local coordinates of node (0,0,0). */
  origin: Point3;
  /** Uniform node spacing, metres. */
  spacing: number;
  /** Declared conservative interpolation error bound, metres (= spacing). */
  errorBound: number;
  /** Exact node distances, length nx*ny*nz, x-fastest. */
  data: Float32Array;
  /** data.byteLength — memory reporting is a spec obligation. */
  bytes: number;
  /** CPU bake cost, ms — reported, never asserted. */
  bakeMs: number;
}

export interface GridSample {
  d: number;
  /** False when p lay outside the node domain and d is the conservative
   *  AABB lower bound, not an interpolated value. */
  inside: boolean;
}

/**
 * Bakes one grid. `margin` (metres, default 1.5 cells) pads the contract
 * bounds so the trilinear support of a surface-touching query stays in
 * domain; bounds already enclose every prim surface.
 */
export function bakeSegmentGrid(
  source: BoneFieldSource,
  cellSize: number,
  margin: number = cellSize * 1.5,
): SegmentGrid {
  const t0 = performance.now();
  const lo = [0, 1, 2].map(k => source.bounds.min[k]! - margin);
  const hi = [0, 1, 2].map(k => source.bounds.max[k]! + margin);
  const nx = Math.max(2, Math.ceil((hi[0]! - lo[0]!) / cellSize) + 1);
  const ny = Math.max(2, Math.ceil((hi[1]! - lo[1]!) / cellSize) + 1);
  const nz = Math.max(2, Math.ceil((hi[2]! - lo[2]!) / cellSize) + 1);
  const data = new Float32Array(nx * ny * nz);
  const p: [number, number, number] = [0, 0, 0];
  let i = 0;
  for (let z = 0; z < nz; z++) {
    p[2] = lo[2]! + z * cellSize;
    for (let y = 0; y < ny; y++) {
      p[1] = lo[1]! + y * cellSize;
      for (let x = 0; x < nx; x++) {
        p[0] = lo[0]! + x * cellSize;
        data[i++] = source.distance(p);
      }
    }
  }
  return {
    key: `${source.revision}@${cellSize}`,
    revision: source.revision,
    segment: source.segment,
    dims: [nx, ny, nz],
    origin: [lo[0]!, lo[1]!, lo[2]!],
    spacing: cellSize,
    errorBound: cellSize,
    data,
    bytes: data.byteLength,
    bakeMs: performance.now() - t0,
  };
}

/** Clamped point + Lipschitz lower bound — see header. Never the edge
 *  texel: the |p-q| term makes the value fall off with distance left. */
function outsideLowerBound(grid: SegmentGrid, p: Point3): number {
  const [nx, ny, nz] = grid.dims;
  const h = grid.spacing;
  const lo = grid.origin;
  const q: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const hik = lo[k]! + (grid.dims[k]! - 1) * h;
    q[k] = Math.min(hik, Math.max(lo[k]!, p[k]!));
  }
  const gap = len(sub(p as Vec3, q));
  return trilinear(grid, q) - gap - grid.errorBound;
}

/** Trilinear over the 8 nodes bracketing an IN-DOMAIN point. */
function trilinear(grid: SegmentGrid, p: Point3): number {
  const [nx, ny, nz] = grid.dims;
  const h = grid.spacing;
  const lo = grid.origin;
  const fx = (p[0]! - lo[0]!) / h, fy = (p[1]! - lo[1]!) / h, fz = (p[2]! - lo[2]!) / h;
  const x0 = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
  const z0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const tz = Math.min(1, Math.max(0, fz - z0));
  const at = (x: number, y: number, z: number) => grid.data[x + nx * (y + ny * z)]!;
  const c00 = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * tx;
  const c10 = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * tx;
  const c01 = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * tx;
  const c11 = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}

/**
 * Trilinear sample of a baked grid at segment-local p. Interior queries
 * interpolate the 8 surrounding nodes (clamped index pair at the domain
 * edge — the edge NODE value is exact, so a boundary-touching query still
 * mixes only real samples). Outside the domain: the clamp+Lipschitz lower
 * bound with inside=false (see header — never an edge-texel clamp).
 */
export function sampleSegmentGrid(grid: SegmentGrid, p: Point3): GridSample {
  const [nx, ny, nz] = grid.dims;
  const h = grid.spacing;
  const lo = grid.origin;
  if (p[0]! < lo[0]! || p[1]! < lo[1]! || p[2]! < lo[2]!
    || p[0]! > lo[0]! + (nx - 1) * h || p[1]! > lo[1]! + (ny - 1) * h || p[2]! > lo[2]! + (nz - 1) * h) {
    return { d: outsideLowerBound(grid, p), inside: false };
  }
  return { d: trilinear(grid, p), inside: true };
}

/**
 * The composition rule the GPU path implements (volume.wgsl.ts): sample
 * the grid; if the query fell outside the baked domain, FALL BACK to the
 * source's exact procedural distance and count it. This is the honest
 * answer to "segments touching": near a joint a point can sit outside a
 * NEIGHBOUR segment's domain, where the lower bound would underestimate
 * and (hard-min composition!) bulge bone through intact flesh — the
 *  spec's unacceptable leak. Fallback keeps the composed field exact.
 */
export function segmentDistance(
  source: BoneFieldSource,
  grid: SegmentGrid,
  p: Point3,
): { d: number; fallback: boolean } {
  const s = sampleSegmentGrid(grid, p);
  if (s.inside) return { d: s.d, fallback: false };
  return { d: source.distance(p), fallback: true };
}

/**
 * Per-segment GPU metadata for the atlas sample path (volume.wgsl.ts).
 * `segId` is applyRig's dense boneSegment int — pack.ts buckets ascending
 * by it, so the GPU loop and these records share one order.
 */
export interface SegmentAtlasMeta {
  segId: number;
  segment: string;
  grid: SegmentGrid;
  /** Atlas z-slice where this grid's z=0 plane starts. */
  z0: number;
}

export interface SegmentAtlas {
  /** Single r32float 3D payload: maxNx × maxNy × totalSlices, x-fastest,
   *  slices stacked along z. Each grid occupies dims[2] slices at z0. */
  data: Float32Array;
  dims: readonly [number, number, number];
  bytes: number;
  metas: SegmentAtlasMeta[];
  totalBakeMs: number;
}

/**
 * Packs baked grids into one 3D atlas. Slice stacking with NO halo is
 * sound because the sampler clamps index pairs within each segment's own
 * dims (same rule as sampleSegmentGrid) — a query never reads a
 * neighbour's texel.
 */
export function buildSegmentAtlas(
  entries: readonly { segId: number; grid: SegmentGrid }[],
): SegmentAtlas {
  let maxNx = 1, maxNy = 1, totalZ = 0;
  for (const { grid } of entries) {
    maxNx = Math.max(maxNx, grid.dims[0]);
    maxNy = Math.max(maxNy, grid.dims[1]);
    totalZ += grid.dims[2];
  }
  const data = new Float32Array(maxNx * maxNy * totalZ);
  const metas: SegmentAtlasMeta[] = [];
  let z0 = 0;
  for (const { segId, grid } of entries) {
    const [nx, ny, nz] = grid.dims;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const srcRow = nx * (y + ny * z);
        const dstRow = maxNx * (y + maxNy * (z0 + z));
        data.set(grid.data.subarray(srcRow, srcRow + nx), dstRow);
      }
    }
    metas.push({ segId, segment: grid.segment, grid, z0 });
    z0 += nz;
  }
  return {
    data,
    dims: [maxNx, maxNy, z0],
    bytes: data.byteLength,
    metas,
    totalBakeMs: entries.reduce((s, e) => s + e.grid.bakeMs, 0),
  };
}

/**
 * applyRig's dense boneSegment id per contract segment key (the segOf
 * ladder in rig-bind.ts assigns ids in first-seen bonePrims order,
 * INCLUDING the 'organs' segment the contract excludes). pack.ts buckets
 * ascending by this id; the GPU meta texture must be row-aligned with it.
 */
/**
 * applyRig's dense boneSegment id per contract segment key (the segOf
 * ladder in rig-bind.ts assigns ids in first-seen bonePrims order,
 * INCLUDING the 'organs' segment the contract excludes). pack.ts buckets
 * ascending by this id, so the GPU meta texture must be row-aligned with
 * it. Runs ONE rest-pose applyRig to read the tags — ids are pose-
 * independent and deterministic, so one read at wiring time is enough.
 */
export function boneSegmentKeyMap(body: BuildResult, bound: BoundRig): Map<string, number> {
  const posed = applyRig(body, bound);
  const map = new Map<string, number>();
  body.bonePrims.forEach((p, i) => {
    const id = posed.bonePrims[i]!.boneSegment;
    if (id === undefined) return;
    let key: string;
    if (p.op === 'organ') key = 'organs';
    else if (bound.head?.bones.has(i)) key = 'head';
    else {
      const f = bound.boneFrames.get(i);
      key = f ? `axial:${f.head}-${f.tail}`
        : `limb:${p.limb}:${bound.boneBinding[i]!.a.point}-${bound.boneBinding[i]!.b.point}`;
    }
    if (!map.has(key)) map.set(key, id);
  });
  return map;
}

export class SegmentVolumeCache {
  private readonly grids = new Map<string, SegmentGrid>();
  private disposed = false;

  /** Identity hit on `${revision}@${cellSize}`; bakes on miss. */
  get(source: BoneFieldSource, cellSize: number = VOLUME_CELL): SegmentGrid {
    if (this.disposed) throw new Error('SegmentVolumeCache used after dispose()');
    const key = `${source.revision}@${cellSize}`;
    let g = this.grids.get(key);
    if (!g) {
      g = bakeSegmentGrid(source, cellSize);
      this.grids.set(key, g);
    }
    return g;
  }

  stats(): { grids: number; bytes: number } {
    let bytes = 0;
    for (const g of this.grids.values()) bytes += g.bytes;
    return { grids: this.grids.size, bytes };
  }

  dispose(): void {
    this.grids.clear();
    this.disposed = true;
  }
}
