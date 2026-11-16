import { describe, expect, it } from 'vitest';
import { burnFlailPose, solveElbow, FLAIL_REST } from './burn-flail';
import type { Vec3 } from './types';

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dist = (a: Vec3, b: Vec3) => len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

describe('burnFlailPose', () => {
  it('amp 0 is the hanging rest pose with no trunk motion', () => {
    const p = burnFlailPose(1.234, 5, 0, 0);
    expect(p.handL).toEqual(FLAIL_REST);
    expect(p.handR).toEqual(FLAIL_REST);
    expect(p.pitch).toBe(0); expect(p.sway).toBe(0); expect(p.headToss).toBe(0);
  });
  it('at full amplitude the hands are up and in front, within reach', () => {
    let up = 0, n = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      const p = burnFlailPose(t, 5, 1, 0);
      for (const h of [p.handL, p.handR]) {
        expect(len(h)).toBeLessThanOrEqual(0.97 + 1e-9);
        expect(h[2]).toBeGreaterThan(-0.2);          // never far behind the shoulder
        if (h[1] > 0) up++;
        n++;
      }
    }
    expect(up / n).toBeGreaterThan(0.6);              // mostly above the shoulder
  });
  it('is continuous: a bounded change per 1/60 s', () => {
    let prev = burnFlailPose(0, 9, 1, 0);
    for (let t = 1 / 60; t < 6; t += 1 / 60) {
      const p = burnFlailPose(t, 9, 1, 0);
      expect(dist(p.handL, prev.handL)).toBeLessThan(0.15);
      expect(dist(p.handR, prev.handR)).toBeLessThan(0.15);
      expect(Math.abs(p.pitch - prev.pitch)).toBeLessThan(0.05);
      prev = p;
    }
  });
  it('fold 1 brings both hands down to the chest and pitches the trunk forward', () => {
    for (let t = 0; t < 3; t += 0.1) {
      const p = burnFlailPose(t, 5, 1, 1);
      for (const h of [p.handL, p.handR]) {
        expect(h[1]).toBeLessThan(0.15);
        expect(h[2]).toBeGreaterThan(0.2);
      }
      expect(p.pitch).toBeGreaterThan(0.3);
    }
  });
  it('the two arms differ, and two seeds differ', () => {
    const a = burnFlailPose(1, 5, 1, 0), b = burnFlailPose(1, 6, 1, 0);
    expect(dist(a.handL, a.handR)).toBeGreaterThan(0.02);
    expect(dist(a.handL, b.handL)).toBeGreaterThan(0.02);
  });
  it('is deterministic', () => {
    expect(burnFlailPose(2.5, 4, 0.7, 0.3)).toEqual(burnFlailPose(2.5, 4, 0.7, 0.3));
  });
});

describe('solveElbow', () => {
  const S: Vec3 = [0, 1.4, 0];
  it('keeps both segment lengths and reaches the target', () => {
    const r = solveElbow(S, [0.2, 1.6, 0.3], 0.3, 0.28, [1, -1, 0]);
    expect(dist(S, r.elbow)).toBeCloseTo(0.3, 6);
    expect(dist(r.elbow, r.hand)).toBeCloseTo(0.28, 6);
    expect(dist(r.hand, [0.2, 1.6, 0.3])).toBeLessThan(1e-6);
  });
  it('clamps a target out of reach without stretching', () => {
    const r = solveElbow(S, [0, 1.4, 5], 0.3, 0.28, [1, -1, 0]);
    expect(dist(S, r.elbow)).toBeCloseTo(0.3, 6);
    expect(dist(r.elbow, r.hand)).toBeCloseTo(0.28, 6);
    expect(dist(S, r.hand)).toBeLessThanOrEqual(0.58);
  });
  it('bends toward the pole', () => {
    const r = solveElbow(S, [0, 1.4, 0.4], 0.3, 0.28, [1, 0, 0]);
    expect(r.elbow[0]).toBeGreaterThan(0.05);
  });
  it('survives a hand on the shoulder and a pole along the arm', () => {
    const r = solveElbow(S, S, 0.3, 0.28, [0, 0, 1]);
    for (const v of [...r.elbow, ...r.hand]) expect(Number.isFinite(v)).toBe(true);
  });
});
