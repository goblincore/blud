// src/lab/sdf-zombie/webgpu/post-vhs.ts
//
// VHS post-FX: the club-mutant `soft` pipeline, ported from Phaser + GLSL ES
// 1.0 to three.js WebGPU + WGSL. Porting source (verbatim):
//   docs/reference/club-mutant-soft-postfx.frag.glsl
//   = client/src/pipelines/SoftPostFxPipeline.ts
// Design: docs/superpowers/specs/2026-09-09-vhs-post-fx-design.md
//
// Three runtime exports:
//   VHS_PRESETS    — the three tuned intensity presets, as plain data. These
//                    are the SOURCE OF TRUTH copied from club-mutant's
//                    applyPreset; a silent drift changes the look with no
//                    error, so post-vhs.test.ts pins the `soft` row exactly.
//   effectiveSmear — the temporal handover. post-aa already runs a temporal
//                    accumulation and this pass also samples the previous
//                    frame; while VHS is on the chain must use smear 0, but
//                    the user's SETTING must survive so turning VHS off
//                    restores the previous look exactly.
//   POST_VHS_WGSL  — the ported fragment shader as a WGSL source string.
//
// PORT NOTES — read before editing the string:
//   * The main fn MUST be the first thing in the string: three anchors its
//     wgslFn declaration parse at ^. Helpers follow it and WGSL resolves the
//     forward references (same rule post-aa.ts documents).
//   * `varying vec2 outTexCoord`    -> the `uv` parameter.
//   * `sampler2D uMainSampler`      -> `tex: texture_2d<f32>` + `samp: sampler`,
//                                      sampled with textureSample(tex, samp, ...).
//   * `uPrevSampler` / `uHasPrev`   -> `prevTex` + `hasPrev: f32`.
//   * every `uniform float uX`      -> a parameter named `X`.
//   * GLSL `mod(a, b)` is `a - b*floor(a/b)` (non-negative for positive b);
//     WGSL `%` keeps the sign of `a`. This source uses only `fract` (which
//     agrees between the two), but any future `mod` must be written out.
//   * `vec3`/`vec2`/`float` -> `vec3<f32>`/`vec2<f32>`/`f32`, constructors
//     become `vec3<f32>(...)`.
//   * This module is deliberately NOT wired into post-aa.ts: the pass needs a
//     GPU + browser to verify, and post-aa's all-off path must stay a
//     byte-identical pass-through.

export interface VhsTerms {
  intensity: number; blurAmount: number; noiseAmount: number; gradeAmount: number;
  warpAmount: number; warpFrequency: number; warpSpeed: number;
  chromaAmount: number; chromaJitter: number; motionThreshold: number;
  chromaBurstChance: number; chromaBurstStrength: number; chromaBurstRate: number;
}

export type VhsPreset = 'soft' | 'balanced' | 'chaotic';

export const VHS_PRESETS: Record<VhsPreset, VhsTerms> = {
  soft: {
    intensity: 0.7, blurAmount: 0.45, noiseAmount: 0.04, gradeAmount: 0.55,
    warpAmount: 1.25, warpFrequency: 1.5, warpSpeed: 0.25,
    chromaAmount: 0.6, chromaJitter: 0.6, motionThreshold: 0.12,
    chromaBurstChance: 0.02, chromaBurstStrength: 0.6, chromaBurstRate: 12,
  },
  balanced: {
    intensity: 1, blurAmount: 0.35, noiseAmount: 0.07, gradeAmount: 0.6,
    warpAmount: 2.5, warpFrequency: 2.0, warpSpeed: 0.35,
    chromaAmount: 2.5, chromaJitter: 1.75, motionThreshold: 0.08,
    chromaBurstChance: 0.08, chromaBurstStrength: 0.9, chromaBurstRate: 18,
  },
  chaotic: {
    intensity: 1, blurAmount: 0.25, noiseAmount: 0.14, gradeAmount: 0.85,
    warpAmount: 3.5, warpFrequency: 2.5, warpSpeed: 0.5,
    chromaAmount: 7, chromaJitter: 4, motionThreshold: 0.04,
    chromaBurstChance: 0.38, chromaBurstStrength: 1.6, chromaBurstRate: 55,
  },
};

/**
 * The smear the chain should actually apply.
 *
 * While VHS is on it owns temporal blending, so post-aa's smear is suppressed
 * to 0 — but the user's SETTING is never overwritten, which is why this is a
 * pure function of both rather than a setter that clobbers state. Turning VHS
 * off restores the previous look exactly.
 */
export function effectiveSmear(userSmear: number, vhsOn: boolean): number {
  return vhsOn ? 0 : userSmear;
}

/**
 * The club-mutant soft post-FX fragment shader, ported to WGSL.
 *
 * The main fn is first (three's wgslFn parse anchor); `hash21`, the colour
 * grade, the row noise and the 9-tap blur follow it as forward-referenced
 * helpers. The uniforms of the GLSL source are all parameters now:
 * resolution, time, hasPrev and the twelve VhsTerms.
 */
export const POST_VHS_WGSL = /* wgsl */ `fn postVhs(
  tex: texture_2d<f32>,
  samp: sampler,
  prevTex: texture_2d<f32>,
  uv: vec2<f32>,
  resolution: vec2<f32>,
  time: f32,
  hasPrev: f32,
  intensity: f32,
  blurAmount: f32,
  noiseAmount: f32,
  gradeAmount: f32,
  warpAmount: f32,
  warpFrequency: f32,
  warpSpeed: f32,
  chromaAmount: f32,
  chromaJitter: f32,
  motionThreshold: f32,
  chromaBurstChance: f32,
  chromaBurstStrength: f32,
  chromaBurstRate: f32
) -> vec4<f32> {
  let texel = vec2<f32>(1.0, 1.0) / resolution;

  let phase = (uv.y * warpFrequency + time * warpSpeed) * 6.28318530718;
  let warp = sin(phase) * (warpAmount / resolution.x);
  let warpedUv = uv + vec2<f32>(warp, 0.0);

  let baseTexCenter = textureSample(tex, samp, warpedUv);

  let hasPrevMask = step(0.5, hasPrev);
  let prevTexSample = textureSample(prevTex, samp, warpedUv).rgb;
  let motion = hasPrevMask * length(baseTexCenter.rgb - prevTexSample);
  let motionMask = smoothstep(motionThreshold, motionThreshold * 2.0, motion);

  let row = floor(uv.y * resolution.y);
  let burstPhase = floor(time * chromaBurstRate);
  let burst = step(1.0 - chromaBurstChance, hash21(vec2<f32>(row + 13.0, burstPhase)));
  let burstMask = burst * chromaBurstStrength;

  let effectMask = max(motionMask, burstMask);

  let jx = hash21(vec2<f32>(floor(time * 24.0), uv.y * 512.0));
  let jy = hash21(vec2<f32>(uv.y * 512.0 + 19.0, floor(time * 24.0)));

  let jitter = vec2<f32>((jx - 0.5) * 2.0, (jy - 0.5) * 2.0);

  let chromaPx = (chromaAmount + jitter * chromaJitter) * effectMask;
  let chromaUv = vec2<f32>(chromaPx.x / resolution.x, chromaPx.y / resolution.y);

  let chromaR = textureSample(tex, samp, warpedUv + chromaUv).rgb;
  let chromaG = baseTexCenter.rgb;
  let chromaB = textureSample(tex, samp, warpedUv - chromaUv).rgb;

  let base = vec3<f32>(chromaR.r, chromaG.g, chromaB.b);

  var color = blur9(tex, samp, warpedUv, texel, blurAmount);

  color = applyColorGrade(color, gradeAmount);

  color = applyNoise(color, uv, resolution, time, noiseAmount);

  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));

  color = mix(base, color, vec3<f32>(intensity, intensity, intensity));

  return vec4<f32>(color, baseTexCenter.a);
}

// Helpers follow the main fn — WGSL resolves these forward references at
// module scope, and three's wgslFn parse anchor needs the main fn first.

fn hash21(p0: vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 345.45));
  let d = dot(p, p + vec2<f32>(34.345, 34.345));
  p = p + vec2<f32>(d, d);
  return fract(p.x * p.y);
}

fn applyColorGrade(color: vec3<f32>, amount: f32) -> vec3<f32> {
  var graded = color;

  graded = graded * vec3<f32>(0.95, 1.05, 0.95);
  graded = graded + vec3<f32>(0.0, 0.012, 0.0);

  let luma = dot(graded, vec3<f32>(0.2126, 0.7152, 0.0722));
  graded = mix(vec3<f32>(luma, luma, luma), graded, vec3<f32>(0.9, 0.9, 0.9));

  return mix(color, graded, vec3<f32>(amount, amount, amount));
}

fn applyNoise(
  color: vec3<f32>,
  uv: vec2<f32>,
  resolution: vec2<f32>,
  time: f32,
  amount: f32
) -> vec3<f32> {
  let row = floor(uv.y * resolution.y);
  let n = hash21(vec2<f32>(row, floor(time * 60.0)));
  let centered = (n - 0.5) * 2.0;

  return color + vec3<f32>(centered * amount, centered * amount, centered * amount);
}

fn blur9(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2<f32>,
  texel: vec2<f32>,
  amount: f32
) -> vec3<f32> {
  var c = textureSample(tex, samp, uv).rgb * 4.0;

  c = c + textureSample(tex, samp, uv + vec2<f32>(texel.x, 0.0)).rgb;
  c = c + textureSample(tex, samp, uv - vec2<f32>(texel.x, 0.0)).rgb;
  c = c + textureSample(tex, samp, uv + vec2<f32>(0.0, texel.y)).rgb;
  c = c + textureSample(tex, samp, uv - vec2<f32>(0.0, texel.y)).rgb;

  c = c + textureSample(tex, samp, uv + vec2<f32>(texel.x, texel.y)).rgb;
  c = c + textureSample(tex, samp, uv + vec2<f32>(-texel.x, texel.y)).rgb;
  c = c + textureSample(tex, samp, uv + vec2<f32>(texel.x, -texel.y)).rgb;
  c = c + textureSample(tex, samp, uv + vec2<f32>(-texel.x, -texel.y)).rgb;

  c = c / 12.0;

  let base = textureSample(tex, samp, uv).rgb;

  return mix(base, c, vec3<f32>(amount, amount, amount));
}`;
