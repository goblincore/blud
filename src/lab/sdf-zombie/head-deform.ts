// src/lab/sdf-zombie/head-deform.ts
//
// HEAD WOBBLE AND DENTS (spec §5; the plan's decision 1). Pure. The zombie's head is a few large ellipsoid
// prims, so deformation works along the HEAD's own axes (x right, y up, z face-forward):
//   * WOBBLE — a damped spring s(t) along the head axis nearest the blow: that axis scales by (1 − s),
//     the other two by (1 + s/2). Kicked to squash0 on a hit, rings at hz, settles in ~1 s (v2, spec §15:
//     exaggerated — 2–3 visible bounces).
//   * KNOCK SHEAR (v2) — the same spring leans the head along the blow's across-the-neck part, pivoting at the
//     head's base (the neck stays attached): a point at head-local height y moves along the blow by
//     shear · s · (y + axes.y). So the head reads as knocked, and rocks back as s rings negative.
//   * DENTS — a lasting flattening of the HIT side along the head axis nearest the blow: that side's
//     surface moves in by the dent depth and the opposite side stays put (the prims shift half the depth
//     inward and shrink half the depth along the axis). Per side (x+, x−, y+, y−, z+, z−), capped.
// Applied to the posed head prims each frame by the leaf (after applyRig, like head-pop.ts inflateHead) — the
// flesh AND the head's bone/organ prims (BuiltBody.bonePrims: the procedural skeleton path), by one affine map;
// headAffine exports that map so the skeleton-mesh path moves the skull segment mesh identically (Task 10).
// Approximation: a prim's per-axis `scale` is taken to lie along the head axes (true for the zombie's
// skull-bound head prims).
import type { Primitive, Vec3 } from './types';

type M3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface HeadFrame { centre: Vec3; quat: Quat; axes: Vec3 }

export const HEAD_DEFORM = {
  squash0: 0.4,
  maxSquash: 0.45,
  hz: 4,
  zeta: 0.18,
  /** The knock shear's lean per unit squash (see the header). */
  shear: 0.15,
  maxDent: 0.04,
  /** Below both, the spring is at rest (snapped to exactly 0). */
  restS: 1e-4,
  restV: 1e-2,
} as const;

export interface HeadDeformState {
  /** Wobble displacement and velocity (s, ds/dt). */
  s: number;
  v: number;
  /** The wobble's head axis (0 x, 1 y, 2 z). */
  axis: 0 | 1 | 2;
  /** The last blow's direction, head-local, unit (zero before any blow): the knock shear leans along it. */
  dir: Vec3;
  /** Dent depth per side, metres: [x+, x−, y+, y−, z+, z−]. */
  flat: [number, number, number, number, number, number];
}

export function makeHeadDeform(): HeadDeformState {
  return { s: 0, v: 0, axis: 0, dir: [0, 0, 0], flat: [0, 0, 0, 0, 0, 0] };
}

const argmaxAbs = (d: Vec3): 0 | 1 | 2 => {
  const a = Math.abs(d[0]), b = Math.abs(d[1]), c = Math.abs(d[2]);
  return a >= b && a >= c ? 0 : b >= c ? 1 : 2;
};

/** A hit's wobble. `dirLocal`: the blow's direction in head coordinates. */
export function kickWobble(st: HeadDeformState, dirLocal: Vec3): HeadDeformState {
  const s = Math.min(HEAD_DEFORM.maxSquash, Math.max(-HEAD_DEFORM.maxSquash, st.s + HEAD_DEFORM.squash0));
  const n = Math.hypot(dirLocal[0], dirLocal[1], dirLocal[2]);
  const dir: Vec3 = n > 0 ? [dirLocal[0] / n, dirLocal[1] / n, dirLocal[2] / n] : [0, 0, 0];
  return { ...st, s, v: 0, axis: argmaxAbs(dirLocal), dir };
}

/** Advance the spring (semi-implicit Euler; call with dt ≤ 1/60, sub-stepped inside). */
export function stepWobble(st: HeadDeformState, dt: number): HeadDeformState {
  const w = 2 * Math.PI * HEAD_DEFORM.hz, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
  let { s, v } = st;
  for (let i = 0; i < n; i++) { v += (-w * w * s - 2 * HEAD_DEFORM.zeta * w * v) * h; s += v * h; }
  // Settled: snap to exactly 0 so deformHead returns the body untouched (and a frozen re-pose stops).
  if (Math.abs(s) < HEAD_DEFORM.restS && Math.abs(v) < HEAD_DEFORM.restV) { s = 0; v = 0; }
  return { ...st, s: Math.min(HEAD_DEFORM.maxSquash, Math.max(-HEAD_DEFORM.maxSquash, s)), v };
}

export const wobbleValue = (st: HeadDeformState): number => st.s;

/** A lasting dent: the blow travelling along `dirLocal` flattens the side it came from. */
export function addDent(st: HeadDeformState, dirLocal: Vec3, depth: number, _axes: Vec3): HeadDeformState {
  const k = argmaxAbs(dirLocal);
  const side = dirLocal[k] > 0 ? 2 * k + 1 : 2 * k;   // a +x blow hits the −x side (index 1)
  const flat = [...st.flat] as HeadDeformState['flat'];
  flat[side] = Math.min(HEAD_DEFORM.maxDent, flat[side]! + depth);
  return { ...st, flat };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

const isHeadFlesh = (p: Primitive) => p.limb === 'head' && !p.dead && p.op !== 'sub' && p.op !== 'groove'
  && p.op !== 'bone' && p.op !== 'organ';
/** The head's skull and organs (BuiltBody.bonePrims): they squash and dent WITH the flesh (spec §14 decision 1 —
 *  the head is one jelly, and bone shows only where craters carve). */
const isHeadBone = (p: Primitive) => p.limb === 'head' && !p.dead && (p.op === 'bone' || p.op === 'organ');

/**
 * The head deform as one affine map of world space (plain data, for the skeleton-mesh path):
 *   x ↦ centre + Σ_k e[k] · (mul[k] · u[k] + shift[k] + lean[k] · (u[1] + pivot)),   u[k] = (x − centre) · e[k]
 * i.e. the squash/dent M = T(centre + Σ e·shift) · E · diag(mul) · Eᵀ · T(−centre) (E = [e0 e1 e2] the head
 * axes in world) plus the knock shear: head-local `lean` (lean[1] = 0) times the height above the head's
 * base (pivot = axes.y). Null when there is no deformation (no squash, no dent).
 */
export interface HeadAffine { centre: Vec3; e: [Vec3, Vec3, Vec3]; mul: Vec3; shift: Vec3; lean: Vec3; pivot: number }

export function headAffine(st: HeadDeformState, f: HeadFrame): HeadAffine | null {
  if (st.s === 0 && st.flat.every(x => x === 0)) return null;
  const e: [Vec3, Vec3, Vec3] = [rotate(f.quat, [1, 0, 0]), rotate(f.quat, [0, 1, 0]), rotate(f.quat, [0, 0, 1])];
  const mul: M3 = [1, 1, 1], shift: M3 = [0, 0, 0];
  for (const k of [0, 1, 2] as const) {
    const plus = st.flat[2 * k]!, minus = st.flat[2 * k + 1]!;
    mul[k] = 1 - (plus + minus) / (2 * f.axes[k]);
    shift[k] = (minus - plus) / 2;           // the −side dented → the prims move toward +
  }
  const s = st.s;
  for (const k of [0, 1, 2] as const) mul[k] *= k === st.axis ? 1 - s : 1 + s / 2;
  // The shear leans along the blow's across-the-neck (head x/z) part only: a blow from above does not lean.
  const k = HEAD_DEFORM.shear * s;
  const lean: M3 = [st.dir[0] * k, 0, st.dir[2] * k];
  return { centre: [f.centre[0], f.centre[1], f.centre[2]], e, mul, shift, lean, pivot: f.axes[1] };
}

/** Apply the affine to a point (the same arithmetic deformHead uses for every endpoint). */
export function applyHeadAffine(m: HeadAffine, p: Vec3): Vec3 {
  const { centre: c, e, mul, shift, lean, pivot } = m;
  const v: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const out: M3 = [c[0], c[1], c[2]];
  const up = v[0] * e[1][0] + v[1] * e[1][1] + v[2] * e[1][2] + pivot;   // height above the head's base
  for (const k of [0, 1, 2] as const) {
    const t = (v[0] * e[k][0] + v[1] * e[k][1] + v[2] * e[k][2]) * mul[k] + shift[k] + lean[k] * up;
    out[0] += e[k][0] * t; out[1] += e[k][1] * t; out[2] += e[k][2] * t;
  }
  return out;
}

/** The affine as a column-major 4x4 (three.js Matrix4.fromArray / WGSL mat4x4 order). */
export function headAffineMatrix(m: HeadAffine): number[] {
  const { centre: c, e, mul, shift, lean, pivot } = m;
  // L = Σ_k (mul[k] e[k] e[k]ᵀ + lean[k] e[k] e[1]ᵀ) ; t = c + Σ_k (shift[k] + lean[k]·pivot) e[k] − L c.
  const L: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];   // row-major 3x3
  const t: number[] = [c[0], c[1], c[2]];
  for (const k of [0, 1, 2] as const) {
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) L[r * 3 + q]! += mul[k] * e[k][r]! * e[k][q]! + lean[k] * e[k][r]! * e[1][q]!;
    for (let r = 0; r < 3; r++) t[r]! += (shift[k] + lean[k] * pivot) * e[k][r]!;
  }
  for (let r = 0; r < 3; r++) t[r]! -= L[r * 3]! * c[0] + L[r * 3 + 1]! * c[1] + L[r * 3 + 2]! * c[2];
  return [
    L[0]!, L[3]!, L[6]!, 0,
    L[1]!, L[4]!, L[7]!, 0,
    L[2]!, L[5]!, L[8]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

/** The posed body with its head (flesh AND the head's bone/organ prims) wobbled and dented. Every other prim is
 *  returned as the same object; with no deformation the body itself comes back (bonePrims the same array). */
export function deformHead<B extends { prims: Primitive[]; bonePrims?: Primitive[] }>(body: B, st: HeadDeformState, f: HeadFrame): B {
  const m = headAffine(st, f);
  if (!m) return body;
  const map = (p: Vec3): Vec3 => applyHeadAffine(m, p);
  const mul = m.mul;
  const deform = (p: Primitive): Primitive =>
    ({ ...p, a: map(p.a), b: map(p.b), scale: [p.scale[0] * mul[0], p.scale[1] * mul[1], p.scale[2] * mul[2]] as Vec3 });
  const out = { ...body, prims: body.prims.map(p => (isHeadFlesh(p) ? deform(p) : p)) };
  if (body.bonePrims) out.bonePrims = body.bonePrims.map(p => (isHeadBone(p) ? deform(p) : p));
  return out;
}
