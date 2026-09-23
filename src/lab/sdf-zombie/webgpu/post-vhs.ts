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
//                    error, so post-vhs.test.ts pins every row exactly.
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
//   * `uPrevSampler` / `uHasPrev`   -> `prevTex` + `hasPrev: f32`. prevTex is
//                                      ONLY sampled inside `if (hasPrev > 0.5)`:
//                                      with no previous input the tap would read
//                                      an uninitialised or wrong-size target.
//   * every `uniform float uX`      -> a parameter named `X`.
//   * `uResolution` is NOT a parameter. The pass derives
//     `vec2<f32>(textureDimensions(tex, 0))` from the bound texture, so a
//     stale uniform after post-aa's refit() can never silently change the
//     texel size or the warp amplitude.
//   * `time` is SECONDS (`performance.now() / 1000`), NOT milliseconds. The
//     hash inputs are `floor(time * 60)`, `floor(time * 24)` and
//     `floor(time * chromaBurstRate)`; f32 has exact integers only to 2^24, so
//     the raw clock is wrapped at the top of the pass:
//       let t = time - 600.0 * floor(time / 600.0);
//     and only `t` feeds the hashes and the helpers. Without the wrap the
//     product reaches ~1.2e7 at t≈600 s where the f32 ulp is 1, `fract` goes
//     to 0 and the hash is 0 forever — row noise becomes constant darkening,
//     bursts never fire and the jitter pins.
//   * GLSL `mod(a, b)` is `a - b*floor(a/b)` (non-negative for positive b);
//     WGSL `%` keeps the sign of `a`. This source uses only `fract` (which
//     agrees between the two), but any future `mod` must be written out.
//   * `vec3`/`vec2`/`float` -> `vec3<f32>`/`vec2<f32>`/`f32`, constructors
//     become `vec3<f32>(...)`.
//   * ENTRY Y-FLIP. Every target-bound pass in post-aa.ts samples `(x, 1-y)`
//     so each intermediate target keeps the capture's orientation (see the
//     ORIENTATION note at the top of post-aa.ts). This pass does the same:
//     `tc = vec2<f32>(uv.x, 1.0 - uv.y)` feeds every sample — base, prev,
//     both chroma taps and the horizontal blur — and the row index in the
//     noise/jitter/burst hashes.
//   * DISPLAY SPACE. Taps are graded in display space exactly as the Phaser
//     source did. When `isDisplay < 0.5` (the pass is the entry stage and the
//     capture is working-space) each tap is run through postVhsOetf before
//     grading; when `isDisplay > 0.5` the source is already encoded. BLIT
//     after this pass must therefore be told `srcIsDisplay = 1`.
//   * HORIZONTAL BLUR. The source's 3x3 blur9 had vertical taps that erased
//     the interlace comb the field renderer produces upstream. This port uses
//     a horizontal 1-2-1 blur and hands the already-fetched centre texel in,
//     so the centre is not sampled twice. `blurAmount` keeps its meaning (mix
//     toward the blurred colour).
//   * ALPHA is always 1.0, matching the blend/blit siblings' contract, rather
//     than the capture's alpha.
//   * This module is deliberately NOT wired into post-aa.ts: the pass needs a
//     GPU + browser to verify, and post-aa's all-off path must stay a
//     byte-identical pass-through.

export interface VhsTerms {
  intensity: number; blurAmount: number; noiseAmount: number; gradeAmount: number;
  warpAmount: number; warpFrequency: number; warpSpeed: number;
  chromaAmount: number; chromaJitter: number; motionThreshold: number;
  chromaBurstChance: number; chromaBurstStrength: number; chromaBurstRate: number;
}

export type VhsPreset = 'blud' | 'soft' | 'balanced' | 'chaotic';

export const VHS_PRESETS: Record<VhsPreset, VhsTerms> = {
  // BLUD — the shipped default, and the ONLY row here that is not
  // club-mutant's. The owner tuned it on the game page with vhs-panel.ts
  // (2026-09-09), starting from `soft`; the sweep is recorded as a preset
  // rather than as term overrides at boot so `setVhs('blud')` restores the
  // shipped look from anywhere, the same as the other three.
  //
  // What the sweep actually did, since the numbers alone do not say it: the
  // tape ARTEFACTS went up and the tape MUSH went down. Full intensity and
  // full blurAmount (the horizontal-only kernel, so the interlace comb
  // survives), noise all but off at 0.005 and the green grade pulled back to
  // 0.38 — none of the constant veil that made `balanced` read as dirt. The
  // wobble is nearly still (warpAmount 0.3, warpSpeed 0.05) because a moving
  // warp reads as seasickness in first person. What is left is the chroma:
  // maximum jitter, a heavy 5.4 px split, and bursts firing on 61% of rows at
  // 34 Hz — so the frame is clean until it tears, which is the VHS read.
  //
  // motionThreshold was soft's 0.12, untouched by that sweep (raised by the owner 2026-09-23, below).
  // 2026-09-12 (owner): intensity 1 -> 0.81, blurAmount 1 -> 0.17, tuned in-game on top of the
  // neural upscaler (the stage already softens the flesh; the VHS blur on top of it was too much).
  // 2026-09-23 (owner): intensity 0.64, blurAmount 1, chromaAmount 8.2, chromaJitter 4.5 and the motion
  // gate raised to 0.54, tuned in-game against the lower-march-resolution experiments: heavier tape
  // blur and chroma split hide the reconstruction's edge artefacts.
  blud: {
    intensity: 0.64, blurAmount: 1, noiseAmount: 0.005, gradeAmount: 0.38,
    warpAmount: 0.3, warpFrequency: 1.1, warpSpeed: 0.05,
    chromaAmount: 8.2, chromaJitter: 4.5, motionThreshold: 0.54,
    chromaBurstChance: 0.61, chromaBurstStrength: 1.45, chromaBurstRate: 34.1,
  },
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
 * The main fn is first (three's wgslFn parse anchor); `postVhsHash21`,
 * `postVhsOetf`, `postVhsTap`, the colour grade, the row noise and the
 * horizontal blur follow it as forward-referenced helpers. The uniforms of the
 * GLSL source are parameters now: time, hasPrev, isDisplay and the thirteen
 * VhsTerms. The resolution is derived from the texture, not passed in.
 *
 * RETURN TYPE IS vec4<f32>, NOT vec3 — a deliberate deviation from the sibling
 * `postAa*` stages, which all return vec3<f32>. The source GLSL ended
 * `gl_FragColor = vec4(color, baseTexCenter.a)`; this port returns alpha 1.0
 * instead (the blend/blit contract), so the vec4 keeps the stage's shape while
 * giving the chain an opaque frame.
 *
 * Helpers are prefixed `postVhs*` per the house convention (boneHash,
 * meshBoneSurface, postAaOetf). Unprefixed names like `hash21` would collide
 * the first time this shader shares a material with another that defines one.
 */
export const POST_VHS_WGSL = /* wgsl */ `fn postVhs(
  tex: texture_2d<f32>,
  samp: sampler,
  prevTex: texture_2d<f32>,
  uv: vec2<f32>,
  time: f32,
  hasPrev: f32,
  isDisplay: f32,
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
  // Resolution from the texture, never a uniform — see the port notes.
  let resolution = vec2<f32>(textureDimensions(tex, 0));
  let texel = vec2<f32>(1.0, 1.0) / resolution;

  // time is SECONDS. Wrap at 600 s so the hash inputs stay inside f32's
  // exact-integer range — see the port notes.
  let t = time - 600.0 * floor(time / 600.0);

  // Entry flip: this pass's target-bound write inverts Y, so sampling the
  // capture orientation keeps the module invariant (see post-aa.ts).
  let tc = vec2<f32>(uv.x, 1.0 - uv.y);

  let phase = (tc.y * warpFrequency + t * warpSpeed) * 6.28318530718;
  let warp = sin(phase) * (warpAmount / resolution.x);
  let warpedUv = tc + vec2<f32>(warp, 0.0);

  let baseTexCenter = postVhsTap(tex, samp, warpedUv, isDisplay);

  let hasPrevMask = step(0.5, hasPrev);
  var prevRgb = vec3<f32>(0.0, 0.0, 0.0);
  if (hasPrev > 0.5) {
    prevRgb = postVhsTap(prevTex, samp, warpedUv, isDisplay);
  }
  let motion = hasPrevMask * length(baseTexCenter - prevRgb);
  let motionMask = smoothstep(motionThreshold, motionThreshold * 2.0, motion);

  let row = floor(tc.y * resolution.y);
  let burstPhase = floor(t * chromaBurstRate);
  let burst = step(1.0 - chromaBurstChance, postVhsHash21(vec2<f32>(row + 13.0, burstPhase)));
  let burstMask = burst * chromaBurstStrength;

  let effectMask = max(motionMask, burstMask);

  let jx = postVhsHash21(vec2<f32>(floor(t * 24.0), tc.y * resolution.y));
  let jy = postVhsHash21(vec2<f32>(tc.y * resolution.y + 19.0, floor(t * 24.0)));

  let jitter = vec2<f32>((jx - 0.5) * 2.0, (jy - 0.5) * 2.0);

  let chromaPx = (chromaAmount + jitter * chromaJitter) * effectMask;
  let chromaUv = vec2<f32>(chromaPx.x / resolution.x, chromaPx.y / resolution.y);

  let chromaR = postVhsTap(tex, samp, warpedUv + chromaUv, isDisplay);
  let chromaG = baseTexCenter;
  let chromaB = postVhsTap(tex, samp, warpedUv - chromaUv, isDisplay);

  let base = vec3<f32>(chromaR.r, chromaG.g, chromaB.b);

  var color = postVhsBlurH(tex, samp, warpedUv, texel, baseTexCenter, blurAmount, isDisplay);

  color = postVhsColorGrade(color, gradeAmount);

  color = postVhsNoise(color, tc, resolution, t, noiseAmount);

  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));

  color = mix(base, color, vec3<f32>(intensity, intensity, intensity));

  return vec4<f32>(color, 1.0);
}

// Helpers follow the main fn — WGSL resolves these forward references at
// module scope, and three's wgslFn parse anchor needs the main fn first.

fn postVhsHash21(p0: vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 345.45));
  let d = dot(p, p + vec2<f32>(34.345, 34.345));
  p = p + vec2<f32>(d, d);
  return fract(p.x * p.y);
}

// three's sRGBTransferOETF, mirrored exactly (ColorSpaceFunctions.js), so a
// working-space tap is graded in the display space the Phaser source assumed.
fn postVhsOetf(c: vec3<f32>) -> vec3<f32> {
  let cc = max(c, vec3<f32>(0.0, 0.0, 0.0));
  let hi = pow(cc, vec3<f32>(0.41666, 0.41666, 0.41666)) * 1.055 - vec3<f32>(0.055, 0.055, 0.055);
  let lo = cc * 12.92;
  return select(hi, lo, cc <= vec3<f32>(0.0031308, 0.0031308, 0.0031308));
}

// A tap in display space: raw when the source is already encoded, OETF'd when
// it is the working-space capture.
fn postVhsTap(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2<f32>,
  isDisplay: f32
) -> vec3<f32> {
  let c = textureSample(tex, samp, uv).rgb;
  if (isDisplay > 0.5) { return c; }
  return postVhsOetf(c);
}

fn postVhsColorGrade(color: vec3<f32>, amount: f32) -> vec3<f32> {
  var graded = color;

  graded = graded * vec3<f32>(0.95, 1.05, 0.95);
  graded = graded + vec3<f32>(0.0, 0.012, 0.0);

  let luma = dot(graded, vec3<f32>(0.2126, 0.7152, 0.0722));
  graded = mix(vec3<f32>(luma, luma, luma), graded, vec3<f32>(0.9, 0.9, 0.9));

  return mix(color, graded, vec3<f32>(amount, amount, amount));
}

fn postVhsNoise(
  color: vec3<f32>,
  uv: vec2<f32>,
  resolution: vec2<f32>,
  t: f32,
  amount: f32
) -> vec3<f32> {
  let row = floor(uv.y * resolution.y);
  let n = postVhsHash21(vec2<f32>(row, floor(t * 60.0)));
  let centered = (n - 0.5) * 2.0;

  return color + vec3<f32>(centered * amount, centered * amount, centered * amount);
}

// Horizontal 1-2-1 blur. The vertical taps of the source's 3x3 kernel erased
// the interlace comb, so this port blurs along X only. center is the
// already-fetched centre tap, passed in to avoid a second fetch.
fn postVhsBlurH(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2<f32>,
  texel: vec2<f32>,
  center: vec3<f32>,
  amount: f32,
  isDisplay: f32
) -> vec3<f32> {
  let left = postVhsTap(tex, samp, uv - vec2<f32>(texel.x, 0.0), isDisplay);
  let right = postVhsTap(tex, samp, uv + vec2<f32>(texel.x, 0.0), isDisplay);
  let blurred = (center * 2.0 + left + right) * 0.25;

  return mix(center, blurred, vec3<f32>(amount, amount, amount));
}`;
