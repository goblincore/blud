// src/lab/sdf-zombie/motion.ts
//
// The motion ORCHESTRATOR — one pure function per frame that composes the
// four task-1..3 modules (wander, gait, ik, stagger, collapse) into the
// per-rig-point REST-Pose targets the verlet rig (rig.ts) integrates toward.
// The rig stays the single motion authority exactly as before: stepRig pulls
// every point toward its rest target under gravity, and the constraints keep
// the skeleton together. Motion here only moves WHERE the targets are.
//
// Nothing in this module touches THREE, the DOM, or Date.now/Math.random
// (the wander RNG is injected), so the whole pipeline is unit-testable with
// a stub rig — the seam task 4's tests drive.
//
// ONE FRAME, STANDING (spec §1-§4 of the rig-motion design):
//
//   wander ─┬─► root translation (ground-plane shift of every target)
//           └─► heading — the body's APPLIED yaw (state.bodyYaw) follows it
//                          at a damped, gain-scaled rate; the WHOLE authored
//                          pose is rotated about the root's vertical axis by
//                          bodyYaw, and gait/stagger offsets (BODY-LOCAL) are
//                          rotated by the same bodyYaw — so the pose, the
//                          offsets, the aim cone and the stagger's
//                          world→local shot frame all agree mid-turn
//   stagger ─► reaction offsets ADD onto the gait offsets (sibling contract,
//              see stagger.ts's header); the shot direction arrives in WORLD
//              space and is rotated to body-local here
//   gait ────► per-joint offsets, amplitude-blended by the wander SPEED
//              (idle beats and wander-off fade the stride out instead of
//              treadmill-stepping in place); a blast's phaseKnock is baked
//              into gait state.time — the clock is periodic, so a permanent
//              small offset is indistinguishable from a decaying one
//   ik ──────► two rest-target overrides, applied in this order:
//              1. FOOT PLANT — stance feet lock to their captured floor
//                 contact; solvePlantedLeg re-solves knee/foot so the pull
//                 DRAGS the foot toward the plant, not away from it (no
//                 fight between rest-pull and plant, which is why the
//                 overrides live in the TARGETS rather than post-step)
//              2. HEAD AIM — neck+head targets laid out along the damped,
//                 clamped look direction (tracks the wander heading/target)
//
// ONE FRAME, COLLAPSED (spec §5): everything above stops; the rest pose is
// the authored pose shifted by the root position FROZEN at the fall; the
// collapse step supplies restPull (ramp 1→0), the one-sided rope limits, and
// the wiring swaps gravity to full -9.8 and adds floor contact. The settled
// corpse keeps taking wounds/severs/gibs because none of that depends on the
// motion pipeline — it reads the posed prims.
//
import { soldierFallPose } from './soldier-fall';
import { stepSoldierFootwork, type SoldierFootwork } from './soldier-footwork';
import type { BuildResult } from './build-body';
import type { Wound, WoundType } from './damage';
import type { LimbId, Vec3 } from './types';
import { add, len, normalize, qFromAxisAngle, qMul, qRotate, scale, sub } from './vec';
import type { RigPoint } from './rig';
import type { GaitJointName, GaitLimbs, GaitProfile } from './gait';
import { blendProfiles, GAIT_TUNING, jointNamesForBody, rotateYaw, stepGait, type ArmStyle } from './gait';
import { runWeight, ZOMBIE_PROFILE, type MotionProfile } from './motion-profile';
import {
  alignElbow, armPivot, CARRIES, GUN_GRIP, gunPoseFromArm, gunPoint, type CarryName, type CarrySpec, type GunPose,
} from './carry';
import type { WanderBounds, WanderState } from './wander';
import { headingDir, stepWander, wrapPi, type Rng } from './wander';
import type { PlantState, AimState } from './ik';
import {
  IK_TUNING, clampDir, makeAim, makePlant, poleReflect, solveChain, solveHingeLeg, solvePlantedLeg,
  stepAim, stepPlant,
} from './ik';
import type { StaggerKind, StaggerState } from './stagger';
import { makeStaggerState, stepStagger } from './stagger';
import { soldierStaggerDuration, stepSoldierStagger, type SoldierStaggerState } from './soldier-stagger';
import type { SoldierStaggerLevel } from './soldier-stagger';
import type { CollapsePhase, CollapseState, MissingLimbs, RopeLimit } from './collapse';
import {
  COLLAPSE_TUNING, collapseRopes, makeCollapseState, stepCollapse,
} from './collapse';
import { attackPose, type AttackPose, type SwingVariant } from './attack';
import { isSwordVariant, jawGapeAt, swordCarryAt } from './sword-swing';
import { jawRestOf, jawTargetAt, type JawRest } from './jaw';

/** Motion knobs owned by the wiring (the modules own their own). */
export const MOTION_TUNING = {
  /** Gait amplitude blend rate (units/s) — how fast the stride fades with
   *  locomotion speed / the wander toggle. */
  blendRate: 2.5,
  /** The stride reaches full amplitude at this fraction of cruise speed. */
  fullStrideAt: 1,
  /** Body-yaw follow rate (rad/s) — the whole body turns to face the wander
   *  heading at this heavy-damped rate, so turns never snap. */
  headingFollowRate: 1.7,
  /** Heading-follow gain 0..1 — scales the follow rate. 0 = the
   *  "strafe-walker" bestiary variant: the body NEVER turns, facing its
   *  authored direction while moving any direction. A tunable, not a code
   *  path — do not build the variant, just leave the knob. */
  headingFollow: 1,
  /** Gaze-follow gain 0..1 — how much the head look-at target is the
   *  LOOK-AHEAD point along the wander heading (1 = the head looks where the
   *  body walks, leading into turns inside the clamp cone) versus pinned to
   *  the fixed wander target (0 = the owner-flagged "creepy" variant: the
   *  gaze stays locked on a point while the body turns under it — kept
   *  reachable as a tuning, not a code path). Composed with the existing
   *  yaw/pitch clamps either way. */
  gazeFollow: 1,
  /** How far ahead of the root the gaze's look-ahead point sits (m). */
  gazeAhead: 2,
  /** Lean into the turn: metres of lateral upper-body offset per rad/s of
   *  applied yaw rate. */
  turnLean: 0.05,
  /** Lean clamp (m) — a hard turn leans this much and no more. */
  turnLeanMax: 0.06,
  /** Reach-style arms stay this raised at idle (gait blend floor) — a
   *  standing zombie keeps its mummy arms up instead of dropping them. */
  reachMinPresence: 0.85,
  /** Shoulder socket cap (m) — how far a shoulder rig point may sit from its
   *  AUTHORED offset from the chest anchor before the compose pulls it back.
   *  Sway counter-phase, stagger and the attack's shoulder drive all translate
   *  the shoulder against the chest, and the torso silhouette only just
   *  contains the shoulder ball at rest, so the big layers pop the ball out
   *  of the body — in the mesh and in the shadow hull built from the same
   *  points. Measured on the compose: the attack strike drives the off
   *  shoulder ~0.16 from the chest, sway peaks ~0.06. 0.05 keeps the sway
   *  and trims the strike's worst drive. ≤ 0 disables the clamp. */
  shoulderSocket: 0.05,
  /** Localized hit recoil: the rig point nearest the hit is shoved along the
   *  shot direction with this peak offset (m) per profile, attack-decaying
   *  back over ~5×decay seconds. Composes with the whole-body stagger and
   *  the instant impulseAt jolt in the wiring. */
  recoil: {
    pellet: 0.07,
    blast: 0.2,
    burn: 0.045,
    /** Attack time constant (s). */
    rise: 0.03,
    /** Decay time constant (s) — 5τ ≈ 0.45 s total. */
    decay: 0.09,
  },
  /** Gravity while collapsed (m/s²) — full weight, matching the chunk
   *  stepper's GRAVITY. Standing keeps the lab's soft -2.2. */
  collapseGravity: -9.8,
  /** Floor contact for the falling/collapsed rig: joints rest this far above
   *  y=0 — flesh radius, so the corpse lies ON the floor, not in it. */
  floorPad: 0.04,
  /** Restitution bounce below this implied per-frame fall speed is killed —
   *  the chunk stepper's |vy| < 0.35 m/s cutoff, in per-frame units. */
  restCutoff: 0.35 / 60,
} as const;

/** Hip-fire knobs. */
export const FIRE = {
  /** How long the fire carry holds after the last shot (s). The plan said
   *  0.6, but measured against the run gait's phase (the first full-amplitude
   *  swing after a frame-0 shot must start while the hold is still up or the
   *  stride-cut gate is unsatisfiable — the swing it measures must still be
   *  held). 0.85 s (51 frames) covers that swing; a pure feel knob
   *  otherwise. Still true at the clip-driven 1.5 Hz: the first
   *  full-amplitude footL swing runs frames ~15-43, inside the hold. */
  holdSec: 0.85,
  /** Stride amplitude while holding (a burst on the move shortens the step). */
  strideScale: 0.4,
  /** Point shoves (m) backward along body forward on the fire frame. */
  handKick: 0.06,
  shoulderKick: 0.025,
} as const;

/** Standing rig options, as the lab runs them today — the frame reports the
 *  per-frame deltas (gravity, restPull) against these. */
export const STANDING_RIG = {
  gravityY: -2.2,
  restStiffness: 0.18,
} as const;

/** Combat steps keep enough flexion for a weight-bearing knee bend. */
const SOLDIER_STANCE = {
  blendRate: 6,
  hipDrop: .115,
  stanceWidth: .22,
  supportReserve: .04,
} as const;

// ---------------------------------------------------------------------------
// Sub-stepped integration (the collapse-stall fix, X1.22.1)
// ---------------------------------------------------------------------------

/** Sub-step planning knobs for the wiring's per-frame rig integration. */
export const SUBSTEP_TUNING = {
  /** Largest single step the rig is ever integrated with — the old
   *  `Math.min(dt, 1/30)` clamp's per-step ceiling, kept as the step size so
   *  a catch-up frame's dynamics stay identical to a genuine 30 fps frame
   *  (the cadence the collapse feel was approved at). */
  maxStep: 1 / 30,
  /** Most sim time one rendered frame may consume. Without a cap a frame
   *  returning from a long stall/hidden gap would integrate seconds of fall
   * in one callback; with it, catch-up is spread over a few frames while
   * still completing a 2.5 s fall in ~5 stalled frames instead of ~75. */
  maxCatchup: 0.5,
} as const;

/**
 * Splits a frame's elapsed time into rig sub-steps: at most `maxStep` each,
 * at most `maxCatchup` total, never more steps than the time needs.
 *
 * This is what breaks the collapse death spiral. The old flat
 * `Math.min(dt, 1/30)` clamp advanced the fall by 33 ms NO MATTER how late
 * the frame was, so any stall — a hidden tab, compositor back-pressure, a
 * debugger pause — stretched a 2.5 s fall into minutes of wall clock while
 * the stall persisted (the longer the fall takes, the longer the stall is
 * exposed). Sub-stepping consumes the real elapsed time instead: normal
 * frames get exactly one step of exactly `dt` (identical to before), and a
 * late frame catches up in 33 ms-sized chunks, bounded by `maxCatchup`.
 * Pure; the lab wiring is its only caller.
 */
export function planSubSteps(
  dt: number, tuning: { maxStep: number; maxCatchup: number } = SUBSTEP_TUNING,
): number[] {
  const total = Math.max(0, Math.min(dt, tuning.maxCatchup));
  if (total === 0) return [];
  const n = Math.max(1, Math.ceil(total / tuning.maxStep));
  const step = total / n;
  return Array.from({ length: n }, () => step);
}

// ---------------------------------------------------------------------------
// The wiring contract: joint names ↔ rig point indices ↔ chain lengths.
// ---------------------------------------------------------------------------

/** Everything the orchestrator needs to know about one body's rig layout,
 *  computed once at bind time. Chain lengths come from the authored rest
 *  pose, so severed/posed bodies never change them. */
export interface MotionJoints {
  /** jointNamesForBody(body) — index i lines up with rig point i. */
  names: readonly GaitJointName[];
  /** The bind-time rest pose — the anchor every target is built from. */
  base: readonly Vec3[];
  /** Joint name → rig point index. */
  index: Record<GaitJointName, number>;
  /** Hip→knee, knee→foot lengths per side. */
  leg: { L: readonly [number, number]; R: readonly [number, number] };
  /** Shoulder→elbow, elbow→hand lengths per side. */
  arm: { L: readonly [number, number]; R: readonly [number, number] };
  /** Chest→neck, neck→head lengths (the aim chain). */
  neck: readonly [number, number];
  /** The jaw's rest geometry (jaw.ts), when the body has a `jaw` bone. */
  jaw?: JawRest;
  /** Authored foot height — the floor-contact plane for plants. */
  groundY: number;
  /** The pelvis base position — rootShift is measured from it. */
  pelvis: Vec3;
  /** One-sided collapse joint limits, constant for the body. */
  ropes: readonly RopeLimit[];
}

/**
 * Builds the joint map from a built body and its bind-time rest pose.
 * Returns null when the name/point counts disagree (a wiring bug guard —
 * gait.ts's jointNamesForBody and rig-bind.ts's bindRig dedup the same bones
 * in the same order, so this never fires in practice, but a silent mismatch
 * would scramble the pose rather than crash).
 */
export function makeMotionJoints(
  body: BuildResult, baseRest: readonly Vec3[],
): MotionJoints | null {
  const names = jointNamesForBody(body);
  if (names.length === 0 || names.length !== baseRest.length) return null;
  const index = {} as Record<GaitJointName, number>;
  names.forEach((n, i) => { index[n] = i; });
  const d = (a: GaitJointName, b: GaitJointName): number =>
    len(sub(baseRest[index[a]!]!, baseRest[index[b]!]!));
  return {
    names,
    base: baseRest.map(v => [v[0], v[1], v[2]] as Vec3),
    index,
    leg: {
      L: [d('hipL', 'kneeL'), d('kneeL', 'footL')],
      R: [d('hipR', 'kneeR'), d('kneeR', 'footR')],
    },
    arm: {
      L: [d('shoulderL', 'elbowL'), d('elbowL', 'handL')],
      R: [d('shoulderR', 'elbowR'), d('elbowR', 'handR')],
    },
    neck: [d('chest', 'neck'), d('neck', 'head')],
    ...(index.jaw === undefined ? {} : {
      jaw: jawRestOf(baseRest[index.neck!]!, baseRest[index.head!]!, baseRest[index.jaw]!) }),
    groundY: Math.min(baseRest[index.footL!]![1], baseRest[index.footR!]![1]),
    pelvis: [baseRest[index.pelvis!]![0], 0, baseRest[index.pelvis!]![2]],
    ropes: collapseRopes(names, baseRest),
  };
}

// ---------------------------------------------------------------------------
// State, config, signals.
// ---------------------------------------------------------------------------

/** Localized hit recoil — the pose deviation at the rig point nearest a
 *  hit. World-space direction (the body may be turning; the shove follows
 *  the shot ray regardless), attack-decay envelope over ~5×decay seconds. */
export interface RecoilState {
  /** The joint taking the shove, or null when calm. */
  joint: GaitJointName | null;
  /** Unit shot direction, WORLD space. */
  dirWorld: Vec3;
  /** Peak offset (m) — profile-scaled at the hit. */
  amp: number;
  /** Seconds since the hit. */
  age: number;
}

/** The whole per-body motion state — every sub-state the modules own, plus
 *  the two wiring-owned blends. Plain data; reconstruct or hand-edit in tests. */
export interface MotionState {
  wander: WanderState;
  gait: ReturnType<typeof stepGait>['state'];
  stagger: StaggerState;
  soldierStagger?: SoldierStaggerState;
  soldierStaggerCarry?: CarrySpec;
  soldierStaggerSupport?: Vec3;
  soldierStaggerGunYaw?: number;
  soldierStaggerGunYawBase?: number;
  soldierFullArmBase?: Partial<Record<'L' | 'R', { elbow: Vec3; hand: Vec3 }>>;
  collapse: CollapseState;
  fallPose?: Vec3[];
  fallFatal?: boolean;
  fallImpact?: Vec3;
  fallStrength?: number;
  plantL: PlantState;
  plantR: PlantState;
  stanceBlend?: number;
  footwork?: SoldierFootwork;
  walkPosture?: number;
  /** Persistent 0..1 grounded crouch/shuffle response to pelvis/thigh injury. */
  mobilityPosture?: number;
  /** Short defensive duck after any surviving hit, independent of leg damage. */
  protectiveCrouchSec?: number;
  protectiveCrouchPosture?: number;
  aim: AimState;
  recoil: RecoilState;
  /** The body's APPLIED yaw (rad) — follows wander.heading at the damped
   *  headingFollowRate × headingFollow gain. Every body-local thing (rest
   *  pose rotation, gait/stagger offsets, the aim cone, the stagger's
   *  world→local shot rotation) uses THIS, never wander.heading directly,
   *  so the whole frame agrees during the damped turn. */
  bodyYaw: number;
  /** Gait amplitude 0..1 — follows wander speed / the wander toggle. */
  blend: number;
  /** walk→run blend weight last frame (diagnostic + hysteresis-free). */
  runWeight: number;
  /** Fire hold: seconds left holding the fire carry; 0 = none. */
  fireHold: number;
  /** Seconds since the last shot (Infinity before the first). */
  sinceFire: number;
  /** Smoothed arm rotations for the current weapon hold. */
  carryPose?: CarrySpec;
  /** Smoothed requested hold before a Soldier reaction is composed over it. */
  carryTargetPose?: CarrySpec;
  /** Last frame's root shift (kept so a fall can freeze it). */
  lastShift: Vec3;
  /** Root shift captured when the fall started; null while standing. */
  fallShift: Vec3 | null;
}

/** A fresh motion state: standing at `start`, idle, clock at zero. */
export function makeMotionState(seed: number, start: Vec3): MotionState {
  return {
    wander: { pos: [start[0], 0, start[2]], heading: 0, speed: 0, target: null, idle: 0 },
    gait: { time: 0, seed: seed >>> 0 },
    stagger: makeStaggerState(seed),
    collapse: makeCollapseState(),
    plantL: makePlant(),
    plantR: makePlant(),
    aim: makeAim([0, 0, 1]),
    recoil: { joint: null, dirWorld: [0, 0, 0], amp: 0, age: 0 },
    bodyYaw: 0,
    blend: 0,
    runWeight: 0,
    fireHold: 0,
    sinceFire: Infinity,
    lastShift: [0, 0, 0],
    fallShift: null,
  };
}

/** The two toggles. Motion master off ⇒ the wiring runs today's statue loop
 *  instead (this module is skipped entirely, not fed enabled=false). */
export interface MotionConfig {
  enabled: boolean;
  wander: boolean;
  /** Arm animation style — defaults to GAIT_TUNING.armStyle ('reach'). */
  armStyle?: ArmStyle;
  /** Heading-follow gain override 0..1 — defaults to MOTION_TUNING
   *  .headingFollow. 0 reproduces the strafe-walker (body never turns). */
  headingFollow?: number;
  /** Gaze-follow gain override 0..1 — defaults to MOTION_TUNING.gazeFollow.
   *  0 pins the gaze to the wander target (the creepy variant). */
  gazeFollow?: number;
  /** Per-character profile. Absent = the zombie's (shamble/reach, stock cruise). */
  profile?: MotionProfile;
  /** Treadmill: use this speed (m/s) for the gait blend and run weight
   *  instead of the wander speed, with the body standing still. For the
   *  lab's pose captures. */
  forceSpeed?: number;
  /** Hold this carry regardless of gait/fire state (lab captures). */
  carryOverride?: CarryName;
  /** Aim facing independent of travel, used by directed soldier movement. */
  faceHeading?: number;
  /** Melee swing: phase 0..1 plus which arm swings, throwing which variant
   *  (brain.ts drives all three through game-actor). UNDEFINED IS NOT
   *  "phase 0": undefined skips the composition branches entirely, so the
   *  lab's wiring — which never sets this — produces bit-identical motion.
   *  attack.ts's pose is exactly zero at phase 0 and 1, so setting either is
   *  also a no-op, just a slower one. */
  attack?: { phase: number; side: 'L' | 'R'; variant: SwingVariant };
}

/** What happened since the last frame — collected by the wiring between
 *  frames (shots land in event handlers, not in the frame callback). */
export interface MotionSignals {
  dt: number;
  /** The shot that landed, if any: profile + WORLD-space ray direction +
   *  WORLD-space wound position + whether it struck the torso.
   *  gain is an optional stagger/recoil amplitude multiplier (default 1 =
   *  the lab's tuned amplitudes — the lab wiring never sets it, so its
   *  reactions are bit-identical to a build without the knob). */
  /** `dirWorld` must be a UNIT vector: the reaction amplitudes it scales are
   *  metres (see stagger.ts's header — a velocity here tore bodies in half). */
  shot: { type: WoundType; dirWorld: Vec3; woundWorld: Vec3; torso: boolean; gain?: number;
    soldierLevel?: SoldierStaggerLevel; fullStagger?: boolean } | null;
  mobilityInjury?: { severity: number; side: 'L' | 'R' | 'both' };
  /** The body fired its weapon this frame (drained by the wiring). */
  fire: boolean;
  /** Present-but-hurt limbs (carries ≥1 live wound) — the gait limp skew. */
  wounded: { armL: boolean; armR: boolean; legL: boolean; legR: boolean };
  /** Limbs severed since the last frame (meter + hop skew bookkeeping). */
  severed: readonly LimbId[];
  /** Cluster-alive mapping right now — full severs only. */
  missing: MissingLimbs;
  /** Whether the head cluster is alive (aim is skipped without it). */
  headAlive: boolean;
  /** Forced collapse — the K key / panel button. */
  forcedCollapse: boolean;
  /** Soldier-specific loss of mobility versus terminal injury. */
  downed?: boolean;
  fatal?: boolean;
  /** Burning-panic speed multiplier on the cruise speed; absent = 1. */
  cruiseScale?: number;
  /** Every wound ADDED since the last frame (shots + stumps) — meter fuel. */
  freshWounds: readonly Wound[];
}

/** One frame of orchestrator output — everything the wiring applies. */
export interface MotionFrame {
  /** Joint collision plane; soldiers use the boot sole when downed. */
  floorY: number;
  /** Whole-body ground-plane translation baked into every rest target. */
  rootShift: Vec3;
  heading: number;
  /** The applied body yaw — the wiring feeds this to applyRig so the rigid
   *  head clamp cone turns WITH the body. */
  bodyYaw: number;
  /** Rest targets per rig point, world space. rig.restPose ← this. */
  restPose: Vec3[];
  /** Firm combat leg joints; absent returns the whole body to Verlet. */
  posePins?: readonly number[];
  /** The jaw's gape (rad, jaw.ts) — the wiring copies it to rig.jawGape.
   *  0 for a body without a jaw and whenever no sword swing is live. */
  jawGape: number;
  /** Multiply stepRig's restStiffness by this (the collapse ramp). */
  restPull: number;
  /** Gravity for stepRig this frame (soft standing vs full falling weight). */
  gravity: Vec3;
  /** One-sided joint limits to relax after stepRig. Empty while standing. */
  ropes: RopeLimit[];
  phase: CollapsePhase;
  /** True while falling/settled. */
  collapsed: boolean;
  /** The damage meter 0..1 — the panel readout. */
  meter: number;
  hop: boolean;
  stance: { legL: boolean; legR: boolean };
  staggerKind: StaggerKind | null;
  /** Diagnostics for the handle/panel. */
  speed: number;
  blend: number;
  /** The active gait profile's name ('shamble' | 'march' | 'run'). */
  gaitName: string;
  /** The held gun's pose this frame, world; null when the profile has no carries. */
  gun: GunPose | null;
  /** The carry in effect, or null. */
  carry: CarryName | null;
  /** World-space point shoves for the wiring to apply with impulseAt this frame. */
  kicks: { joint: GaitJointName; delta: Vec3 }[];
}

const SOLVE = {
  iterations: IK_TUNING.iterations,
  epsilon: IK_TUNING.epsilon,
} as const;

const Z: Vec3 = [0, 0, 0];

/** Joints the reach-style blend floor applies to (the arms). */
const ARM_JOINTS: ReadonlySet<GaitJointName> = new Set([
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
]);

/** How much of the turn lean each joint takes — the upper body rolls into
 *  the turn, the legs stay planted under it. */
const LEAN_SHARE: Partial<Record<GaitJointName, number>> = {
  pelvis: 0.3, hips: 0.45, chest: 0.8, neck: 0.9, head: 1,
  shoulderL: 0.85, shoulderR: 0.85, elbowL: 0.6, elbowR: 0.6,
  handL: 0.5, handR: 0.5,
  spineA: 0.55, spineB: 0.7, clavicleL: 0.85, clavicleR: 0.85, handTipL: 0.5, handTipR: 0.5,
};

/** Normalised attack-decay envelope (peak exactly 1) — the recoil's shape,
 *  same curve family as stagger.ts's lurch. */
function recoilEnv(age: number, rise: number, decay: number): number {
  if (age <= 0) return 0;
  const peakAge = rise * Math.log(1 + decay / rise);
  const peak = (1 - Math.exp(-peakAge / rise)) * Math.exp(-peakAge / decay);
  const e = (1 - Math.exp(-age / rise)) * Math.exp(-age / decay);
  return peak > 0 ? e / peak : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function smooth01(n: number): number {
  const t = clamp(n, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Arm style for this frame: an explicit config wins; else the blended gait
 *  profile's style; else (no profile at all) the historical default. */
function pickArmStyle(cfg: MotionConfig, gaitProfile: GaitProfile): ArmStyle {
  if (cfg.armStyle) return cfg.armStyle;
  if (cfg.profile) return gaitProfile.armStyle;
  return GAIT_TUNING.armStyle;
}

// ---------------------------------------------------------------------------
// The frame.
// ---------------------------------------------------------------------------

/**
 * One motion step — pure and deterministic apart from the injected RNG.
 * `points` is the rig's CURRENT point array (world space): stance edges
 * capture their plant from where the foot actually IS. Pass a stub rig in tests.
 */
export function stepMotion(
  state: MotionState,
  joints: MotionJoints,
  cfg: MotionConfig,
  sig: MotionSignals,
  points: readonly RigPoint[],
  bounds: WanderBounds,
  rng: Rng,
): { state: MotionState; frame: MotionFrame } {
  const dt = Math.max(sig.dt, 0);
  const idx = joints.index;
  const havePoints = points.length === joints.names.length;
  const profile = cfg.profile ?? ZOMBIE_PROFILE;

  // --- collapse owns the mode: meter accumulation + trigger matrix ---------
  const collapse = stepCollapse(state.collapse, {
    wounds: profile.name === 'soldier' ? [] : sig.freshWounds,
    severed: profile.name === 'soldier' ? [] : sig.severed,
    missing: sig.missing,
    forced: sig.forcedCollapse || (profile.name === 'soldier'
      && (!sig.headAlive || sig.downed || sig.missing.legL || sig.missing.legR)),
    ropes: joints.ropes,
  }, dt);
  const collapsed = collapse.phase !== 'standing';

  const soldierHit = profile.name === 'soldier' && sig.shot && !collapsed ? {
    dirWorld: sig.shot.dirWorld,
    level: sig.shot.soldierLevel ?? (sig.shot.type === 'pellet' ? 'small' : 'medium'),
    torso: sig.shot.torso,
    fullStagger: sig.shot.fullStagger,
  } as const : null;
  const soldierStagger = stepSoldierStagger(state.soldierStagger, soldierHit,
    dt, state.gait.seed, collapsed || !!sig.fatal);
  const wideSoldierReaction = soldierStagger.active && (soldierStagger.state.fullOpen
    || (soldierStagger.variant === 1 && soldierStagger.state.level !== 'small'));
  // --- stagger: the shot's reaction (dir rotated world → body-local) ------
  // The accepted subtle Soldier reaction retains the shared lurch. The wide
  // opening owns its arms/torso and suppresses that extra pose layer; an
  // already-active Soldier reaction does not restart the shared envelope.
  const stagger = stepStagger(state.stagger, {
    hit: sig.shot && !collapsed && (profile.name !== 'soldier'
      || (!wideSoldierReaction && !state.soldierStagger?.active))
      ? { type: sig.shot.type, dir: rotateYaw(sig.shot.dirWorld, -state.bodyYaw), gain: sig.shot.gain }
      : null,
  }, dt);

  // While standing the frame carries the shamble; collapsed freezes it.
  const frozen = collapsed ? (state.fallShift ?? state.lastShift) : null;

  // --- locomotion (standing only) -----------------------------------------
  let wander = state.wander;
  // Waiting for a support is not an AI deceleration command. Keep the
  // requested speed separate so every footfall does not restart acceleration.
  if (state.footwork && !collapsed)
    wander = { ...wander, speed: state.footwork.driveSpeed };
  const mobilityTarget = profile.name === 'soldier' ? clamp(sig.mobilityInjury?.severity ?? 0, 0, 1) : 0;
  const mobilityPosture = clamp((state.mobilityPosture ?? 0)
    + clamp(mobilityTarget - (state.mobilityPosture ?? 0), -1.4 * dt, 2.8 * dt), 0, 1);
  const protectiveCrouchSec = profile.name !== 'soldier' || collapsed || sig.fatal ? 0
    : soldierHit ? 2 : Math.max(0, (state.protectiveCrouchSec ?? 0) - dt);
  const protectiveTarget = protectiveCrouchSec > 0 ? 1 : 0;
  const protectiveCrouchPosture = clamp((state.protectiveCrouchPosture ?? 0)
    + clamp(protectiveTarget - (state.protectiveCrouchPosture ?? 0), -1.4 * dt, 2.8 * dt), 0, 1);
  const crouchPosture = Math.max(mobilityPosture, protectiveCrouchPosture);
  const travelCruise = (profile.name === 'soldier'
    ? profile.cruise * (sig.wounded.legL || sig.wounded.legR ? 0.55 : 1) * (1 - .65 * mobilityPosture)
    : profile.cruise) * (sig.cruiseScale ?? 1);
  if (!collapsed && cfg.wander) wander = stepWander(wander, rng, dt, bounds, travelCruise,
    cfg.faceHeading === undefined ? undefined : { faceHeading: cfg.faceHeading });
  if (!collapsed && profile.name === 'soldier' && soldierStagger.active) {
    wander = { ...wander, pos: [
      clamp(wander.pos[0] + soldierStagger.travelDelta[0], bounds.minX, bounds.maxX),
      wander.pos[1],
      clamp(wander.pos[2] + soldierStagger.travelDelta[2], bounds.minZ, bounds.maxZ),
    ] };
  }

  // --- body yaw: the damped rigid turn -------------------------------------
  // The whole body (rest pose, gait/stagger offsets, aim cone, plants via
  // their world capture) rotates about the root's vertical axis toward the
  // wander heading — rate-limited, never snapping. Gain 0 pins the authored
  // facing forever: the strafe-walker. Collapsed freezes the yaw with the
  // rest of the pose.
  let bodyYaw = state.bodyYaw;
  let lean = 0;
  if (!collapsed) {
    const gain = cfg.headingFollow ?? MOTION_TUNING.headingFollow;
    const maxTurn = (profile.turnRate ?? MOTION_TUNING.headingFollowRate) * Math.max(gain, 0) * dt;
    const dYaw = wrapPi((cfg.faceHeading ?? wander.heading) - bodyYaw);
    const applied = Math.abs(dYaw) <= maxTurn ? dYaw : Math.sign(dYaw) * maxTurn;
    bodyYaw = wrapPi(bodyYaw + applied);
    const yawRate = dt > 1e-9 ? applied / dt : 0;
    lean = clamp(yawRate * MOTION_TUNING.turnLean, -MOTION_TUNING.turnLeanMax, MOTION_TUNING.turnLeanMax);
  }

  const aimedSoldier = profile.name === 'soldier' && cfg.faceHeading !== undefined;
  // Real locomotion shares fixed supports in patrol and combat. Forced-speed
  // authoring previews keep their existing treadmill clip.
  const groundedSoldier = profile.name === 'soldier' && (aimedSoldier || cfg.forceSpeed === undefined)
    && !collapsed && !sig.missing.legL && !sig.missing.legR;
  const stanceBlend = clamp((state.stanceBlend ?? 0) + (groundedSoldier ? 1 : -1) * SOLDIER_STANCE.blendRate * dt, 0, 1);
  const stanceDrop = SOLDIER_STANCE.hipDrop * stanceBlend + .16 * crouchPosture;
  const walkPosture = clamp((state.walkPosture ?? 0) + (groundedSoldier && !aimedSoldier ? 1 : -1) * 3 * dt, 0, 1);
  const footwork = groundedSoldier ? stepSoldierFootwork(state.footwork, {
    fromRoot: state.wander.pos, desiredRoot: wander.pos, yaw: bodyYaw, dt,
    feet: [havePoints ? points[idx.footL]!.pos : joints.base[idx.footL]!, havePoints ? points[idx.footR]!.pos : joints.base[idx.footR]!],
    hips: (['L', 'R'] as const).map(side => {
      const p = joints.base[idx[`hip${side}`]]!;
      return [p[0] - joints.pelvis[0], p[1] - stanceDrop, p[2] - joints.pelvis[2]] as Vec3;
    }) as [Vec3, Vec3],
    homes: (['L', 'R'] as const).map(side => {
      const p = joints.base[idx[`foot${side}`]]!;
      return [Math.sign(p[0] - joints.pelvis[0]) * SOLDIER_STANCE.stanceWidth, joints.groundY, p[2] - joints.pelvis[2]] as Vec3;
    }) as [Vec3, Vec3],
    reach: [joints.leg.L[0] + joints.leg.L[1] - SOLDIER_STANCE.supportReserve * stanceBlend,
      joints.leg.R[0] + joints.leg.R[1] - SOLDIER_STANCE.supportReserve * stanceBlend],
    lift: (['L', 'R'] as const).map(side => {
      const injured = sig.mobilityInjury?.side === side || sig.mobilityInjury?.side === 'both';
      const wounded = sig.wounded[`leg${side}`];
      return (wounded ? .04 : .07) * (1 - mobilityPosture * (injured ? .55 : .25));
    }) as [number, number],
    stepScale: (['L', 'R'] as const).map(side => {
      const injured = sig.mobilityInjury?.side === side || sig.mobilityInjury?.side === 'both';
      return 1 - mobilityPosture * (injured ? .62 : .38);
    }) as [number, number],
    groundY: joints.groundY,
  }) : undefined;
  if (footwork) wander = { ...wander, pos: footwork.root,
    speed: dt > 0 ? Math.hypot(footwork.root[0] - state.wander.pos[0], footwork.root[2] - state.wander.pos[2]) / dt : 0 };

  // Gait amplitude follows actual speed — idle beats and the wander toggle
  // fade the stride out instead of stepping in place like a treadmill.
  // forceSpeed is the lab treadmill: the body stands still but blends as if
  // moving at that speed. For the zombie profile.cruise === WANDER_TUNING
  // .speed and forceSpeed is undefined, so this arithmetic is unchanged.
  const speedForBlend = cfg.forceSpeed !== undefined ? cfg.forceSpeed : (cfg.wander ? wander.speed : 0);
  const wantBlend = !collapsed && (cfg.wander || cfg.forceSpeed !== undefined)
    ? clamp(speedForBlend / (profile.cruise * MOTION_TUNING.fullStrideAt), 0, 1)
    : 0;
  const blend = clamp(
    state.blend + clamp(wantBlend - state.blend, -MOTION_TUNING.blendRate * dt, MOTION_TUNING.blendRate * dt),
    0, 1,
  );
  const rw = collapsed ? 0 : runWeight(profile, speedForBlend);
  const gaitProfile = profile.gait.walk === profile.gait.run
    ? profile.gait.walk : blendProfiles(profile.gait.walk, profile.gait.run, rw);

  // --- fire hold ------------------------------------------------------------
  // A GUNNER with no right arm cannot hold the gun (was soldier-only, so the
  // cultist would have kept firing a tommy gun from a stump). Nor can a MELEE
  // prop's owner hold her sword: the bride drops it (game-actor releases the
  // prop) and the carry, the fist seat and the arm pins all switch off.
  const canHold = (profile.name !== 'soldier' && !profile.gunner && !profile.melee) || !sig.missing.armR;
  const firedNow = !!sig.fire && !collapsed && !!profile.carries && canHold;
  const fireHold = firedNow ? FIRE.holdSec : Math.max(0, state.fireHold - dt);
  const sinceFire = firedNow ? 0 : state.sinceFire + dt;
  const strideScale = fireHold > 0 ? FIRE.strideScale : 1;

  // --- the gait clock; a blast's knock is baked in (periodic ⇒ invisible) --
  const skew = {
    damageMeter: collapse.state.meter,
    missing: sig.missing,
    wounded: sig.wounded,
  };
  const armStyle = pickArmStyle(cfg, gaitProfile);
  const travel = sub(wander.pos, state.wander.pos);
  const travelYaw = cfg.faceHeading !== undefined && Math.hypot(travel[0], travel[2]) > 1e-6
    ? Math.atan2(travel[0], travel[2]) : bodyYaw;
  // The body's REST leg segment vectors (body-local) — curve-mode gaits
  // rebuild their knee/foot offsets from the clip angles with THESE lengths.
  // The zombie gets limbs too, but SHAMBLE.curves is undefined so nothing
  // changes (the gait pins prove it).
  const limbs: GaitLimbs | undefined = idx.hipL !== undefined && idx.kneeL !== undefined && idx.footL !== undefined
    && idx.hipR !== undefined && idx.kneeR !== undefined && idx.footR !== undefined
    ? {
      L: { thigh: sub(joints.base[idx.kneeL]!, joints.base[idx.hipL]!), shin: sub(joints.base[idx.footL]!, joints.base[idx.kneeL]!) },
      R: { thigh: sub(joints.base[idx.kneeR]!, joints.base[idx.hipR]!), shin: sub(joints.base[idx.footR]!, joints.base[idx.kneeR]!) },
    }
    : undefined;
  // Slow steps as movement slows and freeze cadence at a stop. The old
  // shamble keeps its historical clock. The blend still settles the pose.
  const cadence = profile.carries
    ? (speedForBlend > 0 ? clamp(Math.sqrt(speedForBlend / profile.cruise), 0.65, 1) : 0)
    : 1;
  const gait = stepGait(
    { ...state.gait, time: state.gait.time + stagger.phaseKnock,
      ...(state.gait.cycles === undefined ? {} : { cycles: state.gait.cycles + stagger.phaseKnock * gaitProfile.strideFreq }) },
    skew, dt * cadence, armStyle, gaitProfile, limbs,
  );

  // The melee swing, if the brain is driving one. Composed exactly where a
  // stagger composes — see attack.ts's header. A collapsed body never swings.
  const attack: AttackPose | null =
    cfg.attack !== undefined && !collapsed
      ? attackPose(cfg.attack.phase, cfg.attack.side, cfg.attack.variant)
      : null;

  // --- assemble the standing rest targets ----------------------------------
  // The whole authored pose is rotated by bodyYaw about the root's vertical
  // axis (the pelvis line), THEN translated by the root shift; the body-local
  // gait/stagger offsets rotate by the same yaw, so every part of the frame
  // agrees on where "forward" is. Plants need no rotation handling: they are
  // captured in WORLD space from where the foot actually is, so a planted
  // foot pivots in place while the body turns around it (no skate).
  const shift: Vec3 = frozen ?? [
    wander.pos[0] - joints.pelvis[0], 0, wander.pos[2] - joints.pelvis[2],
  ];
  const pivot = joints.pelvis;
  // Reach- and carry-style arms keep a presence floor so a standing body's
  // arms stay up (mummy arms / held gun); every other offset fades with
  // locomotion as before. The carry floor is FULL presence: the carry table
  // (carry.ts) is tuned so the left shoulder can just reach the gun's
  // fore-end at presence 1 — a partial carry swings the fore-end out of the
  // left arm's reach, so a held gun never droops.
  const armPresence = armStyle === 'reach'
    ? Math.max(blend, MOTION_TUNING.reachMinPresence)
    : armStyle === 'carry'
      ? 1
      : blend;
  const targets: Vec3[] = joints.base.map((base, i) => {
    const name = joints.names[i]!;
    // Footwork already places the weight-bearing frame over its supports.
    // Adding the clip's unrelated hip sway moves it off those contacts.
    const rawGaitLocal = footwork && (name === 'pelvis' || name === 'hips' || name === 'hipL' || name === 'hipR')
      ? Z : name === 'pelvis' ? gait.pose.rootOffset : gait.pose.offsets[name];
    // Quiet the old clip's upper-body oscillation in the heavy patrol walk.
    const gaitLocal = walkPosture === 0 ? rawGaitLocal : scale(rawGaitLocal, 1 - .75 * walkPosture);
    const movingLeg = name === 'kneeL' || name === 'kneeR' || name === 'footL' || name === 'footR' || name === 'toeL' || name === 'toeR';
    let gaitOff = movingLeg && travelYaw !== bodyYaw ? rotateYaw(gaitLocal, travelYaw - bodyYaw) : gaitLocal;
    if (profile.name === 'soldier' && movingLeg) {
      const side = name.endsWith('L') ? -1 : 1;
      const authoredSide = Math.sign(base[0] - pivot[0]) || side;
      // A shuffle keeps each foot in its own lane, even when the body aims
      // across travel. Rotating a forward stride unbounded crossed the legs.
      const lateral = base[0] + gaitOff[0] - pivot[0];
      const minLane = name.startsWith('knee') ? .065 : .10;
      gaitOff = [authoredSide * Math.max(minLane, authoredSide * lateral) - base[0] + pivot[0], gaitOff[1], gaitOff[2]];
    }
    const stagOff = name === 'pelvis' ? stagger.rootOffset : stagger.offsets[name] ?? Z;
    const s = ARM_JOINTS.has(name) ? armPresence : blend * strideScale;
    // BRANCHED, not `add(..., ZERO)`: adding zero would turn a -0 component
    // into +0 and break the lab's bit-identity pin for no benefit.
    const base2 = add(scale(gaitOff, s), stagOff);
    const local = attack
      ? add(base2, name === 'pelvis' ? attack.rootOffset : attack.offsets[name] ?? Z)
      : base2;
    const leanShare = LEAN_SHARE[name] ?? 0;
    const leaned: Vec3 = [local[0] + lean * leanShare, local[1], local[2]];
    const spun = rotateYaw([base[0] - pivot[0], base[1], base[2] - pivot[2]], bodyYaw);
    const off = rotateYaw(leaned, bodyYaw);
    return [
      pivot[0] + shift[0] + spun[0] + off[0],
      spun[1] + off[1] - (name.startsWith('foot') || name.startsWith('toe') ? 0 : stanceDrop),
      pivot[2] + shift[2] + spun[2] + off[2],
    ];
  });

  // --- torso lean (profiles) ------------------------------------------------
  // The whole upper body pitches forward about the hips joint: a ROTATION of
  // targets, so no segment length changes. Zero for the shamble — the branch
  // is skipped entirely so the zombie's arithmetic is untouched.
  const torsoLean = gait.pose.lean * blend * (1 - walkPosture) + .24 * walkPosture + .30 * crouchPosture;
  if (torsoLean !== 0 && !collapsed && idx.hips !== undefined) {
    const pivotP = targets[idx.hips]!;
    const right = rotateYaw([1, 0, 0], bodyYaw);
    // Forward lean = POSITIVE rotation about +right for the up-pointing
    // spine (right-hand rule takes +y toward +z) — the reach pivot's negated
    // convention applies to the DOWN-pointing hang, not to this chain.
    const qLean = qFromAxisAngle(right, torsoLean);
    const hipsY = joints.base[idx.hips]![1];
    joints.names.forEach((name, i) => {
      if (name === 'pelvis' || name === 'hips') return;
      if (joints.base[i]![1] <= hipsY) return; // legs stay under the body
      targets[i] = add(pivotP, qRotate(qLean, sub(targets[i]!, pivotP)));
    });
  }

  // --- shoulder socket clamp (2026-09-09 shadow continuity) ----------------
  // Sway counter-phase, stagger and the attack's shoulder drive all
  // TRANSLATE the shoulder rig points against the chest anchor, and the
  // torso silhouette only just contains the shoulder ball at rest — so the
  // big layers pop the ball out of the body, in the mesh and in the shadow
  // hull that is built from the same posed points. Cap the shoulder's
  // displacement RELATIVE TO its authored offset from the chest, after every
  // layer that moves the shoulder and before the reach/carry pivots, so the
  // arms stay rigid about a socketed ball. Below the cap this is an exact
  // no-op. Recoil lands after this on purpose: a shot impulse may briefly
  // stretch the socket and the verlet pass reads that as impact.
  if (!collapsed && idx.chest !== undefined && MOTION_TUNING.shoulderSocket > 0) {
    const cap = MOTION_TUNING.shoulderSocket;
    // The lean block's own rotation, recomputed so the authored relative
    // vector follows it: a pivot rotation maps a relative vector by the
    // rotation alone, and both anchor points sit above the hips pivot.
    const leanRan = torsoLean !== 0 && idx.hips !== undefined;
    const qLean = qFromAxisAngle(rotateYaw([1, 0, 0], bodyYaw), torsoLean);
    for (const side of ['L', 'R'] as const) {
      const iS = idx[`shoulder${side}`]!;
      const relLocal = sub(joints.base[iS]!, joints.base[idx.chest]!);
      const rel = leanRan
        ? qRotate(qLean, rotateYaw(relLocal, bodyYaw))
        : rotateYaw(relLocal, bodyYaw);
      const excess = sub(sub(targets[iS]!, targets[idx.chest]!), rel);
      const d = len(excess);
      if (d > cap) {
        targets[iS] = add(targets[iS]!, scale(excess, (cap - d) / d));
      }
    }
  }

  // Pre-override hand/foot targets — the tip/toe follow pass below moves each
  // secondary point by whatever delta the arm/plant overrides gave its parent.
  const before = {
    handL: idx.handL !== undefined ? targets[idx.handL]! : null,
    handR: idx.handR !== undefined ? targets[idx.handR]! : null,
    footL: idx.footL !== undefined ? targets[idx.footL]! : null,
    footR: idx.footR !== undefined ? targets[idx.footR]! : null,
  };

  // --- reach-style arm pivot (motion-polish) --------------------------------
  // The reach pose is a ROTATION about the shoulder anchor, not an additive
  // offset: gait emits the pitch spec, and this — the layer that knows the
  // rest arm geometry — rotates each rest segment about the shoulder rig
  // point. Both segments keep their exact rest lengths, so the verlet
  // constraints are satisfiable WITHOUT moving the shoulder: the ball stays
  // socketed in the torso silhouette and only the distal chain travels. (The
  // old additive raise contracted shoulder→elbow ~33% and elbow→hand ~28%;
  // the constraints won against the soft rest pull and dragged the shoulder
  // out of the torso — the detached-arms look the owner flagged.)
  //
  // Composition: the pivot is about the FINAL shoulder target (sway, stagger
  // and lean already ride it), and the elbow/hand's own stagger offsets
  // re-add after the rotation — reactions still move the arms.
  if ((armStyle === 'reach' && gait.pose.reach) || (profile.name === 'soldier' && attack)) {
    const r = gait.pose.reach ?? { pitchL: 0, pitchR: 0, drop: 0, shift: Z };
    const right = rotateYaw([1, 0, 0], bodyYaw); // the body's right axis, world
    const applyArm = (side: 'L' | 'R') => {
      if (side === 'L' ? sig.missing.armL : sig.missing.armR) return;
      const sJ = side === 'L' ? 'shoulderL' : 'shoulderR';
      const eJ = side === 'L' ? 'elbowL' : 'elbowR';
      const hJ = side === 'L' ? 'handL' : 'handR';
      const iS = idx[sJ]!, iE = idx[eJ]!, iH = idx[hJ]!;
      // Positive pitch = forward reach: about +right the hang swings BACK,
      // so the rotation angle is negated.
      const basePitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
      const pitch = attack
        ? basePitch + (side === 'L' ? attack.reach.pitchL : attack.reach.pitchR)
        : basePitch;
      const qUp = qFromAxisAngle(right, -pitch);
      const qFore = qFromAxisAngle(right, -(pitch - r.drop * armPresence));
      // THE HOOK'S SWEEP. A pitch about the body's right axis can only raise
      // and lower an arm; carrying it ACROSS the body is a rotation about
      // world up, composed onto the same segments AFTER the pitch so the arm
      // sweeps from wherever the raise left it. Null when there is no attack
      // — a q of angle 0 would still be a multiply, and the lab's
      // bit-identity pin is not worth spending on tidiness.
      const attackYaw = attack ? (side === 'L' ? attack.reach.yawL : attack.reach.yawR) : 0;
      const qSweep = attackYaw !== 0 ? qFromAxisAngle([0, 1, 0], attackYaw) : null;
      const swept = (v: Vec3): Vec3 => (qSweep ? qRotate(qSweep, v) : v);
      // The rest segments in world (the generic assembly rotates the base
      // pose by the same bodyYaw, so these line up with the targets).
      const s1 = rotateYaw(sub(joints.base[idx[eJ]]!, joints.base[idx[sJ]]!), bodyYaw);
      const s2 = rotateYaw(sub(joints.base[idx[hJ]]!, joints.base[idx[eJ]]!), bodyYaw);
      // The bob/sway beat as ONE rigid shift (scaled by presence), plus this
      // chain's share of the turn lean the generic loop would have added.
      const shiftW = add(
        scale(rotateYaw(r.shift, bodyYaw), armPresence),
        rotateYaw([lean * (LEAN_SHARE[eJ] ?? 0), 0, 0], bodyYaw),
      );
      const eGeom = add(targets[iS]!, swept(qRotate(qUp, s1)));
      targets[iE] = add(add(eGeom, shiftW), rotateYaw(stagger.offsets[eJ] ?? Z, bodyYaw));
      targets[iH] = add(
        add(add(eGeom, swept(qRotate(qFore, s2))), shiftW),
        rotateYaw(stagger.offsets[hJ] ?? Z, bodyYaw),
      );
    };
    applyArm('L');
    applyArm('R');
  }

  // --- carry-style arms: the right arm authored, the left hand IK'd --------
  if (soldierStagger.hunchWeight > 0) {
    const hunch = rotateYaw([0, -.10, .14], bodyYaw);
    for (const name of ['chest', 'neck', 'head', 'shoulderL', 'shoulderR'] as const) {
      const i = idx[name];
      if (i !== undefined) targets[i] = add(targets[i]!, scale(hunch, soldierStagger.hunchWeight));
    }
  }
  let gun: GunPose | null = null;
  let carryUsed: CarryName | null = null;
  /** prop.fistOnGrip: the right hand tip's offset from the wrist, laid along
   *  the grip line — re-applied after the tip follow pass below. */
  let fistTipR: Vec3 | null = null;
  /** A live sword swing, or the two-handed sword carry, pins both arms to
   *  their targets (frame.posePins). */
  let swordArmPins = false;
  const carries = profile.carries;
  const broadSoldierOpen = soldierStagger.active && !soldierStagger.state.fullOpen && soldierStagger.variant === 1
    && soldierStagger.state.level !== 'small';
  let carryPose = state.carryPose;
  let carryTargetPose = state.carryTargetPose;
  let soldierStaggerCarry = state.soldierStaggerCarry;
  let soldierStaggerSupport = state.soldierStaggerSupport;
  let soldierStaggerGunYaw = state.soldierStaggerGunYaw ?? 0;
  let soldierStaggerGunYawBase = state.soldierStaggerGunYawBase ?? 0;
  let soldierFullArmBase = state.soldierFullArmBase;
  if (!soldierStagger.active) {
    soldierStaggerGunYaw = 0;
    soldierStaggerGunYawBase = 0;
  }
  if (armStyle === 'carry' && carries && !collapsed && canHold) {
    const carryName: CarryName = cfg.carryOverride
      ?? (fireHold > 0 ? carries.fire : (rw >= 0.5 ? carries.run : carries.walk));
    carryUsed = carryName;
    const wanted = CARRIES[carryName];
    // A SWORD SWING owns the carry (sword-swing.ts): the track pose, UNSMOOTHED
    // — the swing is authored motion, and the exp(-9 dt) chase below would lag
    // a 0.9 s sweep by a third of its arc. Its phase-0 and phase-1 poses are
    // the walk guard exactly, so entering and leaving needs no blend.
    const swordSwing = attack && cfg.attack && profile.melee?.kind === 'sword'
      && isSwordVariant(cfg.attack.variant)
      ? swordCarryAt(cfg.attack.phase, cfg.attack.variant, CARRIES[carries.walk])
      : null;
    // Pinned for the whole two-handed carry, not only the swing (Task 11): in
    // the guard the soft rest pull let the solved arms lag their targets by
    // up to 14 cm whenever she turned or set off (measured in the game), and
    // with the sword seated on the solved fist the left hand then came off
    // Fore_Hand. The one-handed run (swordTrail) keeps its free left arm.
    swordArmPins = swordSwing !== null || (profile.melee?.kind === 'sword' && !wanted.oneHanded);
    const previous = carryTargetPose ?? wanted;
    const amount = 1 - Math.exp(-9 * dt);
    const mix = (a: number, b: number) => a + (b - a) * amount;
    carryTargetPose = swordSwing ?? {
      right: { pitch: mix(previous.right.pitch, wanted.right.pitch), yaw: mix(previous.right.yaw, wanted.right.yaw), fold: mix(previous.right.fold, wanted.right.fold) },
      gunPitch: mix(previous.gunPitch, wanted.gunPitch),
      leftPole: [mix(previous.leftPole[0], wanted.leftPole[0]), mix(previous.leftPole[1], wanted.leftPole[1]), mix(previous.leftPole[2], wanted.leftPole[2])],
      // A hand is on the prop or it is not — snap to the wanted carry's flag.
      ...(wanted.oneHanded ? { oneHanded: wanted.oneHanded } : {}),
      ...(wanted.rightPole ? { rightPole: wanted.rightPole } : {}),
    };
    if (soldierStagger.state.serial !== (state.soldierStagger?.serial ?? 0)) {
      soldierStaggerCarry = state.carryPose ?? state.carryTargetPose ?? wanted;
      soldierStaggerGunYawBase = soldierStaggerGunYaw;
      soldierFullArmBase = {};
      for (const side of ['L', 'R'] as const) {
        if (sig.missing[`arm${side}`]) continue;
        const shoulder = havePoints ? points[idx[`shoulder${side}`]]!.pos : targets[idx[`shoulder${side}`]]!;
        const elbow = havePoints ? points[idx[`elbow${side}`]]!.pos : targets[idx[`elbow${side}`]]!;
        const hand = havePoints ? points[idx[`hand${side}`]]!.pos : targets[idx[`hand${side}`]]!;
        soldierFullArmBase[side] = { elbow: rotateYaw(sub(elbow, shoulder), -bodyYaw),
          hand: rotateYaw(sub(hand, shoulder), -bodyYaw) };
      }
      if (!sig.missing.armL) {
        const shoulder = havePoints ? points[idx.shoulderL]!.pos : targets[idx.shoulderL]!;
        const hand = havePoints ? points[idx.handL]!.pos : targets[idx.handL]!;
        soldierStaggerSupport = rotateYaw(sub(hand, shoulder), -bodyYaw);
      }
    }
    const carry: CarrySpec = {
      right: { ...carryTargetPose.right },
      gunPitch: carryTargetPose.gunPitch,
      leftPole: [...carryTargetPose.leftPole],
      ...(carryTargetPose.oneHanded ? { oneHanded: carryTargetPose.oneHanded } : {}),
      ...(carryTargetPose.rightPole ? { rightPole: carryTargetPose.rightPole } : {}),
    };
    if (soldierStagger.active && soldierStaggerCarry) {
      const w = soldierStagger.armWeight;
      const duration = soldierStaggerDuration(soldierStagger.state.level, soldierStagger.state.fullOpen);
      const hold = 1 - smooth01((soldierStagger.state.age - duration * .65) / (duration * .35));
      const open = soldierStagger.state.level === 'small' ? .06
        : soldierStagger.state.level === 'medium' ? .11 : .16;
      const broadOpen = broadSoldierOpen;
      const variantOpen = broadOpen ? .98 : open * ([.82, 1, 1.16][soldierStagger.variant] ?? 1);
      carry.right.pitch = soldierStaggerCarry.right.pitch * hold + carryTargetPose.right.pitch * (1 - hold);
      const heldYaw = soldierStaggerCarry.right.yaw * hold + carryTargetPose.right.yaw * (1 - hold);
      carry.right.yaw = heldYaw - variantOpen * w;
      soldierStaggerGunYaw = soldierStaggerGunYawBase * hold - (broadOpen ? variantOpen * w : 0);
      carry.right.fold = soldierStaggerCarry.right.fold * hold + carryTargetPose.right.fold * (1 - hold)
        - variantOpen * (broadOpen ? .2 : .45) * w;
      carry.gunPitch = soldierStaggerCarry.gunPitch * hold + carryTargetPose.gunPitch * (1 - hold);
    }
    carryPose = carry;
    const right = rotateYaw([1, 0, 0], bodyYaw);
    const pelvisX = joints.base[idx.pelvis!]![0];
    const restSeg = (a: GaitJointName, b: GaitJointName) =>
      rotateYaw(sub(joints.base[idx[b]!]!, joints.base[idx[a]!]!), bodyYaw);
    // Right arm: rotations about the shoulder target (sway/stagger/lean ride it).
    if (!sig.missing.armR) {
      const iS = idx.shoulderR!, iE = idx.elbowR!, iH = idx.handR!;
      const inward = joints.base[iS]![0] < pelvisX ? 1 : -1;
      const r = armPivot(targets[iS]!, restSeg('shoulderR', 'elbowR'), restSeg('elbowR', 'handR'),
        carry.right, right, inward, armPresence);
      targets[iE] = add(r.elbow, rotateYaw(stagger.offsets.elbowR ?? Z, bodyYaw));
      targets[iH] = add(r.hand, rotateYaw(stagger.offsets.handR ?? Z, bodyYaw));
      const pitchAxis = Math.abs(soldierStaggerGunYaw) > 1e-9
        ? qRotate(qFromAxisAngle([0,1,0], soldierStaggerGunYaw * armPresence * inward), right)
        : right;
      // The grip seats in the FIST, `gripReach` past the wrist along the
      // forearm (motion-profile.ts). Same direction, so the aim is unchanged.
      const reachPast = profile.prop?.gripReach ?? 0;
      const fist = reachPast > 0
        ? add(targets[iH]!, scale(normalize(sub(targets[iH]!, targets[iE]!)), reachPast))
        : targets[iH]!;
      gun = gunPoseFromArm(targets[iE]!, fist, pitchAxis, carry.gunPitch, profile.prop?.scale);
      // The FIST CLOSES ON THE GRIP (prop.fistOnGrip): the hand bone lies
      // along the forearm, the line the grip was just seated on, instead of
      // keeping its rest hang. The tip follow pass only TRANSLATES the hand
      // tip, so a raised forearm (the bride's high guard) otherwise leaves the
      // fist hanging 4 cm below the wrist while the grip rides above it.
      if (profile.prop?.fistOnGrip && idx.handTipR !== undefined) {
        const handLen = len(sub(joints.base[idx.handTipR]!, joints.base[iH]!));
        fistTipR = scale(normalize(sub(targets[iH]!, targets[iE]!)), handLen);
      }
      // Keep the authored wrist/gun orientation, then swivel the elbow out
      // of the vest. The shoulder and grip do not move, nor do arm lengths.
      const rp = carry.rightPole;
      targets[iE] = alignElbow(targets[iS]!, targets[iE]!, targets[iH]!,
        rotateYaw(rp ? [-inward * rp[0], rp[1], rp[2]] : [-inward, -1, 0.3], bodyYaw));
    }
    // One-handed carry (the ogre's drag): the left arm is free. It swings about
    // its shoulder counter to the left leg — a rotation, never a displacement,
    // so both segments keep their lengths (the reach-pose lesson above).
    if (carry.oneHanded && !sig.missing.armL) {
      const iS = idx.shoulderL!, iE = idx.elbowL!, iH = idx.handL!;
      const inwardL = joints.base[iS]![0] < pelvisX ? 1 : -1;
      const swing = carry.oneHanded.leftSwing * Math.sin(2 * Math.PI * gait.pose.phase) * blend;
      const r = armPivot(targets[iS]!, restSeg('shoulderL', 'elbowL'), restSeg('elbowL', 'handL'),
        { pitch: swing, yaw: 0, fold: Math.max(0, swing) * 0.6 }, right, inwardL, 1);
      targets[iE] = add(r.elbow, rotateYaw(stagger.offsets.elbowL ?? Z, bodyYaw));
      targets[iH] = add(r.hand, rotateYaw(stagger.offsets.handL ?? Z, bodyYaw));
    }
    // Left arm: FABRIK onto the fore-end, elbow poled outward.
    if (gun && !sig.missing.armL && !carry.oneHanded) {
      const iS = idx.shoulderL!, iE = idx.elbowL!, iH = idx.handL!;
      const grip = gunPoint(gun, GUN_GRIP.foreHand);
      let target = grip;
      if (soldierStagger.active && soldierStaggerSupport) {
        const base = add(targets[iS]!, rotateYaw(soldierStaggerSupport, bodyYaw));
        const duration = soldierStaggerDuration(soldierStagger.state.level, soldierStagger.state.fullOpen);
        const recover = smooth01((soldierStagger.state.age - duration * .65) / (duration * .35));
        const lag = smooth01((soldierStagger.state.age - [.04, .08, .12][soldierStagger.variant]!) / .16);
        const broadOpen = broadSoldierOpen;
        const w = soldierStagger.armWeight * lag * (soldierStagger.state.level === 'small' ? .18 : broadOpen ? 1.2 : .32);
        const opened = add(base, rotateYaw([
          broadOpen ? .80 : [.07, .10, .13][soldierStagger.variant]!, broadOpen ? -.12 : [-.015, -.03, .005][soldierStagger.variant]!, -.025,
        ], bodyYaw));
        const held = [base[0] + (grip[0] - base[0]) * recover, base[1] + (grip[1] - base[1]) * recover,
          base[2] + (grip[2] - base[2]) * recover] as Vec3;
        target = [held[0] + (opened[0] - base[0]) * w, held[1] + (opened[1] - base[1]) * w,
          held[2] + (opened[2] - base[2]) * w];
        const fromGrip = sub(target, grip);
        const maxOpen = broadOpen ? .90 : .07;
        if (len(fromGrip) > maxOpen) target = add(grip, scale(normalize(fromGrip), maxOpen));
      }
      const chain = solveChain([targets[iS]!, targets[iE]!, targets[iH]!], joints.arm.L, target, SOLVE);
      const pole = rotateYaw(carry.leftPole, bodyYaw);
      const elbow = alignElbow(chain[0]!, chain[1]!, chain[2]!, pole);
      targets[iE] = add(elbow, rotateYaw(stagger.offsets.elbowL ?? Z, bodyYaw));
      targets[iH] = add(chain[2]!, rotateYaw(stagger.offsets.handL ?? Z, bodyYaw));
    }
  }

  if (!collapsed && soldierStagger.active && soldierStagger.state.fullOpen && soldierFullArmBase) {
    const carriedGun = gun;
    let fullGunRotation: ReturnType<typeof qFromAxisAngle> | null = null;
    for (const side of ['L', 'R'] as const) {
      const base = soldierFullArmBase[side];
      if (!base || sig.missing[`arm${side}`]) continue;
      const sign = side === 'L' ? 1 : -1;
      const lag = side === 'L' ? smooth01((soldierStagger.state.age - .08) / .22) : 1;
      const w = soldierStagger.armWeight * lag;
      const qAbduct = qFromAxisAngle([0,0,1], -sign * .55 * w);
      const qLift = qFromAxisAngle([1,0,0], side === 'R' ? -.35 * w : 0);
      // Aim, low carry and an already-reacting pose start at different yaw.
      // Rotate toward one body-local side target instead of adding a fixed arc,
      // which could carry a low-held gun through and behind the shoulder.
      const fullRaisedHand = qRotate(qFromAxisAngle([1,0,0], side === 'R' ? -.35 : 0),
        qRotate(qFromAxisAngle([0,0,1], -sign * .55), base.hand));
      const fromYaw = Math.atan2(fullRaisedHand[0], fullRaisedHand[2]);
      const yawDelta = Math.atan2(Math.sin(sign * 1.30 - fromYaw), Math.cos(sign * 1.30 - fromYaw));
      const qOut = qFromAxisAngle([0,1,0], yawDelta * w);
      const qLocal = qMul(qOut, qMul(qLift, qAbduct));
      const rotateFull = (v: Vec3) => qRotate(qLocal, v);
      const iS = idx[`shoulder${side}`]!, iE = idx[`elbow${side}`]!, iH = idx[`hand${side}`]!;
      const shoulder = targets[iS]!;
      const fullElbow = add(shoulder, rotateYaw(rotateFull(base.elbow), bodyYaw));
      const fullHand = add(shoulder, rotateYaw(rotateFull(base.hand), bodyYaw));
      targets[iE] = fullElbow;
      targets[iH] = fullHand;
      if (side === 'R') {
        const qBody = qFromAxisAngle([0,1,0], bodyYaw);
        const qBodyInv = qFromAxisAngle([0,1,0], -bodyYaw);
        fullGunRotation = qMul(qBody, qMul(qLocal, qBodyInv));
      }
    }
    if (!sig.missing.armR && carryPose) {
      if (carriedGun && fullGunRotation) {
        gun = { ...carriedGun };
        const grip = targets[idx.handR!]!;
        gun.quat = qMul(fullGunRotation, carriedGun.quat);
        gun.root = add(gun.root, sub(grip, gunPoint(gun, GUN_GRIP.gripHand)));
      }
    }
  }

  // --- fire kicks: the wiring shoves these points with impulseAt -----------
  const kicks: MotionFrame['kicks'] = [];
  if (firedNow && armStyle === 'carry') {
    const back = scale(headingDir(bodyYaw), -1);
    if (!sig.missing.armL) kicks.push({ joint: 'handL', delta: scale(back, FIRE.handKick) });
    if (!sig.missing.armR) {
      kicks.push({ joint: 'handR', delta: scale(back, FIRE.handKick) });
      kicks.push({ joint: 'shoulderR', delta: scale(back, FIRE.shoulderKick) });
    }
  }

  // --- IK override 1: foot plants ------------------------------------------
  // A blast's recoveryStep releases both locks for one frame (a forced
  // stance edge): the feet catch up to the shoved root, then re-plant.
  const release = stagger.recoveryStep && !collapsed;
  const footWorld = (i: number): Vec3 =>
    havePoints ? points[i]!.pos : targets[i]!;
  const plantStep = (
    st: PlantState, stance: boolean, footIdx: number,
  ): PlantState => stepPlant(st, {
    stance: stance && !release,
    footPos: footWorld(footIdx),
    groundY: joints.groundY,
  }, dt);
  // Pole bias for the leg solves: knees bow FORWARD, along the applied body
  // yaw (not wander.heading — the knee must agree with the turned body
  // mid-turn, same contract as every other body-local thing this frame).
  const legPole = headingDir(bodyYaw);
  if (cfg.faceHeading !== undefined && !collapsed && !footwork) {
    // Travel can reverse under an aimed torso. Swing feet follow travel, but
    // the knee hinge still faces the chest instead of turning inside out.
    for (const [side, hip, knee, foot] of [
      ['L', 'hipL', 'kneeL', 'footL'], ['R', 'hipR', 'kneeR', 'footR'],
    ] as const) {
      if (sig.missing[side === 'L' ? 'legL' : 'legR']) continue;
      const ih = idx[hip]!, ik = idx[knee]!, iff = idx[foot]!;
      const chain = solveChain([targets[ih]!, targets[ik]!, targets[iff]!], joints.leg[side], targets[iff]!, SOLVE);
      targets[ik] = poleReflect(chain[0]!, chain[1]!, chain[2]!, legPole);
      targets[iff] = chain[2]!;
    }
  }
  const plantLeg = (st: PlantState, hip: GaitJointName, knee: GaitJointName, foot: GaitJointName, lens: readonly [number, number]) => {
    if (st.phase !== 'stance') return;
    if (profile.name === 'soldier') {
      const local = rotateYaw(sub(st.plantPoint, targets[idx.pelvis!]!), -bodyYaw);
      const side = Math.sign(joints.base[idx[foot]!]![0] - pivot[0]);
      if (side * local[0] < .10) st = { ...st, plantPoint: add(targets[idx.pelvis!]!, rotateYaw([side * .10, local[1], local[2]], bodyYaw)) };
    }
    const solved = solvePlantedLeg(
      targets[idx[hip]!]!, targets[idx[knee]!]!, targets[idx[foot]!]!,
      st, lens, SOLVE, legPole,
    );
    targets[idx[knee]!] = solved.knee;
    targets[idx[foot]!] = solved.foot;
  };

  const missingLegL = sig.missing.legL;
  const missingLegR = sig.missing.legR;
  let plantL = state.plantL;
  let plantR = state.plantR;
  if (footwork) {
    for (const [side, n] of [['L', 0], ['R', 1]] as const) {
      const hip = idx[`hip${side}`], knee = idx[`knee${side}`], foot = idx[`foot${side}`];
      const solved = solveHingeLeg(targets[hip]!, footwork.feet[n], joints.leg[side], legPole);
      targets[knee] = solved.knee;
      targets[foot] = solved.foot;
      const previous = side === 'L' ? state.plantL : state.plantR;
      const phase = footwork.swing?.side === n ? 'swing' : 'stance';
      const plant: PlantState = { phase, plantPoint: footwork.feet[n], age: previous.phase === phase ? previous.age + dt : 0 };
      if (side === 'L') plantL = plant; else plantR = plant;
    }
  } else if (!collapsed) {
    if (!missingLegL) {
      plantL = plantStep(plantL, gait.pose.stance.legL, idx.footL!);
      plantLeg(plantL, 'hipL', 'kneeL', 'footL', joints.leg.L);
    }
    if (!missingLegR) {
      plantR = plantStep(plantR, gait.pose.stance.legR, idx.footR!);
      plantLeg(plantR, 'hipR', 'kneeR', 'footR', joints.leg.R);
    }
  }

  // --- secondary points follow their parents --------------------------------
  // Hand tips and toes are rigid with the hand/foot: whatever the arm and
  // plant overrides did to the parent, the child moves by the same delta.
  const follow = (child: GaitJointName, parent: GaitJointName, was: Vec3 | null) => {
    const ic = idx[child], ip = idx[parent];
    if (ic === undefined || ip === undefined || !was) return;
    targets[ic] = add(targets[ic]!, sub(targets[ip]!, was));
  };
  follow('handTipL', 'handL', before.handL);
  follow('handTipR', 'handR', before.handR);
  if (fistTipR && idx.handTipR !== undefined && idx.handR !== undefined)
    targets[idx.handTipR] = add(targets[idx.handR]!, fistTipR);
  follow('toeL', 'footL', before.footL);
  follow('toeR', 'footR', before.footR);

  // --- IK override 2: head aim (tracks the wander target / heading) --------
  // stepAim lays its chain out STRAIGHT along the solved direction, which
  // would also erase the authored hunch — so the aim is applied as a DELTA:
  // solved chain minus the same chain laid out along the authored (rest)
  // direction. Looking dead ahead reproduces the authored pose exactly.
  //
  // NECK PIVOT (motion-polish): the head rotates about the NECK joint, not
  // the chest. The old chest-rooted chain swung the head rest-target on a
  // chest→head lever (~0.32 m) — alone worth a quarter-metre of drift inside
  // the clamp cone — and the verlet skull constraint (length only, never
  // direction) then let the skull orbit the neck point to chase it: the
  // "loose neck". Rooting the aim at the neck bounds the target to a
  // rotation of the neck→head lever, and applyRig's rigid pass clamps the
  // POSED head to the same IK_TUNING cone regardless.
  let aim = state.aim;
  if (!collapsed && sig.headAlive) {
    // The rest gaze direction turns WITH the body — during a damped turn the
    // clamp cone must be anchored to the applied yaw, not the authored +z.
    const restDir = rotateYaw(
      normalize(sub(joints.base[idx.head!]!, joints.base[idx.neck!]!)), bodyYaw);
    // The gaze target: the look-ahead point along the heading (the head
    // looks where the body walks and leads into turns) blended against the
    // fixed wander target by the gazeFollow gain — 0 keeps the old
    // pinned-gaze behaviour as a pure tuning.
    const gazeFollow = cfg.gazeFollow ?? MOTION_TUNING.gazeFollow;
    const ahead = add(wander.pos, scale(headingDir(cfg.faceHeading ?? wander.heading), MOTION_TUNING.gazeAhead));
    const pinned = wander.target ?? ahead;
    const t = add(scale(pinned, 1 - gazeFollow), scale(ahead, gazeFollow));
    const look: Vec3 = [t[0], joints.base[idx.head!]![1] + shift[1], t[2]];
    const stepped = stepAim(aim, targets[idx.neck!]!, restDir, look, [joints.neck[1]], {
      maxYaw: IK_TUNING.headMaxYaw,
      maxPitch: IK_TUNING.headMaxPitch,
      turnRate: IK_TUNING.headTurnRate,
    }, dt);
    aim = stepped.state;
    const restHead = add(targets[idx.neck!]!, scale(restDir, joints.neck[1]));
    targets[idx.head!] = add(targets[idx.head!]!, sub(stepped.points[1]!, restHead));
  }

  // --- the jaw (bride Task 12, jaw.ts) --------------------------------------
  // The jaw point is KINEMATIC: the head target's frame, opened about the
  // hinge by the sword swing's gape (sword-swing.ts jawGapeAt — wide on the
  // wind-up, snapped shut by the strike's end). Written after the head aim so
  // it rides the look; pinned below (posePins). The gape itself travels to
  // rig-bind as the explicit scalar MotionFrame.jawGape (jaw.ts), never read
  // back off this point, which would be a step stale.
  // The frame is the head AS rig-bind POSES IT: the current rig points'
  // pivot->tip, clamped to the same IK_TUNING cone headTransform uses. Not
  // the targets: the aim lays the head target out along the gaze (tilted
  // ~40 degrees on the bride's upright skull), and the Verlet head point
  // chases it; only the clamp says where the drawn head is.
  let jawGape = 0;
  if (joints.jaw && idx.jaw !== undefined && idx.neck !== undefined && idx.head !== undefined) {
    jawGape = attack && cfg.attack && profile.melee?.kind === 'sword' && isSwordVariant(cfg.attack.variant)
      ? jawGapeAt(cfg.attack.phase, cfg.attack.variant) : 0;
    const at = (i: number): Vec3 => (havePoints ? points[i]!.pos : targets[i]!);
    const dir = clampDir(normalize(sub(at(idx.head), at(idx.neck))), rotateYaw(joints.jaw.restDir, bodyYaw),
      IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
    targets[idx.jaw] = jawTargetAt(joints.jaw, at(idx.neck), dir, bodyYaw, jawGape);
  }

  // --- localized hit recoil -------------------------------------------------
  // The rig point NEAREST the hit takes a world-space shove along the shot
  // ray, attack-decaying over ~0.45 s; the verlet constraints drag the
  // connected chain (shoulder/torso) after it. Applied LAST of the target
  // overrides so the plants/aim can't stomp it, and composed on top
  // of the whole-body stagger. A fresh hit re-targets the recoil.
  let recoil = state.recoil;
  if (sig.shot && !collapsed && !(profile.name === 'soldier' && state.recoil.joint !== null)) {
    const at = sig.shot.woundWorld;
    let best: GaitJointName | null = null;
    let bestD = Infinity;
    joints.names.forEach((name, i) => {
      if (name === 'jaw') return; // kinematic; would steal the head's recoil
      const p = havePoints ? points[i]!.pos : targets[i]!;
      const d = len(sub(p, at));
      if (d < bestD) { bestD = d; best = name; }
    });
    recoil = {
      joint: best,
      dirWorld: normalize(sig.shot.dirWorld),
      amp: MOTION_TUNING.recoil[sig.shot.type] * Math.max(sig.shot.gain ?? 1, 0),
      age: 0,
    };
  }
  if (recoil.joint !== null) {
    const R = MOTION_TUNING.recoil;
    const dur = R.decay * 5;
    if (collapsed || recoil.age >= dur) {
      recoil = { joint: null, dirWorld: Z, amp: 0, age: 0 };
    } else {
      const env = recoilEnv(recoil.age, R.rise, R.decay);
      const i = idx[recoil.joint]!;
      targets[i] = add(targets[i]!, scale(recoil.dirWorld, recoil.amp * env));
      recoil = { ...recoil, age: recoil.age + dt };
    }
  }

  const structural = profile.name === 'soldier' && collapsed;
  // Soldier foot joints sit 13 cm above the authored boot sole. The normal
  // ankle-height plant plane would suspend a side-lying torso in the air.
  const floorY = joints.groundY - (structural ? .13 : MOTION_TUNING.floorPad);
  const fallPose = structural ? (state.fallPose ?? points.map(p => [...p.pos] as Vec3)) : undefined;
  const fallFatal = !!state.fallFatal || !!sig.fatal || !sig.headAlive || sig.forcedCollapse;
  const fallImpact = state.fallImpact ?? sig.shot?.dirWorld ?? (state.recoil.joint !== null ? state.recoil.dirWorld : rotateYaw([0,0,-1], bodyYaw));
  const fallStrength = state.fallStrength ?? (sig.shot?.type === 'blast' ? 1 : sig.shot ? .4 : .8);
  if (structural) {
    const fall = soldierFallPose(joints.base, joints.names, fallPose!, pivot, shift, bodyYaw, collapse.state.fallAge,
      floorY, sig.missing.legL || sig.wounded.legL, !fallFatal, fallImpact, fallStrength, sig.missing.armL);
    fall.forEach((p, i) => { targets[i] = p; });
  }

  const nextState: MotionState = {
    ...(fallPose ? { fallPose, fallFatal, fallImpact, fallStrength } : {}),
    wander, gait: gait.state, stagger: stagger.state,
    ...(profile.name === 'soldier' || state.soldierStagger ? { soldierStagger: soldierStagger.state } : {}),
    collapse: collapse.state,
    plantL, plantR, aim, recoil, bodyYaw, blend, stanceBlend, footwork, walkPosture, mobilityPosture,
    protectiveCrouchSec, protectiveCrouchPosture,
    runWeight: rw,
    fireHold,
    sinceFire,
    ...(carryPose === undefined ? {} : { carryPose }),
    ...(carryTargetPose === undefined ? {} : { carryTargetPose }),
    ...(soldierStaggerCarry === undefined ? {} : { soldierStaggerCarry }),
    ...(soldierStaggerSupport === undefined ? {} : { soldierStaggerSupport }),
    soldierStaggerGunYaw, soldierStaggerGunYawBase,
    ...(soldierFullArmBase === undefined ? {} : { soldierFullArmBase }),
    lastShift: shift,
    fallShift: collapsed ? (state.fallShift ?? shift) : null,
  };

  return {
    state: nextState,
    frame: {
      floorY,
      rootShift: shift,
      heading: wander.heading,
      bodyYaw,
      restPose: targets,
      jawGape,
      // Hit reactions offset joints independently. Let Verlet absorb those
      // impulses rather than hard-pinning incompatible torso/leg targets.
      // A SWORD SWING also pins both arms to the track. The verlet's soft
      // rest pull lags a 1 s swing by up to 20 cm, and the prop is seated on
      // the TARGETS, so an unpinned fist visibly lets go of the grip
      // mid-strike. A hit reaction releases the pins, as for the soldier's
      // legs. The two lists are MERGED into one posePins (a second spread of
      // the key would silently drop the first).
      ...((): { posePins?: number[] } => {
        const legs = footwork && !stagger.staggered && !soldierStagger.active && recoil.joint === null
          ? (['pelvis', 'hips', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR'] as const) : [];
        // Never pin a MISSING arm's joints (a severed left arm under the
        // one-armed carry; the right arm cannot reach here, canHold is off).
        const arms = swordArmPins && !stagger.staggered && recoil.joint === null
          ? ([
            ...(sig.missing.armR ? [] : ['elbowR', 'handR', 'handTipR'] as const),
            ...(sig.missing.armL ? [] : ['elbowL', 'handL', 'handTipL'] as const),
          ]) : [];
        // The JAW is always pinned while she stands: it is kinematic (the
        // head frame plus the gape), and a free chin point would sag on a
        // stiffness-0 bone (rig-bind.ts).
        const jaw = !collapsed && idx.jaw !== undefined ? (['jaw'] as const) : [];
        const pins = [...legs, ...arms, ...jaw].map(name => idx[name]).filter((i): i is number => i !== undefined);
        return pins.length ? { posePins: pins } : {};
      })(),
      restPull: structural ? 1 : collapse.restPull,
      gravity: structural ? [0, -1.5, 0] : collapsed
        ? [0, MOTION_TUNING.collapseGravity, 0]
        : [0, STANDING_RIG.gravityY, 0],
      ropes: structural ? [] : collapse.ropes,
      phase: collapse.phase,
      collapsed,
      meter: collapse.state.meter,
      hop: collapse.hop,
      stance: collapsed ? { legL: false, legR: false } : gait.pose.stance,
      staggerKind: collapsed ? null : profile.name === 'soldier' && soldierStagger.active
        ? soldierStagger.state.level === 'small' ? 'flinch' : 'lurch'
        : stagger.state.kind,
      speed: collapsed ? 0 : wander.speed,
      blend: collapsed ? 0 : blend,
      gaitName: gaitProfile.name,
      gun,
      carry: carryUsed,
      kicks,
    },
  };
}

// ---------------------------------------------------------------------------
// Floor contact for the falling/collapsed rig.
// ---------------------------------------------------------------------------

/**
 * Clamps rig points to the floor with the chunk stepper's ground feel:
 * falling speed reflects with COLLAPSE_TUNING.groundRestitution, horizontal
 * velocity bleeds by COLLAPSE_TUNING.groundFriction while in contact, and a
 * bounce below MOTION_TUNING.restCutoff dies outright (the chunk stepper's
 * |vy| < 0.35 kill). `groundY` should be joints.groundY - floorPad. Pure.
 */
export function applyFloorContact(
  points: readonly RigPoint[],
  groundY: number,
  restitution: number = COLLAPSE_TUNING.groundRestitution,
  friction: number = COLLAPSE_TUNING.groundFriction,
): RigPoint[] {
  return points.map(p => {
    if (p.pinned) return p;
    if (p.pos[1] >= groundY) return p;
    const vy = p.pos[1] - p.prev[1]; // per-frame fall displacement
    const bounce = vy < 0 ? -vy * restitution : 0;
    const still = bounce < MOTION_TUNING.restCutoff;
    const vx = (p.pos[0] - p.prev[0]) * friction;
    const vz = (p.pos[2] - p.prev[2]) * friction;
    return {
      pinned: false,
      pos: [p.pos[0], groundY, p.pos[2]],
      prev: [p.pos[0] - vx, groundY - (still ? 0 : bounce), p.pos[2] - vz],
    };
  });
}
