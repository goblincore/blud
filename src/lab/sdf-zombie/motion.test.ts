// src/lab/sdf-zombie/motion.test.ts
//
// Unit tests for the motion orchestrator (task 4's pure seam). Everything
// runs against the REAL zombie body's joint layout where it matters (so the
// gait↔bindRig ordering contract is pinned), and against stub rig points for
// the per-frame pipeline — stepMotion never touches the renderer.
import { describe, it, expect } from 'vitest';
import {
  applyFloorContact, FIRE, makeMotionJoints, makeMotionState, MOTION_TUNING,
  planSubSteps, STANDING_RIG, stepMotion, SUBSTEP_TUNING,
  type MotionConfig, type MotionJoints, type MotionSignals, type MotionState,
} from './motion';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { applyRig, bindRig } from './rig-bind';
import { stepRig, type RigPoint } from './rig';
import { relaxRopeConstraints, COLLAPSE_TUNING } from './collapse';
import { makeRng, WANDER_TUNING, headingDir, type WanderBounds } from './wander';
import { len, normalize, sub, dot } from './vec';
import type { LimbId, Vec3 } from './types';
import type { Wound } from './damage';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import soldierSrc from './characters/soldier.blob?raw';
import { SOLDIER_PROFILE } from './motion-profile';
import { CARRIES, GUN_GRIP, gunPoseFromArm, gunPoint } from './carry';
import { MARCH, RUN, rotateYaw } from './gait';

const DT = 1 / 60;
const BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
const CFG_ON: MotionConfig = { enabled: true, wander: true };

function realJoints(): MotionJoints {
  const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
  const bound = bindRig(body);
  const joints = makeMotionJoints(body, bound.rig.restPose);
  if (!joints) throw new Error('makeMotionJoints returned null on the stock body');
  return joints;
}

const NO_SIGNALS = (): MotionSignals => ({
  dt: DT,
  shot: null,
  fire: false,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
});

const INTACT: MotionSignals['missing'] = { legL: false, legR: false, armL: false, armR: false };

/** A stub rig that perfectly tracks its targets (infinite rest pull). */
function stubPoints(joints: MotionJoints): RigPoint[] {
  return joints.base.map(p => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: [p[0], p[1], p[2]] as Vec3, pinned: false }));
}

/** Steps the pipeline n times, returning the last frame and state. */
function run(
  joints: MotionJoints, state0: MotionState, cfg: MotionConfig, n: number,
  sig: (i: number) => MotionSignals = NO_SIGNALS,
) {
  let state = state0;
  let points = stubPoints(joints);
  let first = stepMotion(state, joints, cfg, sig(0), points, BOUNDS, makeRng(42));
  state = first.state;
  let frame = first.frame;
  for (let i = 1; i < n; i++) {
    // The stub rig follows the previous targets — like a rig with instant pull.
    const prev = points;
    points = frame.restPose.map(p => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: prev[0]!.pos, pinned: false }));
    const step = stepMotion(state, joints, cfg, sig(i), points, BOUNDS, makeRng(42));
    state = step.state;
    frame = step.frame;
  }
  return { state, frame };
}

/** A wander state already cruising at a distant target. */
function cruising(seed: number): MotionState {
  const st = makeMotionState(seed, [0, 0, 0]);
  st.wander = {
    pos: [0, 0, 0], heading: 0, speed: WANDER_TUNING.speed,
    target: [1.4, 0, 1.4], idle: 0,
  };
  return st;
}

function blastWound(): Wound {
  return { primIdx: 0, local: [0, 0, 0], radius: 0.13, type: 'blast', ageSec: 0 };
}

function soldierJoints(): MotionJoints {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);
  const j = makeMotionJoints(body, bound.rig.restPose);
  if (!j) throw new Error('soldier has no motion joints');
  return j;
}

describe('makeMotionJoints', () => {
  it('maps the stock zombie: 17 joints matching bindRig, in order', () => {
    const joints = realJoints();
    expect(joints.names).toHaveLength(17);
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    expect(joints.names.length).toBe(bindRig(body).rig.points.length);
    expect(joints.index.pelvis).toBe(0);
    expect(joints.index.footR).toBe(16);
  });

  it('derives positive chain lengths and non-empty collapse ropes', () => {
    const j = realJoints();
    for (const l of [j.leg.L, j.leg.R, j.arm.L, j.arm.R, j.neck])
      expect(l[0]).toBeGreaterThan(0.05), expect(l[1]).toBeGreaterThan(0.05);
    expect(j.ropes.length).toBeGreaterThanOrEqual(6);
    expect(j.groundY).toBeGreaterThan(0);
  });

  it('returns null on a length mismatch (wiring guard)', () => {
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    expect(makeMotionJoints(body, [[0, 0, 0]])).toBeNull();
  });
});

describe('stepMotion — standing', () => {
  it('idle frame with no inputs reproduces the authored rest pose exactly', () => {
    const j = realJoints();
    // Wander off + head severed disables every offset path (aim included):
    // the rest targets ARE the authored pose, bit for bit. Swing style: the
    // reach style's idle presence floor intentionally lifts the arms.
    const cfg: MotionConfig = { enabled: true, wander: false, armStyle: 'swing' };
    const { frame } = run(j, makeMotionState(1, [0, 0, 0]), cfg, 3,
      () => ({ ...NO_SIGNALS(), headAlive: false }));
    expect(frame.restPose).toEqual(j.base.map(v => [...v] as Vec3));
    expect(frame.restPull).toBe(1);
    expect(frame.gravity).toEqual([0, STANDING_RIG.gravityY, 0]);
    expect(frame.ropes).toEqual([]);
    expect(frame.phase).toBe('standing');
    expect(frame.meter).toBe(0);
  });

  it('an idle-but-alive head keeps the authored hunch while gazing', () => {
    const j = realJoints();
    const cfg: MotionConfig = { enabled: true, wander: false };
    const { frame } = run(j, makeMotionState(1, [0, 0, 0]), cfg, 30);
    // The default gaze (ahead along the heading) is within the clamp cone of
    // the authored perch: a bounded lean, no lateral shear, no teleport.
    const dn = sub(frame.restPose[j.index.neck]!, j.base[j.index.neck]!);
    const dh = sub(frame.restPose[j.index.head]!, j.base[j.index.head]!);
    expect(len(dn)).toBeLessThan(0.2);
    expect(len(dh)).toBeLessThan(0.25);
    expect(Math.abs(dh[0])).toBeLessThan(0.03);
    expect(dh[2]).toBeGreaterThan(0); // the head lifts from the hunch to gaze
  });

  it('cruising wander drives the root target and blends the gait in', () => {
    const j = realJoints();
    // 0.67 s: past the 0.4 s blend ramp, but short of the arrival brake at
    // ~1.2 m from a 2 m target — the stride holds full amplitude throughout.
    const { state, frame } = run(j, cruising(3), CFG_ON, 40);
    expect(state.blend).toBeGreaterThan(0.95);
    expect(frame.blend).toBeGreaterThan(0.95);
    const pelvis = frame.restPose[j.index.pelvis]!;
    const base = j.base[j.index.pelvis]!;
    // Root translated along the travel heading (started at heading 0 → +z).
    const d = sub(pelvis, base);
    expect(len(d)).toBeGreaterThan(0.4);
    expect(dot(d, headingDir(frame.heading))).toBeGreaterThan(0.3);
    expect(frame.speed).toBeGreaterThan(0.5);
  });

  it('wander off freezes the root and fades the gait out', () => {
    const j = realJoints();
    const cfg: MotionConfig = { enabled: true, wander: false };
    const { state, frame } = run(j, cruising(5), cfg, 60);
    expect(state.blend).toBe(0);
    expect(frame.rootShift).toEqual([0, 0, 0]); // never left the start point
    expect(frame.speed).toBe(WANDER_TUNING.speed); // state untouched, not driven
  });

  it('locks stance feet to their plant while the root travels (no skate)', () => {
    const j = realJoints();
    let state = cruising(9);
    let points = stubPoints(j);
    let frame = stepMotion(state, j, CFG_ON, NO_SIGNALS(), points, BOUNDS, makeRng(9)).frame;
    let planted: Vec3 | null = null;
    let pelvisAtPlant: Vec3 | null = null;
    const plantFrames: Vec3[] = [];
    for (let i = 0; i < 600 && plantFrames.length < 25; i++) {
      points = frame.restPose.map(p => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: p, pinned: false }));
      const step = stepMotion(state, j, CFG_ON, NO_SIGNALS(), points, BOUNDS, makeRng(9));
      state = step.state;
      frame = step.frame;
      if (frame.stance.legL) {
        if (!planted) {
          planted = frame.restPose[j.index.footL]!;
          pelvisAtPlant = frame.restPose[j.index.pelvis]!;
        }
        plantFrames.push(frame.restPose[j.index.footL]!);
      } else if (planted) {
        break; // stance over — check what we collected
      }
    }
    expect(planted).not.toBeNull();
    expect(plantFrames.length).toBeGreaterThan(8);
    // Bit-identical plant across the whole stance window…
    for (const f of plantFrames) expect(f).toEqual(planted);
    // …while the root moved on by a stride's worth.
    const travel = len(sub(frame.restPose[j.index.pelvis]!, pelvisAtPlant!));
    expect(travel).toBeGreaterThan(0.15);
  });

  it('missing leg skips that side entirely (no plant, no offsets)', () => {
    const j = realJoints();
    const sig = (i: number): MotionSignals => ({
      ...NO_SIGNALS(),
      missing: { ...INTACT, legL: true },
      severed: i === 0 ? (['legL'] as LimbId[]) : [],
    });
    const { frame } = run(j, cruising(11), CFG_ON, 90, sig);
    expect(frame.stance.legL).toBe(false);
    expect(frame.hop).toBe(true);
    expect(frame.phase).toBe('standing'); // one leg is hop-limp, not collapse
  });
});

describe('stepMotion — hit reactions', () => {
  it('a pellet shot flinches the shoulders and flags staggered', () => {
    const j = realJoints();
    const shot = { type: 'pellet' as const, dirWorld: [0, 0, -1] as Vec3, woundWorld: [0.1, 1.2, 0.1] as Vec3, torso: false };
    const frame = stepMotion(makeMotionState(21, [0, 0, 0]), j, CFG_ON,
      { ...NO_SIGNALS(), shot }, stubPoints(j), BOUNDS, makeRng(1)).frame;
    expect(frame.staggerKind).toBe('flinch');
    // Shoulder targets displaced along the body-local shot dir (heading 0).
    const off = sub(frame.restPose[j.index.shoulderL]!, j.base[j.index.shoulderL]!);
    expect(off[2]).toBeLessThan(0);
    // …and an untouched state stays calm.
    const calm = stepMotion(makeMotionState(21, [0, 0, 0]), j, CFG_ON, NO_SIGNALS(), stubPoints(j), BOUNDS, makeRng(1));
    expect(calm.frame.staggerKind).toBeNull();
  });

  it('a blast lurches and its phaseKnock is baked into the gait clock', () => {
    const j = realJoints();
    const shot = { type: 'blast' as const, dirWorld: [0, 0, -1] as Vec3, woundWorld: [0.1, 1.2, 0.1] as Vec3, torso: true };
    const sig = (i: number): MotionSignals => ({ ...NO_SIGNALS(), shot: i === 0 ? shot : null });
    const { state, frame } = run(j, cruising(4), CFG_ON, 90, sig);
    expect(frame.staggerKind === null || frame.staggerKind === 'lurch').toBe(true);
    // The lurch's knock accumulated extra clock beyond wall time.
    expect(state.gait.time - 90 * DT).toBeGreaterThan(0.015);
  });

  it('torso blasts keep the normal lurch without adding a wound-reaching arm target', () => {
    const j = realJoints();
    const shot = { type: 'blast' as const, dirWorld: [0, 0, -1] as Vec3,
      woundWorld: [0.12, 1.25, 0.15] as Vec3, torso: true };
    const react = (torso: boolean) => run(j, makeMotionState(6, [0, 0, 0]), CFG_ON, 30,
      i => ({ ...NO_SIGNALS(), shot: i === 0 ? { ...shot, torso } : null }));
    const torsoHit = react(true), otherHit = react(false);
    expect(torsoHit.frame.restPose).toEqual(otherHit.frame.restPose);
    expect(torsoHit.frame.staggerKind).toBe('lurch');
  });
});

describe('stepMotion — head aim', () => {
  it('keeps the authored hunch looking ahead; swings and clamps behind', () => {
    const j = realJoints();
    // Wander OFF + an injected look target isolates the aim delta from any
    // root translation (the body must not walk while we measure its gaze).
    const cfg: MotionConfig = { enabled: true, wander: false };
    const st = makeMotionState(31, [0, 0, 0]);
    const ahead = run(j, st, cfg, 30).frame;
    expect(len(sub(ahead.restPose[j.index.head]!, j.base[j.index.head]!))).toBeLessThan(0.25);

    // Target behind (−z) with the gaze PINNED to it (gazeFollow 0): damped
    // + clamped — the head swings backward but stays within the clamp cone
    // of its rest direction (bounded offset).
    const st2 = makeMotionState(31, [0, 0, 0]);
    st2.wander = { pos: [0, 0, 0], heading: 0, speed: 0, target: [0, 1.5, -3], idle: 0 };
    const behind = run(j, st2, { ...cfg, gazeFollow: 0 }, 240).frame;
    const dh = sub(behind.restPose[j.index.head]!, j.base[j.index.head]!);
    expect(dh[2]).toBeLessThan(-0.05); // visibly swung backward
    expect(len(dh)).toBeLessThan(0.35); // but never past the clamp cone
  });

  /** World yaw of the head target's direction off the neck, in the heading
   *  convention (0 = +z, positive = clockwise from above). */
  const headYaw = (frame: ReturnType<typeof stepMotion>['frame'], j: MotionJoints): number => {
    const d = sub(frame.restPose[j.index.head]!, frame.restPose[j.index.neck]!);
    return Math.atan2(d[0], d[2]);
  };

  it('default gaze: the head yaw converges toward the heading (looks where it walks)', () => {
    const j = realJoints();
    // Body already mid-turn toward a +90° heading, no fixed target: the gaze
    // must chase the HEADING, not a point.
    const st = makeMotionState(41, [0, 0, 0]);
    st.wander = { pos: [0, 0, 0], heading: Math.PI / 2, speed: 0, target: null, idle: 0 };
    const cfg: MotionConfig = { enabled: true, wander: false };
    // Early: the body is still turned away, but the head already leads —
    // pulled to the heading side of the clamp cone.
    const early = run(j, st, cfg, 20);
    expect(early.frame.bodyYaw).toBeLessThan(Math.PI / 2 - 0.1);
    expect(headYaw(early.frame, j)).toBeGreaterThan(early.frame.bodyYaw + 0.1);
    // Late: body yaw and gaze have both converged on the heading.
    const late = run(j, st, cfg, 240);
    expect(Math.abs(late.frame.bodyYaw - Math.PI / 2)).toBeLessThan(0.05);
    expect(Math.abs(headYaw(late.frame, j) - Math.PI / 2)).toBeLessThan(0.2);
  });

  it('pinned-gaze tuning (gazeFollow 0): the gaze does NOT follow the turn', () => {
    const j = realJoints();
    // Same turn, fixed target dead ahead: at gain 0 the head stays locked on
    // the point (as the existing cone clamp allows) while the body yaw
    // leaves — the owner's creepy variant, reachable as a pure tuning. The
    // follow/pinned contract is what gets pinned here, not an exact angle:
    // the cone frame (anchored to the up-tilted rest gaze) drags a
    // world-fixed target off-axis as the body turns, which IS the variant's
    // uncanny character.
    const st = makeMotionState(43, [0, 0, 0]);
    st.wander = { pos: [0, 0, 0], heading: 0.3, speed: 0, target: [0, 1.5, 3], idle: 0 };
    const cfg: MotionConfig = { enabled: true, wander: false };
    const follow = run(j, st, cfg, 240);
    const pinned = run(j, st, { ...cfg, gazeFollow: 0 }, 240);
    expect(Math.abs(pinned.frame.bodyYaw - 0.3)).toBeLessThan(0.05); // the body turned
    expect(Math.abs(headYaw(follow.frame, j) - 0.3)).toBeLessThan(0.1); // follow tracks it
    expect(Math.abs(headYaw(pinned.frame, j) - 0.3)).toBeGreaterThan(0.2); // pinned does not
  });
});

describe('stepMotion — reach arm pivot (socketed shoulders)', () => {
  const CFG_REACH: MotionConfig = { enabled: true, wander: true }; // reach is the default style

  it('keeps both arm segments at rest length and puts the hands out front', () => {
    const j = realJoints();
    const { frame } = run(j, cruising(15), CFG_REACH, 120);
    const fwd = headingDir(frame.heading);
    for (const side of ['L', 'R'] as const) {
      const s = frame.restPose[j.index[`shoulder${side}`]!]!;
      const e = frame.restPose[j.index[`elbow${side}`]!]!;
      const h = frame.restPose[j.index[`hand${side}`]!]!;
      // The pivot holds each segment within the rigid bob/sway shift's reach
      // of its rest length (≤ ~0.043 m) — the additive reach this replaces
      // contracted the segments by ~0.10 m / ~0.08 m, which is what dragged
      // the shoulder ball out of the torso.
      expect(Math.abs(len(sub(e, s)) - j.arm[side][0])).toBeLessThan(0.05);
      expect(Math.abs(len(sub(h, e)) - j.arm[side][1])).toBeLessThan(0.05);
      // …and the chain points at the prey, not at the floor.
      expect(dot(sub(h, s), fwd)).toBeGreaterThan(0.2);
    }
  });

  it('the POSED shoulder ball stays socketed in the torso through the full reach cycle', () => {
    const j = realJoints();
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    // The shoulder ball (deltoid sphere — first arm-limb sphere prim) vs the
    // chest blob (first torso prim): the owner-visible seam. The additive
    // reach this replaces let their SURFACES separate by up to ~1.8 cm (the
    // contracted arm chain levered the shoulder point about the chest joint);
    // the pivot keeps them overlapping through the whole cycle.
    let ball = -1, chest = -1;
    body.prims.forEach((p, i) => {
      if (ball < 0 && p.limb === 'armL' && len(sub(p.a, p.b)) < 1e-4) ball = i;
      if (chest < 0 && p.limb === 'torso') chest = i;
    });
    expect(ball).toBeGreaterThanOrEqual(0);
    expect(chest).toBeGreaterThanOrEqual(0);
    let bound = bindRig(body);
    // Unpinned, exactly as the lab wiring walks (bindRig pins the lowest
    // joint as a statue anchor; the rest pull + plants carry a walker).
    bound = {
      ...bound,
      rig: { ...bound.rig, points: bound.rig.points.map(p => ({ ...p, pinned: false })) },
    };
    let state = cruising(21);
    let maxGap = -Infinity;
    for (let i = 0; i < 240; i++) { // 4 s — several full stride cycles, turns included
      const step = stepMotion(state, j, CFG_REACH, NO_SIGNALS(), bound.rig.points, BOUNDS, makeRng(21));
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
      maxGap = Math.max(maxGap, len(sub(b.a, c.a)) - b.radius - c.radius);
    }
    // Socketed = the surfaces keep overlapping (negative gap). 5 mm of grace
    // for the flesh-breathing jiggle; the detached pose was +18 mm.
    expect(maxGap).toBeLessThan(0.005);
  });
});

describe('stepMotion — collapse', () => {
  it('forced collapse: full gravity, rest pull ramps off, ropes appear, root freezes', () => {
    const j = realJoints();
    const sig = (i: number): MotionSignals => ({
      ...NO_SIGNALS(), forcedCollapse: i === 0,
    });
    const { state, frame } = run(j, cruising(8), CFG_ON, Math.ceil(0.4 / DT), sig);
    expect(state.collapse.phase).toBe('falling');
    expect(frame.collapsed).toBe(true);
    expect(frame.gravity).toEqual([0, MOTION_TUNING.collapseGravity, 0]);
    expect(frame.restPull).toBe(0); // past fallReleaseTime
    expect(frame.ropes.length).toBeGreaterThanOrEqual(6);
    // The root froze at the fall-start shift despite cruise input.
    const later = run(j, cruising(8), CFG_ON, Math.ceil(2.6 / DT), sig);
    const shiftAtFall = frame.rootShift;
    expect(later.frame.rootShift).toEqual(shiftAtFall);
    expect(later.frame.phase).toBe('settled');
  });

  it('sustained blast fire crosses the meter threshold and drops the body', () => {
    const j = realJoints();
    let state = makeMotionState(12, [0, 0, 0]);
    let points = stubPoints(j);
    let frame = { collapsed: false, meter: 0 } as ReturnType<typeof stepMotion>['frame'];
    for (let i = 0; i < 30 && !frame.collapsed; i++) {
      const step = stepMotion(state, j, CFG_ON,
        { ...NO_SIGNALS(), freshWounds: [blastWound()] }, points, BOUNDS, makeRng(2));
      state = step.state;
      frame = step.frame;
      points = frame.restPose.map(p => ({ pos: p, prev: p, pinned: false }));
    }
    // 7 blasts = 0.91 ≥ 0.8 threshold.
    expect(frame.meter).toBeGreaterThanOrEqual(COLLAPSE_TUNING.meterThreshold);
    expect(frame.collapsed).toBe(true);
  });

  it('both legs gone collapses instantly; meter+sever bookkeeping works', () => {
    const j = realJoints();
    const sig = (i: number): MotionSignals => ({
      ...NO_SIGNALS(),
      missing: { ...INTACT, legL: true, legR: true },
      severed: i === 0 ? (['legL', 'legR'] as LimbId[]) : [],
    });
    const { frame } = run(j, cruising(13), CFG_ON, 2, sig);
    expect(frame.phase).toBe('falling');
    expect(frame.hop).toBe(false);
  });

  it('a settled corpse keeps accumulating meter from fresh wounds', () => {
    const j = realJoints();
    const forced = (i: number): MotionSignals => ({ ...NO_SIGNALS(), forcedCollapse: i === 0 });
    const settled = run(j, makeMotionState(14, [0, 0, 0]), CFG_ON, Math.ceil(3 / DT), forced);
    expect(settled.frame.phase).toBe('settled');
    const more = stepMotion(settled.state, j, CFG_ON,
      { ...NO_SIGNALS(), freshWounds: [blastWound()] }, stubPoints(j), BOUNDS, makeRng(3));
    expect(more.frame.meter).toBeGreaterThan(settled.frame.meter);
    expect(more.frame.phase).toBe('settled');
  });
});

describe('planSubSteps (collapse-stall fix, X1.22.1)', () => {
  it('a normal 60 fps frame is exactly one step of exactly dt', () => {
    // The steady-state path must be bit-identical to the pre-fix single
    // step — the fix may not change tuned feel at full frame rate.
    expect(planSubSteps(1 / 60)).toEqual([1 / 60]);
    expect(planSubSteps(0.001)).toEqual([0.001]);
  });

  it('a frame at or under the old clamp ceiling stays a single step', () => {
    expect(planSubSteps(1 / 30)).toEqual([1 / 30]);
    // A hair over the ceiling splits into two equal steps, never one
    // over-ceiling step.
    const split = planSubSteps(1 / 30 * 1.5);
    expect(split.length).toBe(2);
    for (const s of split) expect(s).toBeLessThanOrEqual(SUBSTEP_TUNING.maxStep + 1e-12);
    expect(split.reduce((a, b) => a + b, 0)).toBeCloseTo(1 / 30 * 1.5, 12);
  });

  it('consumes real elapsed time instead of discarding it (no death spiral)', () => {
    // The old clamp advanced a 2 s frame by 33 ms — the fall crawled at
    // ~1.6% of wall clock. Sub-steps must consume the whole frame...
    const stalled = planSubSteps(0.25);
    expect(stalled.reduce((a, b) => a + b, 0)).toBeCloseTo(0.25, 12);
    for (const s of stalled) expect(s).toBeLessThanOrEqual(SUBSTEP_TUNING.maxStep + 1e-12);
  });

  it('bounds catch-up at maxCatchup so a long-hidden gap cannot burst', () => {
    const caught = planSubSteps(600); // 10 min hidden tab
    const total = caught.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(SUBSTEP_TUNING.maxCatchup, 12);
    for (const s of caught) expect(s).toBeLessThanOrEqual(SUBSTEP_TUNING.maxStep + 1e-12);
    // ...and the bound keeps the sub-step count (and thus the catch-up CPU)
    // small: 0.5 s at ≤1/30 per step is ≤15 steps.
    expect(caught.length).toBeLessThanOrEqual(16);
  });

  it('degenerate inputs produce no steps', () => {
    expect(planSubSteps(0)).toEqual([]);
    expect(planSubSteps(-5)).toEqual([]);
  });
});

describe('applyFloorContact', () => {
  const G = 0.06;

  it('clamps a falling point and reflects its implied velocity', () => {
    const out = applyFloorContact(
      [{ pos: [0.5, G - 0.02, 0.5], prev: [0.4, G + 0.05, 0.5], pinned: false }],
      G,
    )[0]!;
    expect(out.pos[1]).toBe(G);
    const vy = out.pos[1] - out.prev[1];
    expect(vy).toBeGreaterThan(0); // bouncing up
    expect(vy).toBeLessThan(0.07 * COLLAPSE_TUNING.groundRestitution + 1e-9);
    // Friction bled the horizontal velocity.
    expect(out.pos[0] - out.prev[0]).toBeCloseTo(0.1 * COLLAPSE_TUNING.groundFriction, 6);
  });

  it('kills micro-bounces into a rest and leaves airborne/pinned points alone', () => {
    const micro = applyFloorContact(
      [{ pos: [0, G - 0.001, 0], prev: [0, G + 0.0005, 0], pinned: false }], G,
    )[0]!;
    expect(micro.prev[1]).toBe(G); // zero implied vertical velocity
    const air = { pos: [0, 1, 0], prev: [0, 1.2, 0], pinned: false } as RigPoint;
    expect(applyFloorContact([air], G)[0]).toEqual(air);
    const pin = { pos: [0, G - 5, 0], prev: [0, G - 5, 0], pinned: true } as RigPoint;
    expect(applyFloorContact([pin], G)[0]).toEqual(pin);
  });
});

describe('soldier motion — profile, lean, carry', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 3.4 };

  it('forceSpeed drives the blend and the run weight without wander', () => {
    const j = soldierJoints();
    const { frame, state } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 120);
    expect(frame.blend).toBeCloseTo(1, 3);
    expect(state.runWeight).toBe(1);
    expect(frame.gaitName).toBe('run');
    const walk = run(j, makeMotionState(3, [0, 0, 0]), { ...CFG, forceSpeed: 1.0 }, 120);
    expect(walk.state.runWeight).toBe(0);
    expect(walk.frame.gaitName).toBe('march');
  });

  it('the run lean pitches the head forward of the hips by ~sin(12°)·height', () => {
    const j = soldierJoints();
    // headAlive false isolates the lean from the head aim: the soldier's
    // rest skull points straight UP (unlike the zombie's hunch), so the
    // horizon gaze drives the head to its 0.5 rad pitch clamp and would
    // swamp the lean measurement (the composition is additive — no ordering
    // or cone re-anchoring separates them). Cf. the idle-pose test above.
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 90,
      () => ({ ...NO_SIGNALS(), headAlive: false }));
    const hips = frame.restPose[j.index.hips]!, head = frame.restPose[j.index.head]!;
    const dz = head[2] - hips[2];
    const rise = head[1] - hips[1];
    const expected = Math.sin(RUN.torsoLean * Math.PI / 180) * Math.hypot(rise, dz);
    expect(dz).toBeGreaterThan(expected * 0.6);
    expect(dz).toBeLessThan(expected * 1.6);
  });

  it('carry: the left hand lands on the gun fore-end; no arm segment stretches', () => {
    const j = soldierJoints();
    const cfg: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 0, carryOverride: 'hip' };
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), cfg, 30);
    const P = frame.restPose;
    const right = rotateYaw([1, 0, 0], frame.bodyYaw);
    const gun = gunPoseFromArm(P[j.index.elbowR]!, P[j.index.handR]!, right, CARRIES.hip.gunPitch);
    const fore = gunPoint(gun, GUN_GRIP.foreHand);
    expect(len(sub(P[j.index.handL]!, fore))).toBeLessThan(0.02);
    for (const [s, e, h, lens] of [
      ['shoulderL', 'elbowL', 'handL', j.arm.L], ['shoulderR', 'elbowR', 'handR', j.arm.R],
    ] as const) {
      expect(len(sub(P[j.index[e]]!, P[j.index[s]]!))).toBeLessThan(lens[0] * 1.01);
      expect(len(sub(P[j.index[h]]!, P[j.index[e]]!))).toBeLessThan(lens[1] * 1.01);
    }
    expect(frame.gun).not.toBeNull();
    expect(len(sub(frame.gun!.root, gun.root))).toBeLessThan(1e-9);
  });

  it('hand tips and toes follow their parents', () => {
    const j = soldierJoints();
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 45);
    const P = frame.restPose;
    const restTip = sub(j.base[j.index.handTipR]!, j.base[j.index.handR]!);
    expect(len(sub(P[j.index.handTipR]!, P[j.index.handR]!))).toBeCloseTo(len(restTip), 6);
    const restToe = sub(j.base[j.index.toeL]!, j.base[j.index.footL]!);
    expect(len(sub(P[j.index.toeL]!, P[j.index.footL]!))).toBeCloseTo(len(restToe), 6);
  });

  it('the zombie with no profile is unchanged (pins cover the numbers; this covers the fields)', () => {
    const j = realJoints();
    const { frame, state } = run(j, makeMotionState(3, [0, 0, 0]), CFG_ON, 10);
    expect(frame.gun).toBeNull();
    expect(frame.gaitName).toBe('shamble');
    expect(state.runWeight).toBe(0);
  });
});

describe('one-frame pipeline with a stub rig (end-to-end)', () => {
  it('standing: the verlet rig tracks the moving targets and stays upright', () => {
    const j = realJoints();
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    let bound = bindRig(body);
    let state = cruising(77);
    for (let i = 0; i < 120; i++) {
      const step = stepMotion(state, j, CFG_ON, NO_SIGNALS(), bound.rig.points, BOUNDS, makeRng(77));
      state = step.state;
      bound = {
        ...bound,
        rig: {
          ...bound.rig,
          restPose: step.frame.restPose,
          points: stepRig(
            { ...bound.rig, restPose: step.frame.restPose }, DT,
            {
              gravity: step.frame.gravity, damping: 0.06, iterations: 4,
              restStiffness: STANDING_RIG.restStiffness * step.frame.restPull,
            },
          ).points,
        },
      };
    }
    const pelvis = bound.rig.points[j.index.pelvis]!;
    expect(pelvis.pos[1]).toBeGreaterThan(0.6); // still standing
    expect(pelvis.pos[1]).toBeLessThan(1.2);
    const moved = len(sub(pelvis.pos, j.base[j.index.pelvis]!));
    expect(moved).toBeGreaterThan(0.2); // and it walked
  });

  it('collapsed: the rig falls under gravity, hits the floor, and settles low', () => {
    const j = realJoints();
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    let bound = bindRig(body);
    let state = makeMotionState(78, [0, 0, 0]);
    const ground = j.groundY - MOTION_TUNING.floorPad;
    let phase = 'standing';
    for (let i = 0; i < 300; i++) {
      const sig: MotionSignals = { ...NO_SIGNALS(), forcedCollapse: i === 0 };
      const step = stepMotion(state, j, CFG_ON, sig, bound.rig.points, BOUNDS, makeRng(78));
      state = step.state;
      phase = step.frame.phase;
      let points = stepRig(
        { ...bound.rig, restPose: step.frame.restPose }, DT,
        {
          gravity: step.frame.gravity, damping: 0.06, iterations: 4,
          restStiffness: STANDING_RIG.restStiffness * step.frame.restPull,
        },
      ).points;
      if (step.frame.ropes.length) points = relaxRopeConstraints(points, step.frame.ropes);
      if (step.frame.collapsed) points = applyFloorContact(points, ground);
      bound = { ...bound, rig: { ...bound.rig, points } };
    }
    expect(phase).toBe('settled');
    const pelvis = bound.rig.points[j.index.pelvis]!;
    expect(pelvis.pos[1]).toBeLessThan(0.45); // down
    expect(pelvis.pos[1]).toBeGreaterThanOrEqual(ground - 1e-6); // on the floor
    // Constraint lengths survived the fall.
    const c = bound.rig.constraints[0]!;
    const d = len(sub(bound.rig.points[c.a]!.pos, bound.rig.points[c.b]!.pos));
    expect(Math.abs(d - c.rest)).toBeLessThan(0.05);
  });
});

describe('fire signal', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 3.4 };
  const fireAt = (n: number) => (i: number): MotionSignals => ({ ...NO_SIGNALS(), fire: i === n });

  it('switches to the hip carry for fireHoldSec, then releases to the run carry', () => {
    const j = soldierJoints();
    let state = makeMotionState(3, [0, 0, 0]);
    let points = stubPoints(j);
    const carries: string[] = [];
    for (let i = 0; i < 90; i++) {
      const s = stepMotion(state, j, CFG, fireAt(10)(i), points, BOUNDS, makeRng(1));
      state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      carries.push(s.frame.carry ?? '-');
    }
    expect(carries[9]).toBe('chest');
    expect(carries[10]).toBe('hip');
    expect(carries[10 + Math.round(FIRE.holdSec * 60) - 2]).toBe('hip');
    expect(carries[10 + Math.round(FIRE.holdSec * 60) + 2]).toBe('chest');
  });

  it('emits hand and shoulder kicks backward along body forward on the fire frame only', () => {
    const j = soldierJoints();
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 20, fireAt(19));
    const fwd = headingDir(frame.bodyYaw);
    expect(frame.kicks.map(k => k.joint).sort()).toEqual(['handL', 'handR', 'shoulderR']);
    for (const k of frame.kicks) expect(dot(k.delta, fwd)).toBeLessThan(0);
    const calm = run(j, makeMotionState(3, [0, 0, 0]), CFG, 20, fireAt(5));
    expect(calm.frame.kicks).toEqual([]);
  });

  it('cuts the stride while holding', () => {
    const j = soldierJoints();
    const lift = (fire: boolean) => {
      let best = 0;
      let state = makeMotionState(3, [0, 0, 0]); let points = stubPoints(j);
      for (let i = 0; i < 46; i++) {
        const s = stepMotion(state, j, CFG, { ...NO_SIGNALS(), fire: fire && i === 0 }, points, BOUNDS, makeRng(1));
        state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
        // The measured swing must sit INSIDE the hold (strideFreq-timing,
        // not frame counts — the motion-polish lesson). At the run clip's
        // 1.5 Hz (40-frame cycle) the first full-amplitude footL swing is
        // frames ~15-43 (blend full by 24, peak 28), fully inside the
        // 51-frame hold; the old i>30/60-frame window was tuned to the
        // pre-curve 2.4 Hz and caught the hold's expiry instead.
        if (i > 14) best = Math.max(best, s.frame.restPose[j.index.footL]![1] - j.groundY);
      }
      return best;
    };
    expect(lift(true)).toBeLessThan(lift(false) * 0.6);
  });
});

describe('soldier walks on the clip curves', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 1.0 };
  it('a march step lifts the knee well forward of the hip→ankle line', () => {
    const j = soldierJoints();
    let state = makeMotionState(3, [0, 0, 0]); let points = stubPoints(j);
    let best = 0;
    for (let i = 0; i < 120; i++) {
      const s = stepMotion(state, j, CFG, NO_SIGNALS(), points, BOUNDS, makeRng(1));
      state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      const P = s.frame.restPose;
      const hip = P[j.index.hipL]!, knee = P[j.index.kneeL]!, foot = P[j.index.footL]!;
      const d = normalize(sub(foot, hip)); const v = sub(knee, hip);
      const along = dot(d, v);
      best = Math.max(best, len(sub(v, [d[0] * along, d[1] * along, d[2] * along])));
    }
    expect(best).toBeGreaterThan(0.06);
    expect(state.runWeight).toBe(0);
  });
  it('MARCH and RUN carry the curves and their frequencies', () => {
    expect(MARCH.curves?.name).toBe('soldier-walk');
    expect(RUN.curves?.name).toBe('soldier-run');
    expect(MARCH.strideFreq).toBeCloseTo(MARCH.curves!.freq, 9);
    expect(RUN.strideFreq).toBeCloseTo(RUN.curves!.freq, 9);
  });
});
