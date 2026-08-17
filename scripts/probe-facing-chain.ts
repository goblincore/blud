// Headless probe (task 5): walk the zombie toward +x/-x/+z/-z with the REAL
// rig + applyRig, then measure — per direction — (a) whether the posed nose
// prim leads the chest along travel, (b) whether the reach hands sit on the
// travel side, (c) which side of the hip→ankle axis the knee bends toward.
// Run: npx vite-node scripts/probe-facing-chain.ts
import { buildBody, DEFAULT_BUILD_OPTS } from '../src/lab/sdf-zombie/build-body';
import { ZOMBIE } from '../src/lab/sdf-zombie/body';
import { bindRig, applyRig, type BoundRig } from '../src/lab/sdf-zombie/rig-bind';
import { stepRig } from '../src/lab/sdf-zombie/rig';
import {
  makeMotionJoints, makeMotionState, STANDING_RIG, stepMotion,
  type MotionJoints, type MotionState,
} from '../src/lab/sdf-zombie/motion';
import { add, dot, len, normalize, scale, sub, type Vec3 } from '../src/lab/sdf-zombie/vec';
import { headingDir, makeRng, type WanderBounds } from '../src/lab/sdf-zombie/wander';

const BOUNDS: WanderBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };

interface Result {
  noseLead: number; // dot(nose - chest, travel)
  handLLead: number;
  handRLead: number;
  kneeLForward: number; // signed forward offset of knee off the hip→ankle axis
  kneeRForward: number;
  elbowLDown: number; // elbow side offset (for bend-direction check)
  elbowRDown: number;
}

function kneeSide(hip: Vec3, knee: Vec3, foot: Vec3, fwd: Vec3): number {
  // Signed distance of the knee from the hip→foot axis, along `fwd`.
  const axis = sub(foot, hip);
  const t = dot(sub(knee, hip), axis) / Math.max(dot(axis, axis), 1e-9);
  const onAxis = add(hip, scale(axis, t));
  return dot(sub(knee, onAxis), fwd);
}

function runLeg(dirDeg: number): Result {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  let bound: BoundRig = bindRig(body);
  const joints = makeMotionJoints(body, bound.rig.restPose) as MotionJoints;
  const idx = joints.index;
  const rng = makeRng(7);
  let state: MotionState = makeMotionState(7, [0, 0, 0]);
  // March straight along the requested heading: re-pin the target far ahead.
  const heading = (dirDeg * Math.PI) / 180;
  state.wander = { ...state.wander, heading, idle: 0 };

  // The nose = the head sphere furthest +z (forward) at rest.
  let noseIdx = -1;
  let noseZ = -Infinity;
  body.prims.forEach((p, i) => {
    if (p.limb !== 'head') return;
    const z = (p.a[2] + p.b[2]) / 2;
    if (z > noseZ) { noseZ = z; noseIdx = i; }
  });

  const dt = 1 / 60;
  const samples: Result[] = [];
  for (let f = 0; f < 60 * 8; f++) {
    // Keep walking the same compass direction: fresh target straight ahead.
    const ahead = add(state.wander.pos, scale(headingDir(heading), 30));
    state = { ...state, wander: { ...state.wander, target: ahead, idle: 0 } };
    const step = stepMotion(
      state, joints,
      { enabled: true, wander: true },
      {
        dt, shot: null,
        wounded: { armL: false, armR: false, legL: false, legR: false },
        severed: [], missing: {}, headAlive: true,
        forcedCollapse: false, freshWounds: [],
      },
      bound.rig.points, BOUNDS, rng,
    );
    state = step.state;
    const points = stepRig(
      { ...bound.rig, restPose: step.frame.restPose }, dt,
      { gravity: step.frame.gravity, damping: 0.06, iterations: 4, restStiffness: STANDING_RIG.restStiffness * step.frame.restPull },
    ).points;
    bound = { ...bound, rig: { points, constraints: bound.rig.constraints, restPose: step.frame.restPose } };

    if (f >= 60 * 5 && f % 10 === 0) {
      const posed = applyRig(body, bound, step.frame.bodyYaw);
      const travel = headingDir(step.frame.bodyYaw);
      const chest = points[idx.chest]!.pos;
      const nose = scale(add(posed.prims[noseIdx]!.a, posed.prims[noseIdx]!.b), 0.5);
      const fwd: Vec3 = [travel[0], 0, travel[2]];
      const headPt = points[idx.head]!.pos;
      const neckPt = points[idx.neck]!.pos;
      samples.push({
        noseLead: dot(sub(nose, chest), fwd),
        handLLead: dot(sub(points[idx.handL]!.pos, chest), fwd),
        handRLead: dot(sub(points[idx.handR]!.pos, chest), fwd),
        elbowLDown: dot(sub(headPt, chest), fwd), // diag: head POINT lead
        elbowRDown: dot(sub(headPt, neckPt), fwd), // diag: head-vs-neck lead
        kneeLForward: kneeSide(points[idx.hipL]!.pos, points[idx.kneeL]!.pos, points[idx.footL]!.pos, fwd),
        kneeRForward: kneeSide(points[idx.hipR]!.pos, points[idx.kneeR]!.pos, points[idx.footR]!.pos, fwd),
        stanceL: step.frame.stance.legL, stanceR: step.frame.stance.legR,
      } as any);
    }
  }
  const avg = (k: keyof Result) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  const min = (k: keyof Result) => Math.min(...samples.map(s => s[k]));
  const minWhere = (k: string, pred: (s: any) => boolean) =>
    Math.min(...samples.filter(pred).map((s: any) => s[k]));
  console.log(
    `  nose lead avg ${avg('noseLead').toFixed(3)} (min ${min('noseLead').toFixed(3)})` +
    ` · headPt lead ${avg('elbowLDown').toFixed(3)} · head-neck lead ${avg('elbowRDown').toFixed(3)}` +
    ` · handL ${avg('handLLead').toFixed(3)} · handR ${avg('handRLead').toFixed(3)}`,
  );
  console.log(
    `  kneeL fwd min ${min('kneeLForward').toFixed(3)} (stance ${minWhere('kneeLForward', s => s.stanceL).toFixed(3)} / swing ${minWhere('kneeLForward', s => !s.stanceL).toFixed(3)})` +
    ` · kneeR fwd min ${min('kneeRForward').toFixed(3)} (stance ${minWhere('kneeRForward', s => s.stanceR).toFixed(3)} / swing ${minWhere('kneeRForward', s => !s.stanceR).toFixed(3)})`,
  );
  return {
    noseLead: avg('noseLead'), handLLead: avg('handLLead'), handRLead: avg('handRLead'),
    kneeLForward: min('kneeLForward'), kneeRForward: min('kneeRForward'),
    elbowLDown: 0, elbowRDown: 0,
  };
}

for (const [label, deg] of [['+z', 0], ['+x', 90], ['-z', 180], ['-x', -90]] as const) {
  console.log(`walking ${label}:`);
  runLeg(deg);
}
