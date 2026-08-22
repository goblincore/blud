// A minimal PNG reader, so a reference image can be turned into a silhouette
// mask without adding an image dependency to a game that has none.
//
// SCOPE, deliberately narrow: 8-bit, non-interlaced, colour types 0/2/4/6
// (grey, RGB, grey+alpha, RGBA). That covers every reference PNG in
// docs/dev-notes/refs/ — all three mouse plates and all three clown plates are
// 8-bit RGBA, non-interlaced. Anything else THROWS with the actual header
// values rather than returning quietly wrong pixels, because a silhouette
// score computed off a misread image looks like a bad character rather than a
// bad decode, and that is a very expensive hour.
//
// Palette (colour type 3) is not supported: it needs the PLTE/tRNS chunks and
// no reference we have uses it. Add it when something does, not before.
//
// `node:zlib` is a built-in, and vitest runs in Node, so this works in a test
// as well as in a script.
// @ts-expect-error — node:zlib available in vitest via happy-dom/node
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major from the TOP-LEFT. Always 4 channels
   *  regardless of the source colour type — callers should not have to branch. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel in the RAW scanlines, before we expand to RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++)
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  // IDAT is allowed to be split across any number of chunks and they must be
  // concatenated BEFORE inflating — the zlib stream spans them. Inflating each
  // chunk on its own fails on any image big enough to be split, which is most
  // real ones.
  const idat: Uint8Array[] = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      depth = buf[off + 16]!;
      colorType = buf[off + 17]!;
      interlace = buf[off + 20]!;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len; // length + type + data + crc
  }

  if (depth !== 8)
    throw new Error(`unsupported PNG bit depth ${depth} (only 8 is handled)`);
  if (interlace !== 0)
    throw new Error('unsupported interlaced PNG (Adam7); re-save without interlacing');
  const channels = CHANNELS[colorType];
  if (channels === undefined)
    throw new Error(`unsupported PNG colour type ${colorType} (0/2/4/6 are handled)`);
  if (!idat.length) throw new Error('PNG has no IDAT data');

  const raw = inflateSync(concat(idat));
  const stride = width * channels;
  // Every scanline is prefixed with one filter byte, so the inflated size is
  // height * (1 + stride). A mismatch means we misread the header.
  const expected = height * (stride + 1);
  if (raw.length < expected)
    throw new Error(`PNG data short: ${raw.length} bytes, expected ${expected}`);

  const pixels = unfilter(raw, width, height, channels);
  return { width, height, rgba: toRgba(pixels, width, height, channels) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Reverses PNG's per-scanline filters (spec 9.2). Each line names its own
 * filter and is predicted from the pixel to its LEFT (`a`) and the ALREADY
 * UNFILTERED line above (`b`) — which is why this runs top-down in place and
 * cannot be parallelised per row.
 */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= channels ? out[dst + x - channels]! : 0;
      const b = y > 0 ? out[up + x]! : 0;
      const c = (x >= channels && y > 0) ? out[up + x - channels]! : 0;
      let p: number;
      switch (filter) {
        case 0: p = 0; break;
        case 1: p = a; break;
        case 2: p = b; break;
        case 3: p = (a + b) >> 1; break;
        case 4: p = paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[dst + x] = (v + p) & 0xff;
    }
  }
  return out;
}

/** The Paeth predictor (spec 9.4): pick whichever of left/up/up-left is
 *  closest to the linear estimate a + b - c. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function toRgba(px: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  if (channels === 4) return px;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; o < out.length; i += channels, o += 4) {
    if (channels === 1) {            // grey
      out[o] = out[o + 1] = out[o + 2] = px[i]!;
      out[o + 3] = 255;
    } else if (channels === 2) {     // grey + alpha
      out[o] = out[o + 1] = out[o + 2] = px[i]!;
      out[o + 3] = px[i + 1]!;
    } else {                          // rgb
      out[o] = px[i]!; out[o + 1] = px[i + 1]!; out[o + 2] = px[i + 2]!;
      out[o + 3] = 255;
    }
  }
  return out;
}
