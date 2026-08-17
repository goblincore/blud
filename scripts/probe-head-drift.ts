// Headless probe of the X1.22 walk: how far does the head rig point drift,
// and do face prims separate? Run: npx tsx scripts/probe-head-drift.ts
import { buildBody, DEFAULT_BUILD_OPTS } from '../src/lab/sdf-zombie/build-body';
import { ZOMBIE } from '../src/lab/sdf-zombie/body';
import { bindRig, applyRig } from '../src/lab/sdf-zombie/rig-bind';
import { stepRig } from '../src/lab/sdf-zombie/rig';
import {
  makeMotionJoints, makeMotionState, planSubSteps, STANDING_RIG, stepMotion,
} from '../src/lab/sdf-zombie/motion';
import { len, normalize, sub, dot } from '../src/lab/sdf-zombie/vec';
import { makeRng, type WanderBounds } from '../src/lab/sdf-zombie/wander';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
let bound = bindRig(body);
const joints = makeMotionJoints(body, bound.rig.restPose);
if (!joints) throw new Error('no joints');
const rng = makeRng(42);
const WANDER_BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
let state = makeMotionState(7, [0, 0, 0]);
const idx = joints.index;
const restNeck = bound.rig.points[idx.neck]!.pos;
const restHead = bound.rig.points[idx.head]!.pos;
const restDir = normalize(sub(restHead, restNeck));

// face prims = head-limb spheres; pairwise rest separations for the spike check
const b0 = bindRig(body);
const spheres = body.prims.map((p, i) => ({ p, i, bind: b0.binding[i]! }))
  .filter(({ p }) => p.limb === 'head' && len(sub(p.a, p.b)) < 1e-9);
spheres.forEach(({ i, bind }) =>
  console.log(`face prim ${i}: binds a->point ${bind.a.point} b->point ${bind.b.point} (neck=${idx.neck} head=${idx.head})`));
const restSep = new Map<string, number>();
for (const x of spheres) for (const y of spheres)
  restSep.set(`${x.i},${y.i}`, len(sub(x.p.a, y.p.a)));

let maxHeadNeckDist = 0, maxAngle = 0, maxSepDrift = 0, maxSepPair = '';
let maxTargetAngle = 0, worstPt = 0, worstTgt = 0;
const DT = 1 / 60;
for (let i = 0; i < 60 * 12; i++) {
  let f: ReturnType<typeof stepMotion>['frame'] | null = null;
  for (const sdt of planSubSteps(DT)) {
    const step = stepMotion(state, joints, { enabled: true, wander: true }, {
      dt: sdt, shot: null, wounded: { armL: false, armR: false, legL: false, legR: false },
      severed: [], missing: { armL: false, armR: false, legL: false, legR: false },
      headAlive: true, forcedCollapse: false, freshWounds: [],
    }, bound.rig.points, WANDER_BOUNDS, rng);
    state = step.state;
    f = step.frame;
    const points = stepRig(
      { ...bound.rig, restPose: f.restPose }, sdt,
      { gravity: f.gravity, damping: 0.06, iterations: 4, restStiffness: STANDING_RIG.restStiffness * f.restPull },
    ).points;
    bound = { ...bound, rig: { points, constraints: bound.rig.constraints, restPose: f.restPose } };
  }
  const neck = bound.rig.points[idx.neck]!.pos;
  const head = bound.rig.points[idx.head]!.pos;
  maxHeadNeckDist = Math.max(maxHeadNeckDist, Math.abs(len(sub(head, neck)) - len(sub(restHead, restNeck))));
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(head, neck)), restDir))));
  maxAngle = Math.max(maxAngle, ang);
  // TARGET direction: what did stepMotion ask the neck->head vector to do?
  const tgtDir = normalize(sub(f!.restPose[idx.head]!, f!.restPose[idx.neck]!));
  const tgtAng = Math.acos(Math.max(-1, Math.min(1, dot(tgtDir, restDir))));
  if (tgtAng > maxTargetAngle) { maxTargetAngle = tgtAng; worstTgt = i * DT; }
  if (ang > worstPt) { worstPt = ang; }
  if (i % 240 === 0)
    console.log(`t=${(i * DT).toFixed(1)}s tgtAng=${tgtAng.toFixed(2)} ptAng=${ang.toFixed(2)} aimDirY=${state.aim.dir[1].toFixed(2)}`);
  const posed = applyRig(body, bound);
  for (const x of spheres) for (const y of spheres) {
    const drift = Math.abs(len(sub(posed.prims[x.i]!.a, posed.prims[y.i]!.a)) - restSep.get(`${x.i},${y.i}`)!);
    if (drift > maxSepDrift) { maxSepDrift = drift; maxSepPair = `prims ${x.i}-${y.i}`; }
  }
  void f;
}
console.log('MAX |head-neck| deviation from rest length:', maxHeadNeckDist.toFixed(4));
console.log('MAX head dir angle off rest:', maxAngle.toFixed(3), 'rad');
console.log('MAX TARGET dir angle off rest:', maxTargetAngle.toFixed(3), 'rad at t=', worstTgt.toFixed(1));
console.log('MAX face-prim pair separation drift:', maxSepDrift.toFixed(4), 'at', maxSepPair);
