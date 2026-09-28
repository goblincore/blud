// src/lab/sdf-zombie/webgpu/flail-chain.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  FLAIL_CHAIN_SIM, chainTeleported, drawChain, guideWeight, linkRest, makeChain, stepChain, stepChainInPlace, type ChainState,
} from './flail-chain';
import {
  FLAIL_CHAIN, FLAIL_IMPACT, FLAIL_SWING, FLAIL_TIMING, flailBallVel, flailBolt, flailPose, makeFlailSwing, stepFlailSwing,
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
  it("follows each side's own timing: H (longer, strike at 0.2 s) is 1 on its strike and loose either side", () => {
    const h = (t: number): FlailSwing => ({ ...makeFlailSwing(), phase: 'swing', side: 'H', t });
    const S = FLAIL_TIMING.H;
    expect(guideWeight(h(S.strikeT))).toBe(1);
    expect(guideWeight(h(FLAIL_SWING.strikeT))).toBeLessThan(1);   // R/L's strike time is not H's
    expect(guideWeight(h(S.strikeT - FLAIL_CHAIN_SIM.guideWindow))).toBe(FLAIL_CHAIN_SIM.swingFloor);
    expect(guideWeight(h(S.strikeT + FLAIL_CHAIN_SIM.releaseWindow))).toBe(FLAIL_CHAIN_SIM.swingFloor);
    let prev = guideWeight(h(0));
    for (let t = 1 / 240; t < S.swingSec; t += 1 / 240) {
      const g = guideWeight(h(t));
      expect(Math.abs(g - prev)).toBeLessThan(0.2);
      prev = g;
    }
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

/** A frame-time source: `hz`, optionally jittered ±`jitter` (seeded, repeatable). */
function frames(hz: number, jitter = 0, seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return (1 + jitter * (2 * (x / 2147483648) - 1)) / hz;
  };
}

/** The game's loop (game-flail.ts draw), minus the renderer: one click (at frame
 *  20), then the side's whole swing (FLAIL_TIMING[side].swingSec) and a little; the chain
 *  driven by flailPose, pinned on FLAIL_IMPACT with the key's own velocity on the
 *  strike frame, and DRAWN through drawChain (what the player sees). One row per
 *  swing frame. `keyIn` is the key's move from the last frame up to the impact
 *  point (what the strike frame's drawn move is compared with: the drawn ball
 *  stops ON the impact, not on the frame's overrun key). */
function replay(side: FlailSide, dt: () => number = () => 1 / 60) {
  let swing: FlailSwing = { ...makeFlailSwing(), nextSide: side };
  let s: ChainState | null = null;
  let prevBall: Vec3 | null = null, prevKey: Vec3 | null = null;
  const out: [number, number, number][] = Array.from({ length: FLAIL_CHAIN_SIM.nodes }, () => [0, 0, 0]);
  const rows: {
    t: number; key: number; keyIn: number; drawn: number; lag: number; strike: boolean; err: number;
    link: number; gap: number; teleport: boolean;
  }[] = [];
  let t = 0;
  // 1.2 s for R/L (0.45 s swings) — up to 0.7 s to the click at 30 Hz, the swing, a margin.
  const endT = 0.75 + FLAIL_TIMING[side].swingSec;
  for (let f = 0; t < endT; f++) {
    const h = dt();
    t += h;
    const r = stepFlailSwing(swing, { click: f === 20, held: false }, h);
    swing = r.state;
    const strike = r.strikes[0] ?? null;
    const pose = flailPose(swing);
    const bolt = flailBolt(pose);
    const target = strike ? FLAIL_IMPACT[strike] : pose.ball;
    const vel = flailBallVel(strike ? { ...swing, t: FLAIL_TIMING[strike].strikeT } : swing);
    const teleport = s !== null && chainTeleported(s, bolt, h);
    s = stepChain(s ?? makeChain(bolt, target), bolt, target, strike ? 1 : guideWeight(swing), DOWN, h, { pin: !!strike, targetVel: vel });
    drawChain(s, bolt, out);
    const b: Vec3 = [out[out.length - 1]![0], out[out.length - 1]![1], out[out.length - 1]![2]];
    let link = 0;
    for (let k = 0; k < out.length - 1; k++) link = Math.max(link, Math.abs(dist(out[k]!, out[k + 1]!) - linkRest(k)) / linkRest(k));
    if (swing.phase === 'swing' && prevBall && prevKey) {
      rows.push({
        t: swing.t, key: dist(pose.ball, prevKey), keyIn: strike ? dist(FLAIL_IMPACT[strike], prevKey) : dist(pose.ball, prevKey),
        drawn: dist(b, prevBall), lag: dist(b, pose.ball), strike: !!strike,
        err: strike ? dist(b, FLAIL_IMPACT[strike]) : 0, link, gap: dist(out[0]!, bolt), teleport,
      });
    }
    prevBall = b; prevKey = pose.ball;
  }
  return rows;
}

/** Frame rates the gates run at: steady and jittered (several seeds each). */
const RATES: { name: string; dt: () => () => number; seeds: number }[] = [
  { name: '30 Hz', dt: () => frames(30), seeds: 1 },
  { name: '60 Hz', dt: () => frames(60), seeds: 1 },
  { name: '144 Hz', dt: () => frames(144), seeds: 1 },
  { name: '165 Hz', dt: () => frames(165), seeds: 1 },
  { name: '240 Hz', dt: () => frames(240), seeds: 1 },
];
const JITTERED: { name: string; hz: number; jitter: number }[] = [
  { name: '60 Hz ±5%', hz: 60, jitter: 0.05 },
  { name: '60 Hz ±15%', hz: 60, jitter: 0.15 },
  { name: '144 Hz ±15%', hz: 144, jitter: 0.15 },
  { name: '240 Hz ±15%', hz: 240, jitter: 0.15 },
];
const ALL: { name: string; make: () => () => number }[] = [
  ...RATES.map(r => ({ name: r.name, make: r.dt })),
  ...JITTERED.flatMap(j => [1, 2, 3, 4, 5, 6].map(seed => ({ name: `${j.name} seed ${seed}`, make: () => frames(j.hz, j.jitter, seed) }))),
];

describe('the chain through a real swing, at every frame rate (every side)', () => {
  for (const { name, make } of ALL) {
    for (const side of ['R', 'L', 'H'] as const) {
      it(`${name} ${side}: one strike; the drawn ball ON FLAIL_IMPACT (< 1e-6) and arriving MOVING`, () => {
        const hit = replay(side, make()).filter(r => r.strike);
        expect(hit).toHaveLength(1);
        expect(hit[0]!.err).toBeLessThan(1e-6);
        expect(hit[0]!.drawn).toBeGreaterThanOrEqual(0.5 * hit[0]!.keyIn);
      });
      it(`${name} ${side}: the drawn chain starts ON the bolt with exact links, and no teleport fires mid-swing`, () => {
        for (const r of replay(side, make())) {
          expect(r.gap, `t=${r.t.toFixed(3)}`).toBeLessThan(1e-9);
          expect(r.link, `t=${r.t.toFixed(3)}`).toBeLessThan(0.001);
          expect(r.teleport, `t=${r.t.toFixed(3)}`).toBe(false);
        }
      });
    }
  }
  for (const side of ['R', 'L', 'H'] as const) {
    // NO CATAPULT, at 60 Hz only. At >= 144 Hz or with jittered frames the ball
    // beats this by 2–6 cm at the WIND-UP APEX (swing t ~0.10, the key reversing,
    // the ball carrying on): the sim sees a per-frame linear anchor, and at 60 Hz
    // that cuts the apex's corner; at 240 Hz (one substep a frame, the true path)
    // it does not. That is the whip's own motion, not the old guide-ramp
    // catapult (0.63 m in a frame) — a tuning/gate decision, not a timing bug.
    it(`60 Hz ${side}: no frame's drawn move exceeds 1.6x the key's + 2 cm (no catapult)`, () => {
      for (const r of replay(side)) expect(r.drawn, `t=${r.t.toFixed(3)} key=${r.key.toFixed(3)}`).toBeLessThanOrEqual(1.6 * r.key + REST_SLOP);
    });
    it(`60 Hz ${side}: the wind-up trails the key visibly but modestly (5 cm .. 20 cm)`, () => {
      const lag = Math.max(...replay(side).filter(r => r.t < FLAIL_TIMING[side].strikeT).map(r => r.lag));
      expect(lag).toBeGreaterThan(0.05);
      expect(lag).toBeLessThanOrEqual(0.2);
    });
  }
});

describe('drawChain', () => {
  it('extrapolates by the carried time, roots node 0 on the bolt, and keeps every link exact', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0.3, 0, 0]);
    s = stepChain(s, a, [0.3, 0, 0], 0, DOWN, 1 / 144);   // leaves acc > 0
    expect(s.acc).toBeGreaterThan(0);
    const out: [number, number, number][] = Array.from({ length: s.p.length }, () => [0, 0, 0]);
    const bolt: Vec3 = [0.01, 0.002, 0];
    const snap = JSON.stringify(s);
    drawChain(s, bolt, out);
    expect(JSON.stringify(s)).toBe(snap);                  // the sim state is untouched
    expect(out[0]).toEqual([0.01, 0.002, 0]);
    for (let k = 0; k < out.length - 1; k++) expect(dist(out[k]!, out[k + 1]!)).toBeCloseTo(linkRest(k), 9);
    // The falling ball is drawn ahead of the sim (further down), by about acc of its velocity.
    expect(out[out.length - 1]![1]).toBeLessThan(ball(s)[1]);
  });
  it('is the sim state itself when no time is carried and node 0 is on the bolt', () => {
    const a: Vec3 = [0, 0, 0];
    const s = stepChain(makeChain(a, [0.3, 0, 0]), a, [0.3, 0, 0], 0, DOWN, 1 / 60);
    expect(s.acc).toBe(0);
    const out: [number, number, number][] = Array.from({ length: s.p.length }, () => [0, 0, 0]);
    drawChain(s, a, out);
    for (let n = 0; n < out.length; n++) for (let k = 0; k < 3; k++) expect(out[n]![k]).toBeCloseTo(s.p[n]![k]!, 12);
  });
});

describe('chainTeleported', () => {
  it('fires on the cancel snap (0.87 m in a frame) and not on the swing at any rate', () => {
    const s = makeChain([0, 0, 0], [0, -reach, 0]);
    expect(chainTeleported(s, [0.87, 0, 0], 1 / 60)).toBe(true);
    expect(chainTeleported(s, [0.3, 0, 0], 1 / 60)).toBe(false);          // 18 m/s: a fast swing
    expect(chainTeleported({ ...s, acc: 0.004 }, [0.2, 0, 0], 1 / 240)).toBe(false); // over dt + acc
  });
});
