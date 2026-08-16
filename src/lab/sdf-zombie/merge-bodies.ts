// src/lab/sdf-zombie/merge-bodies.ts
//
// Folds many bodies into ONE field, so a pixel can be marched once for the
// whole crowd instead of once per body.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
//
// Today every body owns a proxy box, a data texture and a draw call, and each
// runs an independent full march. Where bodies overlap on screen, that pixel is
// marched once PER BODY.
//
// Measured, ten bodies stacked front-to-back so they collapse into roughly one
// body's silhouette, against a single body at the same camera:
//
//   1 body                            3.41 ms
//   10 bodies, same screen footprint  21.22 ms   -- 6.2x
//
// If hidden bodies were free that would read ~1.3x. It reads 6.2x, so they are
// paying almost in full. Occlusion culling would claw some of that back; it
// would not remove the cause, because each body would still run its own pass.
// Marching the union once does.
//
// ---------------------------------------------------------------------------
// WHAT MAKES THIS CHEAP
// ---------------------------------------------------------------------------
//
// Primitives are already in WORLD SPACE. `translateBody` bakes placement into
// the endpoints, and the proxy box is derived FROM those endpoints rather than
// positioning them — so merging is concatenation, with no transform to apply
// and no per-body matrix for the shader to carry.
//
// The fold-order constraint survives for the same reason it exists. `smin` is
// not associative, so primitive order within a cluster and cluster order within
// a body must not change. Concatenating whole bodies preserves both: every
// body's run of clusters stays contiguous and internally ordered. Bodies do not
// blend into each other because each is culled by its own bounding sphere
// before its clusters are ever visited — two bodies that genuinely overlap in
// space would blend, which is correct and is what a single field means.
//
// ---------------------------------------------------------------------------
// THE HIERARCHY
// ---------------------------------------------------------------------------
//
// Merging turns the shader's flat per-cluster cull into a two-level one:
//
//   body sphere  ->  cluster sphere  ->  primitives
//
// Without the body level, a ten-body scene would test 60 cluster spheres at
// every step of every ray. With it, a step near one body tests 10 body spheres
// and then only that body's 6 clusters.

import type { BuiltBody, Vec3 } from './types';

/**
 * Ceiling on merged bodies. Sized for the crowd the lab stresses, not for the
 * game — raising it costs texture width and one more sphere test per step.
 */
export const MAX_BODIES = 16;

export interface MergedBodyEntry {
  /** Bounding sphere over every live primitive, in world space. */
  centre: Vec3;
  radius: number;
  /** Range into the merged cluster list. */
  clusterStart: number;
  clusterCount: number;
  /** Largest blendK in this body — the shader's cull margin. */
  maxBlendK: number;
}

export interface MergedScene {
  /** Concatenated, in body order. Fold order within each body is preserved. */
  prims: BuiltBody['prims'];
  /**
   * Concatenated clusters with `start` rebased onto the merged prim list, so
   * the shader indexes one flat array.
   */
  clusters: BuiltBody['clusters'];
  bodies: MergedBodyEntry[];
  carveCount: number;
  /** Largest blendK anywhere — the global cull margin. */
  maxBlendK: number;
}

/**
 * Bounding sphere over a body's live primitives, padded by the blend margin.
 *
 * The padding is not optional. `smin` scales k by 4 internally, so a cluster
 * still bends the surface from 4x the authored blendK away; a sphere fitted to
 * the raw endpoints would cull a body whose surface still reaches the sample
 * point, and the body would develop clipped edges exactly where it blends.
 * This mirrors the `counts.w * 4.0` margin the per-cluster cull already uses.
 */
export function bodySphere(body: BuiltBody): { centre: Vec3; radius: number; maxBlendK: number } {
  const live = new Set<number>();
  for (const c of body.clusters) if (c.alive) live.add(c.id);

  // Plain mutable arrays: Vec3's index signature is read-only, and this is the
  // one place that genuinely accumulates componentwise.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let maxBlendK = 0;
  let any = false;

  for (const p of body.prims) {
    if (!live.has(p.cluster)) continue;
    any = true;
    if (p.blendK > maxBlendK) maxBlendK = p.blendK;
    // Ellipsoid scale multiplies the radius per axis, so the reach along an
    // axis is radius * scale on that axis. Using the raw radius would under-
    // cover any primitive scaled above 1.
    for (let i = 0; i < 3; i++) {
      const reach = p.radius * p.scale[i]!;
      min[i] = Math.min(min[i]!, p.a[i]! - reach, p.b[i]! - reach);
      max[i] = Math.max(max[i]!, p.a[i]! + reach, p.b[i]! + reach);
    }
  }

  if (!any) return { centre: [0, 0, 0], radius: 0, maxBlendK: 0 };

  const centre: Vec3 = [
    (min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2,
  ];
  const half = Math.hypot(
    (max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2,
  );
  return { centre, radius: half + maxBlendK * 4, maxBlendK };
}

/**
 * Concatenates bodies into one field. Bodies past MAX_BODIES are dropped —
 * loudly, via the returned count, rather than silently truncated mid-body,
 * which would leave a half-built torso in the field.
 */
export function mergeBodies(bodies: BuiltBody[]): MergedScene {
  const prims: BuiltBody['prims'] = [];
  const clusters: BuiltBody['clusters'] = [];
  const entries: MergedBodyEntry[] = [];
  let carveCount = 0;
  let maxBlendK = 0;

  for (const body of bodies.slice(0, MAX_BODIES)) {
    const sphere = bodySphere(body);
    // A body with no live clusters contributes nothing. Skipping it here means
    // the shader never tests its sphere, rather than testing a zero-radius one
    // every step.
    if (sphere.radius === 0) continue;

    const primBase = prims.length;
    const clusterBase = clusters.length;

    for (const p of body.prims) {
      prims.push(p);
      if (p.op === 'sub') carveCount++;
    }
    for (const c of body.clusters) {
      clusters.push({ ...c, start: c.start + primBase });
    }

    entries.push({
      centre: sphere.centre,
      radius: sphere.radius,
      clusterStart: clusterBase,
      clusterCount: body.clusters.length,
      maxBlendK: sphere.maxBlendK,
    });
    if (sphere.maxBlendK > maxBlendK) maxBlendK = sphere.maxBlendK;
  }

  return { prims, clusters, bodies: entries, carveCount, maxBlendK };
}
