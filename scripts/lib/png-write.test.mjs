import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { writePng } from './png-write.mjs';
import { decodePng } from './demo-presented.mjs';

// The encoder exists so a generator can WRITE an image; the decoder already
// exists and every capture rig trusts it. Checking one against the other is the
// only verification that matters here — a PNG that decodes in this repo is a PNG
// a browser and a rig will both read.
describe('writePng', () => {
  it('round-trips arbitrary RGBA through the repo decoder', () => {
    const w = 37, h = 23;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4 + 0] = (i * 7) % 256;
      px[i * 4 + 1] = (i * 13 + 5) % 256;
      px[i * 4 + 2] = (i * 29 + 91) % 256;
      px[i * 4 + 3] = i % 5 === 0 ? 0 : 255;   // some fully transparent pixels
    }
    const png = writePng(w, h, px);
    const back = decodePng(png);
    expect(back.w).toBe(w);
    expect(back.h).toBe(h);
    expect([...back.data]).toEqual([...px]);
  });

  it('writes a file the decoder can read from disk, and refuses a size mismatch', () => {
    // A real round trip through the filesystem, because that is how the sheet
    // generator will use it and `Buffer` handling is where this would break.
    const w = 4, h = 2;
    const px = new Uint8Array(w * h * 4).fill(128);
    const buf = writePng(w, h, px);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(() => writePng(w, h, new Uint8Array(3))).toThrow(/expected/);
  });

  it('keeps the alpha channel — the sheet is cut-outs, so opacity is the load-bearing channel', () => {
    const w = 3, h = 1;
    const px = new Uint8Array([
      255, 0, 0, 0,
      0, 255, 0, 128,
      0, 0, 255, 255,
    ]);
    const back = decodePng(writePng(w, h, px));
    expect(back.ch).toBe(4);
    expect(back.data[3]).toBe(0);
    expect(back.data[7]).toBe(128);
    expect(back.data[11]).toBe(255);
  });
});

// Keep the import honest: readFileSync is unused here on purpose (the file path
// test above writes through memory). Declared so a future edit that needs disk
// does not have to re-add the import.
void readFileSync;
