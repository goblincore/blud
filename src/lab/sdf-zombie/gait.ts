// src/lab/sdf-zombie/gait.ts
//
// Procedural shamble — phase-clocked oscillators producing rest-pose TARGET
// offsets for the verlet rig (rig.ts), plus a root translation/bob.
//
// The rig stays the single motion authority: stepRig pulls points toward the
// rest pose every step, so "heavy damping comes free" — this module only
// nudges where the targets are, and the rig integrates toward them. Every
// value here is a PURE function of (GaitState, GaitSkew, dt): no Date.now,
// no Math.random. The clock is state.time, the per-body asymmetry is
// state.seed, so identical inputs produce bit-identical poses (determinism is
// load-bearing — the gait feeds the same solver every frame).
//
// Axes: +x = the body's right, +y = up, +z = the body's forward (the zombie
// is authored facing +z — see body.ts). Offsets are body-local; the wiring
// rotates them into world space by the wander heading (see rotateYaw).
//
// Claymation bias: low stride frequency, a longer stance than swing, and
// seeded per-side asymmetry so left and right steps never mirror exactly —
// it reads hand-posed rather than sinusoidal.
import type { Vec3 } from './types';
import type { BuildResult } from './build-body';
import { add, len, sub } from './vec';
import { blendCurves, sampleCurve, sampleStance, type GaitCurves } from './gait-curves';
import { SOLDIER_WALK } from './gait-curves/soldier-walk';
import { SOLDIER_RUN } from './gait-curves/soldier-run';

const TAU = Math.PI * 2;
const Z: Vec3 = [0, 0, 0];

/** The three authored arm styles — see GAIT_TUNING.armStyle. */
export type ArmStyle = 'swing' | 'reach' | 'carry';

// ---------------------------------------------------------------------------
// Joint schema — one name per rig point.
// ---------------------------------------------------------------------------

/** One name per rig point. The first 17 are the PRIMARY joints (the zombie's
 *  authored bones). The rest are SECONDARY: extra rig points that richer
 *  skeletons have (a two- or three-bone spine, clavicles that start off the
 *  spine, hand and foot bones with free tips). A secondary joint carries a
 *  derived offset (rigid with its parent) — nothing in the gait is authored
 *  against it, so a body without one loses nothing. */
export type GaitJointName =
  | 'pelvis' | 'hips' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'handL' | 'handR'
  | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'footL' | 'footR'
  | 'spineA' | 'spineB' | 'clavicleL' | 'clavicleR'
  | 'handTipL' | 'handTipR' | 'toeL' | 'toeR'
  // A CLOTH PENDULUM: the free end of a `hem` bone hanging off the pelvis.
  // No gait offset ever names it, so its target just rides the body's
  // translation and yaw while the Verlet rig swings it on its constraint —
  // which is exactly the lag a robe's skirt should have (cultist, 2026-09-23).
  | 'hem';

/** Every joint, primary first — the ORDER is the naming priority when two
 *  bone ends share a position (jointNamesForBody). */
export const GAIT_JOINTS: readonly GaitJointName[] = [
  'pelvis', 'hips', 'chest', 'neck', 'head',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
  'spineA', 'spineB', 'clavicleL', 'clavicleR', 'handTipL', 'handTipR', 'toeL', 'toeR',
  'hem',
];

/** A GAIT PROFILE — every knob of one way of walking. The zombie's numbers
 *  are `SHAMBLE` (=== GAIT_TUNING, the historical name, kept for every
 *  caller and test that reads it). Other characters get their own. */
/** All gait frequencies and amplitudes in one place — the "motion DNA".
 *  Frequencies are per-stride ratios of the master stride clock so sway/bob
 *  never beat against the steps. */
export const GAIT_TUNING = {
  /** Profile name, for readouts. */
  name: 'shamble',
  /** Stride cycles per second — the master clock. Low on purpose (shamble). */
  strideFreq: 1.05,
  /** Hip-sway cycles per stride (0.5 = one sway per stride cycle). */
  swayPerStride: 0.5,
  /** Root-bob beats per stride (2 = one dip per footfall). */
  bobPerStride: 2,
  /** Fraction of a stride spent with the foot on the ground. */
  stanceDuty: 0.62,
  /** Max foot forward reach during swing (m). */
  strideLen: 0.32,
  /** Max foot lift during swing (m). */
  footLift: 0.16,
  /** Foot push-back while planted (m) — the shamble drag. */
  footPush: 0.10,
  /** Knee forward bow during swing (m) — the knee's offset OFF the
   *  hip→ankle line, always toward +z (forward): knees never bend backward
   *  (the "cow standing up" look, owner playtest). */
  kneeBend: 0.09,
  /** Fraction of the foot's forward swing the knee tracks. At full reach
   *  the leg is near-straight, so the knee must ride most of the way to the
   *  foot for the bow (kneeBend) to land on the FORWARD side of the
   *  hip→ankle line — a fixed offset sits BEHIND the line once the foot is
   *  out front (motion-polish task 5). */
  kneeTrack: 0.5,
  /** Knee lift during swing (m). */
  kneeLift: 0.02,
  /** Lateral hip sway amplitude (m). */
  swayAmp: 0.05,
  /** Shoulder counter-rotation as a fraction of hip sway. */
  shoulderSway: 0.55,
  /** Root bob amplitude (m). */
  bobAmp: 0.035,
  /** Forward rock at each footfall (m). */
  rockAmp: 0.02,
  /** Arm swing amplitude (m) — hands opposite the ipsilateral leg. */
  armSwing: 0.09,
  /** Elbow flex during the arm swing (m). */
  elbowFlex: 0.04,
  /** The authored arm style — the wiring may override per body. 'swing' is
   *  the natural counter-swing; 'reach' is the classic zombie mummy-arms
   *  (both arms raised toward the heading, slight bob/sway). Default reach:
   *  it is a zombie. */
  armStyle: 'reach' as ArmStyle,
  /** Forward pitch of the whole upper body about the hips (degrees). The
   *  motion layer rotates every joint above the hips by this — a rotation
   *  of targets, never a displacement (the reach-pose lesson). */
  torsoLean: 0,
  /** Reach style: shoulder pivot pitch (rad) — 0 is the authored hang,
   *  π/2 is straight at the horizon. The reach pose is a ROTATION about the
   *  shoulder anchor, never an additive displacement (see GaitPose.reach):
   *  displacing the elbow/hand rest targets shortens both arm segments, the
   *  verlet length constraints win against the soft rest pull, and the
   *  shoulder ball gets dragged out of the torso (owner playtest). ~1.42 rad
   *  reproduces the old pose's hand placement with the chain rigid. */
  reachPitch: 1.42,
  /** Reach style: forearm droop relative to the upper arm (rad) — the arm
   *  reads as a shallow ramp toward the prey, not a locked straight bar. */
  reachElbowDrop: 0.22,
  /** Reach style: shoulder lift (m) — the whole arm rides up a touch. */
  reachShoulderUp: 0.03,
  /** Reach style: vertical bob riding the footfall beat (m). */
  reachBobAmp: 0.035,
  /** Reach style: lateral sway riding the hip-sway beat (m). */
  reachSwayAmp: 0.025,
  /** Head counter-bob as a fraction of the root bob. */
  headBob: 0.5,
  /** Seeded per-side asymmetry magnitude — the claymation "hand-posed" jitter. */
  asymJitter: 0.18,
  /** Missing-arm shoulder droop (m). */
  missingArmDrop: 0.07,
  /** Surviving-arm swing boost when the other arm is missing. */
  missingArmSwingBoost: 1.35,
  /** Wounded-arm swing scale (m). */
  woundedArmSwingScale: 0.6,
  /** Wounded-leg swing scale (foot lifts/reaches less). */
  woundedSwingScale: 0.5,
  /** How much a wounded leg's stance shortens (fraction of the stride). */
  woundedStanceShorten: 0.06,
  /** Wounded-side hip drop (m) — the limping lean. */
  woundedHipDrop: 0.03,
  /** Hop state: stride-frequency multiplier. */
  hopFreqScale: 1.5,
  /** Hop state: root-bob amplitude multiplier. */
  hopBobScale: 1.7,
  /** Hop state: surviving-leg swing multiplier. */
  hopSwingScale: 1.25,
  /** Hop state: lateral sway shrink (hopping stays narrow). */
  hopSwayScale: 0.6,
  /** Hop state: both arms raise this much (m). */
  hopArmsUp: 0.06,
  /** Hop state: lean toward the missing leg (m). */
  hopLean: 0.025,
  /** Damage: root bob shrinks by up to this fraction. */
  damageBobScale: 0.55,
  /** Damage: lateral sway grows by up to this fraction. */
  damageSwayBoost: 0.8,
  /** Damage: foot lift shrinks by up to this fraction — feet drag. */
  damageLiftScale: 0.6,
  /** Damage: forward-back lurch amplitude (m). */
  damageLurchAmp: 0.06,
  /** Damage: lurch wobble frequency (Hz). */
  damageLurchFreq: 0.7,
} as const;

/** The body's REST leg segment vectors, body-local — what curve mode needs
 *  to turn clip angles back into positions with THIS body's lengths. */
export interface GaitLimbs {
  L: { thigh: Vec3; shin: Vec3 };
  R: { thigh: Vec3; shin: Vec3 };
}

export type GaitProfile = {
  -readonly [K in keyof typeof GAIT_TUNING]: (typeof GAIT_TUNING)[K] extends number ? number
    : (typeof GAIT_TUNING)[K] extends string ? string : (typeof GAIT_TUNING)[K];
} & { armStyle: ArmStyle; curves?: GaitCurves };

export const SHAMBLE: GaitProfile = GAIT_TUNING as unknown as GaitProfile;

// CURVE MODE: MARCH and RUN carry a sampled reference clip (curves), and
// when the caller passes the body's rest leg vectors the knee/foot offsets
// and hip bob are rebuilt from those curves — strideLen, footLift, kneeBend,
// kneeLift, kneeTrack, footPush, stanceDuty and bobAmp are then UNUSED for
// the legs and root (they only remain as the no-limbs fallback).

/** An upright patrol walk: gun carried low, short quiet steps. */
export const MARCH: GaitProfile = {
  ...SHAMBLE,
  name: 'march',
  strideFreq: SOLDIER_WALK.freq,
  curves: SOLDIER_WALK,
  // 0.34, not the 0.45 first shipped: on 0.84 m legs a 0.45 reach nearly
  // straightens the swing leg (same lesson as RUN's strideLen).
  strideLen: 0.34,
  footLift: 0.10,
  footPush: 0.06,
  stanceDuty: 0.58,
  bobAmp: 0.02,
  rockAmp: 0.01,
  swayAmp: 0.03,
  shoulderSway: 0.35,
  armSwing: 0.06,
  asymJitter: 0.08,
  armStyle: 'carry',
  torsoLean: 0,
};

/** A run: long stride, real foot lift, a flight phase in the bob, a lean. */
export const RUN: GaitProfile = {
  ...SHAMBLE,
  name: 'run',
  strideFreq: SOLDIER_RUN.freq,
  curves: SOLDIER_RUN,
  // The first cut ran 0.75 m strides on 0.84 m legs, so the swing leg had to
  // STRAIGHTEN to reach and the run read as stiff-legged stretching (owner,
  // 2026-09-05: "he doesn't bend his knees"). A runner's reach is well under
  // half the leg; the speed reads from cadence and the lean, not the reach.
  strideLen: 0.42,
  // Knees high and well FORWARD of the hip->ankle line: the bow is what the
  // verlet folds the leg around, so it has to be big enough to be seen.
  footLift: 0.28,
  footPush: 0.10,
  stanceDuty: 0.45,
  kneeBend: 0.26,
  kneeLift: 0.14,
  kneeTrack: 0.35,
  bobAmp: 0.04,
  rockAmp: 0.02,
  swayAmp: 0.03,
  shoulderSway: 0.5,
  armSwing: 0.10,
  asymJitter: 0.06,
  armStyle: 'carry',
  torsoLean: 12,
};

/** The ogre's heavy stomp: a 2.2 m brute carrying a chainsaw. PROCEDURAL
 *  (no clip curves) — the shamble's machinery re-tuned for weight rather than
 *  decay. Slower cadence and longer stance than the shamble (each step is a
 *  commitment), a high knee and a clear lift-and-plant, a deep footfall bob and a wide side-to-side roll — the weight
 *  swinging over each planted leg is what reads as HEAVY. Arms are 'carry':
 *  the saw's carry pose owns them, so armSwing only rides the shoulders. */
export const STOMP: GaitProfile = {
  ...SHAMBLE,
  name: 'stomp',
  // 0.80, not the shamble's 1.05: a heavier body's natural cadence is slower,
  // and at 0.8 Hz every footfall lands on its own beat of the bob.
  strideFreq: 0.80,
  stanceDuty: 0.64,
  // 0.42 on 1.0 m legs. 0.30 was the first cut and in a side-on strip the
  // feet never visibly left the hips' footprint (2026-09-22): a heavy walk
  // reads through a CLEAR lift-and-plant, not a shuffle.
  strideLen: 0.42,
  // The knee comes UP and forward before the foot comes down — the stomp.
  // Push-back drag stays small because he is not shuffling.
  footLift: 0.17,
  footPush: 0.05,
  kneeBend: 0.14,
  kneeLift: 0.09,
  // The roll: wider hip sway than the shamble with the shoulders following
  // most of it (0.75) rather than counter-rotating, so the whole mass lurches
  // onto the planted leg.
  swayAmp: 0.075,
  shoulderSway: 0.75,
  // Deep bob and a forward rock at each footfall: the impact.
  bobAmp: 0.055,
  rockAmp: 0.035,
  headBob: 0.35,
  armSwing: 0.04,
  asymJitter: 0.10,
  armStyle: 'carry',
  // The hunch is authored in the .blob's rest pose; the lean adds only a
  // little more commitment toward the heading.
  torsoLean: 6,
};

/** The cultist's GLIDE: the shamble with the legs hidden. Under a floor-length
 *  robe the shamble's stride pushed the knees up to 14 cm outside the skirt
 *  cone (cultist-blob.test.ts measures it) and a thigh broke the cloth in
 *  side-on frames. Short, quick, low steps keep the legs inside the robe, and
 *  a figure that moves without visibly walking is the creepier read anyway.
 *  The upper body (reach arms, sway, bob) is the shamble's, untouched. */
export const GLIDE: GaitProfile = {
  ...SHAMBLE,
  name: 'glide',
  strideFreq: 1.25,
  strideLen: 0.18,
  footLift: 0.06,
  footPush: 0.04,
  kneeBend: 0.05,
  kneeLift: 0,
};

/** GLIDE with the arms on a HELD GUN (the cultist's tommy gun): the carry
 *  table owns the arms, as STOMP does for the ogre's saw. motion.ts takes the
 *  arm style from the GAIT (pickArmStyle), never from MotionProfile.armStyle,
 *  so a gunner needs a carry-style gait. */
export const GLIDE_CARRY: GaitProfile = { ...GLIDE, name: 'glide-carry', armStyle: 'carry', armSwing: 0.03 };

/** Lerp every numeric knob; strings (name, armStyle) snap at w = 0.5 so the
 *  hands never hover between two grips. */
export function blendProfiles(a: GaitProfile, b: GaitProfile, w: number): GaitProfile {
  const t = w < 0 ? 0 : w > 1 ? 1 : w;
  if (t === 0) return a;
  if (t === 1) return b;
  const out = { ...(t < 0.5 ? a : b) } as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof GaitProfile)[]) {
    const av = a[k], bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') out[k] = av + (bv - av) * t;
  }
  if (a.curves && b.curves) out.curves = blendCurves(a.curves, b.curves, t);
  else out.curves = (t < 0.5 ? a : b).curves;
  return out as GaitProfile;
}

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/** The gait clock. time advances by dt each step; seed is immutable per body
 *  and drives the deterministic per-side asymmetry. */
export interface GaitState {
  /** Accumulated gait time (s); the motion layer scales dt with travel. */
  time: number;
  /** Integrated stride cycles for variable-speed profiles; absent on legacy shamble. */
  cycles?: number;
  /** Per-body asymmetry seed — any integer; never changes. */
  seed: number;
}

/** Limb health inputs. Absent/false = intact. */
export interface GaitSkew {
  /** Accumulated damage 0..1 — high ⇒ heavier stumble (GAIT_TUNING.damage*). */
  damageMeter: number;
  /** Severed limbs. Exactly one missing leg switches the gait to hop-limp. */
  missing: {
    armL?: boolean;
    armR?: boolean;
    legL?: boolean;
    legR?: boolean;
  };
  /** Wounded (present but hurt) limbs — limp/droop on that side. */
  wounded: {
    armL?: boolean;
    armR?: boolean;
    legL?: boolean;
    legR?: boolean;
  };
}

/**
 * The reach style's per-frame arm pose — a ROTATION SPEC, not offsets.
 * gait.ts owns the animation (pitch/droop/bob/sway as pure clock functions);
 * the wiring (motion.ts) owns the actual pivot, because only it knows the
 * rest arm geometry: each arm rotates about its shoulder rig point by
 * `pitch`, so both segments keep their exact rest lengths and the shoulder
 * ball stays socketed in the torso silhouette — only the distal chain
 * travels. While this is present, the elbow and hand offset entries are ZERO.
 */
export interface ReachPose {
  /** Shoulder pivot pitch per side (rad): 0 = the authored hang,
   *  GAIT_TUNING.reachPitch = full mummy reach, wounded/asymmetry-scaled. */
  pitchL: number;
  pitchR: number;
  /** Forearm droop relative to the upper arm (rad). */
  drop: number;
  /** Rigid bob/sway translation riding the stride beat — applied to the
   *  WHOLE arm (shoulder-relative), so it never changes a segment length. */
  shift: Vec3;
}

/** One frame of gait output — rest-pose TARGET offsets, body-local. */
export interface GaitPose {
  /** Offset for the root (pelvis) rig point — translation, bob, rock, lurch. */
  rootOffset: Vec3;
  /** Offset per joint. Every joint except pelvis is present; zero = no offset.
   *  In 'reach' style the elbow/hand entries are zero — the reach pivot
   *  spec drives them instead. */
  offsets: Record<Exclude<GaitJointName, 'pelvis'>, Vec3>;
  /** The reach-style arm pivot spec — present only when armStyle === 'reach'. */
  reach?: ReachPose;
  /** Upper-body forward lean (rad), from the profile's torsoLean. */
  lean: number;
  /** Normalised stride phase in [0, 1) — 0 = left-foot stance start. */
  phase: number;
  /** Which feet are currently planted. */
  stance: { legL: boolean; legR: boolean };
  /** True while in one-leg hop-limp (exactly one leg missing). */
  hop: boolean;
}

/** stepGait result — new state plus the pose to apply to the rig. */
export interface GaitStep {
  state: GaitState;
  pose: GaitPose;
}

// ---------------------------------------------------------------------------
// Deterministic primitives.
// ---------------------------------------------------------------------------

/** A fresh gait clock at t=0 with the given asymmetry seed. */
export function makeGaitState(seed: number): GaitState {
  return { time: 0, seed: seed >>> 0 };
}

/** Deterministic 32-bit string hash → [0, 1). */
function hash01(seed: number, key: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

/** Seeded per-side/per-joint asymmetry in [-1, 1]. */
function asym(seed: number, key: string): number {
  return hash01(seed, key) * 2 - 1;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Splits a leg phase (radians) into stance/swing with progress 0..1 each. */
function stanceProgress(phi: number, duty: number): { stance: boolean; u: number; v: number } {
  let p = (phi % TAU) / TAU;
  if (p < 0) p += 1;
  if (p < duty) return { stance: true, u: 0, v: p / duty };
  const swing = 1 - duty;
  return { stance: false, u: swing <= 0 ? 0 : (p - duty) / swing, v: 0 };
}

// ---------------------------------------------------------------------------
// The gait.
// ---------------------------------------------------------------------------

/**
 * One gait step: advances the clock by dt and produces the rest-pose target
 * pose for that instant. Pure and deterministic — same (state, skew, dt)
 * always yields the same pose.
 *
 * Wiring (task 4): add pose.rootOffset to the pelvis rig point's rest target
 * and pose.offsets[joint] to every other point's, rotated into world space by
 * the body yaw via rotateYaw. The rig integrates toward the targets,
 * so no further smoothing is needed here.
 *
 * `armStyle` selects the arm animation (GAIT_TUNING.armStyle is the default):
 * 'swing' counter-swings the arms against the legs; 'reach' holds both arms
 * raised toward the heading with a slow bob/sway riding the stride clock.
 * The severed/wounded skews apply to both styles — a missing arm gets no
 * offsets either way, a wounded arm swings less or droops in its raise.
 */
export function stepGait(
  state: GaitState, skew: GaitSkew, dt: number,
  armStyle: ArmStyle = GAIT_TUNING.armStyle,
  profile: GaitProfile = SHAMBLE,
  limbs?: GaitLimbs,
): GaitStep {
  const time = state.time + Math.max(dt, 0);
  const s = state.seed;
  const T = profile;

  const missingL = !!skew.missing.legL;
  const missingR = !!skew.missing.legR;
  const woundedL = !!skew.wounded.legL;
  const woundedR = !!skew.wounded.legR;
  const missingArmL = !!skew.missing.armL;
  const missingArmR = !!skew.missing.armR;
  const woundedArmL = !!skew.wounded.armL;
  const woundedArmR = !!skew.wounded.armR;
  // Exactly one leg missing ⇒ hop-limp. Both or neither ⇒ regular gait.
  const hop = missingL !== missingR;
  const damage = clamp01(skew.damageMeter);
  const curves = !hop && limbs ? T.curves : undefined;

  // Master clock. Legs alternate π apart; sway/bob/rock derive from the same
  // phase so they never beat against the steps.
  const freq = T.strideFreq * (hop ? T.hopFreqScale : 1);
  // Recomputing time × frequency retimes the entire past when speed changes.
  // Keep the shamble's original arithmetic for its exact-pose contract.
  const cycles = profile === SHAMBLE ? undefined : (state.cycles ?? state.time * freq) + Math.max(dt, 0) * freq;
  const phiL = cycles === undefined ? time * freq * TAU : cycles * TAU;
  const phiR = phiL + Math.PI;

  // Per-side seeded asymmetry — no two bodies or sides swing identically.
  const aL = 1 + T.asymJitter * asym(s, 'legL');
  const aR = 1 + T.asymJitter * asym(s, 'legR');

  // Root: lateral sway, vertical bob (dips at footfalls), forward rock, and
  // the damage lurch. In hop state the bob beats once per surviving-leg
  // footfall, sways less, and leans toward the missing leg.
  const swayPhase = phiL * T.swayPerStride;
  const swayAmp =
    T.swayAmp *
    (1 + damage * T.damageSwayBoost) *
    (1 + T.asymJitter * asym(s, 'sway')) *
    (hop ? T.hopSwayScale : 1);
  const bobAmp = T.bobAmp * (1 - damage * T.damageBobScale) * (1 + T.asymJitter * asym(s, 'bob'));
  const survivor = missingL ? phiR : phiL;
  const bobCurve = hop ? (1 + Math.cos(survivor)) / 2 : (1 + Math.cos(T.bobPerStride * phiL)) / 2;
  const sway = swayAmp * Math.sin(swayPhase);
  const legLen = limbs ? len(limbs.L.thigh) + len(limbs.L.shin) : 0;
  const bob = curves
    ? sampleCurve(curves.hipsY, ((phiL % TAU) + TAU) % TAU / TAU) * legLen * (1 - damage * T.damageBobScale)
    : -bobAmp * (hop ? T.hopBobScale : 1) * bobCurve;
  const rock = T.rockAmp * bobCurve;
  const lurch =
    damage * T.damageLurchAmp * Math.sin(time * T.damageLurchFreq * TAU + asym(s, 'lurch') * Math.PI);
  const hopLean = hop ? (missingL ? -T.hopLean : T.hopLean) : 0;
  const rootOffset: Vec3 = [sway + hopLean, bob, rock + lurch];

  // Per-side stance duty — a wounded leg bears weight for less of the cycle
  // (the healthy side carries the extra). Both wounded ⇒ symmetric again.
  const duty = (side: 'L' | 'R'): number => {
    const w = side === 'L' ? woundedL : woundedR;
    const other = side === 'L' ? woundedR : woundedL;
    if (w && !other) return T.stanceDuty - T.woundedStanceShorten;
    if (!w && other) return T.stanceDuty + T.woundedStanceShorten;
    return T.stanceDuty;
  };
  const isSurvivor = (side: 'L' | 'R'): boolean => (missingL ? side === 'R' : side === 'L');

  // One leg: swing lifts and reaches forward, stance drags back. Missing leg
  // ⇒ no offsets at all (the flesh is gone; the collapsed state owns the body).
  const leg = (phi: number, side: 'L' | 'R'): { foot: Vec3; knee: Vec3; stance: boolean } => {
    const missing = side === 'L' ? missingL : missingR;
    if (missing) return { foot: Z, knee: Z, stance: false };
    const wounded = side === 'L' ? woundedL : woundedR;
    if (curves) {
      const c = side === 'L' ? curves.L : curves.R;
      const rest = side === 'L' ? limbs!.L : limbs!.R;
      const p = ((phiL % TAU) + TAU) % TAU / TAU; // the LEFT clock; the R curves are already half a cycle off
      const scaleA = (side === 'L' ? aL : aR) * (wounded ? T.woundedSwingScale : 1);
      const thigh = sampleCurve(c.thigh, p) * scaleA;
      const flex = Math.max(0, sampleCurve(c.knee, p) * scaleA);
      // Pitch the REST segment about x (the sagittal plane): x keeps the
      // body's lateral tilt, and the segment length is preserved exactly —
      // the plan's `[x, -L*cos, L*sin]` form overshoots by x²/L (~0.26 mm
      // here), which the length-preservation test rejects at 1e-6.
      const pitch = (v: Vec3, a: number): Vec3 => [
        v[0],
        v[1] * Math.cos(a) + v[2] * Math.sin(a),
        v[2] * Math.cos(a) - v[1] * Math.sin(a),
      ];
      const knee = pitch(rest.thigh, thigh);
      const shin = pitch(rest.shin, thigh - flex);
      const ankle = add(knee, shin);
      const restAnkle = add(rest.thigh, rest.shin);
      return {
        foot: sub(ankle, restAnkle),
        knee: sub(knee, rest.thigh),
        stance: sampleStance(c.stance, p),
      };
    }
    const sideScale =
      (side === 'L' ? aL : aR) *
      (wounded ? T.woundedSwingScale : 1) *
      (hop && isSurvivor(side) ? T.hopSwingScale : 1);
    const { stance: onGround, u, v } = stanceProgress(phi, duty(side));
    const swing = Math.sin(Math.PI * u);
    if (!onGround) {
      const lift = T.footLift * sideScale * (1 - damage * T.damageLiftScale);
      const reach = T.strideLen * sideScale * swing;
      return {
        foot: [0, lift * swing, reach],
        // The knee tracks half the foot's reach PLUS a forward bow, so it
        // stays on the +z (forward) side of the hip→ankle line through the
        // whole swing — a human hinge, never a backward cow knee.
        knee: [0, T.kneeLift * swing, T.kneeTrack * reach + T.kneeBend * sideScale * swing],
        stance: false,
      };
    }
    return { foot: [0, 0, -T.footPush * sideScale * Math.sin(Math.PI * v)], knee: Z, stance: true };
  };

  // One arm. 'swing': the hand swings opposite the ipsilateral leg.
  // 'reach': NO offsets here — the pivot spec (below) drives the arm, so the
  // chain rotates rigidly about the shoulder instead of dragging it out of
  // the torso. Missing arm ⇒ no offsets either way (the shoulder droop below
  // carries the visual); a wounded arm swings less or reaches less high.
  const arm = (legPhi: number, side: 'L' | 'R'): { elbow: Vec3; hand: Vec3 } => {
    const missing = side === 'L' ? missingArmL : missingArmR;
    if (missing) return { elbow: Z, hand: Z };
    const wounded = side === 'L' ? woundedArmL : woundedArmR;
    const aSide = side === 'L' ? aL : aR;
    if (armStyle !== 'swing') return { elbow: Z, hand: Z };
    const boost = (side === 'L' ? missingArmR : missingArmL) ? T.missingArmSwingBoost : 1;
    const sideScale = aSide * boost * (wounded ? T.woundedArmSwingScale : 1);
    const swing = Math.sin(Math.PI * stanceProgress(legPhi, duty(side)).u);
    return {
      elbow: [0, T.elbowFlex * 0.4 * sideScale * swing, T.elbowFlex * 0.7 * sideScale * swing],
      hand: [0, 0, -T.armSwing * sideScale * swing],
    };
  };

  const hip = (side: 'L' | 'R'): Vec3 => {
    const missing = side === 'L' ? missingL : missingR;
    const wounded = side === 'L' ? woundedL : woundedR;
    if (missing) return Z;
    return [0.5 * sway * (side === 'L' ? aL : aR), wounded ? -T.woundedHipDrop : 0, 0];
  };

  const shoulder = (side: 'L' | 'R'): Vec3 => {
    const missing = side === 'L' ? missingArmL : missingArmR;
    const droop = missing ? -T.missingArmDrop : 0;
    const armsUp = hop && !missing ? T.hopArmsUp : 0;
    const reachLift = armStyle === 'reach' && !missing ? T.reachShoulderUp : 0;
    return [-sway * T.shoulderSway * (side === 'L' ? aL : aR), droop + armsUp + reachLift, 0];
  };

  // The reach pivot spec: pitch per side (wounded arms reach less, missing
  // arms not at all), a shared forearm droop, and the bob/sway beat as ONE
  // rigid shift for the whole arm.
  let reach: ReachPose | undefined;
  if (armStyle === 'reach') {
    const raiseL = missingArmL ? 0 : (woundedArmL ? T.woundedArmSwingScale : 1) * aL;
    const raiseR = missingArmR ? 0 : (woundedArmR ? T.woundedArmSwingScale : 1) * aR;
    reach = {
      pitchL: T.reachPitch * raiseL,
      pitchR: T.reachPitch * raiseR,
      drop: T.reachElbowDrop,
      shift: [T.reachSwayAmp * Math.sin(swayPhase), -T.reachBobAmp * bobCurve, 0],
    };
  }

  const legA = leg(phiL, 'L');
  const legB = leg(phiR, 'R');
  const armA = arm(phiL, 'L');
  const armB = arm(phiR, 'R');

  const offsets: Record<Exclude<GaitJointName, 'pelvis'>, Vec3> = {
    hips: [sway * 0.9, bob * 0.9, 0],
    chest: [sway * 0.6, bob * 0.6, 0],
    neck: [sway * 0.3, bob * 0.4, 0],
    // The head counter-bobs: it rises as the root dips.
    head: [-sway * 0.2, -bob * T.headBob, 0],
    shoulderL: shoulder('L'),
    shoulderR: shoulder('R'),
    elbowL: armA.elbow,
    elbowR: armB.elbow,
    handL: armA.hand,
    handR: armB.hand,
    hipL: hip('L'),
    hipR: hip('R'),
    kneeL: legA.knee,
    kneeR: legB.knee,
    footL: legA.foot,
    footR: legB.foot,
    // Secondary joints — rigid with their parents. Nothing is authored
    // against them; they exist so richer skeletons have a target per point.
    spineA: [sway * 0.75, bob * 0.75, 0],
    spineB: [sway * 0.65, bob * 0.65, 0],
    clavicleL: [sway * 0.6, bob * 0.6, 0],
    clavicleR: [sway * 0.6, bob * 0.6, 0],
    handTipL: armA.hand,
    handTipR: armB.hand,
    toeL: legA.foot,
    toeR: legB.foot,
    // The cloth pendulum bobs with the hips but NEVER sways: the hips swing
    // side to side over a hem that stays put, and the Verlet constraint
    // between them tilts the skirt — the hem lagging the waist, as cloth does.
    hem: [0, bob * 0.9, 0],
  };

  let p = (phiL % TAU) / TAU;
  if (p < 0) p += 1;
  return {
    state: cycles === undefined ? { time, seed: s } : { time, seed: s, cycles },
    pose: {
      rootOffset,
      offsets,
      reach,
      lean: T.torsoLean * Math.PI / 180,
      phase: p,
      stance: { legL: legA.stance, legR: legB.stance },
      hop,
    },
  };
}

// ---------------------------------------------------------------------------
// Body ↔ joint mapping (the wiring contract).
// ---------------------------------------------------------------------------

// Bone-name → joint-name table. Mirrored bones (suffix `.l`/`.r`) map to the
// sided names. The zombie's names (spine, upperArm, foreArm) and the newer
// `.blob` names (spine1/chest/spine2, upperarm/forearm/hand, foot) both
// resolve. A bone end absent here is a wiring error (makeMotionJoints nulls).
const JOINT_AT: Record<string, { head: string; tail: string }> = {
  pelvis:   { head: 'pelvis',   tail: 'hips' },
  spine:    { head: 'hips',     tail: 'chest' },
  spine1:   { head: 'hips',     tail: 'spineA' },
  chest:    { head: 'spineA',   tail: 'spineB' },
  spine2:   { head: 'spineB',   tail: 'chest' },
  neck:     { head: 'chest',    tail: 'neck' },
  skull:    { head: 'neck',     tail: 'head' },
  clavicle: { head: 'clavicle', tail: 'shoulder' },
  upperArm: { head: 'shoulder', tail: 'elbow' },
  upperarm: { head: 'shoulder', tail: 'elbow' },
  foreArm:  { head: 'elbow',    tail: 'hand' },
  forearm:  { head: 'elbow',    tail: 'hand' },
  hand:     { head: 'hand',     tail: 'handTip' },
  thigh:    { head: 'hip',      tail: 'knee' },
  shin:     { head: 'knee',     tail: 'foot' },
  foot:     { head: 'foot',     tail: 'toe' },
  // Cloth pendulum off the pelvis (see GaitJointName 'hem').
  hem:      { head: 'hips',     tail: 'hem' },
};

/** The joint names that carry a per-side suffix (centerline joints never do). */
const SIDED: ReadonlySet<string> = new Set([
  'clavicle', 'shoulder', 'elbow', 'hand', 'handTip', 'hip', 'knee', 'foot', 'toe',
]);

/** Joint name for a resolved bone's head/tail, or null for unknown bones.
 *  e.g. jointForBoneEnd('thigh.l', 'tail') === 'kneeL'. */
export function jointForBoneEnd(bone: string, end: 'head' | 'tail'): GaitJointName | null {
  const dot = bone.lastIndexOf('.');
  const base = dot >= 0 ? bone.slice(0, dot) : bone;
  const side = dot >= 0 ? bone.slice(dot + 1) : '';
  const at = JOINT_AT[base]?.[end];
  if (!at) return null;
  if (side && SIDED.has(at)) return (at + side.toUpperCase()) as GaitJointName;
  return at as GaitJointName;
}

/** Same tolerance bindRig dedups rig points with. */
const KEY_EPS = 1e-4;

/** Joint names in rig-point order for a built body — the exact zip key for
 *  the wiring: `pose.offsets[names[i]]` applies to `rig.points[i]`'s target.
 *
 *  Dedup is by POSITION, exactly as bindRig does it: a bone's tail and its
 *  child's head are one rig point and get ONE name. When several bone ends
 *  share a position (the zombie's spine.tail, neck.head, clavicle.l.head and
 *  clavicle.r.head are all `chest`), the name earliest in GAIT_JOINTS wins —
 *  so `chest` beats `spineB` on the goblin, whose chest bone runs straight
 *  into the neck. A name is never used twice; a candidate already taken
 *  falls through to the next, and a point left nameless shows up as a
 *  count mismatch in makeMotionJoints (null), never as a scrambled pose. */
export function jointNamesForBody(body: BuildResult): GaitJointName[] {
  const positions: Vec3[] = [];
  const candidates: GaitJointName[][] = [];
  const indexOf = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++) {
      const q = positions[i]!;
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < KEY_EPS) return i;
    }
    positions.push(p);
    candidates.push([]);
    return positions.length - 1;
  };
  for (const [boneName, bone] of body.bones.entries()) {
    for (const end of ['head', 'tail'] as const) {
      const i = indexOf(bone[end]);
      const name = jointForBoneEnd(boneName, end);
      if (name && !candidates[i]!.includes(name)) candidates[i]!.push(name);
    }
  }
  const rank = (n: GaitJointName) => GAIT_JOINTS.indexOf(n);
  const used = new Set<GaitJointName>();
  const names: GaitJointName[] = [];
  for (const cands of candidates) {
    const pick = cands.slice().sort((a, b) => rank(a) - rank(b)).find(n => !used.has(n));
    if (!pick) continue;
    used.add(pick);
    names.push(pick);
  }
  return names;
}

/** Rotates a body-local offset into world space for a given heading (yaw).
 *  heading 0 = facing +z, matching the body authoring (body.ts) and
 *  wander.ts's headingDir. */
export function rotateYaw(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [v[0] * c + v[2] * sin, v[1], -v[0] * sin + v[2] * c];
}
