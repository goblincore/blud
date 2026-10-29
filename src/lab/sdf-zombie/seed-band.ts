// src/lab/sdf-zombie/seed-band.ts
//
// SEED DIRTY BAND: which rows of a shutter motion seed changed since the last upload (meat pool and seed upload
// pass, 2026-10-29). Pure: no renderer.
//
// The shutter's seed (webgpu/shutter-blur.ts rasterizeSweepSeed: RGBA32F, up to 512 x 288, 2.4 MB) was re-uploaded
// whole every frame blood flew (`seedTex.needsUpdate`); three r186's WebGPU backend has no partial upload. The
// raster clears the whole buffer and writes each stamp inside its clamped bbox, so the only rows that can differ
// from what the GPU holds are this frame's stamp rows and the rows the LAST upload wrote (now cleared). The band is
// the union of the two; an empty union is no upload at all. The webgpu side (webgpu/seed-upload.ts) writes just
// those rows with device.queue.writeTexture: the GPU texture ends up bit-identical to a full upload.
//
// `?seedupload=0` restores the full upload every frame.

let seedUpload = true;
/** `?seedupload=0`: the full seed upload every frame (see the header). */
export function seedUploadOn(search: string): boolean {
  return new URLSearchParams(search).get('seedupload') !== '0';
}
export function setSeedUpload(on: boolean): void { seedUpload = on; }
export function seedUploadEnabled(): boolean { return seedUpload; }

/** Inclusive seed row range. */
export interface RowBand { y0: number; y1: number }

/** The stamp shape the band needs (shutter-blur.ts SweepStamp, in output pixels). */
export interface BandStamp { fromY: number; toY: number; radiusPx: number }

/**
 * The seed rows `rasterizeSweepSeed` can write for these stamps: each stamp's clamped bbox, exactly as the raster
 * computes it (half = clamp(radiusPx * seedW / outputW, minHalf, maxHalf)). Null for no stamps (or none on the seed).
 */
export function stampRowBand(
  stamps: readonly BandStamp[], outputWidth: number, outputHeight: number, seedWidth: number, seedHeight: number,
  minHalf: number, maxHalf: number,
): RowBand | null {
  if (stamps.length === 0) return null;
  const sx = seedWidth / outputWidth;
  const sy = seedHeight / outputHeight;
  let y0 = Infinity, y1 = -Infinity;
  for (const s of stamps) {
    const ay = s.fromY * sy, by = s.toY * sy;
    const half = Math.max(minHalf, Math.min(maxHalf, s.radiusPx * sx));
    const lo = Math.max(0, Math.floor(Math.min(ay, by) - half));
    const hi = Math.min(seedHeight - 1, Math.ceil(Math.max(ay, by) + half));
    if (hi < lo) continue;
    if (lo < y0) y0 = lo;
    if (hi > y1) y1 = hi;
  }
  return y1 >= y0 ? { y0, y1 } : null;
}

export function unionBand(a: RowBand | null, b: RowBand | null): RowBand | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return { y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
}

export interface SeedBandTracker {
  /** This frame's written rows in; the rows to upload out (null: nothing changed, skip the upload). */
  next(written: RowBand | null): RowBand | null;
  /** The GPU copy is unknown (a new texture, a full upload): the next band is taken from scratch. */
  reset(): void;
}

export function createSeedBandTracker(): SeedBandTracker {
  let prev: RowBand | null = null;
  return {
    next(written) {
      const out = unionBand(prev, written);
      prev = written ? { ...written } : null;
      return out;
    },
    reset() { prev = null; },
  };
}
