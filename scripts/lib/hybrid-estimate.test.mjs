import { describe, expect, it } from 'vitest';
import { hardMask, pixelCost, sparseFraction } from './hybrid-estimate.mjs';

const img = (w, h, fill) => ({ w, h, data: Float32Array.from({ length: w * h * 4 }, (_, k) => fill(Math.floor(k / 4), k % 4)) });
const near = 0.1, far = 200;

describe('hardMask', () => {
  it('marks the silhouette of a coarse blob and nothing inside it', () => {
    // 8x8 coarse, a 4x4 hit block (x,y in 2..5), flat depth, one prim, no heads.
    const c = img(8, 8, (i, ch) => { const x = i % 8, y = (i / 8) | 0; const hit = x >= 2 && x <= 5 && y >= 2 && y <= 5; return ch === 3 ? (hit ? 0.5 : 1) : 0.3; });
    const m = hardMask(c, null, [], 8, 8, { near, far });
    expect(m[3 * 8 + 3]).toBe(0); // interior
    expect(m[2 * 8 + 2]).toBe(1); // hit texel touching a miss
    expect(m[1 * 8 + 1]).toBe(1); // miss texel touching a hit (the ray may hit at full res)
    expect(m[0]).toBe(0);         // a 3x3 with no hit is not hard
  });
  it('a prim seam counts only where the colour changes', () => {
    const flat = img(4, 1, (i, ch) => (ch === 3 ? 0.5 : 0.3));
    const ids = img(4, 1, (i, ch) => (ch === 2 ? (i < 2 ? 1 : 2) : 0));
    expect([...hardMask(flat, ids, [], 4, 1, { near, far })].some(Boolean)).toBe(false);
    const split = img(4, 1, (i, ch) => (ch === 3 ? 0.5 : i < 2 ? 0.05 : 3));
    expect([...hardMask(split, ids, [], 4, 1, { near, far })].some(Boolean)).toBe(true);
  });
  it('upsamples to output res and adds the face circle', () => {
    const c = img(2, 2, (i, ch) => (ch === 3 ? 0.5 : 0.3));
    const m = hardMask(c, null, [{ x: 1, y: 1, r: 1 }], 8, 8, { near, far, faceGrow: 1 });
    expect(m[0 * 8 + 0]).toBe(1);
    expect(m[7 * 8 + 7]).toBe(0);
  });
});

describe('sparseFraction', () => {
  it('charges a whole warp its slowest lane when one lane is hard', () => {
    const w = 8, h = 4, n = w * h;
    const walk = new Float32Array(n * 4).fill(1); // every pixel rasterised (b = 1)
    const total = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) total[i * 4] = i === 5 ? 100 : 10;
    const cost = pixelCost(walk, total, n);
    const mask = new Uint8Array(n); mask[0] = 1;
    const r = sparseFraction(cost, mask, w, h);
    expect(r.fraction).toBe(1);                       // the one warp runs, at its max lane
    expect(r.plainFraction).toBeCloseTo(10 / (31 * 10 + 100));
  });
  it('skips warps with no hard pixel and ignores unrasterised lanes', () => {
    const w = 16, h = 4, n = w * h;
    const walk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) walk[i * 4 + 2] = (i % w) < 12 ? 1 : 0; // right 4 columns not rasterised
    const total = new Float32Array(n * 4).fill(0);
    for (let i = 0; i < n; i++) total[i * 4] = 10;
    const mask = new Uint8Array(n); mask[3] = 1;          // only the left warp
    const r = sparseFraction(pixelCost(walk, total, n), mask, w, h);
    // left warp 32 lanes x 10, right warp 16 lanes x 10 -> 320 / 480
    expect(r.fraction).toBeCloseTo(320 / 480);
    expect(r.hardTiles).toBe(1);
  });
});
