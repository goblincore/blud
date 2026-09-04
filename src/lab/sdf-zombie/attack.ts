// src/lab/sdf-zombie/attack.ts
//
// The melee swing pose. Phase 0..1 in, body-local joint offsets out — the
// same contract stagger.ts emits (metres, body-local, ADDED onto gait's
// offsets, missing keys mean zero, rootOffset applies to the pelvis), so
// motion.ts composes it exactly where it composes a stagger.
//
// FOUR BEATS ON ONE SCALAR, ONE ARM AT A TIME. Wind-up (the swinging arm
// cocks back and out, weight back), strike (the arm sweeps forward AND across
// the body while the torso twists into it), a short hold at contact, then
// recovery to zero. Every offset is that one signed `drive` scalar times a
// magnitude, which is what keeps the beats in step: there is no way for the
// arm to peak on a different frame from the lunge.
//
// The ACROSS part is a yaw about world up, and it is the whole difference
// between a hook and the two-arm chop this replaced (owner, 2026-09-04: "both
// arms raising and slamming them down is merely... okay"). motion.ts composes
// it as a second rotation on the reach pivot.
//
// The caller alternates `side` between swings — a stalled pack swinging the
// same arm every time reads as a metronome.
//
// Phase 0 and phase 1 are EXACTLY zero, so the pose enters and leaves the
// gait without a step discontinuity.
//
// Axes are body-local: +z forward (the body faces +z, see wander.headingDir),
// +y up, +x the body's right.
import type { Vec3 } from './types';
import type { GaitJointName } from './gait';

export const ATTACK_TUNING = {
  /** Beat boundaries as fractions of the swing. */
  windupEnd: 0.25,
  strikeEnd: 0.5,
  holdEnd: 0.6,
  /** Root drive forward at the strike peak (m). LOWER than the two-arm slam's
   *  0.22: the torso rotation now carries the weight, and the old lunge on
   *  top of a hook reads as a stumble rather than a punch. */
  lunge: 0.14,
  /** Root pull-back at the wind-up peak (m, magnitude). */
  windback: 0.07,
  /** Chest drive forward at the strike peak (m). */
  chestDrive: 0.10,
  /** Chest lean back at the wind-up peak (m, magnitude). */
  chestRear: 0.05,
  /** Neck/head carry this share of the chest offset. */
  headShare: 0.7,
  /** Swinging arm: shoulder pitch at the wind-up peak (rad, magnitude — the
   *  arm cocks BACK; the sign comes from the drive scalar). */
  pitchWindup: 0.85,
  /** Swinging arm: shoulder pitch at the strike peak (rad, forward). */
  pitchStrike: 0.55,
  /** Swinging arm: yaw cocked OUT, away from the body, at the wind-up (rad). */
  yawWindup: 0.55,
  /** Swinging arm: yaw swept ACROSS the body at the strike (rad). This is the
   *  whole difference between a hook and a chop. */
  yawStrike: 1.15,
  /** The off arm counter-swings at this share of the swinging arm's angles,
   *  opposite in sign. */
  offArmShare: 0.28,
  /** Forward drive of the swinging shoulder at the strike (m); the other
   *  shoulder takes the negative. Two opposite z offsets ARE the torso twist
   *  about the vertical — cheaper and more legible than a real rotation. */
  shoulderDrive: 0.06,
  /** Swinging hand's extra drop on the forward half (m). */
  handDrop: 0.10,
} as const;

export type AttackTuning = typeof ATTACK_TUNING;

export interface AttackPose {
  /** Body-local per-joint offsets — ADD to gait's offsets; missing = zero. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  /** Body-local pelvis offset — ADD to gait's rootOffset. */
  rootOffset: Vec3;
  /** Per-side reach-pivot deltas. `pitch` is about the body's right axis (as
   *  the reach pose already is); `yaw` is about world up and is new — it is
   *  the hook's horizontal sweep. Both ADD to the gait's reach pitch. */
  reach: { pitchL: number; pitchR: number; yawL: number; yawR: number };
}

const ZERO: Vec3 = [0, 0, 0];

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The swing's one signed scalar: 0 at rest, down to -1 at the wind-up peak,
 * up to +1 through the strike and hold, back to 0 by the end of the recovery.
 * Phases outside [0, 1] clamp to 0 — a caller feeding a stale phase gets the
 * rest pose, never an extrapolated one.
 */
export function attackDrive(phase: number, tuning: AttackTuning = ATTACK_TUNING): number {
  if (!(phase > 0) || phase >= 1) return 0;
  const T = tuning;
  if (phase < T.windupEnd) return -smooth(phase / T.windupEnd);
  if (phase < T.strikeEnd) {
    return -1 + 2 * smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd));
  }
  if (phase < T.holdEnd) return 1;
  return 1 - smooth((phase - T.holdEnd) / (1 - T.holdEnd));
}

/**
 * The swing pose at `phase`, swung by `side`'s arm. See the header for the
 * contract. Sign convention: body-local +x is the body's right, so the RIGHT
 * arm sweeping across the body is a NEGATIVE yaw and the left arm's is
 * positive — which is what `sgn` below carries, making L and R exact mirrors
 * by construction rather than by two hand-written branches.
 */
export function attackPose(
  phase: number, side: 'L' | 'R', tuning: AttackTuning = ATTACK_TUNING,
): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  if (d === 0) {
    return {
      offsets: {
        chest: ZERO, neck: ZERO, head: ZERO,
        shoulderL: ZERO, shoulderR: ZERO, handL: ZERO, handR: ZERO,
      },
      rootOffset: ZERO,
      reach: { pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 },
    };
  }
  const sgn = side === 'R' ? 1 : -1;
  const fwd = d >= 0;

  // The swinging arm. Pitch keeps the existing convention (positive = forward
  // reach), so a negative drive cocks it back. Yaw is cocked OUT on the
  // wind-up and swept ACROSS on the strike — opposite signs, which is what
  // makes it read as a hook rather than a shove.
  const pitchSwing = fwd ? d * T.pitchStrike : d * T.pitchWindup;
  const yawSwing = fwd ? -sgn * d * T.yawStrike : sgn * -d * T.yawWindup;
  const pitchOff = -pitchSwing * T.offArmShare;
  const yawOff = -yawSwing * T.offArmShare;

  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
  // The twist scales with the drive, so the shoulders lead the wind-up too.
  const drive = d * T.shoulderDrive;
  const handY = fwd ? -d * T.handDrop : 0;

  const swingShoulder: Vec3 = [0, 0, drive];
  const offShoulder: Vec3 = [0, 0, -drive];
  const swingHand: Vec3 = [0, handY, 0];

  return {
    offsets: {
      chest: [0, 0, chestZ],
      neck: [0, 0, headZ],
      head: [0, 0, headZ],
      shoulderL: side === 'L' ? swingShoulder : offShoulder,
      shoulderR: side === 'R' ? swingShoulder : offShoulder,
      handL: side === 'L' ? swingHand : ZERO,
      handR: side === 'R' ? swingHand : ZERO,
    },
    rootOffset: [0, 0, rootZ],
    reach: {
      pitchL: side === 'L' ? pitchSwing : pitchOff,
      pitchR: side === 'R' ? pitchSwing : pitchOff,
      yawL: side === 'L' ? yawSwing : yawOff,
      yawR: side === 'R' ? yawSwing : yawOff,
    },
  };
}
