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
