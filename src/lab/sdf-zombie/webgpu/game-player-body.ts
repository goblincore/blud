// src/lab/sdf-zombie/webgpu/game-player-body.ts
//
// THE ISO PLAYER BODY — a driven, never-thinking character. The isometric
// experiment needs the goblin ON SCREEN holding the shorty, so the player
// stops being an invisible capsule and becomes a real SDF body. This module
// is the wrapper that drives one: the lab's motion pipeline
// (stepMotion -> stepRig -> applyRig -> view.update) exactly as game-actor
// runs it, minus everything a player does not have — no mind, no wander AI,
// no wounds, no severing, no encounter order.
//
// THE DRIVE CONTRACT. game-actor lets stepMotion integrate the body toward
// brain targets; here the PLAYER already owns position and facing (the
// capsule in game-player.ts), so integration is OFF (cfg.wander false) and
// the state is fed directly every sub-step:
//
//   state.wander.pos  <- player feet          (motion.ts builds rest targets
//   cfg.faceHeading   <- player yaw            from wander.pos even when the
//   cfg.forceSpeed    <- |horizontal vel|      wander is off — the shift is
//                                              unconditional)
//   sig.fire          <- one-shot on shots     (arms the fire carry +
//                                               sinceFire, which drives the
//                                               muzzle rise and the casings)
//
// forceSpeed is what keeps the gait alive with the integration off: it is
// the lab treadmill's "blend as if moving at this speed" knob, and the
// cadence/gait-clock path reads it the same way. Position is NOT integrated
// by motion — the root shift lands the body exactly on the capsule every
// frame, so the rendered goblin can never drift from where you collide.
//
// The body is COSMETIC by design: pellets trace actors, not this body, and
// it never appears in the hulls. Nothing about the player's damage model
// changes because the player now has a visible torso.

import type { BuildResult } from '../build-body';
import { bindRig, applyRig, headQuatOf, impulseAt, type BoundRig } from '../rig-bind';
import { constrainRigBends, stepRig } from '../rig';
import { relaxRopeConstraints } from '../collapse';
import {
  makeMotionJoints, makeMotionState, stepMotion, planSubSteps,
  applyFloorContact, STANDING_RIG,
  type MotionJoints, type MotionState, type MotionFrame, type MotionSignals,
} from '../motion';
import type { MotionProfile } from '../motion-profile';
import { makeRng, type Rng, type WanderBounds } from '../wander';
import type { Vec3 } from '../types';
import type { ZombieGpuView } from './zombie-gpu';
import type { CharacterView } from './character-view';

/** Signals for a body nothing can hurt — every frame, verbatim. Same shape
 *  as game-actor's CALM; kept local so the actor's contract stays its own. */
const CALM: Omit<MotionSignals, 'dt'> = {
  shot: null,
  fire: false,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
};

/** stepMotion still takes bounds (stepWander's clamp) even with the wander
 *  integration off, where they are never read. Wide, so a future re-enable
 *  of the integration cannot silently strand the body mid-air either. */
const UNBOUNDED: WanderBounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };

/** One frame of player intent. pos is the capsule's FEET position (the
 *  motion root is a ground-plane point — see makeMotionState). */
export interface PlayerBodyCmd {
  pos: Vec3;
  yaw: number;
  /** Horizontal speed (m/s) — drives the gait blend and the cadence. */
  speed: number;
  /** True on the frame a shot went out; consumed on the first sub-step. */
  fire: boolean;
}

export interface PlayerBodyDrive {
  /** Advance the body one frame toward the player's live pose. */
  step(dt: number, cmd: PlayerBodyCmd): void;
  readonly view: ZombieGpuView;
  readonly character: CharacterView;
  /** Latest posed body (world space) — for the bone instancer. */
  readonly posed: () => BuildResult;
  readonly motionFrame: () => MotionFrame | null;
  /** Diagnostics: the applied yaw, the blended speed, the carry in effect. */
  readonly debug: () => { bodyYaw: number; speed: number; carry: string | null };
}

export function createPlayerBodyDrive(opts: {
  body: BuildResult;
  view: ZombieGpuView;
  /** Kit + held prop + muzzle flash ride this — the same character-view the
   *  actors use, so the gun-carry pose pipeline is THE soldier's, unmodified. */
  character: CharacterView;
  profile: MotionProfile;
  seed: number;
  start: Vec3;
}): PlayerBodyDrive {
  const { body, view } = opts;
  // Walking releases the static anchor bindRig pins — identical to
  // game-actor's bind, for the same reason (rest pull + stance plants carry
  // the body once it moves).
  let bound: BoundRig = bindRig(body);
  bound = {
    ...bound,
    rig: { ...bound.rig, points: bound.rig.points.map(p => ({ ...p, pinned: false })) },
  };
  const mj = makeMotionJoints(body, bound.rig.restPose);
  if (!mj) throw new Error('player body: no motion joints');
  const joints: MotionJoints = mj;
  let state: MotionState = makeMotionState(opts.seed, opts.start);
  const rng: Rng = makeRng(opts.seed);
  let posed = body;
  let bodyYaw = 0;
  let lastFrame: MotionFrame | null = null;

  function step(dt: number, cmd: PlayerBodyCmd) {
    let firstSub = true;
    for (const sdt of planSubSteps(dt)) {
      // THE FEED. The capsule is the truth; the motion state mirrors it
      // before every sub-step. idle is pinned to 0 — a driven body never
      // takes the wander's pause beats.
      state = {
        ...state,
        wander: {
          ...state.wander,
          pos: [cmd.pos[0], 0, cmd.pos[2]],
          heading: cmd.yaw,
          speed: cmd.speed,
          idle: 0,
        },
      };
      const signals = { ...CALM, dt: sdt, ...(cmd.fire && firstSub ? { fire: true } : {}) };
      const r = stepMotion(
        state, joints,
        {
          enabled: true,
          // Position comes from the capsule; the gait still blends and the
          // cadence still runs, off forceSpeed (the lab treadmill knob).
          wander: false,
          forceSpeed: cmd.speed,
          faceHeading: cmd.yaw,
          profile: opts.profile,
          // EXPLICIT, not inherited from the gait profile: pickArmStyle
          // prefers the blended GAIT's arm style, and the goblin keeps its
          // SHAMBLE legs (whose style is reach) — so the profile's carry
          // table would never engage without this. cfg.armStyle is the
          // documented override path; the soldier doesn't need it only
          // because MARCH/RUN already carry.
          armStyle: 'carry',
        },
        signals,
        bound.rig.points, UNBOUNDED, rng,
      );
      state = r.state;
      const f = r.frame;
      lastFrame = f;
      bodyYaw = f.bodyYaw;
      view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      let points = stepRig(
        { ...bound.rig, restPose: f.restPose, bodyYaw: f.bodyYaw, posePins: f.posePins }, sdt,
        {
          gravity: f.gravity,
          damping: 0.06,
          iterations: 4,
          restStiffness: STANDING_RIG.restStiffness * f.restPull,
        },
      ).points;
      if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
      if (f.collapsed) {
        points = applyFloorContact(points, f.floorY);
      }
      bound = {
        ...bound,
        rig: constrainRigBends({ ...bound.rig, points, restPose: f.restPose, bodyYaw: f.bodyYaw },
          f.collapsed ? f.floorY : undefined),
      };
      for (const kick of f.kicks) {
        const i = joints.index[kick.joint];
        if (i !== undefined) bound = impulseAt(bound, bound.rig.points[i]!.pos, kick.delta);
      }
      firstSub = false;
    }
    posed = applyRig(body, bound, bodyYaw);
    view.update(posed, body);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    // Kit + held prop + the prop's muzzle flash, from the same rig solve —
    // the one call character-view exists to own.
    opts.character.pose(body, bound, bodyYaw, state.sinceFire, lastFrame, dt, opts.seed);
  }

  return {
    step,
    view,
    character: opts.character,
    posed: () => posed,
    motionFrame: () => lastFrame,
    debug: () => ({
      bodyYaw,
      speed: state.wander.speed,
      carry: lastFrame?.carry ?? null,
    }),
  };
}
