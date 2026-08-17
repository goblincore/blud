// Scratch probe: where does the shoulder BALL prim sit relative to the torso
// surface, old additive reach vs the pivot? Run: npx tsx scripts/probe-shoulder-socket.ts
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { makeZombie } from '../src/lab/sdf-zombie/body';
import { DEFAULT_FACE } from '../src/lab/sdf-zombie/face';
import { bindRig, applyRig } from '../src/lab/sdf-zombie/rig-bind';
import { stepRig } from '../src/lab/sdf-zombie/rig';
import {
  makeMotionJoints, makeMotionState, STANDING_RIG, stepMotion,
  type MotionConfig, type MotionSignals,
} from '../src/lab/sdf-zombie/motion';
import { len, sub } from '../src/lab/sdf-zombie/vec';
import { makeRng, WANDER_TUNING, type WanderBounds } from '../src/lab/sdf-zombie/wander';

const DT = 1 / 60;
const BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
const SIG = (): MotionSignals => ({
  dt: DT, shot: null,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true, forcedCollapse: false, freshWounds: [],
});

function run(style: 'reach' | 'swing', wander: boolean) {
  const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
  // Find the shoulder-ball prim (clavicle sphere, limb armL) and the chest blob.
  let ball = -1, chest = -1;
  body.prims.forEach((p, i) => {
    if (ball < 0 && p.limb === 'armL' && len(sub(p.a, p.b)) < 1e-4) ball = i;
    if (chest < 0 && p.limb === 'torso') chest = i; // spine at 0.80 ribcage
  });
  let bound = bindRig(body);
  const j = makeMotionJoints(body, bound.rig.restPose)!;
  // which rig point does the ball bind to?
  const bind = bound.binding[ball]!;
  console.log(`  ball prim #${ball} binds to point ${bind.a.point} (shoulderL=${j.index.shoulderL}, chest=${j.index.chest}, neck=${j.index.neck}) offset ${bind.a.offset.map(v => v.toFixed(3))}`);
  bound = { ...bound, rig: { ...bound.rig, points: bound.rig.points.map(p => ({ ...p, pinned: false })) } };
  let state = makeMotionState(21, [0, 0, 0]);
  if (wander) state.wander = { pos: [0, 0, 0], heading: 0, speed: WANDER_TUNING.speed, target: [1.4, 0, 1.4], idle: 0 };
  const cfg: MotionConfig = { enabled: true, wander, armStyle: style };
  let maxGap = -Infinity, minGap = Infinity;
  let maxElbowStretch = 0;
  for (let i = 0; i < 240; i++) {
    const step = stepMotion(state, j, cfg, SIG(), bound.rig.points, BOUNDS, makeRng(21));
    state = step.state;
    const points = stepRig(
      { ...bound.rig, restPose: step.frame.restPose }, DT,
      {
        gravity: step.frame.gravity, damping: 0.06, iterations: 4,
        restStiffness: STANDING_RIG.restStiffness * step.frame.restPull,
      },
    ).points;
    bound = { ...bound, rig: { ...bound.rig, restPose: step.frame.restPose, points } };
    const posed = applyRig(body, bound, step.frame.bodyYaw);
    const b = posed.prims[ball]!;
    const c = posed.prims[chest]!;
    // surface-to-surface gap between the ball and the chest blob (negative = overlap)
    const gap = len(sub(b.a, c.a)) - b.radius - c.radius;
    maxGap = Math.max(maxGap, gap); minGap = Math.min(minGap, gap);
    // posed arm chain stretch: |shoulder-elbow| vs rest 0.30
    const se = len(sub(points[j.index.shoulderL!]!.pos, points[j.index.elbowL!]!.pos));
    maxElbowStretch = Math.max(maxElbowStretch, Math.abs(se - 0.3));
  }
  console.log(`${style} wander=${wander}: ball-chest surface gap [${minGap.toFixed(4)}, ${maxGap.toFixed(4)}]  max |sh-el|-0.30 = ${maxElbowStretch.toFixed(4)}`);
}

run('reach', false);
run('reach', true);
run('swing', true);
