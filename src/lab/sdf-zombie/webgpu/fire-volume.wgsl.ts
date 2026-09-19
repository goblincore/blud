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
//   * NO SMOKE (2026-09-19, owner call). Round 2b's lit smoke column was the
//     volume's biggest reach and cost; smoke will come from a cheaper effect.
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
 * cfg0 = (steps, rise, unused, curlScale)
 * cfg1 = (curlStrength, lag, lagMaxM, tempGain)
 * cfg2 = (unused, capsuleCount, time, frame)
 * cfg4 = (noiseScale, noiseStretch, erode, erodeRise)
 * cfg5 = (edgeSharp, coreR, density, skin)
 * cfg6 = (headClear, headRise, unused x2; kept so the binding list is unchanged)
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
  var emission = vec3<f32>(0.0);
  var T = 1.0;
  let capsuleCount = i32(cfg2.y + 0.5);
  let rise = max(cfg0.y, 1e-3);
  let freq = max(cfg4.x, 1e-3);
  let stretch = clamp(cfg4.y, 0.05, 4.0);
  let erode = clamp(cfg4.z, 0.0, 4.0);
  let erodeRise = max(cfg4.w, 1e-3);
  let edgeSharp = max(cfg5.x, 0.01);
  let coreR = max(cfg5.y, 1e-3);
  // Opacity scale on the flame's extinction: < 1 lets the body's form read
  // through the fire (owner: at 1 the flame is too thick to see the body).
  let densityK = max(cfg5.z, 0.0);
  // How much flame COATS the body surface itself (the sheet's base, u ~ 0).
  // < 1 leaves the body's form readable as a dark shape with the flame
  // streaming up and off it; the SDF surface fire still burns on the skin.
  let skin = clamp(cfg5.w, 0.0, 1.0);
  // Flame strength left within ~15 cm of a HEAD capsule (pad < 0), from every
  // limb's sheet: the shoulders' flame otherwise sweeps up over the face.
  let headClear = clamp(cfg6.x, 0.0, 1.0);
  // The head's sheet-length scale (headRise), also the ceiling over the head.
  let headRiseK = cfg6.y;
  // The flame-space origin is the field's AABB corner, so the tongues travel
  // WITH the body instead of the body swimming through a world-locked field.
  let base = boundsMin.xyz;

  // PER-RAY CULLING. The AABB spans every burner, so in a room of burning
  // bodies most of it is empty and every sample would loop over all capsules.
  // Test the ray against a small sphere per capsule (the limb, its flame sheet,
  // the shell, wobble and lag), keep the ones it crosses (up to
  // FIRE_RAY_CAPS), and march only the union of their intervals. A ray between
  // two burners costs nothing; each sample loops over the few capsules that
  // can reach it. (Smoke was removed from the volume, 2026-09-19: its 2.5 m
  // reach on every limb made every sphere huge and defeated this cull.)
  let lagPad = cfg1.x + cfg1.z;
  var hitIdx: array<i32, FIRE_RAY_CAPS>;
  var hitN = 0;
  var tMin = tFar;
  var tMax = tNear;
  for (var i: i32 = 0; i < capsuleCount; i = i + 1) {
    let r0 = (*caps)[i * 3];
    let r1 = (*caps)[i * 3 + 1];
    if (r1.w <= 0.0) { continue; }
    // Per-capsule sheet length: the pack's pad slot scales rise (the head and
    // its crown burn shorter, headRise).
    let riseC = max(rise * abs((*caps)[i * 3 + 2].w), 1e-3);
    let fc = (r0.xyz + r1.xyz) * 0.5 + vec3<f32>(0.0, riseC * 0.5, 0.0);
    let fR = length(r1.xyz - r0.xyz) * 0.5 + r0.w + coreR + lagPad + riseC * 0.5;
    let fi = fireRaySphere(origin, rayDir, fc, fR, tNear, tFar);
    if (fi.y > fi.x) {
      if (hitN < FIRE_RAY_CAPS) { hitIdx[hitN] = i; }
      hitN = hitN + 1;
      tMin = min(tMin, fi.x);
      tMax = max(tMax, fi.y);
    }
  }
  if (hitN == 0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  // Overflow falls back to the full list for that ray (correct, just slower).
  let flameAll = hitN > FIRE_RAY_CAPS;
  let flameN = select(hitN, capsuleCount, flameAll);
  let stepM = (tMax - tMin) / f32(steps);
  var t = tMin + fireIgn(ppx) * stepM;

  // EMPTY-SPACE SKIPPING: stepM is the FINE step, taken only where there is
  // flame; elsewhere the step grows with the distance to the nearest flame
  // shell (capped at 6 fine steps), so empty stretches of the culled interval
  // cost a handful of samples instead of all of them. The loop bound is a cap.
  for (var s: i32 = 0; s < steps * 2; s = s + 1) {
    if (t > tMax) { break; }
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
    var minOut = 1e6;
    // HEAD PASS: the nearest head capsule (pad < 0) in plan view and the
    // distance to it (headClear). Needed BEFORE the flame loop, which
    // shortens every sheet over the head column.
    var dHead = 1e6;
    var colR = 1e6;
    for (var j: i32 = 0; j < flameN; j = j + 1) {
      let i = select(hitIdx[min(j, FIRE_RAY_CAPS - 1)], j, flameAll);
      let pad = (*caps)[i * 3 + 2].w;
      if (pad >= 0.0) { continue; }
      let r0 = (*caps)[i * 3];
      let r1 = (*caps)[i * 3 + 1];
      dHead = min(dHead, fireSdCapsule(qw, r0.xyz, r1.xyz) - r0.w);
      let cr = length(qw.xz - (r0.xz + r1.xz) * 0.5);
      colR = min(colR, cr);
    }
    // Over the head column every limb's sheet is SHORTENED (owner: the flame
    // straight above the head was too tall). Its length is SCALED by headRise
    // rather than ended at one shared height (that lined every tip up on one
    // horizontal line and read as clipped), and the scale wobbles with the
    // curl field (+-35 %, in space and time) so the tips end at scattered,
    // flickering heights. The sheet's own taper brings each to a point.
    let headCol = 1.0 - smoothstep(0.15, 0.45, colR);
    // The wobble scales with the shrink itself, so headRise 1 is exactly OFF.
    let hk = clamp(abs(headRiseK), 0.0, 1.0);
    let headShrink = mix(1.0, clamp(hk * (1.0 + 0.35 * (1.0 - hk) * curl.y), 0.05, 1.0), headCol);
    for (var j: i32 = 0; j < flameN; j = j + 1) {
      let i = select(hitIdx[min(j, FIRE_RAY_CAPS - 1)], j, flameAll);
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
      let riseFull = max(rise * abs(rec2.w), 1e-3);
      let riseC = max(riseFull * headShrink, 1e-3);
      if (sRaw > riseC + coreR) { continue; }
      let sH = clamp(sRaw, 0.0, riseC);
      let u = sH / riseC;
      let lag = fireLag(rec2.xyz, sH, cfg1.y, cfg1.z);
      let q2 = qw - lag - vec3<f32>(0.0, sH, 0.0);
      // Taper: the sheet narrows as it climbs, and the shell it lives in
      // thins with it, so tongues come to points instead of ending in slabs.
      let dd = fireSdCapsule(q2, a, b) - radius * (1.0 - 0.55 * u);
      let w = coreR * (1.0 - 0.7 * u);
      let env = burn * saturate(1.0 - max(dd, 0.0) / max(w, 1e-3)) * (1.0 - u * u)
        * mix(skin, 1.0, smoothstep(0.0, 0.3, u));
      if (env > shape) { shape = env; uBest = u; }
      minOut = min(minOut, max(dd - w, 0.0));
    }
    shape = shape * mix(headClear, 1.0, smoothstep(0.0, 0.15, dHead));
    let dtFine = stepM;
    if (shape < 1e-3) {
      // Nothing here: skip toward the nearest flame shell. The swept field is
      // not an exact distance, so only half of it is trusted.
      t = t + clamp(minOut * 0.5, stepM, stepM * 6.0);
      continue;
    }
    // FLAME-SPACE NOISE, only where there is flame: vertically stretched and
    // scrolling UP at the flame speed, so the tears climb the tongues.
    // Contrast: a 3-octave value fbm lives in ~0.3..0.7, so stretch it to the
    // full 0..1 or the erosion can only dim the flame, never cut a gap in it.
    var fq = (qw - base) * vec3<f32>(freq, freq * stretch, freq);
    fq.y = fq.y - cfg2.z * FIRE_FLAME_SPEED * freq * stretch;
    let erosion = smoothstep(0.3, 0.7, fireFbm(fq));
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
    let alphaF = 1.0 - exp(-density * FIRE_FLAME_SIGMA * densityK * dtFine);
    emission = emission + T * fireRamp(temp) * alphaF * cfg1.w;
    T = T * (1.0 - alphaF);
    if (T < 0.003) { break; }
    t = t + stepM;
  }
  return vec4<f32>(emission, T);
}

// The shared curl volume decode: rgb * 2 - 1, the curl-volume-node contract.
// Ray vs sphere, clipped to [tLo, tHi]: returns (t0, t1); t1 <= t0 is a miss.
fn fireRaySphere(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: f32, tLo: f32, tHi: f32) -> vec2<f32> {
  let oc = o - c;
  let bq = dot(oc, d);
  let disc = bq * bq - (dot(oc, oc) - r * r);
  if (disc <= 0.0) { return vec2<f32>(1.0, 0.0); }
  let sq = sqrt(disc);
  return vec2<f32>(max(-bq - sq, tLo), min(-bq + sq, tHi));
}

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
// Capsules one ray may keep after culling (one body is <= 16; two overlapping
// bodies fit). More than this falls back to the full list for that ray.
const FIRE_RAY_CAPS: i32 = 32;
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
