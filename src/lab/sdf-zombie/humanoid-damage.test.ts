// src/lab/sdf-zombie/humanoid-damage.test.ts
//
// Task 8 — pure bone-wound keying, cut partition, and slot budget. These
// tests pin the wound design doc against the REAL checked-in manifest
// (never a hand-written fixture) for the keying/invariance contracts, plus
// small hand-built cluster fixtures for the boundary-duplication and
// slot-budget mechanics, which need precise sweep-bound control.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { validateHumanoidVolumeManifest, type HumanoidVolumeManifest } from './webgpu/humanoid-volume';
import { makeHumanoidPose, jointWorldPosition, poseMatrices, type HumanoidBonePose } from './humanoid-pose';
import { makeHumanoidSever, severForearm, resetHumanoidSever, chunkBoneWorldPose } from './humanoid-sever';
import { WOUND_PROFILES } from './damage';
import { add, qNormalize, qRotate, type Quat } from './vec';
import type { Vec3 } from './types';
import {
  type BoneWound,
  MAX_BONE_WOUNDS,
  MAX_WOUND_SLOTS,
  HUMAN_WOUND_RIM_OFFSET,
  HUMAN_WOUND_RIM_WIDTH,
  worldHitToBoneWound,
  boneWoundWorldPos,
  ownerBrickForHit,
  partitionWoundsByCut,
  woundSlotsForClusters,
  rimReach,
} from './humanoid-damage';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

const faIdx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
const raIdx = realManifest.bones.findIndex(b => b.bone === 'RightArm');
const handIdx = realManifest.bones.findIndex(b => b.bone === 'RightHand');
const headIdx = realManifest.bones.findIndex(b => b.bone === 'Head');
const elbowJoint = realManifest.joints.find(j => j.child === 'RightForeArm');
if (faIdx < 0 || raIdx < 0 || handIdx < 0 || headIdx < 0 || !elbowJoint) {
  throw new Error('checked-in manifest is missing the right-arm chain or head');
}

// -- helpers -----------------------------------------------------------------------

const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

function close3(a: Vec3, b: Vec3, eps: number): void {
  for (let k = 0; k < 3; k++) {
    expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(eps);
  }
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function occupiedCenter(manifest: HumanoidVolumeManifest, boneIdx: number): Vec3 {
  const b = manifest.bones[boneIdx]!;
  return [
    (b.occupiedBoundsMin[0] + b.occupiedBoundsMax[0]) / 2,
    (b.occupiedBoundsMin[1] + b.occupiedBoundsMax[1]) / 2,
    (b.occupiedBoundsMin[2] + b.occupiedBoundsMax[2]) / 2,
  ];
}

function boneLocalToWorld(bones: readonly HumanoidBonePose[], boneIdx: number, local: Vec3): Vec3 {
  const pose = bones[boneIdx]!;
  return add(pose.position, qRotate(qNormalize(pose.quaternion), local));
}

function clusterOf(manifest: HumanoidVolumeManifest, boneIdx: number): number {
  const name = manifest.bones[boneIdx]!.bone;
  const ci = manifest.clusters.findIndex(c => c.primaryBones.includes(name));
  if (ci < 0) throw new Error(`bone ${name} has no cluster`);
  return ci;
}

/** Minimal manifest fixture for the cluster/slot mechanics — only the fields
 *  `woundSlotsForClusters` reads (`bones[].bone`, `clusters[]`) are real. */
function miniManifest(
  bones: string[],
  clusters: { name: string; primaryBones: string[]; min: Vec3; max: Vec3 }[],
): HumanoidVolumeManifest {
  return {
    bones: bones.map((bone, i) => ({ bone, jointIndex: i, parentIndex: i === 0 ? -1 : i - 1 })),
    clusters: clusters.map(c => ({
      name: c.name,
      primaryBones: c.primaryBones,
      sampleBones: c.primaryBones,
      sweepBoundsMin: c.min,
      sweepBoundsMax: c.max,
    })),
  } as unknown as HumanoidVolumeManifest;
}

// ===========================================================================
// Step 1 — keying and invariance
// ===========================================================================

describe('humanoid bone-wound keying', () => {
  it('keys by array position, not jointIndex — the fold is real on the asset', () => {
    // head_end and headfront fold into Head: 24 skeleton joints, 22 bricks.
    expect(realManifest.boneCount).not.toBe(realManifest.bones.length);
    expect(realManifest.bones.length).toBe(22);

    // poseMatrices and bones[] are the same index space (array position).
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const mats = poseMatrices(state, realManifest);
    expect(mats).toHaveLength(realManifest.bones.length * 16);
    // poseMatrices stores the translation as float32, so compare at float32
    // precision — the point is the shared INDEX space, not float64 exactness.
    const headWorld = jointWorldPosition(mats, realManifest, 'Head');
    close3(headWorld, state.bones[headIdx]!.position, 1e-6);
  });

  it('round-trips a world hit to 1e-6 m at rest and at 100 degrees', () => {
    for (const deg of [0, 100]) {
      const state = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
      const hit = boneLocalToWorld(state.bones, faIdx, occupiedCenter(realManifest, faIdx));
      const wound = worldHitToBoneWound(realManifest, state, hit, 0.055, 'pellet');
      const back = boneWoundWorldPos(state.bones[wound.boneIdx]!, wound);
      close3(back, hit, 1e-6);
    }
  });

  it('stamps a bit-identical local and tracks the flexed forearm', () => {
    const state0 = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const wound = worldHitToBoneWound(
      realManifest, state0, boneLocalToWorld(state0.bones, faIdx, occupiedCenter(realManifest, faIdx)),
      0.055, 'pellet',
    );
    expect(wound.boneIdx).toBe(faIdx);
    const stampedLocal = [...wound.local];

    for (const deg of [50, 100]) {
      const state = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
      // The stored bind-local offset never changes — the wound is bit-identical.
      expect(wound.local).toEqual(stampedLocal);
      // Its world position rides the flexed forearm.
      close3(boneWoundWorldPos(state.bones[faIdx]!, wound), boneLocalToWorld(state.bones, faIdx, wound.local), 1e-6);
    }
    // ...and the forearm actually moved between 0 and 100 degrees.
    const state100 = makeHumanoidPose(realManifest, { elbowDeg: 100, softness01: 0 });
    expect(dist3(
      boneWoundWorldPos(state0.bones[faIdx]!, wound),
      boneWoundWorldPos(state100.bones[faIdx]!, wound),
    )).toBeGreaterThan(0.001);
  });

  it('uses the rigid quaternion inverse, not matrix inversion', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 40, softness01: 0 });
    const hit = boneLocalToWorld(state.bones, faIdx, occupiedCenter(realManifest, faIdx));
    const wound = worldHitToBoneWound(realManifest, state, hit, 0.055, 'pellet');
    const bone = state.bones[wound.boneIdx]!;
    const rel: Vec3 = [
      hit[0] - bone.position[0], hit[1] - bone.position[1], hit[2] - bone.position[2],
    ];
    const expected = qRotate(qConj(qNormalize(bone.quaternion)), rel);
    close3(wound.local, expected, 1e-9);
  });

  it('renormalises a non-unit bone quaternion instead of silently skewing', () => {
    // [2, 0, 0, 0] is a 180° rotation about x scaled by 2 — non-unit.
    const pose: HumanoidBonePose = { position: [1, 2, 3], quaternion: [2, 0, 0, 0] };
    const wound: BoneWound = { boneIdx: 0, local: [0, 1, 0], radius: 0.05, type: 'pellet', ageSec: 0 };
    // Renormalised q = [1,0,0,0] -> [0,1,0] rotates to [0,-1,0].
    close3(boneWoundWorldPos(pose, wound), [1, 1, 3], 1e-9);
    // Un-renormalised it would be [1, -5, 3] (skewed) — assert it is NOT.
    expect(boneWoundWorldPos(pose, wound)[1]).not.toBeCloseTo(-5, 6);
  });

  it('keys a mid-forearm hit to RightForeArm, not RightArm or RightHand', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const hit = boneLocalToWorld(state.bones, faIdx, occupiedCenter(realManifest, faIdx));
    expect(ownerBrickForHit(realManifest, state, hit, 0.055)).toBe(faIdx);
  });

  it('keys a mid-upper-arm hit to RightArm', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const hit = boneLocalToWorld(state.bones, raIdx, occupiedCenter(realManifest, raIdx));
    expect(ownerBrickForHit(realManifest, state, hit, 0.055)).toBe(raIdx);
  });

  it('resolves the 30 mm elbow overlap deterministically and stably across the sweep', () => {
    const elbow = elbowJoint.centerModel; // inside both occupied boxes (tie)
    for (const deg of [0, 50, 100]) {
      const state = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
      // Ties break on the lower boneIdx: RightArm (17) < RightForeArm (18).
      expect(ownerBrickForHit(realManifest, state, elbow, 0.055)).toBe(raIdx);
    }
  });

  it('never fails to wound — a far hit falls back to the nearest bone origin', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const hit: Vec3 = [10, 10, 10];
    const wound = worldHitToBoneWound(realManifest, state, hit, 0.055, 'pellet');
    expect(wound.boneIdx).toBeGreaterThanOrEqual(0);
    expect(wound.boneIdx).toBeLessThan(realManifest.bones.length);
    // The rigid round trip holds regardless of ownership.
    close3(boneWoundWorldPos(state.bones[wound.boneIdx]!, wound), hit, 1e-6);
  });

  it('bounds discipline — only the occupied bounds are read, never the padded exterior', () => {
    const src = readFileSync('src/lab/sdf-zombie/humanoid-damage.ts', 'utf8');
    expect(src).toContain('occupiedBoundsMin');
    expect(src).toContain('occupiedBoundsMax');
    // The padded exterior bounds (margin + trilinear halo) must never appear —
    // even in a comment — or shoulder hits get handed to the spine.
    expect(src).not.toContain('boundsMin');
    expect(src).not.toContain('boundsMax');
  });
});

// ===========================================================================
// Step 2 — cut partition and slot budget
// ===========================================================================

describe('humanoid cut partition', () => {
  const [nx, ny, nz, wCut] = realManifest.rightArm.cutPlaneLocal;
  // local with signed cut distance s: dot(n, localAtS(s)) + w === s.
  const localAtS = (s: number): Vec3 => [
    nx * (s - wCut), ny * (s - wCut), nz * (s - wCut),
  ];

  it('partitions wounds by the cut plane into exactly one list, or both for straddlers', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const proximal: BoneWound = { boneIdx: faIdx, local: localAtS(-0.1), radius: 0.055, type: 'pellet', ageSec: 0 };
    const distal: BoneWound = { boneIdx: faIdx, local: localAtS(0.1), radius: 0.055, type: 'pellet', ageSec: 0 };
    const straddle: BoneWound = { boneIdx: faIdx, local: localAtS(0.0), radius: 0.055, type: 'pellet', ageSec: 0 };
    const lists = partitionWoundsByCut(realManifest, [proximal, distal, straddle], state.distalIndices);

    expect(lists.attached).toEqual([proximal, straddle]);
    expect(lists.detached).toEqual([distal, straddle]);

    // union minus duplicates equals the ring exactly.
    const union = new Set<BoneWound>([...lists.attached, ...lists.detached]);
    expect(union.size).toBe(3);
    expect(union.has(proximal)).toBe(true);
    expect(union.has(distal)).toBe(true);
    expect(union.has(straddle)).toBe(true);
  });

  it('duplicates straddlers, never assigns them to one side', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    // |s| < radius: strictly inside the duplication band.
    const straddle: BoneWound = { boneIdx: faIdx, local: localAtS(0.02), radius: 0.055, type: 'pellet', ageSec: 0 };
    const lists = partitionWoundsByCut(realManifest, [straddle], state.distalIndices);
    expect(lists.attached).toEqual([straddle]);
    expect(lists.detached).toEqual([straddle]);
  });

  it('routes non-forearm bones by distal ownership', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const handWound: BoneWound = { boneIdx: handIdx, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: 0 };
    const upperArmWound: BoneWound = { boneIdx: raIdx, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: 0 };
    const lists = partitionWoundsByCut(realManifest, [handWound, upperArmWound], state.distalIndices);
    expect(lists.attached).toEqual([upperArmWound]);
    expect(lists.detached).toEqual([handWound]);
  });

  it('derives lists per frame — sever/reset never touch the ring', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 50, softness01: 0.5 });
    const ring: BoneWound[] = [
      { boneIdx: faIdx, local: localAtS(-0.1), radius: 0.055, type: 'pellet', ageSec: 0 },
      { boneIdx: faIdx, local: localAtS(0.1), radius: 0.055, type: 'pellet', ageSec: 0 },
      { boneIdx: handIdx, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: 0 },
    ];
    const snapshot = JSON.parse(JSON.stringify(ring));
    const before = partitionWoundsByCut(realManifest, ring, state.distalIndices);

    let sever = severForearm(makeHumanoidSever(realManifest), state, { linear: [0, 0, 0], angular: [0, 0, 0] });
    sever = resetHumanoidSever(sever);
    sever = severForearm(sever, state, { linear: [0, 0, 0], angular: [0, 0, 0] });

    const after = partitionWoundsByCut(realManifest, ring, state.distalIndices);
    expect(after).toEqual(before);
    // The ring is bit-identical before and after the sever/reset cycle.
    expect(ring).toEqual(snapshot);
  });

  it('a hand wound is continuous across the sever frame and follows the chunk', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 63, softness01: 0.55 });
    // Hit deep inside the hand (its occupied-bounds centre), not the wrist
    // joint — the wrist lies at the forearm/hand boundary and would key to
    // the forearm.
    const handWorld = boneLocalToWorld(state.bones, handIdx, occupiedCenter(realManifest, handIdx));
    const wound = worldHitToBoneWound(realManifest, state, handWorld, 0.055, 'pellet');
    expect(wound.boneIdx).toBe(handIdx);

    const attachedWorld = boneWoundWorldPos(state.bones[handIdx]!, wound);
    close3(attachedWorld, handWorld, 1e-6);

    const sever = severForearm(makeHumanoidSever(realManifest), state, { linear: [0, 0, 0], angular: [0, 0, 0] });
    const chunk = sever.chunk!;
    // frozenDistalBones is parallel to pose.distalIndices (NOT bone array position).
    const distalPos = state.distalIndices.indexOf(handIdx);
    const frozenHand = sever.frozenDistalBones[distalPos]!;

    // The detached world position uses the identical local -> world formula
    // against chunkRootPose ∘ frozenDistalBones[k].
    const detachedWorld = boneWoundWorldPos(chunkBoneWorldPose(chunk, frozenHand), wound);
    // No pop at the sever frame (chunk root is identity at release).
    close3(detachedWorld, attachedWorld, 1e-6);
  });
});

describe('humanoid wound slot budget', () => {
  it('rimReach matches the applyWounds Gaussian-ring extent', () => {
    for (const type of ['pellet', 'blast', 'burn'] as const) {
      const prof = WOUND_PROFILES[type];
      const r = 0.1;
      const expected = r * HUMAN_WOUND_RIM_OFFSET * prof.rimOffsetScale + r * HUMAN_WOUND_RIM_WIDTH;
      expect(rimReach(r, prof.rimOffsetScale)).toBeCloseTo(expected, 12);
    }
    // The constants mirror the humanoid's global woundCfg.w / woundCfg2.x.
    expect(HUMAN_WOUND_RIM_OFFSET).toBe(1.15);
    expect(HUMAN_WOUND_RIM_WIDTH).toBe(0.42);
  });

  it('emits gapless, non-overlapping per-cluster ranges', () => {
    const mini = miniManifest(['a', 'b', 'c'], [
      { name: 'A', primaryBones: ['a'], min: [-1, -1, -1], max: [-0.5, -0.5, -0.5] },
      { name: 'B', primaryBones: ['b'], min: [0.5, 0.5, 0.5], max: [1, 1, 1] },
      { name: 'C', primaryBones: ['c'], min: [2, 2, 2], max: [3, 3, 3] },
    ]);
    const wounds: BoneWound[] = [
      { boneIdx: 0, local: [0, 0, 0], radius: 0.01, type: 'pellet', ageSec: 0 },
      { boneIdx: 1, local: [0, 0, 0], radius: 0.01, type: 'pellet', ageSec: 0 },
      { boneIdx: 2, local: [0, 0, 0], radius: 0.01, type: 'pellet', ageSec: 0 },
    ];
    const worlds: Vec3[] = [[-0.75, -0.75, -0.75], [0.75, 0.75, 0.75], [2.5, 2.5, 2.5]];
    const budget = woundSlotsForClusters(mini, wounds, worlds);

    expect(budget.dropped).toBe(0);
    expect(budget.slots).toHaveLength(3);
    expect(budget.slots.every(s => !s.duplicate)).toBe(true);
    expect(budget.ranges.map(r => [r.clusterIdx, r.start, r.count])).toEqual([
      [0, 0, 1], [1, 1, 1], [2, 2, 1],
    ]);
  });

  it('duplicates a wound into a neighbouring cluster within radius + rimReach', () => {
    const mini = miniManifest(['a', 'b'], [
      { name: 'A', primaryBones: ['a'], min: [-1, -1, -1], max: [1, 1, 1] },
      { name: 'B', primaryBones: ['b'], min: [1.05, -1, -1], max: [3, 1, 1] },
    ]);
    // wound on bone 'a' (cluster A) at world [1, 0, 0] — inside A, and its lip
    // (radius 0.1 + rimReach 0.157 = 0.257) reaches B's sweep bounds 0.05 away.
    const wounds: BoneWound[] = [{ boneIdx: 0, local: [0, 0, 0], radius: 0.1, type: 'pellet', ageSec: 0 }];
    const worlds: Vec3[] = [[1.0, 0, 0]];
    const budget = woundSlotsForClusters(mini, wounds, worlds);

    expect(budget.slots.filter(s => !s.duplicate)).toHaveLength(1);
    const dup = budget.slots.find(s => s.duplicate);
    expect(dup?.clusterIdx).toBe(1);
    expect(dup?.woundIdx).toBe(0);
  });

  it('drops the oldest duplicate copies first, never a primary, on overflow', () => {
    // 12 wounds in cluster A; clusters B and C cover everything, so each wound
    // duplicates into both -> 12 primaries + 24 duplicates = 36 > 24 slots.
    const bones = Array.from({ length: 12 }, (_, i) => `A${i}`);
    const mini = miniManifest(bones, [
      { name: 'A', primaryBones: bones, min: [-0.01, -0.01, -0.01], max: [0.01, 0.01, 0.01] },
      { name: 'B', primaryBones: [], min: [-10, -10, -10], max: [10, 10, 10] },
      { name: 'C', primaryBones: [], min: [-10, -10, -10], max: [10, 10, 10] },
    ]);
    const wounds: BoneWound[] = bones.map((_, i) => ({
      boneIdx: i, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: i,
    }));
    const worlds: Vec3[] = bones.map(() => [0, 0, 0]);
    const budget = woundSlotsForClusters(mini, wounds, worlds);

    // 36 entries -> 24: 12 duplicates dropped, all from the oldest 6 wounds.
    expect(budget.dropped).toBe(12);
    expect(budget.slots).toHaveLength(MAX_WOUND_SLOTS);

    // Every primary entry survives.
    const primaries = budget.slots.filter(s => !s.duplicate);
    expect(primaries).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(primaries.some(s => s.woundIdx === i)).toBe(true);
    }

    // The oldest 6 wounds (age 11..6) lost BOTH duplicates — visible from one
    // cluster only. The youngest 6 (age 5..0) kept them.
    for (let i = 0; i < 12; i++) {
      const dupCount = budget.slots.filter(s => s.duplicate && s.woundIdx === i).length;
      expect(dupCount).toBe(i >= 6 ? 0 : 2);
    }
  });

  it('produces valid cluster ranges against the real manifest', () => {
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    const boneIdxs = [faIdx, handIdx, headIdx, 0]; // forearm, hand, head, hips
    const wounds: BoneWound[] = boneIdxs.map(bi => ({
      boneIdx: bi,
      local: occupiedCenter(realManifest, bi),
      radius: 0.055,
      type: 'pellet',
      ageSec: 0,
    }));
    const worlds = wounds.map(w => boneWoundWorldPos(state.bones[w.boneIdx]!, w));
    const budget = woundSlotsForClusters(realManifest, wounds, worlds);

    expect(budget.slots.length).toBeLessThanOrEqual(MAX_WOUND_SLOTS);
    expect(budget.slots.length).toBeGreaterThanOrEqual(wounds.length);

    // Every wound has a primary entry in its home cluster.
    wounds.forEach((w, i) => {
      const home = clusterOf(realManifest, w.boneIdx);
      expect(budget.slots.some(s => s.woundIdx === i && s.clusterIdx === home && !s.duplicate)).toBe(true);
    });

    // Ranges are contiguous (no gaps) and cover exactly the slot array.
    let total = 0;
    for (let i = 0; i < budget.ranges.length; i++) {
      const r = budget.ranges[i]!;
      expect(r.start).toBe(total);
      total += r.count;
    }
    expect(total).toBe(budget.slots.length);
  });
});

describe('humanoid wound constants', () => {
  it('pins the logical wound cap and the larger slot budget', () => {
    expect(MAX_BONE_WOUNDS).toBe(12);
    expect(MAX_WOUND_SLOTS).toBe(24);
    expect(MAX_WOUND_SLOTS).toBeGreaterThanOrEqual(MAX_BONE_WOUNDS);
  });
});
