// src/lab/sdf-zombie/validate.ts
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { add, cross, len, lerp, scale as vscale, sub } from './vec';

/**
 * Shader array ceilings. THE canonical declaration — `march.glsl.ts` imports
 * these and bakes them into the GLSL, so the CPU field and the GPU field
 * cannot drift apart. They were separately declared in both files until
 * 2026-08-15; if they disagree the shader reads past the uniform array.
 *
 * 48 fits the 21-primitive body plus a ~13-primitive face with headroom. The
 * cost is uniform space: the fragment shader lands around 300 vec4 against a
 * GLES 3.0 guaranteed minimum of 224. The development machine (Apple M3)
 * reports MAX_FRAGMENT_UNIFORM_VECTORS = 1024, so this is a portability note
 * rather than a blocker. The escape hatch, if a low-end GLES 3.0 target ever
 * matters, is a float data texture read with texelFetch.
 */
export const MAX_PRIMS = 48;
export const MAX_CLUSTERS = 6;

export interface ValidateOpts {
  silhouetteNoiseAmp: number;
  stepMultiplier: number;
}

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Distance from p to one primitive, matching the shader's ellipsoid capsule. */
export function sdPrimitive(p: Vec3, prim: Primitive): number {
  let qv: Vec3 = p;
  let av = prim.a;
  let bv = prim.b;
  // Per-prim orientation, the exact CPU mirror of sdPrimO in march.wgsl.ts:
  // conjugate rotation about the prim midpoint BEFORE the scale-divide, so a
  // rig-posed face ellipsoid's squash turns with the head. The WGSL hoists
  // the choice between sdPrim and sdPrimO to a cluster flag purely as a
  // texture-fetch optimisation — sdPrimO on an identity quat runs sdPrim's
  // exact op sequence, so this per-prim branch is bit-identical to both.
  const o = prim.orient;
  if (o && Math.abs(1 - o[3]) > 1e-6) {
    const mid = vscale(add(prim.a, prim.b), 0.5);
    const u: Vec3 = [-o[0], -o[1], -o[2]]; // conjugate: negate the vector part
    const w = o[3];
    const rot = (x: Vec3): Vec3 => {
      const v = sub(x, mid);
      const t = vscale(cross(u, v), 2);
      return add(mid, add(v, add(vscale(t, w), cross(u, t))));
    };
    qv = rot(qv);
    av = rot(av);
    bv = rot(bv);
  }
  const inv: Vec3 = [1 / prim.scale[0], 1 / prim.scale[1], 1 / prim.scale[2]];
  const q: Vec3 = [qv[0] * inv[0], qv[1] * inv[1], qv[2] * inv[2]];
  const a: Vec3 = [av[0] * inv[0], av[1] * inv[1], av[2] * inv[2]];
  const b: Vec3 = [bv[0] * inv[0], bv[1] * inv[1], bv[2] * inv[2]];
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

/** Smooth subtraction. Must match the shader's smax exactly. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/**
 * Field value over all live clusters, in fixed fold order.
 *
 * Two passes, and the order is load-bearing. Every ADDITIVE primitive folds
 * first, then every carve is subtracted from the assembled result. Carving
 * per-cluster instead would restructure a non-associative smooth-min fold and
 * change the surface everywhere, forcing a retune of every authored blendK.
 *
 * Mirrors mapBody + applyCarves in march.glsl.ts, and must stay in step: this
 * field also backs click-to-shoot raycasting, so drift means shots land where
 * the body isn't — or inside an eye socket. primScale.w semantics are shared
 * with the shaders: 0 add, 1 carve, 2 dead — dead prims skip BOTH passes.
 */
export function sdBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.dead) continue;
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op !== 'sub' || prim.dead) continue;
      d = smax(d, -sdPrimitive(p, prim), prim.blendK);
    }
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

  // Bounding spheres must contain their SOLID primitives, or the cull drops
  // real surface. Carves are skipped for the same reason clusters.ts excludes
  // them from the fit: they carry no surface to lose. Dead prims likewise —
  // they are not in the field. The connectivity check below deliberately does
  // NOT skip carves — it runs on the carved field, so a socket deep enough to
  // detach the head from the neck is reported.
  for (const c of body.clusters)
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.dead) continue;
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
  // Sample along the segment between cluster CORES; fused ⇒ the field stays
  // inside (negative) the whole way.
  //
  // Probe from a core rather than from `center`. A cluster centre is a BOUNDING
  // construct — the centroid of every endpoint — and nothing guarantees it lies
  // inside the flesh. A head carrying a dozen face primitives on the front of
  // the skull drags that centroid clean out of the cranium, at which point every
  // segment starts outside the surface and the whole body reports as
  // disconnected. The core below is inside its primitive by construction.
  if (body.clusters.length > 1)
    for (const c of body.clusters) {
      const from = clusterCore(body, c);
      if (from === null) continue; // nothing solid to probe from
      const fused = body.clusters.some(o => {
        if (o.id === c.id) return false;
        const to = clusterCore(body, o);
        return to !== null && segmentInside(from, to, body);
      });
      if (!fused) errs.push(`cluster "${c.limb}" is disconnected — not fused to any other cluster`);
    }

  return errs;
}

/**
 * A point guaranteed to be inside a cluster's flesh: the midpoint of its
 * fattest solid primitive, which sits `radius * minScale` deep inside that
 * primitive's own surface and therefore inside the union.
 */
function clusterCore(body: Body, c: ClusterInfo): Vec3 | null {
  let best: Primitive | null = null;
  let bestDepth = -Infinity;
  for (const p of body.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub' || p.dead) continue;
    const depth = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    if (depth > bestDepth) { bestDepth = depth; best = p; }
  }
  return best === null ? null : lerp(best.a, best.b, 0.5);
}

function segmentInside(from: Vec3, to: Vec3, body: Body): boolean {
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++)
    if (sdBody(lerp(from, to, i / STEPS), body) > 0) return false;
  return true;
}
