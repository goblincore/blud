// src/lab/sdf-zombie/webgpu/game-actor.ts
//
// One wandering zombie in the game page: the lab's motion pipeline
// (stepMotion -> stepRig -> applyRig -> view.update) wrapped per body, minus
// everything this page does not do — no wounds, no chunks, no blood, no
// collapse triggers. The lab's wiring (lab-main.ts ~2330) is the reference;
// this is the same drive with empty damage signals.
//
// crowd-alive has NOT landed at the time of writing, so there is no per-actor
// record to reuse — this wrapper IS the actor record for the game page. It
// imports the shared building blocks; it does not touch lab-main.
//
// ROOM CLAMP. stepWander already clamps to the injected bounds (the room
// interior, inset). Furniture is a second constraint the bounds cannot
// express, so the wrapper rejects it post-step: a wanderer whose new position
// lands inside a furniture AABB (fattened by the body radius) is put back and
// its target is dropped, so the next step picks a fresh heading. A clamp,
// not navigation.

import type { BuildResult } from '../build-body';
import { bindRig, applyRig, headQuatOf, type BoundRig } from '../rig-bind';
import { stepRig } from '../rig';
import { relaxRopeConstraints } from '../collapse';
import {
  makeMotionJoints, makeMotionState, stepMotion, planSubSteps,
  applyFloorContact, MOTION_TUNING, STANDING_RIG,
  type MotionJoints, type MotionState, type MotionSignals,
} from '../motion';
import { makeRng, type Rng, type WanderBounds } from '../wander';
import type { Vec3 } from '../types';
import type { ZombieGpuView } from './zombie-gpu';
import type { Aabb } from './game-level';

/** Signals for an undamaged wanderer — every frame, verbatim. */
const CALM: Omit<MotionSignals, 'dt'> = {
  shot: null,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
};

/** How far outside a furniture AABB a wanderer's centre must stay. */
const FURNITURE_MARGIN = 0.55;

export interface ZombieActor {
  readonly id: number;
  readonly room: number;
  readonly body: BuildResult;
  readonly view: ZombieGpuView;
  /** Latest POSED body (world space) — what projectiles will raycast. */
  readonly posed: () => BuildResult;
  readonly boundRig: () => BoundRig;
  /** Current ground position + facing. */
  readonly pose: () => { pos: Vec3; yaw: number };
  step(dt: number): void;
}

export function createZombieActor(opts: {
  id: number;
  room: number;
  body: BuildResult;
  view: ZombieGpuView;
  start: Vec3;
  seed: number;
  bounds: WanderBounds;
  furniture: readonly Aabb[];
}): ZombieActor {
  const { body, view } = opts;
  let bound = bindRig(body);
  // Walking releases the static anchor bindRig pins — rest pull + stance
  // plants carry the body (lab-main's unpinnedRigPoints).
  bound = {
    ...bound,
    rig: { ...bound.rig, points: bound.rig.points.map(p => ({ ...p, pinned: false })) },
  };
  const mj = makeMotionJoints(body, bound.rig.restPose);
  if (!mj) throw new Error(`zombie ${opts.id}: no motion joints`);
  const joints: MotionJoints = mj;
  let state: MotionState = makeMotionState(opts.seed, opts.start);
  // Starting-phase variety: seed the initial heading so spawns don't parade.
  state = { ...state, wander: { ...state.wander, heading: (opts.seed % 8) * (Math.PI / 4) } };
  const rng: Rng = makeRng(opts.seed);
  let posed = body;
  let bodyYaw = 0;

  function insideFurniture(p: Vec3): boolean {
    for (const f of opts.furniture) {
      if (p[0] > f.min[0] - FURNITURE_MARGIN && p[0] < f.max[0] + FURNITURE_MARGIN
        && p[2] > f.min[2] - FURNITURE_MARGIN && p[2] < f.max[2] + FURNITURE_MARGIN) return true;
    }
    return false;
  }

  function step(dt: number) {
    for (const sdt of planSubSteps(dt)) {
      const prevPos: Vec3 = [...state.wander.pos] as Vec3;
      const stepR = stepMotion(
        state, joints,
        { enabled: true, wander: true },
        { dt: sdt, ...CALM },
        bound.rig.points, opts.bounds, rng,
      );
      state = stepR.state;
      const f = stepR.frame;
      // Furniture rejection: restore the position, drop the target. The
      // heading stays, so the body turns as it picks the next target.
      if (insideFurniture(state.wander.pos)) {
        state = { ...state, wander: { ...state.wander, pos: prevPos, target: null, idle: 0.2 } };
      }
      bodyYaw = f.bodyYaw;
      view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      let points = stepRig(
        { ...bound.rig, restPose: f.restPose }, sdt,
        {
          gravity: f.gravity,
          damping: 0.06,
          iterations: 4,
          restStiffness: STANDING_RIG.restStiffness * f.restPull,
        },
      ).points;
      if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
      if (f.collapsed) {
        points = applyFloorContact(points, joints.groundY - MOTION_TUNING.floorPad);
      }
      bound = {
        ...bound,
        rig: { points, constraints: bound.rig.constraints, restPose: f.restPose },
      };
    }
    posed = applyRig(body, bound, bodyYaw);
    view.update(posed, body);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
  }

  return {
    id: opts.id,
    room: opts.room,
    body,
    view,
    posed: () => posed,
    boundRig: () => bound,
    pose: () => ({ pos: [...state.wander.pos] as Vec3, yaw: bodyYaw }),
    step,
  };
}
