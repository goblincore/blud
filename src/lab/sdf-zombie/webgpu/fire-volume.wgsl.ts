// src/lab/sdf-zombie/webgpu/fire-volume.wgsl.ts
//
// THE VOLUMETRIC FIRE + SMOKE FIELD (burning-feedback round 2, tasks 4c + 4b).
// Round 2 read as a soft orange glow shell: `temp` was a pure capsule-distance
// falloff, so nothing ERODED the shape into tongues, and soot only multiplied
// transmittance, so smoke was invisible against a dark room. Round 2b fixes
// both here:
//
//   * TONGUES. A flame-space value-noise fbm (fireFbm, 3 octaves) is sampled at
//     a vertically stretched, DOWN-scrolling, curl-advected coordinate and
//     subtracted from the capsule shape: density = (shape - fbm * erodeAmt) *
//     edgeSharp. The erosion grows with height (erodeRise), so the base stays
//     solid and the top tears into separate licks with gaps between them.
//   * VISIBLE SMOKE. Soot gets an albedo and scatters: it is lit by ambient
//     grey plus the fire's own glow from below, accumulated front-to-back like
//     emission, and its radial envelope widens with height (smokeSpread) and is
//     advected by a stronger curl than the flame.
//
// THREE PASSES, each its own WGSL entry (round 2b: the composite blends into
// the capture instead of writing its own target + copy, and the resolve runs at
// the MARCH resolution):
//   march     low-res target (rgba16f): emission rgb, transmittance a.
//   resolve   LOW-RES: bilinear + temporal reprojection with a 3x3 min/max
//             clamp. Writes the FIELD only (emission, T), so the history is
//             never scene-contaminated.
//   composite full-res: bilinear-upsamples the low-res field and returns
//             vec4(emission, T); the draw's CustomBlending is (color: One,
//             SrcAlpha), so the capture target becomes emission + scene * T
//             without this pass ever sampling it.
//
// The lag formula here mirrors fire-volume-pack.ts's fireLagOffset exactly; the
// string test pins `lag * h` and the lagMaxM clamp.
//
// WGSL rules: helpers follow the main fn (three anchors the wgslFn parse at ^,
// everything after is emitted at module scope where forward references
// resolve). No backticks anywhere in these strings (the esbuild trap).

import type * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import type { FireVolumeTuning } from './fire-volume-tuning';

/** Everything post-aa's setFireVolume needs for one frame. */
export interface FireVolumeFrame {
  tuning: FireVolumeTuning;
  /** Wall-clock seconds for the curl scroll. */
  time: number;
  /** Monotonic frame index, for the per-frame march jitter. */
  frame: number;
  /** Current camera inverse view-projection. */
  invViewProj: THREE.Matrix4;
  /** The PREVIOUS frame's view-projection, for the history reprojection. */
  prevViewProj: THREE.Matrix4;
  near: number;
  far: number;
  /** Capsules packed into the storage buffer this frame. */
  capsuleCount: number;
  boundsMin: Vec3;
  boundsMax: Vec3;
  /** Host flag: skip the history for one frame (camera jump, tuning change). */
  resetHistory?: boolean;
}

/**
 * The march. Screen UV + inverse view-projection reconstruct the view ray;
 * a ray/AABB test over the packed capsules' bounds early-outs most pixels;
 * the scene depth texture caps the far end (NEVER the fragment's own depth).
 *
 * cfg0 = (steps, rise, sootRise, curlScale)
 * cfg1 = (curlStrength, lag, lagMaxM, tempGain)
 * cfg2 = (sootGain, capsuleCount, time, frame)
 * cfg4 = (noiseScale, noiseStretch, erode, erodeRise)
 * cfg5 = (edgeSharp, coreR, smokeAlbedo, smokeAmbient)
 * cfg6 = (smokeFireLit, smokeSpread, spare, spare)
 * nearFar = (near, far, spare, spare)
 */
export const FIRE_VOLUME_MARCH_WGSL = /* wgsl */ `fn fireVolumeMarch(
  depthTex: texture_depth_2d,
  curlTex: texture_3d<f32>,
  curlSamp: sampler,
  caps: ptr<storage, array<vec4<f32>>, read>,
  invViewProj: mat4x4<f32>,
  texCoord: vec2<f32>,
  cfg0: vec4<f32>,
  cfg1: vec4<f32>,
  cfg2: vec4<f32>,
  cfg4: vec4<f32>,
  cfg5: vec4<f32>,
  cfg6: vec4<f32>,
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  nearFar: vec4<f32>
) -> vec4<f32> {
  let steps = i32(cfg0.x + 0.5);
  if (steps <= 0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (cfg2.y < 0.5) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  // Entry flip: this pass's target-bound write inverts Y, so sampling in the
  // capture orientation keeps the post-aa module invariant (post-tongues).
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let dDims = vec2<f32>(textureDimensions(depthTex, 0));
  let dMax = vec2<i32>(dDims) - vec2<i32>(1, 1);
  let pix = clamp(vec2<i32>(floor(tc * dDims)), vec2<i32>(0, 0), dMax);

  // View ray from the near and far plane points (WebGPU clip z is already
  // [0,1]; ndc y flips against the top-left capture UV).
  let ndc = vec2<f32>(tc.x * 2.0 - 1.0, 1.0 - tc.y * 2.0);
  let near4 = invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let far4 = invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let origin = near4.xyz / near4.w;
  let farW = far4.xyz / far4.w;
  let rayVec = farW - origin;
  let rayLen = length(rayVec);
  if (rayLen < 1e-5) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let rayDir = rayVec / rayLen;

  // Scene stop distance: linearised depth from the CAPTURE's depth texture.
  let n = max(nearFar.x, 0.001);
  let f = max(nearFar.y, n + 0.001);
  let depth = textureLoad(depthTex, pix, 0);
  let sceneZ = select((n * f) / (f - depth * (f - n)), f, depth >= 1.0);
  let tScene = rayLen * clamp((sceneZ - n) / (f - n), 0.0, 1.0);

  // Ray/AABB. A miss (or everything beyond the scene) is transmittance 1.
  let invDir = 1.0 / rayDir;
  let ta = (boundsMin.xyz - origin) * invDir;
  let tb = (boundsMax.xyz - origin) * invDir;
  let tsmall = min(ta, tb);
  let tbig = max(ta, tb);
  let tNear = max(max(max(tsmall.x, tsmall.y), tsmall.z), 0.0);
  let tFar = min(min(min(tbig.x, tbig.y), tbig.z), tScene);
  if (tFar <= tNear) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  // Per-pixel, per-frame jittered start (interleaved gradient noise).
  let ppx = tc * 4096.0 + vec2<f32>(cfg2.w * 5.588238, cfg2.w * 3.123);
  let stepM = (tFar - tNear) / f32(steps);
  var t = tNear + fireIgn(ppx) * stepM;
  var emission = vec3<f32>(0.0);
  var T = 1.0;
  let capsuleCount = i32(cfg2.y + 0.5);
  let rise = max(cfg0.y, 1e-3);
  let sootRise = max(cfg0.z, rise + 1e-3);
  let freq = max(cfg4.x, 1e-3);
  let stretch = clamp(cfg4.y, 0.05, 4.0);
  let erode = clamp(cfg4.z, 0.0, 4.0);
  let erodeRise = max(cfg4.w, 1e-3);
  let edgeSharp = max(cfg5.x, 0.01);
  let coreR = max(cfg5.y, 1e-3);
  let smokeAlbedo = max(cfg5.z, 0.0);
  let smokeAmbient = max(cfg5.w, 0.0);
  let smokeFireLit = max(cfg6.x, 0.0);
  let smokeSpread = max(cfg6.y, 0.0);
  // The flame-space origin is the field's AABB corner, so the tongues travel
  // WITH the body instead of the body swimming through a world-locked field.
  let base = boundsMin.xyz;
  let ambientCol = vec3<f32>(0.62, 0.58, 0.55);
  let fireLitCol = vec3<f32>(1.0, 0.42, 0.10);

  // EMPTY-SPACE SKIPPING: stepM is the FINE step, taken only where there is
  // flame or smoke; elsewhere the step grows with the distance to the nearest
  // flame shell (capped at 6 fine steps), so the tall smoke-padded AABB costs
  // a handful of samples instead of all of them. The loop bound is a cap.
  for (var s: i32 = 0; s < steps * 2; s = s + 1) {
    if (t > tFar) { break; }
    let p = origin + rayDir * t;
    // The curl warp is a property of the sample point, not of one capsule, and
    // a 3D texture fetch is the march's dominant cost: fetch it ONCE per
    // sample and share it across the capsule loop. curlStrength is a WOBBLE IN
    // METRES (a few cm): round 2b used it as 1.3 m, which threw every sample a
    // metre off the body before the capsule distance was taken, and the flame
    // field landed nowhere near the body at all.
    let curlUvw = p * cfg0.w + vec3<f32>(0.0, -cfg2.z * 0.35, 0.0);
    let curl = fireCurl(curlTex, curlSamp, curlUvw);
    let cv = curl * cfg1.x;
    let qw = p + cv;

    // THE FLAME FIELD (hands-on redesign, 2026-09-18). Blood's burning body is
    // SHEETS OF FLAME RISING OFF EVERY LIMB, not a glow around it. Per capsule:
    // take the limb point under the sample (the closest point on the segment),
    // measure the height s above it, pull the sample back DOWN by s (clamped
    // to the flame length) and take the capsule distance there. That sweeps
    // every limb upward into a tapering sheet: flame clings to the sides of a
    // vertical torso (s ~ 0 there) and streams up off arms, shoulders and head.
    var shape = 0.0;
    var uBest = 1.0;
    var sootRaw = 0.0;
    var minOut = 1e6;
    var glow = 0.0;
    for (var i: i32 = 0; i < capsuleCount; i = i + 1) {
      let rec0 = (*caps)[i * 3];
      let rec1 = (*caps)[i * 3 + 1];
      let rec2 = (*caps)[i * 3 + 2];
      let a = rec0.xyz;
      let radius = rec0.w;
      let b = rec1.xyz;
      let burn = rec1.w;
      let ab = b - a;
      let k = clamp(dot(qw - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
      let under = a + ab * k;
      let sRaw = qw.y - under.y;
      if (sRaw > sootRise + rise) { continue; }
      let sH = clamp(sRaw, 0.0, rise);
      let u = sH / rise;
      let lag = fireLag(rec2.xyz, sH, cfg1.y, cfg1.z);
      let q2 = qw - lag - vec3<f32>(0.0, sH, 0.0);
      // Taper: the sheet narrows as it climbs, and the shell it lives in
      // thins with it, so tongues come to points instead of ending in slabs.
      let dd = fireSdCapsule(q2, a, b) - radius * (1.0 - 0.55 * u);
      let w = coreR * (1.0 - 0.7 * u);
      let env = burn * saturate(1.0 - max(dd, 0.0) / max(w, 1e-3)) * (1.0 - u * u);
      if (env > shape) { shape = env; uBest = u; }
      minOut = min(minOut, max(dd - w, 0.0));
      // Smoke above the flame tip, from the unswept capsule's top.
      let top = max(a.y, b.y);
      let h = max(0.0, p.y - top);
      let dS = fireSdCapsule(p + cv * 3.0 - lag, a, b) - radius;
      let sootShape = fireSoot(dS, h, rise, sootRise, smokeSpread);
      sootRaw = sootRaw + burn * sootShape;
      glow = max(glow, burn * exp(-max(h - 0.15 * rise, 0.0) / (0.45 * rise)));
    }
    let dtFine = stepM;
    if (shape < 1e-3 && sootRaw < 2e-3) {
      // Nothing here: skip toward the nearest flame shell. The swept field is
      // not an exact distance, so only half of it is trusted.
      t = t + clamp(minOut * 0.5, stepM, stepM * 6.0);
      continue;
    }
    // FLAME-SPACE NOISE, only where there is flame: vertically stretched and
    // scrolling UP at the flame speed, so the tears climb the tongues.
    // Contrast: a 3-octave value fbm lives in ~0.3..0.7, so stretch it to the
    // full 0..1 or the erosion can only dim the flame, never cut a gap in it.
    var erosion = 1.0;
    if (shape > 1e-3) {
      var fq = (qw - base) * vec3<f32>(freq, freq * stretch, freq);
      fq.y = fq.y - cfg2.z * FIRE_FLAME_SPEED * freq * stretch;
      erosion = smoothstep(0.3, 0.7, fireFbm(fq));
    }
    // Smoke billows on a larger, more strongly advected copy, only where the
    // column is.
    var soot = 0.0;
    if (sootRaw > 2e-3) {
      var smokeFq = (p + cv * 3.0 - base) * vec3<f32>(freq * 0.35, freq * stretch * 0.35, freq * 0.35);
      smokeFq.y = smokeFq.y - cfg2.z * FIRE_FLAME_SPEED * 0.6 * freq * stretch * 0.35;
      soot = sootRaw * (0.35 + 1.1 * fireFbm(smokeFq));
    }
    // EROSION: subtractive against the plateau-shaped envelope, so the noise
    // cuts CRISP tongues with real gaps between them. Least at the limb (a
    // solid burning core), growing with height up the sheet.
    let erodeAmt = erode * mix(0.55, 1.0, smoothstep(0.0, max(erodeRise, 1e-3), uBest));
    let density = saturate((shape - erosion * erodeAmt) * edgeSharp);
    // Temperature: hot (yellow-white) at the limb, cooling to dark red at the
    // tips; the eroded edges are cooler than the cores.
    // The same noise that tears the flame also sets its heat: where the erosion
    // is low the flame is a hot core (yellow-white), toward a tear it cools to
    // orange and red. That is the internal structure Blood's frames have.
    let temp = saturate(density * (0.8 - 0.6 * uBest) * (0.35 + 1.0 * (1.0 - erosion) * (1.0 - erosion)));
    // EMISSION-ABSORPTION WITH ONE COEFFICIENT. Emitting and absorbing with the
    // same sigma means a thick flame converges to exactly its ramp colour
    // (times the brightness, tempGain) instead of summing past 1 into white;
    // thin edges stay translucent. alphaF is this step's flame opacity.
    let alphaF = 1.0 - exp(-density * FIRE_FLAME_SIGMA * dtFine);
    emission = emission + T * fireRamp(temp) * alphaF * cfg1.w;
    // SMOKE SCATTERS. Round 2 only darkened through T; an albedo lit by ambient
    // grey plus the fire glow is what makes the column visible at all. The
    // inscatter is gated by sootGain (clamped to 1) as well as the extinction,
    // so sootGain 0 is a true smoke-off switch — the look metric's twin.
    let smokeGain = clamp(cfg2.x, 0.0, 1.0);
    let inscatter = soot * smokeGain * smokeAlbedo * (smokeAmbient * ambientCol + smokeFireLit * glow * fireLitCol);
    emission = emission + T * inscatter * dtFine;
    T = T * (1.0 - alphaF) * exp(-soot * cfg2.x * dtFine);
    if (T < 0.003) { break; }
    t = t + stepM;
  }
  return vec4<f32>(emission, T);
}

// The shared curl volume decode: rgb * 2 - 1, the curl-volume-node contract.
fn fireCurl(tex: texture_3d<f32>, samp: sampler, uvw: vec3<f32>) -> vec3<f32> {
  return textureSampleLevel(tex, samp, uvw, 0.0).rgb * 2.0 - 1.0;
}

// The lag formula mirrored from fire-volume-pack.ts's fireLagOffset: it trails
// opposite the velocity and grows with height, length-clamped to lagMaxM.
fn fireLag(vel: vec3<f32>, h: f32, lag: f32, lagMaxM: f32) -> vec3<f32> {
  var off = -vel * (lag * h);
  let len = length(off);
  if (len > lagMaxM) { off = off * (lagMaxM / max(len, 1e-6)); }
  return off;
}

// Below the flame's length envelope: 1 at the capsule, 0 at one rise above.
fn fireFalloff(u: f32) -> f32 {
  let k = clamp(1.0 - u, 0.0, 1.0);
  return k * k;
}

// Soot: the same radial falloff, but only above 0.4 * rise and fading out by
// sootRise. The radial denominator grows with height (spread metres of width
// per metre of height), so the column widens as it rises instead of staying a
// pencil.
fn fireSoot(d: f32, h: f32, rise: f32, sootRise: f32, spread: f32) -> f32 {
  let wide = 0.15 + spread * max(h - 0.4 * rise, 0.0);
  let radial = exp(-max(d, 0.0) / max(wide, 1e-3));
  let start = 0.4 * rise;
  let lo = smoothstep(start, start + 0.25 * rise + 1e-3, h);
  let hi = 1.0 - smoothstep(sootRise * 0.55, max(sootRise, start + 1e-3), h);
  return radial * lo * hi;
}

// The Blood palette: dark red -> orange -> yellow.
fn fireRamp(temp: f32) -> vec3<f32> {
  let x = clamp(temp, 0.0, 1.0);
  let c0 = vec3<f32>(0.45, 0.04, 0.0);
  let c1 = vec3<f32>(1.0, 0.32, 0.03);
  let c2 = vec3<f32>(1.0, 0.62, 0.12);
  let c3 = vec3<f32>(1.0, 0.9, 0.55);
  if (x < 0.4) { return mix(c0, c1, x / 0.4); }
  if (x < 0.75) { return mix(c1, c2, (x - 0.4) / 0.35); }
  return mix(c2, c3, (x - 0.75) / 0.25);
}

fn fireSdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let denom = max(dot(ba, ba), 1e-9);
  let h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  return length(pa - ba * h);
}

// Value noise: the hash is iq's sin-free fract form (deterministic in WGSL,
// where sin() precision varies), and the fbm is 3 octaves -- enough to tear a
// flame edge into licks without paying for a fourth fetch per sample.
fn fireHash(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

fn fireNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = fireHash(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = fireHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = fireHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = fireHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = fireHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = fireHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = fireHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = fireHash(i + vec3<f32>(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn fireFbm(p: vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  // Each octave is ROTATED as well as scaled (the classic fbm trick, and what
  // the wildfire teardown's rotated noise copies do): value noise stretched
  // along y otherwise lines up with its own lattice and reads as diagonal
  // stripes up close.
  let m = mat3x3<f32>(
    vec3<f32>(0.00, 0.80, 0.60),
    vec3<f32>(-0.80, 0.36, -0.48),
    vec3<f32>(-0.60, -0.48, 0.64));
  var q = p + vec3<f32>(0.37, 0.11, 0.73);
  for (var o: i32 = 0; o < 3; o = o + 1) {
    v = v + a * fireNoise(q);
    q = (m * q) * 2.03;
    a = a * 0.5;
  }
  // Normalise to 0..1. The raw sum peaks at 0.875 (0.5 + 0.25 + 0.125), and
  // without this the erosion term can never reach the shape's core value of 1,
  // so the flame can only dim, never tear.
  return v * 1.142857;
}

// Flame scroll speed (m/s the erosion tears climb) and the flame's extinction
// per unit density (per metre): ~10 cm of full-density flame is ~94% opaque,
// so a sheet hides the body behind it and the gaps between tongues show it.
const FIRE_FLAME_SPEED: f32 = 1.4;
const FIRE_FLAME_SIGMA: f32 = 28.0;

fn fireIgn(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}`;

/**
 * The resolve. Runs at the MARCH resolution now (round 2b): the field is
 * low-frequency, so a full-res resolve bought nothing but pixels and the
 * composite's bilinear upsample carries the detail. cfg = (history, reset,
 * near, far): reset > 0.5 skips the history for one frame (a camera jump or a
 * tuning change), history is the blend weight. The history is sampled through
 * the PREVIOUS view-projection and clamped to a 3x3 neighbourhood of the
 * current frame, so a reprojection miss cannot smear.
 */
export const FIRE_VOLUME_RESOLVE_WGSL = /* wgsl */ `fn fireVolumeResolve(
  fireTex: texture_2d<f32>,
  fireSamp: sampler,
  histTex: texture_2d<f32>,
  histSamp: sampler,
  depthTex: texture_depth_2d,
  invViewProj: mat4x4<f32>,
  prevViewProj: mat4x4<f32>,
  texCoord: vec2<f32>,
  cfg: vec4<f32>
) -> vec4<f32> {
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let cur = textureSampleLevel(fireTex, fireSamp, tc, 0.0);
  if (cfg.y > 0.5) { return cur; }

  // 3x3 min/max of the CURRENT field, in the low-res grid.
  let texel = 1.0 / max(vec2<f32>(textureDimensions(fireTex, 0)), vec2<f32>(1.0, 1.0));
  var mn = cur;
  var mx = cur;
  for (var j: i32 = -1; j <= 1; j = j + 1) {
    for (var i: i32 = -1; i <= 1; i = i + 1) {
      let s = textureSampleLevel(fireTex, fireSamp, tc + vec2<f32>(f32(i), f32(j)) * texel, 0.0);
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }

  // Reproject the previous frame through the scene depth.
  let dDims = vec2<f32>(textureDimensions(depthTex, 0));
  let dMax = vec2<i32>(dDims) - vec2<i32>(1, 1);
  let pix = clamp(vec2<i32>(floor(tc * dDims)), vec2<i32>(0, 0), dMax);
  let depth = textureLoad(depthTex, pix, 0);
  let ndc = vec2<f32>(tc.x * 2.0 - 1.0, 1.0 - tc.y * 2.0);
  let wp4 = invViewProj * vec4<f32>(ndc, depth, 1.0);
  let world = wp4.xyz / max(wp4.w, 1e-6);
  let prevClip = prevViewProj * vec4<f32>(world, 1.0);
  if (prevClip.w <= 1e-5) { return cur; }
  let prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
  // Out of the previous frustum: no history to trust.
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) { return cur; }
  // The history target shares the capture orientation, so flip the (y-up)
  // reprojected uv back to the top-left sampling convention.
  let histUv = vec2<f32>(prevUv.x, 1.0 - prevUv.y);
  let hist = textureSampleLevel(histTex, histSamp, histUv, 0.0);
  return mix(cur, clamp(hist, mn, mx), clamp(cfg.x, 0.0, 0.97));
}`;

/**
 * The composite, full-res. It reads ONLY the low-res resolved field and returns
 * vec4(emission, T); the draw's CustomBlending (color: One for src, SrcAlpha
 * for dst) turns the capture target into `emission + scene * T` in place. That
 * is what removes round 2's separate full-res composite target and its copy
 * draw: the pass never samples the target it writes, so the WebGPU rule holds.
 */
export const FIRE_VOLUME_COMPOSITE_WGSL = /* wgsl */ `fn fireVolumeComposite(
  fireTex: texture_2d<f32>,
  fireSamp: sampler,
  texCoord: vec2<f32>
) -> vec4<f32> {
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let fire = textureSampleLevel(fireTex, fireSamp, tc, 0.0);
  // The blend does the scene multiply: src = emission, srcAlpha = T.
  return vec4<f32>(fire.rgb, fire.a);
}`;
