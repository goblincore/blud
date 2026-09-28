// src/lab/sdf-zombie/head-deform.ts
//
// HEAD WOBBLE AND DENTS (spec §5; the plan's decision 1). Pure. The zombie's head is a few large ellipsoid
// prims, so deformation works along the HEAD's own axes (x right, y up, z face-forward):
//   * WOBBLE — a damped spring s(t) along the head axis nearest the blow: that axis scales by (1 − s),
//     the other two by (1 + s/2). Kicked to squash0 on a hit, rings at hz, settles in ~0.5 s.
//   * DENTS — a lasting flattening of the HIT side along the head axis nearest the blow: that side's
//     surface moves in by the dent depth and the opposite side stays put (the prims shift half the depth
//     inward and shrink half the depth along the axis). Per side (x+, x−, y+, y−, z+, z−), capped.
// Applied to the posed head prims each frame by the leaf (after applyRig, like head-pop.ts inflateHead).
// Approximation: a prim's per-axis `scale` is taken to lie along the head axes (true for the zombie's
// skull-bound head prims).
import type { Primitive, Vec3 } from './types';

type M3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface HeadFrame { centre: Vec3; quat: Quat; axes: Vec3 }

export const HEAD_DEFORM = {
  squash0: 0.25,
  maxSquash: 0.3,
  hz: 8,
  zeta: 0.25,
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
  /** Dent depth per side, metres: [x+, x−, y+, y−, z+, z−]. */
  flat: [number, number, number, number, number, number];
}

export function makeHeadDeform(): HeadDeformState {
  return { s: 0, v: 0, axis: 0, flat: [0, 0, 0, 0, 0, 0] };
}

const argmaxAbs = (d: Vec3): 0 | 1 | 2 => {
  const a = Math.abs(d[0]), b = Math.abs(d[1]), c = Math.abs(d[2]);
  return a >= b && a >= c ? 0 : b >= c ? 1 : 2;
};

/** A hit's wobble. `dirLocal`: the blow's direction in head coordinates. */
export function kickWobble(st: HeadDeformState, dirLocal: Vec3): HeadDeformState {
  const s = Math.min(HEAD_DEFORM.maxSquash, Math.max(-HEAD_DEFORM.maxSquash, st.s + HEAD_DEFORM.squash0));
  return { ...st, s, v: 0, axis: argmaxAbs(dirLocal) };
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

/** The posed body with its head wobbled and dented. Non-head prims are returned as the same objects. */
export function deformHead<B extends { prims: Primitive[] }>(body: B, st: HeadDeformState, f: HeadFrame): B {
  const e: [Vec3, Vec3, Vec3] = [rotate(f.quat, [1, 0, 0]), rotate(f.quat, [0, 1, 0]), rotate(f.quat, [0, 0, 1])];
  const mul: M3 = [1, 1, 1], shift: M3 = [0, 0, 0];
  for (const k of [0, 1, 2] as const) {
    const plus = st.flat[2 * k]!, minus = st.flat[2 * k + 1]!;
    mul[k] = 1 - (plus + minus) / (2 * f.axes[k]);
    shift[k] = (minus - plus) / 2;           // the −side dented → the prims move toward +
  }
  const s = st.s;
  for (const k of [0, 1, 2] as const) mul[k] *= k === st.axis ? 1 - s : 1 + s / 2;
  if (s === 0 && st.flat.every(x => x === 0)) return body;
  const map = (p: Vec3): Vec3 => {
    const v: Vec3 = [p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]];
    const out: M3 = [f.centre[0], f.centre[1], f.centre[2]];
    for (const k of [0, 1, 2] as const) {
      const c = (v[0] * e[k][0] + v[1] * e[k][1] + v[2] * e[k][2]) * mul[k] + shift[k];
      out[0] += e[k][0] * c; out[1] += e[k][1] * c; out[2] += e[k][2] * c;
    }
    return out;
  };
  return {
    ...body,
    prims: body.prims.map(p => (isHeadFlesh(p)
      ? { ...p, a: map(p.a), b: map(p.b), scale: [p.scale[0] * mul[0], p.scale[1] * mul[1], p.scale[2] * mul[2]] as Vec3 }
      : p)),
  };
}
