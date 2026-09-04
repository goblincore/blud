// src/lab/sdf-zombie/attack.test.ts
import { describe, it, expect } from 'vitest';
import { ATTACK_TUNING, attackDrive, attackPose } from './attack';

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

describe('attackPose', () => {
  const STRIKE = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;
  const WINDUP = ATTACK_TUNING.windupEnd;

  it('is exactly zero at phase 0 and phase 1, both sides', () => {
    for (const side of ['L', 'R'] as const) {
      for (const p of [0, 1]) {
        const pose = attackPose(p, side);
        expect(pose.rootOffset).toEqual([0, 0, 0]);
        expect(pose.reach).toEqual({ pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 });
        for (const v of Object.values(pose.offsets)) expect(v).toEqual([0, 0, 0]);
      }
    }
  });

  it('swings the named arm, not the other one', () => {
    const r = attackPose(STRIKE, 'R').reach;
    expect(Math.abs(r.yawR)).toBeGreaterThan(Math.abs(r.yawL));
    expect(Math.abs(r.pitchR)).toBeGreaterThan(Math.abs(r.pitchL));
    const l = attackPose(STRIKE, 'L').reach;
    expect(Math.abs(l.yawL)).toBeGreaterThan(Math.abs(l.yawR));
    expect(Math.abs(l.pitchL)).toBeGreaterThan(Math.abs(l.pitchR));
  });

  it('L and R are mirror images', () => {
    const r = attackPose(STRIKE, 'R');
    const l = attackPose(STRIKE, 'L');
    expect(l.reach.yawL).toBeCloseTo(-r.reach.yawR, 9);
    expect(l.reach.yawR).toBeCloseTo(-r.reach.yawL, 9);
    expect(l.reach.pitchL).toBeCloseTo(r.reach.pitchR, 9);
    // The shoulder drive mirrors: R drives the right shoulder forward.
    expect(l.offsets.shoulderL![2]).toBeCloseTo(r.offsets.shoulderR![2], 9);
  });

  it('cocks out on the wind-up and sweeps across on the strike', () => {
    const wind = attackPose(WINDUP, 'R').reach;
    const hit = attackPose(STRIKE, 'R').reach;
    // Opposite signs: out, then across.
    expect(Math.sign(wind.yawR)).toBe(-Math.sign(hit.yawR));
    expect(Math.abs(hit.yawR)).toBeCloseTo(ATTACK_TUNING.yawStrike, 6);
    expect(Math.abs(wind.yawR)).toBeCloseTo(ATTACK_TUNING.yawWindup, 6);
  });

  it('the off arm counter-swings at a fraction of the swinging arm', () => {
    const r = attackPose(STRIKE, 'R').reach;
    expect(r.yawL).toBeCloseTo(-r.yawR * ATTACK_TUNING.offArmShare, 9);
    expect(r.pitchL).toBeCloseTo(-r.pitchR * ATTACK_TUNING.offArmShare, 9);
  });

  it('twists the torso: the swinging shoulder forward, the other back', () => {
    const p = attackPose(STRIKE, 'R');
    expect(p.offsets.shoulderR![2]).toBeGreaterThan(0);
    expect(p.offsets.shoulderL![2]).toBeCloseTo(-p.offsets.shoulderR![2], 9);
  });

  it('lunges less than the old two-arm slam did — the rotation carries it', () => {
    expect(ATTACK_TUNING.lunge).toBeLessThan(0.2);
    expect(attackPose(STRIKE, 'R').rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
  });

  it('drops only the swinging hand, and only on the forward half', () => {
    expect(attackPose(WINDUP, 'R').offsets.handR![1]).toBe(0);
    expect(attackPose(STRIKE, 'R').offsets.handR![1])
      .toBeCloseTo(-ATTACK_TUNING.handDrop, 6);
    expect(attackPose(STRIKE, 'R').offsets.handL![1]).toBe(0);
  });

  it('is finite across a full sweep, both sides', () => {
    for (const side of ['L', 'R'] as const) {
      for (let p = -0.5; p <= 1.5; p += 0.01) {
        const pose = attackPose(p, side);
        for (const v of [pose.rootOffset, ...Object.values(pose.offsets)]) {
          expect(v!.every(Number.isFinite)).toBe(true);
        }
        for (const a of Object.values(pose.reach)) expect(Number.isFinite(a)).toBe(true);
      }
    }
  });
});
