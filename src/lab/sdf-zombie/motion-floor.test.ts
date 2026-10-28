// src/lab/sdf-zombie/motion-floor.test.ts
//
// Bodies stand on the floor under them (sector levels 3a, Task 4): MotionState.floorY eases toward
// cfg.floorAt(x, z) at FLOOR_EASE_MPS and lifts the root shift and every world-plane use of
// joints.groundY. With NO floorAt, a frame is exactly what it was before floorY existed: the
// recorded digests below match motion.ts before the change (pinned at 1e-7 since 2026-10-27, -0 included).
import { describe, it, expect } from 'vitest';
import {
  applyFloorContact, FALL_DROP_M, FALL_GRAVITY, FLOOR_EASE_MPS, makeMotionJoints, makeMotionState, MOTION_TUNING, stepMotion,
  type MotionConfig, type MotionFrame, type MotionJoints, type MotionSignals, type MotionState,
} from './motion';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { bindRig } from './rig-bind';
import type { RigPoint } from './rig';
import { makeRng, WANDER_TUNING, type WanderBounds } from './wander';
import type { Vec3 } from './types';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import soldierSrc from './characters/soldier.blob?raw';
import houndSrc from './characters/gorehound.blob?raw';
import { GOREHOUND_PROFILE, SOLDIER_PROFILE } from './motion-profile';

const DT = 1 / 60;
const BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };

function zombieJoints(): MotionJoints {
  const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
  return makeMotionJoints(body, bindRig(body).rig.restPose)!;
}

function soldierJoints(): MotionJoints {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  return makeMotionJoints(body, bindRig(body).rig.restPose)!;
}

function houndJoints(): MotionJoints {
  const body = buildBody(compileBlob(parseBlob(houndSrc)));
  return makeMotionJoints(body, bindRig(body).rig.restPose)!;
}

const SIG = (over: Partial<MotionSignals> = {}): MotionSignals => ({
  dt: DT,
  shot: null,
  fire: false,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
  ...over,
});

function cruising(seed: number, y = 0): MotionState {
  const st = makeMotionState(seed, [0, y, 0]);
  st.wander = { pos: [0, y, 0], heading: 0, speed: WANDER_TUNING.speed, target: [1.4, 0, 1.4], idle: 0 };
  return st;
}

/** Steps n frames against a stub rig that tracks the previous targets; `lift` raises the stub's
 *  starting points (a body spawned standing on a floor at that height). Every frame is collected. */
function run(
  joints: MotionJoints, state0: MotionState, cfg: MotionConfig | ((i: number) => MotionConfig), n: number,
  sig: (i: number) => MotionSignals = () => SIG(), lift = 0,
): { state: MotionState; frames: MotionFrame[]; states: MotionState[] } {
  let state = state0;
  let points: RigPoint[] = joints.base.map(p => ({
    pos: [p[0], p[1] + lift, p[2]] as Vec3, prev: [p[0], p[1] + lift, p[2]] as Vec3, pinned: false }));
  const frames: MotionFrame[] = [];
  const states: MotionState[] = [];
  for (let i = 0; i < n; i++) {
    const c = typeof cfg === 'function' ? cfg(i) : cfg;
    const step = stepMotion(state, joints, c, sig(i), points, BOUNDS, makeRng(42 + i));
    state = step.state;
    frames.push(step.frame);
    states.push(state);
    const prev = points;
    points = step.frame.restPose.map((p, k) => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: prev[k]!.pos, pinned: false }));
  }
  return { state, frames, states };
}

/** FNV-1a over a -0-preserving serialization of every number a frame hands the wiring, each rounded to
 *  1e-7 m: macOS and CI's Linux differ in the last bits of a few libm results, so a full-precision digest
 *  pinned on one machine failed on the other. 1e-7 is far finer than any floor/lift bug this guards. */
function digest(frames: readonly MotionFrame[], states: readonly MotionState[]): string {
  const num = (v: number) => (Object.is(v, -0) ? '-0' : v.toFixed(7));
  const parts: string[] = [];
  frames.forEach((f, i) => {
    parts.push(num(f.floorY), ...f.rootShift.map(num), num(f.bodyYaw), num(f.restPull), f.phase);
    for (const p of f.restPose) parts.push(...p.map(num));
    parts.push(...f.gravity.map(num));
    const s = states[i]!;
    parts.push(...s.wander.pos.map(num), ...s.plantL.plantPoint.map(num), ...s.plantR.plantPoint.map(num));
    if (s.footwork) for (const p of s.footwork.feet) parts.push(...p.map(num));
  });
  const str = parts.join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${str.length}`;
}

describe('no floorAt: frames are exactly the frames before floorY existed', () => {
  it('a walking zombie, shot mid-walk, then collapsed', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), { enabled: true, wander: true }, 240, i => SIG({
      ...(i === 60 ? { shot: { type: 'blast', dirWorld: [1, 0, 0], woundWorld: [0, 1.2, 0], torso: true } } : {}),
      forcedCollapse: i >= 150,
    }));
    expect(digest(r.frames, r.states)).toBe(RECORDED.zombie);
  });

  it('a soldier on footwork, aimed across his travel, then downed', () => {
    const j = soldierJoints();
    const r = run(j, cruising(11), i => ({ enabled: true, wander: true, profile: SOLDIER_PROFILE,
      ...(i > 40 ? { faceHeading: 1.2 } : {}) }), 240, i => SIG({ downed: i >= 170, fatal: i >= 170 }));
    expect(digest(r.frames, r.states)).toBe(RECORDED.soldier);
  });

  it('carries no floorVel (the ledge fall is sector-level state only)', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), { enabled: true, wander: true }, 30);
    for (const s of r.states) expect('floorVel' in s).toBe(false);
  });
});

const RECORDED = {
  zombie: '5f646a5a:182431',
  soldier: 'bde1cc7d:237075',
};

describe('floorAt: the body stands on the floor under it', () => {
  it('eases a zombie up onto a floor at 1 m and lifts the root, the wander and the contact plane', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), { enabled: true, wander: true, floorAt: () => 1 }, 120);
    expect(r.states[0]!.floorY).toBeLessThanOrEqual(0.1 + 1e-12);
    expect(r.states[0]!.floorY).toBeGreaterThan(0);
    expect(r.state.floorY).toBe(1);
    const last = r.frames[r.frames.length - 1]!;
    expect(last.rootShift[1]).toBe(1);
    expect(r.state.wander.pos[1]).toBe(1);
    const flat = run(j, cruising(7), { enabled: true, wander: true }, 120);
    expect(last.floorY).toBeCloseTo(flat.frames[flat.frames.length - 1]!.floorY + 1, 12);
  });

  it('rises at no more than FLOOR_EASE_MPS when the floor steps from 0 to 0.5 mid-walk', () => {
    expect(FLOOR_EASE_MPS).toBe(6);
    const j = zombieJoints();
    let calls = 0;
    const floorAt = () => (calls++ < 30 ? 0 : 0.5);
    const r = run(j, cruising(7), { enabled: true, wander: true, floorAt }, 90);
    let prev = 0;
    for (const s of r.states) {
      expect(s.floorY - prev).toBeLessThanOrEqual(FLOOR_EASE_MPS * DT + 1e-12);
      expect(s.floorY).toBeGreaterThanOrEqual(prev);
      prev = s.floorY;
    }
    expect(r.states[29]!.floorY).toBe(0);
    expect(r.state.floorY).toBe(0.5);
  });

  it('keeps the previous floor when floorAt answers NaN (off the map)', () => {
    const j = zombieJoints();
    let calls = 0;
    const floorAt = () => (calls++ < 40 ? 0.3 : NaN);
    const r = run(j, cruising(7), { enabled: true, wander: true, floorAt }, 80);
    expect(r.states[39]!.floorY).toBe(0.3);
    expect(r.state.floorY).toBe(0.3);
    expect(r.state.wander.pos[1]).toBe(0.3);
  });

  it('starts on the floor it spawned on (makeMotionState start y)', () => {
    expect(makeMotionState(1, [2, 0.75, -1]).floorY).toBe(0.75);
    expect(makeMotionState(1, [2, 0.75, -1]).wander.pos).toEqual([2, 0.75, -1]);
    expect(makeMotionState(1, [2, 0, -1]).floorY).toBe(0);
  });

  // The whole frame is the flat frame lifted: if any world-plane use of groundY were missed (a
  // plant, the footwork's feet, the paws, the contact plane), its points would stay on y = 0.
  const lifted = (name: string, joints: () => MotionJoints, cfg: MotionConfig, n: number,
    sig: (i: number) => MotionSignals = () => SIG()) => it(name, () => {
    const j = joints();
    const flat = run(j, cruising(5), cfg, n, sig);
    const up = run(j, cruising(5, 1.5), { ...cfg, floorAt: () => 1.5 }, n, sig, 1.5);
    up.frames.forEach((f, i) => {
      const g = flat.frames[i]!;
      expect(f.floorY).toBeCloseTo(g.floorY + 1.5, 9);
      expect(f.rootShift[1]).toBeCloseTo(g.rootShift[1] + 1.5, 9);
      f.restPose.forEach((p, k) => {
        const q = g.restPose[k]!;
        expect(p[0]).toBeCloseTo(q[0], 6);
        expect(p[1]).toBeCloseTo(q[1] + 1.5, 6);
        expect(p[2]).toBeCloseTo(q[2], 6);
      });
      const s = up.states[i]!, t = flat.states[i]!;
      if (t.plantL.phase === 'stance') expect(s.plantL.plantPoint[1]).toBeCloseTo(t.plantL.plantPoint[1] + 1.5, 9);
      for (const k of ['plantHandL', 'plantHandR'] as const)
        if (t[k]?.phase === 'stance') expect(s[k]!.plantPoint[1]).toBeCloseTo(t[k]!.plantPoint[1] + 1.5, 9);
      if (t.footwork) s.footwork!.feet.forEach((p, k) => expect(p[1]).toBeCloseTo(t.footwork!.feet[k]![1] + 1.5, 9));
    });
  });
  lifted('a walking zombie on a 1.5 m floor is the flat walk lifted 1.5 m', zombieJoints,
    { enabled: true, wander: true }, 150);
  lifted('a walking soldier (footwork) on a 1.5 m floor is the flat walk lifted 1.5 m', soldierJoints,
    { enabled: true, wander: true, profile: SOLDIER_PROFILE }, 150);
  lifted('a walking gorehound (front paw plants) on a 1.5 m floor is the flat walk lifted 1.5 m', houndJoints,
    { enabled: true, wander: true, profile: GOREHOUND_PROFILE }, 150);
  lifted('a downed soldier falls onto the 1.5 m floor, not through it', soldierJoints,
    { enabled: true, wander: true, profile: SOLDIER_PROFILE }, 120, i => SIG({ downed: i >= 30, fatal: i >= 30 }));

  it('the collapse contact plane sits on the floor under the body', () => {
    const j = zombieJoints();
    const r = run(j, cruising(3, 1), { enabled: true, wander: true, floorAt: () => 1 }, 30,
      () => SIG({ forcedCollapse: true }), 1);
    expect(r.frames[29]!.floorY).toBeCloseTo(j.groundY - MOTION_TUNING.floorPad + 1, 12);
  });
});

// Plan 3b Task 6: a drop over FALL_DROP_M falls under gravity; a step down still eases.
describe('floorAt: bodies fall off ledges', () => {
  it('falls 3 m under gravity, not at the ease rate, and lands with floorVel 0', () => {
    expect(FALL_DROP_M).toBe(0.75);
    expect(FALL_GRAVITY).toBe(9.81);
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, floorAt: () => (i < 60 ? 0 : -3) }), 120);
    expect(r.states[59]!.floorY).toBe(0);
    // 0.2 s into the fall: free fall has dropped ½·9.81·0.2² ≈ 0.2 m (easing would have done 1.2 m).
    const at02 = r.states[59 + 12]!;
    expect(-at02.floorY).toBeLessThan(0.3);
    expect(-at02.floorY).toBeGreaterThan(0.15);
    expect(at02.floorVel).toBeLessThan(0);
    // Monotonic, never below the floor it lands on.
    let prev = 0;
    for (const s of r.states.slice(60)) {
      expect(s.floorY).toBeLessThanOrEqual(prev);
      expect(s.floorY).toBeGreaterThanOrEqual(-3);
      prev = s.floorY;
    }
    // A 3 m free fall takes 0.78 s: landed by 0.9 s, at rest.
    const at09 = r.states[59 + 54]!;
    expect(at09.floorY).toBe(-3);
    expect(at09.floorVel).toBe(0);
    expect(r.state.floorY).toBe(-3);
    expect(r.state.wander.pos[1]).toBe(-3);
    expect(r.frames[r.frames.length - 1]!.rootShift[1]).toBe(-3);
  });

  it('a step down (0.5 m) still eases at FLOOR_EASE_MPS with floorVel 0', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, floorAt: () => (i < 30 ? 0 : -0.5) }), 90);
    let prev = 0;
    for (const s of r.states) {
      expect(prev - s.floorY).toBeLessThanOrEqual(FLOOR_EASE_MPS * DT + 1e-12);
      expect(s.floorY).toBeLessThanOrEqual(prev);
      expect(s.floorVel).toBe(0);
      prev = s.floorY;
    }
    expect(r.state.floorY).toBe(-0.5);
  });
});

// Review fixes 3 and 4: the feet leave a ledge with the body; a mid-fall floor above the feet never
// snaps the body up; a rise over maxStepUp is a wall, not a step.
describe('floorAt: falling and step caps', () => {
  it('holds no stance plant while falling and plants again after landing', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, floorAt: () => (i < 60 ? 0 : -3) }), 160);
    const falling = r.states.filter(s => (s.floorVel ?? 0) < 0);
    expect(falling.length).toBeGreaterThan(30);
    for (const s of falling) {
      expect(s.plantL.phase).not.toBe('stance');
      expect(s.plantR.phase).not.toBe('stance');
    }
    expect(r.states.slice(-40).some(s => s.plantL.phase === 'stance' || s.plantR.phase === 'stance')).toBe(true);
  });

  it('mid-fall, a floor above the feet ends the fall where it is (no snap up)', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, maxStepUp: 0.75,
      floorAt: () => (i < 10 ? 0 : i < 40 ? -3 : 0) }), 70);
    expect(r.states[39]!.floorY).toBeLessThan(-0.75);
    expect(r.states[39]!.floorVel).toBeLessThan(0);
    // The floor jumped back to 0, more than maxStepUp above the feet: the body holds its height.
    expect(r.states[40]!.floorY).toBe(r.states[39]!.floorY);
    expect(r.states[40]!.floorVel).toBe(0);
    expect(r.state.floorY).toBe(r.states[39]!.floorY);
  });

  it('mid-fall, a floor within maxStepUp above the feet is eased up onto', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, maxStepUp: 0.75,
      floorAt: () => (i < 10 ? 0 : i < 28 ? -3 : -0.2) }), 60);
    const at = r.states[27]!.floorY;
    expect(at).toBeLessThan(-0.2);
    expect(at).toBeGreaterThan(-0.95);
    expect(r.states[28]!.floorY - at).toBeLessThanOrEqual(FLOOR_EASE_MPS * DT + 1e-12);
    expect(r.state.floorY).toBe(-0.2);
  });

  it('maxStepUp: a rise above it keeps the current floor; one within it eases up; absent, no cap', () => {
    const j = zombieJoints();
    const cfg = (y: number, cap?: number) => ({ enabled: true, wander: true, floorAt: () => y,
      ...(cap === undefined ? {} : { maxStepUp: cap }) });
    expect(run(j, cruising(7), cfg(1, 0.75), 60).state.floorY).toBe(0);
    expect(run(j, cruising(7), cfg(0.5, 0.75), 60).state.floorY).toBe(0.5);
    expect(run(j, cruising(7), cfg(1), 60).state.floorY).toBe(1);
  });
});

describe('floorAt: a falling body never hovers', () => {
  it('mid-fall, a lip above a step from the feet is no landing: it falls on to fallFloorAt', () => {
    const j = zombieJoints();
    const r = run(j, cruising(7), i => ({ enabled: true, wander: true, maxStepUp: 0.75,
      fallFloorAt: () => -3, floorAt: () => (i < 10 ? 0 : i < 40 ? -3 : 0) }), 100);
    expect(r.states[39]!.floorY).toBeLessThan(-0.75);
    const landed = r.states.findIndex(s => s.floorY === -3);
    expect(landed).toBeGreaterThan(40);
    expect(landed).toBeLessThanOrEqual(10 + 48);
    r.states.slice(10, landed).forEach(s => expect(s.floorVel).toBeLessThan(0));
    expect(r.state.floorY).toBe(-3);
    expect(r.state.floorVel).toBe(0);
  });

  it('a soldier on footwork takes his feet with him off the ledge', () => {
    const j = soldierJoints();
    const r = run(j, cruising(11), i => ({ enabled: true, wander: true, profile: SOLDIER_PROFILE,
      floorAt: () => (i < 60 ? 0 : -3) }), 140);
    for (const s of r.states.slice(60)) {
      expect(s.footwork).toBeDefined();
      for (const p of s.footwork!.feet) expect(p[1] - s.floorY).toBeLessThan(0.3);
    }
    for (const p of r.state.footwork!.feet) expect(p[1]).toBeCloseTo(-3 + j.groundY, 1);
  });
});

describe('applyFloorContact: the floor under each point', () => {
  const pts = (): RigPoint[] => [
    { pos: [0.5, -0.5, 0], prev: [0.5, -0.45, 0], pinned: false },
    { pos: [-0.5, 0.05, 0], prev: [-0.5, 0.1, 0], pinned: false },
  ];
  it('keeps a point above its own (lower) floor and lifts one below its floor', () => {
    const out = applyFloorContact(pts(), 0.1, undefined, undefined, x => (x > 0 ? -0.9 : 0.1));
    expect(out[0]).toEqual(pts()[0]);
    expect(out[1]!.pos[1]).toBe(0.1);
  });
  it('with no floorAt, is the one-plane call', () => {
    const a = applyFloorContact(pts(), 0.1);
    expect(applyFloorContact(pts(), 0.1, undefined, undefined, undefined)).toEqual(a);
    expect(a[0]!.pos[1]).toBe(0.1);
    expect(a[1]!.pos[1]).toBe(0.1);
  });
});
