# Neural Upscale P1+P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is dispatched to headless agents (dispatch UI, `dsh` harness, `deepseek-v4-flash`), one task per agent, strictly in order.

**Goal:** Build the ESPCN-family flesh upscale stage (400×300 march → 800×600) with random weights in both inference layouts, prove GPU parity against a CPU twin, price it on the bench (gate G1), and build the paired frozen-frame capture for training (gate G2).

**Architecture:** A pure-TS model + CPU twin (`upscale-model.ts`, `upscale-reference.ts`) is the numeric reference. A WGSL generator (`upscale-wgsl.ts`) turns a model into fullscreen fragment passes: conv layers at low res writing ≤4 RGBA16F targets through three's MRT, using the deferred path's private-global trick (`deferred-sdf.ts`), then either a pixel-shuffle pass or a per-output-pixel deconvolution pass at 800×600. `upscale-stage.ts` wires the passes to three.js. `sdf-layer.ts` runs the stage between the march and the composite, and the composite reads its output by rebinding the existing `accumTex` node.

**Tech Stack:** TypeScript, three r185 WebGPU/TSL (`wgslFn`, `mrt`), WGSL, vitest (happy-dom), CDP browser scripts (`scripts/lib/sdf-closeup-stage.mjs`), Python + numpy via `uv` (loader check only).

**Spec:** `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md` — read §2 (network), §3 (layouts), §4 (per-pixel reconstruction) and the Gates section before starting any task.

---

## Rules for every task (headless agents: read this first)

1. **Work only in the files listed in your task.** Do not push, merge or rebase. Commit on your worktree branch.
2. **Never weaken a gate threshold to get a pass.** If a GPU gate fails after honest debugging, write the numbers and your diagnosis in the task's notes file, commit, and stop. A clear negative result is a valid outcome.
3. **No comments inside any WGSL function parameter list.** three's `wgslFn` parser turns `word: word` inside a signature comment into a phantom input and the pipeline silently fails to compile (sdf-layer.test.ts "no comment phantoms"). No backticks inside WGSL template strings.
4. **Do not run the full `npx vitest run` while another GPU job is running.** Run only the test files named in your task, then `npm run build` once at the end.
5. **GPU scripts own their servers.** Use the port pair given in your task and run through `scripts/lab-servers.sh` (`lab_servers_up` / `lab_servers_down`). **Kill and restart vite after any shader-source edit** — a reused vite serves stale modules and lies.
6. **Before any timing run** check the machine is quiet: `ps -Ao pcpu,comm | sort -rn | head -8`. If anything other than Chrome/node is above 20% CPU (e.g. `ANECompilerService`), record it in the notes and wait or say so.
7. Vitest passing is not a GPU claim. Only the browser scripts establish GPU facts.

## File map

| File | Created in | Responsibility |
|---|---|---|
| `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts` | Task 1 | Model/config types, ladder, seeded random + zero models, hash, MACs, config parsing |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts` | Task 1 | CPU twin: input assembly, conv, both layouts, §4 reconstruction, float16 emulation |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts` | Task 1 | Twin + model tests |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.ts` | Task 2 | Pass planning + WGSL source generation |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts` | Task 2 | Parser + source-invariant tests |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts` | Task 3 | three.js wiring: targets, materials, render, dispose, info |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts` | Task 3 | Fake-renderer wiring tests |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (modify) | Task 4 | Run stage, rebind composite input, exclusions |
| `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` (modify) | Task 4 | Layer integration tests |
| `src/lab/sdf-zombie/webgpu/game-main.ts` (modify) | Tasks 4, 5 | `?upscale*` flags, `__sdfGame.setUpscale/upscaleInfo/upscaleSelfCheck` |
| `scripts/upscale-smoke.mjs` | Task 4 | GPU compile smoke for `?upscale` boots |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts` | Task 5 | In-page GPU-vs-twin comparison |
| `scripts/upscale-parity.mjs` | Task 5 | G1-parity driver |
| `docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md` | Task 5 | Parity results |
| `scripts/sdf-game-bench.mjs` (modify) | Task 6 | Upscale legs + reset pins |
| `docs/dev-notes/2026-09-11-neural-upscale/g1-cost.md` | Task 6 | Cost gate verdict |
| `scripts/lib/npy.mjs`, `scripts/lib/npy.test.ts` | Task 7 | `.npy` encode/decode |
| `scripts/upscale-pairs-capture.mjs` | Task 7 | Paired capture + G2 checks |
| `scripts/upscale-pairs-load.py` | Task 7 | Python loader check |
| `.gitignore` (modify), `TASKS.md` (modify) | Task 7 | Ignore dataset dir; status |
| `docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md` | Task 7 | Pairs gate verdict |

---

### Task 1: Model definitions and the CPU twin

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts`
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts`
- Test: `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts`
Expected: FAIL — cannot resolve `./upscale-model` / `./upscale-reference`.

- [ ] **Step 3: Implement `upscale-model.ts`**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts`:

```ts
/**
 * NEURAL UPSCALE — model definitions.
 * Spec: docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md (§2).
 *
 * An ESPCN-family network: 3x3 convolutions at the LOW resolution with ReLU
 * between them; the last layer emits 16 channels = 4 sub-pixels x (rgb
 * residual + coverage residual), placed by a PyTorch-ordered pixel shuffle.
 *
 * WEIGHT LAYOUT IS PYTORCH'S Conv2d, so trained weights drop straight in:
 *   weights[((o * inC + i) * 3 + ky) * 3 + kx]
 * applied as cross-correlation at input texel (x + kx - 1, y + ky - 1),
 * edge-clamped (PyTorch padding_mode='replicate').
 *
 * Pure TypeScript — no three.js — so the CPU twin and its tests stay GPU-free.
 */

export type UpscaleModelId = 's8' | 's16' | 's32' | 'zero';
export type UpscaleInputSet = 'rgb' | 'rgbd';
export type UpscaleLayout = 'sp' | 'dc';

export interface UpscaleConfig {
  model: UpscaleModelId;
  layout: UpscaleLayout;
  inputs: UpscaleInputSet;
  seed: number;
}

export const UPSCALE_MODEL_IDS: readonly UpscaleModelId[] = ['s8', 's16', 's32', 'zero'];
export const UPSCALE_LAYOUTS: readonly UpscaleLayout[] = ['sp', 'dc'];
export const UPSCALE_INPUT_SETS: readonly UpscaleInputSet[] = ['rgb', 'rgbd'];

/** The march scale the stage is designed around: it upscales exactly 2x. */
export const UPSCALE_SCALE = 0.5;
/** Channels the first layer reads: rgb (zeroed off-flesh) + hit, then linear depth. */
export const INPUT_CHANNELS: Readonly<Record<UpscaleInputSet, number>> = { rgb: 4, rgbd: 5 };
/** Hidden widths. 'zero' has s8's shape with every weight and bias 0. Every
 *  width is a multiple of 4 so feature maps pack into whole RGBA textures. */
export const HIDDEN_WIDTHS: Readonly<Record<UpscaleModelId, readonly number[]>> = {
  s8: [8, 8], s16: [16, 16], s32: [32, 32], zero: [8, 8],
};
/** Last layer: 4 sub-pixels x (r, g, b, coverage). */
export const LAST_CHANNELS = 16;
/** Linear view depth enters the network in tens of metres. */
export const DEPTH_INPUT_SCALE = 0.1;

export interface ConvLayer {
  inC: number;
  outC: number;
  /** outC * inC * 9 values, PyTorch order (see file header). */
  weights: Float32Array;
  /** outC values. */
  bias: Float32Array;
  relu: boolean;
}

export interface UpscaleModel {
  id: UpscaleModelId;
  inputs: UpscaleInputSet;
  seed: number;
  layers: ConvLayer[];
  /** Per input channel: network input = raw * inScale + inOffset. */
  inScale: Float32Array;
  inOffset: Float32Array;
  /** FNV-1a 32 of every weight, bias and normalization value, hex. */
  weightHash: string;
}

/** PyTorch PixelShuffle: out[c, 2y+i, 2x+j] = last[c*4 + i*2 + j](y, x). */
export function subPixelChannel(c: number, i: number, j: number): number {
  return c * 4 + i * 2 + j;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashModel(model: Pick<UpscaleModel, 'layers' | 'inScale' | 'inOffset'>): string {
  let h = 0x811c9dc5;
  const feed = (arr: Float32Array) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let k = 0; k < bytes.length; k++) { h ^= bytes[k]!; h = Math.imul(h, 0x01000193); }
  };
  for (const l of model.layers) { feed(l.weights); feed(l.bias); }
  feed(model.inScale);
  feed(model.inOffset);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A model with SEEDED RANDOM weights (or all zeros for 'zero'). Random weights
 * are a cost probe and a parity fixture — never a quality result. He-uniform,
 * halved, keeps activations nonzero and well away from float16 overflow.
 */
export function createUpscaleModel(id: UpscaleModelId, inputs: UpscaleInputSet, seed = 1): UpscaleModel {
  const inC0 = INPUT_CHANNELS[inputs];
  const widths = [...HIDDEN_WIDTHS[id], LAST_CHANNELS];
  const rand = mulberry32(seed);
  const layers: ConvLayer[] = [];
  let inC = inC0;
  widths.forEach((outC, li) => {
    const weights = new Float32Array(outC * inC * 9);
    const bias = new Float32Array(outC);
    if (id !== 'zero') {
      const a = 0.5 * Math.sqrt(6 / (inC * 9));
      for (let k = 0; k < weights.length; k++) weights[k] = (rand() * 2 - 1) * a;
      for (let k = 0; k < bias.length; k++) bias[k] = (rand() * 2 - 1) * 0.05;
    }
    layers.push({ inC, outC, weights, bias, relu: li < widths.length - 1 });
    inC = outC;
  });
  const inScale = new Float32Array(inC0).fill(1);
  const inOffset = new Float32Array(inC0);
  if (inputs === 'rgbd') inScale[4] = DEPTH_INPUT_SCALE;
  const model: UpscaleModel = { id, inputs, seed, layers, inScale, inOffset, weightHash: '' };
  model.weightHash = hashModel(model);
  return model;
}

/** Multiply-adds per frame at an input size (both layouts do the same number). */
export function modelMacs(model: UpscaleModel, inW: number, inH: number): number {
  return model.layers.reduce((sum, l) => sum + l.outC * l.inC * 9, 0) * inW * inH;
}

export function parseUpscaleConfig(raw: { model?: unknown; layout?: unknown; inputs?: unknown; seed?: unknown }): UpscaleConfig {
  const model = raw.model as UpscaleModelId;
  if (!UPSCALE_MODEL_IDS.includes(model)) {
    throw new Error(`upscale: unknown model ${String(raw.model)} (expected ${UPSCALE_MODEL_IDS.join('|')})`);
  }
  const layout = (raw.layout ?? 'sp') as UpscaleLayout;
  if (!UPSCALE_LAYOUTS.includes(layout)) {
    throw new Error(`upscale: unknown layout ${String(raw.layout)} (expected ${UPSCALE_LAYOUTS.join('|')})`);
  }
  const inputs = (raw.inputs ?? 'rgb') as UpscaleInputSet;
  if (!UPSCALE_INPUT_SETS.includes(inputs)) {
    throw new Error(`upscale: unknown input set ${String(raw.inputs)} (expected ${UPSCALE_INPUT_SETS.join('|')})`);
  }
  const seed = raw.seed === undefined || raw.seed === null ? 1 : Number(raw.seed);
  if (!Number.isInteger(seed)) throw new Error(`upscale: seed must be an integer, got ${String(raw.seed)}`);
  return { model, layout, inputs, seed };
}
```

- [ ] **Step 4: Implement `upscale-reference.ts`**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts`:

```ts
/**
 * NEURAL UPSCALE — the CPU twin. The numeric reference every GPU pass is
 * checked against (spec §2-§4). Images are row 0 = texel row 0 (the top of
 * the rendered image in this renderer's convention), interleaved channels.
 */
import type { ConvLayer, UpscaleLayout, UpscaleModel } from './upscale-model';

export interface FloatImage { w: number; h: number; c: number; data: Float32Array }

export function makeImage(w: number, h: number, c: number): FloatImage {
  return { w, h, c, data: new Float32Array(w * h * c) };
}

const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** WebGPU [0,1] clip depth -> view distance (no reversed depth in this renderer). */
export function linearDepth(d: number, near: number, far: number): number {
  return (near * far) / (far - d * (far - near));
}

/** Round to the nearest IEEE float16 value — what an RGBA16F target stores. */
export function f16round(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (a >= 65520) return v > 0 ? Infinity : -Infinity;
  const e = Math.max(Math.floor(Math.log2(a)), -14);
  const step = 2 ** (e - 10);
  return Math.sign(v) * Math.round(a / step) * step;
}

/** The first layer's input (spec §2): rgb*hit, hit[, hit*linearDepth], normalized. */
export function assembleInput(march: FloatImage, model: UpscaleModel, near: number, far: number): FloatImage {
  const inC = model.layers[0]!.inC;
  const out = makeImage(march.w, march.h, inC);
  const raw = new Array<number>(inC).fill(0);
  for (let p = 0; p < march.w * march.h; p++) {
    const b = p * 4;
    const a = march.data[b + 3]!;
    const hit = a < 1 ? 1 : 0;
    raw[0] = march.data[b]! * hit;
    raw[1] = march.data[b + 1]! * hit;
    raw[2] = march.data[b + 2]! * hit;
    raw[3] = hit;
    if (inC === 5) raw[4] = hit * linearDepth(a, near, far);
    for (let k = 0; k < inC; k++) out.data[p * inC + k] = raw[k]! * model.inScale[k]! + model.inOffset[k]!;
  }
  return out;
}

/** One output channel of a 3x3 replicate-padded conv at (x, y), in float64. */
export function convAt(input: FloatImage, layer: ConvLayer, o: number, x: number, y: number): number {
  let s = layer.bias[o]!;
  for (let ky = 0; ky < 3; ky++) {
    const yy = clampI(y + ky - 1, 0, input.h - 1);
    for (let kx = 0; kx < 3; kx++) {
      const xx = clampI(x + kx - 1, 0, input.w - 1);
      const base = (yy * input.w + xx) * input.c;
      for (let i = 0; i < layer.inC; i++) {
        s += layer.weights[((o * layer.inC + i) * 3 + ky) * 3 + kx]! * input.data[base + i]!;
      }
    }
  }
  return layer.relu ? Math.max(0, s) : s;
}

export function conv3x3(input: FloatImage, layer: ConvLayer): FloatImage {
  if (input.c !== layer.inC) throw new Error(`conv3x3: input has ${input.c} channels, layer wants ${layer.inC}`);
  const out = makeImage(input.w, input.h, layer.outC);
  for (let y = 0; y < input.h; y++) {
    for (let x = 0; x < input.w; x++) {
      const b = (y * input.w + x) * layer.outC;
      for (let o = 0; o < layer.outC; o++) out.data[b + o] = convAt(input, layer, o, x, y);
    }
  }
  return out;
}

/**
 * Spec §4 for one output pixel. `res` = [r, g, b, coverage] residuals.
 * Writes rgba into out[o..o+3]; alpha is the source texel's depth verbatim,
 * or 1.0 (the "no flesh" sentinel).
 */
export function reconstructPixel(
  march: FloatImage, x: number, y: number, i: number, j: number,
  res: ArrayLike<number>, out: Float32Array, o: number,
): void {
  const at = (xx: number, yy: number) => (clampI(yy, 0, march.h - 1) * march.w + clampI(xx, 0, march.w - 1)) * 4;
  const own = at(x, y);
  const ownHit = march.data[own + 3]! < 1 ? 1 : 0;
  const sentinel = () => { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 1; };
  if (ownHit + res[3]! <= 0.5) { sentinel(); return; }
  const sx = j === 1 ? 1 : -1;
  const sy = i === 1 ? 1 : -1;
  let src = -1;
  for (const b of [own, at(x + sx, y), at(x, y + sy), at(x + sx, y + sy)]) {
    if (march.data[b + 3]! < 1) { src = b; break; }
  }
  if (src < 0) { sentinel(); return; }
  for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, march.data[src + c]! + res[c]!);
  out[o + 3] = march.data[src + 3]!;
}

export interface ReferenceOptions {
  /** Emulate the GPU's RGBA16F feature targets: every STORED feature map is
   *  rounded to float16 — the hidden layers, plus the last layer in 'sp'
   *  (stored before the shuffle). 'dc' computes the last layer in-shader. */
  halfFloatStorage?: boolean;
  /** Filled per output pixel with ownHit + coverageResidual - 0.5 (signed
   *  distance of the coverage decision from its threshold). */
  marginOut?: Float32Array;
}

/** The whole stage on the CPU: march image (RGBA, alpha = clip depth) -> output image. */
export function upscaleReference(
  march: FloatImage, model: UpscaleModel, layout: UpscaleLayout,
  near: number, far: number, outW: number, outH: number, opts: ReferenceOptions = {},
): FloatImage {
  if (march.c !== 4) throw new Error(`upscaleReference: march image must be RGBA, got ${march.c} channels`);
  const store = (img: FloatImage): FloatImage => {
    if (opts.halfFloatStorage) for (let k = 0; k < img.data.length; k++) img.data[k] = f16round(img.data[k]!);
    return img;
  };
  const layers = model.layers;
  const lastLayer = layers[layers.length - 1]!;
  let hidden = assembleInput(march, model, near, far);
  for (let l = 0; l < layers.length - 1; l++) hidden = store(conv3x3(hidden, layers[l]!));
  const last = layout === 'sp' ? store(conv3x3(hidden, lastLayer)) : null;
  const out = makeImage(outW, outH, 4);
  const res = [0, 0, 0, 0];
  const { w, h } = march;
  for (let Y = 0; Y < outH; Y++) {
    const y = Math.min(Y >> 1, h - 1);
    const i = Y & 1;
    for (let X = 0; X < outW; X++) {
      const x = Math.min(X >> 1, w - 1);
      const j = X & 1;
      for (let c = 0; c < 4; c++) {
        const ch = c * 4 + i * 2 + j;
        res[c] = last ? last.data[(y * w + x) * lastLayer.outC + ch]! : convAt(hidden, lastLayer, ch, x, y);
      }
      const p = Y * outW + X;
      if (opts.marginOut) opts.marginOut[p] = (march.data[(y * w + x) * 4 + 3]! < 1 ? 1 : 0) + res[3]! - 0.5;
      reconstructPixel(march, x, y, i, j, res, out.data, p * 4);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts`
Expected: PASS (all tests). If `f16round(0.1)` fails by one ulp, fix the rounding, do not loosen the test.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — Expected: no errors in the new files.

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts
git commit -m "feat(upscale): model ladder and the CPU twin (spec 2026-09-11 §2-§4)"
```

---

### Task 2: WGSL pass generator

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts`

Background you need:
- A three MRT target writes at most **4 RGBA16F textures per pass** (the device's default 32 bytes/sample). A layer wider than 16 channels becomes several passes (`L2a`, `L2b`) reading the same inputs.
- `wgslFn` sources must start with `fn`. Module-scope `var<private>` globals go AFTER a function in a "state" source — the exact pattern of `SDF_SURFACE_STATE` in `src/lab/sdf-zombie/webgpu/deferred-sdf.ts`. A conv pass computes all its channels once in a `run` function that writes those globals; one tiny `read` function per target returns a global and takes the cached run result as a `dep` input so it is evaluated after the run (same file, `SDF_SURFACE_READ_*`).
- Weights are baked as `mat4x4<f32>` literals: one matrix per (output target, input texture, tap) multiplies a 4-channel input texel into 4 output channels. WGSL matrices are column-major: entry (col, row) maps input channel `col` to output channel `row`.
- Fragment pixel coordinates use the repo's convention: `st = uv` with `st.y` flipped when `flipY > 0.5`, then `floor(st * dims)` (see `TEMPORAL_ACCUM_WGSL` in `sdf-layer.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser (same as sdf-layer.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { createUpscaleModel, type ConvLayer } from './upscale-model';
import { lit, matLiteral, planUpscalePasses, UPSCALE_RECONSTRUCT_WGSL } from './upscale-wgsl';

const declared = (src: string) => {
  const params = src.slice(src.indexOf('(') + 1, src.indexOf(') ->')).replace(/\/\/[^\n]*/g, '');
  return [...params.matchAll(/([A-Za-z_0-9]+)\s*:/g)].map((m) => m[1]);
};
const expectParses = (src: string) => {
  const parsed = new WGSLNodeFunction(src);
  expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(declared(src));
  expect(parsed.inputs.every((i: { type?: string }) => i.type !== undefined)).toBe(true);
};

describe('upscale pass plan', () => {
  it('s8 sub-pixel: two hidden convs, the 16-channel last conv, then the shuffle', () => {
    const passes = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'sp');
    expect(passes.map((p) => p.name)).toEqual(['L1a', 'L2a', 'L3a', 'shuffle']);
    expect(passes.map((p) => p.targets)).toEqual([2, 2, 4, 1]);
    expect(passes[0]!.inputs).toEqual(['march']);
    expect(passes[0]!.params).toEqual(['march']);
    expect(passes[1]!.inputs).toEqual(['L1a:0', 'L1a:1']);
    expect(passes[3]!.inputs).toEqual(['march', 'L3a:0', 'L3a:1', 'L3a:2', 'L3a:3']);
    expect(passes[3]!.params).toEqual(['march', 'in0', 'in1', 'in2', 'in3']);
    expect(passes.map((p) => p.outputRes)).toEqual(['low', 'low', 'low', 'full']);
  });

  it('s8 deconvolution: the last layer runs per output pixel', () => {
    const passes = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'dc');
    expect(passes.map((p) => p.name)).toEqual(['L1a', 'L2a', 'deconv']);
    expect(passes[2]!.inputs).toEqual(['march', 'L2a:0', 'L2a:1']);
    expect(passes[2]!.outputRes).toBe('full');
  });

  it('s32 splits every 32-channel layer into two 16-channel passes', () => {
    const sp = planUpscalePasses(createUpscaleModel('s32', 'rgb', 1), 'sp');
    expect(sp.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'L3a', 'shuffle']);
    expect(sp[2]!.inputs).toEqual(['L1a:0', 'L1a:1', 'L1a:2', 'L1a:3', 'L1b:0', 'L1b:1', 'L1b:2', 'L1b:3']);
    const dc = planUpscalePasses(createUpscaleModel('s32', 'rgb', 1), 'dc');
    expect(dc.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'deconv']);
    expect(dc[4]!.inputs).toHaveLength(9);
  });

  it('only the first layer of an rgbd model takes nearFar', () => {
    const passes = planUpscalePasses(createUpscaleModel('s16', 'rgbd', 1), 'sp');
    expect(passes.map((p) => p.usesNearFar)).toEqual([true, false, false, false]);
    expect(passes[0]!.run).toContain('nearFar: vec2<f32>');
    expect(planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[0]!.usesNearFar).toBe(false);
  });
});

describe('upscale WGSL sources', () => {
  const all = (['s8', 's16', 's32', 'zero'] as const).flatMap((id) =>
    (['rgb', 'rgbd'] as const).flatMap((inputs) =>
      (['sp', 'dc'] as const).map((layout) => ({ id, inputs, layout, passes: planUpscalePasses(createUpscaleModel(id, inputs, 1), layout) }))));

  it('every generated function parses to its real parameter list (no phantom inputs)', () => {
    expectParses(UPSCALE_RECONSTRUCT_WGSL);
    for (const { passes } of all) {
      for (const p of passes) {
        expectParses(p.run);
        for (const r of p.reads) expectParses(r);
        if (p.state) expectParses(p.state);
      }
    }
  });

  it('every pass takes the shared flipY convention and never blends', () => {
    for (const { passes } of all) {
      for (const p of passes) {
        expect(p.run).toContain('if (flipY > 0.5) { st.y = 1.0 - st.y; }');
        expect(p.run).not.toContain('mix(');
      }
    }
    expect(UPSCALE_RECONSTRUCT_WGSL).not.toContain('mix(');
  });

  it('depth comes from one source texel and the sentinel is the far plane', () => {
    expect(UPSCALE_RECONSTRUCT_WGSL).toContain('return vec4<f32>(max(src.xyz + res.xyz, vec3<f32>(0.0)), src.w);');
    expect(UPSCALE_RECONSTRUCT_WGSL).toContain('return vec4<f32>(0.0, 0.0, 0.0, 1.0);');
  });

  it('the shuffle reads sub-pixel s of targets r, g, b, coverage (PyTorch order)', () => {
    const shuffle = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'sp')[3]!;
    expect(shuffle.run).toContain('let s = i * 2 + j;');
    expect(shuffle.run).toContain('vec4<f32>(rr[s], gg[s], bb[s], cc[s])');
  });

  it('the zero model bakes no matrices', () => {
    for (const { id, passes } of all) {
      if (id !== 'zero') continue;
      for (const p of passes) expect(p.run).not.toContain('mat4x4');
    }
  });

  it('conv passes write one private global per target and read it back', () => {
    const l1 = planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[0]!;
    expect(l1.reads).toHaveLength(4);
    expect(l1.state).toContain('var<private> gUpL1a_3: vec4<f32>;');
    expect(l1.reads[2]).toContain('return gUpL1a_2;');
    expect(l1.run).toContain('gUpL1a_0 = max(acc0, vec4<f32>(0.0));');
    const last = planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[2]!;
    expect(last.run).toContain('gUpL3a_0 = acc0;');
  });
});

describe('upscale literals', () => {
  it('lit() always emits a float literal that round-trips float32', () => {
    for (const v of [0, 1, -3, 0.1, -3e-9, 123456789, 1e21, Math.fround(0.3)]) {
      const s = lit(v);
      expect(s).toMatch(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/);
      expect(/[.e]/.test(s)).toBe(true);
      expect(Math.fround(Number(s))).toBe(Math.fround(v));
    }
  });

  it('matLiteral is column-major: entry (col,row) = W[outChannels[row], 4v+col, ky, kx]', () => {
    const layer: ConvLayer = { inC: 5, outC: 16, weights: new Float32Array(16 * 5 * 9), bias: new Float32Array(16), relu: false };
    layer.weights.forEach((_, k) => { layer.weights[k] = k + 1; });
    const out = [4, 5, 6, 7];
    const m = matLiteral(layer, out, 1, 2, 0)!;
    const nums = m.slice('mat4x4<f32>('.length, -1).split(',').map((s) => Number(s.trim()));
    expect(nums).toHaveLength(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        const inCh = 4 + col;
        const want = inCh < 5 ? layer.weights[((out[row]! * 5 + inCh) * 3 + 2) * 3 + 0]! : 0;
        expect(nums[col * 4 + row]).toBe(want);
      }
    }
    const zero: ConvLayer = { ...layer, weights: new Float32Array(layer.weights.length) };
    expect(matLiteral(zero, out, 0, 0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts`
Expected: FAIL — cannot resolve `./upscale-wgsl`.

- [ ] **Step 3: Implement `upscale-wgsl.ts`**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.ts`:

```ts
/**
 * NEURAL UPSCALE — WGSL generation (spec §3, §4).
 *
 * A model becomes fullscreen fragment passes:
 *   - conv passes at the LOW resolution, <= 16 output channels each (4 RGBA16F
 *     MRT targets, the device's default 32 bytes/sample limit);
 *   - 'sp': the 16-channel last conv, then a SHUFFLE pass at full resolution;
 *   - 'dc': a DECONV pass at full resolution that computes only the output
 *     pixel's own sub-pixel channels (Colbert et al. 2021) — same weights.
 *
 * Weights are baked as literals, so a different model is a different shader.
 *
 * NO COMMENTS INSIDE ANY GENERATED PARAMETER LIST (three's wgslFn parser reads
 * `word: word` there as a phantom input — see sdf-layer.test.ts).
 */
import type { ConvLayer, UpscaleLayout, UpscaleModel } from './upscale-model';

export interface PassSpec {
  /** 'L1a', 'L2b', 'shuffle', 'deconv' — unique within a stage; also the pass label suffix. */
  name: string;
  kind: 'conv' | 'shuffle' | 'deconv';
  /** 'low' = the march size; 'full' = the output size. */
  outputRes: 'low' | 'full';
  /** Render-target textures written: conv 1..4 (RGBA16F), shuffle/deconv 1 (RGBA32F). */
  targets: number;
  /** Texture inputs in parameter order: 'march' or '<pass name>:<texture index>'. */
  inputs: string[];
  /** wgslFn parameter name for each input, same order. */
  params: string[];
  usesNearFar: boolean;
  fnName: string;
  /** The pass's main function. */
  run: string;
  /** conv only: a dummy fn followed by the pass's var<private> globals. */
  state: string;
  /** conv only: one readback fn per target. */
  reads: string[];
}

/** A WGSL float literal that round-trips float32. */
export function lit(v: number): string {
  const s = Math.fround(v).toPrecision(9);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/**
 * Column-major mat4x4 mapping the 4 channels of input vec4 `v` to the 4
 * output channels `outChannels` for tap (ky, kx): entry (col, row) =
 * W[outChannels[row], 4v + col, ky, kx]; channels past the layer's width are 0.
 * Returns null when every entry is 0, so the term can be skipped.
 */
export function matLiteral(layer: ConvLayer, outChannels: readonly number[], v: number, ky: number, kx: number): string | null {
  const vals: number[] = [];
  let any = false;
  for (let col = 0; col < 4; col++) {
    const inCh = 4 * v + col;
    for (let row = 0; row < 4; row++) {
      const o = outChannels[row]!;
      const w = inCh < layer.inC && o >= 0 && o < layer.outC
        ? layer.weights[((o * layer.inC + inCh) * 3 + ky) * 3 + kx]!
        : 0;
      if (w !== 0) any = true;
      vals.push(w);
    }
  }
  return any ? `mat4x4<f32>(${vals.map(lit).join(', ')})` : null;
}

function biasLiteral(layer: ConvLayer, outChannels: readonly number[]): string {
  return `vec4<f32>(${outChannels.map((o) => lit(o >= 0 && o < layer.outC ? layer.bias[o]! : 0)).join(', ')})`;
}

/** Shared §4 reconstruction, included by the shuffle and deconv passes. */
export const UPSCALE_RECONSTRUCT_WGSL = /* wgsl */ `fn upReconstruct(
  march: texture_2d<f32>,
  x: i32,
  y: i32,
  i: i32,
  j: i32,
  res: vec4<f32>
) -> vec4<f32> {
  let maxI = vec2<i32>(textureDimensions(march, 0)) - vec2<i32>(1, 1);
  let own = textureLoad(march, clamp(vec2<i32>(x, y), vec2<i32>(0, 0), maxI), 0);
  let ownHit = select(0.0, 1.0, own.w < 1.0);
  if (ownHit + res.w <= 0.5) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let sx = select(-1, 1, j == 1);
  let sy = select(-1, 1, i == 1);
  var src = own;
  if (own.w >= 1.0) {
    let c1 = textureLoad(march, clamp(vec2<i32>(x + sx, y), vec2<i32>(0, 0), maxI), 0);
    let c2 = textureLoad(march, clamp(vec2<i32>(x, y + sy), vec2<i32>(0, 0), maxI), 0);
    let c3 = textureLoad(march, clamp(vec2<i32>(x + sx, y + sy), vec2<i32>(0, 0), maxI), 0);
    if (c1.w < 1.0) { src = c1; }
    else if (c2.w < 1.0) { src = c2; }
    else if (c3.w < 1.0) { src = c3; }
    else { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  }
  return vec4<f32>(max(src.xyz + res.xyz, vec3<f32>(0.0)), src.w);
}`;

function lowPrelude(dimsTex: string): string {
  return `  let dims = vec2<i32>(textureDimensions(${dimsTex}, 0));
  let maxI = dims - vec2<i32>(1, 1);
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let p = clamp(vec2<i32>(floor(st * vec2<f32>(dims))), vec2<i32>(0, 0), maxI);
`;
}

const FULL_PRELUDE = `  let lowDims = vec2<i32>(textureDimensions(march, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let big = clamp(vec2<i32>(floor(st * outSize)), vec2<i32>(0, 0), vec2<i32>(outSize) - vec2<i32>(1, 1));
  let x = min(big.x / 2, lowDims.x - 1);
  let y = min(big.y / 2, lowDims.y - 1);
  let i = big.y % 2;
  let j = big.x % 2;
  let s = i * 2 + j;
`;

/** The 9 tap coordinates q0..q8, k = ky * 3 + kx, offset (kx - 1, ky - 1). */
function tapCoords(center: string, maxI: string): string {
  const lines: string[] = [];
  for (let ky = 0; ky < 3; ky++) {
    for (let kx = 0; kx < 3; kx++) {
      lines.push(`  let q${ky * 3 + kx} = clamp(${center} + vec2<i32>(${kx - 1}, ${ky - 1}), vec2<i32>(0, 0), ${maxI});`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** First-layer taps: assemble the network input from the march texel (spec §2). */
function marchInputTaps(model: UpscaleModel): string {
  const s = model.inScale;
  const o = model.inOffset;
  const lines: string[] = [];
  for (let k = 0; k < 9; k++) {
    lines.push(`  let m${k} = textureLoad(march, q${k}, 0);`);
    lines.push(`  let h${k} = select(0.0, 1.0, m${k}.w < 1.0);`);
    lines.push(`  let a0_${k} = vec4<f32>(m${k}.xyz * h${k}, h${k}) * vec4<f32>(${lit(s[0]!)}, ${lit(s[1]!)}, ${lit(s[2]!)}, ${lit(s[3]!)}) + vec4<f32>(${lit(o[0]!)}, ${lit(o[1]!)}, ${lit(o[2]!)}, ${lit(o[3]!)});`);
    if (model.inputs === 'rgbd') {
      lines.push(`  let a1_${k} = vec4<f32>(h${k} * (nearFar.x * nearFar.y / (nearFar.y - m${k}.w * (nearFar.y - nearFar.x))) * ${lit(s[4]!)} + ${lit(o[4]!)}, 0.0, 0.0, 0.0);`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Hidden-layer taps: a<t>_<k> = input texture t at tap k. */
function textureTaps(nTex: number): string {
  const lines: string[] = [];
  for (let t = 0; t < nTex; t++) {
    for (let k = 0; k < 9; k++) lines.push(`  let a${t}_${k} = textureLoad(in${t}, q${k}, 0);`);
  }
  return `${lines.join('\n')}\n`;
}

/** `var <name> = bias; name += M * tap;` for 4 output channels. */
function accumulate(layer: ConvLayer, outChannels: readonly number[], nIn: number, name: string): string {
  const lines = [`  var ${name} = ${biasLiteral(layer, outChannels)};`];
  for (let v = 0; v < nIn; v++) {
    for (let ky = 0; ky < 3; ky++) {
      for (let kx = 0; kx < 3; kx++) {
        const m = matLiteral(layer, outChannels, v, ky, kx);
        if (m) lines.push(`  ${name} += ${m} * a${v}_${ky * 3 + kx};`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function signature(fnName: string, params: string[]): string {
  return `fn ${fnName}(\n  ${params.join(',\n  ')}\n) -> vec4<f32> {\n`;
}

function convPass(model: UpscaleModel, layerIndex: number, passIndex: number, inputs: string[]): PassSpec {
  const layer = model.layers[layerIndex]!;
  const first = layerIndex === 0;
  const name = `L${layerIndex + 1}${'abcdefgh'[passIndex]}`;
  const outStart = passIndex * 16;
  const outCount = Math.min(16, layer.outC - outStart);
  const targets = outCount / 4;
  const fnName = `upRun${name}`;
  const usesNearFar = first && model.inputs === 'rgbd';
  const params = first ? ['march'] : inputs.map((_, k) => `in${k}`);
  const sig = [
    ...params.map((p) => `${p}: texture_2d<f32>`),
    'texCoord: vec2<f32>',
    'flipY: f32',
    ...(usesNearFar ? ['nearFar: vec2<f32>'] : []),
  ];
  const nIn = first ? (model.inputs === 'rgbd' ? 2 : 1) : inputs.length;
  let body = lowPrelude(params[0]!) + tapCoords('p', 'maxI') + (first ? marchInputTaps(model) : textureTaps(inputs.length));
  const globals: string[] = [];
  for (let t = 0; t < targets; t++) {
    const outCh = [0, 1, 2, 3].map((r) => outStart + 4 * t + r);
    body += accumulate(layer, outCh, nIn, `acc${t}`);
    const g = `gUp${name}_${t}`;
    globals.push(g);
    body += `  ${g} = ${layer.relu ? `max(acc${t}, vec4<f32>(0.0))` : `acc${t}`};\n`;
  }
  const run = `${signature(fnName, sig)}${body}  return ${globals[0]};\n}`;
  const state = `fn upState${name}() -> f32 {\n  return 0.0;\n}\n${globals.map((g) => `var<private> ${g}: vec4<f32>;`).join('\n')}\n`;
  const reads = globals.map((g, t) => `fn upRead${name}_${t}(dep: vec4<f32>) -> vec4<f32> {\n  return ${g};\n}`);
  return {
    name, kind: 'conv', outputRes: 'low', targets,
    inputs: first ? ['march'] : [...inputs], params, usesNearFar, fnName, run, state, reads,
  };
}

function shufflePass(lastPassName: string): PassSpec {
  const inputs = ['march', ...[0, 1, 2, 3].map((k) => `${lastPassName}:${k}`)];
  const params = ['march', 'in0', 'in1', 'in2', 'in3'];
  const sig = [...params.map((p) => `${p}: texture_2d<f32>`), 'texCoord: vec2<f32>', 'flipY: f32', 'outSize: vec2<f32>'];
  const body = `${FULL_PRELUDE}  let lp = vec2<i32>(x, y);
  let rr = textureLoad(in0, lp, 0);
  let gg = textureLoad(in1, lp, 0);
  let bb = textureLoad(in2, lp, 0);
  let cc = textureLoad(in3, lp, 0);
  return upReconstruct(march, x, y, i, j, vec4<f32>(rr[s], gg[s], bb[s], cc[s]));
`;
  return {
    name: 'shuffle', kind: 'shuffle', outputRes: 'full', targets: 1, inputs, params,
    usesNearFar: false, fnName: 'upRunShuffle', run: `${signature('upRunShuffle', sig)}${body}}`, state: '', reads: [],
  };
}

function deconvPass(model: UpscaleModel, hiddenInputs: string[]): PassSpec {
  const lastLayer = model.layers[model.layers.length - 1]!;
  const params = ['march', ...hiddenInputs.map((_, k) => `in${k}`)];
  const sig = [...params.map((p) => `${p}: texture_2d<f32>`), 'texCoord: vec2<f32>', 'flipY: f32', 'outSize: vec2<f32>'];
  let body = `${FULL_PRELUDE}  let maxI = lowDims - vec2<i32>(1, 1);\n`;
  body += tapCoords('vec2<i32>(x, y)', 'maxI') + textureTaps(hiddenInputs.length);
  body += '  var res = vec4<f32>(0.0);\n';
  for (let s = 0; s < 4; s++) {
    const outCh = [0, 1, 2, 3].map((c) => c * 4 + s);
    const head = s === 0 ? 'if (s == 0)' : s < 3 ? `else if (s == ${s})` : 'else';
    body += `  ${head} {\n`;
    body += accumulate(lastLayer, outCh, hiddenInputs.length, 'acc').replace(/^/gm, '  ');
    body += '    res = acc;\n  }\n';
  }
  body += '  return upReconstruct(march, x, y, i, j, res);\n';
  return {
    name: 'deconv', kind: 'deconv', outputRes: 'full', targets: 1, inputs: ['march', ...hiddenInputs], params,
    usesNearFar: false, fnName: 'upRunDeconv', run: `${signature('upRunDeconv', sig)}${body}}`, state: '', reads: [],
  };
}

/** The ordered pass list for a model and layout (spec §3). */
export function planUpscalePasses(model: UpscaleModel, layout: UpscaleLayout): PassSpec[] {
  const passes: PassSpec[] = [];
  let inputs: string[] = ['march'];
  const convLayers = layout === 'sp' ? model.layers.length : model.layers.length - 1;
  for (let l = 0; l < convLayers; l++) {
    const layer = model.layers[l]!;
    const made: PassSpec[] = [];
    for (let p = 0; p * 16 < layer.outC; p++) made.push(convPass(model, l, p, inputs));
    passes.push(...made);
    inputs = made.flatMap((ps) => Array.from({ length: ps.targets }, (_, t) => `${ps.name}:${t}`));
  }
  passes.push(layout === 'sp' ? shufflePass(passes[passes.length - 1]!.name) : deconvPass(model, inputs));
  return passes;
}
```

Note on `accumulate(...).replace(/^/gm, '  ')`: it indents the deconv branch bodies. The trailing newline produces one extra two-space line, which is harmless WGSL whitespace.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — Expected: no errors.

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.ts src/lab/sdf-zombie/webgpu/upscale/upscale-wgsl.test.ts
git commit -m "feat(upscale): WGSL pass generator — conv MRT passes, shuffle and deconv layouts"
```

---

### Task 3: The three.js stage

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts`
- Test: `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts`

Background you need:
- Materials follow the accumulation resolve in `sdf-layer.ts` (`accumMat`, ~line 1388): `MeshBasicNodeMaterial`, depth test/write off, and for a single RGBA32F target BOTH `colorNode` and `outputNode` = `vec4(rgb, depth)` — without `outputNode` the pipeline forces alpha to 1 and every pixel reads as "no flesh".
- MRT materials follow `createMarchMaterial(..., 'surface')` in `zombie-gpu.ts` (~line 1253) and `createSurfaceTarget` in `deferred-surface.ts` (~line 245): `material.mrtNode = mrt({ name: node })`, and the render target's `textures[k].name` must equal the MRT key.
- The run call result is cached with `.toVar(name)` and passed as `dep` to each readback, exactly like `sdfSurfaceMrtNodes` in `deferred-sdf.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createUpscaleStage, upscaleInfoOf } from './upscale-stage';

function fakeRenderer() {
  const calls: { target: THREE.RenderTarget | null; autoClear: boolean }[] = [];
  let current: THREE.RenderTarget | null = null;
  const r = {
    autoClear: true,
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    render: () => { calls.push({ target: current, autoClear: r.autoClear }); },
  };
  return { renderer: r as unknown as THREE.WebGPURenderer, calls, raw: r };
}

describe('upscale stage wiring', () => {
  it('allocates half-float MRT feature targets at low res and one RGBA32F output at full res', () => {
    const stage = createUpscaleStage({ model: 's32', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    expect(stage.passes.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'L3a', 'shuffle']);
    const l1 = stage.targetFor('L1a');
    expect(l1.textures.map((t) => t.name)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(l1.textures.every((t) => t.type === THREE.HalfFloatType)).toBe(true);
    expect([l1.width, l1.height]).toEqual([400, 300]);
    expect(stage.targetFor('shuffle')).toBe(stage.output);
    expect(stage.output.texture.type).toBe(THREE.FloatType);
    expect([stage.output.width, stage.output.height]).toEqual([800, 600]);
    const s8 = createUpscaleStage({ model: 's8', layout: 'dc', inputs: 'rgbd', seed: 1 }, new THREE.Texture(), uniform(1));
    expect(s8.targetFor('L1a').textures).toHaveLength(2);
    expect(() => s8.targetFor('nope')).toThrow(/no pass/);
    stage.dispose();
    s8.dispose();
  });

  it('renders every pass in order with autoClear off, then restores renderer state', () => {
    const stage = createUpscaleStage({ model: 's16', layout: 'dc', inputs: 'rgb', seed: 2 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    const { renderer, calls, raw } = fakeRenderer();
    const previous = new THREE.RenderTarget(2, 2);
    raw.setRenderTarget(previous);
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera(75, 4 / 3, 0.05, 200));
    expect(calls.map((c) => c.target)).toEqual(stage.passes.map((p) => stage.targetFor(p.name)));
    expect(calls.every((c) => c.autoClear === false)).toBe(true);
    expect(raw.autoClear).toBe(true);
    expect(raw.getRenderTarget()).toBe(previous);
    stage.dispose();
  });

  it('reports info, and null when off', () => {
    const stage = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 5 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    const info = upscaleInfoOf(stage);
    expect(info).toMatchObject({ on: true, model: 's8', layout: 'sp', inputs: 'rgb', seed: 5, inSize: { width: 400, height: 300 }, outSize: { width: 800, height: 600 } });
    expect(info.weightHash).toMatch(/^[0-9a-f]{8}$/);
    expect(info.passes).toEqual(['L1a', 'L2a', 'L3a', 'shuffle']);
    expect(upscaleInfoOf(null)).toMatchObject({ on: false, model: null, passes: [] });
    stage.dispose();
  });

  it('dispose releases every target', () => {
    const stage = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    const spies = stage.passes.map((p) => vi.spyOn(stage.targetFor(p.name), 'dispose'));
    stage.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts`
Expected: FAIL — cannot resolve `./upscale-stage`.

- [ ] **Step 3: Implement `upscale-stage.ts`**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts`:

```ts
/**
 * NEURAL UPSCALE — the three.js stage (spec §1, §3, §6).
 *
 * Contract: reads the low-res march texture (rgb + clip depth in alpha, alpha
 * >= 1 = no flesh) and writes `output`, an output-sized RGBA32F texture in
 * the SAME convention, which the composite reads. Depth is never produced by
 * the network (spec §4).
 */
import * as THREE from 'three/webgpu';
import { mrt, texture, uniform, uv, vec4, wgslFn } from 'three/tsl';
import { setPassLabel } from '../gpu-pass-timing';
import {
  createUpscaleModel, type UpscaleConfig, type UpscaleInputSet, type UpscaleLayout,
  type UpscaleModel, type UpscaleModelId,
} from './upscale-model';
import { planUpscalePasses, UPSCALE_RECONSTRUCT_WGSL, type PassSpec } from './upscale-wgsl';

export interface UpscaleStage {
  readonly config: UpscaleConfig;
  readonly model: UpscaleModel;
  readonly passes: readonly PassSpec[];
  /** Output-sized RGBA32F: rgb + clip depth, alpha 1.0 = no flesh. */
  readonly output: THREE.RenderTarget;
  readonly inSize: { width: number; height: number };
  readonly outSize: { width: number; height: number };
  /** The render target a pass writes (feature MRT, or `output`). */
  targetFor(passName: string): THREE.RenderTarget;
  setSize(inW: number, inH: number, outW: number, outH: number): void;
  render(renderer: THREE.WebGPURenderer, quadCam: THREE.Camera, camera: THREE.Camera): void;
  dispose(): void;
}

export interface UpscaleInfo {
  on: boolean;
  model: UpscaleModelId | null;
  layout: UpscaleLayout | null;
  inputs: UpscaleInputSet | null;
  seed: number | null;
  weightHash: string | null;
  passes: string[];
  inSize: { width: number; height: number } | null;
  outSize: { width: number; height: number } | null;
}

export function upscaleInfoOf(stage: UpscaleStage | null): UpscaleInfo {
  if (!stage) {
    return { on: false, model: null, layout: null, inputs: null, seed: null, weightHash: null, passes: [], inSize: null, outSize: null };
  }
  return {
    on: true,
    model: stage.config.model,
    layout: stage.config.layout,
    inputs: stage.config.inputs,
    seed: stage.config.seed,
    weightHash: stage.model.weightHash,
    passes: stage.passes.map((p) => p.name),
    inSize: { ...stage.inSize },
    outSize: { ...stage.outSize },
  };
}

type Built = { spec: PassSpec; target: THREE.RenderTarget; scene: THREE.Scene; mesh: THREE.Mesh; material: THREE.MeshBasicNodeMaterial };

/**
 * @param marchTexture the march target's texture (a stable object; resizing the
 *   target does not replace it).
 * @param flipY the layer's shared flipY uniform node (sdf-layer.ts `uFlipY`).
 */
export function createUpscaleStage(config: UpscaleConfig, marchTexture: THREE.Texture, flipY: unknown): UpscaleStage {
  const model = createUpscaleModel(config.model, config.inputs, config.seed);
  const passes = planUpscalePasses(model, config.layout);
  const uNearFar = uniform(new THREE.Vector2(0.1, 100));
  const uOutSize = uniform(new THREE.Vector2(1, 1));
  const reconstructNode = wgslFn(UPSCALE_RECONSTRUCT_WGSL);
  const inSize = { width: 1, height: 1 };
  const outSize = { width: 1, height: 1 };

  const output = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });

  const targets = new Map<string, THREE.RenderTarget>();
  const built: Built[] = [];
  const textureOf = (ref: string): THREE.Texture => {
    if (ref === 'march') return marchTexture;
    const [name, index] = ref.split(':');
    const t = targets.get(name!);
    if (!t) throw new Error(`upscale: pass input ${ref} is not produced by an earlier pass`);
    return t.textures[Number(index)]!;
  };

  for (const spec of passes) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NoBlending;
    const args: Record<string, unknown> = { texCoord: uv(), flipY };
    spec.inputs.forEach((ref, k) => { args[spec.params[k]!] = texture(textureOf(ref)); });
    if (spec.usesNearFar) args.nearFar = uNearFar;
    if (spec.outputRes === 'full') args.outSize = uOutSize;

    let target: THREE.RenderTarget;
    if (spec.kind === 'conv') {
      target = new THREE.RenderTarget(1, 1, { count: spec.targets, depthBuffer: false });
      target.textures.forEach((tex, k) => {
        tex.name = `f${k}`;
        tex.format = THREE.RGBAFormat;
        tex.type = THREE.HalfFloatType;
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.NoColorSpace;
        tex.generateMipmaps = false;
      });
      const state = wgslFn(spec.state);
      // Includes are cast: three's types reject an inline node array (same runtime shape deferred-sdf.ts passes).
      const run = wgslFn(spec.run, [state] as never);
      const cached = (run(args as never) as unknown as { toVar: (n: string) => unknown }).toVar(`upRun${spec.name}`);
      const outs: Record<string, unknown> = {};
      spec.reads.forEach((src, k) => { outs[`f${k}`] = wgslFn(src, [state] as never)({ dep: cached as never }); });
      material.mrtNode = mrt(outs as never) as never;
    } else {
      target = output;
      const run = wgslFn(spec.run, [reconstructNode] as never);
      const out = run(args as never) as unknown as { xyz: unknown; w: unknown };
      material.colorNode = vec4(out.xyz as never, out.w as never);
      material.outputNode = vec4(out.xyz as never, out.w as never);
    }
    targets.set(spec.name, target);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    built.push({ spec, target, scene, mesh, material });
  }

  return {
    config: { ...config },
    model,
    passes,
    output,
    get inSize() { return inSize; },
    get outSize() { return outSize; },
    targetFor(passName) {
      const t = targets.get(passName);
      if (!t) throw new Error(`upscale: no pass named ${passName}`);
      return t;
    },
    setSize(inW, inH, outW, outH) {
      inSize.width = inW; inSize.height = inH;
      outSize.width = outW; outSize.height = outH;
      for (const b of built) if (b.spec.outputRes === 'low') b.target.setSize(inW, inH);
      output.setSize(outW, outH);
      (uOutSize.value as THREE.Vector2).set(outW, outH);
    },
    render(renderer, quadCam, camera) {
      const cam = camera as THREE.PerspectiveCamera;
      (uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
      const previous = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      // Every pass writes every pixel (no discard), so a clear would be wasted work.
      renderer.autoClear = false;
      for (const b of built) {
        setPassLabel(`sdf:upscale:${b.spec.name}`);
        renderer.setRenderTarget(b.target);
        void renderer.render(b.scene, quadCam);
      }
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(previous);
    },
    dispose() {
      for (const b of built) {
        b.mesh.geometry.dispose();
        b.material.dispose();
        if (b.target !== output) b.target.dispose();
      }
      output.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/`
Expected: PASS (all three upscale test files). If `dispose` spies fail for the shuffle/deconv pass, note that its target IS `output` and is disposed once — the spy still sees the call.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — Expected: no errors. If three's types reject `count` or `mrtNode`, use the same casts `deferred-surface.ts` / `zombie-gpu.ts` use; do not change behavior.

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts
git commit -m "feat(upscale): three.js stage — MRT feature passes, output target, pass labels"
```

---

### Task 4: Integrate the stage into the SDF layer and the game page

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts`
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Create: `scripts/upscale-smoke.mjs`
- Modify (only if the smoke finds a generator bug): `src/lab/sdf-zombie/webgpu/upscale/*`

- [ ] **Step 1: Write the failing layer tests**

Append to the END of `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`:

```ts
describe('neural upscale stage in the layer (spec 2026-09-11-neural-upscale-espcn-design.md)', () => {
  /** Same shape as the field tests' fake renderer: records every render() target. */
  function fakeRenderer() {
    const calls: { target: THREE.RenderTarget | null }[] = [];
    let currentTarget: THREE.RenderTarget | null = null;
    let clearAlpha = 1;
    const r = {
      autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      render: () => { calls.push({ target: currentTarget }); },
      clear: () => {},
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (a: number) => { clearAlpha = a; },
      getClearColor: (c: THREE.Color) => c,
      setClearColor: vi.fn(),
      getClearDepth: () => 1,
      setClearDepth: vi.fn(),
      copyTextureToTexture: vi.fn(),
      compileAsync: vi.fn(async () => {}),
    };
    return { renderer: r as unknown as THREE.WebGPURenderer, calls };
  }
  const cfg = { model: 's8', layout: 'sp', inputs: 'rgb', seed: 1 } as const;

  it('is off by default: no stage passes run', () => {
    const { renderer, calls } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(layer.upscaleInfo.on).toBe(false);
    expect(layer.upscaleStage).toBeNull();
    expect(calls.some((c) => c.target?.textures[0]?.name === 'f0')).toBe(false);
    layer.dispose();
  });

  it('on: forces fields off, sizes 400x300 -> 800x600, and runs every pass in order before the composite', () => {
    const { renderer, calls } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.setFieldStyle('bodies');
    layer.setScale(0.5);
    const info = layer.setUpscale(cfg);
    expect(info.on).toBe(true);
    expect(layer.fieldStyle).toBe('off');
    expect(info.inSize).toEqual({ width: 400, height: 300 });
    expect(info.outSize).toEqual({ width: 800, height: 600 });
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    const stage = layer.upscaleStage!;
    const idx = stage.passes.map((p) => calls.findIndex((c) => c.target === stage.targetFor(p.name)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const marchIdx = calls.findIndex((c) => c.target === layer.marchTarget);
    expect(marchIdx).toBeGreaterThanOrEqual(0);
    expect(marchIdx).toBeLessThan(idx[0]!);
    const compositeAfter = calls.findIndex((c, k) => k > idx[idx.length - 1]! && c.target === layer.outputTarget);
    expect(compositeAfter).toBeGreaterThan(idx[idx.length - 1]!);
    layer.dispose();
  });

  it('on: refuses temporal accumulation and field styles; off restores both', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.setScale(0.5);
    layer.setUpscale(cfg);
    expect(layer.setTemporalAccum(true)).toBe(false);
    layer.setFieldStyle('bodies');
    expect(layer.fieldStyle).toBe('off');
    expect(warn).toHaveBeenCalled();
    expect(layer.setUpscale(null).on).toBe(false);
    expect(layer.upscaleStage).toBeNull();
    layer.setFieldStyle('bodies');
    expect(layer.fieldStyle).toBe('bodies');
    expect(layer.setTemporalAccum(true)).toBe(true);
    warn.mockRestore();
    layer.dispose();
  });

  it('turning accumulation off while the stage is on keeps the composite on the stage output', () => {
    const { renderer } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.setUpscale(cfg);
    layer.setTemporalAccum(false);
    expect(layer.upscaleInfo.on).toBe(true);
    expect(layer.compositeSource).toBe('upscale');
    layer.setUpscale(null);
    expect(layer.compositeSource).toBe('march');
    layer.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts -t "neural upscale"`
Expected: FAIL — `setUpscale` / `upscaleInfo` / `upscaleStage` / `compositeSource` do not exist.

- [ ] **Step 3: Implement in `sdf-layer.ts`**

3a. Add imports next to the other local imports at the top of the file:

```ts
import { createUpscaleStage, upscaleInfoOf, type UpscaleInfo, type UpscaleStage } from './upscale/upscale-stage';
import type { UpscaleConfig } from './upscale/upscale-model';
```

3b. In the `SdfLayer` interface, directly after the line `  setTemporalAccum(on: boolean, alpha?: number): boolean;`, add:

```ts
  /** NEURAL UPSCALE STAGE (spec docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md).
   *  march -> upscale -> composite. `null` turns it off. On: forces field style
   *  'off' and refuses temporal accumulation (stacking is P5); the composite reads
   *  the stage's output-resolution flesh. The caller sets the march scale. */
  setUpscale(config: UpscaleConfig | null): UpscaleInfo;
  readonly upscaleInfo: UpscaleInfo;
  /** The live stage, for measurement readbacks only; null when off. */
  readonly upscaleStage: UpscaleStage | null;
  /** Which flesh texture the composite reads: the raw march, the accumulated history, or the upscale output. */
  readonly compositeSource: 'march' | 'accum' | 'upscale';
```

3c. Find the composite call (`const sampled = composite({`). Directly BEFORE it add:

```ts
  // The composite's output-resolution flesh input. Held as a node so the upscale
  // stage can REBIND its value (stage output) without touching COMPOSITE_WGSL:
  // the default path keeps the same shader and the same accumNext binding.
  const accumTexNode = texture(accumNext.texture);
```

and inside the call replace the line `    accumTex: texture(accumNext.texture),` with:

```ts
    accumTex: accumTexNode,
```

3d. Directly after the line `  let accumSeed = true;` add:

```ts
  /** The neural upscale stage, or null (spec 2026-09-11). */
  let upscale: UpscaleStage | null = null;
```

3e. In `resize()`, directly after `    accumNext.setSize(fullW, fullH);` add:

```ts
    // The upscale stage reads the march grid and writes the output grid.
    upscale?.setSize(w, h, fullW, fullH);
```

3f. In `render`, directly BEFORE the line `      // Pass 3 — composite up. autoClear off, or this wipes pass 1.` add:

```ts
      // NEURAL UPSCALE STAGE (2026-09-11): between the march and the composite,
      // where the accumulation resolve sits (the two are exclusive until P5). The
      // composite reads upscale.output through accumTexNode.
      if (upscale) upscale.render(renderer, quadCam, camera);
```

3g. In `setTemporalAccum(on, alpha) {`, make the FIRST statement:

```ts
      if (on && upscale) {
        console.warn('[sdf-layer] temporal accumulation refused while the upscale stage is on (stacking is P5)');
        return accumOn;
      }
```

and replace `      (uAccumOn.value as number) = on ? 1 : 0;` with:

```ts
      // The composite's output-resolution branch also carries the upscale stage.
      (uAccumOn.value as number) = on || upscale !== null ? 1 : 0;
```

3h. In `setFieldStyle(style) {`, directly after `      if (style === fieldStyle) return;` add:

```ts
      if (upscale && style !== 'off') {
        console.warn(`[sdf-layer] field style '${style}' refused while the upscale stage is on (stacking is P5)`);
        return;
      }
```

3i. Directly after the `resetTemporalAccum() { resetAccum(); },` method add:

```ts
    setUpscale(config) {
      if (config === null) {
        upscale?.dispose();
        upscale = null;
        accumTexNode.value = accumNext.texture;
        (uAccumOn.value as number) = accumOn ? 1 : 0;
        return upscaleInfoOf(null);
      }
      if (accumOn) {
        console.warn('[sdf-layer] upscale: turning temporal accumulation OFF (the two do not stack until P5)');
        this.setTemporalAccum(false);
      }
      if (fieldStyle !== 'off') this.setFieldStyle('off');
      upscale?.dispose();
      upscale = createUpscaleStage(config, target.texture, uFlipY);
      upscale.setSize(target.width, target.height, fullW, fullH);
      accumTexNode.value = upscale.output.texture;
      (uAccumOn.value as number) = 1;
      return upscaleInfoOf(upscale);
    },
    get upscaleInfo() { return upscaleInfoOf(upscale); },
    get upscaleStage() { return upscale; },
    get compositeSource() { return upscale ? 'upscale' : accumOn ? 'accum' : 'march'; },
```

Note the order inside `setUpscale`: fields go off BEFORE the stage is created, so `target` already has the unhalved height.

3j. In `dispose()`, add as the first line of the method body: `      upscale?.dispose();`

- [ ] **Step 4: Run the layer tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
Expected: PASS, including every pre-existing test (the default path must not change).

- [ ] **Step 5: Wire the game page**

5a. In `src/lab/sdf-zombie/webgpu/game-main.ts`, next to the existing `./boot-params` import add:

```ts
import { parseUpscaleConfig, UPSCALE_SCALE } from './upscale/upscale-model';
```

5b. Find the accumulation boot block that ends with:

```ts
      sdfLayer.setTemporalAccum(true, alpha ?? undefined);
    }
  }
```

Directly after it (before the `// Headless A/B seams (2026-08-27 hull-holes diagnosis)` comment) add:

```ts
  // NEURAL UPSCALE STAGE (spec docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md).
  // `?upscale=<s8|s16|s32|zero>` enables it with RANDOM weights (a cost/parity
  // probe, not a look) and drops the march to 0.5 — the stage upscales exactly 2x.
  // `?upscalelayout=<sp|dc>`, `?upscaleinputs=<rgb|rgbd>`, `?upscaleseed=<int>`.
  // Dev-only; absent = the shipped path. The scale goes through the game's own
  // sdfScale state, exactly like the ?accum block above (b9fad129).
  {
    const upSearch = new URLSearchParams(location.search);
    const upRaw = upSearch.get('upscale');
    if (upRaw !== null && upRaw !== '0') {
      const cfg = parseUpscaleConfig({
        model: upRaw,
        layout: upSearch.get('upscalelayout') ?? undefined,
        inputs: upSearch.get('upscaleinputs') ?? undefined,
        seed: parseIntParam(upSearch.get('upscaleseed'), { min: 0, max: 2 ** 31 - 1 }) ?? undefined,
      });
      sdfScale = UPSCALE_SCALE;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
      sdfLayer.setUpscale(cfg);
    }
  }
```

5c. Find the seam line `    resetTemporalAccum: () => sdfLayer.resetTemporalAccum(),` and directly after it add:

```ts
    /** NEURAL UPSCALE (spec 2026-09-11). Enabling also sets the march scale to 0.5
     *  through applySdfScale (the game's own state). `null` turns the stage off and
     *  leaves the scale alone — callers restore it. Random weights: cost/parity only. */
    setUpscale: (raw: { model: string; layout?: string; inputs?: string; seed?: number } | null) => {
      if (raw === null) return sdfLayer.setUpscale(null);
      const cfg = parseUpscaleConfig(raw);
      applySdfScale(UPSCALE_SCALE);
      return sdfLayer.setUpscale(cfg);
    },
    /** Stage state plus the camera's near/far (what rgbd depth linearization uses).
     *  near/far are reported even when the stage is off (the capture script needs them). */
    upscaleInfo: () => ({
      ...sdfLayer.upscaleInfo,
      near: (camera as THREE.PerspectiveCamera).near,
      far: (camera as THREE.PerspectiveCamera).far,
    }),
```

If `camera` is not the name of the game camera in that scope, find the variable `normalCaptureState()` reads (`camera.matrixWorld`) and use it.

- [ ] **Step 6: Typecheck, targeted tests, build**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts src/lab/sdf-zombie/webgpu/upscale/` — Expected: PASS.
Run: `npm run build` — Expected: success.

- [ ] **Step 7: GPU compile smoke**

Create `scripts/upscale-smoke.mjs`:

```js
// scripts/upscale-smoke.mjs — compile smoke for the neural upscale stage: boots the
// game page with ?upscale flags and fails on any TSL/WGSL/pipeline console error.
// Usage:
//   LAB_VITE_PORT=5310 LAB_CDP_PORT=9310 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-smoke.mjs'
import { connectGame, bootCloseupPage } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5310);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9310);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 15 min'), 15 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upErrs = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upErrs.push(a.map(String).join(' ')); e(...a); };
    console.warn = (...a) => { window.__upErrs.push(a.map(String).join(' ')); w(...a); };
  })()`,
});
const QUERIES = [
  'upscale=zero',
  'upscale=s8',
  'upscale=s16&upscalelayout=sp&upscaleinputs=rgbd',
  'upscale=s32&upscalelayout=dc&upscaleinputs=rgbd',
];
let bad = false;
for (const q of QUERIES) {
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&${q}` });
  await evaluate('(() => { __sdfGame.step(12); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const info = await evaluate('__sdfGame.upscaleInfo()');
  const errs = (await evaluate('window.__upErrs')).filter((t) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
  console.log(`${q}\n  info ${JSON.stringify(info)}\n  shader errors: ${errs.length}`);
  for (const t of errs.slice(0, 5)) console.log(`    ${t.slice(0, 300)}`);
  const ok = info.on
    && info.inSize?.width === 400 && info.inSize?.height === 300
    && info.outSize?.width === 800 && info.outSize?.height === 600
    && errs.length === 0;
  if (!ok) bad = true;
}
console.log(bad ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(bad ? 1 : 0);
```

Run:

```bash
LAB_VITE_PORT=5310 LAB_CDP_PORT=9310 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-smoke.mjs'
```

Expected: four blocks with `"on":true`, `inSize {400,300}`, `outSize {800,600}`, `shader errors: 0`, then `SMOKE: PASS`. If `Input 'X' not found in Fn()` appears, a generated signature has a phantom input — fix `upscale-wgsl.ts` and re-run Task 2's tests. If a WGSL compile error appears, the console line names the offending line; fix the generator, restart vite (the script's lab-servers wrapper does this per run), re-run.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/sdf-layer.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts src/lab/sdf-zombie/webgpu/game-main.ts scripts/upscale-smoke.mjs
git add -u src/lab/sdf-zombie/webgpu/upscale/
git commit -m "feat(upscale): run the stage between march and composite; ?upscale flags, seams, compile smoke"
```

---

### Task 5: GPU parity against the CPU twin (gate G1-parity)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Create: `scripts/upscale-parity.mjs`
- Create: `docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md`

- [ ] **Step 1: Implement the in-page self-check**

Create `src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts`:

```ts
/**
 * NEURAL UPSCALE — in-page GPU vs CPU-twin comparison (spec gate G1-parity).
 * Float readbacks stay in the page; only statistics cross CDP.
 *
 * PRECONDITION: the caller froze the simulation and turned the render lock on
 * (__sdfGame.freeze(true); __sdfGame.setRenderLock(true)), so re-rendering does
 * not change the march target. `marchStable` in the result verifies it.
 */
import type * as THREE from 'three/webgpu';
import type { SdfLayer } from '../sdf-layer';
import type { UpscaleLayout } from './upscale-model';
import { upscaleReference, type FloatImage } from './upscale-reference';

export interface SelfCheckDeps {
  renderer: THREE.WebGPURenderer;
  layer: SdfLayer;
  camera: THREE.PerspectiveCamera;
  renderFrames: (n: number) => void;
  resolveGpu: () => Promise<unknown>;
}

export interface LayoutCheck {
  layout: UpscaleLayout;
  pixels: number;
  covered: number;
  /** max over covered-in-both pixels and rgb channels of |gpu - cpu| / max(1, |cpu|) */
  maxRelRgb: number;
  coverageMismatch: number;
  /** coverage mismatches whose CPU decision sits outside ±band of the threshold */
  coverageMismatchFar: number;
  depthMismatch: number;
}

export interface SelfCheckResult {
  model: string;
  inputs: string;
  seed: number;
  weightHash: string;
  marchSize: { width: number; height: number };
  marchStable: boolean;
  gpuVsCpu: LayoutCheck[];
  layouts: { pixels: number; bothCovered: number; maxRelRgb: number; coverageMismatch: number } | null;
  ms: number;
}

export const COVERAGE_BAND = 4e-3;

/** RGBA32F render-target readback with WebGPU row padding removed; row 0 = texel row 0. */
export async function readFloatTarget(renderer: THREE.WebGPURenderer, rt: THREE.RenderTarget): Promise<FloatImage> {
  const w = rt.width;
  const h = rt.height;
  const raw = new Float32Array(await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h) as unknown as ArrayLike<number>);
  const stride = Math.ceil((w * 16) / 256) * 64;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
  return { w, h, c: 4, data };
}

function sameImage(a: FloatImage, b: FloatImage): boolean {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) return false;
  for (let k = 0; k < a.data.length; k++) if (a.data[k] !== b.data[k]) return false;
  return true;
}

function compare(gpu: FloatImage, cpu: FloatImage, margin: Float32Array, layout: UpscaleLayout): LayoutCheck {
  const pixels = gpu.w * gpu.h;
  let covered = 0, maxRelRgb = 0, coverageMismatch = 0, coverageMismatchFar = 0, depthMismatch = 0;
  for (let p = 0; p < pixels; p++) {
    const b = p * 4;
    const gc = gpu.data[b + 3]! < 1;
    const cc = cpu.data[b + 3]! < 1;
    if (gc !== cc) {
      coverageMismatch++;
      if (Math.abs(margin[p]!) > COVERAGE_BAND) coverageMismatchFar++;
      continue;
    }
    if (!gc) continue;
    covered++;
    if (gpu.data[b + 3] !== cpu.data[b + 3]) depthMismatch++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(gpu.data[b + c]! - cpu.data[b + c]!) / Math.max(1, Math.abs(cpu.data[b + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return { layout, pixels, covered, maxRelRgb, coverageMismatch, coverageMismatchFar, depthMismatch };
}

function compareOutputs(a: FloatImage, b: FloatImage) {
  const pixels = a.w * a.h;
  let bothCovered = 0, maxRelRgb = 0, coverageMismatch = 0;
  for (let p = 0; p < pixels; p++) {
    const k = p * 4;
    const ac = a.data[k + 3]! < 1;
    const bc = b.data[k + 3]! < 1;
    if (ac !== bc) { coverageMismatch++; continue; }
    if (!ac) continue;
    bothCovered++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[k + c]! - b.data[k + c]!) / Math.max(1, Math.abs(b.data[k + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return { pixels, bothCovered, maxRelRgb, coverageMismatch };
}

export async function runUpscaleSelfCheck(deps: SelfCheckDeps, opts: { compareLayouts?: boolean } = {}): Promise<SelfCheckResult> {
  const t0 = performance.now();
  const initial = deps.layer.upscaleStage;
  if (!initial) throw new Error('upscaleSelfCheck: the upscale stage is off — call __sdfGame.setUpscale first');
  const original = { ...initial.config };
  const layouts: UpscaleLayout[] = opts.compareLayouts ? ['sp', 'dc'] : [original.layout];
  const outputs = new Map<UpscaleLayout, FloatImage>();
  const gpuVsCpu: LayoutCheck[] = [];
  let marchRef: FloatImage | null = null;
  let marchStable = true;
  for (const layout of layouts) {
    if (deps.layer.upscaleStage!.config.layout !== layout) deps.layer.setUpscale({ ...original, layout });
    // A new stage compiles its pipelines on first use: render several frames, measure the last.
    deps.renderFrames(8);
    await deps.resolveGpu();
    const stage = deps.layer.upscaleStage!;
    const march = await readFloatTarget(deps.renderer, deps.layer.marchTarget);
    const gpu = await readFloatTarget(deps.renderer, stage.output);
    if (marchRef) marchStable = marchStable && sameImage(marchRef, march);
    else marchRef = march;
    const margin = new Float32Array(gpu.w * gpu.h);
    const cpu = upscaleReference(march, stage.model, layout, deps.camera.near, deps.camera.far, gpu.w, gpu.h, {
      halfFloatStorage: true,
      marginOut: margin,
    });
    gpuVsCpu.push(compare(gpu, cpu, margin, layout));
    outputs.set(layout, gpu);
  }
  if (deps.layer.upscaleStage!.config.layout !== original.layout) deps.layer.setUpscale(original);
  const s = deps.layer.upscaleStage!;
  return {
    model: s.config.model,
    inputs: s.config.inputs,
    seed: s.config.seed,
    weightHash: s.model.weightHash,
    marchSize: { width: marchRef!.w, height: marchRef!.h },
    marchStable,
    gpuVsCpu,
    layouts: opts.compareLayouts ? compareOutputs(outputs.get('sp')!, outputs.get('dc')!) : null,
    ms: performance.now() - t0,
  };
}
```

- [ ] **Step 2: Add the seam**

In `game-main.ts` add next to the Task 4 import:

```ts
import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';
```

Directly after the `upscaleInfo: () => ({ ... }),` seam from Task 4, add:

```ts
    /** G1-parity (spec 2026-09-11): GPU output vs the CPU twin, in-page. Requires
     *  freeze(true) + setRenderLock(true) first. Returns statistics only. */
    upscaleSelfCheck: (opts?: { compareLayouts?: boolean }) => runUpscaleSelfCheck({
      renderer: handle.renderer,
      layer: sdfLayer,
      camera: camera as THREE.PerspectiveCamera,
      renderFrames: (n: number) => { handle.setLoopRunning(false); for (let k = 0; k < n; k++) handle.step(1 / 60); },
      resolveGpu: () => handle.resolveGpu(),
    }, opts ?? {}),
```

Run: `npx tsc --noEmit` — Expected: no errors. If `SdfLayer` is not an exported type of `sdf-layer.ts`, use `type SdfLayer = ReturnType<typeof import('../sdf-layer').createSdfLayer>` in the self-check instead — do not export new things from `sdf-layer.ts` for this.

- [ ] **Step 3: Write the parity driver**

Create `scripts/upscale-parity.mjs`:

```js
// scripts/upscale-parity.mjs — G1-parity for the neural upscale stage
// (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md, Gates).
//
// One boot, one staged frozen frame. For each model x input set: enable the stage
// (random weights, seed 1), run __sdfGame.upscaleSelfCheck({ compareLayouts: true }),
// which compares BOTH layouts against the CPU twin (float16 storage emulated) and
// against each other, in-page. Exit 1 if any gate fails. Thresholds are the spec's;
// do not loosen them here.
//
// Usage (owns nothing; run inside lab-servers):
//   LAB_VITE_PORT=5311 LAB_CDP_PORT=9311 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-parity.mjs'
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5311);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9311);
const OUT = process.env.UPSCALE_OUT ?? '/tmp/upscale-parity';
const ROOM = Number(process.env.UPSCALE_ROOM ?? 1);
const DIST = Number(process.env.UPSCALE_DIST ?? 2.5);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 40 min'); process.exit(3); }, 40 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__upConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

const staged = await evaluate(`(async () => {
  __sdfGame.teleport(${ROOM});
  const z = __sdfGame.zombies().find(q => q.room === ${ROOM});
  if (!z) return { error: 'no body in room ${ROOM}' };
  __sdfGame.freeze(true);
  const d = ${DIST};
  const ex = z.pos[0], ez = z.pos[2] + d;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  __sdfGame.step(30);
  __sdfGame.setRenderLock(true);
  return { body: z.id };
})()`);
if (staged?.error) fail(staged.error);
console.log(`staged: room ${ROOM}, body ${staged.body}, ${DIST} m`);

const CONFIGS = [
  { model: 'zero', inputs: 'rgb' },
  { model: 's8', inputs: 'rgb' }, { model: 's8', inputs: 'rgbd' },
  { model: 's16', inputs: 'rgb' }, { model: 's16', inputs: 'rgbd' },
  { model: 's32', inputs: 'rgb' }, { model: 's32', inputs: 'rgbd' },
];
const rows = [];
let failed = false;
console.log('\nmodel inputs | layout  covered   maxRelRgb  covMis  covMisFar  depthMis | sp-vs-dc maxRelRgb covMis | ms');
for (const c of CONFIGS) {
  const cfg = { ...c, layout: 'sp', seed: 1 };
  const r = await evaluate(`(async () => {
    __sdfGame.setUpscale(${JSON.stringify(cfg)});
    return await __sdfGame.upscaleSelfCheck({ compareLayouts: true });
  })()`, 600_000);
  const problems = [];
  if (!r.marchStable) problems.push('march target changed between renders (render lock not holding)');
  if (r.marchSize.width !== 400 || r.marchSize.height !== 300) problems.push(`march is ${r.marchSize.width}x${r.marchSize.height}, not 400x300`);
  for (const g of r.gpuVsCpu) {
    if (g.covered < 500) problems.push(`${g.layout}: only ${g.covered} covered pixels — the staged body is not in frame`);
    if (g.maxRelRgb > 2e-3) problems.push(`${g.layout}: GPU vs CPU rgb ${g.maxRelRgb.toExponential(2)} > 2e-3`);
    if (g.coverageMismatchFar > 0) problems.push(`${g.layout}: ${g.coverageMismatchFar} coverage mismatches outside the threshold band`);
    if (g.depthMismatch > 0) problems.push(`${g.layout}: ${g.depthMismatch} depth mismatches`);
    if (c.model === 'zero' && (g.coverageMismatch > 0 || g.maxRelRgb > 1e-6)) problems.push(`${g.layout}: zero model is not exactly nearest`);
  }
  if (r.layouts.maxRelRgb > 2e-3) problems.push(`sp vs dc rgb ${r.layouts.maxRelRgb.toExponential(2)} > 2e-3`);
  if (r.layouts.coverageMismatch > 0.005 * r.layouts.pixels) problems.push(`sp vs dc coverage mismatches ${r.layouts.coverageMismatch} > 0.5%`);
  for (const g of r.gpuVsCpu) {
    console.log(`${c.model.padEnd(5)} ${c.inputs.padEnd(6)} | ${g.layout.padEnd(6)} ${String(g.covered).padStart(8)}  ${g.maxRelRgb.toExponential(2).padStart(9)}  ${String(g.coverageMismatch).padStart(6)}  ${String(g.coverageMismatchFar).padStart(9)}  ${String(g.depthMismatch).padStart(8)} | ${r.layouts.maxRelRgb.toExponential(2).padStart(17)} ${String(r.layouts.coverageMismatch).padStart(6)} | ${Math.round(r.ms)}`);
  }
  for (const p of problems) console.log(`   PROBLEM: ${p}`);
  if (problems.length) failed = true;
  rows.push({ cfg, result: r, problems });
}
await evaluate('(() => { __sdfGame.setUpscale(null); return 1; })()');

const logged = await evaluate('(() => window.__upConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(String(t)) || k === 'error');
console.log(`\nconsole errors/shader warnings: ${bad.length}`);
for (const [k, t] of bad.slice(0, 8)) console.log(`  [${k}] ${String(t).slice(0, 300)}`);
if (bad.some(([, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(String(t)))) failed = true;

writeFileSync(`${OUT}/parity.json`, JSON.stringify({ when: new Date().toISOString(), room: ROOM, dist: DIST, rows, console: bad }, null, 2));
console.log(`\n${failed ? 'G1-PARITY: FAIL' : 'G1-PARITY: PASS'}  (json: ${OUT}/parity.json)`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: Run it**

```bash
LAB_VITE_PORT=5311 LAB_CDP_PORT=9311 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-parity.mjs' 2>&1 | tee /tmp/upscale-parity.log
```

Expected: a table for 7 configs × 2 layouts, then `G1-PARITY: PASS`.

If it fails, debug with these facts (restart vite after every shader-source edit):
- Every pixel is the sentinel on GPU → the output pass lost alpha: `colorNode` AND `outputNode` must both be set (Task 3).
- GPU output is vertically mirrored vs the twin → a pass ignores `flipY`; every run function must apply it.
- Only `sp` fails → shuffle channel order or MRT target naming (`f0..f3`) vs `mrt()` keys.
- Only `dc` fails → the deconv branch's `outChannels` (`c*4 + s`) or tap coordinates.
- Both fail, zero model passes → a conv pass: weight matrix order (column-major), bias, ReLU, or the input-assembly (`hit`, depth linearization).
- `marchStable: false` → the render lock is not holding; re-stage and verify `__sdfGame.renderLock === true` before the loop.
- `rgbd` only fails → `nearFar` binding, or the camera near/far read by `upscaleSelfCheck` differs from the one the stage used.
Fix the code, never the thresholds. Re-run Tasks 1-3 tests after any generator change.

- [ ] **Step 5: Write the notes**

Create `docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md` with: date, checkout SHA (`git rev-parse HEAD`), the exact command, the full table from the log, the verdict line, any bugs found and fixed (one bullet each with the symptom), and the console-error count. If the gate failed after honest debugging, say so at the top and list what was tried.

- [ ] **Step 6: Build and commit**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/ src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` — Expected: PASS.
Run: `npm run build` — Expected: success.

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts src/lab/sdf-zombie/webgpu/game-main.ts scripts/upscale-parity.mjs docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md
git add -u src/lab/sdf-zombie/webgpu/upscale/
git commit -m "test(upscale): G1-parity — GPU both layouts vs the CPU twin, in-page"
```

---

### Task 6: Bench legs and the cost gate (G1)

**Files:**
- Modify: `scripts/sdf-game-bench.mjs`
- Create: `docs/dev-notes/2026-09-11-neural-upscale/g1-cost.md`

- [ ] **Step 1: Pin the new seams in the leg reset block**

In `scripts/sdf-game-bench.mjs`, inside `applyLeg`'s reset `evaluate`, replace the line:

```js
    __sdfGame.setTemporalAccum(false);   // accumulation ships OFF (2026-09-10)
```

with:

```js
    __sdfGame.setUpscale(null);          // neural upscale ships OFF (2026-09-11); before fields, which it refuses
    __sdfGame.setTemporalAccum(false);   // accumulation ships OFF (2026-09-10)
```

and directly after the line `    __sdfGame.setSdfScale(1.0);` add:

```js
    __sdfGame.setFieldStyle('bodies');   // ship truth: game-main.ts field-style default
```

Before pinning, confirm the shipped default really is `'bodies'`: `grep -n "setFieldStyle(" src/lab/sdf-zombie/webgpu/game-main.ts | head` (around line 1863). If the default differs, pin what the game actually ships and say so in the notes.

- [ ] **Step 2: Add the legs**

In `ALL_LEGS`, directly after the `'sdfscale-0.35': { setSdfScale: 0.35 },` line add:

```js
  // NEURAL UPSCALE COST LADDER (spec 2026-09-11-neural-upscale-espcn-design.md, G1).
  // RANDOM weights: these price the stage, they say nothing about the look.
  // 'native-progressive' is the quality reference (scale 1.0, fields off);
  // 'half-nearest' is the same march at 0.5 with today's nearest composite.
  // Headroom H = frame(native-progressive) - frame(half-nearest); a ladder leg passes
  // G1 if frame(leg) <= frame(half-nearest) + H/2, beyond repeat spread.
  // setUpscale also sets scale 0.5 and fields off.
  'native-progressive': { setFieldStyle: 'off' },
  'half-nearest': { setFieldStyle: 'off', setSdfScale: 0.5 },
  'up-s8-sp': { setUpscale: { model: 's8', layout: 'sp', inputs: 'rgb' } },
  'up-s8-dc': { setUpscale: { model: 's8', layout: 'dc', inputs: 'rgb' } },
  'up-s16-sp': { setUpscale: { model: 's16', layout: 'sp', inputs: 'rgb' } },
  'up-s16-dc': { setUpscale: { model: 's16', layout: 'dc', inputs: 'rgb' } },
  'up-s32-sp': { setUpscale: { model: 's32', layout: 'sp', inputs: 'rgb' } },
  'up-s32-dc': { setUpscale: { model: 's32', layout: 'dc', inputs: 'rgb' } },
  'up-s16-sp-rgbd': { setUpscale: { model: 's16', layout: 'sp', inputs: 'rgbd' } },
  'up-s16-dc-rgbd': { setUpscale: { model: 's16', layout: 'dc', inputs: 'rgbd' } },
```

- [ ] **Step 3: Smoke one leg**

Check the machine is quiet (Rule 6), then:

```bash
BENCH_LEGS=up-s8-sp BENCH_ROOMS=4 BENCH_REPEATS=1 BENCH_PASSES=1 BENCH_OUT=/tmp/upscale-g1-smoke LAB_VITE_PORT=5312 LAB_CDP_PORT=9312 scripts/sdf-game-bench.sh 2>&1 | tail -30
```

Expected: the leg completes, and `/tmp/upscale-g1-smoke/passes.md` lists `sdf:upscale:L1a`, `sdf:upscale:L2a`, `sdf:upscale:L3a`, `sdf:upscale:shuffle` (proof the stage actually rendered). If no `sdf:upscale:` labels appear, the leg did not apply — fix before the full run.

- [ ] **Step 4: Full G1 run**

```bash
BENCH_LEGS=baseline,native-progressive,half-nearest,up-s8-sp,up-s8-dc,up-s16-sp,up-s16-dc,up-s32-sp,up-s32-dc,up-s16-sp-rgbd,up-s16-dc-rgbd BENCH_ROOMS=4 BENCH_REPEATS=3 BENCH_PASSES=1 BENCH_OUT=/tmp/upscale-g1 LAB_VITE_PORT=5312 LAB_CDP_PORT=9312 scripts/sdf-game-bench.sh 2>&1 | tee /tmp/upscale-g1.log
```

Expected: exit 0 and `/tmp/upscale-g1/bench.md`, `passes.md`, `bench.json`. Read the Repeatability section FIRST. An INCOMPLETE banner or a non-zero exit invalidates the run: report it, do not compute a verdict from partial data.

If `native-progressive` p50 lies within 0.2 ms of 16.67 or 33.33 ms (a possible vsync bound), re-run `BENCH_LEGS=native-progressive,half-nearest,<best two ladder legs> BENCH_ROOMS=5` and report both rooms.

- [ ] **Step 5: Write the verdict**

Create `docs/dev-notes/2026-09-11-neural-upscale/g1-cost.md` containing:
1. Date, checkout SHA, machine-load observation (Rule 6 output), exact command.
2. A table: leg | fenced frame p50 | p95 (if reported) | `sdf:march` | sum of `sdf:upscale:*` | repeat spread.
3. `H = native-progressive − half-nearest` and the threshold `half-nearest + H/2`, with numbers.
4. Per ladder leg: PASS/FAIL against the threshold, and whether the margin exceeds its spread.
5. Multiply-adds per model at 400×300 (from `modelMacs`: s8 0.24B, s16 0.62B, s32 1.80B) next to measured `sdf:upscale:*` ms — the cost per billion MACs, per layout.
6. `sp` vs `dc` at each size: which is cheaper, by how much, and whether it exceeds spread (the Colbert question).
7. Verdict: **G1 PASS** if at least one ladder leg passes, naming the largest passing model per layout; otherwise **G1 FAIL** with the closest leg.
8. The vsync note if Step 4's condition triggered.

- [ ] **Step 6: Commit**

```bash
git add scripts/sdf-game-bench.mjs docs/dev-notes/2026-09-11-neural-upscale/g1-cost.md
git commit -m "measure(upscale): G1 cost ladder — s8/s16/s32 x sp/dc against the half-scale headroom"
```

---

### Task 7: Paired capture for training (gate G2)

**Files:**
- Create: `scripts/lib/npy.mjs`
- Test: `scripts/lib/npy.test.ts`
- Create: `scripts/upscale-pairs-capture.mjs`
- Create: `scripts/upscale-pairs-load.py`
- Modify: `.gitignore`
- Create: `docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md`, `docs/dev-notes/2026-09-11-neural-upscale/smoke-manifest.json`
- Modify: `TASKS.md`

- [ ] **Step 1: Write the failing npy test**

Create `scripts/lib/npy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as sdf-closeup-stage.test.ts).
import { decodeNpy, encodeNpy } from './npy.mjs';

describe('npy', () => {
  it('writes a v1.0 little-endian float32 file numpy can read', () => {
    const data = new Float32Array([1, 2.5, -3, 4, 5, 6]);
    const buf: Buffer = encodeNpy(data, [1, 2, 3]);
    expect(buf.subarray(0, 6).toString('latin1')).toBe('\x93NUMPY');
    expect([buf[6], buf[7]]).toEqual([1, 0]);
    const headerLen = buf.readUInt16LE(8);
    expect((10 + headerLen) % 64).toBe(0);
    const header = buf.subarray(10, 10 + headerLen).toString('latin1');
    expect(header).toContain("'descr': '<f4'");
    expect(header).toContain("'fortran_order': False");
    expect(header).toContain("'shape': (1, 2, 3)");
    expect(header.endsWith('\n')).toBe(true);
    expect(buf.length).toBe(10 + headerLen + 24);
  });

  it('round-trips', () => {
    const data = new Float32Array(300 * 4).map((_, k) => k * 0.25);
    const { shape, data: back } = decodeNpy(encodeNpy(data, [15, 20, 4]));
    expect(shape).toEqual([15, 20, 4]);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it('rejects a data/shape mismatch', () => {
    expect(() => encodeNpy(new Float32Array(5), [2, 3])).toThrow(/shape/);
  });
});
```

Run: `npx vitest run scripts/lib/npy.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `scripts/lib/npy.mjs`**

```js
// scripts/lib/npy.mjs — minimal NumPy .npy v1.0 writer/reader for float32 arrays.
// Used by the neural upscale capture (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7).

/** @param {Float32Array} data @param {number[]} shape @returns {Buffer} */
export function encodeNpy(data, shape) {
  const count = shape.reduce((a, b) => a * b, 1);
  if (data.length !== count) throw new Error(`encodeNpy: ${data.length} floats do not fit shape (${shape.join(', ')})`);
  const dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const pad = (64 - ((10 + dict.length + 1) % 64)) % 64;
  const header = `${dict}${' '.repeat(pad)}\n`;
  const buf = Buffer.alloc(10 + header.length + data.byteLength);
  buf.write('\x93NUMPY', 0, 'latin1');
  buf[6] = 1;
  buf[7] = 0;
  buf.writeUInt16LE(header.length, 8);
  buf.write(header, 10, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(buf, 10 + header.length);
  return buf;
}

/** @param {Buffer} buf @returns {{ shape: number[], data: Float32Array }} */
export function decodeNpy(buf) {
  if (buf.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('decodeNpy: bad magic');
  const headerLen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + headerLen).toString('latin1');
  if (!header.includes("'descr': '<f4'")) throw new Error(`decodeNpy: only <f4 supported, got ${header}`);
  const m = header.match(/'shape': \(([^)]*)\)/);
  if (!m) throw new Error('decodeNpy: no shape');
  const shape = m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const start = 10 + headerLen;
  const copy = Buffer.from(buf.subarray(start));
  return { shape, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}
```

Run: `npx vitest run scripts/lib/npy.test.ts` — Expected: PASS.

- [ ] **Step 3: Ignore the dataset directory**

Append to `.gitignore`:

```
# Neural upscale training pairs (spec 2026-09-11 §7) — local data, never committed
.upscale-data/
```

- [ ] **Step 4: Write the capture script**

Create `scripts/upscale-pairs-capture.mjs`:

```js
// scripts/upscale-pairs-capture.mjs — paired frozen-frame capture for the neural
// upscale (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7, gate G2).
//
// For each frame, ONE frozen simulation state is rendered twice:
//   input  = sdfScale 0.5, fields off -> march target 400x300 (rgb + clip depth)
//   target = sdfScale 1.0, fields off -> march target 800x600 (native progressive)
// setRenderLock(true) makes step(n) pure re-renders; the sim advances only between frames.
//
// G2 checks run on the first staged frame before anything is saved:
//   determinism (same scale twice, and 0.5 -> 1.0 -> 0.5), alignment (coverage centroid
//   and IoU), orientation (body staged below centre => centroid row > H/2), depth sanity.
//
// Usage:
//   LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs'
// Env: UPSCALE_OUT (default .upscale-data/<stamp>), UPSCALE_SEQS ("room:dist:orbit,..."),
//      UPSCALE_FRAMES (20), UPSCALE_ADVANCE (6 sim frames between captures), UPSCALE_PITCH_UP (0.2 rad)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
import { encodeNpy } from './lib/npy.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5313);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9313);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.UPSCALE_OUT ?? `.upscale-data/${STAMP}`;
const SEQS = (process.env.UPSCALE_SEQS ?? '1:2.5:0,3:3.0:1.2,4:2.0:-0.8').split(',').map((s) => {
  const [room, dist, orbit] = s.split(':').map(Number);
  return { room, dist, orbit };
});
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 20);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const PITCH_UP = Number(process.env.UPSCALE_PITCH_UP ?? 0.2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 60 min'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.installDebugProbe(); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

/** Read the march target as a Float32Array (row 0 = texel row 0). */
async function readMarch() {
  const r = await evaluate('__sdfGameDebug.readMarchTarget()', 300_000);
  const bytes = Buffer.from(r.rgba32f, 'base64');
  const copy = Buffer.from(bytes);
  return { w: r.w, h: r.h, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}

async function renderAt(scale) {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(${scale}); __sdfGame.step(4); return 1; })()`);
  await evaluate('__sdfGame.resolveGpu()');
  return readMarch();
}

const maxAbsDiff = (a, b) => {
  if (a.data.length !== b.data.length) return Infinity;
  let m = 0;
  for (let k = 0; k < a.data.length; k++) { const d = Math.abs(a.data[k] - b.data[k]); if (d > m) m = d; }
  return m;
};
const coverage = (img) => {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] < 1) { n++; sx += x + 0.5; sy += y + 0.5; }
  }
  return { n, frac: n / (img.w * img.h), cx: n ? sx / n : NaN, cy: n ? sy / n : NaN };
};
const linear = (d, near, far) => (near * far) / (far - d * (far - near));

async function stage(seq, pitchUp) {
  const r = await evaluate(`(async () => {
    __sdfGame.setRenderLock(false);
    __sdfGame.teleport(${seq.room});
    const z = __sdfGame.zombies().find(q => q.room === ${seq.room});
    if (!z) return { error: 'no body in room ${seq.room}' };
    __sdfGame.freeze(true);
    const d = ${seq.dist}, a = ${seq.orbit};
    const ex = z.pos[0] + Math.sin(a) * d, ez = z.pos[2] + Math.cos(a) * d;
    const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
    __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)) + ${pitchUp}, 0);
    __sdfGame.step(30);
    __sdfGame.setRenderLock(true);
    return { body: z.id, pose: [ex, ez] };
  })()`);
  if (r?.error) fail(r.error);
  return r;
}

// ---- G2 checks on the first staged frame -------------------------------------
const checks = {};
// Pitched UP so the body sits below screen centre — only for the orientation check.
// The captured sequences below are re-staged level (pitch offset 0).
await stage(SEQS[0], PITCH_UP);
const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
checks.nearFar = { near, far };

const lrA = await renderAt(0.5);
if (lrA.w !== 400 || lrA.h !== 300) fail(`input march is ${lrA.w}x${lrA.h}, expected 400x300`);
const lrB = await renderAt(0.5);
const hrA = await renderAt(1.0);
if (hrA.w !== 800 || hrA.h !== 600) fail(`target march is ${hrA.w}x${hrA.h}, expected 800x600`);
const hrB = await renderAt(1.0);
const lrC = await renderAt(0.5);
checks.determinism = {
  sameScaleInput: maxAbsDiff(lrA, lrB),
  sameScaleTarget: maxAbsDiff(hrA, hrB),
  scaleRoundTrip: maxAbsDiff(lrA, lrC),
};
let temporalStartOff = false;
if (Object.values(checks.determinism).some((v) => v > 1e-6)) {
  console.log('determinism failed with temporal start ON:', checks.determinism, '— retrying with setTemporalStart(false)');
  await evaluate('(() => { __sdfGame.setTemporalStart(false); return 1; })()');
  temporalStartOff = true;
  const a = await renderAt(0.5), b = await renderAt(0.5), h1 = await renderAt(1.0), h2 = await renderAt(1.0), c = await renderAt(0.5);
  checks.determinismTemporalStartOff = { sameScaleInput: maxAbsDiff(a, b), sameScaleTarget: maxAbsDiff(h1, h2), scaleRoundTrip: maxAbsDiff(a, c) };
  if (Object.values(checks.determinismTemporalStartOff).some((v) => v > 1e-6)) {
    fail(`G2 determinism: ${JSON.stringify(checks)}`);
  }
}
checks.temporalStart = temporalStartOff ? 'off (needed for determinism)' : 'on (shipped)';

const lr = await renderAt(0.5);
const hr = await renderAt(1.0);
const cl = coverage(lr), ch = coverage(hr);
if (cl.n < 500) fail(`G2: only ${cl.n} flesh pixels at 400x300 — the staged body is not in frame`);
checks.alignment = {
  inputCoverage: cl.frac, targetCoverage: ch.frac,
  centroidDxOutputPx: 2 * cl.cx - ch.cx, centroidDyOutputPx: 2 * cl.cy - ch.cy,
};
let inter = 0, union = 0;
for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
  let votes = 0;
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (hr.data[((2 * y + oy) * hr.w + 2 * x + ox) * 4 + 3] < 1) votes++;
  const a = lr.data[(y * lr.w + x) * 4 + 3] < 1, b = votes >= 2;
  if (a && b) inter++;
  if (a || b) union++;
}
checks.alignment.iou = inter / union;
checks.orientation = { inputCentroidRow: cl.cy, inputHeight: lr.h, targetCentroidRow: ch.cy, targetHeight: hr.h, rowZero: cl.cy > lr.h / 2 && ch.cy > hr.h / 2 ? 'top' : 'UNCONFIRMED' };
let dSum = 0, dN = 0;
for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
  const a = lr.data[(y * lr.w + x) * 4 + 3], b = hr.data[((2 * y) * hr.w + 2 * x) * 4 + 3];
  if (a < 1 && b < 1) { dSum += Math.abs(linear(a, near, far) - linear(b, near, far)); dN++; }
}
checks.depthMeanAbsDiffMetres = dN ? dSum / dN : NaN;

const g2 = [];
if (Math.hypot(checks.alignment.centroidDxOutputPx, checks.alignment.centroidDyOutputPx) > 0.5) g2.push('centroid offset > 0.5 output px');
if (checks.alignment.iou < 0.85) g2.push(`IoU ${checks.alignment.iou.toFixed(3)} < 0.85`);
if (checks.orientation.rowZero !== 'top') g2.push('orientation unconfirmed: body staged below centre but centroid row <= H/2');
if (!(checks.depthMeanAbsDiffMetres < 0.05)) g2.push(`mean depth diff ${checks.depthMeanAbsDiffMetres} m >= 0.05`);
console.log('G2 checks:', JSON.stringify(checks, null, 2));
if (g2.length) {
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ created: new Date().toISOString(), checks, g2Failures: g2, frames: [] }, null, 2));
  fail(`G2: ${g2.join('; ')}`);
}

// ---- capture ---------------------------------------------------------------------
const checkout = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const frames = [];
for (let s = 0; s < SEQS.length; s++) {
  const seq = SEQS[s];
  const staged = await stage(seq, 0);
  mkdirSync(`${OUT}/seq${s}`, { recursive: true });
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0) {
      await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.step(${ADVANCE}); __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return 1; })()`);
    }
    const input = await renderAt(0.5);
    const target = await renderAt(1.0);
    const inPath = `seq${s}/frame${String(f).padStart(3, '0')}-in.npy`;
    const tgPath = `seq${s}/frame${String(f).padStart(3, '0')}-target.npy`;
    writeFileSync(`${OUT}/${inPath}`, encodeNpy(input.data, [input.h, input.w, 4]));
    writeFileSync(`${OUT}/${tgPath}`, encodeNpy(target.data, [target.h, target.w, 4]));
    const cov = coverage(input).frac;
    frames.push({ seq: s, frame: f, room: seq.room, body: staged.body, dist: seq.dist, orbit: seq.orbit, input: inPath, target: tgPath, inputCoverage: cov });
    process.stdout.write(`seq${s} frame ${f}: coverage ${(100 * cov).toFixed(2)}%${cov < 0.01 ? '  (WARN: body mostly out of frame)' : ''}\n`);
  }
}
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  created: new Date().toISOString(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md',
  checkout,
  page: 'sdf-game.html?frozen=1&vhs=off',
  input: { w: 400, h: 300, sdfScale: 0.5, fieldStyle: 'off' },
  target: { w: 800, h: 600, sdfScale: 1.0, fieldStyle: 'off' },
  channels: ['r', 'g', 'b', 'clipDepth (>= 1.0 means no flesh)'],
  dtype: 'float32 little-endian, shape (H, W, 4)',
  rowOrder: 'row 0 = texel row 0 = top of the rendered image (verified by checks.orientation)',
  depth: 'WebGPU [0,1] clip depth; linear = near*far / (far - d*(far - near))',
  near, far,
  temporalStart: checks.temporalStart,
  content: 'flesh layer only, tracked public/assets/lab/* — no Blood placeholder assets',
  checks,
  frames,
}, null, 2));
console.log(`\nG2: PASS — ${frames.length} pairs in ${OUT}`);
process.exit(0);
```

- [ ] **Step 5: Write the Python loader check**

Create `scripts/upscale-pairs-load.py`:

```python
#!/usr/bin/env python3
"""Load an upscale pair dataset and assert it matches its manifest (spec 2026-09-11, gate G2).

Usage: uv run --with numpy python3 scripts/upscale-pairs-load.py .upscale-data/<run>
"""
import json
import sys
from pathlib import Path

import numpy as np


def main(root: str) -> None:
    base = Path(root)
    manifest = json.loads((base / "manifest.json").read_text())
    iw, ih = manifest["input"]["w"], manifest["input"]["h"]
    tw, th = manifest["target"]["w"], manifest["target"]["h"]
    count = 0
    for fr in manifest["frames"]:
        a = np.load(base / fr["input"])
        b = np.load(base / fr["target"])
        assert a.dtype == np.float32 and a.shape == (ih, iw, 4), (fr["input"], a.dtype, a.shape)
        assert b.dtype == np.float32 and b.shape == (th, tw, 4), (fr["target"], b.dtype, b.shape)
        assert np.isfinite(a).all() and np.isfinite(b).all(), fr
        ca = float((a[..., 3] < 1).mean())
        cb = float((b[..., 3] < 1).mean())
        assert abs(ca - cb) < 0.02, (fr["input"], ca, cb)
        count += 1
    assert count == len(manifest["frames"]) and count > 0
    print(f"OK {count} pairs, input {iw}x{ih}, target {tw}x{th}, near {manifest['near']}, far {manifest['far']}")


if __name__ == "__main__":
    main(sys.argv[1])
```

- [ ] **Step 6: Run the capture (smoke dataset: 3 sequences × 20 frames)**

The dispatcher DELETES this task's worktree when the task ends, so the dataset must be written outside it:

```bash
mkdir -p /tmp/blud-upscale-data
LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 UPSCALE_OUT=/tmp/blud-upscale-data/smoke-2026-09-11 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs' 2>&1 | tee /tmp/upscale-g2.log
uv run --with numpy python3 scripts/upscale-pairs-load.py /tmp/blud-upscale-data/smoke-2026-09-11
du -sh /tmp/blud-upscale-data/smoke-2026-09-11
```

Expected: `G2: PASS — 60 pairs`, the Python line `OK 60 pairs, input 400x300, target 800x600, ...`, and a size near 60 × (1.9 MB + 7.7 MB) ≈ 580 MB.

If a room has no body, change that sequence's room in `UPSCALE_SEQS` (rooms 1-5) and record the change. If orientation reports `UNCONFIRMED`, check the pitch sign of `setPose` (a larger pitch must look UP): stage once with `UPSCALE_PITCH_UP=-0.2` — the centroid row must move to < H/2. Record which convention held; do not flip the saved data.

- [ ] **Step 7: Write the notes and update TASKS.md**

Create `docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md` with: date, checkout SHA, command, the `G2 checks` JSON from the log, temporal-start state, dataset path (`/tmp/blud-upscale-data/smoke-2026-09-11` — lost on reboot; the command above regenerates it) and size, the Python loader output, coverage per sequence (min/mean), and the verdict. Also copy the dataset's `manifest.json` to `docs/dev-notes/2026-09-11-neural-upscale/smoke-manifest.json` (small; it records exactly how the data was made).

In `TASKS.md`, in the `## Neural upscale (ESPCN family)` section, replace the line starting `- [ ] P1+P2 plan` and its continuation with:

```
- [x] P1+P2 built (plan `docs/superpowers/plans/2026-09-11-neural-upscale-p1p2.md`): stage, both layouts,
  G1-parity, G1 cost and G2 pairs — verdicts in `docs/dev-notes/2026-09-11-neural-upscale/`.
- [ ] Next: P3 training plan (sizes chosen from g1-cost.md; M3 overfit first, RunPod for volume).
```

If G1 failed (see `g1-cost.md`), write `- [!] G1 FAIL — <closest leg>; P3 not started` instead of the "Next" line.

- [ ] **Step 8: Test, build, commit**

Run: `npx vitest run scripts/lib/npy.test.ts src/lab/sdf-zombie/webgpu/upscale/` — Expected: PASS.
Run: `npm run build` — Expected: success.
Run: `git status --short` — Expected: `.upscale-data/` does NOT appear.

```bash
git add scripts/lib/npy.mjs scripts/lib/npy.test.ts scripts/upscale-pairs-capture.mjs scripts/upscale-pairs-load.py .gitignore docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md docs/dev-notes/2026-09-11-neural-upscale/smoke-manifest.json TASKS.md
git commit -m "feat(upscale): paired frozen-frame capture + G2 checks (determinism, alignment, orientation)"
```
