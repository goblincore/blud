// src/lab/sdf-zombie/webgpu/skeleton-spike/volume-gpu.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 3b: HOST side of the GPU
// volume path. Packs the per-segment meta texture that volume.wgsl.ts
// samples, uploads per-frame pose rows, and owns the atlas GPU texture
// lifetime (volume.ts deliberately holds no GPU objects). Data3DTexture /
// DataTexture construction is CPU-side (X1.26 hand-volume precedent), so
// vitest imports this module directly.
//
// Meta texture: RGBA32float, BONE_SEG_MAX × 4 rows, row-aligned to
// pack.ts's ascending boneSegment id order (boneSegmentKeyMap). See
// volume.wgsl.ts header for the row layout. The whole 32×4 block is
// rewritten per pose upload — 512 floats, cheaper than tracking dirty rows.
//
// sampleAtlasTrilinear is the CPU TWIN of SAMPLE_SEG_VOLUME +
// SEG_VOLUME_TO_LOCAL, written to the same arithmetic so
// volume-gpu.test.ts can pin WGSL/CPU parity on the error-prone part:
// atlas addressing x + maxNx·(y + maxNy·(z0+z)) with per-segment clamped
// index pairs. If the WGSL changes, change this in the same commit.
import * as THREE from 'three';
import { BONE_SEG_MAX } from '../../validate';
export { BONE_SEG_MAX };
import type { BoneFieldSource, Point3 } from './contract';
import type { SegmentAtlas } from './volume';

export const SEG_VOLUME_META_ROWS = 4;
export const SEG_META_ROW_GRID = 0;
export const SEG_META_ROW_DIMS = 1;
export const SEG_META_ROW_QUAT = 2;
export const SEG_META_ROW_POSE = 3;

const F = 4; // floats per texel (RGBA)

const rowOff = (segId: number, row: number) => (row * BONE_SEG_MAX + segId) * F;

/**
 * Allocates the meta block and fills the STATIC rows (grid origin/spacing,
 * dims/z0) from the atlas. Rows are aligned to `segId`; segments with no
 * grid (organs) and unused ids stay zero — enable (POSE.w) defaults 0, the
 * procedural-fold signal. Pose rows are written by writeSegmentPose.
 */
export function packSegmentMeta(atlas: SegmentAtlas): Float32Array {
  const out = new Float32Array(BONE_SEG_MAX * SEG_VOLUME_META_ROWS * F);
  for (const meta of atlas.metas) {
    if (meta.segId < 0 || meta.segId >= BONE_SEG_MAX) continue; // overflow ⇒ procedural
    const g = meta.grid;
    out.set([g.origin[0]!, g.origin[1]!, g.origin[2]!, g.spacing], rowOff(meta.segId, SEG_META_ROW_GRID));
    out.set([g.dims[0]!, g.dims[1]!, g.dims[2]!, meta.z0], rowOff(meta.segId, SEG_META_ROW_DIMS));
  }
  return out;
}

/**
 * Per-frame pose upload: rows QUAT (world-from-local quat) and POSE (world
 * origin + enable) per segment, from the live rig via source.pose(). A
 * severed segment (isLive() false) writes enable=0 the same frame pack.ts
 * drops its bone rows — contract invalidation rule 3. Segments without a
 * grid in this atlas are never enabled.
 */
export function writeSegmentPose(
  meta: Float32Array,
  atlas: SegmentAtlas,
  sources: readonly BoneFieldSource[],
): void {
  const bySegment = new Map(sources.map(s => [s.segment, s]));
  for (const m of atlas.metas) {
    if (m.segId < 0 || m.segId >= BONE_SEG_MAX) continue;
    const src = bySegment.get(m.segment);
    const live = src !== undefined && src.isLive();
    const qOff = rowOff(m.segId, SEG_META_ROW_QUAT);
    const pOff = rowOff(m.segId, SEG_META_ROW_POSE);
    if (!live || !src) {
      meta[pOff + 3] = 0;
      continue;
    }
    const pose = src.pose();
    meta.set([pose.quat[0]!, pose.quat[1]!, pose.quat[2]!, pose.quat[3]!], qOff);
    meta.set([pose.origin[0]!, pose.origin[1]!, pose.origin[2]!, 1], pOff);
  }
}

/** CPU twin of SEG_VOLUME_TO_LOCAL: local = qRotate(conj(q), p − origin). */
export function segVolumeToLocal(
  p: Point3,
  quat: readonly [number, number, number, number],
  origin: Point3,
): [number, number, number] {
  const tx = p[0]! - origin[0]!, ty = p[1]! - origin[1]!, tz = p[2]! - origin[2]!;
  const ux = -quat[0]!, uy = -quat[1]!, uz = -quat[2]!, s = quat[3]!;
  const dt = ux * tx + uy * ty + uz * tz;
  const uu = ux * ux + uy * uy + uz * uz;
  const cx = uy * tz - uz * ty, cy = uz * tx - ux * tz, cz = ux * ty - uy * tx;
  return [
    2 * dt * ux + (s * s - uu) * tx + 2 * s * cx,
    2 * dt * uy + (s * s - uu) * ty + 2 * s * cy,
    2 * dt * uz + (s * s - uu) * tz + 2 * s * cz,
  ];
}

/**
 * CPU twin of SAMPLE_SEG_VOLUME: manual trilinear over the packed atlas for
 * segment `segId`, with per-segment clamped index pairs and the
 * outside-domain clamp+Lipschitz lower bound (inside=false ⇒ the GPU caller
 * falls back to the procedural fold and counts it — mirror of
 * volume.ts segmentDistance). Reads meta rows written by packSegmentMeta.
 */
export function sampleAtlasTrilinear(
  atlas: SegmentAtlas,
  meta: Float32Array,
  segId: number,
  pLocal: Point3,
): { d: number; inside: boolean } {
  const gOff = rowOff(segId, SEG_META_ROW_GRID);
  const dOff = rowOff(segId, SEG_META_ROW_DIMS);
  const h = meta[gOff + 3]!;
  const nx = meta[dOff]! | 0, ny = meta[dOff + 1]! | 0, nz = meta[dOff + 2]! | 0;
  const zBase = meta[dOff + 3]! | 0;
  const lo = [meta[gOff]!, meta[gOff + 1]!, meta[gOff + 2]!] as const;
  const [maxNx, maxNy] = atlas.dims;
  const q: [number, number, number] = [0, 0, 0];
  let inside = true;
  for (let k = 0; k < 3; k++) {
    const hik = lo[k]! + ([nx, ny, nz][k]! - 1) * h;
    q[k] = Math.min(hik, Math.max(lo[k]!, pLocal[k]!));
    if (pLocal[k]! !== q[k]) inside = false;
  }
  const f = [(q[0] - lo[0]!) / h, (q[1] - lo[1]!) / h, (q[2] - lo[2]!) / h];
  const x0 = Math.max(0, Math.min(nx - 2, Math.floor(f[0]!)));
  const y0 = Math.max(0, Math.min(ny - 2, Math.floor(f[1]!)));
  const z0 = Math.max(0, Math.min(nz - 2, Math.floor(f[2]!)));
  const tx = Math.min(1, Math.max(0, f[0]! - x0));
  const ty = Math.min(1, Math.max(0, f[1]! - y0));
  const tz = Math.min(1, Math.max(0, f[2]! - z0));
  const at = (x: number, y: number, z: number) =>
    atlas.data[x + maxNx * (y + maxNy * (zBase + z))]!;
  const c00 = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * tx;
  const c10 = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * tx;
  const c01 = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * tx;
  const c11 = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  const d = c0 + (c1 - c0) * tz;
  if (inside) return { d, inside: true };
  const gap = Math.hypot(pLocal[0]! - q[0], pLocal[1]! - q[1], pLocal[2]! - q[2]);
  return { d: d - gap - h, inside: false };
}

/**
 * GPU texture lifetime — the only render-facing piece here (volume.ts
 * holds none). Follows the X1.26 hand-volume precedent: a THREE
 * Data3DTexture, RedFormat/FloatType (r32float — NOT filterable, hence the
 * manual trilinear in volume.wgsl.ts), nearest/clamp. On atlas REBUILD
 * (revision change — anatomy/ratio/sever re-derive), create a new texture
 * and dispose the old one; nothing else tracks it.
 */
export function createSegmentAtlasTexture(atlas: SegmentAtlas): THREE.Data3DTexture {
  const [w, h, d] = atlas.dims;
  const texture = new THREE.Data3DTexture(atlas.data, w, h, d);
  texture.format = THREE.RedFormat;
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** The BONE_SEG_MAX × 4 RGBA-float meta block as a texture_2d<f32> the
 *  marcher can textureLoad (same convention as the pack data texture).
 *  Pose rows are rewritten per frame via writeSegmentPose → set
 *  `needsUpdate = true` after each rewrite. */
export function createSegmentMetaTexture(meta: Float32Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(meta, BONE_SEG_MAX, SEG_VOLUME_META_ROWS);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Per-view live pose binding. The atlas texture is shared by revision and
 * owned by the caller; each actor owns only this tiny mutable meta texture. */
export class SegmentVolumeBinding {
  readonly meta: Float32Array;
  readonly metaTexture: THREE.DataTexture;
  private readonly revisions: Map<string, string>;
  private disposed = false;

  constructor(
    readonly atlas: SegmentAtlas,
    readonly atlasTexture: THREE.Data3DTexture,
    sources: readonly BoneFieldSource[],
  ) {
    this.meta = packSegmentMeta(atlas);
    this.metaTexture = createSegmentMetaTexture(this.meta);
    this.revisions = new Map(sources.map(source => [source.segment, source.revision]));
    this.update(sources);
  }

  update(sources: readonly BoneFieldSource[]): void {
    if (this.disposed) throw new Error('SegmentVolumeBinding used after dispose()');
    for (const source of sources) {
      const expected = this.revisions.get(source.segment);
      if (expected !== undefined && expected !== source.revision) {
        throw new Error(`Segment volume revision changed for ${source.segment}; rebuild atlas before pose upload`);
      }
    }
    writeSegmentPose(this.meta, this.atlas, sources);
    this.metaTexture.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.metaTexture.dispose();
  }
}
