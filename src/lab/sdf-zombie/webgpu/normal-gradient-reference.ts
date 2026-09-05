export type V3 = readonly [number, number, number];

export type NgReason = 'ok' | 'unsupported' | 'degenerate' | 'hard-boundary'
  | 'owner-unstable' | 'wound-pending' | 'sampled-cache' | 'inactive';

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
