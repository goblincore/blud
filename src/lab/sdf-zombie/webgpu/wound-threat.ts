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

import { CUT_JAG_MAX, CUT_SHADE } from '../cut-wound';
import type { Vec3 } from '../types';

export interface ThreatWound {
  pos: Vec3;
  radius: number;
  /** Owning cluster index, or -1 for an unscoped wound (never foreign: mask 0). */
  owner: number;
  /** Depth slab: inward normal + depth. Null or depth <= 0 = uncapped sphere. */
  cap?: { n: Vec3; depth: number } | null;
  /** A CUT's slot (flag 32; built by `cutThreatWound`). Its carve is positive only inside a thin box about `pos`:
   *  |along| <= halfLen, |side| <= halfWidth (side = along x cap.n), from `outward` above the anchor's tangent plane (the
   *  lid) to cap.depth below it. On undistorted groups (like the slab) each box face is tested, widened by `widen` x
   *  (group radius + margin). The sphere is the smaller of `radius` (the shader's reach) and `boxR` + `cornerWiden` x
   *  (group radius + margin) (the box's corner sphere, valid for distorted groups too); see cutThreatWound. */
  slot?: {
    along: Vec3; halfLen: number; halfWidth: number; outward: number; widen: number; boxR: number; cornerWiden: number;
  } | null;
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
        const dist = Math.hypot(dx, dy, dz) - grp.radius;
        if (dist >= (w.radius + margin) * f) continue;
        if (w.slot && dist >= (w.slot.boxR + margin) * f + w.slot.cornerWiden * (grp.radius + margin)) continue;
        if (capped && f <= 1.001) {
          const n = w.cap!.n;
          const widen = w.slot ? w.slot.widen * (grp.radius + margin) : 0;
          const inward = dx * n[0] + dy * n[1] + dz * n[2];
          if (inward - grp.radius >= w.cap!.depth + margin + widen) continue;
          if (w.slot) {
            if (-inward - grp.radius >= w.slot.outward + margin + widen) continue;
            const t = w.slot.along;
            const sd: Vec3 = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
            if (Math.abs(dx * t[0] + dy * t[1] + dz * t[2]) - grp.radius >= w.slot.halfLen + margin + widen) continue;
            if (Math.abs(dx * sd[0] + dy * sd[1] + dz * sd[2]) - grp.radius >= w.slot.halfWidth + margin + widen) continue;
          }
        }
        mask |= 1 << (c + 1);
        break;
      }
    }
    return mask;
  });
}

/**
 * The threat wound of a CUT row (cut-wound.ts, applyWounds' flag-32 branch). A crater's carve lies inside its radius,
 * a cut's does not, so the row's half-length is the wrong sphere. The carve is positive only inside a box about the
 * midpoint, in the slot's frame:
 *
 * - along: |a| <= halfLen; sideways: |u| <= (1 + CUT_JAG_MAX) kerf, the jagged kerf at its widest (fine jag + the pinch at
 *   a tip; the taper is <= 1);
 * - inward: the floor, at most sag + max(dEff, kerf) below the anchor, dEff = min(depth, maxDepthPerHalfLen x halfLen)
 *   (the slab; the depth alone missed the sag);
 * - outward: the LID, kerf + lidSlack x halfLen above the anchor's tangent plane. Before the raw-plane lid nothing closed
 *   the channel above a cut inside a foreign limb, so the sphere had to be the shader's whole reach (~0.68 m for the rod
 *   at half-length 0.1), a column in front of every cut.
 *
 * Carried through the header's derivation: the limb can only win at p where s_g(p) < (carve(p) + margin) f, and the
 * carve is carveK x the box terms, so it falls off slower than distance outside the box. Each face test is widened by
 * (1 / carveK - 1) x (group radius + margin). The corner sphere: such a p lies in the box grown by W = (group radius +
 * margin) / carveK per face, so |p - pos| <= boxCorner + sqrt(3) W, and s_g(p) < (carveK halfWidth + margin) f; hence
 * dist < (boxR + margin) f + sqrt(3) / carveK x (group radius + margin), with boxR = boxCorner + carveK halfWidth.
 * The reach form (`reachR`, the GPU skip: woundReachBound's per-wound radius) stays as a second, exact bound, plus
 * carveK halfWidth for the carve's own height. A row with no inward axis carves nothing on the GPU (the branch's
 * guard), so it threatens nobody.
 */
export function cutThreatWound(
  pos: Vec3, owner: number, halfLen: number, inward: Vec3, depth: number, sag: number, along: Vec3, kerf: number,
  reachR: number,
): ThreatWound {
  if (Math.hypot(inward[0], inward[1], inward[2]) < 0.5) return { pos, radius: 0, owner: -1 };
  const halfWidth = (1 + CUT_JAG_MAX) * kerf;
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  const floor = sag + Math.max(dEff, kerf);
  const outward = kerf + CUT_SHADE.lidSlack * halfLen;
  const boxCorner = Math.hypot(halfLen, Math.max(floor, outward), halfWidth);
  return {
    pos, owner,
    radius: reachR + CUT_SHADE.carveK * halfWidth,
    cap: { n: inward, depth: floor },
    slot: {
      along, halfLen, halfWidth, outward, widen: 1 / CUT_SHADE.carveK - 1,
      boxR: boxCorner + CUT_SHADE.carveK * halfWidth, cornerWiden: Math.sqrt(3) / CUT_SHADE.carveK,
    },
  };
}

/** The most a cut's lip can LOWER a field (applyWounds' cutAmp at prof 1): kerf x lipHeight x the row's lip scale
 *  (META.z, clamped to maxLipScale as the shader does). A crater's is radius x rimSplay x splay; for a cut the radius is the half-length, which overstated it ~6x. */
export function cutLipAmp(kerf: number, splay: number): number {
  return kerf * CUT_SHADE.lipHeight * Math.min(splay, CUT_SHADE.maxLipScale);
}
