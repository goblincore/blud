// src/lab/sdf-zombie/webgpu/wound-volume-store.ts
//
// THE BAKED WOUND VOLUME, host half (`?woundvol`, march/wound-volume-flag.ts): the one 3D texture every wounded
// primitive's box lives in, the boxes a body owns, and the table the march reads them through.
//
//   woundVolumeAtlas()        the shared RGBA8 3D texture (bound where the shader takes `segVolumeAtlas`) and its
//                             box allocator. A box is a primitive's shape voxels with its colour voxels stacked
//                             after them along z.
//   createBodyWoundVolumes()  one body's boxes, keyed by primitive: `stamp` bakes a wound that left the list
//                             (../wound-volume-stamp.ts) and sends the touched voxels to the GPU; `table` writes
//                             the rows the shader walks (fields/wound-volume.wgsl.ts), in world space, each frame.
//
// A box rides its primitive in the frame wounds already ride in (damage.ts woundFrame), anchored on the axis the
// primitive had when the box was made, so every crater in it moves rigidly with the primitive.
import * as THREE from 'three/webgpu';
import { WOUND_PROFILES, woundFrame, type Wound } from '../damage';
import type { Primitive, Vec3 } from '../types';
import { wetLipUpload } from '../torn-lips';
import { WV_MARGIN, createPrimVolume, stampCrater, stampReach, type PrimVolume, type StampCrater } from '../wound-volume-stamp';
import { WOUND_VOL_VOXEL, WV_MAX_ENTRIES } from './march/wound-volume-flag';

/** The atlas, in voxels: 19 MB of RGBA8. A box that does not fit is not made, and its wound is dropped as an
 *  evicted wound always was. */
export const WV_ATLAS_DIMS: [number, number, number] = [192, 192, 128];

interface GpuQueueLike {
  writeTexture(
    destination: { texture: object; mipLevel: number; origin: { x: number; y: number; z: number } },
    data: ArrayBufferView,
    layout: { offset: number; bytesPerRow: number; rowsPerImage: number },
    size: { width: number; height: number; depthOrArrayLayers: number },
  ): void;
}
interface WebGpuBackendLike {
  isWebGPUBackend?: boolean;
  device?: { queue: GpuQueueLike };
  get(o: object): { texture?: object } | undefined;
}

export interface WoundVolumeAtlas {
  readonly texture: THREE.Data3DTexture;
  readonly data: Uint8Array;
  /** A free box of these voxels, or null when the atlas is full. */
  alloc(dims: readonly [number, number, number]): [number, number, number] | null;
  free(origin: readonly [number, number, number], dims: readonly [number, number, number]): void;
  /** Copy a box of voxels (inclusive corners, atlas coordinates) from `data` to the GPU. */
  upload(lo: readonly [number, number, number], hi: readonly [number, number, number]): void;
  /** The renderer whose backend holds the texture: until it is set, or the texture has not reached the GPU, the
   *  whole atlas goes up with three's own upload. */
  bindRenderer(renderer: unknown): void;
  /** Bytes of the boxes in use, and the boxes. */
  stats(): { boxes: number; bytes: number; freeListed: number };
}

export function createWoundVolumeAtlas(dims: readonly [number, number, number] = WV_ATLAS_DIMS): WoundVolumeAtlas {
  const [W, H, D] = dims;
  const data = new Uint8Array(W * H * D * 4);
  const texture = new THREE.Data3DTexture(data, W, H, D);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  // Shelves: boxes in a row along x, rows along y, slabs along z. Freed boxes are kept by size and handed out again
  // (bodies of one type make boxes of the same sizes).
  const freed = new Map<string, [number, number, number][]>();
  let cx = 0, cy = 0, cz = 0, rowH = 0, slabD = 0, boxes = 0, bytes = 0;
  let backend: WebGpuBackendLike | undefined;
  return {
    texture, data,
    alloc(d) {
      const key = d.join('x');
      const again = freed.get(key)?.pop();
      const count = () => { boxes++; bytes += d[0] * d[1] * d[2] * 4; };
      if (again) { count(); return again; }
      if (d[0] > W || d[1] > H || d[2] > D) return null;
      if (cx + d[0] > W) { cx = 0; cy += rowH; rowH = 0; }
      if (cy + d[1] > H) { cx = 0; cy = 0; rowH = 0; cz += slabD; slabD = 0; }
      if (cz + d[2] > D) return null;
      const origin: [number, number, number] = [cx, cy, cz];
      cx += d[0]; rowH = Math.max(rowH, d[1]); slabD = Math.max(slabD, d[2]);
      count();
      return origin;
    },
    free(origin, d) {
      // Emptied here, so the next owner starts clean.
      for (let z = 0; z < d[2]; z++) for (let y = 0; y < d[1]; y++) {
        const o = (((origin[2] + z) * H + origin[1] + y) * W + origin[0]) * 4;
        data.fill(0, o, o + d[0] * 4);
      }
      this.upload(origin, [origin[0] + d[0] - 1, origin[1] + d[1] - 1, origin[2] + d[2] - 1]);
      const key = d.join('x');
      if (!freed.has(key)) freed.set(key, []);
      freed.get(key)!.push([origin[0], origin[1], origin[2]]);
      boxes--; bytes -= d[0] * d[1] * d[2] * 4;
    },
    upload(lo, hi) {
      const gpuTex = backend?.isWebGPUBackend && backend.device ? backend.get(texture)?.texture : undefined;
      if (!gpuTex || !backend?.device) { texture.needsUpdate = true; return; }
      const w = hi[0] - lo[0] + 1, h = hi[1] - lo[1] + 1, d = hi[2] - lo[2] + 1;
      const box = new Uint8Array(w * h * d * 4);
      for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) {
        const o = (((lo[2] + z) * H + lo[1] + y) * W + lo[0]) * 4;
        box.set(data.subarray(o, o + w * 4), (z * h + y) * w * 4);
      }
      backend.device.queue.writeTexture(
        { texture: gpuTex, mipLevel: 0, origin: { x: lo[0], y: lo[1], z: lo[2] } },
        box, { offset: 0, bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d },
      );
    },
    bindRenderer(renderer) { backend = (renderer as { backend?: WebGpuBackendLike } | null)?.backend; },
    stats: () => ({ boxes, bytes, freeListed: [...freed.values()].reduce((n, l) => n + l.length, 0) }),
  };
}

let shared: WoundVolumeAtlas | null = null;
/** The page's one atlas (made on first use; `?woundvol` only). */
export function woundVolumeAtlas(): WoundVolumeAtlas { return (shared ??= createWoundVolumeAtlas()); }

// ------------------------------------------------------------------------------------------------- one body's boxes
type Basis = { u: Vec3; v: Vec3; w: Vec3 };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const out3 = (m: Basis, l: Vec3): Vec3 => [m.u[0] * l[0] + m.v[0] * l[1] + m.w[0] * l[2], m.u[1] * l[0] + m.v[1] * l[1] + m.w[1] * l[2], m.u[2] * l[0] + m.v[2] * l[1] + m.w[2] * l[2]];
const in3 = (m: Basis, g: Vec3): Vec3 => [dot(m.u, g), dot(m.v, g), dot(m.w, g)];

/** The unit quaternion (x, y, z, w) that turns WORLD directions into the frame's (u, v, w) components: the conjugate
 *  of the rotation whose columns are u, v, w. */
export function worldToFrameQuat(m: Basis): [number, number, number, number] {
  const m00 = m.u[0], m10 = m.u[1], m20 = m.u[2], m01 = m.v[0], m11 = m.v[1], m21 = m.v[2], m02 = m.w[0], m12 = m.w[1], m22 = m.w[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  return [-x / l, -y / l, -z / l, w / l];
}

/** The carve settings a stamp takes from the view's uniforms (woundCfg.y / .z / .w, woundCfg2.x). */
export interface WoundVolumeCfg { blendK: number; rimSplay: number; rimOffset: number; rimWidth: number }
export const WV_DEFAULT_CFG: WoundVolumeCfg = { blendK: 0.015, rimSplay: 0.55, rimOffset: 1.15, rimWidth: 0.42 };

interface Entry {
  primIdx: number;
  vol: PrimVolume;
  origin: [number, number, number];
  /** Shape box dims; the atlas box is twice as deep. */
  axis0: Vec3 | undefined;
  /** What the stamps have touched, in the box's frame (metres): the entry's bound. */
  lo: [number, number, number];
  hi: [number, number, number];
}

export interface BodyWoundVolumes {
  /** Bake a wound that left the list. False when it is not a crater the volume takes, its primitive is gone, or
   *  there is no room. */
  stamp(w: Wound, prims: readonly Primitive[], bodyYaw: number, cfg?: WoundVolumeCfg): boolean;
  /** Write the table (WV_MAX_ENTRIES x 4 texels: bound, world-to-box quaternion, box corner + voxel, atlas box) and
   *  return how many entries it holds and their union bound (world centre, radius), or null when there are none. */
  table(
    out: Float32Array, prims: readonly Primitive[], bodyYaw: number,
    xf?: (v: Vec3, primIdx: number, dir: boolean) => Vec3,
  ): { count: number; bound: [number, number, number, number] } | null;
  readonly size: number;
  dispose(): void;
}

/** Can this wound be stamped? Craters only: a cut, a decal, a cloth hole and a head-tagged crater stay list-only. */
export function stampable(w: Wound): boolean {
  return w.shape !== 'cut' && !w.decal && !w.cloth && w.headSlot === undefined && w.headRegion === undefined && !w.injuryIgnored;
}

export function createBodyWoundVolumes(atlas: WoundVolumeAtlas = woundVolumeAtlas(), voxel: number = WOUND_VOL_VOXEL || 0.02): BodyWoundVolumes {
  const entries = new Map<number, Entry>();
  const [AW, AH] = [atlas.texture.image.width as number, atlas.texture.image.height as number];
  const make = (w: Wound, prim: Primitive, bodyYaw: number): Entry | null => {
    if (entries.size >= WV_MAX_ENTRIES) return null;
    const f = woundFrame(prim, bodyYaw, w.axis0);
    const lb = in3(f, [prim.b[0] - prim.a[0], prim.b[1] - prim.a[1], prim.b[2] - prim.a[2]]);
    const reach = Math.max(prim.radius, prim.radiusB ?? 0) * Math.max(1, prim.scale[0], prim.scale[1], prim.scale[2]) + WV_MARGIN;
    const lo: Vec3 = [Math.min(0, lb[0]) - reach, Math.min(0, lb[1]) - reach, Math.min(0, lb[2]) - reach];
    const hi: Vec3 = [Math.max(0, lb[0]) + reach, Math.max(0, lb[1]) + reach, Math.max(0, lb[2]) + reach];
    const vol = createPrimVolume(lo, hi, voxel);
    const origin = atlas.alloc([vol.dims[0], vol.dims[1], vol.dims[2] * 2]);
    if (!origin) return null;
    return { primIdx: w.primIdx, vol, origin, axis0: w.axis0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] };
  };
  return {
    get size() { return entries.size; },
    stamp(w, prims, bodyYaw, cfg = WV_DEFAULT_CFG) {
      const prim = prims[w.primIdx];
      if (!prim || prim.dead || !stampable(w)) return false;
      let e = entries.get(w.primIdx);
      if (!e) {
        const made = make(w, prim, bodyYaw);
        if (!made) return false;
        entries.set(w.primIdx, e = made);
      }
      // The wound's own frame (its stamp-time axis) and the box's (the axis the box was made on) differ by a roll
      // about the primitive's axis; the crater is placed where it is NOW and rides the box's frame from here on.
      const mine = woundFrame(prim, bodyYaw, w.axis0), box = woundFrame(prim, bodyYaw, e.axis0);
      const profile = WOUND_PROFILES[w.type];
      const burn = w.type === 'burn';
      const depth = burn ? w.radius * 0.35 * Math.min(1, Math.max(0, w.ageSec)) : w.radius;
      const wet = wetLipUpload(w), torn = (w.tear ?? 0) > 0;
      const crater: StampCrater = {
        centre: in3(box, out3(mine, w.local)),
        radius: w.radius, depth,
        capN: w.carveN ? in3(box, out3(mine, w.carveN)) : undefined,
        capDepth: w.carveDepth,
        blendK: cfg.blendK,
        rimOffset: cfg.rimOffset * profile.rimOffsetScale,
        rimWidth: cfg.rimWidth,
        rimAmp: depth * cfg.rimSplay * profile.rimSplayScale * (w.rimScale ?? 1) * (burn ? 0.25 : 1),
        tear: wet || torn, wetOnly: wet && !torn,
      };
      const hit = stampCrater(e.vol, crater);
      if (!hit) return false;
      const reach = stampReach(crater);
      for (let k = 0; k < 3; k++) { e.lo[k] = Math.min(e.lo[k]!, crater.centre[k]! - reach); e.hi[k] = Math.max(e.hi[k]!, crater.centre[k]! + reach); }
      // The touched voxels into the atlas (shape, then colour stacked after it along z) and on to the GPU.
      const [nx, ny, nz] = e.vol.dims;
      for (const [src, zOff] of [[e.vol.shape, 0], [e.vol.colour, nz]] as const) {
        for (let z = hit.lo[2]; z <= hit.hi[2]; z++) for (let y = hit.lo[1]; y <= hit.hi[1]; y++) {
          const s = ((z * ny + y) * nx + hit.lo[0]) * 4;
          const d = (((e.origin[2] + zOff + z) * AH + e.origin[1] + y) * AW + e.origin[0] + hit.lo[0]) * 4;
          atlas.data.set(src.subarray(s, s + (hit.hi[0] - hit.lo[0] + 1) * 4), d);
        }
        atlas.upload(
          [e.origin[0] + hit.lo[0], e.origin[1] + hit.lo[1], e.origin[2] + zOff + hit.lo[2]],
          [e.origin[0] + hit.hi[0], e.origin[1] + hit.hi[1], e.origin[2] + zOff + hit.hi[2]],
        );
      }
      return true;
    },
    table(out, prims, bodyYaw, xf) {
      out.fill(0, 0, WV_MAX_ENTRIES * 16);
      let n = 0;
      const centres: number[] = [];
      for (const e of entries.values()) {
        const prim = prims[e.primIdx];
        if (!prim || prim.dead || e.hi[0] < e.lo[0]) continue;
        const f = woundFrame(prim, bodyYaw, e.axis0);
        const at = (l: Vec3): Vec3 => { const g = out3(f, l); const p: Vec3 = [prim.a[0] + g[0], prim.a[1] + g[1], prim.a[2] + g[2]]; return xf ? xf(p, e.primIdx, false) : p; };
        const basis: Basis = xf ? { u: xf(f.u, e.primIdx, true), v: xf(f.v, e.primIdx, true), w: xf(f.w, e.primIdx, true) } : f;
        const c = at([(e.lo[0] + e.hi[0]) / 2, (e.lo[1] + e.hi[1]) / 2, (e.lo[2] + e.hi[2]) / 2]);
        const r = Math.hypot(e.hi[0] - e.lo[0], e.hi[1] - e.lo[1], e.hi[2] - e.lo[2]) / 2;
        const corner = at(e.vol.min);
        const q = worldToFrameQuat(basis);
        const o = n * 16;
        out.set([c[0], c[1], c[2], r], o);
        out.set(q, o + 4);
        out.set([corner[0], corner[1], corner[2], e.vol.voxel], o + 8);
        out.set([e.origin[0], e.origin[1], e.origin[2], e.vol.dims[0] + e.vol.dims[1] * 256 + e.vol.dims[2] * 65536], o + 12);
        centres.push(c[0], c[1], c[2], r);
        n++;
      }
      if (!n) return null;
      const m = [0, 0, 0];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] = m[k]! + centres[i * 4 + k]! / n;
      let R = 0;
      for (let i = 0; i < n; i++) R = Math.max(R, Math.hypot(centres[i * 4]! - m[0]!, centres[i * 4 + 1]! - m[1]!, centres[i * 4 + 2]! - m[2]!) + centres[i * 4 + 3]!);
      return { count: n, bound: [m[0]!, m[1]!, m[2]!, R] };
    },
    dispose() {
      for (const e of entries.values()) atlas.free(e.origin, [e.vol.dims[0], e.vol.dims[1], e.vol.dims[2] * 2]);
      entries.clear();
    },
  };
}
