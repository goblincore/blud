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
//           └─► heading — gait/stagger offsets are BODY-LOCAL and get
//                          rotated into world space by rotateYaw(·, heading)
//   stagger ─► reaction offsets ADD onto the gait offsets (sibling contract,
//              see stagger.ts's header); the shot direction arrives in WORLD
//              space and is rotated to body-local here
//   gait ────► per-joint offsets, amplitude-blended by the wander SPEED
//              (idle beats and wander-off fade the stride out instead of
//              treadmill-stepping in place); a blast's phaseKnock is baked
//              into gait state.time — the clock is periodic, so a permanent
//              small offset is indistinguishable from a decaying one
//   ik ──────► three rest-target overrides, applied in this order:
//              1. FOOT PLANT — stance feet lock to their captured floor
//                 contact; solvePlantedLeg re-solves knee/foot so the pull
//                 DRAGS the foot toward the plant, not away from it (no
//                 fight between rest-pull and plant, which is why the
//                 overrides live in the TARGETS rather than post-step)
//              2. HEAD AIM — neck+head targets laid out along the damped,
//                 clamped look direction (tracks the wander heading/target)
//              3. WOUND CLUTCH — the clutching arm's elbow/hand targets
//                 solved toward the wound by FABRIK
//
// ONE FRAME, COLLAPSED (spec §5): everything above stops; the rest pose is
// the authored pose shifted by the root position FROZEN at the fall; the
// collapse step supplies restPull (ramp 1→0), the one-sided rope limits, and
// the wiring swaps gravity to full -9.8 and adds floor contact. The settled
// corpse keeps taking wounds/severs/gibs because none of that depends on the
// motion pipeline — it reads the posed prims.
//
// DEVIATION FROM ik.ts's stepClutch CONTRACT, deliberate: a blast triggers
// BOTH the lurch (stagger) and the wound clutch, and stepClutch interrupts
// an active clutch whenever `staggered` is true — fed naively, every blast
// would kill its own clutch within one frame and the feature could never
// fire. This module feeds `staggered` as "a reaction that started AFTER the
// clutch did": the clutch's own initiating lurch coexists with the reach,
// while any LATER hit (flinch, shudder, or a fresh lurch) knocks the arm off
// the wound — the composability the spec asks for.
import type { BuildResult } from './build-body';
import type { Wound, WoundType } from './damage';
import type { LimbId, Vec3 } from './types';
import { add, len, normalize, scale, sub } from './vec';
import type { RigPoint } from './rig';
import type { GaitJointName } from './gait';
import { jointNamesForBody, rotateYaw, stepGait } from './gait';
import type { WanderBounds, WanderState } from './wander';
import { headingDir, stepWander, WANDER_TUNING, type Rng } from './wander';
import type { ArmSide, ClutchArm, ClutchState, PlantState, AimState } from './ik';
import {
  IK_TUNING, makeAim, makeClutch, makePlant, solveChain, solvePlantedLeg,
  stepAim, stepClutch, stepPlant,
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
  clutch: ClutchState;
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
    clutch: makeClutch(),
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
}

/** What happened since the last frame — collected by the wiring between
 *  frames (shots land in event handlers, not in the frame callback). */
export interface MotionSignals {
  dt: number;
  /** The shot that landed, if any: profile + WORLD-space ray direction +
   *  WORLD-space wound position + whether it struck the torso (clutch gate). */
  shot: { type: WoundType; dirWorld: Vec3; woundWorld: Vec3; torso: boolean } | null;
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
  clutchArm: ArmSide | null;
  /** Diagnostics for the handle/panel. */
  speed: number;
  blend: number;
}

const SOLVE = {
  iterations: IK_TUNING.iterations,
  epsilon: IK_TUNING.epsilon,
} as const;

const Z: Vec3 = [0, 0, 0];

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

// ---------------------------------------------------------------------------
// The frame.
// ---------------------------------------------------------------------------

/**
 * One motion step — pure and deterministic apart from the injected RNG.
 * `points` is the rig's CURRENT point array (world space): stance edges
 * capture their plant from where the foot actually IS, and the clutch picks
 * its arm by real shoulder positions. Pass a stub rig in tests.
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
  const stagger = stepStagger(state.stagger, {
    hit: sig.shot && !collapsed
      ? { type: sig.shot.type, dir: rotateYaw(sig.shot.dirWorld, -state.wander.heading) }
      : null,
  }, dt);

  // While standing the frame carries the shamble; collapsed freezes it.
  const frozen = collapsed ? (state.fallShift ?? state.lastShift) : null;

  // --- locomotion (standing only) -----------------------------------------
  let wander = state.wander;
  if (!collapsed && cfg.wander) wander = stepWander(wander, rng, dt, bounds);

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
  const gait = stepGait(
    { time: state.gait.time + stagger.phaseKnock, seed: state.gait.seed },
    skew, dt,
  );

  // --- assemble the standing rest targets ----------------------------------
  const shift: Vec3 = frozen ?? [
    wander.pos[0] - joints.pelvis[0], 0, wander.pos[2] - joints.pelvis[2],
  ];
  const targets: Vec3[] = joints.base.map((base, i) => {
    const name = joints.names[i]!;
    const gaitOff = name === 'pelvis' ? gait.pose.rootOffset : gait.pose.offsets[name];
    const stagOff = name === 'pelvis' ? stagger.rootOffset : stagger.offsets[name] ?? Z;
    const local = add(scale(gaitOff, blend), stagOff);
    return add(add(base, shift), rotateYaw(local, wander.heading));
  });

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
  const plantLeg = (st: PlantState, hip: GaitJointName, knee: GaitJointName, foot: GaitJointName, lens: readonly [number, number]) => {
    if (st.phase !== 'stance') return;
    const solved = solvePlantedLeg(
      targets[idx[hip]!]!, targets[idx[knee]!]!, targets[idx[foot]!]!,
      st, lens, SOLVE,
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
  let aim = state.aim;
  if (!collapsed && sig.headAlive) {
    const restDir = normalize(sub(joints.base[idx.head!]!, joints.base[idx.chest!]!));
    const t = wander.target ?? add(wander.pos, scale(headingDir(wander.heading), 2));
    const look: Vec3 = [t[0], joints.base[idx.head!]![1] + shift[1], t[2]];
    const stepped = stepAim(aim, targets[idx.chest!]!, restDir, look, joints.neck, {
      maxYaw: IK_TUNING.headMaxYaw,
      maxPitch: IK_TUNING.headMaxPitch,
      turnRate: IK_TUNING.headTurnRate,
    }, dt);
    aim = stepped.state;
    const restNeck = add(targets[idx.chest!]!, scale(restDir, joints.neck[0]));
    const restHead = add(restNeck, scale(restDir, joints.neck[1]));
    targets[idx.neck!] = add(targets[idx.neck!]!, sub(stepped.points[1]!, restNeck));
    targets[idx.head!] = add(targets[idx.head!]!, sub(stepped.points[2]!, restHead));
  }

  // --- IK override 3: wound clutch ------------------------------------------
  // stepClutch's `staggered` contract is fed as "a reaction that started
  // AFTER the clutch did" — see the header note. The clocks make the split
  // exact: the clutch's own initiating lurch satisfies
  // stagger.age + clutch.remaining == clutchBeat + dt (both started the same
  // frame), so anything strictly below that is a later hit knocking the arm
  // off the wound.
  const interrupting =
    stagger.staggered && state.clutch.arm !== null &&
    stagger.state.age + state.clutch.remaining < IK_TUNING.clutchBeat + dt * 0.5;
  let clutch = state.clutch;
  if (!collapsed) {
    const arms: ClutchArm[] = [];
    if (havePoints) {
      if (!sig.missing.armL) arms.push({ side: 'armL', shoulder: points[idx.shoulderL!]!.pos, hand: points[idx.handL!]!.pos });
      if (!sig.missing.armR) arms.push({ side: 'armR', shoulder: points[idx.shoulderR!]!.pos, hand: points[idx.handR!]!.pos });
    }
    clutch = stepClutch(clutch, {
      blast: !!sig.shot && sig.shot.type === 'blast' && sig.shot.torso && arms.length > 0,
      wound: sig.shot ? sig.shot.woundWorld : Z,
      arms,
      staggered: interrupting,
    }, dt);
    if (clutch.arm !== null) {
      const L = clutch.arm === 'armL';
      const lens = L ? joints.arm.L : joints.arm.R;
      const iShoulder = idx[L ? 'shoulderL' : 'shoulderR']!;
      const iElbow = idx[L ? 'elbowL' : 'elbowR']!;
      const iHand = idx[L ? 'handL' : 'handR']!;
      const chain = solveChain(
        [targets[iShoulder]!, targets[iElbow]!, targets[iHand]!], lens, clutch.target, SOLVE,
      );
      targets[iElbow] = chain[1]!;
      targets[iHand] = chain[2]!;
    }
  } else {
    clutch = makeClutch(); // a corpse has no flourishes
  }

  const nextState: MotionState = {
    wander, gait: gait.state, stagger: stagger.state, collapse: collapse.state,
    plantL, plantR, aim, clutch, blend,
    lastShift: shift,
    fallShift: collapsed ? (state.fallShift ?? shift) : null,
  };

  return {
    state: nextState,
    frame: {
      rootShift: shift,
      heading: wander.heading,
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
      clutchArm: collapsed ? null : clutch.arm,
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
