// src/lab/sdf-zombie/webgpu/march/math.wgsl.ts
//
// Hash, value noise, fbm and the quaternion helpers — split out of
// march.wgsl.ts (phase 1, move-only). Each string is a WGSL helper that
// begins with `fn` (three's wgslFn parse contract).

export const HASH13 = /* wgsl */ `fn hash13(pIn: vec3<f32>) -> f32 {
  var p = fract(pIn * 0.1031);
  p = p + dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}`;

export const NOISE3 = /* wgsl */ `fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n = mix(
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 0.0)), hash13(i + vec3<f32>(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 0.0)), hash13(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 1.0)), hash13(i + vec3<f32>(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 1.0)), hash13(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}`;

export const FBM = /* wgsl */ `fn fbm(p: vec3<f32>) -> f32 {
  return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3;
}`;

// Body-local noise frame (motion-polish): translate by the root shift, then
// UNDO the body's applied yaw (packed into ns.y — the y shift is structurally
// zero, see setRootShift) so the noise field wraps the character and turns
// with it instead of the body rotating under a world-fixed texture.
export const NOISE_LOCAL = /* wgsl */ `fn noiseLocal(p: vec3<f32>, ns: vec3<f32>) -> vec3<f32> {
  let dp = vec3<f32>(p.x - ns.x, p.y, p.z - ns.z);
  let ch = cos(ns.y);
  let sh = sin(ns.y);
  return vec3<f32>(dp.x * ch - dp.z * sh, dp.y, dp.x * sh + dp.z * ch);
}`;

// Quaternion triple for the REST-FRAME noise anchor (motion-polish task 6).
// qRot mirrors qRotate in vec.ts (v + 2w(u x v) + 2(u x (u x v))); qMulQ is
// the Hamilton product with vec.qMul's convention — qMulQ(a, b) applies b
// FIRST. qFromToV is the shortest-arc quat taking unit vector u onto v in the
// cheap half-angle form (cross, 1+d) — the same ROTATION as vec.qFromTo's
// acos form, cheaper; the CPU mirror (validate.restSpacePoint) uses this form
// too so the two stay in step.
export const Q_ROT = /* wgsl */ `fn qRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + t * q.w + cross(q.xyz, t);
}`;

export const Q_MUL = /* wgsl */ `fn qMulQ(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}`;

export const Q_FROM_TO = /* wgsl */ `fn qFromToV(u: vec3<f32>, v: vec3<f32>) -> vec4<f32> {
  let d = clamp(dot(u, v), -1.0, 1.0);
  if (d >= 0.999999) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (d <= -0.999999) {
    // Anti-parallel: any perpendicular axis gives the half turn.
    var seed = vec3<f32>(1.0, 0.0, 0.0);
    if (abs(u.x) >= 0.9) { seed = vec3<f32>(0.0, 1.0, 0.0); }
    return vec4<f32>(normalize(cross(u, seed)), 0.0);
  }
  return normalize(vec4<f32>(cross(u, v), 1.0 + d));
}`;
