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
import { deformBoundVertex, type GibAssetPiece, type GibAssetBindingPrim, type GibPrimFrame, type DecodedGibPiece } from './gib-asset';
import type { Primitive, Vec3 } from '../types';

/** The posed twin of one bind-table row. `undefined` = a `sub` cap or an
 *  unsourced row: it has no deformed twin and follows the piece rigidly. */
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

/** The minimal shape a row-aligned frame source needs. */
export interface GibAssetFrameSource {
  a: Vec3;
  b: Vec3;
  radius: number;
  radiusB?: number;
  scale: Vec3;
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
 * NOT interchangeable with `gibAssetPosedRows`: that one follows the recorded
 * SOURCE indices into the whole body (the rupture path, where
 * `retargetGibPieces` has already replaced the sealed prims with the body's
 * sloughed twins).
 */
export function gibAssetRowsFromPrims(
  prims: readonly GibAssetFrameSource[],
): GibAssetPosedRow[] {
  return prims.map(frameOfSource);
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
