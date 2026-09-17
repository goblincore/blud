// src/lab/sdf-zombie/webgpu/post-glow.ts
//
// THE GLOW PASS, as pure numbers plus the two WGSL sources post-aa.ts wires
// into quad scenes. Bright-pass + separable 5-tap blur: draw one thresholds
// WORKING-space luminance and blurs along x into a half-size target, draw two
// blurs along y and is added back into the capture with additive blending.
//
// WHY BEFORE FXAA (the plan's one hard ordering rule): the capture holds
// pre-encode working-space values (the colour-chain rule in post-aa.ts's
// header), and the pass is deliberately fed exactly those — thresholding and
// adding in the working space means glow is never added after display
// encoding, which would bloom the encode's own ringing and double-bright the
// midtones. postAaBlastWarp's mirror rule applies here too: the WGSL kernel
// below and glowWeights() must stay the same five numbers, or the CPU tuning
// lies about what the GPU draws.

/** A normalised, symmetric, centre-heavy 5-tap Gaussian kernel. */
export function glowWeights(): number[] {
  return [1, 4, 6, 4, 1].map(w => w / 16);
}

/**
 * The bright-pass knee: nothing at or below the threshold, the luminance
 * above it otherwise. Linear rather than soft-kneed — the fire's luminance
 * sits far above the threshold (the floor and the reference cube sit far
 * below), so the knee's exact shape between them is not what the tuning is
 * about; the threshold is.
 */
export function glowKnee(lum: number, threshold: number): number {
  return lum > threshold ? lum - threshold : 0;
}

/**
 * Draw one: extract the bright pass and blur along x, writing a half-size
 * target. cfg: x = knee threshold, y/z = one GLOW-target texel as UV (the
 * offsets step in the half-size grid so the x and y footprints match), w =
 * gain (applied by draw two, not here).
 *
 * The source is the full-size capture, which is nearest/nearest — so this
 * pass fetches with textureLoad, exactly like the FXAA pass: three emits no
 * `<tex>_sampler` binding for an unfilterable target, and a textureSample
 * against it would not compile (the VHS input pair exists for the same
 * reason). The draw-two target IS LinearFilter, which is what lets the blur
 * below sample with textureSample.
 *
 * Helper fns follow the main fn: three anchors its wgslFn declaration parse
 * at ^ (the source must START with the main fn), and everything after the
 * header is emitted verbatim at module scope, where WGSL resolves forward
 * references.
 */
export const POST_GLOW_EXTRACT_WGSL = /* wgsl */ `fn postGlowExtract(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  cfg: vec4<f32>
) -> vec4<f32> {
  let dimsF = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(dimsF) - vec2<i32>(1, 1);
  // Entry flip: this pass's target-bound write inverts Y, so flipping the
  // sampling keeps the output in the source's orientation (the module
  // invariant - see post-aa.ts's file header).
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  // Five taps along x, edge-clamped. The weights are glowWeights()'s
  // [1,4,6,4,1]/16 - keep them in step.
  var acc = postGlowTapX(srcTex, tc + vec2<f32>(cfg.y * -2.0, 0.0), dimsF, maxP, cfg.x) * 0.0625;
  acc = acc + postGlowTapX(srcTex, tc + vec2<f32>(cfg.y * -1.0, 0.0), dimsF, maxP, cfg.x) * 0.25;
  acc = acc + postGlowTapX(srcTex, tc, dimsF, maxP, cfg.x) * 0.375;
  acc = acc + postGlowTapX(srcTex, tc + vec2<f32>(cfg.y * 1.0, 0.0), dimsF, maxP, cfg.x) * 0.25;
  acc = acc + postGlowTapX(srcTex, tc + vec2<f32>(cfg.y * 2.0, 0.0), dimsF, maxP, cfg.x) * 0.0625;
  return vec4<f32>(acc, 1.0);
}

// The knee, mirrored from the CPU glowKnee above - keep them in step.
fn glowKnee(lum: f32, threshold: f32) -> f32 {
  return select(0.0, lum - threshold, lum > threshold);
}

// Rec 701 luminance, the same weights the CPU knee's callers assume.
fn postGlowLum(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// A bright-pass texel fetch, edge-clamped: colour scaled by its excess
// luminance over the threshold.
fn postGlowTapX(
  srcTex: texture_2d<f32>,
  at: vec2<f32>,
  dimsF: vec2<f32>,
  maxP: vec2<i32>,
  threshold: f32
) -> vec3<f32> {
  let px = clamp(vec2<i32>(floor(at * dimsF)), vec2<i32>(0, 0), maxP);
  let c = textureLoad(srcTex, px, 0).rgb;
  return c * glowKnee(postGlowLum(c), threshold);
}`;

/**
 * Draw two: blur the extracted pass along y and hand back the gain-scaled
 * glow. The host renders it into the capture with AdditiveBlending —
 * non-premultiplied that is (SrcAlpha, One) on this backend — and alpha 1,
 * so rgb * cfg.w is exactly what is added over whatever the capture holds.
 * Reads the half-size target, which is LinearFilter so textureSample has a
 * sampler to bind (see draw one's comment for the nearest-filter trap).
 */
export const POST_GLOW_BLUR_WGSL = /* wgsl */ `fn postGlowBlur(
  glowTex: texture_2d<f32>,
  glowSamp: sampler,
  texCoord: vec2<f32>,
  cfg: vec4<f32>
) -> vec4<f32> {
  // Entry flip, the module invariant (see post-aa.ts's file header): the
  // additive write must land the glow on the capture's own pixels.
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  // The same [1,4,6,4,1]/16 kernel along y - keep in step with glowWeights().
  var acc = textureSample(glowTex, glowSamp, tc + vec2<f32>(0.0, cfg.z * -2.0)).rgb * 0.0625;
  acc = acc + textureSample(glowTex, glowSamp, tc + vec2<f32>(0.0, cfg.z * -1.0)).rgb * 0.25;
  acc = acc + textureSample(glowTex, glowSamp, tc).rgb * 0.375;
  acc = acc + textureSample(glowTex, glowSamp, tc + vec2<f32>(0.0, cfg.z * 1.0)).rgb * 0.25;
  acc = acc + textureSample(glowTex, glowSamp, tc + vec2<f32>(0.0, cfg.z * 2.0)).rgb * 0.0625;
  return vec4<f32>(acc * cfg.w, 1.0);
}`;
