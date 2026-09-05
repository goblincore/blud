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
 * Frames for every bone in `body.bones`, keyed by bone name. Each bone's
 * head and tail are looked up in the rig's REST pose (bindRig dedups rig
 * points by position, so a bone end is found by position, not index) and
 * the same indices read the CURRENT points.
 */
export function boneFrames(body: BuildResult, bound: BoundRig, bodyYaw: number): Map<string, BoneFrame3> {
  const rest = bound.rig.restPose;
  const pts = bound.rig.points;
  const indexAt = (p: Vec3): number => {
    for (let i = 0; i < rest.length; i++) if (len(sub(rest[i]!, p)) < KEY_EPS) return i;
    return -1;
  };
  const out = new Map<string, BoneFrame3>();
  for (const [name, bone] of body.bones) {
    const iH = indexAt(bone.head), iT = indexAt(bone.tail);
    if (iH < 0 || iT < 0 || iH === iT) continue;
    const head = pts[iH]!.pos, tail = pts[iT]!.pos;
    const restDir = normalize(sub(bone.tail, bone.head));
    const dir = normalize(sub(tail, head));
    out.set(name, { pos: [head[0], head[1], head[2]], quat: segmentQuat(restDir, dir, bodyYaw) });
  }
  return out;
}
