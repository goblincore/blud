import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as npy.test.ts).
import { coverageBox, cropFrame, fleshBox, fleshFraction, maskIoU, pairCrop, toLocalRegions } from './upscale-crop.mjs';

function frame(w: number, h: number, rects: number[][]) {
  const d = new Float32Array(w * h * 4);
  for (let p = 0; p < w * h; p++) d[p * 4 + 3] = 1;
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0!; y < y1!; y++) for (let x = x0!; x < x1!; x++) { d[(y * w + x) * 4] = 0.25; d[(y * w + x) * 4 + 3] = 0.5; }
  }
  return d;
}

describe('upscale crop helpers', () => {
  it('fleshBox and fleshFraction', () => {
    expect(fleshBox(frame(10, 8, [[2, 3, 5, 6]]), 10, 8)).toEqual([2, 3, 5, 6]);
    expect(fleshBox(frame(10, 8, []), 10, 8)).toBeNull();
    expect(fleshFraction(frame(10, 8, [[0, 0, 5, 8]]), 10, 8)).toBe(0.5);
  });

  it('coverageBox uses coverage >= minFrac', () => {
    const cov = new Float32Array(20 * 16);
    for (let y = 2; y < 6; y++) for (let x = 6; x < 10; x++) cov[y * 20 + x] = 0.5;
    cov[3 * 20 + 12] = 0.25;
    expect(coverageBox(cov, 20, 16)).toEqual([6, 2, 10, 6]);
    expect(coverageBox(new Float32Array(4), 2, 2)).toBeNull();
  });

  it('pairCrop unions the input box with the halved target box, pads and clamps', () => {
    const inp = frame(10, 8, [[2, 3, 5, 6]]);
    const cov = new Float32Array(20 * 16);
    for (let y = 5; y < 14; y++) for (let x = 1; x < 12; x++) cov[y * 20 + x] = 1;
    expect(pairCrop(inp, 10, 8, cov, 20, 16, 1)).toEqual({ x: 0, y: 1, w: 7, h: 7 });
    expect(pairCrop(frame(10, 8, []), 10, 8, new Float32Array(20 * 16), 20, 16, 8)).toBeNull();
  });

  it('cropFrame copies a window', () => {
    const data = Float32Array.from({ length: 4 * 3 * 2 }, (_, k) => k);
    const out = cropFrame(data, 4, 3, 2, 1, 1, 2, 2);
    expect(Array.from(out)).toEqual([10, 11, 12, 13, 18, 19, 20, 21]);
  });

  it('maskIoU', () => {
    expect(maskIoU(frame(4, 4, [[0, 0, 2, 2]]), frame(4, 4, [[1, 0, 3, 2]]), 4, 4)).toBeCloseTo(1 / 3, 12);
    expect(maskIoU(frame(4, 4, []), frame(4, 4, []), 4, 4)).toBe(1);
  });

  it('toLocalRegions moves circles into crop-local output px and drops ones outside', () => {
    const crop = { x: 10, y: 5, w: 20, h: 10 };
    const ann = [
      { actorId: 1, head: { x: 30, y: 15, r: 4 }, wounds: [{ x: 18, y: 12, r: 3, type: 'pellet' }] },
      { actorId: 2, head: { x: 100, y: 100, r: 5 }, wounds: [] },
      { actorId: 3, head: null, wounds: [] },
    ];
    expect(toLocalRegions(ann, crop)).toEqual({
      heads: [{ x: 10, y: 5, r: 4, actorId: 1 }],
      wounds: [{ x: -2, y: 2, r: 3, type: 'pellet', actorId: 1 }],
    });
  });
});
