// scripts/lib/png-write.mjs — a minimal PNG encoder.
//
// The repo has a PNG DECODER (demo-presented.mjs, used by every capture rig) and
// no encoder, because until now nothing here needed to WRITE an image: captures
// came back as base64 from the browser and were written straight to disk. The
// gib sheet generator does need one — it cuts pieces out of rendered frames and
// packs them into a committed sheet — and a sheet is exactly the kind of artifact
// that must be reproducible from source, so the encoder lives in the repo rather
// than in a dependency.
//
// Colour type 6 (RGBA), 8 bits per channel, filter 0 on every row: the simplest
// correct thing, and the sizes here (a sheet is a few hundred KB) make the
// missing filter heuristics irrelevant. `writePng` is checked against the
// decoder by png-write.test.mjs, which round-trips real pixels.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixels (a flat Uint8Array of w*h*4) as a PNG.
 *
 * `alpha` is taken from the data as given: this writes what it is handed rather
 * than assuming opacity, because the whole point of the gib sheet is cut-out
 * pieces whose alpha is the silhouette.
 */
export function writePng(w, h, rgba) {
  if (rgba.length !== w * h * 4) {
    throw new Error(`writePng: expected ${w * h * 4} bytes for ${w}x${h}, got ${rgba.length}`);
  }
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer ?? rgba, rgba.byteOffset ?? 0, rgba.length)
      .copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
