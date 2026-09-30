// src/lab/sdf-zombie/webgpu/flail-blood.test.ts
import { describe, expect, it } from 'vitest';
import { FLAIL_BLOOD as B, bloodHit, bloodPerHit, makeFlailBlood, setBloodLevel, stepBlood } from './flail-blood';

describe('flail blood', () => {
  it('starts clean', () => {
    expect(makeFlailBlood().level).toBe(0);
  });

  it('adds 0.12 per body hit on R/L, ×1.3 on a head hit, ×1.5 on H', () => {
    expect(B.perHit).toBe(0.12);
    expect(bloodPerHit('R', false)).toBeCloseTo(0.12, 12);
    expect(bloodPerHit('L', false)).toBeCloseTo(0.12, 12);
    expect(bloodPerHit('H', false)).toBeCloseTo(0.18, 12);
    expect(bloodPerHit('R', true)).toBeCloseTo(0.156, 12);
    expect(bloodPerHit('H', true)).toBeCloseTo(0.12 * 1.5 * 1.3, 12);
    const b = makeFlailBlood();
    bloodHit(b, 'R', false);
    expect(b.level).toBeCloseTo(0.12, 12);
  });

  it('accumulates over multiple hits', () => {
    const b = makeFlailBlood();
    bloodHit(b, 'R', false); bloodHit(b, 'L', false); bloodHit(b, 'H', false);
    expect(b.level).toBeCloseTo(0.12 + 0.12 + 0.18, 12);
    bloodHit(b, 'R', true);
    expect(b.level).toBeCloseTo(0.42 + 0.156, 12);
  });

  it('clamps at 1', () => {
    const b = makeFlailBlood();
    for (let i = 0; i < 20; i++) bloodHit(b, 'H', true);
    expect(b.level).toBe(1);
  });

  it('decays with a 120 s time constant, frame-rate independent', () => {
    expect(B.tauSec).toBe(120);
    const a = makeFlailBlood(); setBloodLevel(a, 1);
    for (let i = 0; i < 120 * 60; i++) stepBlood(a, 1 / 60);
    expect(a.level).toBeCloseTo(Math.exp(-1), 6);
    const b = makeFlailBlood(); setBloodLevel(b, 1);
    stepBlood(b, 120);
    expect(b.level).toBeCloseTo(a.level, 6);
    // Still visibly bloody half a minute on, nearly dry after ten.
    const c = makeFlailBlood(); setBloodLevel(c, 1);
    stepBlood(c, 30);
    expect(c.level).toBeGreaterThan(0.75);
    stepBlood(c, 570);
    expect(c.level).toBeLessThan(0.01);
  });

  it('decays toward 0 between hits and adds on top of what is left', () => {
    const b = makeFlailBlood();
    bloodHit(b, 'R', false);
    stepBlood(b, 60);
    const left = 0.12 * Math.exp(-0.5);
    expect(b.level).toBeCloseTo(left, 9);
    bloodHit(b, 'R', false);
    expect(b.level).toBeCloseTo(left + 0.12, 9);
  });

  it('ignores bad steps and clamps the seam', () => {
    const b = makeFlailBlood(); setBloodLevel(b, 0.5);
    stepBlood(b, 0); stepBlood(b, -1); stepBlood(b, Number.NaN);
    expect(b.level).toBe(0.5);
    setBloodLevel(b, 2); expect(b.level).toBe(1);
    setBloodLevel(b, -1); expect(b.level).toBe(0);
    setBloodLevel(b, Number.NaN); expect(b.level).toBe(0);
  });
});
