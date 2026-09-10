// src/lab/sdf-zombie/webgpu/demo-hash.ts
//
// THE FRAME HASH, in-page half. Deterministic demo recordings stage 2
// (2026-09-10). Plan:
// docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md
//
// THE SPLIT. frame-hash.ts is the pure, tested digest and comparison maths —
// no THREE, no DOM, no GPU — so the recorder and any node-side comparer share
// exactly one implementation. This file is the engine-coupled part that feeds
// it: it reads the layers back off the GPU and hands their logical texels to
// the pure digester. Nothing here is testable without a GPU, so there is
// deliberately as little of it as possible.
//
// WHAT IT HASHES, AND WHY THOSE LAYERS.
//
//   marchTarget  the SDF march output — the primary image before compositing.
//                This is where the black-silhouette bug lived: the dynamic
//                probe layer went to zero and the marched characters came out
//                black. It is also where the three 2026-09-10 gather
//                optimisations (capsule cull, any-hit shadow, box-first
//                reorder) would show a transcribing error.
//   probeDyn     the gather's dynamic probe layer, straight off the storage
//                buffer. A layer that reads all-zero is the EXACT shipped
//                regression, and the bounded stats say so in words.
//
// WHY NOT THE COMPOSITED SCREEN. The shipped 'bodies' field style is
// interlaced: alternate frames carry held rows by design, so a screen hash
// differs between two frames that are both correct. Screen-level hashing needs
// field-parity freeze plumbing first and is a later stage. Target-level hashing
// needs no such thing and covers the bug classes that actually shipped.
//
// EVERY READBACK IS DE-PADDED. WebGPU pads copy rows to 256 bytes; the padding
// is uninitialised, so hashing it would report divergence on bytes no pixel
// owes anything to. See packTexelRegion.

import type { FrameHash, LayerHash, TexelLayout, Texels } from './frame-hash';
import {
  FRAME_HASH_VERSION,
  fnv1aFloats,
  hashTiles,
  packTexelRegion,
  paddedRowStrideFloats,
} from './frame-hash';

/** All-zero probe layer, as a bounded number: the exact shipped regression. */
export const DEFAULT_TILES_X = 4;
export const DEFAULT_TILES_Y = 3;

/** One GPU layer, already read back and de-padded. */
export interface HashLayerInput {
  key: string;
  texels: Texels;
  width: number;
  height: number;
  floatsPerTexel: number;
  /** Bounded, layer-specific activity counters. These are what make a
   *  mismatch diagnosable: "hash differs" hunts, "nonzero 12 → 0" does not. */
  stats: Record<string, number>;
}

/** Bounded activity counters over a digest buffer. Bounded by construction:
 *  counts, a fraction, and extents — never a per-texel array, so a whole
 *  recording crosses CDP as plain JSON. */
export function digestStats(texels: ArrayLike<number>, opts: { channels: number; channel?: number }): Record<string, number> {
  const ch = opts.channel ?? 0;
  const n = opts.channels;
  let zero = 0, nonZero = 0, nonFinite = 0;
  let min = Infinity, max = -Infinity;
  for (let i = ch; i < texels.length; i += n) {
    const v = texels[i];
    if (v === undefined) continue;
    if (!Number.isFinite(v)) { nonFinite++; continue; }
    if (v === 0) zero++; else nonZero++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const total = zero + nonZero + nonFinite;
  return {
    // `nonZero` is the headline number for the regression this tool exists to
    // catch: a zeroed layer turns it into 0 and leaves every other stat
    // plausible.
    nonZero,
    nonFinite,
    zeroFractionMillionths: total ? Math.round((zero / total) * 1e6) : 0,
    min: Number.isFinite(min) ? quantise(min) : 0,
    max: Number.isFinite(max) ? quantise(max) : 0,
    sampled: total,
  };
}

/** Round to a bounded precision so a stat cannot grow into a float that
 *  serialises to 17 digits and destabilises a comparison. Six significant
 *  digits is far below render resolution and far above noise. */
function quantise(v: number): number {
  if (v === 0) return 0;
  const mag = Math.abs(v);
  const digits = Math.max(0, 5 - Math.floor(Math.log10(mag)));
  const f = 10 ** Math.min(12, digits);
  return Math.round(v * f) / f;
}

/** Digest one already-de-padded layer, tiles included. */
export function digestLayer(
  input: HashLayerInput,
  tiles: { x: number; y: number },
): { layer: LayerHash; tiles: number[] } {
  const layer: LayerHash = {
    hash: fnv1aFloats(input.texels),
    width: input.width,
    height: input.height,
    floats: input.texels.length,
    stats: input.stats,
  };
  const tileMap = hashTiles(
    [{ key: input.key, texels: input.texels, width: input.width, height: input.height, floatsPerTexel: input.floatsPerTexel }],
    tiles.x,
    tiles.y,
  );
  return { layer, tiles: tileMap[input.key] ?? [] };
}

/** Assemble the FrameHash the recorder stores. Order of `inputs` is preserved
 *  in nothing observable — layers are keyed — but the tile geometry is fixed
 *  per call so two frames of one recording are always comparable. */
export function buildFrameHash(
  frame: number,
  inputs: HashLayerInput[],
  tiles: { x: number; y: number } = { x: DEFAULT_TILES_X, y: DEFAULT_TILES_Y },
): FrameHash {
  const layers: Record<string, LayerHash> = {};
  const tileDigests: Record<string, number[]> = {};
  for (const input of inputs) {
    const { layer, tiles: t } = digestLayer(input, tiles);
    layers[input.key] = layer;
    tileDigests[input.key] = t;
  }
  return { version: FRAME_HASH_VERSION, frame, tilesX: tiles.x, tilesY: tiles.y, layers, tiles: tileDigests };
}

/** The renderer/services this instrument needs. Structural on purpose: the
 *  game passes its own handle, and a test double can pass a stub. */
export interface DemoHashDeps {
  /** Logical size of the march target plus a readback of it, row padding
   *  included (the caller must NOT try to de-pad; that is this module's job
   *  and doing it twice is how the stride gets miscounted). */
  readMarchTarget(): Promise<{ width: number; height: number; floatsPerTexel: number; data: ArrayLike<number> }>;
  /** The gather's dynamic layer, flat, or null when the gather is not bound.
   *  A missing layer is a legitimate boot (no gather on this page), which is
   *  why it is optional rather than an error. */
  readProbeDyn(): Promise<ArrayLike<number> | null>;
  /** THE GATHER'S PACKED INPUTS: the bone capsule instances it is about to
   *  gather against, as the gather's own `INSTANCE_FLOATS`-strided array plus
   *  the live count. Optional.
   *
   *  WHY A THIRD LAYER (2026-09-10). With parity held, the seed pinned and the
   *  dispatch count identical, two boots still produced different dynamic
   *  layers — so the divergence enters through the gather's INPUTS, not its
   *  history. This layer is the first place to look: if the capsules differ
   *  between boots, the divergence is upstream in posing/instancing; if they
   *  match while `probeDyn` differs, the inputs were identical and the fault is
   *  in the gather itself. Either answer is decisive, which is why it is worth
   *  18 KB of readback. */
  readInstances?(): Promise<{ data: ArrayLike<number>; count: number; floatsPerInstance: number } | null>;
}

/** Hash one frame's render output. The caller owns freeze/step ordering: this
 *  function reads whatever is currently rendered and does not advance the
 *  simulation, which is what makes a recorded frame reproducible. */
export async function hashFrame(deps: DemoHashDeps, frame: number, tiles?: { x: number; y: number }): Promise<FrameHash> {
  const inputs: HashLayerInput[] = [];

  const march = await deps.readMarchTarget();
  if (!march || !march.width || !march.height) {
    // Fail LOUD. A hash seam that silently hashes nothing is worse than no
    // hash seam: it reports "identical" forever and gets trusted. This is the
    // same fail-open shape as the boot-param bug that motivated the tool.
    throw new Error('frameHash: marchTarget readback is empty — the hash seam is not wired to a render target');
  }
  const floatsPerTexel = march.floatsPerTexel || 4;
  const marchLayout: TexelLayout = {
    width: march.width,
    height: march.height,
    bytesPerTexel: floatsPerTexel * 4,
    rowStrideBytes: paddedRowStrideFloats(march.width, floatsPerTexel) * 4,
  };
  const rgba = packTexelRegion(march.data, marchLayout, { x: 0, y: 0, w: march.width, h: march.height });
  inputs.push({
    key: 'marchTarget',
    texels: rgba,
    width: march.width,
    height: march.height,
    floatsPerTexel,
    stats: digestStats(rgba, { channels: floatsPerTexel }),
  });

  const dyn = await deps.readProbeDyn();
  if (dyn && dyn.length) {
    // The probe layer is a packed storage buffer: 4 vec4 per probe, no row
    // padding, probe-major. Hashed WHOLE rather than per-probe, because a
    // probe-count change is a real divergence and mixing it with a per-probe
    // walk would hide that.
    inputs.push({
      key: 'probeDyn',
      // One probe per "row" with its true width, so the tile map splits it by
      // probe index and a half-zeroed grid localises to a tile.
        texels: Array.from(dyn),
      width: dyn.length / 16,
      height: 1,
      floatsPerTexel: 16,
      stats: digestStats(dyn, { channels: 1 }),
    });
  }

  const inst = (await deps.readInstances?.()) ?? null;
  if (inst && inst.count > 0 && inst.data.length) {
    // BONE INSTANCES: one row per instance, `floatsPerInstance` floats wide, so
    // the tile map splits them by instance index and a subset that changed
    // localises to the bodies that caused it. Trimmed to the LIVE count — the
    // allocation is a fixed 1024 slots, and hashing unused tail slots would fold
    // uninitialised memory into the digest, which is exactly the failure mode
    // the de-padding note above exists to prevent.
    const used = Math.min(inst.count * inst.floatsPerInstance, inst.data.length);
    inputs.push({
      key: 'instances',
      texels: Array.from({ length: used }, (_, i) => inst.data[i] ?? 0),
      width: inst.count,
      height: 1,
      floatsPerTexel: inst.floatsPerInstance,
      stats: { ...digestStats(inst.data, { channels: inst.floatsPerInstance, channel: 0 }), count: inst.count },
    });
  }

  return buildFrameHash(frame, inputs, tiles);
}
