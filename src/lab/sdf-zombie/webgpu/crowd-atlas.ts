// src/lab/sdf-zombie/webgpu/crowd-atlas.ts
// The shared prim texture of a crowd type: MAX_PRIMS wide, DATA_ROWS rows per
// band, one band per instance slot. A DataTexture cannot resize in place, so
// the band count is fixed at creation.
import * as THREE from 'three/webgpu';
import { DATA_ROWS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS } from './march.wgsl';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';

export function bandRowOffset(band: number): number { return band * DATA_ROWS; }

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
  /** Uploads if dirty; once per frame. */
  flush(): void;
}

export function createCrowdPrimAtlas(bands: number): CrowdPrimAtlas {
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * bands * 4);
  const texture = new THREE.DataTexture(texels, MAX_PRIMS, DATA_ROWS * bands, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  const atlas: CrowdPrimAtlas = {
    bands, texture, texels, dirty: false,
    sink(band) {
      const r0 = bandRowOffset(band);
      return {
        band, texels,
        writeRow(row, src, count, col = 0) {
          texels.set(src.subarray(0, count * 4), ((r0 + row) * MAX_PRIMS + col) * 4);
          atlas.dirty = true;
        },
        woundLayout: {
          maxWounds: MAX_WOUNDS, stride: MAX_PRIMS,
          woundRow: r0 + ROW_WOUND, metaRow: r0 + ROW_WOUND_META,
          capRow: r0 + ROW_WOUND_CAP, flagsRow: r0 + ROW_WOUND_FLAGS,
        },
        markDirty() { atlas.dirty = true; },
      };
    },
    flush() { if (atlas.dirty) { texture.needsUpdate = true; atlas.dirty = false; } },
  };
  return atlas;
}
