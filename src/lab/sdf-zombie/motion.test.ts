// src/lab/sdf-zombie/motion.test.ts
//
// Unit tests for the motion orchestrator (task 4's pure seam). Everything
// runs against the REAL zombie body's joint layout where it matters (so the
// gait↔bindRig ordering contract is pinned), and against stub rig points for
// the per-frame pipeline — stepMotion never touches the renderer.
import { describe, it, expect } from 'vitest';
import {
  applyFloorContact, makeMotionJoints, makeMotionState, MOTION_TUNING,
  planSubSteps, STANDING_RIG, stepMotion, SUBSTEP_TUNING,
  type MotionConfig, type MotionJoints, type MotionSignals, type MotionState,
} from './motion';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { bindRig } from './rig-bind';
import { stepRig, type RigPoint } from './rig';
import { relaxRopeConstraints, COLLAPSE_TUNING } from './collapse';
import { makeRng, WANDER_TUNING, headingDir, type WanderBounds } from './wander';
import { IK_TUNING } from './ik';
import { len, sub, dot } from './vec';
import type { LimbId, Vec3 } from './types';
import type { Wound } from './damage';

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

describe('stepMotion — stagger + clutch', () => {
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

  it('a torso blast triggers the wound clutch on the nearest surviving arm', () => {
    const j = realJoints();
    const woundWorld: Vec3 = [0.12, 1.25, 0.15];
    const shot = { type: 'blast' as const, dirWorld: [0, 0, -1] as Vec3, woundWorld, torso: true };
    const { frame } = run(j, makeMotionState(6, [0, 0, 0]), CFG_ON, 1,
      () => ({ ...NO_SIGNALS(), shot }));
    expect(frame.clutchArm).not.toBeNull();
    const handIdx = frame.clutchArm === 'armL' ? j.index.handL : j.index.handR;
    const idle = run(j, makeMotionState(6, [0, 0, 0]), CFG_ON, 1).frame.restPose;
    const dClutch = len(sub(frame.restPose[handIdx]!, woundWorld));
    const dIdle = len(sub(idle[handIdx]!, woundWorld));
    expect(dClutch).toBeLessThan(dIdle - 0.05);
  });

  it('pellets and non-torso blasts never clutch; a later hit interrupts one', () => {
    const j = realJoints();
    const blast = (torso: boolean) => ({
      type: 'blast' as const, dirWorld: [0, 0, -1] as Vec3,
      woundWorld: [0.12, 1.25, 0.15] as Vec3, torso,
    });
    // Non-torso blast: no clutch.
    expect(run(j, makeMotionState(6, [0, 0, 0]), CFG_ON, 1, () => ({ ...NO_SIGNALS(), shot: blast(false) }))
      .frame.clutchArm).toBeNull();
    // Pellet: no clutch.
    expect(run(j, makeMotionState(6, [0, 0, 0]), CFG_ON, 1,
      () => ({ ...NO_SIGNALS(), shot: { ...blast(true), type: 'pellet' as const } }))
      .frame.clutchArm).toBeNull();
    // Torso blast clutches and survives its OWN lurch (started together)…
    const st = makeMotionState(6, [0, 0, 0]);
    const clutching = stepMotion(st, j, CFG_ON, { ...NO_SIGNALS(), shot: blast(true) }, stubPoints(j), BOUNDS, makeRng(1));
    expect(clutching.frame.clutchArm).not.toBeNull();
    const holding = stepMotion(clutching.state, j, CFG_ON, NO_SIGNALS(), stubPoints(j), BOUNDS, makeRng(1));
    expect(holding.frame.clutchArm).not.toBeNull();
    // …but a second blast a beat later knocks the arm off the wound.
    const knocked = stepMotion(holding.state, j, CFG_ON,
      { ...NO_SIGNALS(), shot: blast(true) }, stubPoints(j), BOUNDS, makeRng(1));
    expect(knocked.frame.clutchArm).toBeNull();
  });

  it('the clutch releases after its beat', () => {
    const j = realJoints();
    const shot = { type: 'blast' as const, dirWorld: [0, 0, -1] as Vec3, woundWorld: [0.12, 1.25, 0.15] as Vec3, torso: true };
    const { frame } = run(j, makeMotionState(6, [0, 0, 0]), CFG_ON,
      Math.ceil(IK_TUNING.clutchBeat / DT) + 5,
      (i) => ({ ...NO_SIGNALS(), shot: i === 0 ? shot : null }));
    expect(frame.clutchArm).toBeNull();
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

    // Target behind (−z): damped + clamped — the head swings backward but
    // stays within the clamp cone of its rest direction (bounded offset).
    const st2 = makeMotionState(31, [0, 0, 0]);
    st2.wander = { pos: [0, 0, 0], heading: 0, speed: 0, target: [0, 1.5, -3], idle: 0 };
    const behind = run(j, st2, cfg, 240).frame;
    const dh = sub(behind.restPose[j.index.head]!, j.base[j.index.head]!);
    expect(dh[2]).toBeLessThan(-0.05); // visibly swung backward
    expect(len(dh)).toBeLessThan(0.35); // but never past the clamp cone
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
