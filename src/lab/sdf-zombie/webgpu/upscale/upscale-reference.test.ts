import { describe, expect, it } from 'vitest';
import {
  createUpscaleModel, hashModel, modelMacs, parseUpscaleConfig, subPixelChannel,
  type ConvLayer, type UpscaleModel,
} from './upscale-model';
import {
  conv3x3, f16round, linearDepth, makeImage, reconstructPixel, upscaleReference,
  type FloatImage,
} from './upscale-reference';

const px = (img: FloatImage, x: number, y: number, ch: number) => img.data[(y * img.w + x) * img.c + ch]!;

/** Deterministic test noise (not the model's PRNG, on purpose). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** A march-target image: rgb in [0,1], alpha = clip depth in [0,0.99] or the 1.0 "no flesh" sentinel. */
function randomMarch(w: number, h: number, seed: number, missRate = 0.3): FloatImage {
  const r = lcg(seed);
  const img = makeImage(w, h, 4);
  for (let p = 0; p < w * h; p++) {
    const miss = r() < missRate;
    img.data[p * 4] = miss ? 0 : r();
    img.data[p * 4 + 1] = miss ? 0 : r();
    img.data[p * 4 + 2] = miss ? 0 : r();
    img.data[p * 4 + 3] = miss ? 1 : r() * 0.99;
  }
  return img;
}

describe('upscale model', () => {
  it('builds the ladder shapes with ReLU on every layer but the last', () => {
    const m = createUpscaleModel('s16', 'rgb', 1);
    expect(m.layers.map((l) => [l.inC, l.outC])).toEqual([[4, 16], [16, 16], [16, 16]]);
    expect(m.layers.map((l) => l.relu)).toEqual([true, true, false]);
    expect(createUpscaleModel('s32', 'rgbd', 1).layers.map((l) => [l.inC, l.outC])).toEqual([[5, 32], [32, 32], [32, 16]]);
    expect(m.layers[0]!.weights.length).toBe(16 * 4 * 9);
  });

  it('is deterministic per seed, differs across seeds, and the zero model is all zeros', () => {
    expect(createUpscaleModel('s8', 'rgb', 7).weightHash).toBe(createUpscaleModel('s8', 'rgb', 7).weightHash);
    expect(createUpscaleModel('s8', 'rgb', 7).weightHash).not.toBe(createUpscaleModel('s8', 'rgb', 8).weightHash);
    const z = createUpscaleModel('zero', 'rgb', 1);
    expect(z.layers.every((l) => l.weights.every((v) => v === 0) && l.bias.every((v) => v === 0))).toBe(true);
    expect(z.weightHash).toBe(hashModel(z));
    expect(z.weightHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carries depth normalization for rgbd', () => {
    const m = createUpscaleModel('s8', 'rgbd', 1);
    expect(Array.from(m.inScale)).toEqual([1, 1, 1, 1, Math.fround(0.1)]);
    expect(Array.from(m.inOffset)).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts multiply-adds per frame', () => {
    expect(modelMacs(createUpscaleModel('s8', 'rgb', 1), 400, 300)).toBe(241_920_000);
    expect(modelMacs(createUpscaleModel('s16', 'rgb', 1), 400, 300)).toBe(622_080_000);
    expect(modelMacs(createUpscaleModel('s32', 'rgb', 1), 400, 300)).toBe(1_797_120_000);
  });

  it('parses configs with defaults and rejects unknown values', () => {
    expect(parseUpscaleConfig({ model: 's16' })).toEqual({ model: 's16', layout: 'sp', inputs: 'rgb', seed: 1 });
    expect(parseUpscaleConfig({ model: 's8', layout: 'dc', inputs: 'rgbd', seed: 4 })).toEqual({ model: 's8', layout: 'dc', inputs: 'rgbd', seed: 4 });
    expect(() => parseUpscaleConfig({ model: 's64' })).toThrow(/unknown model/);
    expect(() => parseUpscaleConfig({ model: 's8', layout: 'xx' })).toThrow(/unknown layout/);
    expect(() => parseUpscaleConfig({ model: 's8', inputs: 'aux' })).toThrow(/unknown input set/);
    expect(() => parseUpscaleConfig({ model: 's8', seed: 1.5 })).toThrow(/seed/);
  });

  it('uses PyTorch pixel-shuffle channel order', () => {
    expect(subPixelChannel(0, 0, 0)).toBe(0);
    expect(subPixelChannel(0, 1, 0)).toBe(2);
    expect(subPixelChannel(1, 0, 1)).toBe(5);
    expect(subPixelChannel(3, 1, 1)).toBe(15);
  });
});

describe('upscale CPU twin', () => {
  it('conv3x3 uses PyTorch weight order and replicate borders', () => {
    const img = makeImage(3, 2, 1);
    img.data.set([0, 1, 2, 10, 11, 12]);
    const layer: ConvLayer = { inC: 1, outC: 2, weights: new Float32Array(18), bias: new Float32Array(2), relu: false };
    layer.weights[((0 * 1 + 0) * 3 + 0) * 3 + 0] = 1; // out 0 reads (x-1, y-1)
    layer.weights[((1 * 1 + 0) * 3 + 2) * 3 + 1] = 1; // out 1 reads (x, y+1)
    const out = conv3x3(img, layer);
    expect(px(out, 0, 0, 0)).toBe(0);
    expect(px(out, 2, 1, 0)).toBe(1);
    expect(px(out, 1, 1, 0)).toBe(0);
    expect(px(out, 2, 0, 1)).toBe(12);
    expect(px(out, 0, 1, 1)).toBe(10);
  });

  it('conv3x3 applies ReLU when asked', () => {
    const img = makeImage(2, 2, 1);
    const layer: ConvLayer = { inC: 1, outC: 1, weights: new Float32Array(9), bias: new Float32Array([-1]), relu: true };
    expect(Array.from(conv3x3(img, layer).data)).toEqual([0, 0, 0, 0]);
  });

  it('linearDepth maps WebGPU [0,1] clip depth back to view distance', () => {
    expect(linearDepth(0, 0.1, 100)).toBeCloseTo(0.1, 9);
    expect(linearDepth(1, 0.1, 100)).toBeCloseTo(100, 6);
    expect(linearDepth(0.5, 0.1, 100)).toBeGreaterThan(0.1);
  });

  it('f16round matches IEEE half precision', () => {
    expect(f16round(0.1)).toBe(0.0999755859375);
    expect(f16round(1)).toBe(1);
    expect(f16round(-2.5)).toBe(-2.5);
    expect(f16round(65504)).toBe(65504);
    expect(f16round(1e6)).toBe(Infinity);
    expect(f16round(2 ** -20)).toBe(2 ** -20);
    expect(f16round(0)).toBe(0);
  });

  it('reconstructPixel follows the spec §4 candidate order and sentinel rules', () => {
    const march = makeImage(2, 2, 4);
    march.data.set([
      0, 0, 0, 1,     // (0,0) miss
      1, 0, 0, 0.3,   // (1,0)
      0, 1, 0, 0.4,   // (0,1)
      0, 0, 1, 0.5,   // (1,1)
    ]);
    const out = new Float32Array(4);
    reconstructPixel(march, 0, 0, 1, 1, [0, 0, 0, 1], out, 0);
    expect(Array.from(out)).toEqual([1, 0, 0, Math.fround(0.3)]);
    reconstructPixel(march, 0, 0, 1, 0, [0, 0, 0, 1], out, 0);
    expect(Array.from(out)).toEqual([0, 1, 0, Math.fround(0.4)]);
    reconstructPixel(march, 0, 0, 0, 0, [0, 0, 0, 1], out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 1]);
    reconstructPixel(march, 1, 0, 0, 0, [0, 0, 0, -1], out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 1]);
    reconstructPixel(march, 1, 0, 0, 0, [-2, 0.5, 0, 0], out, 0);
    expect(Array.from(out)).toEqual([0, 0.5, 0, Math.fround(0.3)]);
  });

  it('the zero model reproduces a nearest upscale exactly, in both layouts, with or without half-float storage', () => {
    const march = randomMarch(7, 5, 11);
    for (const layout of ['sp', 'dc'] as const) {
      for (const halfFloatStorage of [false, true]) {
        const out = upscaleReference(march, createUpscaleModel('zero', 'rgb', 1), layout, 0.1, 100, 14, 10, { halfFloatStorage });
        for (let Y = 0; Y < 10; Y++) for (let X = 0; X < 14; X++) {
          const x = X >> 1, y = Y >> 1;
          const hit = px(march, x, y, 3) < 1;
          const want = hit ? [px(march, x, y, 0), px(march, x, y, 1), px(march, x, y, 2), px(march, x, y, 3)] : [0, 0, 0, 1];
          expect([px(out, X, Y, 0), px(out, X, Y, 1), px(out, X, Y, 2), px(out, X, Y, 3)]).toEqual(want);
        }
      }
    }
  });

  it('places the last layer by PyTorch pixel-shuffle order in both layouts', () => {
    const model: UpscaleModel = createUpscaleModel('zero', 'rgb', 1);
    const last = model.layers[model.layers.length - 1]!;
    for (let k = 0; k < 16; k++) last.bias[k] = k / 100;
    const march = makeImage(2, 2, 4);
    for (let p = 0; p < 4; p++) march.data.set([0.5, 0.5, 0.5, 0.25], p * 4);
    for (const layout of ['sp', 'dc'] as const) {
      const out = upscaleReference(march, model, layout, 0.1, 100, 4, 4);
      const rgb = (X: number, Y: number) => [px(out, X, Y, 0), px(out, X, Y, 1), px(out, X, Y, 2)];
      // (X=1,Y=0): i=0, j=1 -> sub-pixel 1 -> channels 1, 5, 9
      rgb(1, 0).forEach((v, c) => expect(v).toBeCloseTo(0.5 + [0.01, 0.05, 0.09][c]!, 6));
      // (X=0,Y=1): i=1, j=0 -> sub-pixel 2 -> channels 2, 6, 10
      rgb(0, 1).forEach((v, c) => expect(v).toBeCloseTo(0.5 + [0.02, 0.06, 0.10][c]!, 6));
      // (X=3,Y=3): i=1, j=1 -> sub-pixel 3 -> channels 3, 7, 11
      rgb(3, 3).forEach((v, c) => expect(v).toBeCloseTo(0.5 + [0.03, 0.07, 0.11][c]!, 6));
      expect(px(out, 3, 3, 3)).toBe(0.25);
    }
  });

  it('sub-pixel and deconvolution layouts agree for random models (the Colbert equivalence)', () => {
    const march = randomMarch(9, 7, 23);
    for (const id of ['s8', 's16'] as const) {
      for (const inputs of ['rgb', 'rgbd'] as const) {
        const model = createUpscaleModel(id, inputs, 3);
        const sp = upscaleReference(march, model, 'sp', 0.1, 100, 18, 14);
        const dc = upscaleReference(march, model, 'dc', 0.1, 100, 18, 14);
        let maxDiff = 0;
        for (let k = 0; k < sp.data.length; k++) maxDiff = Math.max(maxDiff, Math.abs(sp.data[k]! - dc.data[k]!));
        expect(maxDiff, `${id}/${inputs}`).toBeLessThanOrEqual(1e-5);
      }
    }
  });

  it('marginOut reports each coverage decision relative to its threshold', () => {
    const march = randomMarch(5, 4, 5);
    const margin = new Float32Array(10 * 8);
    const out = upscaleReference(march, createUpscaleModel('s8', 'rgb', 2), 'dc', 0.1, 100, 10, 8, { marginOut: margin });
    for (let p = 0; p < 80; p++) {
      if (margin[p]! <= 0) expect(out.data[p * 4 + 3]).toBe(1);
    }
  });
});
