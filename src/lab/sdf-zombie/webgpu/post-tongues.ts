// src/lab/sdf-zombie/webgpu/post-tongues.ts
//
// SCREEN-SPACE FLAME TONGUES (flame-tongues plan task 2, the first of the
// three techniques). A fullscreen pass grows ragged flame UP out of the
// per-pixel burn mask the march publishes as its fourth MRT attachment: each
// pixel walks a bounded 16 taps DOWN the projected world-up direction, and
// where it finds a burning body it draws the flame that body's silhouette
// would rise. Cost is fixed per screen no matter how many bodies burn, and
// the shape is crisp pixel flame rather than a blob — which is what the
// Blood reference sprites are.
//
// THE ONE LOOK RULE this pass lives or dies by: the flame is a constant
// WORLD size, not a constant screen size. tonguePixelLength projects the
// tuning's world length into pixels at the body's depth, the host feeds the
// pass that length divided by the tap count as the per-tap step, and a body
// twice as far away gets half as tall a flame in pixels — exactly like a
// real flame and exactly unlike a screen-space glow.
//
// OCCLUSION. The march cannot see the level, so the burn mask burns THROUGH
// walls: a body behind a pillar still writes burn texels. The pass therefore
// reads the CAPTURE's depth at the found source (the body's own depth where
// it is visible) and skips any destination pixel whose own depth is nearer
// than that — scene geometry in front of the flame plane occludes the flame.
// A sky tap (the exact capture pixel fell between march texels) falls back
// to the host's camera-to-body distance instead of occluding everything.
//
// THE SHADER mirrors tongueProfile exactly (same exponent ramp), mirrors the
// surface pass's fireRamp stop-for-stop (so skin fire and tongue fire share
// one palette — CHAR_MASK's, which the NotBlood A/B was tuned against), and
// phases its flicker from a coarse screen-cell hash of the source pixel so
// two burning bodies flicker independently.

/** The fixed tap count — the whole per-pixel cost of the pass. */
export const TONGUE_TAPS = 16;

/**
 * Flame intensity at normalised distance t from the body: 1 at the
 * silhouette, 0 at and past full length. ragged fattens the falloff's tail
 * (torn edges reach further); the per-column ragged EDGES themselves live in
 * the shader's domain warp, not here — the CPU copy is the envelope both
 * sides must agree on.
 */
export function tongueProfile(t: number, ragged: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const r = Math.min(1, Math.max(0, ragged));
  // Farther falloff at high ragged (1.2) than smooth (2.5).
  return Math.pow(1 - t, 2.5 + (1.2 - 2.5) * r);
}

/**
 * World length projected to pixels at depthM with a viewport viewportH px
 * tall and vertical half-FOV tan fovScale: the constant-world-size rule in
 * one line. Zero guards: no length, no depth, no viewport, no FOV — no
 * flame (and never a division by zero).
 */
export function tonguePixelLength(lengthM: number, depthM: number, viewportH: number, fovScale: number): number {
  if (!(lengthM > 0) || !(depthM > 0) || !(viewportH > 0) || !(fovScale > 0)) return 0;
  return (lengthM * viewportH) / (2 * fovScale * depthM);
}

/** Everything the pass needs for one frame, fed by post-aa's setTongues. */
export interface TongueFrame {
  /** Pixels per tap: tonguePixelLength(length, refDepthM, viewportH, fovTan)
   *  / TONGUE_TAPS, computed host-side where the camera lives. */
  stepPx: number;
  /** Camera near/far (view metres), for the clip-to-view depth conversion. */
  near: number;
  far: number;
  /** tan(vertical FOV / 2) — pixels-per-metre at the source depth. */
  fovTan: number;
  /** Camera-to-body distance in metres: the flame-plane depth fallback for
   *  sky taps and the shape of everything world-sized. */
  refDepthM: number;
  /** The tuning's flame length in metres (noise-space scale). */
  length: number;
  ragged: number;
  /** Metres per second the flame shape climbs. */
  rise: number;
  /** Emissive gain on the tongues themselves. */
  gain: number;
  /** Sideways tip wander, 0..1. */
  lean: number;
  /** Projected world-up in capture pixel space, normalised, y negative. */
  upX: number;
  upY: number;
  /** Wall-clock seconds — never dt-integrated (the flicker-clock rule). */
  time: number;
}

/**
 * The pass. Additive: returns the tongue colour with alpha 1 and the material
 * blends (SrcAlpha, One) over the capture — the glow-blur precedent, never
 * alphaHash, never alphaTest. All taps are textureLoad: the capture target
 * and the march target are NearestFilter, so no sampler binding exists.
 *
 * cfg0 = (stepPx, near, far, fovTan); cfg1 = (ragged, rise, gain, lean);
 * cfg2 = (refDepthM, lengthM, time, spare). Helpers follow the main fn —
 * three anchors its wgslFn parse at ^ (the FXAA precedent), and everything
 * after is emitted verbatim at module scope where forward references resolve.
 * No backticks anywhere in this string (the esbuild trap).
 */
export const POST_TONGUES_WGSL = /* wgsl */ `fn postTongues(
  burnTex: texture_2d<f32>,
  depthTex: texture_depth_2d,
  texCoord: vec2<f32>,
  upPx: vec2<f32>,
  cfg0: vec4<f32>,
  cfg1: vec4<f32>,
  cfg2: vec4<f32>
) -> vec4<f32> {
  // Entry flip: this pass's target-bound write inverts Y, so sampling the
  // capture orientation keeps the post-aa module invariant.
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let dims = vec2<f32>(textureDimensions(depthTex, 0));
  let maxP = vec2<i32>(i32(dims.x) - 1, i32(dims.y) - 1);
  let pix = clamp(vec2<i32>(floor(tc * dims)), vec2<i32>(0, 0), maxP);
  let bDims = vec2<f32>(textureDimensions(burnTex, 0));
  let bMax = vec2<i32>(i32(bDims.x) - 1, i32(bDims.y) - 1);

  // Interior pixels (burning body AT this pixel) contribute nothing — the
  // surface pass already owns them; the tongues only exist OFF the body.
  let here = textureLoad(burnTex, clamp(vec2<i32>(floor(tc * bDims)), vec2<i32>(0, 0), bMax), 0);
  return vec4<f32>(0.0, here.x, 0.0, 1.0); // TEMP: G = here.x

  // The bounded walk: 16 taps DOWN the projected world-up, at the host's
  // per-tap pixel step (the world length divided by the tap count, so the
  // flame is a constant WORLD size). First burning march texel wins.
  let down = vec2<f32>(-upPx.x, -upPx.y);
  var srcMask = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var srcCap = pix;
  var tapK = 0.0;
  var found = false;
  for (var k: i32 = 1; k <= 16; k = k + 1) {
    let q = vec2<f32>(pix) + down * (cfg0.x * f32(k));
    let bpx = clamp(vec2<i32>(floor(q * bDims / dims)), vec2<i32>(0, 0), bMax);
    let m = textureLoad(burnTex, bpx, 0);
    if (m.x > 0.02) {
      found = true;
      srcMask = m;
      srcCap = clamp(vec2<i32>(floor(q)), vec2<i32>(0, 0), maxP);
      tapK = f32(k);
      break;
    }
  }
  if (!found) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); } // TEMP BISECT notfound=black
  let t = tapK / 16.0;

  // OCCLUSION against the capture's own depth: the flame lives at the
  // SOURCE body's depth, so any destination surface nearer than that (the
  // bias is 6 cm of view depth) hides it. Sky at the source pixel falls
  // back to the host's camera-to-body distance rather than occluding.
  let n = max(cfg0.y, 0.001);
  let f = max(cfg0.z, n + 0.001);
  let srcClip = textureLoad(depthTex, srcCap, 0);
  let srcZdirect = (n * f) / (f - srcClip * (f - n));
  let srcZ = select(srcZdirect, cfg2.x, srcClip >= 1.0);
  let dstClip = textureLoad(depthTex, pix, 0);
  if (dstClip < 1.0) {
    let dstZ = (n * f) / (f - dstClip * (f - n));
    if (dstZ < srcZ - 0.06) { return vec4<f32>(0.0, 0.0, 0.4, 1.0); } // TEMP BISECT occluded=blue
    return vec4<f32>(0.0, 0.35, 0.0, 1.0); // TEMP BISECT found=green
  }

  // PHASE, per coarse screen cell of the source: bodies (and well-separated
  // columns of one body) flicker independently.
  let phase = tongueHash21(floor(vec2<f32>(srcCap) / max(dims * 0.33, vec2<f32>(1.0, 1.0))) + vec2<f32>(19.7, 7.3));
  // World-metre frame of the flame column, from pixels per metre at the
  // source depth: noise features stay world-sized at every distance.
  let pxm = dims.y / (2.0 * max(cfg0.w, 0.001) * max(srcZ, 0.05));
  let colM = vec2<f32>(srcCap) / max(pxm, 0.001);
  let lengthM = max(cfg2.y, 0.01);

  // Per-column tip height: tongues of different lengths are the skeleton of
  // the look — without this the flame is one uniform fringe.
  let colJit = clamp(0.45 + 1.1 * tongueFbm(vec2<f32>(colM.x * 2.3, phase * 41.0)), 0.3, 1.45);
  let tt = min(t / colJit, 1.5);

  // Upward-scrolling fbm, domain-warped by ragged, leaning sideways with
  // height (the tip wavers, the base does not). Scroll rides the WORLD
  // height t * lengthM plus rise * time, so a feature moves toward the body
  // — flame rises — at the tuning's metres per second.
  var nc = vec2<f32>(colM.x * 3.1, (t * lengthM + cfg1.y * cfg2.z) * 3.4);
  nc.x = nc.x + (tongueFbm(nc * 0.55 + vec2<f32>(31.7, 11.9)) - 0.5) * (1.0 + 5.0 * ragged)
       + cfg1.w * sin(tt * 4.0 + cfg2.z * 1.9 + phase * 6.283) * 0.45;
  let fnz = tongueFbm(nc);

  let flameK = tongueProfile(tt, ragged) * (0.30 + 0.95 * fnz);
  let flick = 0.78 + 0.22 * sin(cfg2.z * (8.0 + 5.0 * phase) + phase * 19.0);
  // Burn drives the tongues; a charred body's are damped (the soot has less
  // left to give), and the surface's own fire channel leads the base.
  let bodyK = srcMask.x * (1.0 - srcMask.y * 0.45);
  let rampIn = clamp(1.12 - tt - 0.30 * fnz, 0.0, 1.0);
  let col = tongueFireRamp(rampIn) * (flameK * bodyK * cfg1.z * flick);
  return vec4<f32>(col, 1.0);
}

// THE ENVELOPE, mirrored exactly in tongueProfile() above: 1 at the
// silhouette, 0 at and past 1, ragged fattening the tail.
fn tongueProfile(t: f32, ragged: f32) -> f32 {
  if (t <= 0.0) { return 1.0; }
  if (t >= 1.0) { return 0.0; }
  return pow(1.0 - t, mix(2.5, 1.2, clamp(ragged, 0.0, 1.0)));
}

// The surface fire's ramp, stop-for-stop with CHAR_MASK's fireRamp so skin
// fire and tongue fire share one palette.
fn tongueFireRamp(x: f32) -> vec3<f32> {
  let t = clamp(x, 0.0, 1.0);
  let a = vec3<f32>(0.30, 0.02, 0.00);
  let b = vec3<f32>(1.00, 0.22, 0.02);
  let c = vec3<f32>(1.00, 0.62, 0.10);
  let d = vec3<f32>(1.00, 0.95, 0.72);
  if (t < 0.34) { return mix(a, b, t / 0.34); }
  if (t < 0.70) { return mix(b, c, (t - 0.34) / 0.36); }
  return mix(c, d, (t - 0.70) / 0.30);
}

fn tongueHash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + vec3<f32>(dot(p3, vec3<f32>(p3.y, p3.z, p.x + 33.33)));
  return fract((p3.x + p3.y) * p3.z);
}

fn tongueVnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let fr = fract(p);
  let u = fr * fr * (3.0 - 2.0 * fr);
  let a = tongueHash21(i);
  let b = tongueHash21(i + vec2<f32>(1.0, 0.0));
  let c = tongueHash21(i + vec2<f32>(0.0, 1.0));
  let d = tongueHash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn tongueFbm(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i: i32 = 0; i < 3; i = i + 1) {
    v = v + amp * tongueVnoise(q);
    q = q * 2.13 + vec2<f32>(11.3, 7.9);
    amp = amp * 0.5;
  }
  return v;
}`;
