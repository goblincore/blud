// src/lab/sdf-zombie/sword-swing.ts
//
// THE SWORD SWING — the bride's melee, as pure data.
//
// A carry character's right arm is authored by the CARRY table (carry.ts),
// and motion.ts's carry block overwrites whatever the swing's reach arc did,
// so until now a held prop never swung. The fix is a TRACK: per variant, a
// wind-up key and a strike key in the carry vocabulary (shoulder pitch/yaw,
// elbow fold, blade pitch), interpolated on attack.ts's phase clock
// guard -> wind-up -> strike (held) -> guard. motion.ts uses the track in
// place of the smoothed carry while a sword swing is live; the left hand
// stays IK'd to Fore_Hand, so both hands stay on the grip by construction.
//
// Phase 0 and 1 return the guard EXACTLY, so the swing enters and leaves the
// walking carry without a step.
//
// Also here: the lunge's root advance (the brain halts locomotion during an
// attack, so the actor moves her by this), the strike's contact test, and
// SWORD_TUNING (the brain knobs). Pure; no three. Body-local conventions as
// carry.ts: +x right, +y up, +z forward; the key angles are carry.ts's.
import { ATTACK_TUNING, type AttackTuning, type SwingVariant } from './attack';
import { BRAIN_TUNING, type BrainTuning } from './brain';
import type { CarryArm, CarrySpec } from './carry';
import { wrapPi } from './wander';

export type SwordVariant = 'cleave' | 'sweep' | 'lunge';
const SWORD_VARIANTS: readonly SwingVariant[] = ['cleave', 'sweep', 'lunge'];
export function isSwordVariant(v: SwingVariant): v is SwordVariant {
  return SWORD_VARIANTS.includes(v);
}

interface SwordKey { arm: CarryArm; gunPitch: number }

/** STARTING angles. Task 9 re-solves them against the bride rig (the carry
 *  table's own lesson: angles are relative to the AUTHORED hang, never
 *  copied between bodies) — the tests pin the SHAPE (cleave strikes down,
 *  sweep crosses the body), not these numbers. */
export const SWORD_KEYS: Record<SwordVariant, { windup: SwordKey; strike: SwordKey }> = {
  // Overhead, two-handed: blade raised behind the head, then driven down
  // through the player to about hip height.
  cleave: {
    windup: { arm: { pitch: 2.4, yaw: 0.35, fold: 1.2 }, gunPitch: 0.9 },
    strike: { arm: { pitch: 0.55, yaw: 0.25, fold: 0.15 }, gunPitch: -0.55 },
  },
  // Flat: cocked OUT to her right, swept ACROSS the body to her left.
  sweep: {
    windup: { arm: { pitch: 1.1, yaw: -0.9, fold: 1.0 }, gunPitch: 0.1 },
    strike: { arm: { pitch: 1.0, yaw: 1.1, fold: 0.4 }, gunPitch: -0.1 },
  },
  // Drawn back at the hip, then the arm straightens into a thrust.
  lunge: {
    windup: { arm: { pitch: 0.6, yaw: 0.3, fold: 2.2 }, gunPitch: -0.2 },
    strike: { arm: { pitch: 1.45, yaw: 0.2, fold: 0.05 }, gunPitch: -0.05 },
  },
};

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mixKey(a: SwordKey, b: SwordKey, t: number): SwordKey {
  return {
    arm: { pitch: lerp(a.arm.pitch, b.arm.pitch, t), yaw: lerp(a.arm.yaw, b.arm.yaw, t), fold: lerp(a.arm.fold, b.arm.fold, t) },
    gunPitch: lerp(a.gunPitch, b.gunPitch, t),
  };
}

/** The carry at `phase` of a `variant` swing thrown from `guard`. */
export function swordCarryAt(
  phase: number, variant: SwordVariant, guard: CarrySpec, tuning: AttackTuning = ATTACK_TUNING,
): CarrySpec {
  if (!(phase > 0) || phase >= 1) return guard;
  const T = tuning, K = SWORD_KEYS[variant];
  const g: SwordKey = { arm: guard.right, gunPitch: guard.gunPitch };
  let k: SwordKey;
  if (phase < T.windupEnd) k = mixKey(g, K.windup, smooth(phase / T.windupEnd));
  else if (phase < T.strikeEnd) k = mixKey(K.windup, K.strike, smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd)));
  else if (phase < T.holdEnd) k = K.strike;
  else k = mixKey(K.strike, g, smooth((phase - T.holdEnd) / (1 - T.holdEnd)));
  return {
    right: { ...k.arm },
    gunPitch: k.gunPitch,
    leftPole: guard.leftPole,
    ...(guard.rightPole ? { rightPole: guard.rightPole } : {}),
  };
}

export const SWORD_TUNING = {
  /** Root travel over one lunge (m). */
  lungeDistance: 1.2,
  /** The lunge never carries her closer than this to the player (m). */
  lungeStopShort: 0.9,
  brain: {
    ...BRAIN_TUNING,
    // Reach ~2 m of blade + arm; holders stand inside it.
    meleeRadius: 1.8,
    outerRadius: 2.6,
    engageRange: 3.4,
    releaseRange: 4.0,
    lungeBand: { min: 2.2, max: 3.1 },
    pickVariant: (roll: number) => (roll < 0.5 ? 'cleave' : 'sweep'),
    swingSec: 1.0,
    swingSecFor: { cleave: 1.25, sweep: 0.9, lunge: 1.0 },
    cooldownSec: 1.4,
  } satisfies BrainTuning as BrainTuning,
} as const;

/** Root advance (m) this frame for a lunge going prevPhase -> phase, with the
 *  player `dist` m away. Distributed on the strike window's smoothstep, so
 *  the body surges with the arm. */
export function lungeAdvance(
  prevPhase: number, phase: number, dist: number, tuning: AttackTuning = ATTACK_TUNING,
): number {
  const w = (p: number) => smooth((p - tuning.windupEnd) / (tuning.strikeEnd - tuning.windupEnd));
  const step = SWORD_TUNING.lungeDistance * (w(phase) - w(prevPhase));
  const room = Math.max(0, dist - SWORD_TUNING.lungeStopShort);
  return Math.max(0, Math.min(step, room));
}

/** When in the swing the blade connects, and what it can reach. */
export const SWORD_CONTACT = {
  /** Mid-strike. */
  phase: (ATTACK_TUNING.windupEnd + ATTACK_TUNING.strikeEnd) / 2,
  reach: { cleave: 2.1, sweep: 2.0, lunge: 2.0 } as Record<SwordVariant, number>,
  /** Half-angle of the hit cone about her facing (rad). */
  cone: { cleave: 0.45, sweep: 1.2, lunge: 0.35 } as Record<SwordVariant, number>,
} as const;

/** True on exactly the frame the phase crosses the hit instant with the
 *  player inside this variant's reach and cone. 2-D, like the brain. */
export function swordContact(a: {
  prevPhase: number; phase: number; variant: SwordVariant;
  self: { x: number; z: number; yaw: number }; player: { x: number; z: number };
}): boolean {
  const at = SWORD_CONTACT.phase;
  if (!(a.prevPhase < at && a.phase >= at)) return false;
  const dx = a.player.x - a.self.x, dz = a.player.z - a.self.z;
  if (Math.hypot(dx, dz) > SWORD_CONTACT.reach[a.variant]) return false;
  return Math.abs(wrapPi(Math.atan2(dx, dz) - a.self.yaw)) <= SWORD_CONTACT.cone[a.variant];
}
