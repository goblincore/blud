// src/lab/sdf-zombie/hound-attack.ts
//
// The QUADRUPED's melee (the gorehound, characters/gorehound.blob): a BITE
// from close in and a POUNCE from the band beyond. Same contracts as the
// bride's sword (sword-swing.ts), so the zombie's ring brain (brain.ts) drives
// it unchanged:
//   * houndPose: phase 0..1 in, body-local joint offsets out, ADDED onto the
//     gait (attack.ts's AttackPose; attackPose routes these variants here);
//   * houndContact: the one frame the jaws close on a player in front;
//   * pounceAdvance: the root travel of the leap, distributed on the strike;
//   * houndGapeAt: the jaw, wide through the wind-up, snapped shut on the
//     strike — the bite lands with the jaws.
//
// A quadruped's arms are its front legs, so the swing does not move them,
// except the pounce, which throws both paws forward and up off the floor
// (motion.ts releases the front plants for that window). The bite is all
// neck: the shoulders stay planted and the head is thrown at the target.
//
// Axes are body-local: +z forward, +y up, +x the body's right.
import type { Vec3 } from './types';
import { ATTACK_TUNING, attackDrive, type AttackPose, type SwingVariant } from './attack';
import { BRAIN_TUNING, type BrainTuning } from './brain';
import { wrapPi } from './wander';

export type HoundVariant = 'bite' | 'pounce';
export function isHoundVariant(v: SwingVariant): v is HoundVariant {
  return v === 'bite' || v === 'pounce';
}

export const HOUND_TUNING = {
  /** BITE: root, chest, neck and head forward at the strike (m). The head
   *  travels most: a dog's bite is a neck strike off planted shoulders. */
  bite: { root: 0.10, chest: 0.10, neck: 0.22, head: 0.30, headDrop: -0.06, windback: 0.08, windRise: 0.05 },
  /** POUNCE: the wind-up is a CROUCH (root down and back), the strike throws
   *  the body up and forward and both front paws up off the floor. */
  pounce: {
    crouch: -0.10, crouchBack: -0.08, rise: 0.22, root: 0.12, chest: 0.12, neck: 0.18, head: 0.24,
    pawUp: 0.24, pawFwd: 0.22,
  },
  /** Root travel over one pounce (m), and how close it may land (m). */
  pounceDistance: 1.6,
  pounceStopShort: 0.8,
  /** While it pounces the hind plants slide within this fraction of leg
   *  length of the hips (motion.ts plantReach). */
  pouncePlantReach: 1.0,
  /** The front paws are off the floor over this phase window. */
  airborne: { from: 0.22, to: 0.62 },
  /** The jaw (rad): wide on the wind-up, snapped shut by the strike's end. */
  gape: { bite: 0.55, pounce: 0.65 } as Record<HoundVariant, number>,
  /** Contact: on the phase the jaws close, inside this reach and cone. */
  contact: {
    phase: { bite: 0.45, pounce: 0.48 } as Record<HoundVariant, number>,
    reach: { bite: 1.55, pounce: 1.7 } as Record<HoundVariant, number>,
    cone: 0.7,
  },
  brain: {
    ...BRAIN_TUNING,
    // A 1.5 m body whose head reaches ~1.3 m ahead of its pelvis.
    meleeRadius: 1.35,
    outerRadius: 2.2,
    engageRange: 4.2,
    releaseRange: 5.0,
    lungeBand: { min: 2.0, max: 3.4 },
    lungeVariant: 'pounce',
    pickVariant: () => 'bite',
    swingSec: 0.75,
    swingSecFor: { bite: 0.7, pounce: 1.05 },
    cooldownSec: 0.9,
  } satisfies BrainTuning as BrainTuning,
} as const;

const Z: Vec3 = [0, 0, 0];

/** The hound's attack pose at `phase` — the AttackPose contract (attack.ts):
 *  exactly zero at phase 0 and 1. `drive` is attack.ts's signed scalar
 *  (0 -> -1 wind-up -> +1 strike/hold -> 0). */
export function houndPose(phase: number, variant: HoundVariant): AttackPose {
  const d = attackDrive(phase, ATTACK_TUNING);
  const reach = { pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 };
  if (d === 0) return { offsets: {}, rootOffset: Z, reach };
  const w = Math.max(0, -d); // wind-up weight
  const s = Math.max(0, d); // strike weight
  if (variant === 'bite') {
    const B = HOUND_TUNING.bite;
    return {
      offsets: {
        chest: [0, 0, s * B.chest - w * B.windback * 0.5],
        neck: [0, w * B.windRise, s * B.neck - w * B.windback],
        head: [0, w * B.windRise + s * B.headDrop, s * B.head - w * B.windback],
      },
      rootOffset: [0, 0, s * B.root - w * B.windback * 0.5],
      reach,
    };
  }
  const P = HOUND_TUNING.pounce;
  const paw: Vec3 = [0, s * P.pawUp, s * P.pawFwd];
  return {
    offsets: {
      chest: [0, w * P.crouch + s * P.rise, s * P.chest + w * P.crouchBack],
      neck: [0, w * P.crouch + s * P.rise, s * P.neck + w * P.crouchBack],
      head: [0, w * P.crouch + s * P.rise, s * P.head + w * P.crouchBack],
      elbowL: paw, elbowR: paw, handL: paw, handR: paw,
    },
    rootOffset: [0, w * P.crouch + s * P.rise * 0.6, s * P.root + w * P.crouchBack],
    reach,
  };
}

/** True while a pounce has the front paws off the floor. */
export function pounceAirborne(phase: number, variant: SwingVariant): boolean {
  const A = HOUND_TUNING.airborne;
  return variant === 'pounce' && phase > A.from && phase < A.to;
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Jaw gape (rad) at `phase`: opens on the wind-up to the variant's peak,
 *  holds to mid-strike, snaps shut by strikeEnd. Exactly 0 outside
 *  (0, strikeEnd). Pure. */
export function houndGapeAt(phase: number, variant: HoundVariant): number {
  const T = ATTACK_TUNING;
  if (!(phase > 0) || phase >= T.strikeEnd) return 0;
  const peak = HOUND_TUNING.gape[variant];
  if (phase < T.windupEnd) return peak * smooth(phase / T.windupEnd);
  const mid = (T.windupEnd + T.strikeEnd) / 2;
  if (phase < mid) return peak;
  return peak * (1 - smooth((phase - mid) / (T.strikeEnd - mid)));
}

/** The jaws close on the player this frame (prevPhase -> phase crosses the
 *  variant's contact phase, the player within reach and in front). */
export function houndContact(a: {
  prevPhase: number; phase: number; variant: HoundVariant;
  self: { x: number; z: number; yaw: number }; player: { x: number; z: number };
}): boolean {
  const C = HOUND_TUNING.contact;
  const at = C.phase[a.variant];
  if (!(a.prevPhase < at && a.phase >= at)) return false;
  const dx = a.player.x - a.self.x, dz = a.player.z - a.self.z;
  if (Math.hypot(dx, dz) > C.reach[a.variant]) return false;
  return Math.abs(wrapPi(Math.atan2(dx, dz) - a.self.yaw)) <= C.cone;
}

/** Root advance (m) this frame for a pounce going prevPhase -> phase with the
 *  player `dist` m away: the leap's travel on the strike window's smoothstep,
 *  never landing closer than pounceStopShort. */
export function pounceAdvance(prevPhase: number, phase: number, dist: number): number {
  const T = ATTACK_TUNING;
  const w = (p: number) => smooth((p - T.windupEnd) / (T.strikeEnd - T.windupEnd));
  const step = HOUND_TUNING.pounceDistance * (w(phase) - w(prevPhase));
  const room = Math.max(0, dist - HOUND_TUNING.pounceStopShort);
  return Math.max(0, Math.min(step, room));
}
