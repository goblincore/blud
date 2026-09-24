// src/lab/sdf-zombie/attack.ts
//
// The melee swing pose. Phase 0..1 in, body-local joint offsets out — the
// same contract stagger.ts emits (metres, body-local, ADDED onto gait's
// offsets, missing keys mean zero, rootOffset applies to the pelvis), so
// motion.ts composes it exactly where it composes a stagger.
//
// TWO SWINGS: an elbow-high HOOK and an OVERHEAD chop, one arm at a time.
//
// THE BODY AND THE ARM ARE DRIVEN SEPARATELY, and that split is the point.
// The body still rides `attackDrive`'s signed scalar (0 -> -1 wind-up -> +1
// strike -> 0): its back-then-forward weight shift is right for both variants.
// But every ARM angle used to be `drive x magnitude` too, which FORCES pitch
// negative at the wind-up and positive at the strike -- the arm must travel
// from behind the body to in front of it. A hook needs the arm raised at BOTH
// ends. It cannot be expressed that way, which is why `armArc` interpolates
// between explicit per-variant angles instead (SWING_ARCS).
//
// That single-scalar constraint, plus yaw dominating pitch and an off arm
// counter-swinging in opposition, is what the owner saw: "the current
// animation resembles a swimmer's motion tbh" (2026-09-05). The off arm now
// holds a raised guard rather than mirroring the swing negated.
//
// The caller alternates `side` between swings and rolls `variant` per swing,
// so a stalled pack shows four silhouettes instead of one metronome.
//
// The ACROSS part is a yaw about world up (the reach pivot's second rotation,
// composed in motion.ts) — it is what keeps a horizontal sweep from being the
// whole swing now that pitch carries both variants.
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
  /** The off arm's share of the swinging arm's YAW, opposite in sign. Dropped
   *  from 0.28: two arms moving in opposition through a near-horizontal plane
   *  IS the swimming motion the owner flagged. */
  offArmShare: 0.12,
  /** The off arm's raised guard (rad) — a constant positive pitch scaled by
   *  the swing's envelope, rather than the swinging arm's pitch negated. */
  offGuardPitch: 0.30,
  /** Regression guard for the flat arc: a swing's pitch travel must exceed
   *  this fraction of its yaw travel. Pinned by a test, not read at runtime —
   *  it lives here so the number and the reason sit together. 0.3 sits below
   *  the hook's real travel ratio (0.6 pitch against 1.75 yaw ≈ 0.34) and
   *  above the shipped swing's (0.3 pitch against 1.15 yaw ≈ 0.26); the
   *  plan's 0.6 was arithmetically impossible for the approved hook angles. */
  flatArcRatio: 0.3,
  /** Forward drive of the swinging shoulder at the strike (m); the other
   *  shoulder takes the negative. Two opposite z offsets ARE the torso twist
   *  about the vertical — cheaper and more legible than a real rotation. */
  shoulderDrive: 0.06,
  /** Swinging hand's extra drop on the forward half (m). */
  handDrop: 0.10,
} as const;

export type SwingVariant = 'hook' | 'overhead' | 'shove' | 'cleave' | 'sweep' | 'lunge';

/** Per-variant arm angles (rad). Pitch keeps the reach convention (positive =
 *  forward/raised); yaw is written for the RIGHT arm, where NEGATIVE is cocked
 *  OUT away from the body's centre line and positive is swept ACROSS it — the
 *  left arm negates it, which is what makes the two sides exact mirrors.
 *  THE SIGN IS MEASURED, NOT ASSUMED (2026-09-05): the reach pivot applies
 *  yaw as a world-up rotation, and a POSITIVE rotation about up carries a
 *  forward-pointing arm toward the body's LEFT. The first table here had it
 *  the other way round (windup +0.85 out, strike −0.90 across); in-engine it
 *  photographed as a BACKHAND — fist across the chest at the wind-up, flung
 *  out and up at contact (armR yaw −0.73 → +0.93, live body yaw, settled
 *  pin) — the mirror of the hook the spec describes.
 *
 *  THE HOOK'S PITCH IS POSITIVE AT BOTH ENDS AND RISES INTO THE STRIKE. That
 *  is the whole fix: the shipped swing fell from 0.85 to 0.55 while yaw swept
 *  1.15, an almost horizontal arc the owner read as a swimmer's stroke. A
 *  single signed drive scalar could not express "raised at both ends", which
 *  is why armArc exists.
 *
 *  THE OVERHEAD IS ALMOST PURE PITCH: 2.1 rad of vertical traverse, through
 *  zero and out the other side, with yaw near zero. That is a chop. */
export const SWING_ARCS: Record<SwingVariant, {
  windupPitch: number;
  strikePitch: number;
  windupYaw: number;
  strikeYaw: number;
}> = {
  hook: { windupPitch: 0.35, strikePitch: 0.95, windupYaw: -0.85, strikeYaw: 0.90 },
  overhead: { windupPitch: 1.35, strikePitch: -0.75, windupYaw: -0.15, strikeYaw: 0.10 },
  shove: { windupPitch: 0, strikePitch: 0, windupYaw: 0, strikeYaw: 0 },
  // The REACH-arm fallback only — a carry character's arms are driven by
  // sword-swing.ts's tracks, not these.
  cleave: { windupPitch: 1.35, strikePitch: -0.75, windupYaw: -0.15, strikeYaw: 0.10 },
  sweep: { windupPitch: 0.35, strikePitch: 0.95, windupYaw: -0.85, strikeYaw: 0.90 },
  lunge: { windupPitch: 0.4, strikePitch: 1.3, windupYaw: 0, strikeYaw: 0 },
};

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

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The swinging arm's angles at `phase`, plus a trapezoid envelope.
 *
 * Unlike `attackDrive` this does NOT multiply one magnitude by a signed
 * scalar. It interpolates between the variant's explicit rest, wind-up and
 * strike angles, which is the whole point: an angle can be positive at BOTH
 * ends, so a hook keeps its elbow up instead of swinging from behind the body
 * to in front of it.
 *
 * `active` is a separate trapezoid (0 at rest, 1 across the wind-up peak
 * through the end of the contact hold, 0 again by the end of recovery). The
 * off arm's guard needs it because `attackDrive` CROSSES ZERO between the
 * wind-up and the strike — a guard scaled by |drive| would drop the arm at
 * exactly the moment the swing is fastest.
 *
 * Phases outside [0, 1] return the rest pose, never an extrapolated one.
 */
export function armArc(
  phase: number, variant: SwingVariant, tuning: AttackTuning = ATTACK_TUNING,
): { pitch: number; yaw: number; active: number } {
  const T = tuning;
  const a = SWING_ARCS[variant];
  if (!(phase > 0) || phase >= 1) return { pitch: 0, yaw: 0, active: 0 };
  if (phase < T.windupEnd) {
    const t = smooth(phase / T.windupEnd);
    return { pitch: lerp(0, a.windupPitch, t), yaw: lerp(0, a.windupYaw, t), active: t };
  }
  if (phase < T.strikeEnd) {
    const t = smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd));
    return {
      pitch: lerp(a.windupPitch, a.strikePitch, t),
      yaw: lerp(a.windupYaw, a.strikeYaw, t),
      active: 1,
    };
  }
  if (phase < T.holdEnd) {
    return { pitch: a.strikePitch, yaw: a.strikeYaw, active: 1 };
  }
  const t = smooth((phase - T.holdEnd) / (1 - T.holdEnd));
  return {
    pitch: lerp(a.strikePitch, 0, t),
    yaw: lerp(a.strikeYaw, 0, t),
    active: 1 - t,
  };
}

/**
 * The swing pose at `phase`, thrown by `side`'s arm as `variant`.
 *
 * The BODY (root lunge, wind-back, chest lean, head carry, shoulder twist)
 * still rides `attackDrive`'s signed scalar — the back-then-forward weight
 * shift is right for both variants and is deliberately variant-independent.
 * The ARM rides `armArc`, which is what makes a hook a hook.
 *
 * Sign convention: body-local +x is the body's right, and a positive rotation
 * about world up carries the arm toward +x. SWING_ARCS is written for the
 * right arm; `sgn` negates it for the left, so the two sides are exact
 * mirrors by construction rather than by two hand-written branches.
 */
export function attackPose(
  phase: number,
  side: 'L' | 'R',
  variant: SwingVariant,
  tuning: AttackTuning = ATTACK_TUNING,
): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  const arc = armArc(phase, variant, T);
  if (d === 0 && arc.active === 0) {
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

  const pitchSwing = arc.pitch;
  const yawSwing = sgn * arc.yaw;
  // The off arm HOLDS A GUARD. It does not mirror the swinging arm negated:
  // two arms in opposition through a near-horizontal plane is a front crawl.
  const pitchOff = arc.active * T.offGuardPitch;
  const yawOff = -yawSwing * T.offArmShare;

  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
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
