// src/lab/sdf-zombie/humanoid-damage.ts
//
// Task 8 — the wound model re-keyed onto bone bricks. The procedural
// `damage.ts` stamps a crater into the primitive nearest a world hit and
// stores it in that primitive's local frame; the baked humanoid has no
// primitives, so none of that survives the change of representation. This
// module reproduces the SAME model against bone-local distance bricks:
//
//   - which ARRAY POSITION in manifest.bones[] a wound rides (`boneIdx`),
//   - how a world hit reaches brick-local space (the closed-form rigid
//     inverse of the bone's posed quaternion — never a matrix inverse),
//   - how the one authoritative wound ring splits into the attached and
//     detached upload lists around the baked mid-forearm cut plane, and
//   - how the ring is laid into the fixed-size GPU slot array, with
//     cluster-boundary duplication and an oldest-duplicate drop budget.
//
// PURE. No renderer, no WebGPU, no DOM. Every function is state-in/state-out
// and never mutates its inputs; the ring is derived per frame, never migrated
// at the sever frame.
//
// DELIBERATELY NOT PORTED (see the wound design doc): damage.ts's `frame()`,
// `basisFromAxis`, the `bodyYaw` de-yaw/re-yaw threading, the stamp-yaw/
// read-yaw matching contract, and the `p.op === 'sub'` carve skip. A bone
// brick carries its FULL rotation in `HumanoidPoseState.bones[i].quaternion`
// (elbow flexion and all), so the workaround those existed for — primitives
// with no rotation of their own — has nothing left to fix. The yaw-matching
// contract was itself a silent drift source.

import type { Vec3 } from './types';
import { add, dot, qNormalize, qRotate, sub, type Quat } from './vec';
import { WOUND_PROFILES, type WoundType } from './damage';
import type {
  HumanoidVolumeManifest,
} from './webgpu/humanoid-volume';
import type { HumanoidBonePose, HumanoidPoseState } from './humanoid-pose';

/**
 * One wound keyed to a bone brick. `boneIdx` is the array position in
 * `manifest.bones[]` — the SAME index space as `poseMatrices`,
 * `HumanoidPoseState.bones`, and humanoid-sever's `distalIndices`. It is
 * NOT `HumanoidBrickManifest.jointIndex`: those diverge past a fold (the
 * checked-in manifest reports `boneCount: 24` with `bones.length: 22`
 * because `head_end` and `headfront` fold into `Head`).
 */
export interface BoneWound {
  boneIdx: number;
  /** Hit position in that bone's BIND-LOCAL frame, metres. */
  local: Vec3;
  radius: number;
  type: WoundType; // reused verbatim from damage.ts
  ageSec: number;
}

/** Logical wounds in the ring (the ring evicts oldest-first at this cap). */
export const MAX_BONE_WOUNDS = 12;
/** Texture columns written and scanned — cluster/cut duplication consumes
 *  more slots than there are logical wounds. */
export const MAX_WOUND_SLOTS = 24;

// The global wound rim knobs mirrored from the humanoid's woundCfg/woundCfg2
// defaults (webgpu/zombie-gpu.ts): woundCfg.w (rimOffset) and woundCfg2.x
// (rimWidth). `rimReach` below is the everted lip's outer extent — the same
// quantity `applyWounds` uses to place its Gaussian ring — so the cluster
// duplication test cannot drift from the geometry it protects.
export const HUMAN_WOUND_RIM_OFFSET = 1.15; // woundCfg.w
export const HUMAN_WOUND_RIM_WIDTH = 0.42; // woundCfg2.x

/** The everted lip's outer reach past the crater radius:
 *  `radius * rimOffset * rimOffsetScale + radius * rimWidth` — the Gaussian
 *  ring centre (radius * rimOffset * rimOffsetScale) plus its width
 *  (radius * rimWidth). Matches `applyWounds`'s
 *  `x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4)`
 *  with `depth == radius`. */
export function rimReach(radius: number, rimOffsetScale: number): number {
  return radius * HUMAN_WOUND_RIM_OFFSET * rimOffsetScale
    + radius * HUMAN_WOUND_RIM_WIDTH;
}

// -- local math helpers (the same closed-form rigid transforms as
//    humanoid-sever.ts; renormalised so a non-unit quaternion can never
//    silently skew the keying). -------------------------------------------------

const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** world -> bind-local: `qConj(q) * (world - t)`, q renormalised. */
function worldToLocal(pose: HumanoidBonePose, world: Vec3): Vec3 {
  const q = qNormalize(pose.quaternion);
  return qRotate(qConj(q), sub(world, pose.position));
}

/** bind-local -> world: `t + q * local`, q renormalised. */
function localToWorld(pose: HumanoidBonePose, local: Vec3): Vec3 {
  const q = qNormalize(pose.quaternion);
  return add(pose.position, qRotate(q, local));
}

/** Point-to-AABB distance: zero inside, positive outside. */
function pointAabbDistance(p: Vec3, min: Vec3, max: Vec3): number {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const e = Math.max(min[k]! - p[k]!, 0, p[k]! - max[k]!);
    d2 += e * e;
  }
  return Math.sqrt(d2);
}

/** Axis-aligned bounds of the bone's OCCUPIED box under its posed transform
 *  (the eight occupied corners pushed through position + quaternion). */
function posedOccupiedAabb(
  pose: HumanoidBonePose,
  min: Vec3,
  max: Vec3,
): [Vec3, Vec3] {
  const q = qNormalize(pose.quaternion);
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cx of [min[0], max[0]]) {
    for (const cy of [min[1], max[1]]) {
      for (const cz of [min[2], max[2]]) {
        const w = add(pose.position, qRotate(q, [cx, cy, cz]));
        lo = [Math.min(lo[0], w[0]), Math.min(lo[1], w[1]), Math.min(lo[2], w[2])];
        hi = [Math.max(hi[0], w[0]), Math.max(hi[1], w[1]), Math.max(hi[2], w[2])];
      }
    }
  }
  return [lo, hi];
}

/**
 * The bone brick that owns a world hit — array position in manifest.bones[].
 *
 * Two phases. Broad: keep every bone whose posed OCCUPIED box is within
 * `radius + margin` of the hit (the eight occupied corners pushed through
 * the pose, then point-to-AABB distance). Narrow: for each survivor map the
 * hit into bind-local and score it against the occupied bounds — zero
 * inside, positive outside. Take the minimum; ties break on the lower
 * `boneIdx`. If nothing survives the broad phase, fall back to the nearest
 * bone origin so a hit can never fail to produce a wound (damage.ts's
 * "a body that can be hit always takes the wound" guarantee).
 *
 * Only the weight-derived OCCUPIED bounds are read here. The padded
 * exterior bounds would hand shoulder hits to the spine (their halo boxes
 * overlap in the joint bands); they are deliberately never touched.
 */
export function ownerBrickForHit(
  manifest: HumanoidVolumeManifest,
  state: HumanoidPoseState,
  hit: Vec3,
  radius: number,
): number {
  const reach = radius + manifest.bake.marginM;
  let bestIdx = -1;
  let bestScore = Infinity;

  for (let i = 0; i < manifest.bones.length; i++) {
    const bone = manifest.bones[i]!;
    const pose = state.bones[i]!;
    const [lo, hi] = posedOccupiedAabb(
      pose, bone.occupiedBoundsMin, bone.occupiedBoundsMax,
    );
    if (pointAabbDistance(hit, lo, hi) > reach) continue;
    const score = pointAabbDistance(
      worldToLocal(pose, hit), bone.occupiedBoundsMin, bone.occupiedBoundsMax,
    );
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) return bestIdx;

  let nearest = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < state.bones.length; i++) {
    const d = Math.hypot(
      hit[0] - state.bones[i]!.position[0],
      hit[1] - state.bones[i]!.position[1],
      hit[2] - state.bones[i]!.position[2],
    );
    if (d < nearestDist) {
      nearestDist = d;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * Converts a world-space hit into a wound bound to the owning bone brick,
 * stored in that bone's BIND-LOCAL frame. The local position is the closed
 * form `qConj(q) * (hit - t)` against `HumanoidPoseState.bones[boneIdx]` —
 * the exact rigid inverse, with the bone quaternion renormalised so a
 * non-unit quaternion is corrected rather than skewing the result.
 */
export function worldHitToBoneWound(
  manifest: HumanoidVolumeManifest,
  state: HumanoidPoseState,
  hit: Vec3,
  radius: number,
  type: WoundType,
): BoneWound {
  const boneIdx = ownerBrickForHit(manifest, state, hit, radius);
  return {
    boneIdx,
    local: worldToLocal(state.bones[boneIdx]!, hit),
    radius,
    type,
    ageSec: 0,
  };
}

/**
 * Transforms a wound back into world space using the owning bone's current
 * pose. THE one `local -> world` formula (`t + q * local`) — the attached
 * path passes `state.bones[boneIdx]`, the detached path passes
 * `chunkBoneWorldPose(chunk, frozenDistalBones[k])`, so a severed piece's
 * bullet holes ride the chunk with no special case.
 */
export function boneWoundWorldPos(pose: HumanoidBonePose, wound: BoneWound): Vec3 {
  return localToWorld(pose, wound.local);
}

// -- cut partition -----------------------------------------------------------------

/** The two per-frame upload lists derived from the one authoritative ring. */
export interface WoundUploadLists {
  attached: BoneWound[];
  detached: BoneWound[];
}

/**
 * Splits the wound ring into the attached (proximal stump) and detached
 * (distal forearm + hand) upload lists around the baked mid-forearm cut
 * plane, in forearm bind-local space:
 *
 *   s = dot(n, wound.local) + w          // signed distance to the cut
 *   s < 0                       -> attached
 *   s > 0                       -> detached
 *   |s| <= radius + irregularityM -> BOTH lists (straddler duplicated)
 *
 * Wounds on any other bone route by ownership: everything in
 * `distalIndices` is detached, everything else attached. Straddlers are
 * DUPLICATED, never assigned — giving a straddler to one side only leaves
 * the other side's cut cap showing a bite on one face and not the other,
 * which fails the spike's complementary-mask gate. Deriving per frame (never
 * migrating at the sever frame) keeps reset a no-op on the ring.
 */
export function partitionWoundsByCut(
  manifest: HumanoidVolumeManifest,
  wounds: readonly BoneWound[],
  distalIndices: readonly number[],
): WoundUploadLists {
  const faIdx = manifest.bones.findIndex(b => b.bone === manifest.rightArm.forearm);
  if (faIdx < 0) {
    throw new Error(`humanoid damage: manifest is missing the ${manifest.rightArm.forearm} brick`);
  }
  const [nx, ny, nz, wCut] = manifest.rightArm.cutPlaneLocal;
  const irregularityM = manifest.rightArm.irregularityM;
  const distalSet = new Set(distalIndices);

  const attached: BoneWound[] = [];
  const detached: BoneWound[] = [];
  for (const w of wounds) {
    if (w.boneIdx === faIdx) {
      const s = nx * w.local[0] + ny * w.local[1] + nz * w.local[2] + wCut;
      if (Math.abs(s) <= w.radius + irregularityM) {
        attached.push(w);
        detached.push(w);
      } else if (s < 0) {
        attached.push(w);
      } else {
        detached.push(w);
      }
    } else if (distalSet.has(w.boneIdx)) {
      detached.push(w);
    } else {
      attached.push(w);
    }
  }
  return { attached, detached };
}

// -- cluster ranges and slot budget -------------------------------------------------

/** One slot in the GPU wound array: which wound (ring index) it carries,
 *  which cluster it is written for, and whether it is a boundary duplicate
 *  (the wound's home cluster is a different one). */
export interface WoundSlotEntry {
  woundIdx: number;
  clusterIdx: number;
  duplicate: boolean;
}

/** A cluster's contiguous (start, count) into the slot array. */
export interface WoundSlotRange {
  clusterIdx: number;
  start: number;
  count: number;
}

/** The slot layout plus the drop count for the page readout. */
export interface WoundSlotBudget {
  /** Slots in texel order (cluster-major: all of cluster 0, then cluster 1…). */
  slots: WoundSlotEntry[];
  /** Per-cluster (start, count) into `slots`. Only clusters with >= 1 slot. */
  ranges: WoundSlotRange[];
  /** Duplicate copies dropped because the slot budget overflowed. */
  dropped: number;
}

/**
 * Lays the wound ring into the fixed-size GPU slot array. Each wound gets a
 * primary entry in its home cluster (the cluster whose `primaryBones` owns
 * its bone) and a boundary-duplicate entry in every OTHER cluster whose
 * sweep bounds are within `radius + rimReach` of the wound's world position
 * — otherwise the everted lip would be sliced off at the cluster seam.
 *
 * Slots are cluster-major so each cluster scans one contiguous
 * `(start, count)` range; the ranges partition the slot array with no gaps
 * and no overlap except the declared boundary duplicates. If duplication
 * would exceed `MAX_WOUND_SLOTS`, the OLDEST duplicate copies are dropped
 * first (never a primary entry), so an old wound degrades to "visible from
 * one cluster" instead of vanishing. The drop count is returned for the
 * page readout.
 */
export function woundSlotsForClusters(
  manifest: HumanoidVolumeManifest,
  wounds: readonly BoneWound[],
  worldPositions: readonly Vec3[],
): WoundSlotBudget {
  const clusters = manifest.clusters;

  // bone array position -> owning cluster index.
  const boneToCluster = new Map<number, number>();
  for (let ci = 0; ci < clusters.length; ci++) {
    for (const name of clusters[ci]!.primaryBones) {
      const bi = manifest.bones.findIndex(b => b.bone === name);
      if (bi >= 0) boneToCluster.set(bi, ci);
    }
  }

  const memberships: { woundIdx: number; duplicate: boolean }[][] =
    clusters.map(() => []);

  for (let wi = 0; wi < wounds.length; wi++) {
    const w = wounds[wi]!;
    const home = boneToCluster.get(w.boneIdx);
    if (home === undefined) {
      throw new Error(`humanoid damage: bone index ${w.boneIdx} is not a cluster primary`);
    }
    memberships[home]!.push({ woundIdx: wi, duplicate: false });

    const reach = w.radius + rimReach(w.radius, WOUND_PROFILES[w.type].rimOffsetScale);
    const wp = worldPositions[wi]!;
    for (let cj = 0; cj < clusters.length; cj++) {
      if (cj === home) continue;
      const c = clusters[cj]!;
      if (pointAabbDistance(wp, c.sweepBoundsMin, c.sweepBoundsMax) <= reach) {
        memberships[cj]!.push({ woundIdx: wi, duplicate: true });
      }
    }
  }

  // cluster-major slot layout.
  let slots: WoundSlotEntry[] = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    for (const m of memberships[ci]!) {
      slots.push({ woundIdx: m.woundIdx, clusterIdx: ci, duplicate: m.duplicate });
    }
  }

  // Budget: drop the oldest duplicate copies first, never a primary.
  let dropped = 0;
  if (slots.length > MAX_WOUND_SLOTS) {
    const excess = slots.length - MAX_WOUND_SLOTS;
    const dupSlots = slots
      .filter(s => s.duplicate)
      .sort((a, b) => {
        const ageDiff = wounds[b.woundIdx]!.ageSec - wounds[a.woundIdx]!.ageSec;
        if (ageDiff !== 0) return ageDiff;
        return a.woundIdx - b.woundIdx; // equal age: earlier ring slot is "older"
      });
    const dropSet = new Set(dupSlots.slice(0, excess));
    slots = slots.filter(s => !dropSet.has(s));
    dropped = excess;
  }

  // Per-cluster contiguous ranges over the surviving, still cluster-major slots.
  const ranges: WoundSlotRange[] = [];
  let cursor = 0;
  for (let ci = 0; ci < clusters.length; ci++) {
    let count = 0;
    for (const s of slots) if (s.clusterIdx === ci) count++;
    if (count > 0) {
      ranges.push({ clusterIdx: ci, start: cursor, count });
      cursor += count;
    }
  }

  return { slots, ranges, dropped };
}
