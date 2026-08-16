// src/lab/sdf-zombie/ik.test.ts
import { describe, it, expect } from 'vitest';
import {
  IK_TUNING,
  makeAim,
  makeClutch,
  makePlant,
  solveChain,
  solvePlantedLeg,
  stepAim,
  stepClutch,
  stepPlant,
  type AimOpts,
  type ClutchArm,
  type ClutchSignal,
  type SolveOpts,
} from './ik';
import { cross, dot, len, sub } from './vec';
import type { Vec3 } from './types';

const DT = 1 / 60;
const SOLVE: SolveOpts = { iterations: 32, epsilon: 1e-6 };
const AIM: AimOpts = { maxYaw: 0.85, maxPitch: 0.5, turnRate: 2.4 };

const close = (a: Vec3, b: Vec3, eps = 1e-6): boolean =>
  a.every((v, i) => Math.abs(v - b[i]!) < eps);
const seg = (a: Vec3, b: Vec3): number => len(sub(b, a));
const angle = (a: Vec3, b: Vec3): number => Math.acos(clampDot(a, b));
function clampDot(a: Vec3, b: Vec3): number {
  return Math.max(-1, Math.min(1, dot(a, b)));
}
// Fixtures use rest forward +z with right +x — decompose a unit dir directly.
const yaw = (d: Vec3): number => Math.atan2(d[0]!, d[2]!);
const pitch = (d: Vec3): number => Math.asin(Math.max(-1, Math.min(1, d[1]!)));

describe('solveChain — raw FABRIK', () => {
  it('converges a reachable 2-bone chain onto the target', () => {
    const out = solveChain(
      [[0, 1, 0], [0, 0.5, 0], [0, 0, 0]],
      [0.5, 0.5],
      [0.3, 0.1, 0.2],
      SOLVE,
    );
    expect(close(out[2]!, [0.3, 0.1, 0.2], 1e-5)).toBe(true);
    expect(close(out[0]!, [0, 1, 0], 1e-9)).toBe(true); // root anchored
    expect(seg(out[0]!, out[1]!)).toBeCloseTo(0.5, 9);
    expect(seg(out[1]!, out[2]!)).toBeCloseTo(0.5, 9);
  });

  it('extends straight toward an unreachable target, root fixed', () => {
    const out = solveChain(
      [[0, 0, 0], [0.2, 0, 0.1], [0.4, 0, 0.2]],
      [1, 1],
      [4, 0, 0],
      SOLVE,
    );
    expect(close(out[0]!, [0, 0, 0], 1e-12)).toBe(true);
    expect(close(out[1]!, [1, 0, 0], 1e-12)).toBe(true);
    expect(close(out[2]!, [2, 0, 0], 1e-12)).toBe(true);
    expect(len(cross(sub(out[1]!, out[0]!), sub(out[2]!, out[1]!)))).toBeLessThan(1e-9);
  });

  it('straightens diagonally toward an unreachable target', () => {
    const out = solveChain(
      [[0, 1, 0], [0.3, 0.5, 0.2], [0.1, 0.1, -0.3]],
      [0.5, 0.5],
      [0, -3, 0],
      SOLVE,
    );
    expect(close(out[0]!, [0, 1, 0], 1e-12)).toBe(true);
    expect(close(out[1]!, [0, 0.5, 0], 1e-12)).toBe(true);
    expect(close(out[2]!, [0, 0, 0], 1e-12)).toBe(true);
    expect(len(cross(sub(out[1]!, out[0]!), sub(out[2]!, out[1]!)))).toBeLessThan(1e-9);
  });

  it('is safe with degenerate zero-length segments — no NaN, lengths hold', () => {
    // All-zero lengths, target away (unreachable branch).
    const a = solveChain([[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0]], [0, 0], [1, 0, 0], SOLVE);
    // All-zero lengths, target at the root (iterative branch).
    const b = solveChain([[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0]], [0, 0], [0, 0, 0], SOLVE);
    // One zero segment, interior target (physically unreachable — must stay safe).
    const c = solveChain([[0, 0, 0], [0.2, 0, 0], [0.4, 0, 0]], [0.5, 0], [0.4, 0, 0], SOLVE);
    for (const out of [a, b, c]) {
      for (const p of out) for (const n of p) expect(Number.isFinite(n)).toBe(true);
      expect(close(out[0]!, [0, 0, 0], 1e-12)).toBe(true); // root never moves
    }
    expect(seg(a[0]!, a[1]!)).toBe(0);
    expect(seg(a[1]!, a[2]!)).toBe(0);
    expect(seg(b[0]!, b[1]!)).toBe(0);
    expect(seg(c[0]!, c[1]!)).toBeCloseTo(0.5, 9);
    expect(seg(c[1]!, c[2]!)).toBe(0);
  });

  it('is deterministic and leaves the input untouched', () => {
    const input: Vec3[] = [[0, 1, 0], [0.2, 0.4, 0.1], [-0.1, 0.2, 0.3]];
    const a = solveChain(input, [0.55, 0.55], [0.4, 0.05, 0.25], SOLVE);
    const b = solveChain(input, [0.55, 0.55], [0.4, 0.05, 0.25], SOLVE);
    expect(a).toEqual(b);
    expect(input).toEqual([[0, 1, 0], [0.2, 0.4, 0.1], [-0.1, 0.2, 0.3]]);
  });

  it('respects the iteration cap (iterations: 0 does no work)', () => {
    const out = solveChain(
      [[0, 1, 0], [0, 0.5, 0], [0, 0, 0]],
      [0.5, 0.5],
      [0.3, 0.1, 0.2],
      { iterations: 0, epsilon: 1e-9 },
    );
    expect(out).toEqual([[0, 1, 0], [0, 0.5, 0], [0, 0, 0]]);
  });
});

describe('foot plant — stepPlant / solvePlantedLeg', () => {
  const FEMUR = 0.55;
  const TIBIA = 0.55;
  const PLANT: Vec3 = [0.2, 0, 0.1];

  it('locks onto the floor contact at the stance edge, clamped to the ground plane', () => {
    const p = stepPlant(makePlant(), { stance: true, footPos: [0.2, 0.05, 0.1], groundY: 0 }, DT);
    expect(p.phase).toBe('stance');
    expect(close(p.plantPoint, PLANT, 1e-12)).toBe(true);
    expect(p.age).toBe(0);
  });

  it('ages through stance without drifting the plant point', () => {
    let p = stepPlant(makePlant(), { stance: true, footPos: [0.2, 0.05, 0.1], groundY: 0 }, DT);
    for (let i = 0; i < 10; i++) {
      p = stepPlant(p, { stance: true, footPos: [0.2, 0.05, 0.1], groundY: 0 }, DT);
    }
    expect(p.age).toBeCloseTo(10 * DT, 9);
    expect(close(p.plantPoint, PLANT, 1e-12)).toBe(true);
  });

  it('releases on swing and re-locks to the NEW contact on the next stance', () => {
    let p = stepPlant(makePlant(), { stance: true, footPos: [0.2, 0, 0.1], groundY: 0 }, DT);
    p = stepPlant(p, { stance: false, footPos: [0.5, 0.1, 0.4], groundY: 0 }, DT);
    expect(p.phase).toBe('swing');
    p = stepPlant(p, { stance: true, footPos: [0.7, 0.03, 0.55], groundY: 0 }, DT);
    expect(p.phase).toBe('stance');
    expect(close(p.plantPoint, [0.7, 0, 0.55], 1e-12)).toBe(true);
  });

  it('keeps the foot planted while the root translates during stance', () => {
    let plant = stepPlant(makePlant(), { stance: true, footPos: PLANT, groundY: 0 }, DT);
    let hip: Vec3 = [0, 0.9, 0];
    let knee: Vec3 = [0, 0.4, 0];
    let foot: Vec3 = PLANT;
    for (let i = 0; i < 60; i++) {
      hip = [hip[0] + 0.002, hip[1], hip[2] + 0.002];
      const leg = solvePlantedLeg(hip, knee, foot, plant, [FEMUR, TIBIA], SOLVE);
      expect(close(leg.foot, PLANT, 1e-12)).toBe(true); // locked to the contact
      expect(seg(leg.knee, hip)).toBeCloseTo(FEMUR, 9); // hip-knee length holds
      // Foot-knee holds within the solve's convergence tolerance (the ankle is
      // returned exactly on the plant point, not at the solved end effector).
      expect(Math.abs(seg(leg.foot, leg.knee) - TIBIA)).toBeLessThan(1e-4);
      knee = leg.knee;
      foot = leg.foot;
      plant = stepPlant(plant, { stance: true, footPos: foot, groundY: 0 }, DT);
    }
  });

  it('releases on swing — the foot follows the hints again', () => {
    let plant = stepPlant(makePlant(), { stance: true, footPos: PLANT, groundY: 0 }, DT);
    plant = stepPlant(plant, { stance: false, footPos: PLANT, groundY: 0 }, DT);
    const hintKnee: Vec3 = [0.15, 0.4, 0.3];
    const hintFoot: Vec3 = [0.3, 0.05, 0.55];
    const leg = solvePlantedLeg([0, 0.9, 0], hintKnee, hintFoot, plant, [FEMUR, TIBIA], SOLVE);
    expect(leg.knee).toEqual(hintKnee);
    expect(leg.foot).toEqual(hintFoot);
  });

  it('stays finite and keeps the foot locked even when the plant becomes unreachable', () => {
    const plant = stepPlant(makePlant(), { stance: true, footPos: PLANT, groundY: 0 }, DT);
    // Hip teleports far away — the plant is beyond full reach. The foot stays
    // locked and the leg stretches straight toward it, but the length
    // constraint can no longer hold end-to-end (that is the accepted degrade).
    const hip: Vec3 = [2, 1.5, 2];
    const leg = solvePlantedLeg(hip, [1, 1, 1], PLANT, plant, [FEMUR, TIBIA], SOLVE);
    expect(close(leg.foot, PLANT, 1e-12)).toBe(true);
    for (const n of [...leg.knee, ...leg.foot]) expect(Number.isFinite(n)).toBe(true);
    expect(seg(leg.knee, hip)).toBeCloseTo(FEMUR, 9);
    // Knee stays on the hip→plant straight line (the straight extension).
    const hipToPlant = sub(PLANT, hip);
    const hipToKnee = sub(leg.knee, hip);
    expect(len(cross(hipToPlant, hipToKnee))).toBeLessThan(1e-9);
    expect(dot(hipToKnee, hipToPlant)).toBeGreaterThan(0); // toward the plant, not away
  });
});

describe('head look-at — stepAim', () => {
  const REST: Vec3 = [0, 0, 1];
  const NECK: Vec3 = [0, 1.4, 0];
  const TWO: readonly number[] = [0.12, 0.1]; // neck + head segments
  const ONE: readonly number[] = [0.22]; // single segment

  it('clamps yaw to maxYaw — the head never spins past the limit', () => {
    let st = makeAim(REST);
    const target: Vec3 = [100, 0, 1]; // raw yaw ≈ π/2, clamp = 0.85
    for (let i = 0; i < 600; i++) {
      const step = stepAim(st, NECK, REST, target, TWO, AIM, DT);
      st = step.state;
      expect(yaw(step.dir)).toBeLessThanOrEqual(AIM.maxYaw + 1e-9);
    }
    expect(yaw(st.dir)).toBeCloseTo(AIM.maxYaw, 3);
  });

  it('clamps pitch to maxPitch', () => {
    let st = makeAim(REST);
    const target: Vec3 = [0, 100, 1]; // raw pitch ≈ π/2, clamp = 0.5
    for (let i = 0; i < 600; i++) {
      const step = stepAim(st, NECK, REST, target, TWO, AIM, DT);
      st = step.state;
      expect(pitch(step.dir)).toBeLessThanOrEqual(AIM.maxPitch + 1e-9);
    }
    expect(pitch(st.dir)).toBeCloseTo(AIM.maxPitch, 3);
  });

  it('damps tracking: one step turns at most turnRate * dt', () => {
    const step = stepAim(makeAim(REST), NECK, REST, [100, 0, 1], TWO, AIM, DT);
    expect(angle(REST, step.dir)).toBeLessThanOrEqual(AIM.turnRate * DT + 1e-9);
  });

  it('lays the chain out straight along the aim direction with the given segment lengths', () => {
    const step = stepAim(makeAim(REST), NECK, REST, [100, 0, 1], TWO, AIM, DT);
    expect(step.points.length).toBe(3);
    expect(close(step.points[0]!, NECK, 1e-12)).toBe(true);
    expect(seg(step.points[0]!, step.points[1]!)).toBeCloseTo(TWO[0]!, 9);
    expect(seg(step.points[1]!, step.points[2]!)).toBeCloseTo(TWO[1]!, 9);
    // Every point lies along the aim direction.
    const d = sub(step.points[2]!, step.points[0]!);
    expect(len(cross(d, step.dir))).toBeLessThan(1e-9);
  });

  it('supports a 1-segment aim', () => {
    const step = stepAim(makeAim(REST), NECK, REST, [100, 0, 1], ONE, AIM, DT);
    expect(step.points.length).toBe(2);
    expect(seg(step.points[0]!, step.points[1]!)).toBeCloseTo(ONE[0]!, 9);
  });

  it('is deterministic — identical inputs give identical outputs', () => {
    const run = (): { dir: Vec3 } => {
      let st = makeAim(REST);
      for (let i = 0; i < 30; i++) {
        st = stepAim(st, NECK, REST, [100, 0.3, 1], TWO, AIM, DT).state;
      }
      return st;
    };
    expect(run()).toEqual(run());
  });
});

describe('wound clutch — stepClutch', () => {
  const ARMS: ClutchArm[] = [
    { side: 'armL', shoulder: [0, 1.05, 0], hand: [0, 0.9, 0.2] },
    { side: 'armR', shoulder: [0.35, 1.05, 0], hand: [0.35, 0.9, 0.2] },
  ];
  const BLAST: ClutchSignal = { blast: true, wound: [0.3, 0.9, 0.05], arms: ARMS, staggered: false };
  const PELLET: ClutchSignal = { ...BLAST, blast: false };

  it('gates on blast size — blast starts a clutch, pellet never does', () => {
    expect(stepClutch(makeClutch(), PELLET, DT).arm).toBeNull();
    const c = stepClutch(makeClutch(), BLAST, DT);
    expect(c.arm).not.toBeNull();
    expect(c.remaining).toBe(IK_TUNING.clutchBeat);
  });

  it('picks the nearest surviving arm', () => {
    const c = stepClutch(makeClutch(), BLAST, DT);
    // Wound [0.3, 0.9, 0.05] is closer to the right shoulder (0.35, 1.05, 0)
    // than the left (0, 1.05, 0).
    expect(c.arm).toBe('armR');
    expect(close(c.target, [0.3, 0.9, 0.05], 1e-12)).toBe(true);
  });

  it('does nothing without a surviving arm', () => {
    expect(stepClutch(makeClutch(), { ...BLAST, arms: [] }, DT).arm).toBeNull();
  });

  it('enforces one clutch at a time — new requests are ignored while active', () => {
    let c = stepClutch(makeClutch(), BLAST, DT);
    // A new blast nearer the LEFT arm — must be ignored while armR clutches.
    c = stepClutch(c, { blast: true, wound: [0, 1.0, 0], arms: ARMS, staggered: false }, DT);
    expect(c.arm).toBe('armR');
    expect(close(c.target, [0.3, 0.9, 0.05], 1e-12)).toBe(true);
  });

  it('counts down the beat and releases at zero', () => {
    let c = stepClutch(makeClutch(), BLAST, DT);
    c = stepClutch(c, BLAST, IK_TUNING.clutchBeat); // one full beat of dt
    expect(c.arm).toBeNull();
  });

  it('releases mid-way when the beat runs out', () => {
    let c = stepClutch(makeClutch(), BLAST, DT);
    c = stepClutch(c, BLAST, IK_TUNING.clutchBeat / 2);
    expect(c.arm).toBe('armR');
    c = stepClutch(c, BLAST, IK_TUNING.clutchBeat / 2 + 0.01);
    expect(c.arm).toBeNull();
  });

  it('interrupts on stagger', () => {
    let c = stepClutch(makeClutch(), BLAST, DT);
    c = stepClutch(c, { ...BLAST, staggered: true }, DT);
    expect(c.arm).toBeNull();
  });

  it('is deterministic — identical inputs give identical states', () => {
    const run = () => {
      let c = makeClutch();
      c = stepClutch(c, BLAST, DT);
      c = stepClutch(c, BLAST, IK_TUNING.clutchBeat / 3);
      c = stepClutch(c, { ...BLAST, staggered: true }, DT);
      return stepClutch(c, BLAST, DT);
    };
    expect(run()).toEqual(run());
  });
});
