/**
 * NEURAL UPSCALE — the CPU twin. The numeric reference every GPU pass is
 * checked against (spec §2-§4). Images are row 0 = texel row 0 (the top of
 * the rendered image in this renderer's convention), interleaved channels.
 */
import { HEAD_IN_CHANNELS, inputsUseDepth, inputsUseNormals, type ConvLayer, type UpscaleLayout, type UpscaleModel } from './upscale-model';

export interface FloatImage { w: number; h: number; c: number; data: Float32Array }

export function makeImage(w: number, h: number, c: number): FloatImage {
  return { w, h, c, data: new Float32Array(w * h * c) };
}

const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** WebGPU [0,1] clip depth -> view distance (no reversed depth in this renderer). */
export function linearDepth(d: number, near: number, far: number): number {
  return (near * far) / (far - d * (far - near));
}

/**
 * Round to the nearest IEEE float16 value — what an RGBA16F target stores.
 *
 * TIES GO TO EVEN, as IEEE 754 round-to-nearest-even and every GPU do. `Math.round`
 * rounds a tie away from zero instead, which put the CPU twin one ulp above the
 * hardware on tie samples and inflated the WORST-PIXEL statistic the G1/P3c
 * self-check reports (2026-09-11: a seeded s8/rgbd smoke model landed at 2.07e-3
 * against a 2e-3 gate; see docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md).
 * 65520 is the tie between 65504 and 65536, and under this rule it goes to infinity.
 */
export function f16round(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (a >= 65520) return v > 0 ? Infinity : -Infinity;
  const e = Math.max(Math.floor(Math.log2(a)), -14);
  const step = 2 ** (e - 10);
  const q = a / step;
  let n = Math.round(q);
  if (q - Math.floor(q) === 0.5 && n % 2 !== 0) n -= 1;
  return Math.sign(v) * n * step;
}

/** The first layer's input (spec §2): rgb*hit, hit[, hit*linearDepth][, normal*hit], normalized.
 *  `normal` (3 or 4 channels, view space) is required by the rgbn/rgbdn sets and ignored otherwise;
 *  channel order mirrors nupscale/model.py `assemble`. */
export function assembleInput(march: FloatImage, model: UpscaleModel, near: number, far: number, normal?: FloatImage): FloatImage {
  const inC = model.layers[0]!.inC;
  const useDepth = inputsUseDepth(model.inputs);
  const useNormal = inputsUseNormals(model.inputs);
  if (useNormal) {
    if (!normal) throw new Error(`upscale: input set ${model.inputs} needs a normal image`);
    if (normal.w !== march.w || normal.h !== march.h) throw new Error(`upscale: normal image ${normal.w}x${normal.h} does not match march ${march.w}x${march.h}`);
  }
  const nBase = useDepth ? 5 : 4;
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
    if (useDepth) raw[4] = hit * linearDepth(a, near, far);
    if (useNormal) {
      const nb = p * normal!.c;
      raw[nBase] = normal!.data[nb]! * hit;
      raw[nBase + 1] = normal!.data[nb + 1]! * hit;
      raw[nBase + 2] = normal!.data[nb + 2]! * hit;
    }
    for (let k = 0; k < inC; k++) out.data[p * inC + k] = raw[k]! * model.inScale[k]! + model.inOffset[k]!;
  }
  return out;
}

/** One output channel of a 3x3 replicate-padded conv at (x, y), in float64. */
export function convAt(input: FloatImage, layer: ConvLayer, o: number, x: number, y: number): number {
  let s = layer.bias[o]!;
  const d = layer.dilation;
  for (let ky = 0; ky < 3; ky++) {
    const yy = clampI(y + (ky - 1) * d, 0, input.h - 1);
    for (let kx = 0; kx < 3; kx++) {
      const xx = clampI(x + (kx - 1) * d, 0, input.w - 1);
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
  /** The view-space normal image (3 or 4 channels, march size) for the rgbn/rgbdn sets. */
  normal?: FloatImage;
  /** Run-4 detail field (4 channels, OUTPUT size: noise xyz, w = gate) — required by a model with a head. */
  detail?: FloatImage;
  /** Run-5 refine normal image (4 channels, OUTPUT size, xyz + unused w) — required when the model's
   *  headInputs is 'detail+refine'. */
  refineN?: FloatImage;
  /** Run-5 refine color image (4 channels, OUTPUT size, rgb + w = accept gate: w < 1 means accepted) —
   *  required when the model's headInputs is 'detail+refine'. */
  refineC?: FloatImage;
}

/** Run-4/5 head input (nupscale/model.py `Upscaler.head_input`): per output pixel
 *  [rgb*covered (3), covered (1), detail.xyz*gate (3), nearest-up march rgb*hit (3)] (10 channels), and
 *  when `refine` is given, seven more: [refineN.xyz*ga (3), refineC.rgb*ga (3), ga (1)] (17 total), where
 *  ga = refineC.w < 1 (accepted) — this is the cross-language contract with nupscale/model.py head_input. */
export function assembleHeadInput(
  out: FloatImage, detail: FloatImage, march: FloatImage, refine?: { n: FloatImage; c: FloatImage },
): FloatImage {
  if (detail.w !== out.w || detail.h !== out.h || detail.c !== 4) throw new Error(`upscale head: detail ${detail.w}x${detail.h}x${detail.c} does not match output ${out.w}x${out.h}x4`);
  if (refine) {
    if (refine.n.w !== out.w || refine.n.h !== out.h || refine.n.c !== 4) throw new Error(`upscale head: refineN ${refine.n.w}x${refine.n.h}x${refine.n.c} does not match output ${out.w}x${out.h}x4`);
    if (refine.c.w !== out.w || refine.c.h !== out.h || refine.c.c !== 4) throw new Error(`upscale head: refineC ${refine.c.w}x${refine.c.h}x${refine.c.c} does not match output ${out.w}x${out.h}x4`);
  }
  const C = refine ? 17 : HEAD_IN_CHANNELS;
  const x = makeImage(out.w, out.h, C);
  for (let Y = 0; Y < out.h; Y++) {
    const y = Math.min(Y >> 1, march.h - 1);
    for (let X = 0; X < out.w; X++) {
      const p = Y * out.w + X;
      const cov = out.data[p * 4 + 3]! < 1 ? 1 : 0;
      const gate = detail.data[p * 4 + 3]! > 0 ? 1 : 0;
      const mb = (y * march.w + Math.min(X >> 1, march.w - 1)) * 4;
      const hit = march.data[mb + 3]! < 1 ? 1 : 0;
      const b = p * C;
      x.data[b] = out.data[p * 4]! * cov; x.data[b + 1] = out.data[p * 4 + 1]! * cov; x.data[b + 2] = out.data[p * 4 + 2]! * cov;
      x.data[b + 3] = cov;
      x.data[b + 4] = detail.data[p * 4]! * gate; x.data[b + 5] = detail.data[p * 4 + 1]! * gate; x.data[b + 6] = detail.data[p * 4 + 2]! * gate;
      x.data[b + 7] = march.data[mb]! * hit; x.data[b + 8] = march.data[mb + 1]! * hit; x.data[b + 9] = march.data[mb + 2]! * hit;
      if (refine) {
        const ga = refine.c.data[p * 4 + 3]! < 1 ? 1 : 0;
        x.data[b + 10] = refine.n.data[p * 4]! * ga; x.data[b + 11] = refine.n.data[p * 4 + 1]! * ga; x.data[b + 12] = refine.n.data[p * 4 + 2]! * ga;
        x.data[b + 13] = refine.c.data[p * 4]! * ga; x.data[b + 14] = refine.c.data[p * 4 + 1]! * ga; x.data[b + 15] = refine.c.data[p * 4 + 2]! * ga;
        x.data[b + 16] = ga;
      }
    }
  }
  return x;
}

/** Applies a model's head to a reconstructed output IN PLACE: rgb += residual where covered, clamped >= 0. */
export function applyHead(
  out: FloatImage, model: UpscaleModel, detail: FloatImage, march: FloatImage,
  refine?: { n: FloatImage; c: FloatImage }, store: (img: FloatImage) => FloatImage = (i) => i,
): void {
  if (!model.head) return;
  if (model.headInputs === 'detail+refine' && !refine) {
    throw new Error('upscaleReference: this model has a refine head and needs opts.refineN and opts.refineC');
  }
  let h = assembleHeadInput(out, detail, march, refine);
  for (let k = 0; k < model.head.length - 1; k++) h = store(conv3x3(h, model.head[k]!));
  const last = model.head[model.head.length - 1]!;
  for (let p = 0; p < out.w * out.h; p++) {
    if (out.data[p * 4 + 3]! >= 1) continue;
    const x = p % out.w, y = (p / out.w) | 0;
    for (let c = 0; c < 3; c++) out.data[p * 4 + c] = Math.max(0, out.data[p * 4 + c]! + convAt(h, last, c, x, y));
  }
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
  let hidden = assembleInput(march, model, near, far, opts.normal);
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
  if (model.head) {
    if (!opts.detail) throw new Error('upscaleReference: this model has a head and needs opts.detail');
    if (model.headInputs === 'detail+refine' && !(opts.refineN && opts.refineC)) {
      throw new Error('upscaleReference: this model has a refine head and needs opts.refineN and opts.refineC');
    }
    applyHead(out, model, opts.detail, march, opts.refineN ? { n: opts.refineN, c: opts.refineC! } : undefined, store);
  }
  return out;
}
