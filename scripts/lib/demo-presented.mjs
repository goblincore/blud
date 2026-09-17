// scripts/lib/demo-presented.mjs
//
// THE PRESENTED-FRAME HASH: decode a canvas PNG and digest its pixels.
//
// WHY IT EXISTS. The in-page frame hash reads GPU targets (the march target, the
// gather's layers) and answers "did the RENDERER change" — the right instrument
// for a zeroed probe layer or a mistranscribed kernel. It is NOT the image the
// owner looks at: everything downstream of the march (the interlaced field's held
// rows, FXAA, the SSCS stage, the VHS pass with its own temporal blend and 60/24
// Hz row-noise hashes) runs after it, and a bug in any of those is invisible to it.
// This hashes the CANVAS instead.
//
// The trade, stated plainly: the canvas is 8-BIT premultiplied sRGB, so a
// difference below one 8-bit step does not exist here — and the 2026-09-05
// flicker wobble lives at exactly that level. Use this to check what the owner
// SEES; use frame-hash.ts to check what the renderer COMPUTED. Neither subsumes
// the other.
//
// It lives in scripts/lib/ rather than inside sdf-demo-hash.mjs because that
// script connects to Chrome at module scope, so importing it from a test opened a
// browser tab instead of running assertions (observed 2026-09-10).

import { inflateSync } from 'node:zlib';
import { fnv1aBytes } from './demo-digest.mjs';

/** Minimal PNG decode (RGBA/RGB, 8-bit, non-interlaced) — the same routine the
 *  close-up capture gates use, so there is one decoder in the repo, not three. */
export function decodePng(buf) {
  let off = 8; let w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = { 2: 3, 6: 4 }[colorType];
  if (!channels) throw new Error(`decodePng: unsupported colour type ${colorType}`);
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, ch: channels, data: out };
}

/**
 * THE PRESENTED FRAME, hashed: what the owner actually sees.
 *
 * `frameHash` reads GPU targets and answers "did the RENDERER change". This
 * answers "did the SCREEN change" — and everything downstream of the march
 * (the interlaced field's held rows, FXAA, the VHS pass with its own temporal
 * blend and 60/24 Hz row-noise hashes) is invisible to the former. A bug in any
 * of those needs this one.
 *
 * 8-BIT by construction: the canvas yields premultiplied sRGB, so sub-LSB
 * differences do not exist here. That is the honest cost, not an oversight.
 */
export function hashPresented(b64) {
  const png = decodePng(Buffer.from(b64, 'base64'));
  return {
    hash: fnv1aBytes(png.data),
    width: png.w,
    height: png.h,
    bytes: png.data.length,
    // A cheap activity stat so a black or blank frame is visible as such rather
    // than as "a different hash".
    nonZeroBytes: png.data.reduce((n, v) => (v ? n + 1 : n), 0),
  };
}

