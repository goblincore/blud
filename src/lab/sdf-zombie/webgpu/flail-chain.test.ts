// src/lab/sdf-zombie/webgpu/flail-chain.test.ts
//
import { describe, expect, it } from 'vitest';
import { FLAIL_CHAIN_SIM, guideWeight, linkRest, makeChain, stepChain, type ChainState } from './flail-chain';
import { FLAIL_CHAIN, FLAIL_SWING, makeFlailSwing, type FlailSwing } from './flail-swing';
import type { Vec3 } from '../types';

const DOWN: Vec3 = [0, -1, 0];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ball = (s: ChainState) => s.p[s.p.length - 1]!;
const reach = FLAIL_CHAIN.len + FLAIL_CHAIN.ringOffset;
const swingAt = (t: number): FlailSwing => ({ ...makeFlailSwing(), phase: 'swing', t });

describe('stepChain', () => {
  it('hangs straight down at rest', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0.2, -0.2, 0]);
    for (let i = 0; i < 240; i++) s = stepChain(s, a, [0, -reach, 0], FLAIL_CHAIN_SIM.restGuide, DOWN, 1 / 120);
    expect(ball(s)[1]).toBeCloseTo(-reach, 1);
    expect(Math.hypot(ball(s)[0], ball(s)[2])).toBeLessThan(0.02);
  });

  it('keeps every link near its rest length while the anchor moves', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const t = i / 120;
      const a: Vec3 = [0.3 * Math.sin(t * 9), 0.2 * Math.cos(t * 7), 0];
      s = stepChain(s, a, [a[0], a[1] - reach, a[2]], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
      for (let k = 0; k < s.p.length - 1; k++) {
        worst = Math.max(worst, Math.abs(dist(s.p[k]!, s.p[k + 1]!) - linkRest(k)) / linkRest(k));
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('puts the ball exactly on its target at guide 1 (within reach)', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0, -reach, 0]);
    const target: Vec3 = [0.2, -0.1, -0.25];
    s = stepChain(s, a, target, 1, DOWN, 1 / 60);
    expect(dist(ball(s), target)).toBeLessThan(1e-9);
  });

  it('lags a fast-moving anchor, then keeps moving after it stops (the whip)', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    for (let i = 0; i < 12; i++) {
      const a: Vec3 = [(0.4 * (i + 1)) / 12, 0, 0];   // 0.4 m in 0.1 s
      s = stepChain(s, a, [a[0], -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
    }
    expect(ball(s)[0]).toBeLessThan(0.4 - 0.05);          // lagging behind
    const before = ball(s);
    s = stepChain(s, [0.4, 0, 0], [0.4, -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
    expect(dist(ball(s), before) * 120).toBeGreaterThan(0.5);   // still moving after the anchor stopped
  });

  it('is the same whatever the frame split (fixed step)', () => {
    const a: Vec3 = [0, 0, 0];
    let s1 = makeChain(a, [0.3, 0, 0]), s2 = makeChain(a, [0.3, 0, 0]);
    for (let i = 0; i < 60; i++) s1 = stepChain(s1, a, [0, -reach, 0], 0.1, DOWN, 1 / 60);
    for (let i = 0; i < 120; i++) s2 = stepChain(s2, a, [0, -reach, 0], 0.1, DOWN, 1 / 120);
    for (let k = 0; k < 3; k++) expect(ball(s2)[k]).toBeCloseTo(ball(s1)[k]!, 9);
  });

  it('dt <= 0 or NaN leaves the state unchanged', () => {
    const s = makeChain([0, 0, 0], [0, -reach, 0]);
    expect(stepChain(s, [0, 0, 0], [0, -reach, 0], 0.1, DOWN, 0)).toBe(s);
    expect(stepChain(s, [0, 0, 0], [0, -reach, 0], 0.1, DOWN, Number.NaN)).toBe(s);
  });
});

describe('guideWeight', () => {
  it('holds lightly at rest, is exactly 1 at the strike, and loose either side of it', () => {
    expect(guideWeight(makeFlailSwing())).toBe(FLAIL_CHAIN_SIM.restGuide);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT))).toBe(1);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT - 0.1))).toBeLessThan(0.1);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT + 0.1))).toBeLessThan(0.2);
  });
  it('never jumps by more than 0.2 between 240 Hz samples within a swing', () => {
    let prev = guideWeight(swingAt(0));
    for (let t = 1 / 240; t < FLAIL_SWING.swingSec; t += 1 / 240) {
      const g = guideWeight(swingAt(t));
      expect(Math.abs(g - prev)).toBeLessThan(0.2);
      prev = g;
    }
  });
});
