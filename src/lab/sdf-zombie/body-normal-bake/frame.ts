// src/lab/sdf-zombie/body-normal-bake/frame.ts
//
// THE FRAME, which the shader (march/body/blocks/post/body-normal.wgsl.ts) must agree with exactly, and the texel
// encode. Shared by every bake backend, so two backends can only ever disagree on the field.
//
// axis A = normalize(tail - head); f = rest +z made perpendicular to A; s = f x A. A point's t = its fraction along
// head -> tail, its angle th = atan2(r.s, r.f) for the radial r; u = th / 2pi + 0.5 (0.5 faces +z), and the band's
// row = row0 + t * rows (row0 = the head end). Tangent = s cos th - f sin th (round the axis), bitangent = n x
// tangent (toward the head), normal = the plain surface normal; rgb = (t, b, n) mapped from -1..1. For the torso
// (A = -y) this is exactly the original projection: u = atan2(x - axisX, z - axisZ), v = 1 - t.

export type V = [number, number, number];
/** Any 3-vector these helpers read, the body's readonly Vec3 included. */
type RV = readonly [number, number, number];

export const add = (a: RV, b: RV): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: RV, b: RV): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: RV, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: RV, b: RV) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: RV): V => mul(a, 1 / Math.hypot(...a));
export const cross = (a: RV, b: RV): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A region's axis A and its round-the-axis basis f, s. */
export interface RegionFrame { A: V; f: V; s: V }

export function regionFrame(head: RV, tail: RV): RegionFrame {
  const A = norm(sub(tail, head));
  const f = norm(sub([0, 0, 1], mul(A, A[2])));
  const s = cross(f, A);
  return { A, f, s };
}

/** The axis point a band row's rays start from: the row's centre along head -> tail. */
export function rowAxisPoint(head: V, tail: V, row: number, rows: number): V {
  return add(head, mul(sub(tail, head), (row + 0.5) / rows));
}

/** A column's angle round the axis (0 faces +f, i.e. rest +z). */
export function colAngle(col: number, width: number): number {
  return ((col + 0.5) / width - 0.5) * 2 * Math.PI;
}

/** The outward ray direction at angle th. */
export function rayDir(F: RegionFrame, th: number): V {
  return norm(add(mul(F.f, Math.cos(th)), mul(F.s, Math.sin(th))));
}

const enc = (x: number) => Math.max(0, Math.min(255, Math.round((x * 0.5 + 0.5) * 255)));

/** The flat texel every miss keeps: the unbent normal. */
export function writeFlat(rgba: Uint8Array, o: number): void {
  rgba[o] = 128; rgba[o + 1] = 128; rgba[o + 2] = 255; rgba[o + 3] = 255;
}

/** Store the detailed normal `nd` in the tangent frame of the plain normal `nb`, at angle th, into texel `o`. */
export function writeTexel(rgba: Uint8Array, o: number, F: RegionFrame, th: number, nb: RV, nd: RV): void {
  const tRaw = sub(mul(F.s, Math.cos(th)), mul(F.f, Math.sin(th)));
  const T = norm(add(tRaw, mul(nb, -dot(tRaw, nb))));
  const B = cross(nb, T);
  rgba[o] = enc(dot(nd, T)); rgba[o + 1] = enc(dot(nd, B)); rgba[o + 2] = enc(Math.max(dot(nd, nb), 0.05));
}
