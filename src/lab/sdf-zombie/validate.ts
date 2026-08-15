// src/lab/sdf-zombie/validate.ts
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { add, len, lerp, scale as vscale, sub } from './vec';

/** Must match MAX_PRIMS in the fragment shader. */
export const MAX_PRIMS = 32;
/** Must match MAX_CLUSTERS in the fragment shader. */
export const MAX_CLUSTERS = 6;

export interface ValidateOpts {
  silhouetteNoiseAmp: number;
  stepMultiplier: number;
}

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Distance from p to one primitive, matching the shader's ellipsoid capsule. */
export function sdPrimitive(p: Vec3, prim: Primitive): number {
  const inv: Vec3 = [1 / prim.scale[0], 1 / prim.scale[1], 1 / prim.scale[2]];
  const q: Vec3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: Vec3 = [prim.a[0] * inv[0], prim.a[1] * inv[1], prim.a[2] * inv[2]];
  const b: Vec3 = [prim.b[0] * inv[0], prim.b[1] * inv[1], prim.b[2] * inv[2]];
  const ab = sub(b, a), ap = sub(q, a);
  const abLen2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = abLen2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2));
  const closest = add(a, vscale(ab, t));
  const minScale = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  return (len(sub(q, closest)) - prim.radius) * minScale;
}

/** Quadratic polynomial smooth-min — must match the shader exactly. */
export function smin(a: number, b: number, k: number): number {
  const kk = k * 4;
  if (kk <= 0) return Math.min(a, b);
  const h = Math.max(kk - Math.abs(a - b), 0) / kk;
  return Math.min(a, b) - h * h * kk * 0.25;
}

/** Field value over all live clusters, in fixed fold order. */
export function sdBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count))
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
  }
  return d;
}

export function validateBody(body: Body, opts: ValidateOpts): string[] {
  const errs: string[] = [];

  if (body.prims.length > MAX_PRIMS)
    errs.push(`primitive count ${body.prims.length} exceeds shader ceiling ${MAX_PRIMS}`);
  if (body.clusters.length > MAX_CLUSTERS)
    errs.push(`cluster count ${body.clusters.length} exceeds shader ceiling ${MAX_CLUSTERS}`);

  // Fold order: each cluster must own a contiguous run of same-limb primitives.
  for (const c of body.clusters) {
    const slice = body.prims.slice(c.start, c.start + c.count);
    if (slice.length !== c.count || slice.some(p => p.limb !== c.limb))
      errs.push(`cluster "${c.limb}" is not contiguous — fold order is corrupt`);
  }

  // Bounding spheres must contain their primitives, or the cull drops real surface.
  for (const c of body.clusters)
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      const maxScale = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
      for (const end of [prim.a, prim.b])
        if (len(sub(end, c.center)) + prim.radius * maxScale > c.radius + 1e-6)
          errs.push(`primitive in cluster "${c.limb}" escapes its bounding sphere`);
    }

  // Distance displacement breaks the Lipschitz bound; the step multiplier pays for it.
  if (opts.silhouetteNoiseAmp > (1 - opts.stepMultiplier) * 0.5)
    errs.push(
      `silhouette noise ${opts.silhouetteNoiseAmp} violates the Lipschitz bound at step ` +
      `multiplier ${opts.stepMultiplier} — lower the noise or the multiplier`);

  // Connectivity: every cluster must fuse into at least one other cluster.
  // Sample along the segment between cluster centres; fused ⇒ the field stays
  // inside (negative) the whole way.
  if (body.clusters.length > 1)
    for (const c of body.clusters) {
      const fused = body.clusters.some(o => o.id !== c.id && segmentInside(c.center, o.center, body));
      if (!fused) errs.push(`cluster "${c.limb}" is disconnected — not fused to any other cluster`);
    }

  return errs;
}

function segmentInside(from: Vec3, to: Vec3, body: Body): boolean {
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++)
    if (sdBody(lerp(from, to, i / STEPS), body) > 0) return false;
  return true;
}
