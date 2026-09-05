// src/lab/sdf-zombie/attack.test.ts
import { describe, it, expect } from 'vitest';
import {
  ATTACK_TUNING, SWING_ARCS, armArc, attackDrive, attackPose,
  type SwingVariant,
} from './attack';

const VARIANTS: SwingVariant[] = ['hook', 'overhead'];
const STRIKE = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;
const WINDUP = ATTACK_TUNING.windupEnd;

describe('attackDrive', () => {
  it('is zero at both ends of the swing', () => {
    expect(attackDrive(0)).toBe(0);
    expect(attackDrive(1)).toBe(0);
  });

  it('winds up backwards before driving forwards', () => {
    expect(attackDrive(ATTACK_TUNING.windupEnd * 0.9)).toBeLessThan(0);
    expect(attackDrive((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2)).toBe(1);
  });

  it('is continuous across the beat boundaries', () => {
    const eps = 1e-4;
    for (const b of [ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, ATTACK_TUNING.holdEnd]) {
      expect(Math.abs(attackDrive(b + eps) - attackDrive(b - eps))).toBeLessThan(1e-2);
    }
  });

  it('never leaves [-1, 1]', () => {
    for (let p = 0; p <= 1; p += 0.005) {
      expect(attackDrive(p)).toBeGreaterThanOrEqual(-1);
      expect(attackDrive(p)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range phases instead of extrapolating', () => {
    expect(attackDrive(-3)).toBe(0);
    expect(attackDrive(7)).toBe(0);
  });
});

describe('armArc', () => {
  it('is exactly zero at phase 0 and phase 1, both variants', () => {
    for (const v of VARIANTS) {
      expect(armArc(0, v)).toEqual({ pitch: 0, yaw: 0, active: 0 });
      expect(armArc(1, v)).toEqual({ pitch: 0, yaw: 0, active: 0 });
    }
  });

  it('reaches the variant angles at the wind-up and strike peaks', () => {
    for (const v of VARIANTS) {
      const a = SWING_ARCS[v];
      expect(armArc(WINDUP, v).pitch).toBeCloseTo(a.windupPitch, 6);
      expect(armArc(WINDUP, v).yaw).toBeCloseTo(a.windupYaw, 6);
      expect(armArc(STRIKE, v).pitch).toBeCloseTo(a.strikePitch, 6);
      expect(armArc(STRIKE, v).yaw).toBeCloseTo(a.strikeYaw, 6);
    }
  });

  it('THE SWIMMER GUARD: the hook climbs, it does not sweep flat', () => {
    // The shipped swing had pitch FALL from 0.85 to 0.55 while yaw swept 1.15
    // across — an almost horizontal arc, which the owner read as a swimmer's
    // stroke (2026-09-05). A hook's pitch travel must be a real fraction of
    // its yaw travel, and it must travel UPWARD into the strike.
    const a = SWING_ARCS.hook;
    const pitchTravel = Math.abs(a.strikePitch - a.windupPitch);
    const yawTravel = Math.abs(a.strikeYaw - a.windupYaw);
    expect(pitchTravel).toBeGreaterThan(yawTravel * ATTACK_TUNING.flatArcRatio);
    expect(a.strikePitch).toBeGreaterThan(a.windupPitch);   // climbing, not falling
    expect(a.windupPitch).toBeGreaterThan(0);               // elbow up at BOTH ends
    expect(a.strikePitch).toBeGreaterThan(0);
  });

  it('the overhead is a chop: big vertical traverse, almost no yaw', () => {
    const a = SWING_ARCS.overhead;
    expect(Math.abs(a.strikePitch - a.windupPitch)).toBeGreaterThan(2);
    expect(a.strikePitch).toBeLessThan(0);        // driven down past the body
    for (let p = 0; p <= 1; p += 0.01) {
      expect(Math.abs(armArc(p, 'overhead').yaw)).toBeLessThan(0.25);
    }
  });

  it('active is a trapezoid: 0 at rest, 1 across the swing core', () => {
    for (const v of VARIANTS) {
      expect(armArc(0, v).active).toBe(0);
      expect(armArc(WINDUP, v).active).toBeCloseTo(1, 6);
      expect(armArc(STRIKE, v).active).toBeCloseTo(1, 6);
      expect(armArc(1, v).active).toBe(0);
      // It must NOT dip mid-strike the way attackDrive crosses zero.
      const mid = (ATTACK_TUNING.windupEnd + ATTACK_TUNING.strikeEnd) / 2;
      expect(armArc(mid, v).active).toBeCloseTo(1, 6);
    }
  });

  it('is finite across a swept phase, including out of range', () => {
    for (const v of VARIANTS) {
      for (let p = -0.5; p <= 1.5; p += 0.01) {
        const a = armArc(p, v);
        expect(Number.isFinite(a.pitch) && Number.isFinite(a.yaw)
          && Number.isFinite(a.active)).toBe(true);
      }
    }
  });
});

describe('attackPose', () => {
  it('is exactly zero at phase 0 and phase 1, every side and variant', () => {
    for (const v of VARIANTS) {
      for (const side of ['L', 'R'] as const) {
        for (const p of [0, 1]) {
          const pose = attackPose(p, side, v);
          expect(pose.rootOffset).toEqual([0, 0, 0]);
          expect(pose.reach).toEqual({ pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 });
          for (const o of Object.values(pose.offsets)) expect(o).toEqual([0, 0, 0]);
        }
      }
    }
  });

  it('swings the named arm, not the other one', () => {
    for (const v of VARIANTS) {
      const r = attackPose(STRIKE, 'R', v).reach;
      expect(Math.abs(r.pitchR)).toBeGreaterThan(Math.abs(r.pitchL));
      const l = attackPose(STRIKE, 'L', v).reach;
      expect(Math.abs(l.pitchL)).toBeGreaterThan(Math.abs(l.pitchR));
    }
  });

  it('L and R mirror in yaw', () => {
    for (const v of VARIANTS) {
      const r = attackPose(STRIKE, 'R', v);
      const l = attackPose(STRIKE, 'L', v);
      expect(l.reach.yawL).toBeCloseTo(-r.reach.yawR, 9);
      expect(l.reach.pitchL).toBeCloseTo(r.reach.pitchR, 9);
    }
  });

  it('the off arm holds a guard, it does NOT counter-swing', () => {
    // Two arms moving in opposition through a near-horizontal plane IS the
    // swimming motion. The off arm's pitch is a raised guard (positive,
    // constant through the swing core), not the swinging arm's negated.
    const p = attackPose(STRIKE, 'R', 'hook');
    expect(p.reach.pitchL).toBeCloseTo(ATTACK_TUNING.offGuardPitch, 6);
    expect(p.reach.pitchL).toBeGreaterThan(0);
    // And its yaw share is small.
    expect(Math.abs(p.reach.yawL)).toBeLessThan(Math.abs(p.reach.yawR) * 0.2);
  });

  it('the off arm never out-swings the swinging arm, at any phase', () => {
    for (const v of VARIANTS) {
      for (let p = 0; p <= 1; p += 0.01) {
        const a = attackPose(p, 'R', v).reach;
        expect(Math.abs(a.yawL)).toBeLessThanOrEqual(Math.abs(a.yawR) + 1e-9);
      }
    }
  });

  it('still drives the body off attackDrive — the weight shift is unchanged', () => {
    const peak = attackPose(STRIKE, 'R', 'hook');
    expect(peak.rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
    expect(attackPose(WINDUP, 'R', 'hook').rootOffset[2])
      .toBeCloseTo(-ATTACK_TUNING.windback, 6);
    // The body drive is variant-independent: only the ARM differs.
    expect(attackPose(STRIKE, 'R', 'overhead').rootOffset)
      .toEqual(peak.rootOffset);
  });

  it('is finite across a full sweep, every side and variant', () => {
    for (const v of VARIANTS) {
      for (const side of ['L', 'R'] as const) {
        for (let p = -0.5; p <= 1.5; p += 0.01) {
          const pose = attackPose(p, side, v);
          for (const o of [pose.rootOffset, ...Object.values(pose.offsets)]) {
            expect(o!.every(Number.isFinite)).toBe(true);
          }
          for (const a of Object.values(pose.reach)) {
            expect(Number.isFinite(a)).toBe(true);
          }
        }
      }
    }
  });
});
