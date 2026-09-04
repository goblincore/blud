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
  it('is exactly zero at phase 0 and phase 1', () => {
    for (const p of [0, 1]) {
      const pose = attackPose(p);
      expect(pose.rootOffset).toEqual([0, 0, 0]);
      expect(pose.reachPitch).toBe(0);
      for (const v of Object.values(pose.offsets)) expect(v).toEqual([0, 0, 0]);
    }
  });

  it('drives the root forward at the strike peak', () => {
    const peak = attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2);
    expect(peak.rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
    expect(peak.rootOffset[0]).toBe(0);
  });

  it('pulls the root back during the wind-up', () => {
    const wind = attackPose(ATTACK_TUNING.windupEnd);
    expect(wind.rootOffset[2]).toBeCloseTo(-ATTACK_TUNING.windback, 6);
  });

  it('swings the arms back then forward', () => {
    expect(attackPose(ATTACK_TUNING.windupEnd).reachPitch)
      .toBeCloseTo(-ATTACK_TUNING.pitchWindup, 6);
    expect(attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).reachPitch)
      .toBeCloseTo(ATTACK_TUNING.pitchStrike, 6);
  });

  it('drops the hands only on the forward half', () => {
    expect(attackPose(ATTACK_TUNING.windupEnd).offsets.handL![1]).toBe(0);
    expect(attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).offsets.handL![1])
      .toBeCloseTo(-ATTACK_TUNING.handDrop, 6);
  });

  it('carries the head at a share of the chest, both arms symmetric', () => {
    const p = attackPose(0.55);
    expect(p.offsets.head![2]).toBeCloseTo(p.offsets.chest![2] * ATTACK_TUNING.headShare, 6);
    expect(p.offsets.handL).toEqual(p.offsets.handR);
  });

  it('is finite across a full sweep', () => {
    for (let p = -0.5; p <= 1.5; p += 0.01) {
      const pose = attackPose(p);
      for (const v of [pose.rootOffset, ...Object.values(pose.offsets)]) {
        expect(v!.every(Number.isFinite)).toBe(true);
      }
      expect(Number.isFinite(pose.reachPitch)).toBe(true);
    }
  });
});
