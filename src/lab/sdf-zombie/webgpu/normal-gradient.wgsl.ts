import { wgslFn } from 'three/tsl';
import {
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_QUAT,
  ROW_CLUSTER_RANGE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_GROUPS,
  ROW_GROUP_RANGE, ROW_GROUP_BOUNDS, ROW_WOUND,
} from './march.wgsl';
import { TILE_MAX_ENTRIES } from './tile-cull';

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

// Game integration is registered AFTER the scalar helpers, only for march.
// It has no writes to production gFold* owner/hit metadata.
const NG_EXCLUDED = /* wgsl */ `fn ngExcluded(p: vec3<f32>, bounds: vec4<f32>, grp: vec4<f32>, data: texture_2d<f32>, band: i32) -> f32 {
  // The enclosing sphere minus R contains the entire stencil. OUTSIDE it,
  // each supported capsule's field is >= Euclidean exterior / distortion.
  // Inside an enclosing sphere no lower field bound follows from that sphere.
  let exterior = length(p - bounds.xyz) - bounds.w - 0.002598076211;
  let lower = select(-1e9, exterior / max(grp.z, 1.0), exterior > 0.0);
  gNgExcluded = min(gNgExcluded, lower);
  // Bounds of unsupported profiles do not carry a proven field/Lipschitz
  // relationship here. Do not bless an unsupported skipped contributor.
  if ((i32(grp.w + 0.5) & 2) != 0) {
    for (var i = 0; i < i32(grp.y); i = i + 1) {
      let idx = i32(grp.x) + i;
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
      if (S.w > 0.5) { continue; }
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; }
    }
  }
  return lower;
}
var<private> gNgBest: f32;
var<private> gNgSecond: f32;
var<private> gNgOwner: i32;
var<private> gNgExcluded: f32;
`;

const NG_GROUP = /* wgsl */ `fn ngGroup(dIn: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32>) -> vec4<f32> {
  var d = dIn;
  if (length(p - bounds.xyz) - bounds.w > (d.x + counts.w * 4.0) * grp.z) {
    let excluded = ngExcluded(p, bounds, grp, data, band);
    return d;
  }
  let flags = i32(grp.w + 0.5);
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= i32(grp.y)) { break; }
    let idx = i32(grp.x) + i;
    if (idx >= i32(counts.x)) { break; }
    let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
    if (S.w > 0.5) { continue; }
    if ((flags & 2) != 0) {
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      // Metal is bit 16 and has no geometric effect. All other profiles,
      // including strand bit 32, are unsupported in the intact phase.
      if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
    }
    let A = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_A} + band), 0);
    let B = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + band), 0);
    var dg = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
    if ((flags & 1) != 0) {
      let O = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_QUAT} + band), 0);
      // Production leaves near-identity quaternions untouched too.
      if (abs(1.0 - O.w) > 1e-6) { dg = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
    }
    if (dg.x < gNgBest) {
      gNgSecond = gNgBest;
      gNgBest = dg.x;
      gNgOwner = idx;
    } else { gNgSecond = min(gNgSecond, dg.x); }
    d = ngSmin(d, dg, B.w);
  }
  return d;
}`;

export const NG_BODY = /* wgsl */ `fn ngBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32>) -> vec4<f32> {
  let resetMarker = ngReset();
  gNgBest = 1e9;
  gNgSecond = 1e9;
  gNgOwner = -1;
  gNgExcluded = 1e9;
  var d = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  if (volumePose0.w > 0.5) { gNgReason = 6; return d; }
  if (counts2.y > 0.5) { gNgReason = 1; return d; }
  // The wound early-out defines the actual production support. Expand its
  // union and individual spheres by the FULL tetrahedron radius, not eps.
  // Without the per-wound early-out, the Gaussian tail has unbounded support.
  let R = 0.002598076211;
  if (woundCfg.x > 0.5 && length(p - woundBound.xyz) <= woundBound.w + R) {
    if (perfCfg.y <= 0.5) { gNgReason = 5; return d; }
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= i32(woundCfg.x)) { break; }
      let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
      let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;
      if (length(p - w.xyz) <= reach + R) { gNgReason = 5; return d; }
    }
  }
  if (gTileActive > 0.5) {
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      // The per-view field uses band zero. Foreign atlas entries require a
      // separate rest-frame/owner contract; do not silently mis-anchor them.
      if (gTileBand[e] != 0.0) { gNgReason = 1; return d; }
      d = ngGroup(d, p, data, counts, 0, gTileBounds[e], gTileGrp[e]);
    }
  }
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= i32(counts.y)) { break; }
    let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0);
    let gspan = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS}), 0);
    let clusterSkipped = length(p - cbounds.xyz) - cbounds.w > (d.x + counts.w * 4.0) * gspan.z;
    for (var gi = 0; gi < 64; gi = gi + 1) {
      if (gi >= i32(gspan.y)) { break; }
      let g = i32(gspan.x) + gi;
      let grp = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_RANGE}), 0);
      let bounds = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_BOUNDS}), 0);
      if (gTileActive > 0.5) {
        var listed = false;
        for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
          if (f32(e) >= gTileN) { break; }
          if (gTileGrp[e].x == grp.x && gTileBand[e] == 0.0) { listed = true; break; }
        }
        // Tile culling is not itself a stencil-owner certificate. Explicitly
        // include omitted candidates via their group bounds at this hit.
        if (!listed) { let excluded = ngExcluded(p, bounds, grp, data, 0); }
      } else if (clusterSkipped) {
        let excluded = ngExcluded(p, bounds, grp, data, 0);
      } else { d = ngGroup(d, p, data, counts, 0, bounds, grp); }
    }
  }
  if (gNgReason != 0) { return d; }
  if (gNgOwner < 0) { gNgReason = 7; return d; }
  // Stage 3 has no carve derivatives. A common capsule cutter can be
  // excluded locally only if the entire stencil is beyond smax support.
  // Both incoming flesh and a supported cutter are 1-Lipschitz.
  if (counts.z > 0.5) {
    for (var c = 0; c < 8; c = c + 1) {
      if (c >= i32(counts.y)) { break; }
      let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
      if (crange.z < 0.5) { continue; }
      for (var i = 0; i < 64; i = i + 1) {
        if (i >= i32(crange.y)) { break; }
        let idx = i32(crange.x) + i;
        if (idx >= i32(counts.x)) { break; }
        let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
        if (S.w < 0.5 || (S.w > 1.5 && S.w < 2.5)) { continue; }
        if (S.w > 2.5) { gNgReason = 1; return d; }
        let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE}), 0);
        if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
        let A = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_A}), 0);
        let B = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0);
        let O = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_QUAT}), 0);
        var cutter = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
        if (abs(1.0 - O.w) > 1e-6) { cutter = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
        if (d.x + cutter.x <= 4.0 * B.w + 2.0 * R) { gNgReason = 1; return d; }
      }
    }
  }
  if (noiseCfg.x > 0.0 && (gNgSecond - gNgBest <= 2.0 * R || gNgExcluded <= gNgBest + R)) {
    gNgReason = 4;
  }
  return d;
}`;

const NG_DETAIL = /* wgsl */ `fn ngDetail(p: vec3<f32>, data: texture_2d<f32>, owner: i32, noiseShift: vec3<f32>, amplitude: f32) -> vec3<f32> {
  if (amplitude <= 0.0) { return vec3<f32>(0.0); }
  let k1 = vec3<f32>(1.0, -1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(-1.0, 1.0, -1.0);
  let k4 = vec3<f32>(1.0, 1.0, 1.0);
  let p1 = p + k1 * 0.0015;
  let p2 = p + k2 * 0.0015;
  let p3 = p + k3 * 0.0015;
  let p4 = p + k4 * 0.0015;
  // Match mapBody's frequency, multiplication order, owner frame and eps.
  let h1 = fbm(restPoint(p1, data, owner, noiseLocal(p1, noiseShift)) * 3.0) * amplitude;
  let h2 = fbm(restPoint(p2, data, owner, noiseLocal(p2, noiseShift)) * 3.0) * amplitude;
  let h3 = fbm(restPoint(p3, data, owner, noiseLocal(p3, noiseShift)) * 3.0) * amplitude;
  let h4 = fbm(restPoint(p4, data, owner, noiseLocal(p4, noiseShift)) * 3.0) * amplitude;
  return (k1 * h1 + k2 * h2 + k3 * h3 + k4 * h4) / (4.0 * 0.0015);
}`;

export const NORMAL_GRADIENT_GAME_HELPERS = [NG_EXCLUDED, NG_GROUP, NG_BODY, NG_DETAIL] as const;
