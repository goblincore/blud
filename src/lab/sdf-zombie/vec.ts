// src/lab/sdf-zombie/vec.ts
import type { Vec3 } from './types';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l === 0 ? [0, 0, 0] : scale(a, 1 / l);
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Orthonormal basis with `w` along the given axis. Used to express wound
 * positions in a primitive's local frame so they stick to moving flesh.
 */
export function basisFromAxis(axis: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = normalize(axis);
  // Pick the world axis least aligned with w, so the cross product is stable.
  const ax = Math.abs(w[0]), ay = Math.abs(w[1]), az = Math.abs(w[2]);
  const seed: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(cross(seed, w));
  const v = cross(w, u);
  return { u, v, w };
}

/** Unit quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [0, 0, 0, 1];

export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}

/** Hamilton product — qMul(a, b) rotates by b FIRST, then a. */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate v by unit quaternion q: v + 2w(u×v) + 2(u×(u×v)). */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(v, add(scale(t, q[3]), cross(u, t)));
}

/**
 * Shortest-arc rotation taking unit vector `a` onto unit vector `b`.
 * Parallel inputs return the exact identity (bit-identical rest poses);
 * anti-parallel inputs pick any perpendicular axis — the rotation is a
 * half turn either way. Inputs need not be normalised.
 */
export function qFromTo(a: Vec3, b: Vec3): Quat {
  const na = normalize(a);
  const nb = normalize(b);
  const d = Math.max(-1, Math.min(1, dot(na, nb)));
  if (d >= 1 - 1e-9) return qIdentity();
  if (d <= -1 + 1e-9) {
    const seed: Vec3 = Math.abs(na[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return qFromAxisAngle(normalize(cross(na, seed)), Math.PI);
  }
  return qNormalize(qFromAxisAngle(cross(na, nb), Math.acos(d)));
}
