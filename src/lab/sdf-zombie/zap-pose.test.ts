// src/lab/sdf-zombie/zap-pose.test.ts
import { describe, expect, it } from 'vitest';
import { zapPose, ZAP_POSE } from './zap-pose';
import { FLAIL_REST } from './burn-flail';
import { ZAP } from './zap';

const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('the zap pose', () => {
  it('keeps both hands inside the arm reach in every variant at every tremor phase', () => {
    for (let variant = 0; variant < 3; variant++) {
      for (let i = 0; i < 240; i++) {
        const p = zapPose({ t: i / 240, seed: 5, amp: 1, variant, tremor: 1, star: true });
        expect(len(p.handL!)).toBeLessThanOrEqual(ZAP_POSE.reach + 1e-9);
        expect(len(p.handR!)).toBeLessThanOrEqual(ZAP_POSE.reach + 1e-9);
      }
    }
  });

  it('throws the arms out and up, arches the back and throws the head back', () => {
    const p = zapPose({ t: 0, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    expect(p.handL![0]).toBeGreaterThan(0.6);   // out
    expect(p.handL![1]).toBeGreaterThan(0.2);   // up
    expect(p.handR![0]).toBeGreaterThan(0.6);
    expect(p.pitch).toBeLessThan(0);            // + is forward
    expect(p.headToss).toBeLessThan(0);
    expect(p.jaw).toBeGreaterThan(0.3);
  });

  it('gives three different silhouettes', () => {
    const at = (variant: number) => zapPose({ t: 0, seed: 5, amp: 1, variant, tremor: 0, star: true });
    expect(at(1).handL![1]).toBeGreaterThan(at(0).handL![1] + 0.15);       // arms higher
    expect(Math.abs(at(2).handL![1] - at(2).handR![1])).toBeGreaterThan(0.4);   // one up, one out
  });

  it('shakes the trunk by tremorM at the chest and by nothing at tremor 0', () => {
    const still = zapPose({ t: 0.013, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      const p = zapPose({ t: i / 200, seed: 5, amp: 1, variant: 0, tremor: 1, star: true });
      peak = Math.max(peak, Math.abs(p.sway - still.sway));
    }
    expect(peak * ZAP_POSE.chestM).toBeGreaterThan(ZAP.tremorM * 0.8);
    expect(peak * ZAP_POSE.chestM).toBeLessThan(ZAP.tremorM * 1.2);
  });

  it('eases out of the rest pose with amp, and is the rest pose at amp 0', () => {
    const rest = zapPose({ t: 0, seed: 5, amp: 0, variant: 0, tremor: 0, star: true });
    expect(rest.handL).toEqual(FLAIL_REST);
    expect(rest.pitch).toBe(0);
    const half = zapPose({ t: 0, seed: 5, amp: 0.5, variant: 0, tremor: 0, star: true });
    const full = zapPose({ t: 0, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    expect(half.handL![0]).toBeGreaterThan(FLAIL_REST[0]);
    expect(half.handL![0]).toBeLessThan(full.handL![0]);
  });

  it('leaves the arms alone on a body that takes no star', () => {
    const p = zapPose({ t: 0.02, seed: 5, amp: 1, variant: 0, tremor: 1, star: false });
    expect(p.handL).toBeNull();
    expect(p.handR).toBeNull();
    expect(p.headToss).toBe(0);
    expect(p.jaw).toBe(0);
  });
});
