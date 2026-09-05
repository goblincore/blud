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
import type { BuildResult } from './build-body';
import type { Wound, WoundType } from './damage';
import type { LimbId, Vec3 } from './types';
import { add, len, normalize, qFromAxisAngle, qRotate, scale, sub } from './vec';
import type { RigPoint } from './rig';
import type { GaitJointName } from './gait';
import { GAIT_TUNING, jointNamesForBody, rotateYaw, stepGait, type ArmStyle } from './gait';
import type { WanderBounds, WanderState } from './wander';
import { headingDir, stepWander, WANDER_TUNING, wrapPi, type Rng } from './wander';
import type { PlantState, AimState } from './ik';
import {
  IK_TUNING, makeAim, makePlant, solvePlantedLeg,
  stepAim, stepPlant,
} from './ik';
import type { StaggerKind, StaggerState } from './stagger';
import { makeStaggerState, stepStagger } from './stagger';
import type { CollapsePhase, CollapseState, MissingLimbs, RopeLimit } from './collapse';
import {
  COLLAPSE_TUNING, collapseRopes, makeCollapseState, stepCollapse,
} from './collapse';

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

/** Standing rig options, as the lab runs them today — the frame reports the
 *  per-frame deltas (gravity, restPull) against these. */
export const STANDING_RIG = {
  gravityY: -2.2,
  restStiffness: 0.18,
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
  collapse: CollapseState;
  plantL: PlantState;
  plantR: PlantState;
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
  shot: { type: WoundType; dirWorld: Vec3; woundWorld: Vec3; torso: boolean; gain?: number } | null;
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
  /** Every wound ADDED since the last frame (shots + stumps) — meter fuel. */
  freshWounds: readonly Wound[];
}

/** One frame of orchestrator output — everything the wiring applies. */
export interface MotionFrame {
  /** Whole-body ground-plane translation baked into every rest target. */
  rootShift: Vec3;
  heading: number;
  /** The applied body yaw — the wiring feeds this to applyRig so the rigid
   *  head clamp cone turns WITH the body. */
  bodyYaw: number;
  /** Rest targets per rig point, world space. rig.restPose ← this. */
  restPose: Vec3[];
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

  // --- collapse owns the mode: meter accumulation + trigger matrix ---------
  const collapse = stepCollapse(state.collapse, {
    wounds: sig.freshWounds,
    severed: sig.severed,
    missing: sig.missing,
    forced: sig.forcedCollapse,
    ropes: joints.ropes,
  }, dt);
  const collapsed = collapse.phase !== 'standing';

  // --- stagger: the shot's reaction (dir rotated world → body-local) ------
  // bodyYaw (not wander.heading) is the body's actual facing — during the
  // damped turn the two disagree, and the reaction must follow the BODY.
  const stagger = stepStagger(state.stagger, {
    hit: sig.shot && !collapsed
      ? { type: sig.shot.type, dir: rotateYaw(sig.shot.dirWorld, -state.bodyYaw), gain: sig.shot.gain }
      : null,
  }, dt);

  // While standing the frame carries the shamble; collapsed freezes it.
  const frozen = collapsed ? (state.fallShift ?? state.lastShift) : null;

  // --- locomotion (standing only) -----------------------------------------
  let wander = state.wander;
  if (!collapsed && cfg.wander) wander = stepWander(wander, rng, dt, bounds);

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
    const maxTurn = MOTION_TUNING.headingFollowRate * Math.max(gain, 0) * dt;
    const dYaw = wrapPi(wander.heading - bodyYaw);
    const applied = Math.abs(dYaw) <= maxTurn ? dYaw : Math.sign(dYaw) * maxTurn;
    bodyYaw = wrapPi(bodyYaw + applied);
    const yawRate = dt > 1e-9 ? applied / dt : 0;
    lean = clamp(yawRate * MOTION_TUNING.turnLean, -MOTION_TUNING.turnLeanMax, MOTION_TUNING.turnLeanMax);
  }

  // Gait amplitude follows actual speed — idle beats and the wander toggle
  // fade the stride out instead of stepping in place like a treadmill.
  const wantBlend = !collapsed && cfg.wander
    ? clamp(wander.speed / (WANDER_TUNING.speed * MOTION_TUNING.fullStrideAt), 0, 1)
    : 0;
  const blend = clamp(
    state.blend + clamp(wantBlend - state.blend, -MOTION_TUNING.blendRate * dt, MOTION_TUNING.blendRate * dt),
    0, 1,
  );

  // --- the gait clock; a blast's knock is baked in (periodic ⇒ invisible) --
  const skew = {
    damageMeter: collapse.state.meter,
    missing: sig.missing,
    wounded: sig.wounded,
  };
  const armStyle = cfg.armStyle ?? GAIT_TUNING.armStyle;
  const gait = stepGait(
    { time: state.gait.time + stagger.phaseKnock, seed: state.gait.seed },
    skew, dt, armStyle,
  );

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
  // Reach-style arms keep a presence floor so a standing zombie's mummy arms
  // stay up; every other offset fades with locomotion as before.
  const armPresence = armStyle === 'reach'
    ? Math.max(blend, MOTION_TUNING.reachMinPresence)
    : blend;
  const targets: Vec3[] = joints.base.map((base, i) => {
    const name = joints.names[i]!;
    const gaitOff = name === 'pelvis' ? gait.pose.rootOffset : gait.pose.offsets[name];
    const stagOff = name === 'pelvis' ? stagger.rootOffset : stagger.offsets[name] ?? Z;
    const s = ARM_JOINTS.has(name) ? armPresence : blend;
    const local = add(scale(gaitOff, s), stagOff);
    const leanShare = LEAN_SHARE[name] ?? 0;
    const leaned: Vec3 = [local[0] + lean * leanShare, local[1], local[2]];
    const spun = rotateYaw([base[0] - pivot[0], base[1], base[2] - pivot[2]], bodyYaw);
    const off = rotateYaw(leaned, bodyYaw);
    return [
      pivot[0] + shift[0] + spun[0] + off[0],
      spun[1] + off[1],
      pivot[2] + shift[2] + spun[2] + off[2],
    ];
  });

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
  if (armStyle === 'reach' && gait.pose.reach) {
    const r = gait.pose.reach;
    const right = rotateYaw([1, 0, 0], bodyYaw); // the body's right axis, world
    const applyArm = (side: 'L' | 'R') => {
      if (side === 'L' ? sig.missing.armL : sig.missing.armR) return;
      const sJ = side === 'L' ? 'shoulderL' : 'shoulderR';
      const eJ = side === 'L' ? 'elbowL' : 'elbowR';
      const hJ = side === 'L' ? 'handL' : 'handR';
      const iS = idx[sJ]!, iE = idx[eJ]!, iH = idx[hJ]!;
      // Positive pitch = forward reach: about +right the hang swings BACK,
      // so the rotation angle is negated.
      const pitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
      const qUp = qFromAxisAngle(right, -pitch);
      const qFore = qFromAxisAngle(right, -(pitch - r.drop * armPresence));
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
      const eGeom = add(targets[iS]!, qRotate(qUp, s1));
      targets[iE] = add(add(eGeom, shiftW), rotateYaw(stagger.offsets[eJ] ?? Z, bodyYaw));
      targets[iH] = add(
        add(add(eGeom, qRotate(qFore, s2)), shiftW),
        rotateYaw(stagger.offsets[hJ] ?? Z, bodyYaw),
      );
    };
    applyArm('L');
    applyArm('R');
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
  const plantLeg = (st: PlantState, hip: GaitJointName, knee: GaitJointName, foot: GaitJointName, lens: readonly [number, number]) => {
    if (st.phase !== 'stance') return;
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
  if (!collapsed) {
    if (!missingLegL) {
      plantL = plantStep(plantL, gait.pose.stance.legL, idx.footL!);
      plantLeg(plantL, 'hipL', 'kneeL', 'footL', joints.leg.L);
    }
    if (!missingLegR) {
      plantR = plantStep(plantR, gait.pose.stance.legR, idx.footR!);
      plantLeg(plantR, 'hipR', 'kneeR', 'footR', joints.leg.R);
    }
  }

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
    const ahead = add(wander.pos, scale(headingDir(wander.heading), MOTION_TUNING.gazeAhead));
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

  // --- localized hit recoil -------------------------------------------------
  // The rig point NEAREST the hit takes a world-space shove along the shot
  // ray, attack-decaying over ~0.45 s; the verlet constraints drag the
  // connected chain (shoulder/torso) after it. Applied LAST of the target
  // overrides so the plants/aim can't stomp it, and composed on top
  // of the whole-body stagger. A fresh hit re-targets the recoil.
  let recoil = state.recoil;
  if (sig.shot && !collapsed) {
    const at = sig.shot.woundWorld;
    let best: GaitJointName | null = null;
    let bestD = Infinity;
    joints.names.forEach((name, i) => {
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

  const nextState: MotionState = {
    wander, gait: gait.state, stagger: stagger.state, collapse: collapse.state,
    plantL, plantR, aim, recoil, bodyYaw, blend,
    lastShift: shift,
    fallShift: collapsed ? (state.fallShift ?? shift) : null,
  };

  return {
    state: nextState,
    frame: {
      rootShift: shift,
      heading: wander.heading,
      bodyYaw,
      restPose: targets,
      restPull: collapse.restPull,
      gravity: collapsed
        ? [0, MOTION_TUNING.collapseGravity, 0]
        : [0, STANDING_RIG.gravityY, 0],
      ropes: collapse.ropes,
      phase: collapse.phase,
      collapsed,
      meter: collapse.state.meter,
      hop: collapse.hop,
      stance: collapsed ? { legL: false, legR: false } : gait.pose.stance,
      staggerKind: collapsed ? null : stagger.state.kind,
      speed: collapsed ? 0 : wander.speed,
      blend: collapsed ? 0 : blend,
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
