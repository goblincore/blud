// src/lab/sdf-zombie/facing-chain.test.ts
//
// End-to-end heading-chain regression (motion-polish task 5). The owner
// playtest caught the walking zombie with its face/head pointing AWAY from
// the walk direction in some quadrants and its knees hinging BACKWARD ("a
// cow standing up"). Two root causes, both fixed at the source:
//
//  1. rig-bind.ts's rigid head pass derived its rotation as a bare
//     qFromTo(restDir, clamped) shortest arc — but the neck→head axis is
//     near-VERTICAL in every walking direction, so the arc carried pitch
//     and ZERO azimuth: the body's turn about the head's long axis was
//     invisible, and the face kept pointing the authored +z (quadrant-
//     dependent wrongness: nose lead 0.17 m walking +z, 0.02 m walking -z).
//     The yaw is now composed explicitly (qMul(residual, qYaw)).
//  2. The 2-bone leg solve had no bend-side (pole) constraint, so FABRIK's
//     fold side was picked by numerical drift (one knee solved 0.21 m
//     BEHIND the hip→ankle axis and stayed), and the gait's swing knee
//     offset sat behind the hip→foot line at full reach. solvePlantedLeg
//     now takes a pole (knees bow FORWARD along bodyYaw; elbows bow DOWN),
//     and gait.ts's swing knee tracks half the foot's reach plus a forward
//     bow.
//
// ONE convention, pinned here: yaw 0 = facing +z, positive = clockwise seen
// from above; headingDir(yaw) = [sin, 0, cos] is the world forward; gait.ts
// rotateYaw agrees; the body is authored facing +z (body.ts). (fpv.ts's
// yaw=0=-z convention is the PLAYER camera's and never enters this chain.)
//
// This test walks the REAL pipeline (buildBody → bindRig → stepMotion →
// stepRig → applyRig) toward +x/-x/+z/-z and asserts, per direction:
//   (a) the posed nose prim leads the chest along travel;
//   (b) the reach hands sit on the travel side of the chest;
//   (c) neither knee ever sits materially BEHIND the hip→ankle axis.
import { describe, it, expect } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { bindRig, applyRig, type BoundRig } from './rig-bind';
import { stepRig } from './rig';
import {
  makeMotionJoints, makeMotionState, STANDING_RIG, stepMotion,
  type MotionJoints, type MotionState,
} from './motion';
import { add, dot, scale, sub } from './vec';
import type { Vec3 } from './types';
import { headingDir, makeRng, type WanderBounds } from './wander';

const BOUNDS: WanderBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
const DT = 1 / 60;

/** Signed offset of the knee from the hip→foot axis, along `fwd`. */
function kneeSide(hip: Vec3, knee: Vec3, foot: Vec3, fwd: Vec3): number {
  const axis = sub(foot, hip);
  const t = dot(sub(knee, hip), axis) / Math.max(dot(axis, axis), 1e-9);
  const onAxis = add(hip, scale(axis, t));
  return dot(sub(knee, onAxis), fwd);
}

interface Walk {
  noseLead: number[]; // dot(posed nose prim − chest, travel)
  handLead: number[]; // min(handL, handR) lead per sample
  kneeMin: number; // worst knee-side over the sampled cycle
}

/** Walks a fresh body straight along `heading` for 8 s; samples the last 3. */
function walk(heading: number): Walk {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  let bound: BoundRig = bindRig(body);
  const joints = makeMotionJoints(body, bound.rig.restPose) as MotionJoints;
  const idx = joints.index;
  const rng = makeRng(7);
  let state: MotionState = makeMotionState(7, [0, 0, 0]);
  state.wander = { ...state.wander, heading, idle: 0 };

  // The nose = the head sphere furthest +z (forward) at rest.
  let noseIdx = -1;
  let noseZ = -Infinity;
  body.prims.forEach((p, i) => {
    if (p.limb !== 'head') return;
    const z = (p.a[2] + p.b[2]) / 2;
    if (z > noseZ) { noseZ = z; noseIdx = i; }
  });

  const out: Walk = { noseLead: [], handLead: [], kneeMin: Infinity };
  for (let f = 0; f < 60 * 8; f++) {
    // March one compass direction: re-pin the wander target far ahead.
    const ahead = add(state.wander.pos, scale(headingDir(heading), 30));
    state = { ...state, wander: { ...state.wander, target: ahead, idle: 0 } };
    const step = stepMotion(
      state, joints, { enabled: true, wander: true },
      {
        dt: DT, shot: null, fire: false,
        wounded: { armL: false, armR: false, legL: false, legR: false },
        severed: [],
        missing: { legL: false, legR: false, armL: false, armR: false },
        headAlive: true,
        forcedCollapse: false, freshWounds: [],
      },
      bound.rig.points, BOUNDS, rng,
    );
    state = step.state;
    const points = stepRig(
      { ...bound.rig, restPose: step.frame.restPose }, DT,
      {
        gravity: step.frame.gravity, damping: 0.06, iterations: 4,
        restStiffness: STANDING_RIG.restStiffness * step.frame.restPull,
      },
    ).points;
    bound = { ...bound, rig: { points, constraints: bound.rig.constraints, restPose: step.frame.restPose } };

    if (f < 60 * 5 || f % 10 !== 0) continue;
    const posed = applyRig(body, bound, step.frame.bodyYaw);
    const travel = headingDir(step.frame.bodyYaw);
    const fwd: Vec3 = [travel[0], 0, travel[2]];
    const chest = points[idx.chest]!.pos;
    const nose = scale(add(posed.prims[noseIdx]!.a, posed.prims[noseIdx]!.b), 0.5);
    out.noseLead.push(dot(sub(nose, chest), fwd));
    out.handLead.push(Math.min(
      dot(sub(points[idx.handL]!.pos, chest), fwd),
      dot(sub(points[idx.handR]!.pos, chest), fwd),
    ));
    out.kneeMin = Math.min(
      out.kneeMin,
      kneeSide(points[idx.hipL]!.pos, points[idx.kneeL]!.pos, points[idx.footL]!.pos, fwd),
      kneeSide(points[idx.hipR]!.pos, points[idx.kneeR]!.pos, points[idx.footR]!.pos, fwd),
    );
  }
  return out;
}

describe('facing chain — face, gaze, reach and knees track travel in every quadrant', () => {
  // heading 0 = +z, π/2 = +x (see the convention note in the header).
  const LEGS: readonly [string, number][] = [
    ['+z', 0], ['+x', Math.PI / 2], ['-z', Math.PI], ['-x', -Math.PI / 2],
  ];

  it.each(LEGS)('walking %s: the posed nose prim leads the chest along travel', (_label, heading) => {
    const w = walk(heading);
    const avg = w.noseLead.reduce((a, b) => a + b, 0) / w.noseLead.length;
    // Rest nose lead is ~0.17 m; pre-fix walking -z measured 0.02 (face
    // effectively sideways/backward). Pin well above the broken case.
    expect(avg).toBeGreaterThan(0.12);
    expect(Math.min(...w.noseLead)).toBeGreaterThan(0.05);
  });

  it.each(LEGS)('walking %s: the reach hands stay on the travel side', (_label, heading) => {
    const w = walk(heading);
    const worst = Math.min(...w.handLead);
    expect(worst).toBeGreaterThan(0.3); // measured ~0.57 steady-state
  });

  it.each(LEGS)('walking %s: neither knee ever bends materially BACKWARD', (_label, heading) => {
    const w = walk(heading);
    // Pre-fix the right knee solved 0.215 m behind the hip→ankle axis (the
    // "cow"). The bound is verlet point lag (~0.02), not a bend.
    expect(w.kneeMin).toBeGreaterThan(-0.04);
  });
});
