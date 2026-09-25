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

/** Solved against the bride rig (Task 9: a CPU grid + coordinate-descent
 *  solve through makeActorMotion, the Task 8 carry method). Scored per key:
 *  fist on the grip, left hand on Fore_Hand, both elbows outside the torso,
 *  the blade clear of her head, torso and legs, and the strike tip at player
 *  chest height ~1.5 m out; then the in-between phases were scored too.
 *  Angles are relative to the AUTHORED hang (carry.ts's lesson), so they are
 *  hers alone. The tests pin the SHAPE (cleave strikes down, the sweep's yaw
 *  changes sign); bride-blob.test.ts pins the blade's travel. */
export const SWORD_KEYS: Record<SwordVariant, { windup: SwordKey; strike: SwordKey }> = {
  // Overhead, two-handed: hands over the crown, the blade laid back behind
  // her head (tip ~2.9 m), then brought over the top and down until the
  // point is at the player's chest 1.5 m out (tip drop ~1.5 m).
  cleave: {
    windup: { arm: { pitch: 1.6, yaw: 1.15, fold: 1.2 }, gunPitch: 1.15 },
    strike: { arm: { pitch: 0.25, yaw: 0.75, fold: 2.1 }, gunPitch: -1.15 },
  },
  // Raised to her front-right (hands at the right hip, blade up and out),
  // then swept across flat at chest height to finish out on her left. The
  // shape pin keeps the wind-up yaw negative; a two-handed grip cannot cock
  // the blade flat out to her right with the arm yawed out (the left hand
  // runs out of reach), so the wind-up stands the blade up instead.
  sweep: {
    windup: { arm: { pitch: -0.75, yaw: -0.2, fold: 2.05 }, gunPitch: 0.95 },
    strike: { arm: { pitch: 0.4, yaw: 1.4, fold: 1.1 }, gunPitch: -0.55 },
  },
  // Drawn back: hands at the right hip, the point low and forward; then the
  // hands drive up to the chest and the point out level at chest height.
  // Two hands cap the arm's reach — the root advance (lungeAdvance) is the
  // distance, the arm is the aim.
  lunge: {
    windup: { arm: { pitch: -1.2, yaw: 1.15, fold: 1.6 }, gunPitch: 1.25 },
    strike: { arm: { pitch: 0.45, yaw: 0.75, fold: 2 }, gunPitch: -1.2 },
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

/** THE JAW GAPE (Task 12, hook 2): how far the bride's jaw swings open
 *  (rad, about jaw.ts's JAW_HINGE) on each variant. The
 *  cleave is the big one, the overhead scream; the sweep is a side cut
 *  thrown faster, the lunge a thrust, so they open less. At 0.55 rad the
 *  chin drops ~3.5 cm (bride-blob.test.ts pins >= 3 cm), which splits the
 *  mouth well past the painted sutures' start at the corners. */
export const JAW_GAPE = {
  peak: { cleave: 0.55, sweep: 0.35, lunge: 0.42 } as Record<SwordVariant, number>,
  /** The jaw holds wide into the strike and SNAPS shut over its second half
   *  (mid-strike -> strikeEnd): the bite lands with the blade (cleave hit
   *  0.47, sweep 0.40). */
} as const;

/** Jaw gape (rad) at `phase` of a `variant` swing: 0 at rest, opening on the
 *  wind-up's smoothstep to the peak at windupEnd, held to mid-strike, shut
 *  by strikeEnd. Exactly 0 outside (0, strikeEnd). Pure. */
export function jawGapeAt(phase: number, variant: SwordVariant, tuning: AttackTuning = ATTACK_TUNING): number {
  const T = tuning, peak = JAW_GAPE.peak[variant];
  if (!(phase > 0) || phase >= T.strikeEnd) return 0;
  if (phase < T.windupEnd) return peak * smooth(phase / T.windupEnd);
  const mid = (T.windupEnd + T.strikeEnd) / 2;
  if (phase < mid) return peak;
  return peak * (1 - smooth((phase - mid) / (T.strikeEnd - mid)));
}

/** When in the swing the blade connects, and what it can reach. */
export const SWORD_CONTACT = {
  /** The hit instant per variant, on the strike beat (0.25 -> 0.5 on a
   *  smoothstep). Mid-strike (0.375) was too early: the ease is only 0.5
   *  there, so the cleave's tip was still overhead and a lunge from the top
   *  of its band had covered half its advance and was out of reach. Each
   *  value is where the blade actually arrives; all stay before holdEnd.
   *  bride-blob.test.ts pins the tip height and reach at each one. */
  phase: { cleave: 0.47, sweep: 0.40, lunge: 0.47 } as Record<SwordVariant, number>,
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
  const at = SWORD_CONTACT.phase[a.variant];
  if (!(a.prevPhase < at && a.phase >= at)) return false;
  const dx = a.player.x - a.self.x, dz = a.player.z - a.self.z;
  if (Math.hypot(dx, dz) > SWORD_CONTACT.reach[a.variant]) return false;
  return Math.abs(wrapPi(Math.atan2(dx, dz) - a.self.yaw)) <= SWORD_CONTACT.cone[a.variant];
}
