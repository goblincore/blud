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
// carry, including the forward aimed hold.
//
// Pure. Body-local axes: +x right, +y up, +z forward.
import type { Vec3 } from './types';
import {
  add, cross, dot, normalize, qFromAxisAngle, qMul, qRotate, scale, sub, type Quat,
} from './vec';

export type CarryName = 'low' | 'chest' | 'hip' | 'aim' | 'saw' | 'drag' | 'heavy' | 'swordGuard' | 'swordTrail';

/** Right-arm rotations, radians. pitch: forward raise about the body's
 *  right axis (0 = the authored hang). yaw: about +y, positive swings the
 *  hand INWARD toward the midline. fold: extra forward pitch of the
 *  forearm only (the elbow bend). */
export interface CarryArm { pitch: number; yaw: number; fold: number }

export interface CarrySpec {
  right: CarryArm;
  /** Muzzle pitch off the forearm direction (rad, positive = up). */
  gunPitch: number;
  /** Muzzle yaw off the forearm direction (rad, positive = OUTWARD, away
   *  from the midline): a cocked wrist. Lets the forearm angle in across the
   *  body, so the support hand can reach the fore-end, while the gun still
   *  points ahead (the juggernaut's hip-fire `heavy` carry). Absent = 0. */
  gunYaw?: number;
  /** Body-local pole for the left elbow's IK (outward and down). */
  leftPole: Vec3;
  /** ONE-HANDED: the left hand is NOT solved onto the prop's fore locator; it
   *  stays free and swings about its shoulder by `leftSwing` radians (peak),
   *  counter to the left leg — the ogre dragging his saw behind him. Absent =
   *  the two-handed contract every other carry keeps. */
  oneHanded?: { leftSwing: number };
  /** Body-local pole the RIGHT elbow is swivelled toward (alignElbow), with
   *  +x as the carry arm's OUTWARD side. Absent = the gun holds' default,
   *  (out, down, a little forward), which clears a vest. A hanging arm wants
   *  its elbow pointing BACK: the default on a near-straight hang swivels the
   *  forearm past the upper arm, the rig's elbow limit clamps it, and the fist
   *  leaves the handle (measured 20-25 cm on the ogre's drag). */
  rightPole?: Vec3;
}

/** Low/chest/hip are cross-body holds. Aim raises the forearm from a low
 *  elbow so the barrel can face forward while the fore-end remains
 *  reachable. saw/drag are the ogre's chainsaw, swordGuard/swordTrail the
 *  bride's longsword. All preserve the authored arm segment lengths. */
export const CARRIES: Record<CarryName, CarrySpec> = {
  // Low ready: grip at the waist near the midline, muzzle forward-down
  // across the body, the left hand resting on the fore-end.
  low:   { right: { pitch: 0.00, yaw: 0.75, fold: 1.85 }, gunPitch: -0.95, leftPole: [0.5, -0.3, 0.2] },
  // Running ready: elbow close to the ribs, gun across the lower chest.
  // Counter-pitch the raised forearm so the muzzle clears the face.
  chest: { right: { pitch: -0.30, yaw: 0.50, fold: 2.10 }, gunPitch: -0.25, leftPole: [0.5, -0.3, 0.2] },
  // Legacy waist-level hold, swung a little across the body, elbow tucked.
  hip:   { right: { pitch: 0.00, yaw: 0.55, fold: 1.75 }, gunPitch: -0.35, leftPole: [0.5, -0.3, 0.3] },
  // Shoulder aim: receiver above the vest, stock seated at the shoulder.
  // Bring the gun slightly inward so the support arm bends naturally instead
  // of locking straight across the face. Both elbows stay outside the vest;
  // the support elbow points down. Reach is 0.454 m on the 0.50 m left arm.
  aim:   { right: { pitch: 0.15, yaw: 0.38, fold: 2.51 }, gunPitch: -1.2275, leftPole: [0.8, -0.8, 0.45] },
  // The ogre's TWO-HANDED chainsaw hold (ogre.blob + ogre-chainsaw.glb, solved
  // at prop scale 1.45). Superseded as his walk by `drag` below; kept for a
  // future two-handed attack raise.
  // Not a variant of `low`: these angles are relative to the AUTHORED hang,
  // and the ogre hangs his forearms 30 degrees forward already, so `low`'s
  // 1.85 fold lifted the saw to his face. Grid-solved against the ogre rig
  // (shoulders at y 1.82 on a hunch, 0.83 m arms) for: grip at belly height
  // in front of the gut (hand ~(-0.28, 1.38, 0.53)), the bar level and angled
  // ~34 degrees across the body — how a chainsaw is actually carried — and
  // the front hoop at 0.76 m from the left shoulder, inside its 0.83 m reach
  // with slack for the gait sway. The upper arm swings BACK (pitch -0.75) so
  // the elbow sits out past the gut instead of through it.
  saw:   { right: { pitch: -0.75, yaw: 0.65, fold: 1.55 }, gunPitch: 0.20, leftPole: [0.6, -0.4, 0.1] },
  // DRAG — the ogre's walking hold since 2026-09-22 (owner: "it doesnt make
  // sense to hold the chainsaw like a gun ... in quake the ogre drags it
  // around on the ground behind him"). ONE-HANDED: the right fist holds the
  // saw's rear handle with the arm hanging, and the bar trails BEHIND and
  // down so its nose rides just over the floor. Grid-solved against the ogre
  // rig at prop scale 1.6 for: fist beside the hip, a fist's width (>= 12 cm)
  // CLEAR of the thigh-root flesh (wrist ~(-0.50, 0.96, 0.07); the grip sits
  // 7.5 cm further on, in the fist — the profile's gripReach) — the rig's
  // body collision shoved a fist placed at x -0.40 a full 20 cm forward off
  // the handle; the bar trailing back and down, outboard of the leg, its
  // nose ~0.08 m up at the centreline (re-solved for the 1.00 m gorilla arms) (the chain edge a few cm
  // off the floor — the stride's bob scrapes it). The elbow keeps a BEND
  // (fold 0.65, wrist at 88% of the 1.00 m arm): a first solve hung the arm
  // dead straight at full reach, and any drift in the verlet shoulder then
  // showed as a 7 cm gap between fist and handle. ogre-blob.test.ts pins the
  // trail and the grip. The left arm is free and swings.
  drag:  { right: { pitch: -1.05, yaw: 0.20, fold: 0.65 }, gunPitch: -0.85, leftPole: [0.6, -0.4, 0.1], oneHanded: { leftSwing: 0.35 }, rightPole: [0.2, 0, -1] },
  // HEAVY — the juggernaut's hip-fired chaingun (juggernaut.blob +
  // juggernaut-chaingun.glb at prop scale 1.45), in every state: he walks
  // and fires from the same hold. Grid-solved on his rest rig (2026-09-25,
  // docs/dev-notes/2026-09-25-juggernaut/NOTES.md) for: the rear grip at his
  // right hip (fist ~(-0.17, 1.37, 0.36)), the muzzle pointing where he faces
  // (0.5 deg off, 3 deg up; the rounds fly along it, so a skewed hold would
  // miss by design), the barrel clear of his torso, and the left hand on the
  // TOP CARRY HANDLE (the prop's foreHand override) at 91% of arm reach.
  // `hip` could not do it: its forearm points across the body, and a forearm
  // pointed ahead leaves the handle out of reach. The fix is the cocked wrist:
  // the forearm angles in (yaw 0.40) and the gun yaws back out (gunYaw 0.30).
  heavy: { right: { pitch: 0.10, yaw: 0.40, fold: 1.00 }, gunPitch: 0.40, gunYaw: 0.30, leftPole: [0.6, -0.5, 0.1] },
  // SWORD GUARD — the bride's walk/stand/fire hold (bride.blob +
  // bride-sword.glb at scale 1, profile gripReach 0.04 + fistOnGrip): the
  // HIGH GUARD (vom Tag) of the reference, both hands on the grip at her right
  // shoulder, the blade up and back over it. TWO-HANDED: the left hand IKs
  // onto Fore_Hand, which sits 23 cm UP the grip, above the right fist.
  // Grid-solved on the bride rig through the real motion pipeline
  // (makeActorMotion, 60 Hz, scored after a 1 s settle; lab walk speed 1.1 and
  // standing agree within a few mm). The angles are relative to HER authored
  // hang (upper arm tilted 14 out, forearm 12, the 0.30 m sword forearm), not
  // to the soldier's. Solved for:
  //   fist on the grip 0.8 cm, left hand on Fore_Hand 0.8 cm;
  //   grip at the shoulder (body-local ~(-0.22, 1.47, 0.15)), top hand beside
  //   the jaw ((-0.25, 1.67, 0.05)) — OUTSIDE the face: a first solve
  //   (pitch 0.80 / yaw 0.50 / fold 2.20) held the grip 8 cm higher and the
  //   left forearm lay across her eyes in the front frame;
  //   blade ~27 degrees back of vertical and ~9 out, tip 0.86 m over the head
  //   point, the blade 24 cm clear of it;
  //   both elbows >= 9 cm outside the torso field (sdBody): the upper arm
  //   hangs nearly at rest (pitch 0.30) with the elbow out, and the forearm
  //   folds up past vertical (fold 2.70) to put the fist at the shoulder.
  // bride-blob.test.ts pins the grip, the fore-hand and the tip over the head.
  swordGuard: { right: { pitch: 0.30, yaw: 0.70, fold: 2.70 }, gunPitch: 0.70, leftPole: [0.6, -0.5, 0.2] },
  // SWORD TRAIL — her run: ONE-HANDED, the right arm hanging back (the ogre
  // drag's elbow-back pole) with the point trailing low behind her right hip,
  // outboard of the leg; the left arm is free and swings. The plan's starting
  // values held on the rig as written: fist on the grip 0.9 cm, the tip at
  // y 0.21 (never above 0.35, the pin) about 1.2 m behind and 0.57 m out of
  // the pelvis, the right elbow 2.5 cm and the swinging left elbow 0.6 cm
  // outside the torso field.
  swordTrail: { right: { pitch: -0.55, yaw: 0.10, fold: 0.30 }, gunPitch: -0.90, leftPole: [0.6, -0.4, 0.1], oneHanded: { leftSwing: 0.40 }, rightPole: [0.2, 0, -1] },
};

/** Shared held-gun locators, gun-local metres, +z = muzzle. Measured from
 *  soldier-shotgun.glb node tree under GunRoot. Hand spacing remains the
 *  legacy attachment contract; the larger enemy gun extends only its muzzle. */
export const GUN_GRIP = {
  gripHand: [0, -0.074, -0.074] as Vec3,
  foreHand: [0, -0.045, 0.155] as Vec3,
  /** Extended enemy shotgun muzzle, matching soldier-shotgun.glb. */
  muzzle: [0, 0, 0.410] as Vec3,
} as const;

/** Scale applies to the mesh and every gun-local attachment; absent = 1. */
export interface GunPose { root: Vec3; quat: Quat; scale?: number }

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
 *  along elbow→hand pitched by `gunPitch` about `bodyRight`, then yawed by
 *  `gunYaw` about world up (+ swings the muzzle toward +x; motion.ts passes
 *  the carry's outward yaw with the arm's side sign). */
export function gunPoseFromArm(elbow: Vec3, hand: Vec3, bodyRight: Vec3, gunPitch: number, size = 1, gunYaw = 0): GunPose {
  const fwd0 = normalize(sub(hand, elbow));
  const pitched = gunPitch === 0 ? fwd0 : qRotate(qFromAxisAngle(bodyRight, -gunPitch), fwd0);
  const fwd = gunYaw === 0 ? pitched : qRotate(qFromAxisAngle([0, 1, 0], gunYaw), pitched);
  const quat = lookQuat(fwd, [0, 1, 0]);
  const root = sub(hand, qRotate(quat, scale(GUN_GRIP.gripHand, size)));
  return { root, quat, scale: size };
}

/** A gun-local point in world. */
export function gunPoint(pose: GunPose, local: Vec3): Vec3 {
  return add(pose.root, qRotate(pose.quat, scale(local, pose.scale ?? 1)));
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
export const MUZZLE_RISE = { peak: 0.12, decay: 0.12 } as const;
export function muzzleRise(age: number): number {
  if (age < 0) return 0;
  return MUZZLE_RISE.peak * Math.exp(-age / MUZZLE_RISE.decay);
}


/** Swivel a solved elbow around the shoulder-to-grip axis toward a pole.
 * Both segment lengths and the grip stay fixed. Unlike a side-only reflection,
 * this chooses a fold plane that can clear the chest and its armor. */
export function alignElbow(shoulder: Vec3, elbow: Vec3, hand: Vec3, pole: Vec3): Vec3 {
  const axis = sub(hand, shoulder);
  const length2 = dot(axis, axis);
  if (length2 < 1e-12) return elbow;
  const centre = add(shoulder, scale(axis, dot(sub(elbow, shoulder), axis) / length2));
  const radial = sub(pole, scale(axis, dot(pole, axis) / length2));
  const radius = Math.sqrt(dot(sub(elbow, centre), sub(elbow, centre)));
  if (dot(radial, radial) < 1e-12 || radius < 1e-9) return elbow;
  return add(centre, scale(normalize(radial), radius));
}
