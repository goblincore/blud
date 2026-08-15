// src/lab/sdf-zombie/sever.ts
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import type { Wound } from './damage';
import { basisFromAxis, dot, len, lerp, sub } from './vec';

export interface ChunkGroup {
  limb: LimbId;
  prims: Primitive[];
  /** World-space centre at the moment of detachment. */
  origin: Vec3;
}

export interface SeverResult {
  body: BuildResult;
  chunk: ChunkGroup;
  /** Marks the stump as exposed meat. Null when nothing was severed. */
  stumpWound: Wound | null;
}

/**
 * Severs a limb by clearing its cluster's alive flag.
 *
 * It deliberately does NOT remove primitives from the array. The shader's
 * smooth-min is non-associative, so re-packing would change the fold order and
 * silently reshape the rest of the body. Alive flags keep the sequence fixed.
 */
export function severLimb(body: BuildResult, limb: LimbId): SeverResult {
  if (limb === 'torso') throw new Error('cannot sever the torso — it anchors the fold order');

  const cluster = body.clusters.find(c => c.limb === limb);
  if (!cluster || !cluster.alive)
    return { body, chunk: { limb, prims: [], origin: [0, 0, 0] }, stumpWound: null };

  const prims = body.prims.slice(cluster.start, cluster.start + cluster.count);
  const clusters = body.clusters.map(c => (c.limb === limb ? { ...c, alive: false } : c));
  const next: BuildResult = { ...body, clusters };

  // Anchor the stump on the nearest LIVE primitive to the removed cluster,
  // so the wound rides flesh that still exists.
  const live = body.prims
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.limb !== limb && clusters.find(c => c.limb === p.limb)?.alive);

  let primIdx = -1, best = Infinity;
  for (const { p, i } of live) {
    const d = len(sub(p.a, cluster.center));
    if (d < best) { best = d; primIdx = i; }
  }

  const anchor = primIdx < 0 ? null : body.prims[primIdx]!;
  const stumpWound: Wound | null = anchor === null ? null : {
    primIdx,
    // Place it on the segment between the anchor and the removed cluster's centre.
    local: toLocalApprox(anchor, lerp(anchor.a, cluster.center, 0.6)),
    radius: cluster.radius * 0.45,
    type: 'blast',
    ageSec: 0,
  };

  return { body: next, chunk: { limb, prims, origin: cluster.center }, stumpWound };
}

/** Local-frame offset from a primitive's head, matching damage.ts's convention. */
function toLocalApprox(prim: Primitive, world: Vec3): Vec3 {
  // Same basis as damage.ts's frame(): w along the capsule axis, u/v perpendicular.
  // There is no import cycle — sever.ts → vec.ts is one-way.
  const axis = sub(prim.b, prim.a);
  const { u, v, w } = basisFromAxis(len(axis) === 0 ? [0, 1, 0] : axis);
  const rel = sub(world, prim.a);
  return [dot(rel, u), dot(rel, v), dot(rel, w)];
}

/**
 * Blows the whole body apart: every live cluster becomes a chunk and the body
 * is left with nothing alive.
 *
 * Unlike `severLimb` this DOES release the torso — there is no body left to
 * anchor, so the fold-order argument for protecting it no longer applies. It
 * still never removes or reorders primitives; every cluster just goes dead,
 * so the invariant holds by the same mechanism.
 *
 * Chunks are seeded from the CURRENT primitive set, so gibs reflect damage
 * already dealt — an arm shot off earlier is simply not in the pile.
 */
export function gibAll(body: BuildResult): { body: BuildResult; chunks: ChunkGroup[] } {
  const chunks: ChunkGroup[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    chunks.push({
      limb: c.limb,
      prims: body.prims.slice(c.start, c.start + c.count),
      origin: c.center,
    });
  }
  return {
    body: { ...body, clusters: body.clusters.map(c => ({ ...c, alive: false })) },
    chunks,
  };
}
