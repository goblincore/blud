// src/lab/sdf-zombie/webgpu/bone-tube-geom.ts
//
// The bone tube: ONE unit mesh parameterised by (t along the bone, theta around
// it, lat on the caps), instanced per posed bone prim by bone-instancer.ts.
// tubePoint() is the CPU twin of the vertex program and the spec's honesty
// check: bone-tube-geom.test.ts pins every tube vertex to |sdPrimitive| < 1 mm
// for straight, bent, tapered, scaled, oriented and sphere prims. The maths
// mirrors validate.ts sdPrimitive (orient about the midpoint, scale, bend
// control point, radius lerp) — change one, change both.
import * as THREE from 'three/webgpu';
import type { Primitive, Vec3 } from '../types';
import type { Quat } from '../vec';
import { add, bendCtrl, cross, normalize, scale as vscale, sub, qRotate } from '../vec';

export const TUBE_RINGS = 24;
export const TUBE_SEGS = 12;
/** Cap latitude rings (pole excluded). */
export const CAP_LATS = 4;

export interface BoneInstance {
  a: Vec3; b: Vec3; c: Vec3; r1: number; r2: number; scale: Vec3; orient: Quat;
}

export function boneInstanceOf(p: Primitive): BoneInstance {
  return {
    a: p.a, b: p.b,
    c: bendCtrl(p.a, p.b, p.bend),
    r1: p.radius, r2: p.radiusB ?? p.radius,
    scale: p.scale,
    orient: p.orient ?? [0, 0, 0, 1],
  };
}

const rotAboutMid = (q: Quat, mid: Vec3, x: Vec3): Vec3 => add(mid, qRotate(q, sub(x, mid)));

/**
 * A point on the tube surface. t in [0,1] along the bone, theta around it.
 * lat (0..1, optional) selects a cap point instead: 0 = the ring at the end,
 * 1 = the pole; caps are hemispheres of the end radius about the curve's end.
 * Mirrors the vertex program in bone-instancer.ts EXACTLY.
 */
export function tubePoint(prim: Primitive, t: number, theta: number, lat?: number): Vec3 {
  const s = boneInstanceOf(prim);
  const inv: Vec3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const mul = (v: Vec3, m: Vec3): Vec3 => [v[0] * m[0], v[1] * m[1], v[2] * m[2]];
  // orient rotates the prim's own frame about its midpoint (sdPrimitive applies the
  // conjugate to the query point; rotating the prim by q is the same surface).
  const mid = vscale(add(s.a, s.b), 0.5);
  const A = mul(rotAboutMid(s.orient, mid, s.a), inv);
  const B = mul(rotAboutMid(s.orient, mid, s.b), inv);
  const C = mul(rotAboutMid(s.orient, mid, s.c), inv);
  const sphere = Math.hypot(...sub(B, A)) < 1e-9;
  const bez = (u: number): Vec3 => {
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    return [A[0] * w0 + C[0] * w1 + B[0] * w2, A[1] * w0 + C[1] * w1 + B[1] * w2, A[2] * w0 + C[2] * w1 + B[2] * w2];
  };
  const tangent = (u: number): Vec3 => {
    if (sphere) return [0, 1, 0];
    const d: Vec3 = [
      2 * (1 - u) * (C[0] - A[0]) + 2 * u * (B[0] - C[0]),
      2 * (1 - u) * (C[1] - A[1]) + 2 * u * (B[1] - C[1]),
      2 * (1 - u) * (C[2] - A[2]) + 2 * u * (B[2] - C[2])];
    return normalize(d);
  };
  const frame = (tan: Vec3): { u: Vec3; v: Vec3 } => {
    // a fixed reference so the ring never twists along the bone
    const ref: Vec3 = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(ref, tan));
    return { u, v: cross(tan, u) };
  };
  const r = s.r1 + (s.r2 - s.r1) * t;
  const centre = bez(t);
  const tan = tangent(t);
  const { u, v } = frame(tan);
  let q: Vec3;
  if (lat === undefined) {
    q = add(centre, add(vscale(u, r * Math.cos(theta)), vscale(v, r * Math.sin(theta))));
  } else {
    const out = t < 0.5 ? vscale(tan, -1) : tan;   // cap points away from the body
    const ring = Math.cos(lat * Math.PI / 2), rise = Math.sin(lat * Math.PI / 2);
    q = add(centre, add(add(vscale(u, r * ring * Math.cos(theta)), vscale(v, r * ring * Math.sin(theta))), vscale(out, r * rise)));
  }
  return mul(q, s.scale);
}

/**
 * The unit mesh: body rings then two caps. Attributes: tubeT (f32), tubeTheta
 * (f32), tubeLat (f32, -1 = body vertex). Positions are placeholders — the
 * vertex program ignores them and rebuilds from the instance.
 */
export function buildTubeGeometry(): THREE.BufferGeometry {
  const T: number[] = [], TH: number[] = [], LAT: number[] = [], idx: number[] = [];
  const push = (t: number, th: number, lat: number) => { T.push(t); TH.push(th); LAT.push(lat); return T.length - 1; };
  // body
  for (let i = 0; i <= TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) push(i / TUBE_RINGS, (j / TUBE_SEGS) * Math.PI * 2, -1);
  const body = (i: number, j: number) => i * TUBE_SEGS + (j % TUBE_SEGS);
  for (let i = 0; i < TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) {
    idx.push(body(i, j), body(i + 1, j), body(i + 1, j + 1), body(i, j), body(i + 1, j + 1), body(i, j + 1));
  }
  // caps: CAP_LATS rings (lat = k/(CAP_LATS+1), k=1..CAP_LATS) + a pole, at t = 0 and t = 1
  for (const end of [0, 1]) {
    const endRing = (j: number) => body(end === 0 ? 0 : TUBE_RINGS, j);
    const rings: number[][] = [];
    for (let k = 1; k <= CAP_LATS; k++) {
      const ring: number[] = [];
      for (let j = 0; j < TUBE_SEGS; j++) ring.push(push(end, (j / TUBE_SEGS) * Math.PI * 2, k / (CAP_LATS + 1)));
      rings.push(ring);
    }
    const pole = push(end, 0, 1);
    const prev = (j: number) => endRing(j);
    let prevRing: (j: number) => number = prev;
    for (const ring of rings) {
      const cur = (j: number) => ring[j % TUBE_SEGS]!;
      for (let j = 0; j < TUBE_SEGS; j++) {
        if (end === 0) idx.push(prevRing(j), cur(j + 1), cur(j), prevRing(j), prevRing(j + 1), cur(j + 1));
        else idx.push(prevRing(j), cur(j), cur(j + 1), prevRing(j), cur(j + 1), prevRing(j + 1));
      }
      prevRing = cur;
    }
    for (let j = 0; j < TUBE_SEGS; j++) {
      if (end === 0) idx.push(prevRing(j), pole, prevRing(j + 1));
      else idx.push(prevRing(j), prevRing(j + 1), pole);
    }
  }
  const g = new THREE.BufferGeometry();
  const n = T.length;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('tubeT', new THREE.BufferAttribute(new Float32Array(T), 1));
  g.setAttribute('tubeTheta', new THREE.BufferAttribute(new Float32Array(TH), 1));
  g.setAttribute('tubeLat', new THREE.BufferAttribute(new Float32Array(LAT), 1));
  g.setIndex(idx);
  return g;
}
