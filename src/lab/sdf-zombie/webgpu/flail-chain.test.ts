// src/lab/sdf-zombie/webgpu/flail-chain.test.ts
//
import { describe, expect, it } from 'vitest';
import { FLAIL_CHAIN_SIM, guideWeight, linkRest, makeChain, stepChain, stepChainInPlace, type ChainState } from './flail-chain';
import {
  FLAIL_CHAIN, FLAIL_IMPACT, FLAIL_SWING, flailBallVel, flailBolt, flailPose, makeFlailSwing, stepFlailSwing,
  type FlailSide, type FlailSwing,
} from './flail-swing';
import type { Vec3 } from '../types';

const DOWN: Vec3 = [0, -1, 0];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ball = (s: ChainState) => s.p[s.p.length - 1]!;
const reach = FLAIL_CHAIN.len + FLAIL_CHAIN.ringOffset;
/** Absolute slack on the 1.6x rule, metres per frame, for frames where the key
 *  itself barely moves (the wind-up apex, the settle into rest). */
const REST_SLOP = 0.02;
const swingAt = (t: number): FlailSwing => ({ ...makeFlailSwing(), phase: 'swing', t });

describe('stepChain', () => {
  it('hangs straight down at rest', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0.2, -0.2, 0]);
    for (let i = 0; i < 240; i++) s = stepChain(s, a, [0, -reach, 0], FLAIL_CHAIN_SIM.restGuide, DOWN, 1 / 120);
    expect(ball(s)[1]).toBeCloseTo(-reach, 1);
    expect(Math.hypot(ball(s)[0], ball(s)[2])).toBeLessThan(0.02);
  });

  it('keeps every link at its rest length while the anchor moves', () => {
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
    expect(worst).toBeLessThan(0.002);
  });

  it('survives a 0.2 m anchor teleport in one call with every link at rest length', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    for (let i = 0; i < 30; i++) s = stepChain(s, [0, 0, 0], [0, -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 60);
    s = stepChain(s, [0.2, 0, 0], [0.2, -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 60);
    for (let k = 0; k < s.p.length - 1; k++) expect(Math.abs(dist(s.p[k]!, s.p[k + 1]!) - linkRest(k)) / linkRest(k)).toBeLessThan(0.002);
  });

  it('pins the ball exactly on its target on a pin call (within reach)', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0, -reach, 0]);
    const target: Vec3 = [0.2, -0.1, -0.25];
    s = stepChain(s, a, target, 1, DOWN, 1 / 60, { pin: true });
    expect(dist(ball(s), target)).toBeLessThan(1e-9);
  });

  it('does not pin without the pin flag, even at guide 1', () => {
    const a: Vec3 = [0, 0, 0];
    const s = stepChain(makeChain(a, [0, -reach, 0]), a, [0.2, -0.1, -0.25], 1, DOWN, 1 / 60);
    expect(dist(ball(s), [0.2, -0.1, -0.25])).toBeGreaterThan(1e-3);
  });

  it('keeps the target velocity through a pin: a miss flies on instead of hanging in the air', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0, -reach, 0]);
    s = stepChain(s, a, [0, -0.3, 0], 1, DOWN, 1 / 60, { pin: true, targetVel: [3, 0, 0] });
    const at = ball(s);
    s = stepChain(s, a, [0, -0.3, 0], 0, DOWN, 1 / 60);
    expect(ball(s)[0] - at[0]).toBeGreaterThan(0.5 * 3 / 60);
  });

  it('lags a fast-moving anchor, then keeps moving after it stops (the whip)', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    for (let i = 0; i < 12; i++) {
      const a: Vec3 = [(0.4 * (i + 1)) / 12, 0, 0];   // 0.4 m in 0.1 s
      s = stepChain(s, a, [a[0], -reach, 0], 0, DOWN, 1 / 120);   // the free chain: no guide
    }
    expect(ball(s)[0]).toBeLessThan(0.4 - 0.05);          // lagging behind
    const before = ball(s);
    s = stepChain(s, [0.4, 0, 0], [0.4, -reach, 0], 0, DOWN, 1 / 120);
    expect(dist(ball(s), before) * 120).toBeGreaterThan(0.5);   // still moving after the anchor stopped
  });

  it('is the same whatever the frame split (fixed step)', () => {
    const a: Vec3 = [0, 0, 0];
    // (The target is the one the chain was made toward: a target that JUMPS
    // is spread over the substeps of the call it jumps in, which depends on the split.)
    let s1 = makeChain(a, [0.3, 0, 0]), s2 = makeChain(a, [0.3, 0, 0]);
    for (let i = 0; i < 60; i++) s1 = stepChain(s1, a, [0.3, 0, 0], 0.1, DOWN, 1 / 60);
    for (let i = 0; i < 120; i++) s2 = stepChain(s2, a, [0.3, 0, 0], 0.1, DOWN, 1 / 120);
    for (let k = 0; k < 3; k++) expect(ball(s2)[k]).toBeCloseTo(ball(s1)[k]!, 9);
  });

  it('is the same whatever the frame split with a MOVING anchor and target (linear in time)', () => {
    const A = (t: number): Vec3 => [0.4 * t, 0.1 - 0.2 * t, -0.3 * t];
    const T = (t: number): Vec3 => [0.4 * t + 0.2, -0.2 * t - 0.25, -0.3 * t];
    let s1 = makeChain(A(0), T(0)), s2 = makeChain(A(0), T(0));
    for (let i = 1; i <= 60; i++) s1 = stepChain(s1, A(i / 60), T(i / 60), 0.2, DOWN, 1 / 60);
    for (let i = 1; i <= 120; i++) s2 = stepChain(s2, A(i / 120), T(i / 120), 0.2, DOWN, 1 / 120);
    for (let n = 0; n < s1.p.length; n++) for (let k = 0; k < 3; k++) expect(s2.p[n]![k]).toBeCloseTo(s1.p[n]![k]!, 9);
  });

  it('a capped call (huge dt) still ends node 0 on the anchor', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    s = stepChain(s, [0.3, 0.1, 0], [0.3, -reach, 0], 0.1, DOWN, 1.0);
    expect(s.p[0]).toEqual([0.3, 0.1, 0]);
    expect(s.anchor).toEqual([0.3, 0.1, 0]);
    for (const q of s.p) for (const c of q) expect(Number.isFinite(c)).toBe(true);
  });

  it('the in-place step matches the pure one, and the pure one leaves its input alone', () => {
    const s0 = makeChain([0, 0, 0], [0.2, -0.2, 0]);
    const snap = JSON.stringify(s0);
    const pure = stepChain(s0, [0.05, 0, 0], [0, -reach, 0], 0.3, DOWN, 1 / 60);
    expect(JSON.stringify(s0)).toBe(snap);
    const inPlace = stepChainInPlace(makeChain([0, 0, 0], [0.2, -0.2, 0]), [0.05, 0, 0], [0, -reach, 0], 0.3, DOWN, 1 / 60);
    expect(JSON.stringify(inPlace)).toBe(JSON.stringify(pure));
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
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT - FLAIL_CHAIN_SIM.guideWindow))).toBe(FLAIL_CHAIN_SIM.swingFloor);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT + FLAIL_CHAIN_SIM.releaseWindow))).toBe(FLAIL_CHAIN_SIM.swingFloor);
    expect(FLAIL_CHAIN_SIM.swingFloor).toBeLessThan(0.5);
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

/** The game's 60 Hz loop (game-flail.ts draw), minus the renderer: one click, the
 *  chain driven by flailPose, pinned on FLAIL_IMPACT with the key's own velocity
 *  on the strike frame. One row per swing frame. */
function replay(side: FlailSide, dt = 1 / 60) {
  let swing: FlailSwing = { ...makeFlailSwing(), nextSide: side };
  let s: ChainState | null = null;
  let prevBall: Vec3 | null = null, prevKey: Vec3 | null = null;
  const rows: { t: number; key: number; drawn: number; lag: number; strike: boolean; err: number; link: number }[] = [];
  for (let f = 0; f < 60; f++) {
    const r = stepFlailSwing(swing, { click: f === 20, held: false }, dt);
    swing = r.state;
    const strike = r.strikes[0] ?? null;
    const pose = flailPose(swing);
    const bolt = flailBolt(pose);
    const target = strike ? FLAIL_IMPACT[strike] : pose.ball;
    const vel = flailBallVel(strike ? { ...swing, t: FLAIL_SWING.strikeT } : swing);
    s = stepChain(s ?? makeChain(bolt, target), bolt, target, strike ? 1 : guideWeight(swing), DOWN, dt, { pin: !!strike, targetVel: vel });
    const b = ball(s);
    let link = 0;
    for (let k = 0; k < s.p.length - 1; k++) link = Math.max(link, Math.abs(dist(s.p[k]!, s.p[k + 1]!) - linkRest(k)) / linkRest(k));
    if (swing.phase === 'swing' && prevBall && prevKey) {
      rows.push({
        t: swing.t, key: dist(pose.ball, prevKey), drawn: dist(b, prevBall), lag: dist(b, pose.ball), strike: !!strike,
        err: strike ? dist(b, FLAIL_IMPACT[strike]) : 0, link,
      });
    }
    prevBall = b; prevKey = pose.ball;
  }
  return rows;
}

describe('the chain through a real swing (60 Hz replay, both sides)', () => {
  for (const side of ['R', 'L'] as const) {
    it(`${side}: the ball arrives at the strike MOVING, on FLAIL_IMPACT`, () => {
      const rows = replay(side);
      const hit = rows.filter(r => r.strike);
      expect(hit).toHaveLength(1);
      expect(hit[0]!.err).toBeLessThan(0.02);
      expect(hit[0]!.drawn).toBeGreaterThanOrEqual(0.5 * hit[0]!.key);
    });
    it(`${side}: no frame's drawn move exceeds 1.6x the key's (no catapult)`, () => {
      for (const r of replay(side)) expect(r.drawn, `t=${r.t.toFixed(3)} key=${r.key.toFixed(3)}`).toBeLessThanOrEqual(1.6 * r.key + REST_SLOP);
    });
    it(`${side}: every link stays at its rest length on every frame, the pinned strike frame included`, () => {
      for (const r of replay(side)) expect(r.link, `t=${r.t.toFixed(3)}`).toBeLessThan(0.001);
    });
    it(`${side}: the wind-up trails the key visibly but modestly (5 cm .. 20 cm)`, () => {
      const lag = Math.max(...replay(side).filter(r => r.t < FLAIL_SWING.strikeT).map(r => r.lag));
      expect(lag).toBeGreaterThan(0.05);
      expect(lag).toBeLessThanOrEqual(0.2);
    });
  }
});
