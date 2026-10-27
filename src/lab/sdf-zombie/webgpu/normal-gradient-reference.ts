// src/lab/sdf-zombie/webgpu/normal-gradient-reference.ts
//
// CPU reference for the analytic normal gradient: capsule, smooth min and max, wound and finite-difference gradients, plus the reason codes.

export type V3 = readonly [number, number, number];

export type NgReason = 'ok' | 'unsupported' | 'degenerate' | 'hard-boundary'
  | 'owner-unstable' | 'wound-pending' | 'sampled-cache' | 'inactive';

/** THE HEAD SPLIT's code, after NgReason's eight (0..7 in that order): the hit is inside an open head's region
 *  sphere, where the march does not ask the analytic gradient at all (march/body/blocks/post/shading-normal.wgsl.ts). */
export const NG_REASON_SPLIT = 8;
/** How many reason codes the march reports (0..NG_REASON_SPLIT). */
export const NG_REASON_CODES = NG_REASON_SPLIT + 1;
/** Where a coverage reader counts a pixel of reason `code` whose dominant prim is `owner`: not at all (background, an
 *  unknown code, no prim), apart as a split-region pixel (the closed body is the wrong oracle for it: its surface
 *  there is a turned or capped piece), or against the body. */
export function ngCoverageClass(code: number, owner: number): 'skip' | 'split' | 'body' {
  if (!(code >= 0 && code < NG_REASON_CODES) || owner < 0) return 'skip';
  return code === NG_REASON_SPLIT ? 'split' : 'body';
}

export interface Dg {
  d: number;
  g: V3;
  reason: NgReason;
}

export interface CapsuleInput {
  a: V3;
  b: V3;
  r: number;
  scale: V3;
}

export interface WoundInput {
  center: V3;
  depth: number;
  cap: number;
  inward: V3;
  blend: number;
  rimPosition: number;
  rimWidth: number;
  rimAmp: number;
}

const ZERO: V3 = [0, 0, 0];

function assertFinite(label: string, values: readonly number[]): void {
  if (!values.every(Number.isFinite)) throw new RangeError(`${label} must be finite`);
}

function assertDg(label: string, x: Dg): void {
  assertFinite(`${label} value and gradient`, [x.d, ...x.g]);
}

/** Value and unnormalized gradient of the production untapered capsule field. */
export function capsuleGradient(p: V3, s: CapsuleInput): Dg {
  assertFinite('capsule input', [...p, ...s.a, ...s.b, s.r, ...s.scale]);
  if (s.scale.some(x => x <= 0)) throw new RangeError('capsule scale must be positive');

  const inv: V3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const q: V3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: V3 = [s.a[0] * inv[0], s.a[1] * inv[1], s.a[2] * inv[2]];
  const b: V3 = [s.b[0] * inv[0], s.b[1] * inv[1], s.b[2] * inv[2]];
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: V3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const ab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const projected = ab2 === 0
    ? 0
    : (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2;
  const t = Math.max(0, Math.min(1, projected));
  const c: V3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  const v: V3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
  const vLen = Math.hypot(...v);
  const minScale = Math.min(...s.scale);
  const d = (vLen - s.r) * minScale;
  if (vLen === 0) return { d, g: ZERO, reason: 'degenerate' };

  const g: V3 = [
    v[0] / vLen * inv[0] * minScale,
    v[1] / vLen * inv[1] * minScale,
    v[2] / vLen * inv[2] * minScale,
  ];
  assertFinite('capsule result', [d, ...g]);
  return { d, g, reason: 'ok' };
}

/** A tapered prim: `r` at a, `r2` at b (r2 >= 0; coneCap in march/primitives.wgsl.ts). */
export interface ConeInput extends CapsuleInput {
  r2: number;
}

/** Value and unnormalized gradient of the production round cone (coneCap's tapered branch), in the same scaled
 * space as capsuleGradient. Each of coneCap's three regions is a closed form: the two end caps are spheres, and the
 * side is |pa_perp| * cos(half-angle) + (pa . axis) * sin(half-angle), whose gradient is a unit vector. Outside the
 * cone the field is a convex body's distance, so the three pieces meet with a continuous gradient. */
export function roundConeGradient(p: V3, s: ConeInput): Dg {
  assertFinite('cone input', [...p, ...s.a, ...s.b, s.r, s.r2, ...s.scale]);
  if (s.scale.some(x => x <= 0)) throw new RangeError('cone scale must be positive');
  const inv: V3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const q: V3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: V3 = [s.a[0] * inv[0], s.a[1] * inv[1], s.a[2] * inv[2]];
  const b: V3 = [s.b[0] * inv[0], s.b[1] * inv[1], s.b[2] * inv[2]];
  const minScale = Math.min(...s.scale);
  const toWorld = (d: number, gq: V3, reason: NgReason): Dg =>
    ({ d: d * minScale, g: [gq[0] * inv[0] * minScale, gq[1] * inv[1] * minScale, gq[2] * inv[2] * minScale], reason });
  const sphere = (c: V3, r: number): Dg => {
    const v: V3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    const vl = Math.hypot(...v);
    return vl === 0 ? toWorld(vl - r, ZERO, 'degenerate') : toWorld(vl - r, [v[0] / vl, v[1] / vl, v[2] / vl], 'ok');
  };
  const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  if (l2 < 1e-12) return sphere(a, Math.max(s.r, s.r2));
  const rr = s.r - s.r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa: V3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const z = y - l2;
  const x: V3 = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y];
  const x2 = x[0] ** 2 + x[1] ** 2 + x[2] ** 2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z * z * l2 > k) return sphere(b, s.r2);
  if (Math.sign(y) * a2 * y * y * l2 < k) return sphere(a, s.r);
  const d = (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - s.r;
  // A point on the axis: |pa_perp| = sqrt(x2) / l2 has no direction.
  if (Math.sqrt(x2) <= 1e-9 * l2) return toWorld(d, ZERO, 'degenerate');
  const c = Math.sqrt(a2 * il2) / Math.sqrt(x2);
  return toWorld(d, [x[0] * c + ba[0] * rr * il2, x[1] * c + ba[1] * rr * il2, x[2] * c + ba[2] * rr * il2], 'ok');
}

/** A bent prim: the quadratic Bezier a -> c -> b, `c` the resolved control point in world (bendCtrl). */
export interface BentInput extends ConeInput {
  c: V3;
}

/** Value and unnormalized gradient of the production bent cone (coneBend; sdBentCone in validate.ts). The field is
 * min over t of G(t) = |q - P(t)| - r(t), so at the minimiser t* (interior or an end: the interval does not move
 * with q) the gradient is the unit vector from P(t*) to q. A second basin of G within the stencil's reach is the
 * medial crease on a bend's inner side ('hard-boundary'). t* comes from a dense grid and Newton in f64. */
export function bentConeGradient(p: V3, s: BentInput): Dg {
  assertFinite('bent input', [...p, ...s.a, ...s.b, ...s.c, s.r, s.r2, ...s.scale]);
  if (s.scale.some(x => x <= 0)) throw new RangeError('bent scale must be positive');
  const inv: V3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const sc = (v: V3): V3 => [v[0] * inv[0], v[1] * inv[1], v[2] * inv[2]];
  const q = sc(p), a = sc(s.a), b = sc(s.b), c = sc(s.c);
  const e2: V3 = [a[0] - 2 * c[0] + b[0], a[1] - 2 * c[1] + b[1], a[2] - 2 * c[2] + b[2]];
  const ab2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2;
  if (Math.hypot(...e2) ** 2 < 1e-12 || ab2 < 1e-12) return roundConeGradient(p, s);
  const e1: V3 = [2 * (c[0] - a[0]), 2 * (c[1] - a[1]), 2 * (c[2] - a[2])];
  const at = (t: number): V3 => [a[0] + e1[0] * t + e2[0] * t * t, a[1] + e1[1] * t + e2[1] * t * t, a[2] + e1[2] * t + e2[2] * t * t];
  const G = (t: number): number => { const P = at(t); return Math.hypot(q[0] - P[0], q[1] - P[1], q[2] - P[2]) - (s.r + (s.r2 - s.r) * t); };
  const N = 2000;
  const gs = Array.from({ length: N + 1 }, (_, i) => G(i / N));
  let k = 0;
  for (let i = 1; i <= N; i++) if (gs[i]! < gs[k]!) k = i;
  // Golden-section on the bracketing cells: G is smooth there, and f64 takes it to the f32 field's own precision.
  let lo = Math.max(0, (k - 1) / N), hi = Math.min(1, (k + 1) / N);
  for (let it = 0; it < 80; it++) {
    const m1 = lo + (hi - lo) * 0.381966, m2 = hi - (hi - lo) * 0.381966;
    if (G(m1) < G(m2)) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2;
  const minScale = Math.min(...s.scale);
  const d = G(t) * minScale;
  // Another local minimum of the grid, separated from t* by a hump, within the stencil's reach: the crease.
  const Rq = NG_STENCIL_R * Math.max(...inv);
  let reason: NgReason = 'ok';
  for (let i = 0; i <= N; i++) {
    if (Math.abs(i - k) < 2) continue;
    const left = i === 0 || gs[i]! <= gs[i - 1]!, right = i === N || gs[i]! <= gs[i + 1]!;
    if (!left || !right || gs[i]! - gs[k]! > 2 * Rq) continue;
    const lo2 = Math.min(i, k), hi2 = Math.max(i, k);
    let hump = -Infinity;
    for (let j = lo2; j <= hi2; j++) hump = Math.max(hump, gs[j]!);
    if (hump > gs[i]! + 1e-9) reason = 'hard-boundary';
  }
  const P = at(t);
  const v: V3 = [q[0] - P[0], q[1] - P[1], q[2] - P[2]];
  const vl = Math.hypot(...v);
  if (vl === 0) return { d, g: ZERO, reason: 'degenerate' };
  return { d, g: [v[0] / vl * inv[0] * minScale, v[1] / vl * inv[1] * minScale, v[2] / vl * inv[2] * minScale], reason };
}

/** A box prim: a rounded cube of half-extent `r` (scale-divided frame) swept along a -> b, `round` its fraction. */
export interface BoxInput extends CapsuleInput {
  round: number;
}

/** Value and unnormalized gradient of the production swept box (sdPrim's box branch). With w = q - closest(q), the
 * rounded box's gradient goes through dw/dq: the projector off the axis while the clamped t is interior, the
 * identity past either end. Two switches are kinks: two faces tied (inside, or outside within the stencil of an edge
 * the rounding leaves sharp), and either end's plane where the box's gradient has an axial part. */
export function boxGradient(p: V3, s: BoxInput): Dg {
  assertFinite('box input', [...p, ...s.a, ...s.b, s.r, s.round, ...s.scale]);
  if (s.scale.some(x => x <= 0)) throw new RangeError('box scale must be positive');
  const inv: V3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const q: V3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: V3 = [s.a[0] * inv[0], s.a[1] * inv[1], s.a[2] * inv[2]];
  const b: V3 = [s.b[0] * inv[0], s.b[1] * inv[1], s.b[2] * inv[2]];
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const raw = ab2 === 0 ? 0 : ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / ab2;
  const t = Math.max(0, Math.min(1, raw));
  const w: V3 = [q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t, q[2] - a[2] - ab[2] * t];
  const e = s.r * (1 - s.round);
  const qv: V3 = [Math.abs(w[0]) - e, Math.abs(w[1]) - e, Math.abs(w[2]) - e];
  const mx = Math.max(...qv);
  const m: V3 = [Math.max(qv[0], 0), Math.max(qv[1], 0), Math.max(qv[2], 0)];
  const minScale = Math.min(...s.scale);
  const d = (Math.hypot(...m) + Math.min(mx, 0) - s.r * s.round) * minScale;
  const Rq = NG_STENCIL_R * Math.max(...inv);
  let reason: NgReason = 'ok';
  const sorted = [...qv].sort((x, y) => y - x);
  if (sorted[0]! - sorted[1]! <= 2 * Rq && sorted[0]! <= 2 * Rq) reason = 'hard-boundary';
  let gw: V3;
  if (mx > 0) {
    const ml = Math.hypot(...m);
    gw = [Math.sign(w[0]) * m[0] / ml, Math.sign(w[1]) * m[1] / ml, Math.sign(w[2]) * m[2] / ml];
  } else {
    const i = qv.indexOf(mx);
    if (w[i] === 0) return { d, g: ZERO, reason: 'degenerate' };
    const axis: [number, number, number] = [0, 0, 0];
    axis[i] = Math.sign(w[i]!);
    gw = axis;
  }
  if (ab2 > 0) {
    const axial = (gw[0] * ab[0] + gw[1] * ab[1] + gw[2] * ab[2]) / ab2;
    const abl = Math.sqrt(ab2);
    if (Math.abs(axial) * abl > 1e-6 && (Math.abs(raw) * abl <= Rq || Math.abs(raw - 1) * abl <= Rq) && reason === 'ok') reason = 'hard-boundary';
    if (raw > 0 && raw < 1) gw = [gw[0] - ab[0] * axial, gw[1] - ab[1] * axial, gw[2] - ab[2] * axial];
  }
  return { d, g: [gw[0] * inv[0] * minScale, gw[1] * inv[1] * minScale, gw[2] * inv[2] * minScale], reason };
}

/** A shell prim's sheet parameters (ShellParams, plus the wind drift and body anchor the fold reads). */
export interface ShellInput {
  thickness: number;
  clipNormal: V3;
  clipOffset: number;
  rim: number;
  warpAmp?: number;
  warpFreq?: V3;
  warpDrift?: V3;
  bodyAnchor?: V3;
}

/** The stencil ball's radius: calcNormal's tetrahedral taps sit sqrt(3) * 1.5 mm from the hit. */
export const NG_STENCIL_R = Math.sqrt(3) * 0.0015;

/** Value and gradient of the production shell (sdShellWrap / sdShell) taken off a closed base field and its gradient.
 * Its kinks (the sheet's crease mid-sheet, the hard sheet/plane tie inside the rounded corner, a corner sharper than
 * the stencil) are 'hard-boundary': within the stencil ball of one, finite differences straddle two gradients. The warp is a product of sines, differentiated through noiseLocal's affine body frame. */
export function shellGradient(base: Dg, p: V3, s: ShellInput): Dg {
  assertDg('shell base', base);
  const R = NG_STENCIL_R;
  let reason: NgReason = base.reason;
  const flag = (bad: boolean): void => { if (bad && reason === 'ok') reason = 'hard-boundary'; };
  let bd = base.d;
  let bg: V3 = base.g;
  let lip = 1;
  const A = s.warpAmp ?? 0;
  const F = s.warpFreq ?? ZERO;
  const fLen = Math.hypot(...F);
  if (A !== 0 && fLen !== 0) {
    const drift = s.warpDrift ?? ZERO;
    const anchor = s.bodyAnchor ?? ZERO;
    const lx = p[0] - drift[0] - anchor[0], dy = p[1] - drift[1], lz = p[2] - drift[2] - anchor[2];
    const ch = Math.cos(anchor[1]), sh = Math.sin(anchor[1]);
    const qx = lx * ch - lz * sh, qy = dy, qz = lx * sh + lz * ch;
    const sx = Math.sin(F[0] * qx), sy = Math.sin(F[1] * qy + 1.3), sz = Math.sin(F[2] * qz + 2.6);
    const gq: V3 = [
      A * F[0] * Math.cos(F[0] * qx) * sy * sz,
      A * sx * F[1] * Math.cos(F[1] * qy + 1.3) * sz,
      A * sx * sy * F[2] * Math.cos(F[2] * qz + 2.6),
    ];
    bd += A * sx * sy * sz;
    bg = [bg[0] + gq[0] * ch + gq[2] * sh, bg[1] + gq[1], bg[2] - gq[0] * sh + gq[2] * ch];
    lip = 1 + Math.abs(A) * fLen;
  }
  flag(Math.abs(bd) <= lip * R);
  const sg = bd >= 0 ? 1 : -1;
  const d: Dg = { d: Math.abs(bd) - s.thickness, g: [sg * bg[0], sg * bg[1], sg * bg[2]], reason };
  const n = s.clipNormal;
  const dPlane = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - s.clipOffset;
  // The rounded intersection min(-rim, max(sheet, plane)) + |max((sheet, plane) + rim, 0)|. In the corner (both
  // shifted values positive) it is the quarter circle, whose gradient is the weighted sum below; with one positive
  // it is that face; with neither, the hard max. Only that last region's tie, and a corner sharper than the stencil
  // (rim near 0), are kinks: the circle meets each face with the face's own gradient.
  const reach = 2 * (lip + Math.hypot(...n)) * R;
  const u = d.d + s.rim, v = dPlane + s.rim;
  // Within reach of the tie ray (u = v <= 0) or its end at the origin, which is the apex of a corner at rim 0.
  flag(u + v <= 0 ? Math.abs(u - v) <= reach : Math.hypot(u, v) <= reach);
  let m: Dg;
  if (u > 0 && v > 0) {
    const len = Math.hypot(u, v);
    m = { d: len - s.rim, g: [0, 1, 2].map(i => (u * d.g[i]! + v * n[i]!) / len) as unknown as V3, reason };
  } else if (u > 0) m = d;
  else if (v > 0) m = { d: dPlane, g: n, reason };
  else m = d.d >= dPlane ? d : { d: dPlane, g: n, reason };
  return { d: m.d / lip, g: [m.g[0] / lip, m.g[1] / lip, m.g[2] / lip], reason };
}

/** Production chamfer union (sminChamfer): min(min(a, b), (a - K + b) / sqrt 2), a piecewise-linear blend whose
 * two switches are kinks. Ties within `margin` of either switch are 'hard-boundary'. */
export function chamferMinGradient(a: Dg, b: Dg, kIn: number, margin = 4 * NG_STENCIL_R): Dg {
  const K = 4 * kIn;
  if (K <= 0) return smoothMinGradient(a, b, kIn);
  const m = a.d <= b.d ? a : b;
  const c: Dg = {
    d: (a.d - K + b.d) * Math.SQRT1_2,
    g: [(a.g[0] + b.g[0]) * Math.SQRT1_2, (a.g[1] + b.g[1]) * Math.SQRT1_2, (a.g[2] + b.g[2]) * Math.SQRT1_2],
    reason: contributingReason(a, b, 0.5),
  };
  if (Math.abs(m.d - c.d) <= margin) return { ...(c.d < m.d ? c : m), reason: 'hard-boundary' };
  if (c.d < m.d) return c;
  return Math.abs(a.d - b.d) <= margin ? { ...m, reason: 'hard-boundary' } : { ...m };
}

function contributingReason(a: Dg, b: Dg, wa: number): NgReason {
  if (wa > 0 && a.reason !== 'ok') return a.reason;
  if (wa < 1 && b.reason !== 'ok') return b.reason;
  return 'ok';
}

/** Production quadratic smooth-min, differentiating the scalar convention exactly. */
export function smoothMinGradient(a: Dg, b: Dg, kIn: number): Dg {
  assertDg('smooth-min a', a);
  assertDg('smooth-min b', b);
  assertFinite('smooth-min k', [kIn]);
  const k = 4 * kIn;
  if (k <= 0) {
    if (a.d === b.d) {
      const invalid = contributingReason(a, b, 0.5);
      return { d: a.d, g: ZERO, reason: invalid === 'ok' ? 'hard-boundary' : invalid };
    }
    return a.d < b.d ? { ...a } : { ...b };
  }

  const h = Math.max(k - Math.abs(a.d - b.d), 0) / k;
  const wa = a.d <= b.d ? 1 - h / 2 : h / 2;
  return {
    d: Math.min(a.d, b.d) - h * h * k / 4,
    g: [
      wa * a.g[0] + (1 - wa) * b.g[0],
      wa * a.g[1] + (1 - wa) * b.g[1],
      wa * a.g[2] + (1 - wa) * b.g[2],
    ],
    reason: contributingReason(a, b, wa),
  };
}

/** Smooth maximum expressed as -smoothMin(-a, -b), including its derivative. */
export function smoothMaxGradient(a: Dg, b: Dg, kIn: number): Dg {
  const neg = (x: Dg): Dg => ({
    d: -x.d,
    g: [-x.g[0], -x.g[1], -x.g[2]],
    reason: x.reason,
  });
  const folded = smoothMinGradient(neg(a), neg(b), kIn);
  return {
    d: -folded.d,
    g: [-folded.g[0], -folded.g[1], -folded.g[2]],
    reason: folded.reason,
  };
}

function assertStencilInput(p: V3, eps: number): void {
  assertFinite('gradient sample point and epsilon', [...p, eps]);
  if (eps <= 0) throw new RangeError('gradient epsilon must be positive');
}

/** Independent six-sample central difference, used only as a diagnostic oracle. */
export function finiteGradient(f: (p: V3) => number, p: V3, eps: number): V3 {
  assertStencilInput(p, eps);
  const sample = (axis: number, delta: number): number => {
    const q = [...p] as [number, number, number];
    q[axis] = q[axis]! + delta;
    const value = f(q);
    assertFinite('finite-gradient sample', [value]);
    return value;
  };
  const den = 2 * eps;
  return [
    (sample(0, eps) - sample(0, -eps)) / den,
    (sample(1, eps) - sample(1, -eps)) / den,
    (sample(2, eps) - sample(2, -eps)) / den,
  ];
}

/** Four-sample tetrahedral stencil used by the planned detail-only GPU path. */
export function detailGradient(f: (p: V3) => number, p: V3, eps: number): V3 {
  assertStencilInput(p, eps);
  const signs: readonly V3[] = [
    [1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1],
  ];
  let gx = 0, gy = 0, gz = 0;
  for (const s of signs) {
    const value = f([p[0] + eps * s[0], p[1] + eps * s[1], p[2] + eps * s[2]]);
    assertFinite('detail-gradient sample', [value]);
    gx += s[0] * value;
    gy += s[1] * value;
    gz += s[2] * value;
  }
  const den = 4 * eps;
  return [gx / den, gy / den, gz / den];
}

/** Ordered production wound fold; every rim uses the ORIGINAL carved flesh. */
export function woundGradient(base: Dg, p: V3, wounds: readonly WoundInput[]): Dg {
  assertDg('wound base', base);
  assertFinite('wound point', p);
  let d = base;
  for (const w of wounds) {
    assertFinite('wound', [...w.center, w.depth, w.cap, ...w.inward, w.blend, w.rimPosition, w.rimWidth, w.rimAmp]);
    if (w.rimWidth <= 0 || w.rimAmp < 0) throw new RangeError('invalid wound rim');
    const v = p.map((x, i) => x - w.center[i]!) as unknown as V3;
    const r = Math.hypot(...v);
    const sphere = w.depth-r;
    const slab = w.cap-v.reduce((s,x,i)=>s+x*w.inward[i]!,0);
    const corner = Math.abs(sphere-slab) < 1e-7;
    const cutter: Dg = {
      d: Math.min(sphere,slab),
      g: sphere < slab && r > 0 ? v.map(x=>-x/r) as unknown as V3 : w.inward.map(x=>-x) as unknown as V3,
      reason: r === 0 ? 'degenerate' : corner ? 'hard-boundary' : 'ok',
    };
    const before=d.d;
    d = smoothMaxGradient(d,cutter,w.blend);
    // Conservatively keep singularity reasons even when a blend excludes them.
    if (cutter.reason !== 'ok') d = {...d,reason:cutter.reason};
    if (w.blend <= 0 && Math.abs(before-cutter.d)<1e-7) d={...d,reason:'hard-boundary'};
    if (w.rimAmp === 0) continue;
    const x=(r-w.rimPosition)/w.rimWidth;
    const bump=w.rimAmp*Math.exp(-x*x);
    const u=Math.max(0,Math.min(1,(base.d+.3*w.rimAmp)/w.rimAmp));
    const m=1-u*u*(3-2*u);
    const gateFactor=-(6*u*(1-u)/w.rimAmp);
    const g=d.g.map((a,i)=>a-m*bump*(-2*x/w.rimWidth)*(r>0?v[i]!/r:0)-bump*gateFactor*base.g[i]!) as unknown as V3;
    d={d:d.d-bump*m,g,reason:d.reason !== 'ok' ? d.reason : gateFactor*bump !== 0 ? base.reason : 'ok'};
  }
  return d;
}
