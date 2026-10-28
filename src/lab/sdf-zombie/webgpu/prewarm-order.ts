// src/lab/sdf-zombie/webgpu/prewarm-order.ts
//
// WARM ORDER for the level pre-warm (game-level-prewarm.ts): of the meshes still to warm, the one whose bounding
// sphere is nearest the player goes first, so the rooms the player reaches soonest are ready soonest. Pure: no
// renderer, no scene.

/** A mesh's world bounding sphere. */
export interface WarmSite { readonly x: number; readonly y: number; readonly z: number; readonly r: number }

/** Distance from `p` to the sphere's surface (0 inside it). */
export function gapTo(s: WarmSite, p: readonly [number, number, number]): number {
  return Math.max(0, Math.hypot(s.x - p[0], s.y - p[1], s.z - p[2]) - s.r);
}

/** Index of the site nearest `p` among those `skip` leaves, or -1 when it skips all. Ties go to the lower index. */
export function nearestSite(sites: readonly WarmSite[], p: readonly [number, number, number], skip: (i: number) => boolean): number {
  let best = -1, bestGap = Infinity;
  for (let i = 0; i < sites.length; i++) {
    if (skip(i)) continue;
    const g = gapTo(sites[i]!, p);
    if (g < bestGap) { best = i; bestGap = g; }
  }
  return best;
}
