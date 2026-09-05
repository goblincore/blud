// src/lab/sdf-zombie/rig-frames.ts
//
// One RIGID transform per blob bone, derived from the posed verlet rig.
//
// This is what lets anything that is not raymarched flesh ride the rig: the
// skinned kit glTF (kit-overlay.ts poses its bone nodes from these), a held
// prop (held-prop.ts), and — through segmentQuat — the rigid head and torso
// bone passes in rig-bind.ts, which computed the same composition three
// times before this module existed.
//
// A two-point bone has no roll of its own. The rotation is therefore
// composed as the KNOWN body yaw first, then the shortest arc from the
// turned rest direction to the posed direction: the same rule headTransform
// established (a near-vertical segment's bare shortest-arc loses azimuth).
//
// Pure. No THREE. Rig points are world space, so frames are world space.
import type { BuildResult } from './build-body';
import type { BoundRig } from './rig-bind';
import type { Vec3 } from './types';
import { rotateYaw } from './gait';
import {
  len, normalize, qFromAxisAngle, qFromTo, qIdentity, qMul, sub, type Quat,
} from './vec';

export interface BoneFrame3 {
  /** The bone's head, world. */
  pos: Vec3;
  /** Bind → posed rotation (world), [x, y, z, w]. */
  quat: Quat;
}

/**
 * Yaw-first segment rotation: qMul(qFromTo(rotateYaw(restDir, yaw), dir), qYaw).
 * At rest (dir == restDir, yaw 0) this is the exact identity.
 */
export function segmentQuat(restDir: Vec3, dir: Vec3, bodyYaw: number): Quat {
  const rest = bodyYaw === 0 ? restDir : rotateYaw(restDir, bodyYaw);
  const qYaw = bodyYaw === 0 ? qIdentity() : qFromAxisAngle([0, 1, 0], bodyYaw);
  return qMul(qFromTo(rest, dir), qYaw);
}

const KEY_EPS = 1e-4;

/**
 * Frames for every bone in `body.bones`, keyed by bone name.
 *
 * Bone ends are mapped to rig point indices by rebuilding bindRig's OWN
 * dedup — rest-space positions, in `body.bones` order, same KEY_EPS — never
 * by looking ends up in `bound.rig.restPose`. stepActorMotion REWRITES
 * restPose with world-space rest targets every sub-step (rootShift baked
 * in, motion.ts's MotionFrame contract), so after the body takes a single
 * step no rest-space bone end would match and every frame would go
 * missing — the kit fell back to the bind pose at the origin while the
 * body stood a wander away (task-13 smoke shot). The same indices then
 * read the CURRENT points, which ARE world space, so frames are world.
 */
export function boneFrames(body: BuildResult, bound: BoundRig, bodyYaw: number): Map<string, BoneFrame3> {
  const pts = bound.rig.points;
  const positions: Vec3[] = [];
  const indexAt = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++)
      if (len(sub(positions[i]!, p)) < KEY_EPS) return i;
    positions.push(p);
    return positions.length - 1;
  };
  const out = new Map<string, BoneFrame3>();
  for (const [name, bone] of body.bones) {
    const iH = indexAt(bone.head), iT = indexAt(bone.tail);
    // Out-of-range means this bound was built from a DIFFERENT body — skip
    // rather than pose from a stranger's points.
    if (iH === iT || iH >= pts.length || iT >= pts.length) continue;
    const head = pts[iH]!.pos, tail = pts[iT]!.pos;
    const restDir = normalize(sub(bone.tail, bone.head));
    const dir = normalize(sub(tail, head));
    out.set(name, { pos: [head[0], head[1], head[2]], quat: segmentQuat(restDir, dir, bodyYaw) });
  }
  return out;
}

/**
 * The name three's GLTFLoader gives a node: PropertyBinding.sanitizeNodeName
 * strips `[ ] . : /`, so the blob bone `clavicle.l` arrives as `claviclel`.
 * Anything matching kit bone nodes against blob bone names must go through
 * this, or every mirrored bone silently misses its frame and rides its
 * parent instead (the pauldrons stayed on the torso while the arms swung).
 */
export function kitBoneKey(name: string): string {
  return name.replace(/[\[\]\.:\/]/g, '');
}
