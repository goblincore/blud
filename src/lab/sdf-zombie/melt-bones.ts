// src/lab/sdf-zombie/melt-bones.ts
//
// MELT / BONES — the skeleton falls out of the goo. Pure, like melt.ts: no
// Date.now, no Math.random (the rng here is seeded), because the capture gate
// compares runs.
//
// WHY GROUPS AND NOT TUBES (spec
// docs/superpowers/specs/2026-09-03-zombie-melt-design.md): a ribcage does
// not disassemble into individual ribs when the flesh goes. Bones release as
// ELEVEN rigid groups — skull, cage, pelvis and the eight long bones — into
// the same chunk stepper severed limbs already use (gib-chunks.ts). ~11
// rigid bodies instead of ~60 loose tubes is anatomically right AND several
// times cheaper, and it still satisfies "full skeleton": every authored tube
// renders, it simply moves in the group it is actually attached in.
//
// RELEASE IS DERIVED, NOT SCRIPTED. A group drops when the melt front (the
// same number that sags the flesh — endpointProgress in melt.ts) has passed
// the group's centroid. Leg bones go first and the skull comes off last
// because that is where they ARE, not because a table says so.

import type { LimbId, Primitive, Vec3 } from './types';
import { endpointProgress, type MeltState } from './melt';

/** The 11 rigid groups. Limb ids are CONCRETE (`.l`/`.r`) — `thigh.l` IS a
 *  group; only the torso's bones merge (skull+neck, spine+ribs+clavicles,
 *  the pelvic assembly). */
export const BONE_GROUPS = [
  'skull', 'cage', 'pelvis',
  'upperArm.l', 'upperArm.r', 'foreArm.l', 'foreArm.r',
  'thigh.l', 'thigh.r', 'shin.l', 'shin.r',
] as const;

export type BoneGroup = (typeof BONE_GROUPS)[number];

/**
 * Which rigid group an authored bone belongs to. Concrete limb bones map to
 * themselves; the torso aggregates. ANYTHING unrecognised — including a bone
 * prim with no `bone` field at all — goes to 'cage': the torso default. A
 * dropped bone prim silently disappears from the render, and a wrong-group
 * bone merely falls at the wrong moment.
 */
export function groupOf(boneName: string | undefined): BoneGroup {
  if (!boneName) return 'cage';
  if (boneName === 'skull' || boneName === 'neck') return 'skull';
  if (boneName === 'pelvis') return 'pelvis';
  if ((BONE_GROUPS as readonly string[]).includes(boneName)) {
    return boneName as BoneGroup;
  }
  // spine, ribs, sternum, clavicle.*, and anything future and torso-ish.
  return 'cage';
}

/**
 * Group the bone prims of a body. ORGANS ARE NOT BONES: op 'organ' prims
 * live on the same bonePrims array but are soft — they melt with the flesh
 * (task 7), they do not drop as rigid chunks, so they are excluded here.
 */
export function partitionBones(
  bonePrims: readonly Primitive[],
): Map<BoneGroup, Primitive[]> {
  const out = new Map<BoneGroup, Primitive[]>();
  for (const p of bonePrims) {
    if (p.op !== 'bone') continue;
    const g = groupOf(p.bone);
    const arr = out.get(g);
    if (arr) arr.push(p);
    else out.set(g, [p]);
  }
  return out;
}

/** Mean of every endpoint of every prim in the group — the group's centre
 *  of mass for release timing and for the chunk's physics seed. */
export function groupCentroid(prims: readonly Primitive[]): Vec3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const p of prims) {
    for (const e of [p.a, p.b]) { x += e[0]; y += e[1]; z += e[2]; n++; }
  }
  return n > 0 ? [x / n, y / n, z / n] : [0, 0, 0];
}

/**
 * Release schedule, low to high, DERIVED from group centroid heights — legs
 * first, skull last on any upright body, with no hard-coded order to drift
 * out of sync with the authoring.
 */
export function releaseOrder(parts: Map<BoneGroup, Primitive[]>): BoneGroup[] {
  return [...parts.entries()]
    .map(([g, ps]) => [g, groupCentroid(ps)[1]] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([g]) => g);
}

/**
 * The melt front's progress at a world-space height — endpointProgress
 * (melt.ts) evaluated on a synthetic endpoint at that height, so the bone
 * release runs on EXACTLY the number that sags the flesh. `span` is the same
 * normalisation meltInit used: top flesh endpoint Y above the floor.
 */
export function groupReleaseProgress(
  s: MeltState, centroidY: number, span: number, floorY = 0,
): number {
  const h = (centroidY - floorY) / (span > 1e-6 ? span : 1);
  return endpointProgress({ ...s, heights: [h] }, 0);
}

/**
 * The chunk's LimbId. The skull maps to TORSO, not 'head': the chunk view
 * switches its face projection on for 'head' chunks
 * (zombie-gpu.ts `c.limb === 'head'`), and the zombie's painted eyes and
 * mouth on a bare skull is exactly the wrong read.
 */
export function limbOfGroup(g: BoneGroup): LimbId {
  switch (g) {
    case 'thigh.l': case 'shin.l': return 'legL';
    case 'thigh.r': case 'shin.r': return 'legR';
    case 'upperArm.l': case 'foreArm.l': return 'armL';
    case 'upperArm.r': case 'foreArm.r': return 'armR';
    default: return 'torso'; // skull, cage, pelvis
  }
}

/**
 * Deterministic rng (mulberry32) for chunk tumble and clatter velocities.
 * makeChunk defaults its rng to Math.random and a random tumble destroys the
 * capture gate's run-to-run reproducibility — the melt NEVER uses the
 * default.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
