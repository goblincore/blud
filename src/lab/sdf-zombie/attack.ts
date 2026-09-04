// src/lab/sdf-zombie/attack.ts
//
// The melee swing pose. Phase 0..1 in, body-local joint offsets out — the
// same contract stagger.ts emits (metres, body-local, ADDED onto gait's
// offsets, missing keys mean zero, rootOffset applies to the pelvis), so
// motion.ts composes it exactly where it composes a stagger.
//
// FOUR BEATS ON ONE SCALAR. Wind-up (weight and arms back), strike (the root
// drives forward and the arms come down and across), a short hold at contact,
// then recovery to zero. Every offset is that one signed `drive` scalar times
// a magnitude, which is what keeps the beats in step: there is no way for the
// arms to peak on a different frame from the lunge.
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
  /** Root drive forward at the strike peak (m). */
  lunge: 0.22,
  /** Root pull-back at the wind-up peak (m, magnitude). */
  windback: 0.08,
  /** Chest drive forward at the strike peak (m). */
  chestDrive: 0.12,
  /** Chest lean back at the wind-up peak (m, magnitude). */
  chestRear: 0.06,
  /** Neck/head carry this share of the chest offset. */
  headShare: 0.7,
  /** Reach-style arm pitch at the wind-up peak (rad, magnitude — the sign
   *  comes from the drive scalar, so the arms go BACK). */
  pitchWindup: 0.55,
  /** Reach-style arm pitch at the strike peak (rad, forward/down). */
  pitchStrike: 0.95,
  /** Extra hand drop on the forward half (m). */
  handDrop: 0.14,
} as const;

export type AttackTuning = typeof ATTACK_TUNING;

export interface AttackPose {
  /** Body-local per-joint offsets — ADD to gait's offsets; missing = zero. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  /** Body-local pelvis offset — ADD to gait's rootOffset. */
  rootOffset: Vec3;
  /** Added to the reach-style arm pitch (rad) before the shoulder pivot. */
  reachPitch: number;
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

/** The swing pose at `phase`. See the header for the contract. */
export function attackPose(phase: number, tuning: AttackTuning = ATTACK_TUNING): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  if (d === 0) {
    return {
      offsets: { chest: ZERO, neck: ZERO, head: ZERO, handL: ZERO, handR: ZERO },
      rootOffset: ZERO,
      reachPitch: 0,
    };
  }
  const fwd = d >= 0;
  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
  const handY = fwd ? -d * T.handDrop : 0;
  const hand: Vec3 = [0, handY, chestZ];
  return {
    offsets: {
      chest: [0, 0, chestZ],
      neck: [0, 0, headZ],
      head: [0, 0, headZ],
      handL: hand,
      handR: hand,
    },
    rootOffset: [0, 0, rootZ],
    reachPitch: fwd ? d * T.pitchStrike : d * T.pitchWindup,
  };
}
