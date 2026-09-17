// src/lab/sdf-zombie/webgpu/crowd-atlas.ts
// The shared prim texture of a crowd type: MAX_PRIMS wide, DATA_ROWS rows per
// band, one band per instance slot. A DataTexture cannot resize in place, so
// the band count is fixed at creation.
import * as THREE from 'three/webgpu';
import { DATA_ROWS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS } from './march.wgsl';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';

export function bandRowOffset(band: number): number { return band * DATA_ROWS; }

/** Uploads the first `rows` rows of the atlas to the EXISTING GPU texture in
 *  one queue write. The atlas owner supplies this (it holds the renderer).
 *  Omitting it keeps the legacy whole-atlas `needsUpdate` path for
 *  renderer-less tests. */
export type AtlasUploader = (rows: number, data: Float32Array) => void;

/** What a view needs to pack into "its" texture, whether it owns it or not. */
export interface PrimSink {
  readonly band: number;
  readonly texels: Float32Array;
  /** Row inside the band; same contract as the legacy writeRow(row, src, count, col). */
  writeRow(row: number, src: Float32Array, count: number, col?: number): void;
  /** Layout for `writeWounds(texels, ..., layout)` so wound rows land in this band. */
  readonly woundLayout: { maxWounds: number; woundRow: number; metaRow: number; capRow: number; flagsRow: number; stride: number };
  markDirty(): void;
}

export interface CrowdPrimAtlas {
  readonly bands: number;
  readonly texture: THREE.DataTexture;
  readonly texels: Float32Array;
  dirty: boolean;
  sink(band: number): PrimSink;
  /** Uploads the contiguous prefix that holds every dirty band up to `maxBand`
   *  (the highest band this frame actually draws) and clears the dirty flags.
   *  Returns the number of ROWS uploaded (0 when nothing had to go up).
   *
   *  Fire/gib fix (2026-09-14): slots are allocated lowest-first, so the bands
   *  written each frame are almost always a prefix [0, hi]. Uploading that
   *  prefix is ONE queue write of (hi+1) * DATA_ROWS rows — 22 rows / ~45 KB
   *  for one body — instead of re-sending the full 128 x 22 x 64 RGBA32F atlas
   *  (~2.9 MB) per type per frame. Under fire/gib the full upload stalled
   *  behind the busy GPU and cost 30-50 ms of draw submit in room 2, and it
   *  also inflated sdf:march (the upload serialises ahead of the pass).
   *  Bands above `maxBand` are not drawn this frame, so their CPU data waits
   *  and rides a later prefix (the view rewrites every band each frame). */
  flush(maxBand?: number): number;
}

export function createCrowdPrimAtlas(bands: number, upload?: AtlasUploader): CrowdPrimAtlas {
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * bands * 4);
  const texture = new THREE.DataTexture(texels, MAX_PRIMS, DATA_ROWS * bands, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  // Highest band written since the last flush (-1 = clean). Bands an actor
  // writes but never draws (hidden slot) still set it; that only widens the
  // prefix, never re-sends it twice. `bandDirty` is not needed because a dirty
  // band below the high-water mark rides the same prefix.
  let hiBand = -1;
  const atlas: CrowdPrimAtlas = {
    bands, texture, texels, dirty: false,
    sink(band) {
      const r0 = bandRowOffset(band);
      const mark = () => { if (band > hiBand) hiBand = band; atlas.dirty = true; };
      return {
        band, texels,
        writeRow(row, src, count, col = 0) {
          texels.set(src.subarray(0, count * 4), ((r0 + row) * MAX_PRIMS + col) * 4);
          mark();
        },
        woundLayout: {
          maxWounds: MAX_WOUNDS, stride: MAX_PRIMS,
          woundRow: r0 + ROW_WOUND, metaRow: r0 + ROW_WOUND_META,
          capRow: r0 + ROW_WOUND_CAP, flagsRow: r0 + ROW_WOUND_FLAGS,
        },
        markDirty: mark,
      };
    },
    flush(maxBand = bands - 1) {
      if (!atlas.dirty) return 0;
      const hi = Math.min(hiBand, maxBand);
      hiBand = -1;
      atlas.dirty = false;
      // Nothing to send: every written band sat above the drawn set.
      if (hi < 0) return 0;
      const rows = (hi + 1) * DATA_ROWS;
      if (upload) upload(rows, texels.subarray(0, rows * MAX_PRIMS * 4));
      else texture.needsUpdate = true; // legacy/no-uploader path (tests)
      return rows;
    },
  };
  return atlas;
}
