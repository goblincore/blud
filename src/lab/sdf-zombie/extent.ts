// src/lab/sdf-zombie/extent.ts
import type { BoxParams, Primitive, Vec3 } from './types';
import { bendCtrl, len, sub } from './vec';

/**
 * How far a primitive's surface reaches from its segment, in units of
 * `radius`. A capsule reaches exactly `radius` in every direction, so 1; a
 * rounded box reaches its CORNER, at `sqrt(3)*r*(1-round) + r*round` in the
 * scale-divided frame.
 *
 * ONE function, used by every outer bound in the codebase — eight sites as of
 * the X1.28 survey, not the four this comment used to name: chunkExtent and
 * assignClusters here and in clusters.ts, fitSphere in pack.ts,
 * shell-hull-outer.ts, validate.ts's "primitive escapes its bounding sphere"
 * check (the safety net whose whole job is catching a site that missed this),
 * both fpv-view.ts hand-view sites, and rig-bind.ts's applyRig (the posed-body
 * refit, and the most consequential of the eight — it runs every frame for
 * every rigged character, not just at rest). Eight copies of this arithmetic
 * is eight chances to miss one — and an outer bound that under-covers a box
 * does not draw a wrong shape, it CULLS, which presents as a round
 * see-through hole and sends you hunting in webgpu/ for a bug that is here.
 *
 * THE TELL FOR A NINTH SITE, if one turns up: sites 6 and 8 (fpv-view.ts,
 * rig-bind.ts) were the hardest to find precisely because they RECOMPUTE a
 * bounding sphere with their own copy of assignClusters' formula instead of
 * consuming one already fixed — grepping for the `radiusB ?? radius` pattern
 * that found the first four sites does not surface a second, independently
 * authored copy of the fit. A deliberate sweep of every file touching
 * `Primitive` (X1.28 task 4c) closed the survey at eight; see that commit for
 * the full candidate list, including the sites that turned out to be inner
 * bounds, LOD-visual-only, dev-tooling, or a different geometry system
 * entirely and so were correctly left alone.
 *
 * Note this is the opposite risk from occluder-hull.ts, which builds an INNER
 * hull and needs no change: a rounded box strictly contains the capsule of
 * the same semi-axes, so spheres sized for the capsule stay inside the box.
 */
export function boxReach(box: BoxParams | undefined): number {
  if (box === undefined) return 1;
  return Math.sqrt(3) * (1 - box.round) + box.round;
}

/**
 * Furthest reach of a set of primitives from `origin` (same recipe as
 * clusters.ts). Carves are excluded — they are holes, and counting them would
 * inflate both the collision radius and the proxy box.
 *
 * Lives in its own module rather than in zombie.ts because BOTH renderer paths
 * need it and zombie.ts imports `three`. A WebGPU module that reached into it
 * would pull a second copy of three into the bundle, which is the trap that
 * makes every standard material render black — see lab-renderer.ts.
 */
export function chunkExtent(prims: Primitive[], origin: Vec3): number {
  let r = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const ms = Math.max(p.scale[0], p.scale[1], p.scale[2]);
    const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box);
    // A bent prim swings out to its ctrl — include it or the proxy box clips
    // the very horn that prompted the bend.
    const ends = p.bend === undefined
      ? [p.a, p.b] : [p.a, p.b, bendCtrl(p.a, p.b, p.bend)];
    for (const e of ends)
      r = Math.max(r, len(sub(e, origin)) + rMax * ms);
  }
  return r;
}

/**
 * Radius for a chunk's torn-end wound: the limb's cross-section girth at the
 * tear, scaled up just enough to read as the whole cross-section ripped open.
 *
 * It must NOT derive from the chunk's extent. Extent is dominated by limb
 * LENGTH, and every geometric term of the wound pipeline — the carve sphere
 * and the everted rim's amplitude, ring radius and width — scales with the
 * wound radius. At `extent * 0.55` the carve ate half the limb and the rim
 * inflated the rest, so every chunk rendered as a rounded blob (X1.16).
 */
export function tornEndRadius(prims: Primitive[], tornAt: Vec3): number {
  let bestD = Infinity;
  let girth = 0.05;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    // Effective girth of an ellipsoid capsule is its radius on the thinnest
    // axis — the same min-scale sdPrim uses to keep its bound conservative.
    const g = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, tornAt));
      if (d < bestD) { bestD = d; girth = g; }
    }
  }
  return girth * 1.35;
}
