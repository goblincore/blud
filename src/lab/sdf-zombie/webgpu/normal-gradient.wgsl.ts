import { wgslFn } from 'three/tsl';
import {
  HELPERS, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_QUAT,
  ROW_CLUSTER_RANGE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_GROUPS,
  ROW_GROUP_RANGE, ROW_GROUP_BOUNDS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_PRIM_BEND,
} from './march.wgsl';
import { MAX_PRIMS } from '../validate';
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

// Resolved parameters shared by the actual runtime loop and numeric probe.
const NG_WOUND = /* wgsl */ `fn ngWound(dIn: vec4<f32>, base: vec4<f32>, v: vec3<f32>, depth: f32, cap: vec4<f32>, blend: f32, rim: vec3<f32>) -> vec4<f32> {
  let r = length(v);
  let sphere = depth - r;
  let slab = cap.w - dot(v, cap.xyz);
  if (r < 1e-9) { gNgReason = 2; }
  if (abs(sphere - slab) < 1e-7) { gNgReason = 3; }
  let radial = v / max(r, 1e-9);
  let cutter = vec4<f32>(min(sphere, slab), select(-cap.xyz, -radial, sphere < slab));
  var d = ngSmax(dIn, cutter, blend);
  let amp = rim.z;
  if (amp <= 0.0) { return d; }
  let x = (r - rim.x) / rim.y;
  let bump = exp(-x * x) * amp;
  let m = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, base.x);
  let u = clamp((base.x + 0.3 * amp) / amp, 0.0, 1.0);
  let gradBump = bump * (-2.0 * x / rim.y) * radial;
  let gradGate = -(6.0 * u * (1.0 - u) / amp) * base.yzw;
  return vec4<f32>(d.x - bump * m, d.yzw - m * gradBump - bump * gradGate);
}`;

/** Dependency order is load-bearing; each registered helper includes only its predecessor. */
export const NORMAL_GRADIENT_HELPERS = [
  NG_STATE,
  NG_Q_ROT,
  NG_CAPSULE,
  NG_CAPSULE_ORIENTED,
  NG_SMIN,
  NG_SMAX,
  NG_WOUND,
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
      if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return lower; }
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

// Local Lipschitz certificate on the full tetrahedron ball. The original
// carved base is 1-Lipschitz: supported capsule smin/smax weights are convex.
export const NG_WOUND_LIP = /* wgsl */ `fn ngWoundLip(base: f32, r: f32, rim: vec3<f32>) -> f32 {
  if (rim.z <= 0.0) { return 0.0; }
  let R = 0.002598076211;
  let lo = max(0.0, r - R);
  let hi = r + R;
  let xlo = (lo - rim.x) / rim.y;
  let xhi = (hi - rim.x) / rim.y;
  let amin = select(min(abs(xlo), abs(xhi)), 0.0, xlo <= 0.0 && xhi >= 0.0);
  let amax = max(abs(xlo), abs(xhi));
  let critical = clamp(0.7071067812, amin, amax);
  let bumpMax = rim.z * exp(-amin * amin);
  let radialLip = rim.z / rim.y * 2.0 * critical * exp(-critical * critical);
  let mMax = 1.0 - smoothstep(-0.3 * rim.z, 0.7 * rim.z, base - R);
  let gateLip = select(0.0, 1.5 / rim.z, base + R > -0.3 * rim.z && base - R < 0.7 * rim.z);
  return radialLip * mMax + bumpMax * gateLip;
}`;

export const NG_WOUNDS = /* wgsl */ `fn ngWounds(base: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, cfg: vec4<f32>, cfg2: vec4<f32>, perf: vec4<f32>, bound: vec4<f32>) -> vec4<f32> {
  gNgLip = 1.0;
  gNgNear = 0.0;
  var d = base;
  if (cfg.x < 0.5) { return d; }
  let R = 0.002598076211;
  let boundDistance = length(p - bound.xyz);
  if (abs(boundDistance - bound.w) <= R) { gNgReason = 3; }
  if (boundDistance > bound.w) { return d; }
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= i32(cfg.x)) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let v = p - w.xyz;
    let r = length(v);
    let reach = w.w * max(2.0, 2.0 * cfg.w + 3.0 * cfg2.x) + 4.0 * cfg.y + 0.25;
    if (perf.y > 0.5) {
      if (abs(r - reach) <= R) { gNgReason = 3; }
      if (r > reach) { continue; }
    }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    let capRow = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP}), 0);
    let cap = vec4<f32>(capRow.xyz, select(1e5, capRow.w, capRow.w > 0.0));
    let burn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), burn);
    let rim = vec3<f32>(depth * cfg.w * wMeta.w, max(depth * cfg2.x, 1e-4), depth * cfg.z * wMeta.z * select(1.0, 0.25, burn));
    if (r <= R) { gNgReason = 2; }
    if (abs(r - 2.0 * depth) <= R) { gNgReason = 3; }
    let cutter = min(depth - r, cap.w - dot(v, cap.xyz));
    if (abs((depth - r) - (cap.w - dot(v, cap.xyz))) <= (1.0 + length(cap.xyz)) * R && cutter + (1.0 + gNgLip) * R >= d.x - 4.0 * cfg.y) { gNgReason = 3; }
    if (cfg.y <= 0.0 && abs(d.x - cutter) <= (gNgLip + max(1.0, length(cap.xyz))) * R) { gNgReason = 3; }
    d = ngWound(d, base, v, depth, cap, cfg.y, rim);
    gNgLip = max(gNgLip, max(1.0, length(cap.xyz))) + ngWoundLip(base.x, r, rim);
    if (r < 2.0 * depth) { gNgNear = 1.0; }
  }
  return d;
}
var<private> gNgLip: f32;
var<private> gNgNear: f32;
`;

// Lower bound for the ACTUAL coneBend/coneCap field: every radius sample
// subtracts <= maxRadius from a point on the scaled control hull. Distance
// to that hull's AABB is a lower bound even for the approximate candidate
// solver. minScale applies AFTER radius subtraction, just like sdPrim.
// Scale transforms the world R-ball by <= R/minScale, hence subtract R at
// the end. applyBones uses sdPrim, intentionally WITHOUT prim orientation.
const NG_INTERNAL_LOWER = /* wgsl */ `fn ngInternalLower(p: vec3<f32>, a: vec4<f32>, b: vec4<f32>, scale: vec3<f32>, shape: vec4<f32>, control: vec3<f32>) -> f32 {
  if (any(scale <= vec3<f32>(0.0)) || (i32(shape.y) & 44) != 0) { return -1e9; }
  let aa = a.xyz / scale;
  let bb = b.xyz / scale;
  var lo = min(aa, bb);
  var hi = max(aa, bb);
  if ((i32(shape.y) & 2) != 0) {
    lo = min(lo, control / scale);
    hi = max(hi, control / scale);
  }
  let exterior = length(max(max(lo - p / scale, p / scale - hi), vec3<f32>(0.0)));
  return (exterior - max(a.w, shape.x)) * min(scale.x, min(scale.y, scale.z)) - 0.002598076211;
}`;

const NG_BONES = /* wgsl */ `fn ngBones(flesh: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, count: f32) -> vec4<f32> {
  let R = 0.002598076211;
  var d = flesh;
  var best = 1e9;
  var second = 1e9;
  var excluded = 1e9;
  var owner = -1;
  var bestDg = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  for (var i = i32(counts.x); i < i32(counts.x + count); i = i + 1) {
    if (i >= ${MAX_PRIMS}) { break; }
    let T = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE}), 0);
    let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A}), 0);
    let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0);
    let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0);
    var control = vec3<f32>(0.0);
    if ((i32(T.y) & 2) != 0) { control = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND}), 0).xyz; }
    // Evaluate every internal scalar in the same order as applyBones. An
    // unsupported operation may be excluded only by a full-ball bound.
    let sd = sdPrim(p, i, data, T.x, T.y, control, 0);
    if (T.x >= 0.0 || (i32(T.y) & 47) != 0) {
      excluded = min(excluded, ngInternalLower(p, A, B, S.xyz, T, control));
      if (sd < d.x) { gNgReason = 1; }
    } else {
      let savedReason = gNgReason;
      let candidate = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
      if (gNgReason != savedReason && sd - R > d.x + gNgLip * R) { gNgReason = savedReason; }
      if (sd < best) { second = best; best = sd; owner = i; bestDg = candidate; }
      else { second = min(second, sd); }
    }
    d.x = min(d.x, sd);
  }
  if (best < flesh.x) {
    if (flesh.x - best <= (gNgLip + 1.0) * R || second - best <= 2.0 * R) { gNgReason = 4; }
    if (excluded <= best + R) { gNgReason = 1; }
    gNgOwner = owner;
    return bestDg;
  }
  if (best - flesh.x <= (gNgLip + 1.0) * R) { gNgReason = 4; }
  if (excluded <= flesh.x + gNgLip * R) { gNgReason = 1; }
  return flesh;
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
  let R = 0.002598076211;
  if (gTileActive > 0.5) {
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      // The per-view field uses band zero. Foreign atlas entries require a
      // separate rest-frame/owner contract; do not silently mis-anchor them.
      if (gTileBand[e] != 0.0) { gNgReason = 1; return d; }
      d = ngGroup(d, p, data, counts, 0, gTileBounds[e], gTileGrp[e]);
      if (gNgReason == 1) { return d; }
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
      // Unsupported is final throughout the group walk. Numerical reasons
      // may still be superseded by unsupported, so retain their diagnostic order.
      if (gNgReason == 1) { return d; }
    }
  }
  if (gNgReason != 0) { return d; }
  if (gNgOwner < 0) { gNgReason = 7; return d; }
  // Preserve the production cluster/primitive carve order. Smooth max of
  // 1-Lipschitz capsule fields remains 1-Lipschitz.
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
        if (S.w >= 3.5) { continue; }
        if (S.w > 2.5) { gNgReason = 1; return d; }
        let T = select(vec4<f32>(-1.0, 0.0, 0.0, 0.0), textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE}), 0), (i32(crange.w + 0.5) & 2) != 0);
        if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
        let A = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_A}), 0);
        let B = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0);
        let O = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_QUAT}), 0);
        var cutter = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
        if ((i32(crange.w + 0.5) & 1) != 0 && abs(1.0 - O.w) > 1e-6) { cutter = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
        if (B.w <= 0.0 && abs(d.x + cutter.x) <= 2.0 * R) { gNgReason = 3; return d; }
        d = ngSmax(d, -cutter, B.w);
      }
    }
  }
  d = ngWounds(d, p, data, woundCfg, woundCfg2, perfCfg, woundBound);
  if (gNgReason != 0) { return d; }
  if (gNgNear > 0.5 && counts2.x > 0.0) { d = ngBones(d, p, data, counts, counts2.x); }
  if (gNgReason != 0) { return d; }
  if (noiseCfg.x > 0.0 && gNgOwner < i32(counts.x) && (gNgSecond - gNgBest <= 2.0 * R || gNgExcluded <= gNgBest + R)) {
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

export const NORMAL_GRADIENT_GAME_HELPERS = [NG_EXCLUDED, NG_GROUP, NG_WOUND_LIP, NG_WOUNDS, NG_INTERNAL_LOWER, NG_BONES, NG_BODY, NG_DETAIL] as const;

/** Diagnostic point entry reuses the complete production scalar and gradient
 * helper chains. It never runs in a game material or timed beauty pass. */
export function buildNormalBodyPointFn(): ReturnType<typeof wgslFn> {
  const signature = NG_BODY.slice(NG_BODY.indexOf('(') + 1, NG_BODY.indexOf(') ->'));
  const names = signature.split(', ').map(param => param.split(':')[0]);
  const args = names.join(', ');
  const source = `fn ngBodyPoint(${signature}, probeKind: f32) -> vec4<f32> {
    gTileActive = 0.0;
    if (probeKind > 1.5 && probeKind < 2.5) { return mapBody(${args}); }
    let result = ngBody(${args});
    if (probeKind > 3.5) { return vec4<f32>(0.0, ngDetail(p, data, gNgOwner, noiseShift, noiseCfg.x)); }
    if (probeKind > 2.5) { return vec4<f32>(result.x, result.yzw + ngDetail(p, data, gNgOwner, noiseShift, noiseCfg.x)); }
    if (probeKind > 0.5) { return vec4<f32>(f32(gNgReason), f32(gNgOwner), gNgLip, gNgNear); }
    return result;
  }`;
  const nodes = [...HELPERS, ...NORMAL_GRADIENT_HELPERS, ...NORMAL_GRADIENT_GAME_HELPERS]
    .reduce<ReturnType<typeof wgslFn>[]>((acc, h) => [...acc, wgslFn(h, acc.slice(-1))], []);
  return wgslFn(source, nodes.slice(-1));
}
