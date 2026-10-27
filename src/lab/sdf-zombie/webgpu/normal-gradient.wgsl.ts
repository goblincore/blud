// src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts
//
// WGSL for the analytic normal gradient (probe, wounds, bones and body functions) and the builders that wrap it as three wgslFn nodes.

import { NG_COUNT as NGC } from './march/shade-bound-flag';
import { wgslFn } from 'three/tsl';
import {
  HELPERS, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_QUAT,
  ROW_CLUSTER_RANGE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_GROUPS,
  ROW_GROUP_RANGE, ROW_GROUP_BOUNDS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS, ROW_PRIM_BEND,
} from './march.wgsl';
import { ROW_PRIM_CLIP, ROW_PRIM_SHELL, ROW_PRIM_WARP } from './march/layout';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';
import { TILE_MAX_ENTRIES } from './tile-cull';

// Local diagnostic validity. The declaration follows the first function
// because three's wgslFn parser requires every source to start at fn.
const NG_STATE = /* wgsl */ `fn ngReset() -> f32 {
  gNgReason = 0;
  return 0.0;
}
var<private> gNgReason: i32;
// Set by the caller: owned wounds may take the analytic path (no limb won at the hit).
var<private> gNgOwnedOk: f32 = 0.0;
// TERM BISECT MASK (crowd diagnostics 2026-09-14), fed from normalGradientCfg.z
// in MARCH_TRACE_POST. 0 = production. bit 1 skip ngWounds, bit 2 skip
// ngBones/ngInternalLower, bit 4 skip the ngExcluded certificates, bit 8 skip
// ngDetail (POST), bit 16 force the cluster walk even with tiles on. Each bit
// removes exactly one analytic term so mode 12 (dot(analytic, FD)) can name a
// slot-relative term; inert at 0.
var<private> gNgDebugMask: u32;
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
// TAPER, SHELL AND CHAMFER (2026-10-26): the analytic counterparts of coneCap's tapered branch, sdShell and
// sminChamfer, mirrored by roundConeGradient, shellGradient and chamferMinGradient in normal-gradient-reference.ts
// (tested there against finite differences of the CPU fields). Before these, ngGroup and ngExcluded gave up on ANY
// tapered or shaped prim, so the zombie's two tapered foot bars (2026-09-29) failed every hit pixel of every body.
const NG_CONE = /* wgsl */ `fn ngCone(
  p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r1: f32,
  r2: f32,
  scale: vec3<f32>
) -> vec4<f32> {
  if (r2 < 0.0) { return ngCapsule(p, a, b, r1, scale); }
  if (any(scale <= vec3<f32>(0.0))) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let invScale = 1.0 / scale;
  let q = p * invScale;
  let aa = a * invScale;
  let bb = b * invScale;
  let minScale = min(scale.x, min(scale.y, scale.z));
  // coneCap's expressions verbatim, so the value is the field the fold sums; each region's gradient is closed form.
  let ba = bb - aa;
  let l2 = dot(ba, ba);
  var d: f32;
  var v: vec3<f32>;
  if (l2 < 1e-12) {
    d = (length(q - aa) - max(r1, r2)) * minScale;
    v = q - aa;
  } else {
    let rr = r1 - r2;
    let a2 = l2 - rr * rr;
    let il2 = 1.0 / l2;
    let pa = q - aa;
    let y = dot(pa, ba);
    let z = y - l2;
    let x = pa * l2 - ba * y;
    let x2 = dot(x, x);
    let y2 = y * y * l2;
    let z2 = z * z * l2;
    let k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) {
      d = (sqrt(x2 + z2) * il2 - r2) * minScale;
      v = q - bb;
    } else if (sign(y) * a2 * y2 < k) {
      d = (sqrt(x2 + y2) * il2 - r1) * minScale;
      v = q - aa;
    } else {
      d = ((sqrt(x2 * a2 * il2) + y * rr) * il2 - r1) * minScale;
      // The side: |pa_perp| cos + (pa . axis) sin of the half-angle, a unit gradient. On the axis it has no direction.
      if (sqrt(x2) <= 1e-9 * l2) {
        if (gNgReason == 0) { gNgReason = 2; }
        return vec4<f32>(d, 0.0, 0.0, 0.0);
      }
      let side = x * (sqrt(a2 * il2) * inverseSqrt(x2)) + ba * (rr * il2);
      return vec4<f32>(d, side * invScale * minScale);
    }
  }
  let vLen = length(v);
  if (vLen < 1e-9) {
    if (gNgReason == 0) { gNgReason = 2; }
    return vec4<f32>(d, 0.0, 0.0, 0.0);
  }
  return vec4<f32>(d, (v / vLen) * invScale * minScale);
}`;

// BEND AND BOX (2026-10-27): coneBend and sdPrim's box branch with their gradients, mirrored by bentConeGradient and
// boxGradient in normal-gradient-reference.ts. Before these the soldiers (bent limbs, machined boxes) failed every
// hit pixel. The bend repeats coneBend's search verbatim (so the value is the fold's) and keeps its t: at the
// minimiser the gradient is the unit vector from the curve point to q. A second basin of G within the stencil's
// reach, past a hump, is the medial crease inside a bend (reason 3); the seeds stand in for the reference's grid.
const NG_BEND = /* wgsl */ `fn ngBezG(q: vec3<f32>, a: vec3<f32>, e1: vec3<f32>, e2: vec3<f32>, r1: f32, rb: f32, t: f32) -> f32 {
  return length(q - (a + e1 * t + e2 * (t * t))) - (r1 + (rb - r1) * t);
}
fn ngBend(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, scale: vec3<f32>) -> vec4<f32> {
  if (any(scale <= vec3<f32>(0.0))) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let invScale = 1.0 / scale;
  let q = p * invScale;
  let aa = a * invScale;
  let bq = b * invScale;
  let cq = c * invScale;
  let e2 = aa - 2.0 * cq + bq;
  if (dot(e2, e2) < 1e-12 || dot(bq - aa, bq - aa) < 1e-12) { return ngCone(p, a, b, r1, r2, scale); }
  let minScale = min(scale.x, min(scale.y, scale.z));
  let rb = select(r2, r1, r2 < 0.0);
  let e1 = (cq - aa) * 2.0;
  let cand = sdBezierT(q, aa, cq, bq);
  var best = 1e9;
  var bestT = 0.0;
  var ts = array<f32, 9>(cand.x, cand.y, cand.z, 0.0, 0.25, 0.5, 0.75, 1.0, 1.0);
  for (var i = 0; i < 9; i = i + 1) {
    if (f32(i) >= cand.w && i < 3) { continue; }
    let v = ngBezG(q, aa, e1, e2, r1, rb, ts[i]);
    if (v < best) { best = v; bestT = ts[i]; }
  }
  for (var round = 0; round < 2; round = round + 1) {
    let step = select(0.125, 0.03125, round >= 1);
    for (var s = -1; s <= 1; s = s + 1) {
      let t = clamp(bestT + f32(s) * step, 0.0, 1.0);
      let v = ngBezG(q, aa, e1, e2, r1, rb, t);
      if (v < best) { best = v; bestT = t; }
    }
  }
  let nD = q - (aa + e1 * bestT + e2 * (bestT * bestT));
  let nP = e1 + e2 * (2.0 * bestT);
  let nF2 = dot(nP, nP) - 2.0 * dot(nD, e2);
  let nT = select(bestT, clamp(bestT + dot(nD, nP) / nF2, 0.0, 1.0), nF2 > 0.0);
  let nV = ngBezG(q, aa, e1, e2, r1, rb, nT);
  if (nV < best) { best = nV; bestT = nT; }
  let wD = q - (aa + e1 * bestT + e2 * (bestT * bestT));
  let wP = e1 + e2 * (2.0 * bestT);
  let wL = max(length(wD), 1e-9);
  let wDp = dot(wD, wP);
  let wG2 = (dot(wP, wP) - 2.0 * dot(wD, e2)) / wL - wDp * wDp / (wL * wL * wL);
  let wT = select(bestT, clamp(bestT - (-wDp / wL - (rb - r1)) / wG2, 0.0, 1.0), wG2 > 0.0);
  let wV = ngBezG(q, aa, e1, e2, r1, rb, wT);
  if (wV < best) { best = wV; bestT = wT; }
  let reach = 2.0 * 0.002598076211 * max(invScale.x, max(invScale.y, invScale.z));
  for (var i = 0; i < 8; i = i + 1) {
    if (f32(i) >= cand.w && i < 3) { continue; }
    let tc = ts[i];
    if (abs(tc - bestT) < 0.02) { continue; }
    let gc = ngBezG(q, aa, e1, e2, r1, rb, tc);
    if (gc - best > reach) { continue; }
    if (ngBezG(q, aa, e1, e2, r1, rb, (tc + bestT) * 0.5) > gc + 1e-7 && gNgReason == 0) { gNgReason = 3; }
  }
  let v = q - (aa + e1 * bestT + e2 * (bestT * bestT));
  let vLen = length(v);
  if (vLen < 1e-9) {
    if (gNgReason == 0) { gNgReason = 2; }
    return vec4<f32>(best * minScale, 0.0, 0.0, 0.0);
  }
  return vec4<f32>(best * minScale, (v / vLen) * invScale * minScale);
}`;

// The rounded box through dw/dq: the projector off the axis while the clamped t is interior, the identity past an
// end. Two faces tied within the stencil (inside, or at an edge the rounding leaves sharp), and either end's plane
// where the box's gradient has an axial part, are kinks.
const NG_BOX = /* wgsl */ `fn ngBox(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32, round: f32, scale: vec3<f32>) -> vec4<f32> {
  if (any(scale <= vec3<f32>(0.0))) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let invScale = 1.0 / scale;
  let q = p * invScale;
  let aa = a * invScale;
  let ab = b * invScale - aa;
  let ab2 = dot(ab, ab);
  let raw = select(dot(q - aa, ab) / ab2, 0.0, ab2 == 0.0);
  let w = q - (aa + ab * clamp(raw, 0.0, 1.0));
  let e = r * (1.0 - round);
  let qv = abs(w) - vec3<f32>(e);
  let mx = max(qv.x, max(qv.y, qv.z));
  let mn = min(qv.x, min(qv.y, qv.z));
  let m = max(qv, vec3<f32>(0.0));
  let minScale = min(scale.x, min(scale.y, scale.z));
  let d = (length(m) + min(mx, 0.0) - r * round) * minScale;
  let Rq = 0.002598076211 * max(invScale.x, max(invScale.y, invScale.z));
  if (mx - (qv.x + qv.y + qv.z - mx - mn) <= 2.0 * Rq && mx <= 2.0 * Rq && gNgReason == 0) { gNgReason = 3; }
  var gw: vec3<f32>;
  if (mx > 0.0) {
    gw = sign(w) * m / length(m);
  } else {
    gw = sign(w) * select(select(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 1.0, 0.0), qv.y == mx), vec3<f32>(1.0, 0.0, 0.0), qv.x == mx);
    if (dot(gw, gw) < 0.5) {
      if (gNgReason == 0) { gNgReason = 2; }
      return vec4<f32>(d, 0.0, 0.0, 0.0);
    }
  }
  if (ab2 > 0.0) {
    let axial = dot(gw, ab) / ab2;
    let abl = sqrt(ab2);
    if (abs(axial) * abl > 1e-6 && (abs(raw) * abl <= Rq || abs(raw - 1.0) * abl <= Rq) && gNgReason == 0) { gNgReason = 3; }
    if (raw > 0.0 && raw < 1.0) { gw = gw - ab * axial; }
  }
  return vec4<f32>(d, gw * invScale * minScale);
}`;

// Which field a prim is: box (bit 8) before bend (bit 2) before taper, sdPrim's order. c is the bend row's control
// point, round the bend row's w (a box's corner fraction: bend and box never coexist).
const NG_SHAPE = /* wgsl */ `fn ngShape(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, scale: vec3<f32>, prof: i32, round: f32) -> vec4<f32> {
  if ((prof & 8) != 0) { return ngBox(p, a, b, r1, round, scale); }
  if ((prof & 2) != 0) { return ngBend(p, a, b, c, r1, r2, scale); }
  return ngCone(p, a, b, r1, r2, scale);
}`;

// sdPrimO's frame: p and the prim's three points ride the conjugate about the midpoint; the gradient rotates back.
const NG_SHAPE_ORIENTED = /* wgsl */ `fn ngShapeOriented(
  p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  c: vec3<f32>,
  r1: f32,
  r2: f32,
  scale: vec3<f32>,
  quat: vec4<f32>,
  prof: i32,
  round: f32
) -> vec4<f32> {
  let quatLen2 = dot(quat, quat);
  if (abs(quatLen2 - 1.0) > 1e-3) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let mid = (a + b) * 0.5;
  let invQuat = vec4<f32>(-quat.xyz, quat.w);
  let local = ngShape(
    mid + ngQRot(invQuat, p - mid),
    mid + ngQRot(invQuat, a - mid),
    mid + ngQRot(invQuat, b - mid),
    mid + ngQRot(invQuat, c - mid),
    r1,
    r2,
    scale,
    prof,
    round);
  return vec4<f32>(local.x, ngQRot(quat, local.yzw));
}`;

// sdShell with its gradient: sign(base) x grad(base) for the sheet, max with the clip plane, the rounded rim, all
// over the warp's Lipschitz factor. The warp's derivative goes through noiseLocal's body frame (a yaw, then the
// transpose back). Each switch is a kink; a stencil within reach of one that decides the value is reason 3.
const NG_SHELL = /* wgsl */ `fn ngShell(dBase: vec4<f32>, p: vec3<f32>, thick: f32, rim: f32, clipO: f32, hasClip: f32, clipN: vec3<f32>, warpA: f32, warpF: vec3<f32>, drift: vec3<f32>) -> vec4<f32> {
  let R = 0.002598076211;
  var base = dBase;
  var lip = 1.0;
  let fLen = length(warpF);
  if (warpA != 0.0 && fLen != 0.0) {
    let q = noiseLocal(p - drift, gBodyAnchor);
    let sx = sin(warpF.x * q.x);
    let sy = sin(warpF.y * q.y + 1.3);
    let sz = sin(warpF.z * q.z + 2.6);
    let gq = warpA * vec3<f32>(warpF.x * cos(warpF.x * q.x) * sy * sz, sx * warpF.y * cos(warpF.y * q.y + 1.3) * sz, sx * sy * warpF.z * cos(warpF.z * q.z + 2.6));
    let ch = cos(gBodyAnchor.y);
    let sh = sin(gBodyAnchor.y);
    base = vec4<f32>(base.x + warpA * sx * sy * sz, base.yzw + vec3<f32>(gq.x * ch + gq.z * sh, gq.y, gq.z * ch - gq.x * sh));
    lip = 1.0 + abs(warpA) * fLen;
  }
  if (abs(base.x) <= lip * R && gNgReason == 0) { gNgReason = 3; }
  let d = vec4<f32>(abs(base.x) - thick, select(-base.yzw, base.yzw, base.x >= 0.0));
  if (hasClip < 0.5) { return d / lip; }
  let plane = vec4<f32>(dot(p, clipN) - clipO, clipN);
  let reach = 2.0 * (lip + length(clipN)) * R;
  var m = select(plane, d, d.x >= plane.x);
  let len = length(vec2(d.x, plane.x));
  if (len < 1e-9) {
    if (gNgReason == 0) { gNgReason = 2; }
    return vec4<f32>(m.x / lip, 0.0, 0.0, 0.0);
  }
  let rimT = vec4<f32>(rim - len, -(d.x * d.yzw + plane.x * clipN) / len);
  if (abs(m.x - rimT.x) <= reach && gNgReason == 0) { gNgReason = 3; }
  if (rimT.x > m.x) { m = rimT; }
  else if (abs(d.x - plane.x) <= reach && gNgReason == 0) { gNgReason = 3; }
  return m / lip;
}`;

const NG_SMIN_CHAMFER = /* wgsl */ `fn ngSminChamfer(a: vec4<f32>, b: vec4<f32>, kIn: f32) -> vec4<f32> {
  let K = kIn * 4.0;
  if (K <= 0.0) { return ngSmin(a, b, kIn); }
  let margin = 4.0 * 0.002598076211;
  let m = select(b, a, a.x <= b.x);
  let c = vec4<f32>((a.x - K + b.x) * 0.70710678, (a.yzw + b.yzw) * 0.70710678);
  if (abs(m.x - c.x) <= margin && gNgReason == 0) { gNgReason = 3; }
  if (c.x < m.x) { return c; }
  if (abs(a.x - b.x) <= margin && gNgReason == 0) { gNgReason = 3; }
  return m;
}`;

// Game integration is registered AFTER the scalar helpers, only for march.
// It has no writes to production gFold* owner/hit metadata.
const NG_EXCLUDED = /* wgsl */ `fn ngExcluded(p: vec3<f32>, bounds: vec4<f32>, grp: vec4<f32>, data: texture_2d<f32>, band: i32) -> f32 {
  if ((gNgDebugMask & 4u) != 0u) { return 1e9; }
  // The enclosing sphere minus R contains the entire stencil. OUTSIDE it,
  // each prim's field is >= Euclidean exterior / distortion: the sphere is
  // fitted at the reach (pack.ts primReach: the larger taper radius, box and
  // strand reach, shell thickness + |warp|), and a capsule, round cone, box
  // or bent cone is a scaled-space distance no larger than its own reach.
  // Inside an enclosing sphere no lower field bound follows from that sphere.
  let exterior = length(p - bounds.xyz) - bounds.w - 0.002598076211;
  var lower = select(-1e9, exterior / max(grp.z, 1.0), exterior > 0.0);
  // A shaped group: a shell divides by its warp's Lipschitz factor, so its
  // bound does too. A strand's own Lipschitz divide is not bounded here, so a
  // skipped strand is still not blessed. Taper, chamfer (a blend, not a
  // field), bend and box need nothing more.
  if ((i32(grp.w + 0.5) & 2) != 0) {
    for (var i = 0; i < i32(grp.y); i = i + 1) {
      let idx = i32(grp.x) + i;
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
      if (S.w > 0.5) { continue; }${NGC ? `
      if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }` : ''}
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      if ((i32(T.y) & 32) != 0) { gNgReason = 1; return lower; }
      if ((i32(T.y) & 4) != 0 && lower > 0.0) {
        let W2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0);
        lower = lower / (1.0 + abs(W2.x) * length(W2.yzw));
      }
    }
  }
  gNgExcluded = min(gNgExcluded, lower);
  return lower;
}
var<private> gNgBest: f32;
var<private> gNgSecond: f32;
var<private> gNgOwner: i32;
var<private> gNgExcluded: f32;
`;

const NG_GROUP = /* wgsl */ `fn ngGroup(dIn: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32>) -> vec4<f32> {
  let R = 0.002598076211;
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
    if (S.w > 0.5) { continue; }${NGC ? `
    if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }` : ''}
    var r2 = -1.0;
    var prof = 0;
    if ((flags & 2) != 0) {
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      // Taper (T.x >= 0), chamfer (bit 1), bend (2), shell (4), box (8) and
      // metal (16, no geometric effect) have gradients here. Strand (32) is
      // unsupported in the intact phase.
      if ((i32(T.y) & 32) != 0) { gNgReason = 1; return d; }
      r2 = T.x;
      prof = i32(T.y);
    }
    let A = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_A} + band), 0);
    let B = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + band), 0);
    // The bend row: a bent prim's control point, a box's corner fraction (w).
    var bend = vec4<f32>(0.0);
    if ((prof & 10) != 0) { bend = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0); }
    // A prim the running fold cannot feel (outside smin's 4k reach, over the
    // whole stencil) may report a kink or a degenerate point without
    // failing the pixel: its gradient never reaches the result.
    let savedReason = gNgReason;
    var O = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if ((flags & 1) != 0) { O = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_QUAT} + band), 0); }
    var dg: vec4<f32>;
    // Production leaves near-identity quaternions untouched too.
    if (abs(1.0 - O.w) > 1e-6) { dg = ngShapeOriented(p, A.xyz, B.xyz, bend.xyz, A.w, r2, S.xyz, O, prof, bend.w); }
    else { dg = ngShape(p, A.xyz, B.xyz, bend.xyz, A.w, r2, S.xyz, prof, bend.w); }
    if ((prof & 4) != 0) {
      let S2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHELL} + band), 0);
      let C2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_CLIP} + band), 0);
      let W2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0);
      dg = ngShell(dg, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);
    }
    if (gNgReason != savedReason && gNgReason != 1 && dg.x - d.x > B.w * 4.0 + 6.0 * R * max(grp.z, 1.0)) { gNgReason = savedReason; }
    if (dg.x < gNgBest) {
      gNgSecond = gNgBest;
      gNgBest = dg.x;
      gNgOwner = idx;
    } else { gNgSecond = min(gNgSecond, dg.x); }
    if ((prof & 7) == 1) { d = ngSminChamfer(d, dg, B.w); } else { d = ngSmin(d, dg, B.w); }
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

// NOTE (cut wounds): wMeta.w feeds the crater rim offset below, but for bit-32 (cut) wounds it holds the cut's sag. The cut
// test (flag 32, right after the decal skip) returns to calcNormal's finite-difference taps before META is loaded, so a cut
// never reaches this rim.
export const NG_WOUNDS = /* wgsl */ `fn ngWounds(base: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, cfg: vec4<f32>, cfg2: vec4<f32>, perf: vec4<f32>, bound: vec4<f32>) -> vec4<f32> {
  gNgLip = 1.0;
  gNgNear = 0.0;
  var d = base;
  if (cfg.x < 0.5) { return d; }
  let R = 0.002598076211;
  let boundDistance = length(p - bound.xyz);
  if (abs(boundDistance - bound.w) <= R) { gNgReason = 3; }
  if (boundDistance > bound.w) { return d; }
  for (var i = 0; i < ${MAX_WOUNDS}; i = i + 1) {
    if (i >= i32(cfg.x)) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND} + gBand), 0);
    let v = p - w.xyz;
    let r = length(v);
    let reach = w.w * max(2.0, 2.0 * cfg.w + 3.0 * cfg2.x) + 4.0 * cfg.y + 0.25;
    if (perf.y > 0.5) {
      if (abs(r - reach) <= R) { gNgReason = 3; }
      if (r > reach) { continue; }
    }
    // mapBody restores foreign clusters after localized carving. Until that
    // union has an analytic counterpart, differentiate the actual scalar
    // field through calcNormal's fallback for any surviving scoped wound.
    let flagsRow = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS} + gBand), 0);
    // CLOTH DECAL (bit 2): never carved — mirrors applyWounds' skip.
    if ((i32(flagsRow.x) & 4) != 0) { continue; }
    // CUT (flag 32): the slot (jagged lens, lips) has no analytic gradient here — take calcNormal's taps, like torn. Before
    // the META load: a cut's META.w is its sag, not the rim offset the crater path below reads.
    if ((i32(flagsRow.x) & 32) != 0) { gNgReason = 1; return d; }
    // TORN (bit 3, flail lips 2026-09-29): a two-octave ragged edge with lobe-
    // modulated petals has no analytic counterpart here — take calcNormal's taps.
    if ((i32(flagsRow.x) & 8) != 0) { gNgReason = 1; return d; }
    let owner = flagsRow.y;
    // OWNED WOUNDS (2026-09-22): the owner re-fold has no analytic counterpart — but
    // when no limb won the re-fold at this pixel's hit (gNgOwnedOk, set by the caller
    // from the march's hitRefold), the field here IS the union with every wound
    // applied, exactly the unowned case below. Otherwise fall back to the taps.
    if (owner > 0.0 && gNgOwnedOk < 0.5) { gNgReason = 1; return d; }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META} + gBand), 0);
    let capRow = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP} + gBand), 0);
    let cap = vec4<f32>(capRow.xyz, select(1e5, capRow.w, capRow.w > 0.0));
    if (wMeta.x < -0.5) {
      let sphere = w.w - r;
      let slab = cap.w - dot(v, cap.xyz);
      let cutter = min(sphere, slab);
      let cutterLip = max(1.0, length(cap.xyz));
      if (r <= R) { gNgReason = 2; }
      if (abs(r - 2.0 * w.w) <= R) { gNgReason = 3; }
      if (abs(sphere - slab) <= (1.0 + length(cap.xyz)) * R && cutter + (gNgLip + cutterLip) * R >= d.x) { gNgReason = 3; }
      if (abs(d.x - cutter) <= (gNgLip + cutterLip) * R) { gNgReason = 3; }
      let gradient = select(-cap.xyz, -v / max(r, 1e-8), sphere <= slab);
      if (cutter > d.x) { d = vec4<f32>(cutter, gradient); }
      gNgLip = max(gNgLip, cutterLip);
      if (r < 2.0 * w.w) { gNgNear = 1.0; }
      continue;
    }
    let burn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), burn);
    let rim = vec3<f32>(depth * cfg.w * wMeta.w, max(depth * cfg2.x, 1e-4), depth * cfg.z * wMeta.z * select(1.0, 0.25, burn));
    if (r <= R) { gNgReason = 2; }
    if (abs(r - 2.0 * depth) <= R) { gNgReason = 3; }
    let cutter = min(depth - r, cap.w - dot(v, cap.xyz));
    if (abs((depth - r) - (cap.w - dot(v, cap.xyz))) <= (1.0 + length(cap.xyz)) * R && cutter + (1.0 + gNgLip) * R >= d.x - 4.0 * cfg.y) { gNgReason = 3; }
    if (cfg.y <= 0.0 && abs(d.x - cutter) <= (gNgLip + max(1.0, length(cap.xyz))) * R) { gNgReason = 3; }
    // Size-scaled fillet — MUST match APPLY_WOUNDS (march/fields/wounds.wgsl.ts).
    d = ngWound(d, base, v, depth, cap, cfg.y * clamp(w.w / 0.05, 0.1, 1.0), rim);
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
    let T = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE} + gBand), 0);
    let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A} + gBand), 0);
    let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B} + gBand), 0);
    let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE} + gBand), 0);
    var control = vec3<f32>(0.0);
    if ((i32(T.y) & 2) != 0) { control = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + gBand), 0).xyz; }
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

export const NG_BODY = /* wgsl */ `fn ngBody(p: vec3<f32>, data: texture_2d<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec4<f32> {
  // CROWD (2026-09-14): DO NOT reload an instance here. The caller owns the
  // band: MARCH_TRACE_POST loads the HIT slot (loadInstance(inst, gHitSlot))
  // and pins it before calling, and ngBodyPoint loads its own base slot.
  // ngBody used to start with loadInstance(inst, 0), which for every slot
  // but the first silently replaced the hit instance's gBand/gInst* with
  // slot 0's — so the analytic gradient was differentiated against the wrong
  // body (probe: slot 0 dot 1.0, every other slot ~ -0.42).
  let resetMarker = ngReset();
  gNgBest = 1e9;
  gNgSecond = 1e9;
  gNgOwner = -1;
  gNgExcluded = 1e9;
  var d = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  if (gInstVolPose0.w > 0.5) { gNgReason = 6; return d; }
  if (gInstCounts2.y > 0.5) { gNgReason = 1; return d; }
  let R = 0.002598076211;
  let useTiles = gTileActive > 0.5 && (gNgDebugMask & 16u) == 0u;
  if (useTiles) {
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      // CROWD (2026-09-14): the union field is a plain min over instances, so
      // its gradient at the hit IS the hit instance's own gradient. Fold only
      // this pixel's entries that belong to the hit band (gBand, pinned by
      // MARCH_TRACE_POST); other instances' entries are not part of the
      // winner's field. A per-body view has one band, so nothing changes.
      if (gTileBand[e] != f32(gBand)) { continue; }
      d = ngGroup(d, p, data, gInstCounts, gBand, gTileBounds[e], gTileGrp[e]);
      if (gNgReason == 1) { return d; }
    }
  }
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= i32(gInstCounts.y)) { break; }
    let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE} + gBand), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS} + gBand), 0);
    let gspan = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS} + gBand), 0);
    let clusterSkipped = length(p - cbounds.xyz) - cbounds.w > (d.x + gInstCounts.w * 4.0) * gspan.z;
    for (var gi = 0; gi < 64; gi = gi + 1) {
      if (gi >= i32(gspan.y)) { break; }
      let g = i32(gspan.x) + gi;
      let grp = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_RANGE} + gBand), 0);
      let bounds = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_BOUNDS} + gBand), 0);
      if (useTiles) {
        var listed = false;
        for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
          if (f32(e) >= gTileN) { break; }
          if (gTileGrp[e].x == grp.x && gTileBand[e] == f32(gBand)) { listed = true; break; }
        }
        // Tile culling is not itself a stencil-owner certificate. Explicitly
        // include omitted candidates via their group bounds at this hit.
        if (!listed) { let excluded = ngExcluded(p, bounds, grp, data, gBand); }
      } else if (clusterSkipped) {
        let excluded = ngExcluded(p, bounds, grp, data, gBand);
      } else { d = ngGroup(d, p, data, gInstCounts, gBand, bounds, grp); }
      // Unsupported is final throughout the group walk. Numerical reasons
      // may still be superseded by unsupported, so retain their diagnostic order.
      if (gNgReason == 1) { return d; }
    }
  }
  if (gNgReason != 0) { return d; }
  if (gNgOwner < 0) { gNgReason = 7; return d; }
  // Preserve the production cluster/primitive carve order. Smooth max of
  // 1-Lipschitz capsule fields remains 1-Lipschitz.
  if (gInstCounts.z > 0.5) {
    for (var c = 0; c < 8; c = c + 1) {
      if (c >= i32(gInstCounts.y)) { break; }
      let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE} + gBand), 0);
      if (crange.z < 0.5) { continue; }
      for (var i = 0; i < 64; i = i + 1) {
        if (i >= i32(crange.y)) { break; }
        let idx = i32(crange.x) + i;
        if (idx >= i32(gInstCounts.x)) { break; }
        let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + gBand), 0);
        if (S.w < 0.5 || (S.w > 1.5 && S.w < 2.5)) { continue; }
        if (S.w >= 3.5) { continue; }
        if (S.w > 2.5) { gNgReason = 1; return d; }
        let T = select(vec4<f32>(-1.0, 0.0, 0.0, 0.0), textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + gBand), 0), (i32(crange.w + 0.5) & 2) != 0);
        if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
        let A = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_A} + gBand), 0);
        let B = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + gBand), 0);
        let O = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_QUAT} + gBand), 0);
        var cutter = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
        if ((i32(crange.w + 0.5) & 1) != 0 && abs(1.0 - O.w) > 1e-6) { cutter = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
        if (B.w <= 0.0 && abs(d.x + cutter.x) <= 2.0 * R) { gNgReason = 3; return d; }
        d = ngSmax(d, -cutter, B.w);
      }
    }
  }
  if ((gNgDebugMask & 1u) == 0u) {
    d = ngWounds(d, p, data, woundCfg, woundCfg2, perfCfg, gInstWoundBound);
    if (gNgReason != 0) { return d; }
  }
  if ((gNgDebugMask & 2u) == 0u && gNgNear > 0.5 && gInstCounts2.x > 0.0) { d = ngBones(d, p, data, gInstCounts, gInstCounts2.x); }
  if (gNgReason != 0) { return d; }
  if (noiseCfg.x > 0.0 && gNgOwner < i32(gInstCounts.x) && (gNgSecond - gNgBest <= 2.0 * R || gNgExcluded <= gNgBest + R)) {
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
  let h1 = fbm(restPoint(p1, data, owner, noiseLocal(p1, noiseShift), gBand) * 3.0) * amplitude;
  let h2 = fbm(restPoint(p2, data, owner, noiseLocal(p2, noiseShift), gBand) * 3.0) * amplitude;
  let h3 = fbm(restPoint(p3, data, owner, noiseLocal(p3, noiseShift), gBand) * 3.0) * amplitude;
  let h4 = fbm(restPoint(p4, data, owner, noiseLocal(p4, noiseShift), gBand) * 3.0) * amplitude;
  return (k1 * h1 + k2 * h2 + k3 * h3 + k4 * h4) / (4.0 * 0.0015);
}`;

export const NORMAL_GRADIENT_GAME_HELPERS = [NG_CONE, NG_BEND, NG_BOX, NG_SHAPE, NG_SHAPE_ORIENTED, NG_SHELL, NG_SMIN_CHAMFER, NG_EXCLUDED, NG_GROUP, NG_WOUND_LIP, NG_WOUNDS, NG_INTERNAL_LOWER, NG_BONES, NG_BODY, NG_DETAIL] as const;

/** Diagnostic point entry reuses the complete production scalar and gradient
 * helper chains. It never runs in a game material or timed beauty pass. */
export function buildNormalBodyPointFn(): ReturnType<typeof wgslFn> {
  const signature = NG_BODY.slice(NG_BODY.indexOf('(') + 1, NG_BODY.indexOf(') ->'));
  // Bracket-aware split: `inst: ptr<storage, array<vec4<f32>>, read>` contains
  // commas INSIDE its type, so a bare ', ' split would tear it into three
  // phantom parameters and every binding after it would shift.
  const names: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of signature) {
    if (ch === '<') { depth += 1; } else if (ch === '>') { depth -= 1; }
    if (ch === ',' && depth === 0) { names.push(cur.split(':')[0]!.trim()); cur = ''; } else { cur += ch; }
  }
  if (cur.trim()) { names.push(cur.split(':')[0]!.trim()); }
  const args = names.join(', ');
  const source = `fn ngBodyPoint(${signature}, probeKind: f32) -> vec4<f32> {
    // Standalone point entry: no trace has run, so seed the instance globals
    // from this view's base slot. ngBody deliberately does not load one.
    loadInstance(inst, i32(instCfg.z));
    gTileActive = 0.0;
    if (probeKind > 1.5 && probeKind < 2.5) { return mapBody(${args}); }
    let result = ngBody(${args});
    if (probeKind > 3.5) { return vec4<f32>(0.0, ngDetail(p, data, gNgOwner, gInstNoiseShift, noiseCfg.x)); }
    if (probeKind > 2.5) { return vec4<f32>(result.x, result.yzw + ngDetail(p, data, gNgOwner, gInstNoiseShift, noiseCfg.x)); }
    if (probeKind > 0.5) { return vec4<f32>(f32(gNgReason), f32(gNgOwner), gNgLip, gNgNear); }
    return result;
  }`;
  const nodes = [...HELPERS, ...NORMAL_GRADIENT_HELPERS, ...NORMAL_GRADIENT_GAME_HELPERS]
    .reduce<ReturnType<typeof wgslFn>[]>((acc, h) => [...acc, wgslFn(h, acc.slice(-1))], []);
  return wgslFn(source, nodes.slice(-1));
}
