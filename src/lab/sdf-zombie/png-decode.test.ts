// src/lab/sdf-zombie/png-decode.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:zlib available in vitest via happy-dom/node
import { deflateSync } from 'node:zlib';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { decodePng } from './png-decode';

/** Builds a real PNG so the decoder is tested against the format rather than
 *  against a fixture someone might quietly regenerate. `filter` is applied to
 *  every scanline, which is how each of the five predictors gets exercised. */
function encodePng(
  w: number, h: number, channels: number, colorType: number,
  px: number[], filter = 0,
): Uint8Array {
  const stride = w * channels;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x]!;
      const a = x >= channels ? px[y * stride + x - channels]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = (x >= channels && y > 0) ? px[(y - 1) * stride + x - channels]! : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const est = a + b - c;
        const pa = Math.abs(est - a), pb = Math.abs(est - b), pc = Math.abs(est - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (v - p) & 0xff;
    }
  }
  const idat = deflateSync(raw);

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // CRC left zero: the decoder does not verify it, by design
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)),
  ];
  let n = 0; for (const p of parts) n += p.length;
  const buf = new Uint8Array(n);
  let at = 0; for (const p of parts) { buf.set(p, at); at += p.length; }
  return buf;
}

describe('decodePng', () => {
  const rgb = [
    255, 0, 0, /**/ 0, 255, 0,
    0, 0, 255, /**/ 9, 9, 9,
  ];

  it('decodes 8-bit RGB and pads it to RGBA', () => {
    const p = decodePng(encodePng(2, 2, 3, 2, rgb));
    expect([p.width, p.height]).toEqual([2, 2]);
    expect([...p.rgba.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  // Every filter must round-trip, because a real encoder picks per scanline and
  // a decoder that only handles `none` reads plausible-looking garbage rather
  // than failing — the worst outcome for something feeding a quality score.
  for (const filter of [0, 1, 2, 3, 4]) {
    it(`reverses filter ${filter}`, () => {
      const p = decodePng(encodePng(2, 2, 3, 2, rgb, filter));
      expect([...p.rgba]).toEqual([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 9, 9, 9, 255,
      ]);
    });
  }

  it('keeps alpha from an RGBA source', () => {
    const p = decodePng(encodePng(1, 1, 4, 6, [1, 2, 3, 128]));
    expect([...p.rgba]).toEqual([1, 2, 3, 128]);
  });

  it('expands greyscale to RGBA', () => {
    const p = decodePng(encodePng(2, 1, 1, 0, [7, 200]));
    expect([...p.rgba]).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
  });

  it('rejects a non-PNG instead of returning noise', () => {
    expect(() => decodePng(new Uint8Array(32))).toThrow(/bad signature/);
  });

  // Naming the actual header value matters: "unsupported colour type 3" tells
  // an author to re-save without a palette. A silent wrong answer here surfaces
  // much later as an inexplicably bad silhouette score.
  it('names the unsupported feature it found', () => {
    const paletted = encodePng(1, 1, 1, 3, [0]);
    expect(() => decodePng(paletted)).toThrow(/colour type 3/);
    const interlaced = encodePng(1, 1, 3, 2, [0, 0, 0]);
    interlaced[8 + 8 + 12] = 1; // IHDR interlace byte
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
  });

  it('reads the real mouse reference plate', () => {
    const p = decodePng(readFileSync('docs/dev-notes/refs/mouse-reference.png'));
    expect([p.width, p.height]).toEqual([1024, 1024]);
    const at = (x: number, y: number) => [...p.rgba.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 3)];
    expect(at(2, 2)).toEqual([254, 252, 253]);   // the white backdrop
    const [r, g, b] = at(512, 600) as [number, number, number];
    expect(r).toBeGreaterThan(120);              // the red tee, and not grey
    expect(r - g).toBeGreaterThan(80);
    expect(r - b).toBeGreaterThan(80);
  });
});
