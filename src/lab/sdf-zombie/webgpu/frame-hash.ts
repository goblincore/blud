// src/lab/sdf-zombie/webgpu/frame-hash.ts
//
// THE FRAME HASH — deterministic demo recordings, stage 2 (2026-09-10).
// Plan: docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md
//
// WHY THIS EXISTS. On 2026-09-10 two of this project's own bugs shipped to the
// owner's eyes and were caught by PLAYTEST, not by a gate:
//
//   - `?dynrays` / `?dynlights` booted every unparameterised page with ZERO
//     rays and an empty light list (`Number(null) === 0` passing a `>= 0`
//     guard), zeroing the dynamic probe layer — characters in the player's room
//     rendered as BLACK SILHOUETTES.
//   - `?tracerlightslots` defaulted to 0, so tracer lights never fed the gather.
//
// Both are INVISIBLE to the CPU tests and both change rendered pixels. A
// per-frame hash of the march/dynamic-layer output fails on the exact frame
// either one ships, with no quiet machine and no human in the loop. That is the
// whole point: it converts "needs the owner's eyes" into "compare a number".
// It is also the only available check on the WGSL transcription of the three
// 2026-09-10 gather optimisations, which are proven only at the CPU-twin level
// (probe-dynamic-cull.test.ts).
//
// PURITY CONTRACT. Nothing in this file touches THREE, the DOM, or a GPU. That
// is deliberate: the same functions are used in-page by demo-hash.ts and in
// node by the compare script, so the digest a recorder stamps and the digest a
// comparer reads back cannot drift apart. Everything here is unit-tested in
// frame-hash.test.ts.
//
// WHAT A HASH IS AND IS NOT. It is an EXACT-equality check on bit patterns. It
// is therefore a same-build, same-GPU, same-driver comparison and nothing more:
// do not expect a hash to survive a driver bump, and do not use one to compare
// machines. See "Payoff, stated honestly" in the plan.

/** FNV-1a 32-bit, offset basis and prime per the reference implementation. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** The scratch used to read a float's BIT PATTERN. `Math.fround`/`| 0` would
 *  round and destroy exactly the sub-LSB differences this tool exists to
 *  detect — the flicker-clock wobble measured on 2026-09-05 moved ~19% of
 *  pixels at sub-LSB level. */
const floatScratch = new Float32Array(1);
const u32Scratch = new Uint32Array(floatScratch.buffer);

/** One FNV-1a step. */
function fnvStep(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME);
}

/** FNV-1a (32-bit) over raw bytes. Unsigned by construction. */
export function fnv1aBytes(bytes: ArrayLike<number>, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) h = fnvStep(h, bytes[i] ?? 0);
  return h >>> 0;
}

/** FNV-1a (32-bit) over numbers, each taken as its float32 BIT PATTERN. An f32
 *  render target therefore hashes exactly as it lies in memory, and a value
 *  that does not survive narrowing to f32 hashes as the value it becomes. */
export function fnv1aFloats(values: ArrayLike<number>, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < values.length; i++) {
    floatScratch[0] = values[i] ?? 0;
    const bits = u32Scratch[0] ?? 0;
    h = fnvStep(h, bits & 0xff);
    h = fnvStep(h, (bits >>> 8) & 0xff);
    h = fnvStep(h, (bits >>> 16) & 0xff);
    h = fnvStep(h, (bits >>> 24) & 0xff);
  }
  return h >>> 0;
}

/** Readback geometry of one texture-like layer. */
export interface TexelLayout {
  /** Logical width in texels (bytes if `bytesPerTexel` is 1). */
  width: number;
  /** Logical height in texels. */
  height: number;
  /** Logical bytes per texel — 16 for an rgba32f render target, 4 for a
   *  single f32 channel, 1 for a raw byte layer. */
  bytesPerTexel: number;
  /** Physical bytes per row in the readback, INCLUDING the driver's row
   *  padding. WebGPU rounds the bytes-per-row copy pitch up to 256. */
  rowStrideBytes: number;
}

/** WebGPU's required bytes-per-row multiple for buffer↔texture copies. */
export const ROW_ALIGN = 256;

/** The padded row stride, in bytes, for a row of `bytes` logical bytes. */
export function paddedRowStrideBytes(bytes: number, align = ROW_ALIGN): number {
  return Math.ceil(bytes / align) * align;
}

/** The padded row stride in FLOATS for a float readback of `width` texels of
 *  `floatsPerTexel` floats each. This is the form the in-page readbacks need,
 *  because readRenderTargetPixelsAsync hands back a float array whose rows are
 *  padded and therefore NOT densely packed. */
export function paddedRowStrideFloats(width: number, floatsPerTexel: number, align = ROW_ALIGN): number {
  return paddedRowStrideBytes(width * floatsPerTexel * 4, align) / 4;
}

/**
 * Copy the LOGICAL texels out of a padded readback, dropping the row padding.
 *
 * THE PADDING IS THE POINT. A digest over the raw buffer would fold the
 * driver's padding bytes into the hash, and those are uninitialised: two runs
 * could differ on bytes that are not part of the image, and the gate would
 * report a divergence that no pixel shows. Every readback in this file is
 * therefore de-padded BEFORE it is hashed.
 *
 * Throws when the source cannot hold the region rather than silently reading
 * `undefined` as 0 — a partial readback that hashes to a plausible number is a
 * gate that fails open, which is the exact failure class this tool exists to
 * catch.
 */
export function packTexelRegion(
  src: ArrayLike<number>,
  layout: TexelLayout,
  region: { x: number; y: number; w: number; h: number },
): number[] {
  const { width, height, bytesPerTexel, rowStrideBytes } = layout;
  const floatsPerTexel = bytesPerTexel / 4;
  if (!Number.isInteger(floatsPerTexel)) {
    throw new Error(`packTexelRegion: bytesPerTexel ${bytesPerTexel} is not a whole number of float32`);
  }
  if (region.x < 0 || region.y < 0 || region.x + region.w > width || region.y + region.h > height) {
    throw new Error(
      `packTexelRegion: region ${region.w}x${region.h}+${region.x}+${region.y} is outside ${width}x${height}`,
    );
  }
  const strideFloats = rowStrideBytes / 4;
  const rowFloats = region.w * floatsPerTexel;
  const out: number[] = new Array(region.h * rowFloats);
  let o = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    const rowStart = y * strideFloats + region.x * floatsPerTexel;
    const rowEnd = rowStart + rowFloats;
    if (rowEnd > src.length) {
      throw new Error(
        `packTexelRegion: readback holds ${src.length} floats, row ${y} needs up to ${rowEnd} — ` +
          `stride ${strideFloats} is wrong for this layer`,
      );
    }
    for (let i = rowStart; i < rowEnd; i++) out[o++] = src[i] ?? 0;
  }
  return out;
}

/** One layer's digest plus the bounded numbers that make a failure readable
 *  without a second readback. */
export interface LayerHash {
  /** FNV-1a over the layer's logical texels. */
  hash: number;
  width: number;
  height: number;
  /** Logical floats hashed — a size change is itself a divergence signal. */
  floats: number;
  /** Bounded activity counters, layer-specific. These are what turn "the hash
   *  differs" into "the layer is ZERO", which is the whole diagnostic value:
   *  the black-silhouette bug was a hash mismatch whose cause was visible in
   *  these numbers alone. */
  stats: Record<string, number>;
}

/** Every layer a frame hash covers, plus how many tiles the frame was split
 *  into for localisation. */
export interface FrameHash {
  /** Bumped when the SET of layers or their tile geometry changes, so a
   *  stored recording cannot be silently compared against a differently
   *  shaped instrument. */
  version: number;
  frame: number;
  /** Tiles across and down. Tile (tx, ty) covers [tx*w/TW, (tx+1)*w/TW) etc. */
  tilesX: number;
  tilesY: number;
  layers: Record<string, LayerHash>;
  /** Per-layer, per-tile digests in row-major tile order. Small integers only,
   *  so a whole recording crosses CDP as plain JSON. */
  tiles: Record<string, number[]>;
}

/** The current instrument shape. Bump on any change to the layer set or the
 *  tile geometry: a recording made with a different version is not comparable,
 *  and comparing it anyway would produce a phantom divergence. */
export const FRAME_HASH_VERSION = 1;

/** One layer, already de-padded and ready to digest. */
/** Numeric texels, as either a plain array or a typed array. Only the
 *  operations the digester actually uses are declared, so the in-page path can
 *  hand over a Float32Array view without a copy while the tests hand over plain
 *  arrays. */
export interface Texels extends ArrayLike<number> {
  slice(start?: number, end?: number): ArrayLike<number>;
}

/** A de-padded layer, ready to digest. */
export interface TileLayerInput {
  key: string;
  texels: Texels;
  width: number;
  height: number;
  floatsPerTexel: number;
}

/** Split a frame into (tilesX x tilesY) tile digests per layer. The point is
 *  LOCALISATION: a whole-frame mismatch says "something moved", a tile map
 *  says WHERE, which is the difference between a gate someone uses and a gate
 *  someone switches off. */
export function hashTiles(
  layers: ReadonlyArray<TileLayerInput>,
  tilesX: number,
  tilesY: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const layer of layers) {
    const per: number[] = [];
    // Integer tile edges derived by multiply-divide rather than an accumulating
    // step: every texel lands in exactly one tile, and a width that does not
    // divide evenly cannot drift or drop a column.
    for (let ty = 0; ty < tilesY; ty++) {
      const y0 = Math.floor((ty * layer.height) / tilesY);
      const y1 = Math.floor(((ty + 1) * layer.height) / tilesY);
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = Math.floor((tx * layer.width) / tilesX);
        const x1 = Math.floor(((tx + 1) * layer.width) / tilesX);
        let h = FNV_OFFSET;
        for (let y = y0; y < y1; y++) {
          const rowStart = (y * layer.width + x0) * layer.floatsPerTexel;
          const rowEnd = (y * layer.width + x1) * layer.floatsPerTexel;
          h = fnv1aFloats(layer.texels.slice(rowStart, rowEnd), h);
        }
        per.push(h);
      }
    }
    out[layer.key] = per;
  }
  return out;
}

/** Result of comparing two recorded frames. */
export interface FrameHashComparison {
  frame: number;
  /** True when every layer hash matches. */
  equal: boolean;
  /** Layers whose whole-frame digest differs. */
  changedLayers: string[];
  /** For each changed layer, how the bounded stats moved — the part that names
   *  the CAUSE ("nonzero 10 -> 0") rather than the symptom. */
  statChanges: Record<string, Record<string, { from: number; to: number }>>;
  /** Changed tile positions per layer, as `ty * tilesX + tx` indices. Tile
   *  count is compared too: a tile-map size change is a shape change. */
  changedTiles: Record<string, number[]>;
}

/** Compare two frames of the same recording shape. */
export function compareFrames(a: FrameHash, b: FrameHash): FrameHashComparison {
  const changedLayers: string[] = [];
  const statChanges: Record<string, Record<string, { from: number; to: number }>> = {};
  const changedTiles: Record<string, number[]> = {};

  for (const key of Object.keys(a.layers).sort()) {
    const la = a.layers[key];
    const lb = b.layers[key];
    if (!la || !lb) {
      changedLayers.push(key);
      continue;
    }
    const stats: Record<string, { from: number; to: number }> = {};
    for (const sk of Object.keys(la.stats).sort()) {
      const from = la.stats[sk] ?? NaN;
      const to = lb.stats[sk];
      if (to === undefined || !Object.is(from, to)) stats[sk] = { from, to: to ?? NaN };
    }
    const ta = a.tiles[key] ?? [];
    const tb = b.tiles[key] ?? [];
    const tiles: number[] = [];
    if (ta.length !== tb.length) {
      // A different tile map is a shape change, not a pixel change: report it
      // as every tile so it cannot be mistaken for a localised edit.
      for (let i = 0; i < Math.max(ta.length, tb.length); i++) tiles.push(i);
    } else {
      for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) tiles.push(i);
    }
    if (la.hash !== lb.hash || la.floats !== lb.floats) changedLayers.push(key);
    if (Object.keys(stats).length) statChanges[key] = stats;
    if (tiles.length) changedTiles[key] = tiles;
  }
  for (const key of Object.keys(b.layers).sort()) {
    if (!a.layers[key]) changedLayers.push(key);
  }
  return {
    frame: a.frame,
    equal: changedLayers.length === 0,
    changedLayers: [...new Set(changedLayers)].sort(),
    statChanges,
    changedTiles,
  };
}

/**
 * THE GATE'S ONE JOB: find the first frame where two recordings diverge.
 *
 * Compares the common prefix and reports it, so a long identical prefix (the
 * expected result of a replay) is provable rather than inferred from a single
 * end-of-run number. A length difference IS divergence, because a replay that
 * produced a different NUMBER of frames has already diverged in step or cull
 * behaviour.
 */
export function firstDivergence(a: FrameHash[], b: FrameHash[]): FrameHashComparison | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const fa = a[i], fb = b[i];
    if (!fa || !fb) break;
    const c = compareFrames(fa, fb);
    if (!c.equal) return c;
  }
  if (a.length !== b.length) {
    return {
      frame: n,
      equal: false,
      changedLayers: ['<recording-length>'],
      statChanges: { '<recording-length>': { frames: { from: a.length, to: b.length } } },
      changedTiles: {},
    };
  }
  return null;
}

/** Human-readable one-liner for a comparison, for the recorder's log. */
export function describeComparison(c: FrameHashComparison, tilesX: number): string {
  if (c.equal) return `frame ${c.frame}: identical`;
  const parts: string[] = [];
  for (const layer of c.changedLayers) {
    const tiles = c.changedTiles[layer];
    const where = tiles && tiles.length
      ? `${tiles.length} tile(s): ${tiles.slice(0, 8).map((i) => `(${i % tilesX},${Math.floor(i / tilesX)})`).join(' ')}${tiles.length > 8 ? ' …' : ''}`
      : 'no tile moved';
    const stats = c.statChanges[layer];
    const why = stats && Object.keys(stats).length
      ? ` [${Object.entries(stats).map(([k, v]) => `${k} ${v.from}→${v.to}`).join(', ')}]`
      : '';
    parts.push(`${layer}: ${where}${why}`);
  }
  return `frame ${c.frame}: DIVERGED — ${parts.join('; ')}`;
}
