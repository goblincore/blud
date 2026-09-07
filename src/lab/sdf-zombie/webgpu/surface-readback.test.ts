// src/lab/sdf-zombie/webgpu/surface-readback.test.ts
//
// CPU-ONLY fixtures for the shared surface-readback decoder (task-6
// recovery). No GPU, no renderer, no browser — the decoder is pure
// arithmetic over typed arrays and must be exact:
//
// - IEEE 754 binary16 across ALL SIX bit classes: ±zero, subnormals (the
//   previous ad-hoc decoder folded valid nonzero subnormals to NaN),
//   normals, ±Inf, NaN.
// - RGBA16F vs R32F texel reads on buffers with REAL WebGPU row padding
//   (bytesPerRow = ceil(w * bytesPerTexel / 256) * 256, last row unpadded —
//   three 0.185 WebGPUTextureUtils.copyTextureToBuffer): width 800 (the
//   game buffer; an R32F row is 832 floats, NOT 800) and an odd width.
// - First and last rows and multiple coordinates — the old dense
//   (y * width + x) indexing was correct only at row 0 and quietly wrong
//   everywhere else.
import { describe, it, expect } from 'vitest';
import {
  halfToFloat,
  paddedRowBytes,
  r32fRowStride,
  rgba16fRowStride,
  readR32FTexel,
  readRgba16FTexel,
} from './surface-readback';

describe('halfToFloat — IEEE 754 binary16, all bit classes', () => {
  it('decodes exact table values', () => {
    const cases: Array<[number, number, string]> = [
      [0x0000, 0, '+zero'],
      [0x0001, 2 ** -24, 'smallest subnormal'],
      [0x8001, -(2 ** -24), 'negative smallest subnormal'],
      [0x03ff, 1023 * 2 ** -24, 'largest subnormal (was NaN before the fix)'],
      [0x83ff, -(1023 * 2 ** -24), 'negative largest subnormal'],
      [0x0400, 2 ** -14, 'smallest NORMAL'],
      [0x0401, (1 + 1 / 1024) * 2 ** -14, 'second-smallest normal'],
      [0x3c00, 1, 'one'],
      [0xbc00, -1, 'negative one'],
      [0x3555, 0.333251953125, 'half nearest 1/3'],
      [0x4777, 7.46484375, 'normal with full mantissa bits'],
      [0x7bff, 65504, 'max finite half'],
    ];
    for (const [bits, expected, label] of cases) {
      expect(halfToFloat(bits), label).toBe(expected);
    }
  });
  it('preserves the sign of zero (Object.is)', () => {
    expect(Object.is(halfToFloat(0x0000), 0)).toBe(true);
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
  });
  it('decodes infinities exactly', () => {
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0xfc00)).toBe(-Infinity);
  });
  it('decodes NaN for exp=31 frac!=0 (any payload)', () => {
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
    expect(Number.isNaN(halfToFloat(0x7e01))).toBe(true);
    expect(Number.isNaN(halfToFloat(0xfe00))).toBe(true);
  });
  it('round-trips every probed NORMAL bit pattern through an exact re-encode', () => {
    // half -> f32 is exact; re-encoding the decoded f32 back to half bits
    // must reproduce the original pattern for every normal value.
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    const reencode = (v: number): number => {
      f32[0] = v;
      const u = u32[0]!;
      const sign = (u >>> 16) & 0x8000;
      const exp32 = (u >>> 23) & 0xff;
      if (exp32 === 0xff) return sign | 0x7c00;
      if (exp32 === 0) return sign; // sweep covers normals only
      const exp = exp32 - 127 + 15;
      return sign | (exp << 10) | ((u & 0x7fffff) >>> 13);
    };
    for (let bits = 0x0400; bits < 0x7c00; bits += 97) {
      const v = halfToFloat(bits);
      expect(Number.isFinite(v), `bits ${bits.toString(16)} must decode finite`).toBe(true);
      expect(reencode(v), `bits ${bits.toString(16)} round-trip`).toBe(bits);
    }
  });
});

describe('row strides — three 0.185 WebGPU copyTextureToBuffer padding', () => {
  it('width 800 R32F: bytesPerRow 3328 -> 832 floats, not 800', () => {
    // 800 * 4 = 3200 -> ceil(3200/256)=13 -> 3328 bytes -> 832 f32 elements.
    expect(paddedRowBytes(800, 4)).toBe(3328);
    expect(r32fRowStride(800)).toBe(832);
    expect(r32fRowStride(800)).not.toBe(800); // the hazard, made explicit
  });
  it('width 800 RGBA16F: 6400 bytes is already 256-aligned (no pad)', () => {
    expect(paddedRowBytes(800, 8)).toBe(6400);
    expect(rgba16fRowStride(800)).toBe(3200);
  });
  it('odd width 801 pads both formats', () => {
    // 801*4 = 3204 -> ceil(3204/256)=13 -> 3328 bytes = 832 f32 (NOT 801);
    // 801*8 = 6408 -> 26*256 = 6656 bytes = 3328 u16 (NOT 3204).
    expect(r32fRowStride(801)).toBe(832);
    expect(r32fRowStride(801)).not.toBe(801);
    expect(rgba16fRowStride(801)).toBe(3328);
  });
});

/** Build a readback buffer shaped EXACTLY like three's WebGPU backend:
 *  (height-1) padded rows + one UNPADDED last row (mrdoob#31658 sizing).
 *  Padding is filled with 0xAB bytes so decoded garbage is detectable. */
function paddedBuffer(width: number, height: number, bytesPerTexel: number): Uint8Array {
  const bytesPerRow = paddedRowBytes(width, bytesPerTexel);
  const size = (height - 1) * bytesPerRow + width * bytesPerTexel;
  return new Uint8Array(size).fill(0xab);
}

/** f32 -> half BITS (exact for exactly representable values, which every
 *  fixture value is). The G-buffer stores half BIT PATTERNS; a fixture that
 *  writes raw integers writes subnormal bit patterns instead — exactly the
 *  confusion the NaN-subnormal bug was about. exp32 === 0 (f32 zero and
 *  subnormals) maps to half subnormal/zero range — fixtures only use zero. */
function f32ToHalfBits(v: number): number {
  const f = new Float32Array(1);
  f[0] = v;
  const u = new Uint32Array(f.buffer)[0]!;
  const sign = (u >>> 16) & 0x8000;
  const exp32 = (u >>> 23) & 0xff;
  if (exp32 === 0xff) return sign | 0x7c00;
  if (exp32 === 0) return sign | ((u & 0x7fffff) >>> 13); // zero (fixtures)
  const exp = exp32 - 127 + 15;
  return sign | (exp << 10) | ((u & 0x7fffff) >>> 13);
}

describe('readR32FTexel — padded rows, first/last rows, multiple coordinates', () => {
  const W = 800, H = 600;
  const buf = paddedBuffer(W, H, 4);
  const f32 = new Float32Array(buf.buffer);
  const stride = r32fRowStride(W);
  // A known value at every probed coordinate; 0xAB padding everywhere else.
  // Values are chosen f32-EXACT so toBe is byte-honest.
  const probes: Array<[number, number, number]> = [
    [0, 0, 0.25], [799, 0, 0.5], // first row, both ends
    [0, 1, 0.3125], [400, 300, 0.75], // dense indexing breaks from row 1 on
    [0, H - 1, 0.96875], [799, H - 1, 1.0], // LAST row (unpadded tail row)
  ];
  for (const [x, y, v] of probes) f32[y * stride + x] = v;
  it('reads every probed coordinate exactly', () => {
    for (const [x, y, v] of probes) {
      expect(readR32FTexel(f32, W, x, y), `(${x},${y})`).toBe(v);
    }
  });
  it('dense (y*width+x) indexing provably reads the WRONG word here', () => {
    // The fixture's own sanity: the word immediately after row 1's last
    // texel is 0xABABABAB padding; the OLD dense index for (400,300) lands
    // on a different word than the strided one and does not hold 0.5.
    const u32 = new Uint32Array(f32.buffer);
    expect(u32[stride + W]).toBe(0xabababab);
    const denseIndex = 300 * W + 400;
    const stridedIndex = 300 * stride + 400;
    expect(denseIndex).not.toBe(stridedIndex);
    expect(f32[denseIndex]).not.toBe(0.75);
  });
  it('odd width 801 also reads correctly across rows', () => {
    const w2 = 801, h2 = 3;
    const g32 = new Float32Array(paddedBuffer(w2, h2, 4).buffer);
    const s2 = r32fRowStride(w2);
    const grid: Array<[number, number, number]> = [
      [0, 0, 1], [800, 0, 2], [0, 1, 3], [800, 1, 4], [800, 2, 5],
    ];
    for (const [x, y, v] of grid) g32[y * s2 + x] = v;
    for (const [x, y, v] of grid) expect(readR32FTexel(g32, w2, x, y)).toBe(v);
  });
});

describe('readRgba16FTexel — RGBA16F vs R32F, padded rows', () => {
  it('decodes a half pattern through the padded stride at width 801', () => {
    const W = 801, H = 5;
    const u16 = new Uint16Array(paddedBuffer(W, H, 8).buffer);
    const stride = rgba16fRowStride(W);
    expect(stride).toBe(3328); // NOT 801*4 = 3204 — real padding
    const put = (x: number, y: number, rgba: number[]) => {
      for (let c = 0; c < 4; c++) u16[y * stride + x * 4 + c] = rgba[c]!;
    };
    put(0, 0, [0x3c00, 0xbc00, 0x0000, 0x8000]); // row 0: 1, -1, 0, -0
    put(800, 0, [0x3555, 0x4777, 0x0001, 0x03ff]); // row 0 end: subnormals
    put(0, 1, [0x7c00, 0xfc00, 0x7e00, 0x0400]); // row 1: Inf, -Inf, NaN, min normal
    put(800, 4, [0x3c00, 0x3c00, 0x3c00, 0x3c00]); // LAST row (unpadded tail)
    const out = new Float32Array(4);
    readRgba16FTexel(u16, W, 0, 0, out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(-1);
    expect(Object.is(out[2], 0)).toBe(true);
    expect(Object.is(out[3], -0)).toBe(true);
    readRgba16FTexel(u16, W, 800, 0, out);
    expect(out[0]).toBe(0.333251953125);
    expect(out[1]).toBe(7.46484375);
    expect(out[2]).toBe(2 ** -24);
    expect(out[3]).toBe(1023 * 2 ** -24);
    readRgba16FTexel(u16, W, 0, 1, out);
    expect(out[0]).toBe(Infinity);
    expect(out[1]).toBe(-Infinity);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(2 ** -14);
    readRgba16FTexel(u16, W, 800, 4, out);
    expect([...out]).toEqual([1, 1, 1, 1]);
  });
  it('a game-shaped 800x600 buffer round-trips class/depth at the frame corners', () => {
    // emissionClass.a (half) + surfaceDepth (r32f) at the four corners of
    // the real readback shape: the exact decode path readSurfaceAt uses.
    const W = 800, H = 600;
    const ec = new Uint16Array(paddedBuffer(W, H, 8).buffer);
    const dep = new Float32Array(paddedBuffer(W, H, 4).buffer);
    const corners: Array<[number, number, number, number]> = [
      [0, 0, 18, 0.4375], [W - 1, 0, 17, 0.5625], [0, H - 1, 1, 0.96875], [W - 1, H - 1, 0, 1.0],
    ];
    for (const [x, y, cls, depth] of corners) {
      ec[y * rgba16fRowStride(W) + x * 4 + 3] = f32ToHalfBits(cls);
      dep[y * r32fRowStride(W) + x] = depth;
    }
    const out = new Float32Array(4);
    for (const [x, y, cls, depth] of corners) {
      readRgba16FTexel(ec, W, x, y, out);
      expect(out[3], `cls @(${x},${y})`).toBe(cls);
      expect(readR32FTexel(dep, W, x, y), `depth @(${x},${y})`).toBe(depth);
    }
  });
});
