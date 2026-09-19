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

  for (var s: i32 = 0; s < steps; s = s + 1) {
    let p = origin + rayDir * t;
    // The curl warp is a property of the sample point, not of one capsule, and
    // a 3D texture fetch is the march's dominant cost: fetch it ONCE per
    // sample and share it across the capsule loop (the per-capsule lag still
    // moves each capsule's own distance field).
    let curlUvw = p * cfg0.w + vec3<f32>(0.0, -cfg2.z * cfg0.y, 0.0);
    let curl = fireCurl(curlTex, curlSamp, curlUvw);
    let cv = curl * cfg1.x;
    let qw = p + cv;
    // FLAME-SPACE NOISE. stretch (< 1) squashes the y frequency so features
    // are vertically elongated; the y term scrolls DOWN over time at the flame
    // speed, which makes the features RISE (the same convention as curlUvw).
    var fq = (qw - base) * vec3<f32>(freq, freq * stretch, freq);
    fq.y = fq.y - cfg2.z * rise * freq * stretch;
    let erosion = fireFbm(fq);
    // Smoke billows on a larger, stronger-advected copy of the same field
    // (1.7x curl, 0.6x frequency), so the column churns more than the flame.
    var smokeFq = (p + cv * 1.7 - base) * vec3<f32>(freq * 0.6, freq * stretch * 0.6, freq * 0.6);
    smokeFq.y = smokeFq.y - cfg2.z * rise * freq * stretch * 0.6;
    let smokeErosion = fireFbm(smokeFq);

    var shape = 0.0;
    var soot = 0.0;
    var glow = 0.0;
    for (var i: i32 = 0; i < capsuleCount; i = i + 1) {
      let rec0 = (*caps)[i * 3];
      let rec1 = (*caps)[i * 3 + 1];
      let rec2 = (*caps)[i * 3 + 2];
      let a = rec0.xyz;
      let radius = rec0.w;
      let b = rec1.xyz;
      let burn = rec1.w;
      let top = max(a.y, b.y);
      let h = max(0.0, p.y - top);
      if (h > sootRise) { continue; }
      let lag = fireLag(rec2.xyz, h, cfg1.y, cfg1.z);
      // Flame core: the capsule distance with a tight core radius.
      let d = fireSdCapsule(qw - lag, a, b) - radius;
      shape = max(shape, burn * saturate(exp(-max(d, 0.0) / coreR) * fireFalloff(h / rise)));
      // Smoke: its OWN stronger curl advection and a radial envelope that
      // widens with height, so the column spreads as it rises.
      let dS = fireSdCapsule(p + cv * 1.7 - lag, a, b) - radius;
      let sootShape = fireSoot(dS, h, rise, sootRise, smokeSpread);
      soot = soot + burn * sootShape * (0.35 + 1.1 * smokeErosion);
      // The fire's light from below, as a function of height above the top.
      glow = max(glow, burn * exp(-max(h - 0.15 * rise, 0.0) / (0.45 * rise)));
    }
    // EROSION: solid at the source (erodeAmt ~ 0), torn into licks above it.
    // MULTIPLICATIVE: a multiplicative tear keeps the flame's thickness while
    // punching holes where the noise is high. A subtractive (shape - erode)
    // form collapses the whole falloff to a thin shell at the erode values
    // tongues need — round 2b's first two captures showed exactly that (a
    // mottled bodysuit, no gaps).
    let hErode = max(0.0, p.y - base.y);
    let erodeAmt = erode * smoothstep(0.0, rise * erodeRise, hErode);
    let density = saturate(shape * saturate(1.0 - erosion * erodeAmt) * edgeSharp);
    // Temperature for the ramp: density cooled with height, so bases go
    // yellow-white and tips go dark red.
    let cool = fireFalloff(hErode / (rise * 1.35));
    let temp = density * cool;
    // The heat gate kills the shape's exp tail along a long AABB path (round 2's
    // solid-orange-wall bug), and the density term self-absorbs the core. It is
    // SOFT here (round 2b): a hard gate clipped the eroded flame's outer falloff
    // to a thin bright shell, which is the "mottled bodysuit" the plan set out
    // to fix. The erosion already removes the tail where it matters.
    let heat = smoothstep(0.02, 0.14, temp);
    emission = emission + T * fireRamp(temp) * heat * cfg1.w * stepM;
    // SMOKE SCATTERS. Round 2 only darkened through T; an albedo lit by ambient
    // grey plus the fire glow is what makes the column visible at all. The
    // inscatter is gated by sootGain (clamped to 1) as well as the extinction,
    // so sootGain 0 is a true smoke-off switch — the look metric's twin.
    let smokeGain = clamp(cfg2.x, 0.0, 1.0);
    let inscatter = soot * smokeGain * smokeAlbedo * (smokeAmbient * ambientCol + smokeFireLit * glow * fireLitCol);
    emission = emission + T * inscatter * stepM;
    T = T * exp(-(soot * cfg2.x + density * 1.4) * stepM);
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
  let c0 = vec3<f32>(0.35, 0.03, 0.0);
  let c1 = vec3<f32>(1.0, 0.35, 0.05);
  let c2 = vec3<f32>(1.0, 0.85, 0.4);
  if (x < 0.5) { return mix(c0, c1, x / 0.5); }
  return mix(c1, c2, (x - 0.5) / 0.5);
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
  var q = p;
  for (var o: i32 = 0; o < 3; o = o + 1) {
    v = v + a * fireNoise(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  // Normalise to 0..1. The raw sum peaks at 0.875 (0.5 + 0.25 + 0.125), and
  // without this the erosion term can never reach the shape's core value of 1,
  // so the flame can only dim, never tear.
  return v * 1.142857;
}

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
