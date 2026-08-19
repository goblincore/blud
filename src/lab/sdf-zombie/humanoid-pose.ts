// src/lab/sdf-zombie/humanoid-pose.ts
//
// Task 4 — the humanoid's ONE articulation: a pure right-elbow pose model.
// The rig is otherwise bind pose; the elbow scrubber flexes the forearm
// about the manifest's measured `RightArm -> RightForeArm` joint axis, and
// the softness slider turns the flexion into a critically damped spring
// (18 Hz at rigid-near down to 3 Hz at maximum softness) whose surface-warp
// amplitude is deliberately NOT baked into the matrices — Task 5 consumes
// `softness01` and `timeSec` as shader uniforms.
//
// PIVOT CHOICE (why the elbow never moves). The pose stores per-bone
// `{ position, quaternion }` world transforms; the flexion rotates the
// RightForeArm subtree about the joint axis THROUGH THE FOREARM'S BIND
// ORIGIN — the forearm bindToModel translation, which lies ON the measured
// elbow axis (verified: `RightForeArm.bindToModel.translation −
// RightArm.bindToModel.translation` is exactly parallel to `axisModel`).
// The forearm's own position is therefore the fixed point of the rotation,
// so `jointWorldPosition(poseMatrices(…), 'RightForeArm')` is flexion-
// invariant to the last ulp, while the hand orbits it. The manifest's
// `centerModel` (the skin-weight boundary centroid, ~46 mm off the axis) is
// a diagnostic, not the rotation pivot.
//
// STABLE STATE SHAPES. The plan pins the six fields of `HumanoidPoseState`;
// the pose also carries three manifest-derived facts so `stepHumanoidPose`
// can re-pose without receiving the manifest again: the unit `elbowAxis`,
// the invariant `elbowPivot`, and `distalIndices` (the bones[] array
// positions of RightForeArm and every descendant — same index space as the
// coarse bricks and the sever module). All of it is pure state-in/state-out;
// no input is mutated and identical input sequences produce identical
// output.

import type { Vec3 } from './types';
import { qFromAxisAngle, qMul, qNormalize, qRotate, type Quat } from './vec';
import type { HumanoidVolumeManifest } from './webgpu/humanoid-volume';

/** One bone's world pose: the joint position (bind origin under the pose)
 *  and the bind→world unit quaternion. */
export interface HumanoidBonePose {
  position: Vec3;
  quaternion: Quat;
}

export interface HumanoidPoseState {
  elbowTargetDeg: number;
  elbowDeg: number;
  elbowVelocityDeg: number;
  softness01: number;
  timeSec: number;
  bones: readonly HumanoidBonePose[];
  /** Unit flexion axis in model space, from the RightArm→RightForeArm joint. */
  elbowAxis: Vec3;
  /** The flexion fixed point: the forearm's bind origin (on the elbow axis). */
  elbowPivot: Vec3;
  /** manifest.bones[] positions of RightForeArm and every descendant. */
  distalIndices: readonly number[];
}

export interface HumanoidPoseOptions {
  elbowDeg: number;
  softness01: number;
}

export interface HumanoidStepOptions {
  elbowTargetDeg: number;
  softness01: number;
}

/** The elbow scrubber's range (degrees). */
export const HUMANOID_ELBOW_MIN_DEG = 0;
export const HUMANOID_ELBOW_MAX_DEG = 100;
/** Critically damped spring frequency: 18 Hz rigid-near, 3 Hz max latex. */
export const HUMANOID_SOFT_RIGID_HZ = 18;
export const HUMANOID_SOFT_MAX_HZ = 3;
/** The spring integration step is clamped to 1/30 s (frame-spike safety). */
export const HUMANOID_SPRING_DT_CLAMP_S = 1 / 30;

const DEG_TO_RAD = Math.PI / 180;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function clampElbowDeg(v: number): number {
  if (!Number.isFinite(v)) return HUMANOID_ELBOW_MIN_DEG;
  return Math.min(HUMANOID_ELBOW_MAX_DEG, Math.max(HUMANOID_ELBOW_MIN_DEG, v));
}

/**
 * The manifest.bones[] array positions of `rootBone` and every bone whose
 * parentIndex chain reaches it — ascending array order, root first. This is
 * the shared index space the pose spring and the sever module both use.
 */
export function distalBoneIndices(
  manifest: HumanoidVolumeManifest,
  rootBone: string,
): number[] {
  const rootIdx = manifest.bones.findIndex(b => b.bone === rootBone);
  if (rootIdx < 0) throw new Error(`humanoid pose: unknown bone ${rootBone}`);
  const out = [rootIdx];
  for (let i = 0; i < manifest.bones.length; i++) {
    let p = manifest.bones[i]!.parentIndex;
    while (p !== -1) {
      if (p === rootIdx) {
        out.push(i);
        break;
      }
      p = manifest.bones[p]!.parentIndex;
    }
  }
  return out;
}

/** Unit quaternion from a rigid 3x3 rotation (the bake's column-major 4x4).
 *  The checked-in bind matrices are exactly orthonormal (det +1, ortho error
 *  0), so this round-trips to ~1e-16. */
function quatFromRotation(m: readonly number[]): Quat {
  const m00 = m[0]!, m10 = m[1]!, m20 = m[2]!;
  const m01 = m[4]!, m11 = m[5]!, m21 = m[6]!;
  const m02 = m[8]!, m12 = m[9]!, m22 = m[10]!;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return qNormalize([x, y, z, w]);
}

/** Bind pose: every bone's joint position and bind→world rotation. */
function bindPose(manifest: HumanoidVolumeManifest): HumanoidBonePose[] {
  return manifest.bones.map(b => ({
    position: [b.bindToModel[12]!, b.bindToModel[13]!, b.bindToModel[14]!],
    quaternion: quatFromRotation(b.bindToModel),
  }));
}

/**
 * Applies an elbow flexion `elbowDeg` (degrees, 0 = identity) about
 * `elbowAxis` through `elbowPivot`, rigidly rotating only `distalIndices`.
 * The pivot is the forearm's bind origin, so the forearm's own position is
 * the rotation's fixed point. Pure — the input array is not mutated.
 */
function applyElbow(
  bones: readonly HumanoidBonePose[],
  elbowDeg: number,
  elbowAxis: Vec3,
  elbowPivot: Vec3,
  distalIndices: readonly number[],
): HumanoidBonePose[] {
  const out = bones.slice();
  if (elbowDeg === 0) return out;
  const q = qNormalize(qFromAxisAngle(elbowAxis, elbowDeg * DEG_TO_RAD));
  for (const i of distalIndices) {
    const b = bones[i]!;
    const d: Vec3 = [
      b.position[0] - elbowPivot[0],
      b.position[1] - elbowPivot[1],
      b.position[2] - elbowPivot[2],
    ];
    const r = qRotate(q, d);
    out[i] = {
      position: [elbowPivot[0] + r[0], elbowPivot[1] + r[1], elbowPivot[2] + r[2]],
      quaternion: qNormalize(qMul(q, b.quaternion)),
    };
  }
  return out;
}

/**
 * Initial pose: the whole rig in bind pose flexed to `elbowDeg` immediately
 * (softness affects the spring BETWEEN steps, not the initial placement — a
 * sever at 63° with softness 0.55 starts the detached piece at 63°).
 */
export function makeHumanoidPose(
  manifest: HumanoidVolumeManifest,
  opts: HumanoidPoseOptions,
): HumanoidPoseState {
  const softness01 = clamp01(opts.softness01);
  const deg = clampElbowDeg(opts.elbowDeg);
  const joint = manifest.joints.find(j => j.child === manifest.rightArm.forearm);
  if (!joint) {
    throw new Error(`humanoid pose: manifest is missing the ${manifest.rightArm.upperArm} -> ${manifest.rightArm.forearm} joint`);
  }
  const bind = bindPose(manifest);
  const faIdx = manifest.bones.findIndex(b => b.bone === manifest.rightArm.forearm);
  if (faIdx < 0) throw new Error(`humanoid pose: manifest is missing the ${manifest.rightArm.forearm} brick`);
  const axisLen = Math.hypot(joint.axisModel[0], joint.axisModel[1], joint.axisModel[2]);
  const elbowAxis: Vec3 = [
    joint.axisModel[0] / axisLen,
    joint.axisModel[1] / axisLen,
    joint.axisModel[2] / axisLen,
  ];
  const elbowPivot = bind[faIdx]!.position;
  const distalIndices = distalBoneIndices(manifest, manifest.rightArm.forearm);
  return {
    elbowTargetDeg: deg,
    elbowDeg: deg,
    elbowVelocityDeg: 0,
    softness01,
    timeSec: 0,
    bones: applyElbow(bind, deg, elbowAxis, elbowPivot, distalIndices),
    elbowAxis,
    elbowPivot,
    distalIndices,
  };
}

/**
 * Advances the pose by `dt` seconds toward `elbowTargetDeg`. Softness 0
 * snaps directly (no secondary lag); softness > 0 runs one critically
 * damped spring step whose frequency interpolates 18 Hz → 3 Hz and whose
 * integration dt is clamped to 1/30 s. dt <= 0 or non-finite dt is a no-op
 * returning the same object. `timeSec` advances by the raw dt (wall clock
 * for the Task 5 shader warp). Pure — the input state is not mutated.
 */
export function stepHumanoidPose(
  state: HumanoidPoseState,
  opts: HumanoidStepOptions,
  dt: number,
): HumanoidPoseState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  const softness01 = clamp01(opts.softness01);
  const target = clampElbowDeg(opts.elbowTargetDeg);

  let elbowDeg: number;
  let elbowVelocityDeg: number;
  if (softness01 === 0) {
    elbowDeg = target;
    elbowVelocityDeg = 0;
  } else {
    const dtc = Math.min(dt, HUMANOID_SPRING_DT_CLAMP_S);
    const hz = HUMANOID_SOFT_RIGID_HZ
      + (HUMANOID_SOFT_MAX_HZ - HUMANOID_SOFT_RIGID_HZ) * softness01;
    const omega = 2 * Math.PI * hz;
    // Exact critically damped step (target constant during dtc): the closed
    // form of x'' + 2ωx' + ω²(x − target) = 0, unconditionally stable and
    // incapable of overshooting a stationary target.
    const a = state.elbowDeg - target;
    const b = state.elbowVelocityDeg + omega * a;
    const e = Math.exp(-omega * dtc);
    elbowDeg = target + e * (a + b * dtc);
    elbowVelocityDeg = e * (b - omega * (a + b * dtc));
  }

  return {
    ...state,
    elbowTargetDeg: target,
    elbowDeg,
    elbowVelocityDeg,
    softness01,
    timeSec: state.timeSec + dt,
    bones: applyElbow(
      state.bones,
      elbowDeg - state.elbowDeg,
      state.elbowAxis,
      state.elbowPivot,
      state.distalIndices,
    ),
  };
}

/**
 * The 16-float column-major model matrix per bone, stacked in manifest.bones[]
 * array order (the same layout as bindToModel, so at 0° the output is the
 * bind pose). This is the CPU-side rigid transform Tasks 5–7 consume.
 */
export function poseMatrices(
  state: HumanoidPoseState,
  manifest: HumanoidVolumeManifest,
): Float32Array {
  if (state.bones.length !== manifest.bones.length) {
    throw new Error(`humanoid pose: state has ${state.bones.length} bones, manifest has ${manifest.bones.length}`);
  }
  const out = new Float32Array(manifest.bones.length * 16);
  for (let i = 0; i < manifest.bones.length; i++) {
    const p = state.bones[i]!;
    const [x, y, z, w] = p.quaternion;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const o = i * 16;
    out[o + 0] = 1 - (yy + zz);
    out[o + 1] = xy + wz;
    out[o + 2] = xz - wy;
    out[o + 3] = 0;
    out[o + 4] = xy - wz;
    out[o + 5] = 1 - (xx + zz);
    out[o + 6] = yz + wx;
    out[o + 7] = 0;
    out[o + 8] = xz + wy;
    out[o + 9] = yz - wx;
    out[o + 10] = 1 - (xx + yy);
    out[o + 11] = 0;
    out[o + 12] = p.position[0];
    out[o + 13] = p.position[1];
    out[o + 14] = p.position[2];
    out[o + 15] = 1;
  }
  return out;
}

/** The world position of a bone's joint (its matrix translation), read from
 *  the poseMatrices stack. Throws for an unknown bone name. */
export function jointWorldPosition(
  matrices: Float32Array,
  manifest: HumanoidVolumeManifest,
  boneName: string,
): Vec3 {
  const idx = manifest.bones.findIndex(b => b.bone === boneName);
  if (idx < 0) throw new Error(`humanoid pose: unknown bone ${boneName}`);
  const o = idx * 16;
  return [matrices[o + 12]!, matrices[o + 13]!, matrices[o + 14]!];
}
