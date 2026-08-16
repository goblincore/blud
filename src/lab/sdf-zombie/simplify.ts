// src/lab/sdf-zombie/simplify.ts
//
// Coarse stand-in bodies for distant LOD levels.
//
// WHY THIS AND NOT FEWER MARCH STEPS. Measured on an M3 at 15 bodies: cutting
// the step count from 96 to 40 bought only 15%, because few rays ever ran to
// the limit — they hit the surface or left the proxy box first. What every ray
// DOES pay, on every step it takes, is the inner loop over primitives. So the
// lever that moves the number is primitive COUNT, not step count.
//
// A capsule per bone is what makes the near body read as a body. At forty
// pixels tall none of that survives rasterisation anyway, so a distant body
// collapses to one ellipsoid per limb: six primitives instead of twenty-three.

import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';

/**
 * Fattening applied to the limb's own thickness.
 *
 * DO NOT go back to the cluster's bounding RADIUS for this. The first attempt
 * did, and it was visibly wrong on screen: a cluster's bounding sphere
 * encloses the whole limb end to end, so using it as a thickness made every
 * limb as fat as it was long and the body rendered as a featureless mitten —
 * clearly worse than the level beside it at the same size on screen, which is
 * exactly the pop LOD must not produce. The thickness of a limb is the
 * thickness of its PRIMITIVES; only the length comes from the bounds.
 *
 * The small fattening stands in for the detail primitives that were dropped,
 * which collectively sat slightly proud of the largest one.
 */
export const SIMPLIFY_FATTEN = 1.12;

/**
 * Blend multiplier for the stand-in.
 *
 * The detailed body welds its limbs with many overlapping capsules; six
 * capsules need a somewhat wider smooth-min to fuse into one figure. Kept
 * modest — the first attempt used 3x and the limbs melted together.
 */
export const SIMPLIFY_BLEND = 1.6;

/**
 * One ellipsoid per LIVE cluster, spanning that cluster's own extent.
 *
 * Severed clusters are dropped rather than kept-and-flagged: the stand-in is
 * rebuilt whenever the body changes, so there is nothing to be gained by
 * carrying dead limbs, and dropping them keeps the primitive count honest.
 *
 * Carves are dropped too. A face is texture at this range and an eye socket is
 * well under a pixel, so the carve loop would be pure cost.
 */
export function simplifyBody(body: BuildResult): BuildResult {
  const prims: Primitive[] = [];
  const clusters: ClusterInfo[] = [];

  for (const c of body.clusters) {
    if (!c.alive) continue;
    // Span the cluster along its own longest axis rather than making a sphere:
    // a leg is four times longer than it is wide, and a sphere either loses the
    // limb or swallows the gap between limbs.
    const { a, b, radius } = spanCluster(body, c);
    clusters.push({
      ...c,
      id: clusters.length,
      start: prims.length,
      count: 1,
      alive: true,
    });
    prims.push({
      a, b,
      radius: radius * SIMPLIFY_FATTEN,
      // Round cross-section: the ellipsoid scale of the detail primitives was
      // per-primitive, and averaging it over a whole limb produced shapes that
      // matched nothing. At this size a round limb is indistinguishable.
      scale: [1, 1, 1],
      blendK: blendFor(body, c) * SIMPLIFY_BLEND,
      limb: c.limb,
      cluster: clusters.length - 1,
      op: 'add',
    });
  }

  // Errors are cleared, not recomputed: validateBody checks authoring rules
  // (cluster contiguity, connectivity, the Lipschitz bound) that a derived
  // stand-in satisfies by construction, and a stray message here would surface
  // in the panel as if the real body were broken.
  return { ...body, prims, clusters, errors: [] };
}

/** Widest blendK among a cluster's additive primitives — its welding strength. */
function blendFor(body: BuildResult, c: ClusterInfo): number {
  let k = 0;
  for (const p of body.prims.slice(c.start, c.start + c.count))
    if (p.op !== 'sub') k = Math.max(k, p.blendK);
  return k || 0.012;
}

/**
 * The segment covering a cluster's primitives, and the limb's own thickness.
 *
 * LENGTH comes from the axis-aligned bounds of the cluster's endpoints, run
 * along its longest axis. THICKNESS comes from the primitives themselves —
 * their effective world radius, which for an ellipsoid capsule is the authored
 * radius times its smallest axis scale, matching what `sdPrim` computes.
 * Taking thickness from the bounds instead is what produced the mitten.
 */
function spanCluster(
  body: BuildResult, c: ClusterInfo,
): { a: Vec3; b: Vec3; radius: number } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const p of body.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub') continue;
    radius = Math.max(radius, p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]));
    for (const e of [p.a, p.b])
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, e[i]!);
        max[i] = Math.max(max[i]!, e[i]!);
      }
  }
  // A cluster with no additive primitives cannot be spanned; fall back to its
  // own centre so the caller still gets a well-formed blob.
  if (!Number.isFinite(min[0]!) || radius <= 0) {
    return { a: c.center, b: c.center, radius: c.radius * 0.5 };
  }

  const centre: [number, number, number] = [
    (min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2,
  ];
  const half: [number, number, number] = [
    (max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2,
  ];
  let axis = 0;
  for (let i = 1; i < 3; i++) if (half[i]! > half[axis]!) axis = i;

  const a: [number, number, number] = [...centre];
  const b: [number, number, number] = [...centre];
  a[axis] = centre[axis]! - half[axis]!;
  b[axis] = centre[axis]! + half[axis]!;

  return { a, b, radius };
}
