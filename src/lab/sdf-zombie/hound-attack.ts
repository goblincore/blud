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

/** The hound's bite and pounce, and the gibbet's two (characters/gibbet.blob): the STAB (both front legs rear up and
 *  drive their spike tips forward) and the SQUIRT (the caged sac swings back, then forward, and lobs a glob of bile
 *  from its drip: bile.ts; the squirt never makes contact itself). */
export type HoundVariant = 'bite' | 'pounce' | 'stab' | 'squirt';
export function isHoundVariant(v: SwingVariant): v is HoundVariant {
  return v === 'bite' || v === 'pounce' || v === 'stab' || v === 'squirt';
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
  /** STAB: ONE leg, a mantis strike (the swing's side; the brain alternates). The first pass raised both legs and
   *  pushed them forward together and the owner saw "pattycake". Now the body REARS back onto its haunches and leans
   *  away from the striking leg, which cocks high and back with its spike aimed forward like a spear; the strike
   *  LUNGES the whole body forward as the spike drives in. The other leg stays planted. (m, body-local) */
  //
  // Second review: "still tame". So the stab has its OWN clock (stabDrive), not the swing's even wind-up and strike:
  // a long cock (the anticipation is the threat), a strike over a tenth of the swing, a hold, a recovery; the rear
  // and the cock are bigger, the leg cocked up past the beam, and the body STEPS into the strike (stabAdvance).
  stab: {
    rearRise: 0.20, rearBack: 0.14, rearLean: 0.08, chestRise: 0.34,
    cockElbow: [0.14, 0.62, -0.10], cockPaw: [0.10, 0.82, -0.12], cockTip: [0.08, 0.86, 0.12],
    lunge: 0.30, lungeDrop: 0.10, chestLunge: 0.42,
    strikeElbow: [0.05, 0.28, 0.40], strikePaw: [0.02, 0.20, 0.72], strikeTip: [0.0, 0.10, 0.95],
    /** The stab's clock: cocked by `cocked`, struck by `struck`, held to `hold`, recovered by 1. */
    cocked: 0.42, struck: 0.52, hold: 0.68,
    /** Root travel into the strike (m), never closer to the player than `stopShort`. */
    advance: 0.45, stopShort: 1.1,
  },
  /** SQUIRT: the whole body squats to spray. Held over the swing (an envelope, not the signed drive, so it never
   *  pops up mid-swing): the HAUNCHES drop, the front stays up so the back tilts up, and the dangling head swings up
   *  and aside out of the spray's path. Inside that, the sac (the `hem` pendulum) swings back on the wind-up and
   *  forward through the strike, the glob leaving at `fireAt`, and the body jolts forward with the shot. The first
   *  pass moved only the sac and the owner saw a still body with "the flesh dangle". */
  squirt: {
    haunch: 0.17, haunchBack: 0.05, withersUp: 0.06, headAside: 0.16, headUp: 0.16, headBack: 0.04,
    back: 0.20, lift: 0.04, fwd: 0.30, fwdLift: 0.10, jolt: 0.06, fireAt: 0.42,
  },
  /** Root travel over one pounce (m), and how close it may land (m). */
  pounceDistance: 1.6,
  pounceStopShort: 0.8,
  /** While it pounces the hind plants slide within this fraction of leg
   *  length of the hips (motion.ts plantReach). */
  pouncePlantReach: 1.0,
  /** The front paws are off the floor over this phase window (a pounce; a stab rears for nearly the whole swing). */
  airborne: { from: 0.22, to: 0.62 },
  stabAirborne: { from: 0.04, to: 0.88 },
  /** The jaw (rad): wide on the wind-up, snapped shut by the strike's end. The gibbet's attacks are not bites. */
  gape: { bite: 0.55, pounce: 0.65, stab: 0, squirt: 0 } as Record<HoundVariant, number>,
  /** Contact: on the phase the jaws (or the spikes) close, inside this reach and cone. The squirt's reach is 0: the
   *  glob hits or misses on its own (bile.ts). */
  contact: {
    phase: { bite: 0.45, pounce: 0.48, stab: 0.50, squirt: 1 } as Record<HoundVariant, number>,
    reach: { bite: 1.55, pounce: 1.7, stab: 1.95, squirt: 0 } as Record<HoundVariant, number>,
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
export function houndPose(phase: number, variant: HoundVariant, side: 'L' | 'R' = 'R'): AttackPose {
  const pose = houndPoseRaw(phase, variant, side);
  // THE HIP JOINTS GO WITH THE ROOT. hipL/hipR are not bone-linked to the pelvis in the rig: they follow their own
  // targets. A pose that moves the root and leaves them behind pulls the hind legs off the pelvis (the gibbet's
  // first stab: both thighs came away from the beam's sockets). Poses that place the hips themselves (the squirt's
  // squat) keep theirs.
  const o = pose.offsets;
  if (pose.rootOffset === Z) return pose;
  if (o.hipL === undefined) o.hipL = pose.rootOffset;
  if (o.hipR === undefined) o.hipR = pose.rootOffset;
  if (o.hips === undefined) o.hips = pose.rootOffset;
  return pose;
}

/** The stab's own signed drive (see HOUND_TUNING.stab): 0 -> -1 over a long cock, -1 -> +1 in a snap, held, then
 *  back to 0. Exactly 0 at phase 0 and 1. */
function stabDrive(phase: number): number {
  if (!(phase > 0) || phase >= 1) return 0;
  const S = HOUND_TUNING.stab;
  if (phase < S.cocked) return -smooth(phase / S.cocked);
  if (phase < S.struck) return -1 + 2 * Math.sqrt((phase - S.cocked) / (S.struck - S.cocked));
  if (phase < S.hold) return 1;
  return 1 - smooth((phase - S.hold) / (1 - S.hold));
}

function houndPoseRaw(phase: number, variant: HoundVariant, side: 'L' | 'R'): AttackPose {
  const d = variant === 'stab' ? stabDrive(phase) : attackDrive(phase, ATTACK_TUNING);
  const reach = { pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 };
  if (d === 0) return { offsets: {}, rootOffset: Z, reach };
  const w = Math.max(0, -d); // wind-up weight
  const s = Math.max(0, d); // strike weight
  if (variant === 'stab') {
    const S = HOUND_TUNING.stab;
    // +x is the body's right (attack.ts axes): the striking leg's own side. The body leans AWAY from it.
    const sg = side === 'R' ? 1 : -1;
    const mix = (a: readonly number[], b: readonly number[]): Vec3 => [sg * (w * a[0]! + s * b[0]!), w * a[1]! + s * b[1]!, w * a[2]! + s * b[2]!];
    const body: Vec3 = [-sg * w * S.rearLean, w * S.rearRise - s * S.lungeDrop, s * S.lunge - w * S.rearBack];
    const front: Vec3 = [body[0], w * S.chestRise - s * S.lungeDrop, s * S.chestLunge - w * S.rearBack];
    const strike = side === 'L' ? 'L' : 'R';
    return {
      offsets: {
        hips: body, chest: front, spineA: body, spineB: front, neck: front, head: front,
        [`elbow${strike}`]: mix(S.cockElbow, S.strikeElbow),
        [`hand${strike}`]: mix(S.cockPaw, S.strikePaw),
        // The TIP gets its own offset: follow() in motion.ts carries a tip only by its parent's IK delta, never by
        // an attack offset, so without this the spike dangled under a raised paw (the first pass).
        [`handTip${strike}`]: mix(S.cockTip, S.strikeTip),
      },
      rootOffset: body,
      reach,
    };
  }
  if (variant === 'squirt') {
    const Q = HOUND_TUNING.squirt;
    const c = squatEnvelope(phase);
    const haunch: Vec3 = [0, -c * Q.haunch, -c * Q.haunchBack];
    const head: Vec3 = [c * Q.headAside, c * Q.headUp, -c * Q.headBack];
    return {
      offsets: {
        hips: haunch, hipL: haunch, hipR: haunch, spineA: [0, -c * Q.haunch * 0.5, 0],
        chest: [0, c * Q.withersUp, s * Q.jolt * 0.5], spineB: [0, c * Q.withersUp, 0],
        neck: [head[0] * 0.5, head[1] * 0.6, head[2]], head,
        // the sac hangs from the dropped hips: it goes down with them, then swings
        hem: [0, -c * Q.haunch + w * Q.lift + s * Q.fwdLift, s * Q.fwd - w * Q.back],
      },
      rootOffset: [0, -c * Q.haunch, -c * Q.haunchBack + s * Q.jolt],
      reach,
    };
  }
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

/** True while front paw `paw` is off the floor: both in a pounce, the striking leg's only in the gibbet's stab. */
export function pounceAirborne(phase: number, variant: SwingVariant, side: 'L' | 'R' = 'R', paw: 'L' | 'R' = side): boolean {
  if (variant === 'stab') { const A = HOUND_TUNING.stabAirborne; return paw === side && phase > A.from && phase < A.to; }
  const A = HOUND_TUNING.airborne;
  return variant === 'pounce' && phase > A.from && phase < A.to;
}

/** The squirt's glob leaves this frame (prevPhase -> phase crosses HOUND_TUNING.squirt.fireAt). */
export function squirtFires(prevPhase: number, phase: number): boolean {
  const at = HOUND_TUNING.squirt.fireAt;
  return prevPhase < at && phase >= at;
}

/** The GIBBET's mind tuning: the ring brain stabbing inside its legs' reach (no pounce: the squirt is its answer to
 *  range, enemy-mind.ts makeGibbetMind), and the squirt's own band and cadence. */
export const GIBBET_TUNING = {
  brain: {
    ...BRAIN_TUNING,
    // The spike tips reach ~1.9 m ahead of the pelvis at the thrust.
    meleeRadius: 1.7,
    outerRadius: 2.4,
    engageRange: 4.0,
    releaseRange: 5.0,
    pickVariant: () => 'stab',
    swingSec: 1.0,
    swingSecFor: { stab: 1.0 },
    cooldownSec: 1.2,
  } satisfies BrainTuning as BrainTuning,
  /** It squirts at a player between these distances (m) it can see, every cooldown seconds, the first after `first`. */
  squirtBand: { min: 3.0, max: 11 },
  squirtSec: 1.15,
  squirtCooldown: 3.2,
  squirtFirst: 1.2,
} as const;

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** The squirt's HELD squat: in over the first fifth, out over the last quarter, exactly 0 at phase 0 and 1. */
function squatEnvelope(phase: number): number {
  if (!(phase > 0) || phase >= 1) return 0;
  return smooth(phase / 0.2) * (1 - smooth((phase - 0.75) / 0.25));
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

/** Root advance (m) this frame for the gibbet's stab: it steps into the strike, the travel spread over the snap,
 *  never closer to the player than stab.stopShort. */
export function stabAdvance(prevPhase: number, phase: number, dist: number): number {
  const S = HOUND_TUNING.stab;
  const w = (p: number) => smooth((p - S.cocked) / (S.struck - S.cocked));
  const step = S.advance * (w(phase) - w(prevPhase));
  return Math.max(0, Math.min(step, Math.max(0, dist - S.stopShort)));
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
