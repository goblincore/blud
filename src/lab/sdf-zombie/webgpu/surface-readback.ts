// src/lab/sdf-zombie/webgpu/surface-readback.ts
//
// THE ONE FORMAT-AWARE READBACK DECODER for the deferred surface target
// (hybrid deferred M2, task-6 recovery). Every CPU-side consumer of
// `renderer.readRenderTargetPixelsAsync` on the surface contract — the
// single-pixel `readSurfaceAt`, the whole-frame `hashSurface`, and the
// batched `sampleSurfacePoints` — decodes through THESE helpers, so the
// format arithmetic exists in exactly one audited place.
//
// TWO hazards this centralises (both found the hard way in review):
//
// 1. ROW PADDING. Three's WebGPU backend `copyTextureToBuffer` aligns
//    `bytesPerRow` to 256 (WebGPUTextureUtils.js) and returns that padded
//    buffer UNCHANGED — at width 800 an r32float row is 832 floats, not
//    800. Dense `(y * width + x)` indexing silently reads the padding (or a
//    neighbouring row) for every row after the first and still yields
//    plausible numbers. `paddedRowBytes` is the shared stride arithmetic;
//    the texel readers apply it.
//
// 2. HALF DECODE. rgba16float readbacks arrive as raw uint16 bit patterns.
//    `halfToFloat` is an exact IEEE 754 binary16 decoder — including
//    SUBNORMALS (exp=0, frac>0 = ±frac * 2^-24, valid nonzero numbers), a
//    case the previous ad-hoc decoder folded to NaN by multiplying a zero
//    significand by itself.
//
// Attachment formats (deferred-surface.ts contract): albedoRoughness,
// normalMetalness, emissionClass are RGBA16F (8 B/texel); surfaceDepth is
// R32F (4 B/texel). The readers here are typed per format — passing the
// wrong array or width is a caller bug, not silently decoded garbage.

/** Exact IEEE 754 binary16 ("half float") decode, bit pattern -> number.
 *  Handles all six bit classes: ±zero, subnormals (exact fractions of
 *  2^-14), normals, ±Infinity, NaN. */
export function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) >> 15;
  const exp = (bits & 0x7c00) >> 10;
  const frac = bits & 0x03ff;
  if (exp === 0) {
    // ±zero (frac 0) and subnormals: ±frac * 2^-14 / 1024 = ±frac * 2^-24.
    return sign ? -frac * 2 ** -24 : frac * 2 ** -24;
  }
  if (exp === 31) {
    return frac ? Number.NaN : sign ? -Infinity : Infinity;
  }
  return (sign ? -1 : 1) * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** The WebGPU COPY buffer row stride in BYTES for a readback of `width`
 *  texels of `bytesPerTexel` each: three's backend aligns bytesPerRow up to
 *  a 256-byte boundary (and leaves the LAST row unpadded). */
export function paddedRowBytes(width: number, bytesPerTexel: number): number {
  return Math.ceil((width * bytesPerTexel) / 256) * 256;
}

/** Row stride in Float32 ELEMENTS for an r32float readback of `width`
 *  columns. Multiply by the row index, add the column. */
export function r32fRowStride(width: number): number {
  return paddedRowBytes(width, 4) / 4;
}

/** Row stride in Uint16 ELEMENTS for an rgba16float readback of `width`
 *  columns. Multiply by the row index, add `x * 4 + channel`. */
export function rgba16fRowStride(width: number): number {
  return paddedRowBytes(width, 8) / 2;
}

/** Read ONE r32float texel (the surfaceDepth attachment): value at pixel
 *  (px, py), honouring the 256-byte row padding of the source buffer. */
export function readR32FTexel(buf: Float32Array, width: number, px: number, py: number): number {
  return buf[py * r32fRowStride(width) + px]!;
}

/** Read ONE rgba16float texel (albedo/normal/class attachments) into `out`
 *  (length >= 4: [r, g, b, a] as numbers), honouring row padding. */
export function readRgba16FTexel(
  buf: Uint16Array,
  width: number,
  px: number,
  py: number,
  out: Float32Array,
): Float32Array {
  const base = py * rgba16fRowStride(width) + px * 4;
  for (let c = 0; c < 4; c++) out[c] = halfToFloat(buf[base + c]!);
  return out;
}
