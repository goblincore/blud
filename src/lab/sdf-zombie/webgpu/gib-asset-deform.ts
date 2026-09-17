// src/lab/sdf-zombie/webgpu/gib-asset-deform.ts
//
// THE CPU DEFORMER FOR THE OFFLINE GIB ASSETS (2026-09-16 offline-gib-assets
// task 2).
//
// Task 1 committed, per archetype, one canonical mesh per planned piece plus a
// BOUNDED PER-VERTEX BINDING to that piece's source primitives. This module is
// the runtime half of that contract: given the source geometry as the body is
// being DRAWN right now — the posed prims for an immediate gib, or the
// rupture's sloughed `deformedPrims`/`deformedBones` — it produces the
// per-instance local vertex positions and normals for one spawned piece.
//
// WHY THIS IS THE HAND-OFF AND NOT A CROSSFADE. The rupture window draws the
// body with `rupturePosed`; the last drawn frame before release is
// `frame.deformedPrims`/`deformedBones` plus the per-region rigid transform.
// The released marched chunk is spawned from those SAME arrays. Deforming the
// asset by the same bind map reproduces the drawn surface, so the first mesh
// frame is the last SDF frame with no blend hiding a shape change.
//
// FRAMES. `piece.offset` is the planner origin `g.origin` (Task 1's local
// frame), so `qBody = local + piece.offset`. The bind map (`deformBoundVertex`,
// gib-asset.ts) maps REST body space → the supplied POSED frames, which are
// world space at runtime (`posed.prims` / `frame.deformedPrims`). The result is
// then expressed relative to the CHUNK PIVOT the caller passes — the same
// `g.origin` (plus the rupture offset) the marched chunk rotates about — so a
// mesh placed at that pivot with the chunk quaternion renders identically to
// the marched piece.
//
// NO THREE, NO DOM. Plain typed arrays, so the whole deform path is testable
// in node and the same code runs in the browser loader/worker.
//
// SCHEMA 3 (2026-09-17). The bind table contains only ADDITIVE prims; the `sub`
// carve caps are not targets (`GIB_ASSET_BIND_MASK`). `gibAssetRowsFromPrims`
// skips them so it stays row-aligned, and `checkGibAssetDeformBounds` is the
// runtime gate that refuses a piece whose deformed mesh no longer sits on the
// runtime additive geometry (a finite 4-5 m pole passed finiteness alone).
import { deformBoundVertex, type GibAssetPiece, type GibAssetBindingPrim, type GibPrimFrame, type DecodedGibPiece } from './gib-asset';
import type { Primitive, Vec3 } from '../types';
import { sdPrimitive } from '../validate';
import { chunkExtent } from '../extent';

/** The posed twin of one bind-table row. `undefined` = an unsourced row (a
 *  legacy pre-schema-3 `sub` cap): it has no deformed twin and follows the
 *  piece rigidly. Schema 3 emits none. */
export type GibAssetPosedRow = GibPrimFrame | undefined;

/** `gib-asset.ts`'s frame shape, copied off a live prim without aliasing it. */
function frameOfPrim(p: Primitive): GibPrimFrame {
  return {
    a: [p.a[0], p.a[1], p.a[2]],
    b: [p.b[0], p.b[1], p.b[2]],
    radius: p.radius,
    radiusB: p.radiusB,
    scale: [p.scale[0], p.scale[1], p.scale[2]],
  };
}

/** The minimal shape a row-aligned frame source needs. `op` is optional only
 *  so a plain frame (a test's synthetic row) still fits; a piece row carries it
 *  and `sub` cut caps are filtered out (they are not bind targets — see
 *  `GIB_ASSET_BIND_MASK`). */
export interface GibAssetFrameSource {
  a: Vec3;
  b: Vec3;
  radius: number;
  radiusB?: number;
  scale: Vec3;
  op?: string;
}

function frameOfSource(p: GibAssetFrameSource): GibPrimFrame {
  return {
    a: [p.a[0], p.a[1], p.a[2]],
    b: [p.b[0], p.b[1], p.b[2]],
    radius: p.radius,
    radiusB: p.radiusB,
    scale: [p.scale[0], p.scale[1], p.scale[2]],
  };
}

/**
 * Build the posed frames ROW-ALIGNED with the binding table — the immediate-gib
 * path.
 *
 * A `gibPlan` piece's `prims` ARE the binding table's rows in order (sourced
 * prims then their `sub` caps, then bones); the planner has already SEALED each
 * cut, so at the rest pose these frames are bit-identical to the asset's stored
 * rest frames and the deform is the identity. On a posed body they carry the
 * same rigid/articulated transform the marched chunk would use.
 *
 * `sub` CUT CAPS ARE SKIPPED. Since `GIB_ASSET_BIND_MASK = 'additive-v1'` the
 * bind table has no cap rows, so the row-aligned frame list must skip them too
 * or every later row is off by the number of caps (the pre-fix `row-mismatch`).
 *
 * NOT interchangeable with `gibAssetPosedRows`: that one follows the recorded
 * SOURCE indices into the whole body (the rupture path, where
 * `retargetGibPieces` has already replaced the sealed prims with the body's
 * sloughed twins).
 */
export function gibAssetRowsFromPrims(
  prims: readonly GibAssetFrameSource[],
): GibAssetPosedRow[] {
  const rows: GibAssetPosedRow[] = [];
  for (const p of prims) {
    if (p.op === 'sub') continue;
    rows.push(frameOfSource(p));
  }
  return rows;
}

/**
 * Build the per-bind-row posed frames for one piece from the runtime body.
 *
 * `flesh[i]`/`bones[i]` are indexed by the SAME source index the binding table
 * recorded (`srcPrims`/`srcBones` from the piece plan). A missing source — the
 * body was severed or the index is out of range — leaves the row undefined so
 * the vertex follows the piece rigidly rather than snapping to the origin.
 */
export function gibAssetPosedRows(
  piece: GibAssetPiece,
  flesh: readonly Primitive[],
  bones: readonly Primitive[],
): GibAssetPosedRow[] {
  return piece.bind.prims.map((p: GibAssetBindingPrim): GibAssetPosedRow => {
    if (p.source === 'flesh') {
      const q = p.index >= 0 ? flesh[p.index] : undefined;
      return q ? frameOfPrim(q) : undefined;
    }
    if (p.source === 'bone') {
      const q = p.index >= 0 ? bones[p.index] : undefined;
      return q ? frameOfPrim(q) : undefined;
    }
    return undefined;
  });
}

export interface GibAssetDeformBuffers {
  /** Piece-local (chunk) positions, length verts*3. `positions[i]` is the
   *  mapped body point relative to `pivot`. */
  positions: Float32Array;
  /** Piece-local unit normals, length verts*3. */
  normals: Float32Array;
}

/**
 * Deform one decoded asset piece into `out`, relative to `pivot`.
 *
 * PURE with respect to its inputs: `decoded` and `piece.bind.prims` are never
 * written, so two simultaneous instances can share them. Normals are
 * recomputed from the deformed surface (area-weighted, welded-vertex smooth),
 * which is the same thing `extractRegion`/`bakeChunkGeometry` do after a bake
 * and keeps a rigid rotation of the piece exact.
 */
export function deformGibAssetPiece(
  piece: GibAssetPiece,
  decoded: DecodedGibPiece,
  posedRows: readonly GibAssetPosedRow[],
  pivot: Vec3,
  out: GibAssetDeformBuffers,
  recomputeNormals = true,
): void {
  const verts = piece.verts;
  const maxPrims = piece.bind.maxPrims;
  const ox = piece.offset[0], oy = piece.offset[1], oz = piece.offset[2];
  const scratch: [number, number, number] = [0, 0, 0];
  const dst = out.positions;
  const src = decoded.positions;
  for (let i = 0; i < verts; i++) {
    const q: Vec3 = [src[i * 3]! + ox, src[i * 3 + 1]! + oy, src[i * 3 + 2]! + oz];
    const mapped = deformBoundVertex(
      q, i, decoded.bindIndex, decoded.bindWeight, maxPrims, piece.bind.prims, posedRows, scratch,
    );
    dst[i * 3] = mapped[0] - pivot[0];
    dst[i * 3 + 1] = mapped[1] - pivot[1];
    dst[i * 3 + 2] = mapped[2] - pivot[2];
  }
  if (recomputeNormals) computeGibAssetNormals(dst, decoded.indices, out.normals);
}

/**
 * Area-weighted smooth normals for a welded vertex/index mesh. Deterministic
 * and allocation-free. A vertex with no incident face (should not happen for a
 * committed asset) falls back to +Y so the shader never sees a zero normal.
 */
export function computeGibAssetNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  out: Float32Array,
): void {
  out.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]!, ib = indices[t + 1]!, ic = indices[t + 2]!;
    const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // Cross product magnitude is twice the triangle area — area weighting.
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    out[ia * 3] = out[ia * 3]! + nx; out[ia * 3 + 1] = out[ia * 3 + 1]! + ny; out[ia * 3 + 2] = out[ia * 3 + 2]! + nz;
    out[ib * 3] = out[ib * 3]! + nx; out[ib * 3 + 1] = out[ib * 3 + 1]! + ny; out[ib * 3 + 2] = out[ib * 3 + 2]! + nz;
    out[ic * 3] = out[ic * 3]! + nx; out[ic * 3 + 1] = out[ic * 3 + 1]! + ny; out[ic * 3 + 2] = out[ic * 3 + 2]! + nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i]!, y = out[i + 1]!, z = out[i + 2]!;
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) { out[i] = 0; out[i + 1] = 1; out[i + 2] = 0; }
    else { out[i] = x / l; out[i + 1] = y / l; out[i + 2] = z / l; }
  }
}

/**
 * The piece-local frame the chunk expects, computed WITHOUT deforming for the
 * trivial rest case — used by tests and by the loader's own sanity check.
 */
export function gibAssetRestLocalPositions(
  piece: GibAssetPiece, decoded: DecodedGibPiece, pivot: Vec3,
): Float32Array {
  const out = new Float32Array(decoded.positions.length);
  const ox = piece.offset[0] - pivot[0];
  const oy = piece.offset[1] - pivot[1];
  const oz = piece.offset[2] - pivot[2];
  for (let i = 0; i < decoded.positions.length; i += 3) {
    out[i] = decoded.positions[i]! + ox;
    out[i + 1] = decoded.positions[i + 1]! + oy;
    out[i + 2] = decoded.positions[i + 2]! + oz;
  }
  return out;
}

/** The local face frame of a head piece relative to a chunk pivot. The face
 *  TEXTURE stays an external reference (Task 1); this is only where it
 *  projects. Returns undefined for a non-head piece. */
export function gibAssetLocalFace(piece: GibAssetPiece, pivot: Vec3): GibAssetPiece['face'] | undefined {
  if (!piece.face) return undefined;
  return {
    centre: [
      piece.face.centre[0] - pivot[0],
      piece.face.centre[1] - pivot[1],
      piece.face.centre[2] - pivot[2],
    ],
    quat: [...piece.face.quat] as typeof piece.face.quat,
    axes: [...piece.face.axes] as typeof piece.face.axes,
    forward: piece.face.forward,
    reach: piece.face.reach,
  };
}

// ---------------------------------------------------------------------------
// Deform integrity: does the deformed mesh still sit on the runtime surface?
// ---------------------------------------------------------------------------

/**
 * Bounds the renderer accepts a deformed piece by. All metres.
 *
 * THE BOUNDS ARE DERIVED FROM RUNTIME ADDITIVE GEOMETRY, not from the baked
 * (and oversized) cap AABBs. Two are always evaluated, cheaply:
 *
 *   * `reach = chunkExtent(additive, pivot)` — the same conservative reach the
 *     chunk's own collision proxy uses. A correct deform (every vertex on or
 *     inside the carved union) measured `maxLocalRadius <= reach` on both
 *     archetypes across the walk cycle; the pre-2026-09-17 poles measured
 *     4-5 m against a ~0.4 m reach.
 *   * `maxEdge` — a stretched ribbon whose triangle spans the scene.
 *
 * `maxOutside` is the exact worst vertex distance outside the additive union.
 * It is only MEASURED when the cheap bounds already fail (`outsideMeasured`),
 * because a 31-prim `bone.cage` makes it the hot path; it is the diagnostic,
 * and `measureGibAssetOutside` exposes it for tests.
 */
export interface GibAssetDeformBounds {
  /** Worst `max(0, min_i sdPrimitive(world, additive_i))` over vertices — the
   *  exact field error, measured only when the cheap bounds fail. */
  maxOutside: number;
  /** Whether `maxOutside` was actually measured (false = cheap bounds passed). */
  outsideMeasured: boolean;
  /** `chunkExtent(additive, pivot)` — the runtime additive reach bound. */
  reach: number;
  /** Max `|local|` about the pivot — reported, and compared to `reach`. */
  maxLocalRadius: number;
  /** Max deformed triangle edge length. */
  maxEdge: number;
  /** The same two numbers for the REST mesh about the same pivot. */
  restMaxLocalRadius: number;
  restMaxEdge: number;
  finite: boolean;
  verts: number;
  tris: number;
}

/** A deformed vertex further than this outside the runtime additive union is
 *  not a surface point any more (extraction cells are 12 mm; the fixed sets
 *  measured ≤ 0.13 m and the bug measured 4-5 m). */
export const GIB_ASSET_DEFORM_MAX_OUTSIDE = 0.25;
/** Slack on the runtime additive reach bound, metres (measured correct slack
 *  is ≤ 0; this covers extraction error). */
export const GIB_ASSET_DEFORM_LOCAL_SLOP = 0.05;
/** A deformed edge longer than `max(restMaxEdge * this, MIN_EDGE)` is a spike.
 *  The shipped animated poses stretch an edge ~8x at a bending joint; the
 *  cap-bound bug stretched ~100x (metres). 12 leaves that headroom. */
export const GIB_ASSET_DEFORM_EDGE_SLACK = 12;
export const GIB_ASSET_DEFORM_EDGE_MIN = 0.5;

/** True when the bounds describe a displayable piece. */
export function gibAssetDeformBoundsOk(b: GibAssetDeformBounds): boolean {
  if (!b.finite) return false;
  if (b.maxOutside > GIB_ASSET_DEFORM_MAX_OUTSIDE) return false;
  if (b.maxLocalRadius > b.reach + GIB_ASSET_DEFORM_LOCAL_SLOP) return false;
  const edgeCap = Math.max(b.restMaxEdge * GIB_ASSET_DEFORM_EDGE_SLACK, GIB_ASSET_DEFORM_EDGE_MIN);
  return b.maxEdge <= edgeCap;
}

/** `Math.hypot` is ~10x slower than `sqrt` in V8 and this gate runs over every
 *  vertex and triangle at spawn; keep the hot loops on sqrt. */
function len3(x: number, y: number, z: number): number { return Math.sqrt(x * x + y * y + z * z); }

/** Rest max edge per decoded piece — immutable, so cache it (the gate runs on
 *  every spawn and this loop is over every triangle). */
const restMaxEdgeCache = new WeakMap<DecodedGibPiece, number>();
function cachedRestMaxEdge(decoded: DecodedGibPiece): number {
  const hit = restMaxEdgeCache.get(decoded);
  if (hit !== undefined) return hit;
  const idx = decoded.indices;
  const rest = decoded.positions;
  let m = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    m = Math.max(m,
      len3(rest[a * 3]! - rest[b * 3]!, rest[a * 3 + 1]! - rest[b * 3 + 1]!, rest[a * 3 + 2]! - rest[b * 3 + 2]!),
      len3(rest[b * 3]! - rest[c * 3]!, rest[b * 3 + 1]! - rest[c * 3 + 1]!, rest[b * 3 + 2]! - rest[c * 3 + 2]!),
      len3(rest[c * 3]! - rest[a * 3]!, rest[c * 3 + 1]! - rest[a * 3 + 1]!, rest[c * 3 + 2]! - rest[a * 3 + 2]!));
  }
  restMaxEdgeCache.set(decoded, m);
  return m;
}

/**
 * The EXACT worst distance a deformed piece sits outside the runtime additive
 * union: `max over verts of max(0, min_i sdPrimitive(world, additive_i))`.
 *
 * This is the strong integrity number (the pre-fix poles measured 4-5 m), but
 * it is expensive on a 31-prim `bone.cage`, so the display gate only pays for
 * it when the cheap reach/edge bounds already fail. Each prim is pre-wrapped in
 * a conservative bounding sphere so a vertex skips `sdPrimitive` whenever the
 * sphere's lower bound cannot improve the current best. `positions` is piece
 * local; `pivot` is the world origin `deformGibAssetPiece` subtracted.
 */
export function measureGibAssetOutside(
  positions: Float32Array,
  pivot: Vec3,
  additive: readonly Primitive[],
): number {
  const nPrims = additive.length;
  if (nPrims === 0) return 0;
  const sphereX = new Float64Array(nPrims);
  const sphereY = new Float64Array(nPrims);
  const sphereZ = new Float64Array(nPrims);
  const sphereR = new Float64Array(nPrims);
  for (let j = 0; j < nPrims; j++) {
    const p = additive[j]!;
    const cx = (p.a[0] + p.b[0]) / 2, cy = (p.a[1] + p.b[1]) / 2, cz = (p.a[2] + p.b[2]) / 2;
    sphereX[j] = cx; sphereY[j] = cy; sphereZ[j] = cz;
    sphereR[j] = chunkExtent([p], [cx, cy, cz]);
  }
  let maxOutside = 0;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const wx = positions[i * 3]! + pivot[0];
    const wy = positions[i * 3 + 1]! + pivot[1];
    const wz = positions[i * 3 + 2]! + pivot[2];
    let best = Infinity;
    for (let j = 0; j < nPrims; j++) {
      const dx = wx - sphereX[j]!, dy = wy - sphereY[j]!, dz = wz - sphereZ[j]!;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - sphereR[j]! >= best) continue;
      const d = sdPrimitive([wx, wy, wz], additive[j]!);
      if (d <= 0) { best = 0; break; }
      if (d < best) best = d;
    }
    if (best > maxOutside) maxOutside = best;
  }
  return maxOutside;
}

/**
 * Measure one deformed piece (in the SAME piece-local frame
 * `deformGibAssetPiece` wrote, with `pivot` the world origin it subtracted)
 * against the runtime additive prims it was deformed from. See
 * `GibAssetDeformBounds` for the cheap-vs-exact split. Pure; the only
 * allocation is the returned record (plus the exact-diagnostic scratch when the
 * cheap bounds fail).
 */
export function checkGibAssetDeformBounds(
  piece: GibAssetPiece,
  decoded: DecodedGibPiece,
  positions: Float32Array,
  pivot: Vec3,
  additive: readonly Primitive[],
): GibAssetDeformBounds {
  const verts = piece.verts;
  let maxLocalRadius = 0;
  let restMaxLocalRadius = 0;
  let finite = true;
  const ox = piece.offset[0] - pivot[0];
  const oy = piece.offset[1] - pivot[1];
  const oz = piece.offset[2] - pivot[2];
  for (let i = 0; i < verts; i++) {
    const lx = positions[i * 3]!, ly = positions[i * 3 + 1]!, lz = positions[i * 3 + 2]!;
    if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) { finite = false; break; }
    maxLocalRadius = Math.max(maxLocalRadius, len3(lx, ly, lz));
    const rx = decoded.positions[i * 3]! + ox;
    const ry = decoded.positions[i * 3 + 1]! + oy;
    const rz = decoded.positions[i * 3 + 2]! + oz;
    restMaxLocalRadius = Math.max(restMaxLocalRadius, len3(rx, ry, rz));
  }

  let maxEdge = 0;
  const idx = decoded.indices;
  if (finite) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      maxEdge = Math.max(maxEdge,
        len3(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!),
        len3(positions[b * 3]! - positions[c * 3]!, positions[b * 3 + 1]! - positions[c * 3 + 1]!, positions[b * 3 + 2]! - positions[c * 3 + 2]!),
        len3(positions[c * 3]! - positions[a * 3]!, positions[c * 3 + 1]! - positions[a * 3 + 1]!, positions[c * 3 + 2]! - positions[a * 3 + 2]!));
    }
  }

  const reach = additive.length > 0 ? chunkExtent(additive as Primitive[], pivot) : Infinity;
  const restMaxEdge = cachedRestMaxEdge(decoded);
  if (!finite) {
    return {
      maxOutside: Infinity, outsideMeasured: false, reach, maxLocalRadius, maxEdge: Infinity,
      restMaxLocalRadius, restMaxEdge, finite, verts, tris: (idx.length / 3) | 0,
    };
  }
  // Cheap-first: only a piece that already fails the reach/edge bounds pays for
  // the exact `sdPrimitive` sweep (see `measureGibAssetOutside`).
  const edgeCap = Math.max(restMaxEdge * GIB_ASSET_DEFORM_EDGE_SLACK, GIB_ASSET_DEFORM_EDGE_MIN);
  const cheapOk = maxLocalRadius <= reach + GIB_ASSET_DEFORM_LOCAL_SLOP && maxEdge <= edgeCap;
  const maxOutside = cheapOk ? 0 : measureGibAssetOutside(positions, pivot, additive);
  return {
    maxOutside, outsideMeasured: !cheapOk, reach, maxLocalRadius, maxEdge,
    restMaxLocalRadius, restMaxEdge, finite, verts, tris: (idx.length / 3) | 0,
  };
}
