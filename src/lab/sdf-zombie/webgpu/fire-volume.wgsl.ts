// src/lab/sdf-zombie/webgpu/fire-volume.wgsl.ts
//
// THE VOLUMETRIC FIRE + SMOKE FIELD (burning-feedback round 2, task 4c). The
// wildfire architecture: a low-res raymarch over a handful of analytic capsules
// per burning body, warped by the shared curl volume, stopped at the scene
// depth, then a full-res resolve that reprojects and clamps a temporal history.
// The fire is composited under the crisp flame cards, which stay as accents.
//
// THREE SEPARATE PASSES, each its own WGSL entry:
//   march     low-res target (rgba16f): emission rgb, transmittance a.
//   resolve   full-res: bilinear upsample + temporal reprojection with a 3x3
//             neighbourhood min/max clamp. Writes the FIELD only (emission, T)
//             so the history is never scene-contaminated.
//   composite full-res: scene * T + emission, read from the capture and written
//             to its own target (never the target it samples).
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

  for (var s: i32 = 0; s < steps; s = s + 1) {
    let p = origin + rayDir * t;
    // The curl warp is a property of the sample point, not of one capsule, and
    // a 3D texture fetch is the march's dominant cost: fetch it ONCE per
    // sample and share it across the capsule loop (the per-capsule lag still
    // moves each capsule's own distance field).
    let curlUvw = p * cfg0.w + vec3<f32>(0.0, -cfg2.z * cfg0.y, 0.0);
    let cv = fireCurl(curlTex, curlSamp, curlUvw) * cfg1.x;
    var temp = 0.0;
    var soot = 0.0;
    for (var i: i32 = 0; i < capsuleCount; i = i + 1) {
      let base = i * 3;
      let rec0 = (*caps)[base];
      let rec1 = (*caps)[base + 1];
      let rec2 = (*caps)[base + 2];
      let a = rec0.xyz;
      let radius = rec0.w;
      let b = rec1.xyz;
      let burn = rec1.w;
      let top = max(a.y, b.y);
      let h = max(0.0, p.y - top);
      if (h > cfg0.z) { continue; }
      let q = p - fireLag(rec2.xyz, h, cfg1.y, cfg1.z) + cv;
      let d = fireSdCapsule(q, a, b) - radius;
      temp = temp + burn * exp(-max(d, 0.0) / 0.08) * fireFalloff(h / rise);
      soot = soot + burn * fireSoot(d, h, rise, cfg0.z);
    }
    emission = emission + T * fireRamp(temp) * cfg1.w * stepM;
    T = T * exp(-soot * cfg2.x * stepM);
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
// sootRise, so smoke reads as a dark column above the heat rather than tint.
fn fireSoot(d: f32, h: f32, rise: f32, sootRise: f32) -> f32 {
  let radial = exp(-max(d, 0.0) / 0.15);
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

fn fireIgn(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}`;

/**
 * The resolve. cfg = (history, reset, near, far): reset > 0.5 skips the history
 * for one frame (a camera jump or a tuning change), history is the blend weight.
 * The history is sampled through the PREVIOUS view-projection and clamped to a
 * 3x3 neighbourhood of the current frame, so a reprojection miss cannot smear.
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
 * The composite: scene * T + emission, premultiplied. Reads the capture and the
 * resolved field, writes its OWN target (the copy draw lands it in the capture)
 * so no pass ever samples the target it writes.
 */
export const FIRE_VOLUME_COMPOSITE_WGSL = /* wgsl */ `fn fireVolumeComposite(
  sceneTex: texture_2d<f32>,
  fireTex: texture_2d<f32>,
  fireSamp: sampler,
  texCoord: vec2<f32>
) -> vec4<f32> {
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let sDims = vec2<f32>(textureDimensions(sceneTex, 0));
  let sMax = vec2<i32>(sDims) - vec2<i32>(1, 1);
  let sp = clamp(vec2<i32>(floor(tc * sDims)), vec2<i32>(0, 0), sMax);
  let scene = textureLoad(sceneTex, sp, 0).rgb;
  let fire = textureSampleLevel(fireTex, fireSamp, tc, 0.0);
  // Smoke darkens through T, fire adds through emission.
  return vec4<f32>(scene * fire.a + fire.rgb, 1.0);
}`;
