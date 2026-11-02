// src/lab/sdf-zombie/body-normal-bake/gpu-pack.ts
//
// Packs a body's prims for the bake field (bake.wgsl.ts): the game's own per-prim rows, written by the game's own
// writer (pack.ts writePrimRows), but one column per prim for as many prims as the body has (the runtime texture
// stops at MAX_PRIMS), and the fold-order prim list `sdBodyClosed` walks.
import { PRIM_STRIDE, primRole, writePrimRows, type PrimRows } from '../pack';
import {
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_BEND, ROW_PRIM_CLIP, ROW_PRIM_QUAT, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_SHELL,
  ROW_PRIM_STRAND, ROW_PRIM_WARP,
} from '../webgpu/march/layout';
import type { Body } from './regions';

/** The rows the bake leaves read, and where each lives in the data texture. */
const ROWS: readonly (readonly [keyof PrimRows, number])[] = [
  ['primA', ROW_PRIM_A], ['primB', ROW_PRIM_B], ['primScale', ROW_PRIM_SCALE], ['primQuat', ROW_PRIM_QUAT],
  ['primShape', ROW_PRIM_SHAPE], ['primBend', ROW_PRIM_BEND], ['primShell', ROW_PRIM_SHELL], ['primClip', ROW_PRIM_CLIP],
  ['primWarp', ROW_PRIM_WARP], ['primStrand', ROW_PRIM_STRAND],
];
export const BAKE_TEXTURE_ROWS = Math.max(...ROWS.map(r => r[1])) + 1;
/** Texels per 256-byte row (rgba32float): a texture upload's bytesPerRow must be a multiple of 256. */
const ROW_ALIGN = 16;

export interface BakePacked {
  /** Texture width in texels: the prim count rounded up to ROW_ALIGN. */
  width: number;
  height: number;
  /** rgba32float texels, row-major, `width * height * 4` floats. */
  texels: Float32Array;
  /** Every live cluster's prims in fold order: the list `sdBodyClosed` walks. */
  list: Uint32Array;
}

export function packBakeBody(body: Body): BakePacked {
  const n = Math.max(1, body.prims.length);
  const rows = Object.fromEntries(
    ['primA', 'primB', 'primScale', 'primQuat', 'primShape', 'primBend', 'primColor', 'primShell', 'primClip', 'primWarp', 'primStrand', 'restA', 'restB']
      .map(k => [k, new Float32Array(n * PRIM_STRIDE)]),
  ) as unknown as PrimRows;
  body.prims.forEach((p, i) => writePrimRows(rows, p, i, primRole(p), undefined));
  const width = Math.ceil(n / ROW_ALIGN) * ROW_ALIGN;
  const height = BAKE_TEXTURE_ROWS;
  const texels = new Float32Array(width * height * 4);
  for (const [key, row] of ROWS) texels.set(rows[key].subarray(0, body.prims.length * PRIM_STRIDE), row * width * 4);
  const list: number[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) list.push(i);
  }
  return { width, height, texels, list: Uint32Array.from(list) };
}
