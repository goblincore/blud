// src/lab/sdf-zombie/webgpu/seed-upload.ts
//
// SEED ROW UPLOAD (meat pool and seed upload pass, 2026-10-29): a shutter motion seed (shutter-game-layer.ts,
// gib-shutter-layer.ts: an RGBA32F DataTexture the CPU rasterizes each frame) uploaded by its dirty row band
// (../seed-band.ts) instead of whole. three r186's WebGPU backend uploads a DataTexture only whole, when its version
// moves (`needsUpdate`); here the rows go straight to the backend's GPUTexture with device.queue.writeTexture —
// the same call three makes, just a sub-rectangle — and the version is left alone, so three never re-uploads over
// them. The first upload of a texture (it has no GPUTexture yet), a WebGL backend, or `?seedupload=0` take the old
// whole upload.
import type * as THREE from 'three/webgpu';
import { createSeedBandTracker, seedUploadEnabled, type RowBand } from '../seed-band';

/** The slice of the WebGPU API used here (the project has no @webgpu/types). */
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

export interface SeedUploadStats {
  /** Bytes sent this frame (0: skipped). */
  bytes: number;
  /** 'full' (needsUpdate), 'band', 'skip'. */
  mode: 'full' | 'band' | 'skip';
  /** CPU ms of the band's writeTexture call ('full' uploads later, inside three's bind: not counted here). */
  ms: number;
}

export interface SeedUploader {
  /** After the CPU raster: send this frame's seed. `written`: the rows the raster wrote (seed-band stampRowBand). */
  upload(tex: THREE.DataTexture, data: Float32Array, width: number, height: number, written: RowBand | null): SeedUploadStats;
  /** A new texture: the next upload is whole. */
  reset(): void;
  readonly last: SeedUploadStats;
}

export function createSeedUploader(renderer: THREE.WebGPURenderer): SeedUploader {
  const tracker = createSeedBandTracker();
  let last: SeedUploadStats = { bytes: 0, mode: 'skip', ms: 0 };
  const full = (tex: THREE.DataTexture, width: number, height: number): SeedUploadStats => {
    tex.needsUpdate = true;
    return { bytes: width * height * 16, mode: 'full', ms: 0 };
  };
  return {
    upload(tex, data, width, height, written) {
      if (!seedUploadEnabled()) { tracker.reset(); return (last = full(tex, width, height)); }
      const backend = (renderer as unknown as { backend?: WebGpuBackendLike }).backend;
      const gpuTex = backend?.isWebGPUBackend && backend.device ? backend.get(tex)?.texture : undefined;
      if (!gpuTex || !backend?.device) {
        // Not on the GPU yet (or not WebGPU): the whole buffer goes up with three's own upload. The band of THIS
        // frame is what the GPU will then hold.
        tracker.reset();
        tracker.next(written);
        return (last = full(tex, width, height));
      }
      const band = tracker.next(written);
      if (!band) return (last = { bytes: 0, mode: 'skip', ms: 0 });
      const rowBytes = width * 16;
      const rows = band.y1 - band.y0 + 1;
      const t0 = performance.now();
      // A VIEW OF THE BAND, offset 0: the browser copies the whole view it is handed across to the GPU process
      // (measured 2026-10-29: the whole 1.9 MB buffer with an offset cost more than three's full upload).
      backend.device.queue.writeTexture(
        { texture: gpuTex, mipLevel: 0, origin: { x: 0, y: band.y0, z: 0 } },
        data.subarray(band.y0 * width * 4, (band.y1 + 1) * width * 4),
        { offset: 0, bytesPerRow: rowBytes, rowsPerImage: rows },
        { width, height: rows, depthOrArrayLayers: 1 },
      );
      return (last = { bytes: rows * rowBytes, mode: 'band', ms: performance.now() - t0 });
    },
    reset() { tracker.reset(); },
    get last() { return last; },
  };
}

/** DEBUG (the seed upload gate): read a seed texture back from the GPU (null off WebGPU or before its first upload).
 *  Compare it with the CPU buffer between frames: equal means the GPU holds exactly what a whole upload would. */
export async function readSeedTexture(
  renderer: THREE.WebGPURenderer, tex: THREE.DataTexture, width: number, height: number,
): Promise<Float32Array | null> {
  type Dev = {
    createBuffer(d: { size: number; usage: number }): { mapAsync(m: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void };
    createCommandEncoder(): { copyTextureToBuffer(s: object, d: object, e: object): void; finish(): object };
    queue: { submit(c: object[]): void };
  };
  const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean; device?: Dev; get(o: object): { texture?: object } | undefined } }).backend;
  const gpuTex = backend?.isWebGPUBackend ? backend.get(tex)?.texture : undefined;
  const device = backend?.device;
  if (!gpuTex || !device) return null;
  const rowBytes = width * 16;
  const padded = Math.ceil(rowBytes / 256) * 256;
  // GPUBufferUsage.MAP_READ | COPY_DST; GPUMapMode.READ.
  const buf = device.createBuffer({ size: padded * height, usage: 0x0001 | 0x0008 });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: gpuTex }, { buffer: buf, bytesPerRow: padded, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(0x0001);
  const src = new Uint8Array(buf.getMappedRange());
  const out = new Float32Array(width * height * 4);
  const dst = new Uint8Array(out.buffer);
  for (let y = 0; y < height; y++) dst.set(src.subarray(y * padded, y * padded + rowBytes), y * rowBytes);
  buf.unmap(); buf.destroy();
  return out;
}
