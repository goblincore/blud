// src/lab/sdf-zombie/actor.ts
//
// The per-body actor record and the shared pose step.
//
// Everything the frame loop advances per walking body used to live in
// lab-main.ts as module-level singletons owned by body zero — `bound`,
// `motionJoints`, `motionState`, `lastRootShift`, `lastBodyYaw` — which is
// what made the crowd static fill: there was exactly one of each, so only one
// body could ever be rigged or posed.
//
// This module lifts that state into a plain record (`ActorMotion`) and the
// sub-stepped motion+rig pipeline into ONE function (`stepActorMotion`) that
// any body can run. Body zero runs it with the hero's live signals (shots,
// severs, collapse); crowd actors run it with empty signals, a per-actor seed,
// wander bounds around their own spawn, and a FIXED dt so two bench runs at
// the same body count produce the same poses in the same order.
//
// Determinism contract (the frozen-cosmetics noise floor depends on it):
//   - no Math.random() and no wall clock anywhere in this file;
//   - every random draw comes from the injected Rng, seeded by the caller;
//   - crowd callers pass a fixed dt, not rAF's jittery real dt.

import type { BuildResult } from './build-body';
import { bindRig, impulseAt, type BoundRig } from './rig-bind';
import {
  applyFloorContact, makeMotionJoints, makeMotionState, MOTION_TUNING,
  planSubSteps, STANDING_RIG, stepMotion,
  type MotionFrame, type MotionJoints, type MotionSignals, type MotionState,
} from './motion';
import { constrainRigBends, stepRig } from './rig';
import { relaxRopeConstraints, type MissingLimbs } from './collapse';
import type { ArmStyle } from './gait';
import type { CarryName } from './carry';
import type { MotionProfile } from './motion-profile';
import { makeRng, type Rng, type WanderBounds } from './wander';
import type { Wound } from './damage';
import type { LimbId, Vec3 } from './types';

/** Same shape as hero-side woundedLimbs(): present-but-hurt limbs. */
export interface WoundedLimbs {
  armL: boolean; armR: boolean; legL: boolean; legR: boolean;
}

/**
 * One body's per-frame motion state — everything that used to be a module
 * singleton in lab-main.ts, now ownable by any body.
 */
export interface ActorMotion {
  bound: BoundRig;
  motionJoints: MotionJoints | null;
  motionState: MotionState | null;
  lastRootShift: Vec3;
  lastBodyYaw: number;
}

export interface ActorMotionInit {
  /** Where this body stands (world). Hero passes [0,0,0]; crowd its spawn. */
  start?: Vec3;
  /** RNG / gait / stagger seed. Vary per actor or they move in lockstep. */
  seed: number;
}

/**
 * Fresh motion state for one body: bind at its authored pose, release the
 * anchor pin (walking needs it gone), seed the clocks. Mirrors lab-main's
 * boot-time + resetMotion() sequence for body zero, minus the globals.
 */
export function makeActorMotion(body: BuildResult, init: ActorMotionInit): ActorMotion {
  let bound = bindRig(body);
  const motionJoints = makeMotionJoints(body, bound.rig.restPose);
  if (motionJoints) {
    bound = {
      ...bound,
      rig: {
        ...bound.rig,
        points: bound.rig.points.map(p => ({ ...p, pinned: false })),
      },
    };
  }
  return {
    bound,
    motionJoints,
    motionState: makeMotionState(init.seed, init.start ?? [0, 0, 0]),
    lastRootShift: [0, 0, 0],
    lastBodyYaw: 0,
  };
}

/**
 * What happened since this actor's last step. Hero fills it from its pending
* event accumulators; crowd actors pass EMPTY_ACTOR_SIGNALS. Drained after
 * the first sub-step — events landed once, before the frame, not per substep.
 */
export interface ActorSignals {
  shot: MotionSignals['shot'];
  /** The body fired its weapon this frame (drained like the other events). */
  fire: boolean;
  wounded: WoundedLimbs;
  severed: LimbId[];
  missing: MissingLimbs;
  headAlive: boolean;
  forcedCollapse: boolean;
  freshWounds: Wound[];
}

/** A drained, inert signal set — what crowd actors see every frame. */
export function emptyActorSignals(): ActorSignals {
  return {
    shot: null,
    fire: false,
    wounded: { armL: false, armR: false, legL: false, legR: false },
    severed: [],
    missing: { legL: false, legR: false, armL: false, armR: false },
    headAlive: true,
    forcedCollapse: false,
    freshWounds: [],
  };
}

export interface ActorStepInput {
  current: BuildResult;
  dt: number;
  wander: boolean;
  /** Arm-style override; undefined lets the profile/gait pick (task 13). */
  armStyle: ArmStyle | undefined;
  headingFollow: number;
  gazeFollow: number;
  bounds: WanderBounds;
  rng: Rng;
  signals: ActorSignals;
  /** Per-character profile (carry gaits, fire carries) — see MotionConfig. */
  profile?: MotionProfile;
  /** Treadmill speed for lab captures — see MotionConfig. */
  forceSpeed?: number;
  /** Hold this carry regardless of gait/fire state — see MotionConfig. */
  carryOverride?: CarryName;
}

/**
 * One rendered frame's worth of motion + rig solve for ANY body: the exact
 * sub-stepped pipeline lab-main.ts ran for body zero (X1.22/X1.22.1), with
 * the singletons swapped for the passed record. Mutates `m`; returns the last
 * motion frame (null when the body has no motion wiring).
 *
 * Signals drain after the FIRST sub-step, exactly as before: they describe
 * events that landed between frames, not per-sub-step re-triggers. Because
 * shot/forcedCollapse are values (not arrays), the caller reads them back out
 * of `input.signals` to sync its own pending accumulators.
 */
export function stepActorMotion(m: ActorMotion, input: ActorStepInput): MotionFrame | null {
  if (!m.motionJoints || !m.motionState) return null;
  const { signals } = input;
  let f: MotionFrame | null = null;
  let first = true;
  for (const sdt of planSubSteps(input.dt)) {
    const step = stepMotion(
      m.motionState, m.motionJoints,
      {
        enabled: true, wander: input.wander, armStyle: input.armStyle,
        headingFollow: input.headingFollow, gazeFollow: input.gazeFollow,
        profile: input.profile, forceSpeed: input.forceSpeed,
        carryOverride: input.carryOverride,
      },
      {
        dt: sdt,
        shot: signals.shot,
        fire: signals.fire,
        wounded: signals.wounded,
        severed: signals.severed,
        missing: signals.missing,
        headAlive: signals.headAlive,
        forcedCollapse: signals.forcedCollapse,
        freshWounds: signals.freshWounds,
      },
      m.bound.rig.points, input.bounds, input.rng,
    );
    m.motionState = step.state;
    f = step.frame;
    if (first) {
      first = false;
      // Drain in place: array fields belong to the caller's accumulators.
      signals.shot = null;
      signals.fire = false;
      signals.severed.length = 0;
      signals.freshWounds.length = 0;
      signals.forcedCollapse = false;
    }
    m.lastRootShift = f.rootShift;
    m.lastBodyYaw = f.bodyYaw;

    let points = stepRig(
      { ...m.bound.rig, restPose: f.restPose, bodyYaw: f.bodyYaw }, sdt,
      {
        gravity: f.gravity,
        damping: 0.06,
        iterations: 4,
        restStiffness: STANDING_RIG.restStiffness * f.restPull,
      },
    ).points;
    if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
    if (f.collapsed) {
      points = applyFloorContact(points, m.motionJoints.groundY - MOTION_TUNING.floorPad);
    }
    m.bound = {
      ...m.bound,
      rig: constrainRigBends({ ...m.bound.rig, points, restPose: f.restPose, bodyYaw: f.bodyYaw },
        f.collapsed ? m.motionJoints.groundY - MOTION_TUNING.floorPad : undefined),
    };
    // Fire kicks: point shoves THROUGH the rig, after the bend constraints
    // for the sub-step. Only the first sub-step's frame carries them (fire
    // is drained with the other events).
    for (const k of f.kicks) {
      const i = m.motionJoints.index[k.joint];
      if (i === undefined) continue;
      m.bound = impulseAt(m.bound, m.bound.rig.points[i]!.pos, k.delta);
    }
  }
  return f;
}

/**
 * A deterministic per-actor seed and fixed animation clock for crowd bodies.
 *
 * The seed spreads gait/stagger/wander phase across the crowd (same seed ⇒
 * marching band); the FIXED dt makes a run's poses a pure function of frame
 * count, so two bench runs at the same body count match pose-for-pose even
 * though rAF's real dt jitters. 1/30 keeps integration identical to a
 * genuine 30 fps frame, the cadence the rig feel was approved at.
 */
export const CROWD_SEED_STRIDE = 7919; // prime, far from MOTION_SEED harmonics
export const CROWD_DT = 1 / 30;

/** Deterministic per-actor seed: base + index*stride, kept in u32 range. */
export function crowdSeed(index: number, baseSeed: number): number {
  return (baseSeed + index * CROWD_SEED_STRIDE) >>> 0;
}

export function crowdRng(index: number, baseSeed: number): Rng {
  return makeRng(crowdSeed(index, baseSeed));
}
