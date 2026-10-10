// src/lab/sdf-zombie/rig.test.ts
import { describe, it, expect } from 'vitest';
import { stepRig, makeRig, type RigState } from './rig';
import { len, sub } from './vec';

const OPTS = { gravity: [0, 0, 0] as const, damping: 0.02, iterations: 4, restStiffness: 0 };

const twoPoint = (): RigState => makeRig(
  [{ pos: [0, 1, 0], pinned: true }, { pos: [0, 0.6, 0], pinned: false }],
  [{ a: 0, b: 1, rest: 0.4, stiffness: 1 }],
);

describe('stepRig', () => {
  it('holds animated contacts exactly and releases them without spring velocity', () => {
    let s = twoPoint();
    s = { ...s, posePins: [1], restPose: [[0, 1, 0], [0, .55, .1]] };
    s = stepRig(s, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], restStiffness: .18 });
    expect(s.points[1]!.pos).toEqual([0, .55, .1]);
    expect(s.points[1]!.prev).toEqual(s.points[1]!.pos);
    expect(s.points[1]!.pinned).toBe(false);
    s = stepRig({ ...s, posePins: undefined, constraints: [] }, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0] });
    expect(s.points[1]!.pos[1]).toBeLessThan(.55);
    expect(s.points[1]!.pos[2]).toBe(.1);
  });

  it('holds a constraint already at rest length', () => {
    let s = twoPoint();
    for (let i = 0; i < 30; i++) s = stepRig(s, 1 / 60, OPTS);
    expect(len(sub(s.points[1]!.pos, s.points[0]!.pos))).toBeCloseTo(0.4, 4);
  });

  it('pulls a displaced point back toward rest length', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [0, 0.1, 0], prev: [0, 0.1, 0] } : p) };
    const before = len(sub(s.points[1]!.pos, s.points[0]!.pos));
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, iterations: 6 });
    const after = len(sub(s.points[1]!.pos, s.points[0]!.pos));
    expect(Math.abs(after - 0.4)).toBeLessThan(Math.abs(before - 0.4));
    expect(after).toBeCloseTo(0.4, 2);
  });

  it('never moves a pinned point', () => {
    let s = twoPoint();
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0] });
    expect(s.points[0]!.pos).toEqual([0, 1, 0]);
  });

  it('stays finite under an extreme impulse', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [1e4, -1e4, 1e4] } : p) };
    for (let i = 0; i < 120; i++) s = stepRig(s, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], iterations: 6 });
    for (const v of s.points[1]!.pos) expect(Number.isFinite(v)).toBe(true);
  });

  it('damps motion toward rest instead of oscillating forever', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, prev: [0, 0.9, 0] } : p) };
    let maxLate = 0;
    for (let i = 0; i < 400; i++) {
      s = stepRig(s, 1 / 60, { ...OPTS, damping: 0.08, iterations: 6 });
      if (i > 300) maxLate = Math.max(maxLate, Math.abs(len(sub(s.points[1]!.pos, s.points[0]!.pos)) - 0.4));
    }
    expect(maxLate).toBeLessThan(0.01);
  });

  // Rest-pose pull — borrowed from goober-test's Rope. Without it, gravity
  // drags the chain away and it never recovers the authored silhouette.
  it('returns to the rest pose under sustained gravity when restStiffness > 0', () => {
    let floppy = twoPoint(), springy = twoPoint();
    for (let i = 0; i < 240; i++) {
      floppy = stepRig(floppy, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], restStiffness: 0 });
      springy = stepRig(springy, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], restStiffness: 0.25 });
    }
    const restPos = twoPoint().points[1]!.pos;
    const floppyErr = len(sub(floppy.points[1]!.pos, restPos));
    const springyErr = len(sub(springy.points[1]!.pos, restPos));
    expect(springyErr).toBeLessThan(floppyErr);
    expect(springyErr).toBeLessThan(0.05);
  });

  it('still allows a transient stretch before springing back', () => {
    let s = twoPoint();
    const restPos = twoPoint().points[1]!.pos;
    // Yank the free point sideways, then let go.
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [0.9, 0.6, 0] } : p) };
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.15 });
      peak = Math.max(peak, len(sub(s.points[1]!.pos, restPos)));
    }
    expect(peak).toBeGreaterThan(0.1);               // it did stretch
    for (let i = 0; i < 300; i++) s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.15 });
    expect(len(sub(s.points[1]!.pos, restPos))).toBeLessThan(0.02); // and came home
  });
});

describe('head keep-out', () => {
  // A vertical head axis (pivot 0 at the neck, tip 1 above it) and a two-point
  // arm segment (2: elbow, 3: hand) beside it.
  const rig = (hand: [number, number, number], pinnedHand = false): RigState => {
    const s = makeRig(
      [
        { pos: [0, 1.5, 0], pinned: true }, { pos: [0, 1.65, 0], pinned: true },
        { pos: [0.4, 1.2, 0], pinned: false }, { pos: hand, pinned: pinnedHand },
      ],
      [{ a: 2, b: 3, rest: 0.4, stiffness: 1 }],
    );
    return { ...s, headKeepOut: { pivot: 0, tip: 1, t0: 0.05, t1: 0.1, radius: 0.12,
      limbs: [{ a: 2, b: 3, clearance: 0.18 }] } };
  };
  const axisDist = (s: RigState): number => {
    // distance of the hand to the head axis segment (x/z plane is enough here)
    const p = s.points[3]!.pos;
    const y = Math.min(1.6, Math.max(1.55, p[1]));
    return Math.hypot(p[0], p[1] - y, p[2]);
  };

  it('a hand dragged into the head by its rest target is held outside it', () => {
    // restPose for the hand is INSIDE the head: the rest pull wants it there.
    let s = rig([0.4, 1.6, 0]);
    s = { ...s, restPose: [s.restPose[0]!, s.restPose[1]!, s.restPose[2]!, [0, 1.6, 0]] };
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.3 });
    expect(axisDist(s)).toBeGreaterThan(0.18 - 0.02);
  });

  it('does nothing to a limb that is already clear', () => {
    // 0.4 m from the elbow (the constraint's rest length) and clear of the head.
    const s0 = rig([0.4, 1.6, 0]);
    const s1 = stepRig(s0, 1 / 60, OPTS);
    expect(s1.points[3]!.pos).toEqual(s0.points[3]!.pos);
    expect(s1.points[2]!.pos).toEqual(s0.points[2]!.pos);
  });

  it('never moves a pinned point and does not move the head', () => {
    const s0 = rig([0.05, 1.6, 0], true);
    const s1 = stepRig(s0, 1 / 60, OPTS);
    expect(s1.points[3]!.pos).toEqual([0.05, 1.6, 0]);
    expect(s1.points[0]!.pos).toEqual(s0.points[0]!.pos);
    expect(s1.points[1]!.pos).toEqual(s0.points[1]!.pos);
  });

  it('pushes out of a limb that crosses the axis exactly (no normal) without NaN', () => {
    const s0 = rig([0, 1.6, 0]);
    const s1 = stepRig(s0, 1 / 60, OPTS);
    for (const p of s1.points) expect(p.pos.every(Number.isFinite)).toBe(true);
  });
});

describe('torso guard spheres', () => {
  // A trunk point (0, centred at the origin), a shoulder (1) and an elbow (2) that
  // hangs beside it. The guard sphere sits on point 0 with a 0.2 m reach.
  const rig = (elbow: [number, number, number]): RigState => {
    const s = makeRig(
      [{ pos: [0, 1.3, 0], pinned: true }, { pos: [0.3, 1.4, 0], pinned: false }, { pos: elbow, pinned: false }],
      [{ a: 1, b: 2, rest: 0.3, stiffness: 1 }],
    );
    return { ...s, torsoGuards: [{ point: 0, offset: [0, 0, 0], limbs: [
      { a: 1, b: 2, samples: [{ s: 0.5, clearance: 0.25 }, { s: 1, clearance: 0.25 }] },
    ] }] };
  };

  it('an elbow driven into the guard by its rest target is held outside it', () => {
    let s = rig([0.3, 1.1, 0]);
    s = { ...s, restPose: [s.restPose[0]!, s.restPose[1]!, [0.05, 1.3, 0]] };
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.3 });
    expect(len(sub(s.points[2]!.pos, s.points[0]!.pos))).toBeGreaterThan(0.25 - 0.02);
  });

  it('does nothing to a limb that is already clear', () => {
    const s0 = rig([0.3, 1.1, 0]);
    const s1 = stepRig(s0, 1 / 60, OPTS);
    expect(s1.points[2]!.pos).toEqual(s0.points[2]!.pos);
  });

  it('the guard follows its point and turns with the body yaw', () => {
    // offset (0.2, 0, 0) at yaw 90 deg lands on -z (rotation about +Y): an elbow parked
    // there is inside the guard, one parked on the other side is not.
    let s = rig([0.3, 1.1, 0]);
    s = { ...s, bodyYaw: Math.PI / 2, torsoGuards: [{ point: 0, offset: [0.2, 0, 0], limbs: [
      { a: 1, b: 2, samples: [{ s: 1, clearance: 0.15 }] }] }] };
    const moved = stepRig({ ...s, points: s.points.map((p, i) => i === 2 ? { ...p, pos: [0, 1.3, -0.2], prev: [0, 1.3, -0.2] } : p) }, 1 / 60, OPTS);
    expect(len(sub(moved.points[2]!.pos, [0, 1.3, -0.2]))).toBeGreaterThan(0.01);   // pushed
  });
});
