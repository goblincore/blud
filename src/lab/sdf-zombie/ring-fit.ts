// src/lab/sdf-zombie/ring-fit.ts
//
// Fit existing .blob primitives to a reference surface by reading the SIGNED
// RESIDUAL OF OUR OWN FIELD at reference points.
//
// WHY THE RESIDUAL AND NOT THE RING OUTLINE DIRECTLY. Primitives smooth-union,
// and smin(a, b) < min(a, b), so the union surface is always FATTER than any
// single primitive. Reading a measured ring straight onto a prim's `r`
// systematically over-fattens — which is visible being corrected by hand all
// through mouse.blob's comments. sdBody IS the blended field, so its value at
// a reference point is the error with blending already folded in.
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { sdBody, sdPrimitive } from './validate';
import { add, len, normalize, scale as vscale, sub } from './vec';

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Central-difference gradient of sdBody, normalised. */
function gradient(p: Vec3, body: Body, h = 1e-4): Vec3 {
  const g: Vec3 = [
    sdBody([p[0] + h, p[1], p[2]], body) - sdBody([p[0] - h, p[1], p[2]], body),
    sdBody([p[0], p[1] + h, p[2]], body) - sdBody([p[0], p[1] - h, p[2]], body),
    sdBody([p[0], p[1], p[2] + h], body) - sdBody([p[0], p[1], p[2] - h], body),
  ];
  return len(g) < 1e-12 ? [0, 1, 0] : normalize(g);
}

/**
 * Newton-step a point onto sdBody == 0. Converges from either side; the field
 * is not a true distance for anisotropic prims (it under-reports by minScale),
 * so this iterates rather than taking one step.
 */
export function projectToSurface(p: Vec3, body: Body, steps = 24): Vec3 {
  let q = p;
  for (let i = 0; i < steps; i++) {
    const d = sdBody(q, body);
    if (Math.abs(d) < 1e-9) break;
    q = sub(q, vscale(gradient(q, body), d));
  }
  return q;
}

/**
 * Synthesise a reference-shaped point set FROM a body: sample each primitive's
 * own surface, then project onto the blended body. Test instrument, and the
 * only way to check the fitter against ground truth without a GLB.
 */
export function sampleBodySurface(body: Body, perPrim = 200): Map<string, Vec3[]> {
  const out = new Map<string, Vec3[]>();
  for (const prim of body.prims) {
    if (prim.dead || prim.op === 'sub' || prim.op === 'groove') continue;
    const bone = prim.bone ?? 'unknown';
    let list = out.get(bone);
    if (list === undefined) { list = []; out.set(bone, list); }
    const axis = sub(prim.b, prim.a);
    const axisLen = len(axis);
    for (let i = 0; i < perPrim; i++) {
      // Deterministic spiral over the prim's own surface: no Math.random, so
      // a failing test reproduces exactly.
      const t = perPrim === 1 ? 0.5 : i / (perPrim - 1);
      const theta = i * 2.399963229728653; // golden angle, in radians
      const along = add(prim.a, vscale(axis, axisLen === 0 ? 0 : t));
      const r = prim.radius + ((prim.radiusB ?? prim.radius) - prim.radius) * t;
      // Push out along a world-axis ring, scaled by the prim's own anisotropy.
      const seed: Vec3 = [Math.cos(theta) * prim.scale[0], 0, Math.sin(theta) * prim.scale[2]];
      const p = add(along, vscale(seed, r * 1.4));
      const q = projectToSurface(p, body);
      if (Math.abs(sdBody(q, body)) < 1e-6) list.push(q);
    }
  }
  return out;
}

/** Nearest and second-nearest add-primitive indices, mirroring nearestPrim's skips. */
export function twoNearestPrims(p: Vec3, body: Body): { first: number; firstD: number; secondD: number } {
  let first = -1, firstD = Infinity, secondD = Infinity;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) {
      const prim = body.prims[i]!;
      if (prim.op === 'sub' || prim.op === 'groove' || prim.dead) continue;
      const d = sdPrimitive(p, prim);
      if (d < firstD) { secondD = firstD; firstD = d; first = i; }
      else if (d < secondD) { secondD = d; }
    }
  }
  return { first, firstD, secondD };
}
