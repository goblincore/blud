// src/lab/sdf-zombie/webgpu/wound-threat.ts
//
// CPU THREAT MASKS for the owner re-fold (2026-09-21, wound-cost investigation;
// docs/dev-notes/2026-09-21-multiscale-march/WOUND-COST.md). Pure: no three, no GPU.
//
// mapBody re-folds a limb "under somebody else's wound" so an arm's crater cannot
// erase the jaw. It can only WIN where that limb has flesh inside the foreign wound's
// carve bowl, and whether it can is a property of the pose, not of the sample: a
// chest wound never reaches a shin. So per wound we name the clusters that can be
// reached, once per upload, and the shader skips the rest.
//
// A cluster c is threatened by wound j (owner != c) when some prim group g of c has
//
//   |w_j - g.centre| - g.radius  <  (R_j + margin) * g.distort
//
// and, for an undistorted group under a capped wound, also reaches the depth slab:
//
//   dot(g.centre - w_j, n_j) - g.radius  <  cap_j + margin
//
// Derivation (same standard as the shader's own sphere culls): the limb wins only
// if limb(p) - amp < carve_j(p) + E, carve_j <= min(R - r, cap - h), and
// limb(p) >= s_g(p) / distort - D for the group g that attains it; the triangle
// inequality carries p out of both statements. margin = D + amp + E, which the
// caller builds from the body's smin support, the rim-bump amplitudes and the
// wound smax overshoot. The slab half is skipped for distorted groups because its
// bound is not closed under a distortion factor above one.

import type { Vec3 } from '../types';

export interface ThreatWound {
  pos: Vec3;
  radius: number;
  /** Owning cluster index, or -1 for an unscoped wound (never foreign: mask 0). */
  owner: number;
  /** Depth slab: inward normal + depth. Null or depth <= 0 = uncapped sphere. */
  cap?: { n: Vec3; depth: number } | null;
}

export interface ThreatGroup { center: readonly [number, number, number]; radius: number; distort: number }

/** Bit (c + 1) of mask[j] is set when cluster c is threatened by wound j. Bits stay below
 *  512 so mask / 1024 rides the fraction of a texel whose integer part is a 0/1 flag. */
export function woundThreatMasks(
  wounds: readonly ThreatWound[],
  groups: readonly ThreatGroup[],
  /** Per cluster: [firstGroup, groupCount]. */
  clusterGroups: readonly (readonly [number, number])[],
  margin: number,
): number[] {
  const nClusters = Math.min(clusterGroups.length, 8);
  return wounds.map((w) => {
    if (w.owner < 0) return 0;
    let mask = 0;
    const capped = !!w.cap && w.cap.depth > 0;
    for (let c = 0; c < nClusters; c++) {
      if (c === w.owner) continue;
      const [first, count] = clusterGroups[c]!;
      for (let g = first; g < first + count; g++) {
        const grp = groups[g];
        if (!grp) continue;
        const f = Math.max(1, grp.distort);
        const dx = grp.center[0] - w.pos[0], dy = grp.center[1] - w.pos[1], dz = grp.center[2] - w.pos[2];
        if (Math.hypot(dx, dy, dz) - grp.radius >= (w.radius + margin) * f) continue;
        if (capped && f <= 1.001) {
          const n = w.cap!.n;
          if (dx * n[0] + dy * n[1] + dz * n[2] - grp.radius >= w.cap!.depth + margin) continue;
        }
        mask |= 1 << (c + 1);
        break;
      }
    }
    return mask;
  });
}
