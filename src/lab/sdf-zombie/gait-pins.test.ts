// src/lab/sdf-zombie/gait-pins.test.ts
//
// BIT-EXACT PINS of the zombie's gait and motion output, recorded before the
// soldier-animation refactor (profiles, joint schema growth, carries). Every
// later change must leave the zombie's numbers untouched: the shamble was
// approved by eye and nothing in this plan is allowed to move it. If a pin
// fails, the refactor changed arithmetic — fix the refactor, never the pin.
//
// ONE DELIBERATE EXCEPTION (2026-09-09, owner-requested shadow/joint
// continuity): the shoulder socket clamp (MOTION_TUNING.shoulderSocket) trims
// shoulder displacement past 0.05 m from its authored chest-relative
// position — the dislocated-shoulder pop the owner flagged. The stepMotion
// checksum below was re-recorded with the clamp active; stepGait's own
// arithmetic is untouched and its pin still holds.
import { describe, it, expect } from 'vitest';
import { makeGaitState, stepGait, type GaitSkew } from './gait';
import {
  makeMotionJoints, makeMotionState, stepMotion,
  type MotionConfig, type MotionSignals,
} from './motion';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { bindRig } from './rig-bind';
import { makeRng, type WanderBounds } from './wander';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

const DT = 1 / 60;
const NONE: GaitSkew = { damageMeter: 0, missing: {}, wounded: {} };
const BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };

/** Order-sensitive float checksum: two accumulators so a swap of two values
 *  cannot cancel. Returned as a fixed-precision string so the pin is exact. */
function checksum(values: number[]): string {
  let a = 0, b = 0;
  for (let i = 0; i < values.length; i++) {
    a += values[i]! * (1 + (i % 97));
    b += values[i]! * values[i]! * (1 + (i % 89));
  }
  return `${a.toFixed(9)}|${b.toFixed(9)}`;
}

/** The 16 non-pelvis joints the zombie has today, in GaitPose.offsets order. */
const ZOMBIE_JOINTS = [
  'hips', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
] as const;

describe('zombie output pins (pre-refactor)', () => {
  it('stepGait, swing and reach, 600 frames', () => {
    const out: number[] = [];
    for (const style of ['swing', 'reach'] as const) {
      let st = makeGaitState(7);
      for (let i = 0; i < 600; i++) {
        const step = stepGait(st, NONE, DT, style);
        st = step.state;
        out.push(...step.pose.rootOffset);
        for (const j of ZOMBIE_JOINTS) out.push(...step.pose.offsets[j]);
        if (step.pose.reach) {
          out.push(step.pose.reach.pitchL, step.pose.reach.pitchR, step.pose.reach.drop, ...step.pose.reach.shift);
        }
        out.push(step.pose.phase);
      }
    }
    expect(checksum(out)).toBe('140997.526258413|146034.851399759');
  });

  it('stepMotion on the stock zombie, wandering, 300 frames', () => {
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose);
    if (!joints) throw new Error('stock zombie has no motion joints');
    const cfg: MotionConfig = { enabled: true, wander: true };
    const sig = (): MotionSignals => ({
      dt: DT, shot: null, fire: false,
      wounded: { armL: false, armR: false, legL: false, legR: false },
      severed: [], missing: { legL: false, legR: false, armL: false, armR: false },
      headAlive: true, forcedCollapse: false, freshWounds: [],
    });
    let state = makeMotionState(11, [0, 0, 0]);
    let points: RigPoint[] = joints.base.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
    const rng = makeRng(42);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const step = stepMotion(state, joints, cfg, sig(), points, BOUNDS, rng);
      state = step.state;
      points = step.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      for (const p of step.frame.restPose) out.push(...p);
      out.push(step.frame.bodyYaw, step.frame.blend);
    }
    // Re-recorded 2026-09-09 for the shoulder socket clamp — see the header.
    // The pre-clamp pin was '372385.134607288|444610.404551562'.
    expect(checksum(out)).toBe('372401.420656677|444572.567802363');
  });
});
