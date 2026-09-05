import { wgslFn } from 'three/tsl';

// Local diagnostic validity. The declaration follows the first function
// because three's wgslFn parser requires every source to start at fn.
const NG_STATE = /* wgsl */ `fn ngReset() -> f32 {
  gNgReason = 0;
  return 0.0;
}
var<private> gNgReason: i32;
`;

const NG_Q_ROT = /* wgsl */ `fn ngQRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + t * q.w + cross(q.xyz, t);
}`;

const NG_CAPSULE = /* wgsl */ `fn ngCapsule(
  p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r: f32,
  scale: vec3<f32>
) -> vec4<f32> {
  if (any(scale <= vec3<f32>(0.0))) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let invScale = 1.0 / scale;
  let q = p * invScale;
  let aa = a * invScale;
  let bb = b * invScale;
  let ab = bb - aa;
  let ap = q - aa;
  let ab2 = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
  let v = q - (aa + ab * t);
  let vLen = length(v);
  let minScale = min(scale.x, min(scale.y, scale.z));
  let d = (vLen - r) * minScale;
  if (vLen < 1e-9) {
    if (gNgReason == 0) { gNgReason = 2; }
    return vec4<f32>(d, 0.0, 0.0, 0.0);
  }
  return vec4<f32>(d, (v / vLen) * invScale * minScale);
}`;

const NG_CAPSULE_ORIENTED = /* wgsl */ `fn ngCapsuleOriented(
  p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r: f32,
  scale: vec3<f32>,
  quat: vec4<f32>
) -> vec4<f32> {
  let quatLen2 = dot(quat, quat);
  if (abs(quatLen2 - 1.0) > 1e-3) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let mid = (a + b) * 0.5;
  let invQuat = vec4<f32>(-quat.xyz, quat.w);
  let local = ngCapsule(
    mid + ngQRot(invQuat, p - mid),
    mid + ngQRot(invQuat, a - mid),
    mid + ngQRot(invQuat, b - mid),
    r,
    scale);
  return vec4<f32>(local.x, ngQRot(quat, local.yzw));
}`;

const NG_SMIN = /* wgsl */ `fn ngSmin(
  a: vec4<f32>,
  b: vec4<f32>,
  kIn: f32
) -> vec4<f32> {
  let K = kIn * 4.0;
  if (K <= 0.0) {
    if (a.x == b.x) {
      if (gNgReason == 0) { gNgReason = 3; }
      return vec4<f32>(a.x, 0.0, 0.0, 0.0);
    }
    return select(b, a, a.x < b.x);
  }
  let h = max(K - abs(a.x - b.x), 0.0) / K;
  let wa = select(h * 0.5, 1.0 - h * 0.5, a.x <= b.x);
  return vec4<f32>(min(a.x, b.x) - h * h * K * 0.25,
                   wa * a.yzw + (1.0 - wa) * b.yzw);
}`;

const NG_SMAX = /* wgsl */ `fn ngSmax(
  a: vec4<f32>,
  b: vec4<f32>,
  kIn: f32
) -> vec4<f32> {
  let folded = ngSmin(-a, -b, kIn);
  return -folded;
}`;

/** Dependency order is load-bearing; each registered helper includes only its predecessor. */
export const NORMAL_GRADIENT_HELPERS = [
  NG_STATE,
  NG_Q_ROT,
  NG_CAPSULE,
  NG_CAPSULE_ORIENTED,
  NG_SMIN,
  NG_SMAX,
] as const;

/** Isolated diagnostic entry. kind selects capsule, oriented capsule, min, max, or unsupported. */
export const NORMAL_GRADIENT_PROBE = /* wgsl */ `fn ngProbe(
  p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r: f32,
  scale: vec3<f32>,
  quat: vec4<f32>,
  dgA: vec4<f32>,
  dgB: vec4<f32>,
  kIn: f32,
  kind: f32,
  reasonPass: f32,
  negateX: f32
) -> vec4<f32> {
  let resetMarker = ngReset();
  var result = vec4<f32>(0.0);
  if (kind < 0.5) {
    result = ngCapsule(p, a, b, r, scale);
  } else if (kind < 1.5) {
    result = ngCapsuleOriented(p, a, b, r, scale, quat);
  } else if (kind < 2.5) {
    result = ngSmin(dgA, dgB, kIn);
  } else if (kind < 3.5) {
    result = ngSmax(dgA, dgB, kIn);
  } else if (kind < 4.5) {
    result = ngSmin(ngCapsule(p, a, b, r, scale), dgB, kIn);
  } else {
    gNgReason = 1;
  }
  if (reasonPass > 0.5) {
    return vec4<f32>(f32(gNgReason), 0.0, 0.0, 1.0);
  }
  if (negateX > 0.5) {
    result = vec4<f32>(result.x, -result.y, result.z, result.w);
  }
  return result + vec4<f32>(resetMarker);
}`;

/** Register an entry with the complete helper chain exactly once. */
export function buildNormalGradientFn(source: string): ReturnType<typeof wgslFn> {
  const nodes = NORMAL_GRADIENT_HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, helper) => [...acc, wgslFn(helper, acc.slice(-1))],
    [],
  );
  return wgslFn(source, nodes.slice(-1));
}
