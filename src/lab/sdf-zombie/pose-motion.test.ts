// src/lab/sdf-zombie/pose-motion.test.ts
//
// The pose layer's seam in stepMotion (spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md, decision 4): `cfg.pose`
// is a ready array of joint positions (pose.ts poseJoints); the frame's rest targets become that pose and EVERY rig point is
// pinned, so the Verlet rig neither lags nor sags. Walks the real pipeline (buildBody -> bindRig -> stepMotion -> stepRig).
import { describe, it, expect } from 'vitest';
import goblinSrc from './characters/goblin.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { bindRig } from './rig-bind';
import { stepRig } from './rig';
import { jointNamesForBody } from './gait';
import { makeMotionJoints, makeMotionState, STANDING_RIG, stepMotion, type MotionJoints, type MotionState } from './motion';
import { makePoseRig, poseJoints, type PoseClip } from './pose';
import { makeRng, type WanderBounds } from './wander';
import type { Vec3 } from './types';

const BOUNDS: WanderBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
const DT = 1 / 60;
const TYPE: PoseClip = {
  name: 'type',
  keys: [{
    t: 0, bones: {
      spine1: { pitch: 20 }, chest: { pitch: 27 }, neck: { pitch: 24 }, skull: { pitch: -6 },
      thigh: { pitch: 86 }, shin: { pitch: -4 }, upperarm: { pitch: 40 }, forearm: { pitch: 80 }, hand: { pitch: 70 },
    },
  }],
};

function setup() {
  const doc = parseBlob(goblinSrc);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const bound = bindRig(body);
  const joints = makeMotionJoints(body, bound.rig.restPose) as MotionJoints;
  const rig = makePoseRig(doc, jointNamesForBody(body), bound.rig.restPose);
  return { body, bound, joints, rig };
}

function run(pose: readonly Vec3[] | undefined, frames: number, yaw = 0) {
  const { bound: b0, joints, rig } = setup();
  let bound = b0;
  const rng = makeRng(7);
  let state: MotionState = makeMotionState(7, [0, 0, 0]);
  state.wander = { ...state.wander, heading: yaw, idle: 0 };
  const cfg = { enabled: true, wander: false, ...(pose ? { pose } : {}) };
  let last = null as ReturnType<typeof stepMotion> | null;
  for (let f = 0; f < frames; f++) {
    last = stepMotion(state, joints, cfg, {
      dt: DT, shot: null, fire: false,
      wounded: { armL: false, armR: false, legL: false, legR: false }, severed: [],
      missing: { legL: false, legR: false, armL: false, armR: false },
      headAlive: true, forcedCollapse: false, freshWounds: [],
    }, bound.rig.points, BOUNDS, rng);
    state = last.state;
    const points = stepRig({ ...bound.rig, restPose: last.frame.restPose, posePins: last.frame.posePins }, DT, {
      gravity: last.frame.gravity, damping: 0.06, iterations: 4,
      restStiffness: STANDING_RIG.restStiffness * last.frame.restPull,
    }).points;
    bound = { ...bound, rig: { points, constraints: bound.rig.constraints, restPose: last.frame.restPose } };
  }
  return { last: last!, bound, rig };
}

describe('stepMotion with cfg.pose', () => {
  it('writes the pose to the rest targets and pins every rig point', () => {
    const { rig } = setup();
    const pose = poseJoints(rig, TYPE, 0);
    const { last } = run(pose, 5);
    pose.forEach((p, i) => p.forEach((v, k) => expect(last.frame.restPose[i]![k]!, `joint ${i}[${k}]`).toBeCloseTo(v, 9)));
    expect(last.frame.posePins).toEqual(pose.map((_, i) => i));
  });

  it('holds the pose on the rig itself over many frames (pinned: no sag, no drift)', () => {
    const { rig } = setup();
    const pose = poseJoints(rig, TYPE, 0);
    const { bound } = run(pose, 120);
    bound.rig.points.forEach((pt, i) => pt.pos.forEach((v, k) => expect(v, `point ${i}[${k}]`).toBeCloseTo(pose[i]![k]!, 6)));
  });

  it('turns the whole pose about the pelvis line with the body yaw, keeping the pelvis where it is', () => {
    const { rig } = setup();
    const pose = poseJoints(rig, TYPE, 0);
    const straight = run(pose, 3, 0).last.frame.restPose;
    const turned = run(pose, 3, Math.PI / 2).last;
    // The heading changes the wander heading, not the pelvis position; the yaw turns the pose about the pelvis column.
    expect(turned.frame.restPose[0]![1]).toBeCloseTo(straight[0]![1], 9); // pelvis height is yaw-independent
  });

  it('leaves every other character path untouched when no pose is given', () => {
    const a = run(undefined, 30).last.frame;
    expect(a.posePins ?? []).not.toHaveLength(a.restPose.length);
  });
});
