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
import { inputsUseDepth, inputsUseNormals, type ConvLayer, type UpscaleLayout, type UpscaleModel } from './upscale-model';

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

/**
 * POST-SHARPEN (owner experiment 2026-09-12): a contrast-adaptive sharpen (FSR RCAS-style) over the
 * stage output. Flesh only (alpha < 1); non-flesh neighbours do not pull. The weight is strongest in
 * LOW local contrast and fades on strong edges, and the result is clamped to the local min/max, so it
 * cannot ring. HDR-safe: contrast is measured relative to the local max, not to 1.0. Alpha (clip
 * depth) passes through. strength 0 = the pass is not run at all (see upscale-stage.ts).
 */
export const UPSCALE_SHARPEN_WGSL = /* wgsl */ `fn upSharpen(
  src: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  strength: f32,
  mode: f32
) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(src, 0));
  let maxI = dims - vec2<i32>(1, 1);
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let p = clamp(vec2<i32>(floor(st * vec2<f32>(dims))), vec2<i32>(0, 0), maxI);
  let c = textureLoad(src, p, 0);
  if (c.w >= 1.0) { return c; }
  var n = textureLoad(src, clamp(p + vec2<i32>(0, -1), vec2<i32>(0, 0), maxI), 0);
  var s = textureLoad(src, clamp(p + vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0);
  var e = textureLoad(src, clamp(p + vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0);
  var w = textureLoad(src, clamp(p + vec2<i32>(-1, 0), vec2<i32>(0, 0), maxI), 0);
  if (n.w >= 1.0) { n = c; }
  if (s.w >= 1.0) { s = c; }
  if (e.w >= 1.0) { e = c; }
  if (w.w >= 1.0) { w = c; }
  // MODE 1 = plain unsharp mask, NO clamp (owner comparison 2026-09-12): a 3x3 box blur over the
  // flesh taps, then c + strength * (c - blur). Halos and grain are the point of the comparison.
  if (mode > 0.5) {
    var ne = textureLoad(src, clamp(p + vec2<i32>(1, -1), vec2<i32>(0, 0), maxI), 0);
    var nw = textureLoad(src, clamp(p + vec2<i32>(-1, -1), vec2<i32>(0, 0), maxI), 0);
    var se = textureLoad(src, clamp(p + vec2<i32>(1, 1), vec2<i32>(0, 0), maxI), 0);
    var sw = textureLoad(src, clamp(p + vec2<i32>(-1, 1), vec2<i32>(0, 0), maxI), 0);
    if (ne.w >= 1.0) { ne = c; }
    if (nw.w >= 1.0) { nw = c; }
    if (se.w >= 1.0) { se = c; }
    if (sw.w >= 1.0) { sw = c; }
    let blur = (c.xyz + n.xyz + s.xyz + e.xyz + w.xyz + ne.xyz + nw.xyz + se.xyz + sw.xyz) / 9.0;
    return vec4<f32>(max(c.xyz + strength * (c.xyz - blur), vec3<f32>(0.0)), c.w);
  }
  let mn = min(min(min(n.xyz, s.xyz), min(e.xyz, w.xyz)), c.xyz);
  let mx = max(max(max(n.xyz, s.xyz), max(e.xyz, w.xyz)), c.xyz);
  let contrast = (mx - mn) / max(mx, vec3<f32>(1e-3));
  let amp = sqrt(clamp(vec3<f32>(1.0) - contrast, vec3<f32>(0.0), vec3<f32>(1.0)));
  let k = -min(strength, 1.0) * 0.2 * amp;
  let sharp = (c.xyz + k * (n.xyz + s.xyz + e.xyz + w.xyz)) / (vec3<f32>(1.0) + 4.0 * k);
  return vec4<f32>(clamp(sharp, mn, mx), c.w);
}`;

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
function tapCoords(center: string, maxI: string, dilation = 1): string {
  const lines: string[] = [];
  for (let ky = 0; ky < 3; ky++) {
    for (let kx = 0; kx < 3; kx++) {
      lines.push(`  let q${ky * 3 + kx} = clamp(${center} + vec2<i32>(${(kx - 1) * dilation}, ${(ky - 1) * dilation}), vec2<i32>(0, 0), ${maxI});`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** First-layer taps: assemble the network input from the march texel (spec §2). */
function marchInputTaps(model: UpscaleModel): string {
  const s = model.inScale;
  const o = model.inOffset;
  const useDepth = inputsUseDepth(model.inputs);
  const useNormals = inputsUseNormals(model.inputs);
  const lines: string[] = [];
  for (let k = 0; k < 9; k++) {
    lines.push(`  let m${k} = textureLoad(march, q${k}, 0);`);
    lines.push(`  let h${k} = select(0.0, 1.0, m${k}.w < 1.0);`);
    lines.push(`  let a0_${k} = vec4<f32>(m${k}.xyz * h${k}, h${k}) * vec4<f32>(${lit(s[0]!)}, ${lit(s[1]!)}, ${lit(s[2]!)}, ${lit(s[3]!)}) + vec4<f32>(${lit(o[0]!)}, ${lit(o[1]!)}, ${lit(o[2]!)}, ${lit(o[3]!)});`);
    // Second input vec4 (channels 4..7), mirroring nupscale/model.py `assemble`:
    // [depth], [normal.xyz] — depth first when both are present (rgbdn).
    const depthExpr = `h${k} * (nearFar.x * nearFar.y / (nearFar.y - m${k}.w * (nearFar.y - nearFar.x))) * ${lit(s[4]!)} + ${lit(o[4]!)}`;
    if (useNormals) {
      const nb = useDepth ? 5 : 4;
      lines.push(`  let n${k} = textureLoad(normal, q${k}, 0).xyz * h${k};`);
      const nx = `n${k}.x * ${lit(s[nb]!)} + ${lit(o[nb]!)}`;
      const ny = `n${k}.y * ${lit(s[nb + 1]!)} + ${lit(o[nb + 1]!)}`;
      const nz = `n${k}.z * ${lit(s[nb + 2]!)} + ${lit(o[nb + 2]!)}`;
      lines.push(useDepth
        ? `  let a1_${k} = vec4<f32>(${depthExpr}, ${nx}, ${ny}, ${nz});`
        : `  let a1_${k} = vec4<f32>(${nx}, ${ny}, ${nz}, 0.0);`);
    } else if (useDepth) {
      lines.push(`  let a1_${k} = vec4<f32>(${depthExpr}, 0.0, 0.0, 0.0);`);
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
  const usesNearFar = first && inputsUseDepth(model.inputs);
  const usesNormal = first && inputsUseNormals(model.inputs);
  const params = first ? (usesNormal ? ['march', 'normal'] : ['march']) : inputs.map((_, k) => `in${k}`);
  const sig = [
    ...params.map((p) => `${p}: texture_2d<f32>`),
    'texCoord: vec2<f32>',
    'flipY: f32',
    ...(usesNearFar ? ['nearFar: vec2<f32>'] : []),
  ];
  const nIn = first ? (usesNearFar || usesNormal ? 2 : 1) : inputs.length;
  let body = lowPrelude(params[0]!) + tapCoords('p', 'maxI', layer.dilation) + (first ? marchInputTaps(model) : textureTaps(inputs.length));
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
    inputs: first ? [...params] : [...inputs], params, usesNearFar, fnName, run, state, reads,
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
/** WebGPU's default maxSampledTexturesPerShaderStage. A pass binds one texture per 4 input
 *  channels (plus the march, plus the normal on the first pass); the 'dc' deconv pass binds the
 *  march AND the whole last hidden layer, so 64 hidden channels (16 textures) + march = 17 is
 *  over the limit and every pipeline fails to compile (upscale-smoke 2026-09-12, s64d/dc). */
export const MAX_SAMPLED_TEXTURES = 16;

export function planUpscalePasses(model: UpscaleModel, layout: UpscaleLayout): PassSpec[] {
  const lastHidden = model.layers[model.layers.length - 2]?.outC ?? 0;
  if (layout === 'dc' && 1 + lastHidden / 4 > MAX_SAMPLED_TEXTURES) {
    throw new Error(`upscale: layout dc binds ${1 + lastHidden / 4} textures for a ${lastHidden}-wide last hidden layer (limit ${MAX_SAMPLED_TEXTURES}); use layout sp`);
  }
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
