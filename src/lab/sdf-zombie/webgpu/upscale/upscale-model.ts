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
  /** 'trained' for a loaded export (parseUpscaleModelJson); absent means seeded random weights. */
  source?: UpscaleModelSource;
  /** Training run and step of a trained export. */
  run?: string;
  step?: number;
}

/** Where a model's weights came from. Random weights are a cost/parity probe, never a look. */
export type UpscaleModelSource = 'random' | 'trained';

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

/**
 * MODEL JSON (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §2) — what the
 * PyTorch trainer exports and the game loads. Arrays are base64 float32; this code assumes a
 * little-endian host, which every WebGPU browser platform is.
 */
export const UPSCALE_MODEL_FORMAT = 'blud-upscale-model/1';

export interface UpscaleModelLayerJson {
  inC: number;
  outC: number;
  relu: boolean;
  weights: string;
  bias: string;
}

export interface UpscaleModelJson {
  format: typeof UPSCALE_MODEL_FORMAT;
  id: UpscaleModelId;
  inputs: UpscaleInputSet;
  source: UpscaleModelSource;
  run?: string;
  step?: number;
  layers: UpscaleModelLayerJson[];
  inScale: number[];
  inOffset: number[];
  weightHash: string;
  trainedOn?: { dataset: string; manifestHash: string };
  metrics?: Record<string, number | null> | null;
}

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

function base64ToFloat32(b64: string, what: string): Float32Array {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new Error(`upscale model: ${what} is not base64`);
  }
  if (s.length % 4 !== 0) throw new Error(`upscale model: ${what} has ${s.length} bytes, not whole float32s`);
  const bytes = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) bytes[k] = s.charCodeAt(k);
  return new Float32Array(bytes.buffer);
}

export function serializeUpscaleModel(
  model: UpscaleModel,
  extra: Pick<UpscaleModelJson, 'trainedOn' | 'metrics'> = {},
): UpscaleModelJson {
  return {
    format: UPSCALE_MODEL_FORMAT,
    id: model.id,
    inputs: model.inputs,
    source: model.source ?? 'random',
    ...(model.run !== undefined ? { run: model.run } : {}),
    ...(model.step !== undefined ? { step: model.step } : {}),
    layers: model.layers.map((l) => ({
      inC: l.inC, outC: l.outC, relu: l.relu, weights: float32ToBase64(l.weights), bias: float32ToBase64(l.bias),
    })),
    inScale: Array.from(model.inScale),
    inOffset: Array.from(model.inOffset),
    weightHash: hashModel(model),
    ...extra,
  };
}

/**
 * Validates a model JSON and returns the model. Checks the format, id, inputs, the layer chain
 * against INPUT_CHANNELS/HIDDEN_WIDTHS, relu flags, array lengths and finiteness, then recomputes
 * weightHash; any mismatch throws. `source` defaults to 'trained'.
 */
export function parseUpscaleModelJson(json: unknown): UpscaleModel {
  if (typeof json !== 'object' || json === null) throw new Error('upscale model: not a JSON object');
  const j = json as Partial<Record<keyof UpscaleModelJson, unknown>>;
  if (j.format !== UPSCALE_MODEL_FORMAT) {
    throw new Error(`upscale model: format ${String(j.format)}, expected ${UPSCALE_MODEL_FORMAT}`);
  }
  const id = j.id as UpscaleModelId;
  if (!UPSCALE_MODEL_IDS.includes(id)) throw new Error(`upscale model: unknown id ${String(j.id)}`);
  const inputs = j.inputs as UpscaleInputSet;
  if (!UPSCALE_INPUT_SETS.includes(inputs)) throw new Error(`upscale model: unknown inputs ${String(j.inputs)}`);
  const source = (j.source ?? 'trained') as UpscaleModelSource;
  if (source !== 'trained' && source !== 'random') throw new Error(`upscale model: unknown source ${String(j.source)}`);
  if (j.run !== undefined && typeof j.run !== 'string') throw new Error('upscale model: run must be a string');
  if (j.step !== undefined && !Number.isInteger(j.step)) throw new Error('upscale model: step must be an integer');

  const widths = [INPUT_CHANNELS[inputs], ...HIDDEN_WIDTHS[id], LAST_CHANNELS];
  const layerCount = widths.length - 1;
  if (!Array.isArray(j.layers) || j.layers.length !== layerCount) {
    throw new Error(`upscale model: ${id} needs ${layerCount} layers, got ${Array.isArray(j.layers) ? j.layers.length : 'none'}`);
  }
  const layers: ConvLayer[] = j.layers.map((raw: unknown, k: number) => {
    const l = (raw ?? {}) as Partial<UpscaleModelLayerJson>;
    const inC = widths[k]!;
    const outC = widths[k + 1]!;
    if (l.inC !== inC || l.outC !== outC) {
      throw new Error(`upscale model: layer ${k} is ${String(l.inC)}->${String(l.outC)}, expected ${inC}->${outC}`);
    }
    const relu = k < layerCount - 1;
    if (l.relu !== relu) throw new Error(`upscale model: layer ${k} relu must be ${relu}`);
    if (typeof l.weights !== 'string' || typeof l.bias !== 'string') {
      throw new Error(`upscale model: layer ${k} weights and bias must be base64 strings`);
    }
    const weights = base64ToFloat32(l.weights, `layer ${k} weights`);
    const bias = base64ToFloat32(l.bias, `layer ${k} bias`);
    if (weights.length !== outC * inC * 9) {
      throw new Error(`upscale model: layer ${k} has ${weights.length} weights, expected ${outC * inC * 9}`);
    }
    if (bias.length !== outC) throw new Error(`upscale model: layer ${k} has ${bias.length} biases, expected ${outC}`);
    if (!weights.every((v) => Number.isFinite(v)) || !bias.every((v) => Number.isFinite(v))) {
      throw new Error(`upscale model: layer ${k} has non-finite values`);
    }
    return { inC, outC, relu, weights, bias };
  });
  const norm = (v: unknown, name: string): Float32Array => {
    if (!Array.isArray(v) || v.length !== widths[0] || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new Error(`upscale model: ${name} must be ${widths[0]} finite numbers`);
    }
    return Float32Array.from(v as number[]);
  };
  const model: UpscaleModel = {
    id, inputs, seed: 0, layers,
    inScale: norm(j.inScale, 'inScale'),
    inOffset: norm(j.inOffset, 'inOffset'),
    weightHash: '',
    source,
    ...(j.run !== undefined ? { run: j.run as string } : {}),
    ...(j.step !== undefined ? { step: j.step as number } : {}),
  };
  model.weightHash = hashModel(model);
  if (j.weightHash !== model.weightHash) {
    throw new Error(`upscale model: weightHash ${String(j.weightHash)} does not match the weights (${model.weightHash})`);
  }
  return model;
}
