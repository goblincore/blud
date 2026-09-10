// scripts/lib/demo-presented.test.mjs
//
// THE PRESENTED-FRAME HASH's own gate. This half of the instrument runs in plain
// node over a decoded canvas PNG, and it is the half that answers the question the
// owner actually asks — "did the SCREEN change" — while the in-page hash answers
// "did the RENDERER change". A silent failure here (a decoder that mis-reads a
// filter byte, a digest that ignores part of the image) would make every screen
// comparison meaningless, and the failure mode to guard is the FALSE PASS:
// reporting identical for two frames that differ.
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng, hashPresented } from './demo-presented.mjs';
import { fnv1aBytes } from './demo-digest.mjs';

/** Build a real PNG: 8-bit RGB, one IDAT, a chosen filter per row. Encoded by
 *  hand so the test does not depend on an image library, and so the FILTER
 *  reconstruction is genuinely exercised. */
function makePng(width, height, pixels, filters = []) {
  const channels = 3;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y] ?? 0;
    raw[y * (stride + 1)] = f;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (f === 1) v -= a; else if (f === 2) v -= b; else if (f === 3) v -= (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
  }
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', deflateSync(raw)));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

const W = 8, H = 4;
const base = Buffer.alloc(W * H * 3);
for (let i = 0; i < base.length; i++) base[i] = (i * 37) % 251;

describe('decodePng — the decoder must be exact, or the gate lies', () => {
  it('round-trips a filtered PNG back to the original bytes (every filter type)', () => {
    // Each PNG filter (None/Sub/Up/Average/Paeth) is a different reconstruction
    // path; a decoder that is wrong on one of them still "works" on a screenshot
    // and silently corrupts others.
    const filters = [0, 1, 2, 3];
    const png = makePng(W, H, base, filters);
    const out = decodePng(png);
    expect(out.w).toBe(W);
    expect(out.h).toBe(H);
    expect(out.ch).toBe(3);
    expect(Buffer.from(out.data).equals(base)).toBe(true);
  });

  it('handles the Paeth filter, the one with the most ways to be subtly wrong', () => {
    const png = makePng(W, H, base, [0, 4, 4, 4]);
    expect(Buffer.from(decodePng(png).data).equals(base)).toBe(true);
  });

  it('reports unsupported colour types instead of returning garbage', () => {
    // A greyscale or palette canvas would otherwise decode to confidently wrong
    // pixels and produce a stable-looking hash of the wrong image.
    const png = Buffer.from(makePng(W, H, base));
    png[8 + 8 + 9] = 0;   // IHDR colour type -> greyscale
    expect(() => decodePng(png)).toThrow(/colour type/);
  });
});

describe('hashPresented — the screen-level gate', () => {
  it('hashes the decoded PIXELS, not the encoded file', () => {
    // Two encodings of the SAME image (different filter choices) must hash
    // identically, or a re-compression alone would read as a visual change.
    const a = makePng(W, H, base, [0, 0, 0, 0]);
    const b = makePng(W, H, base, [1, 2, 3, 4]);
    const ha = hashPresented(a.toString('base64'));
    const hb = hashPresented(b.toString('base64'));
    expect(a.equals(b)).toBe(false);            // the FILES differ
    expect(ha.hash).toBe(hb.hash);              // the PIXELS do not
  });

  it('catches a ONE-BYTE change — the false pass this exists to prevent', () => {
    const changed = Buffer.from(base);
    changed[5] = (changed[5] + 1) & 0xff;
    const ha = hashPresented(makePng(W, H, base).toString('base64'));
    const hb = hashPresented(makePng(W, H, changed).toString('base64'));
    expect(ha.hash).not.toBe(hb.hash);
    // Same geometry and the same activity count: only the digest moves, which is
    // exactly the case a stat-based check would miss.
    expect(ha.width).toBe(hb.width);
    expect(ha.nonZeroBytes).toBe(hb.nonZeroBytes);
  });

  it('reports a BLACK frame as zero nonZeroBytes rather than as merely different', () => {
    // The black-silhouette regression class: a frame that is all one value must be
    // readable as such in the numbers, not only as a mismatched hash.
    const black = Buffer.alloc(W * H * 3);
    const h = hashPresented(makePng(W, H, black).toString('base64'));
    expect(h.nonZeroBytes).toBe(0);
    expect(h.bytes).toBe(W * H * 3);
    expect(h.hash).toBe(fnv1aBytes(black));
  });

  it('reports the geometry, so a size change is visible next to the digest', () => {
    const h = hashPresented(makePng(W, H, base).toString('base64'));
    expect(h).toMatchObject({ width: W, height: H, bytes: W * H * 3 });
  });
});
