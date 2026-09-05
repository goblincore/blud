// src/lab/sdf-zombie/carry.ts
//
// ARM CARRIES — how a character holds a long gun, and where the gun is.
//
// A carry is authored as ROTATIONS of the right arm about its shoulder (a
// shoulder pitch/yaw and an elbow fold), never as hand displacements: both
// segments keep their exact rest lengths, so the verlet constraints are
// satisfiable without dragging the shoulder out of the torso (the reach-pose
// lesson in gait.ts / motion.ts). The gun then rides the right FOREARM
// (elbow→hand) — a 24 cm lever is a steadier frame than the 9.5 cm hand bone
// whose tip is a free verlet point — with its Grip_Hand locator seated on
// the hand point and its muzzle pitched off the forearm by `gunPitch`.
//
// The LEFT hand is not authored at all: the motion layer FABRIK-solves it
// onto the gun's Fore_Hand locator (ik.ts solveChain, lengths preserved
// exactly), with an outward pole so the elbow never folds through the body.
// That is what makes "both hands on the gun" true by construction in every
// carry, and it is what a fourth, shouldered carry will reuse.
//
// Pure. Body-local axes: +x right, +y up, +z forward.
import type { Vec3 } from './types';
import {
  add, cross, dot, normalize, qFromAxisAngle, qMul, qRotate, sub, type Quat,
} from './vec';

export type CarryName = 'low' | 'chest' | 'hip';

/** Right-arm rotations, radians. pitch: forward raise about the body's
 *  right axis (0 = the authored hang). yaw: about +y, positive swings the
 *  hand INWARD toward the midline. fold: extra forward pitch of the
 *  forearm only (the elbow bend). */
export interface CarryArm { pitch: number; yaw: number; fold: number }

export interface CarrySpec {
  right: CarryArm;
  /** Muzzle pitch off the forearm direction (rad, positive = up). */
  gunPitch: number;
  /** Body-local pole for the left elbow's IK (outward and down). */
  leftPole: Vec3;
}

/** Starting numbers for the owner's look, not contracts. (Tuned in Task 6:
 *  the left-shoulder reach gate forces every two-handed carry into a
 *  cross-body diagonal — right hand near the midline, fore-end up at the
 *  left hand — so `yaw` does the reaching and the original near-zero yaws
 *  put the fore-end 0.6–0.8 m from the left shoulder.) */
export const CARRIES: Record<CarryName, CarrySpec> = {
  // Low ready: grip at the waist near the midline, muzzle forward-down
  // across the body, the left hand resting on the fore-end.
  low:   { right: { pitch: 0.00, yaw: 0.75, fold: 1.85 }, gunPitch: -0.95, leftPole: [0.5, -0.3, 0.2] },
  // Diagonal across the chest, muzzle up, both hands on it — the run.
  chest: { right: { pitch: 0.60, yaw: 0.40, fold: 1.55 }, gunPitch: 0.55,  leftPole: [0.6, 0.1, 0.1] },
  // Level at the waist, swung a little across the body, elbow tucked — the shot.
  hip:   { right: { pitch: 0.00, yaw: 0.55, fold: 1.75 }, gunPitch: -0.35, leftPole: [0.5, -0.3, 0.3] },
};

/** shorty-double.glb locators, gun-local metres, +z = muzzle. Measured from
 *  the glb's node tree (Grip_Hand/Fore_Hand under Frame, Muzzle_L/R under
 *  Barrels, all rotation-free, GunRoot at the origin). */
export const GUN_GRIP = {
  gripHand: [0, -0.074, -0.074] as Vec3,
  foreHand: [0, -0.045, 0.155] as Vec3,
  /** Midpoint of Muzzle_L / Muzzle_R. */
  muzzle: [0, 0, 0.318] as Vec3,
} as const;

export interface GunPose { root: Vec3; quat: Quat }

/**
 * Rotation taking gun-local +z onto `fwd` with gun-local +x kept as close
 * as possible to `cross(up, fwd)` — i.e. no roll about the barrel.
 */
export function lookQuat(fwd: Vec3, up: Vec3): Quat {
  const f = normalize(fwd);
  const qArc = ((): Quat => {
    // shortest arc +z → f (inline qFromTo to avoid a circular-feeling import)
    const d = Math.max(-1, Math.min(1, f[2]));
    if (d >= 1 - 1e-9) return [0, 0, 0, 1];
    if (d <= -1 + 1e-9) return qFromAxisAngle([0, 1, 0], Math.PI);
    return qFromAxisAngle(normalize(cross([0, 0, 1], f)), Math.acos(d));
  })();
  const x0 = qRotate(qArc, [1, 0, 0]);
  let xd = cross(up, f);
  if (dot(xd, xd) < 1e-12) return qArc; // looking straight up/down: any roll
  xd = normalize(xd);
  const ang = Math.atan2(dot(cross(x0, xd), f), dot(x0, xd));
  return qMul(qFromAxisAngle(f, ang), qArc);
}

/** The gun's world pose from the right forearm: Grip_Hand on `hand`, muzzle
 *  along elbow→hand pitched by `gunPitch` about `bodyRight`. */
export function gunPoseFromArm(elbow: Vec3, hand: Vec3, bodyRight: Vec3, gunPitch: number): GunPose {
  const fwd0 = normalize(sub(hand, elbow));
  const fwd = gunPitch === 0 ? fwd0 : qRotate(qFromAxisAngle(bodyRight, -gunPitch), fwd0);
  const quat = lookQuat(fwd, [0, 1, 0]);
  const root = sub(hand, qRotate(quat, GUN_GRIP.gripHand));
  return { root, quat };
}

/** A gun-local point in world. */
export function gunPoint(pose: GunPose, local: Vec3): Vec3 {
  return add(pose.root, qRotate(pose.quat, local));
}

/**
 * Pivots one arm about its shoulder. `s1`/`s2` are the REST segment vectors
 * (shoulder→elbow, elbow→hand) already rotated into world by the body yaw;
 * `bodyRight` is the body's world right axis; `inward` is +1 or −1 — the
 * sign that turns "toward the midline" into a rotation about +y for this
 * side (the caller derives it from the shoulder's x relative to the pelvis).
 * `presence` scales every angle (the gait blend floor).
 */
export function armPivot(
  shoulder: Vec3, s1: Vec3, s2: Vec3, arm: CarryArm, bodyRight: Vec3, inward: number, presence: number,
): { elbow: Vec3; hand: Vec3 } {
  const p = arm.pitch * presence, y = arm.yaw * presence * inward, f = arm.fold * presence;
  // Positive pitch = forward: about +right the hang swings BACK, so negate
  // (same convention as the reach pivot in motion.ts).
  const qYaw = qFromAxisAngle([0, 1, 0], y);
  const qUpper = qMul(qYaw, qFromAxisAngle(bodyRight, -p));
  const qFore = qMul(qYaw, qFromAxisAngle(bodyRight, -(p + f)));
  const elbow = add(shoulder, qRotate(qUpper, s1));
  const hand = add(elbow, qRotate(qFore, s2));
  return { elbow, hand };
}

/** Muzzle-rise after a shot: an extra gun pitch (rad) decaying from the
 *  fire instant. Pure in `age` so the prop can pose without state. */
export const MUZZLE_RISE = { peak: 0.35, decay: 0.12 } as const;
export function muzzleRise(age: number): number {
  if (age < 0) return 0;
  return MUZZLE_RISE.peak * Math.exp(-age / MUZZLE_RISE.decay);
}
