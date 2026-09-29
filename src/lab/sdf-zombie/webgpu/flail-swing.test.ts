// src/lab/sdf-zombie/webgpu/flail-swing.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  FLAIL_CHAIN, FLAIL_IMPACT, FLAIL_REST, FLAIL_TIMING, chainReach, FLAIL_SWING, cancelFlailSwing, comboSide, flailKeyTimes, flailBallVel, flailBolt, flailPose, makeFlailSwing, stepFlailSwing,
  type FlailSide, type FlailSwing,
} from './flail-swing';

const DT = 1 / 240;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** Every swing, each with its own timing (FLAIL_TIMING[side]) and key times. */
const SIDES = ['R', 'L', 'H'] as const;
/** A swing state `t` seconds into `side` (H is only reachable this way until the combo lands). */
const swingOf = (side: FlailSide, t: number): FlailSwing =>
  ({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });

/** Run `sec` of sim with the button held/released; a click is a one-step edge at the start. */
function run(s: FlailSwing, sec: number, held: boolean, click = false, dt = DT) {
  const strikes: FlailSide[] = [];
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) {
    const r = stepFlailSwing(s, { click: click && i === 0, held }, dt);
    s = r.state;
    strikes.push(...r.strikes);
  }
  return { s, strikes };
}

describe('stepFlailSwing', () => {
  it('a click starts a right-to-left swing that strikes once, then returns to idle', () => {
    const r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.05, false, true);
    expect(r.strikes).toEqual(['R']);
    expect(r.s.phase).toBe('idle');
  });

  it('the strike fires at strikeT', () => {
    let s = makeFlailSwing();
    let t = 0, at = -1;
    for (let i = 0; i < 240 && at < 0; i++) {
      const r = stepFlailSwing(s, { click: i === 0, held: false }, DT);
      s = r.state; t += DT;
      if (r.strikes.length) at = t;
    }
    expect(at).toBeGreaterThanOrEqual(FLAIL_SWING.strikeT);
    expect(at).toBeLessThan(FLAIL_SWING.strikeT + 2 * DT);
  });

  it('strikes exactly once per swing whatever the step size', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 30, 0.2]) {
      const r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.3, false, true, dt);
      expect(r.strikes, `dt ${dt}`).toEqual(['R']);
    }
  });

  it('a quick combo runs R, L, H, then back to R', () => {
    let r = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
    r = run(r.s, FLAIL_TIMING.L.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['L']);
    r = run(r.s, FLAIL_TIMING.H.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['H']);
    r = run(r.s, FLAIL_TIMING.R.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
  });

  it('a pause longer than comboWindowSec resets the combo to R', () => {
    let r = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 0.01, false, true);   // R, then idle 0.01 s
    r = run(r.s, FLAIL_SWING.comboWindowSec + 0.05, false);                        // wait past the window
    r = run(r.s, FLAIL_TIMING.R.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
  });

  it('the combo window edge: a click just inside continues, just outside resets', () => {
    const afterR = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 1e-6, false, true).s;   // idle, idleT ≈ 0
    const inside = run(afterR, FLAIL_SWING.comboWindowSec - 2 * DT, false).s;
    expect(comboSide(inside)).toBe('L');
    expect(run(inside, 0.3, false, true).strikes).toEqual(['L']);
    const outside = run(afterR, FLAIL_SWING.comboWindowSec + 2 * DT, false).s;
    expect(comboSide(outside)).toBe('R');
    expect(run(outside, 0.3, false, true).strikes).toEqual(['R']);
  });

  it('a click in the last bufferSec queues the next swing', () => {
    let r = run(makeFlailSwing(), FLAIL_SWING.swingSec - FLAIL_SWING.bufferSec + 0.05, false, true);
    expect(r.s.phase).toBe('swing');
    r = run(r.s, 0.6, false, true);   // click inside the buffer (t≈0.35), then release
    expect(r.strikes).toEqual(['L']);   // the queued L swing ran and struck
    expect(r.s.swingId).toBe(2);
  });

  it('a click early in a swing is ignored', () => {
    let r = run(makeFlailSwing(), 0.05, false, true);
    r = run(r.s, FLAIL_SWING.swingSec + 0.2, false, true);   // click at t≈0.05: outside the buffer
    expect(r.s.swingId).toBe(1);
    expect(r.s.phase).toBe('idle');
  });

  it('holding the button chains swings', () => {
    const r = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + FLAIL_TIMING.L.swingSec + FLAIL_TIMING.H.strikeT + 0.01, true, true);
    expect(r.strikes).toEqual(['R', 'L', 'H']);
  });

  it('cancel returns to idle with no strike after it', () => {
    let r = run(makeFlailSwing(), 0.05, false, true);
    const c = cancelFlailSwing(r.s);
    expect(c.phase).toBe('idle');
    r = run(c, 1, false);
    expect(r.strikes).toEqual([]);
  });

  it('dt <= 0 leaves the state unchanged', () => {
    const s = run(makeFlailSwing(), 0.05, false, true).s;
    expect(stepFlailSwing(s, { click: false, held: false }, 0).state).toBe(s);
    expect(stepFlailSwing(s, { click: false, held: false }, -1).state).toBe(s);
  });

  it('a held button with no click does not start a swing from idle (e.g. right after a weapon switch)', () => {
    const idle = makeFlailSwing();
    const r = stepFlailSwing(idle, { click: false, held: true }, DT);
    expect(r.state.phase).toBe('idle');
    expect(r.state.swingId).toBe(0);
    expect(r.strikes).toEqual([]);
  });

  it('the buffer check uses the post-step time: a step landing exactly on the boundary counts', () => {
    const dt = DT;
    const t0 = FLAIL_SWING.swingSec - FLAIL_SWING.bufferSec - dt; // t0 + dt lands exactly on the boundary
    const s: FlailSwing = { phase: 'swing', side: 'R', t: t0, struck: true, queued: false, nextSide: 'L', swingId: 1, idleT: 0 };
    const onBoundary = stepFlailSwing(s, { click: true, held: false }, dt).state;
    expect(onBoundary.queued).toBe(true);

    const justOutside: FlailSwing = { ...s, t: t0 - dt };
    const outside = stepFlailSwing(justOutside, { click: true, held: false }, dt).state;
    expect(outside.queued).toBe(false);
  });

  it('one huge dt crossing both strikeT and swingSec gives exactly one strike', () => {
    const r = stepFlailSwing(makeFlailSwing(), { click: true, held: false }, FLAIL_SWING.swingSec + 0.2);
    expect(r.strikes).toEqual(['R']);
    expect(r.state.phase).toBe('idle');
  });

  it('a chained huge dt strikes each swing exactly once, still cycling R, L, H', () => {
    let s = makeFlailSwing();
    const allStrikes: FlailSide[] = [];
    for (let i = 0; i < 6; i++) {
      const r = stepFlailSwing(s, { click: i === 0, held: true }, 0.55 + 0.37);
      s = r.state;
      allStrikes.push(...r.strikes);
    }
    expect(allStrikes.length).toBe(s.swingId);
    expect(allStrikes).toEqual(allStrikes.map((_, i) => (['R', 'L', 'H'] as const)[i % 3]));
  });
});

describe('flailPose', () => {
  it('rests at FLAIL_REST when idle, and a swing starts and ends there', () => {
    const idle = flailPose(makeFlailSwing());
    expect(idle).toEqual(FLAIL_REST);
    const s0 = stepFlailSwing(makeFlailSwing(), { click: true, held: false }, 1e-9).state;
    expect(dist(flailPose(s0).ball, FLAIL_REST.ball)).toBeLessThan(1e-4);
    const end = run(makeFlailSwing(), FLAIL_SWING.swingSec - 1e-6, false, true).s;
    expect(dist(flailPose(end).ball, FLAIL_REST.ball)).toBeLessThan(0.01);
  });

  it('passes through the authored impact point at strikeT', () => {
    for (const side of SIDES) {
      const s: FlailSwing = { ...makeFlailSwing(), phase: 'swing', side, t: FLAIL_TIMING[side].strikeT };
      expect(dist(flailPose(s).ball, FLAIL_IMPACT[side])).toBeLessThan(1e-9);
    }
  });

  it('the strike is in front of the eye, and R and L mirror across the centre line', () => {
    expect(FLAIL_IMPACT.R[2]).toBeLessThan(-0.8);
    expect(FLAIL_IMPACT.L[2]).toBeLessThan(-0.8);
    expect(FLAIL_IMPACT.H[2]).toBeLessThan(-0.8);
    expect(Math.abs(FLAIL_IMPACT.R[0] + FLAIL_IMPACT.L[0])).toBeLessThan(0.2);
  });

  it('strikes on the crosshair: the impact ≤ 0.1 below the view axis per metre forward, ≤ 0.1 to the side', () => {
    for (const side of SIDES) {
      const [x, y, z] = FLAIL_IMPACT[side];
      expect(y / -z, side).toBeLessThanOrEqual(-0.04);
      expect(y / -z, side).toBeGreaterThanOrEqual(-0.1);
      expect(Math.abs(x / -z), side).toBeLessThanOrEqual(0.1);
    }
  });

  it('R is a big overhand swipe: wound up high over the right shoulder, then down onto the crosshair', () => {
    const at = (t: number) => flailPose({ phase: 'swing', side: 'R', t, struck: false, queued: false, nextSide: 'R', swingId: 1, idleT: 0 });
    const up = at(0.1);
    expect(up.ball[1]).toBeGreaterThanOrEqual(0.3);    // above the eye
    expect(up.ball[0]).toBeGreaterThanOrEqual(0.15);   // on the right
    expect(up.ball[2]).toBeGreaterThanOrEqual(-0.45);  // up by the shoulder, not out in front
    expect(up.grip[1]).toBeGreaterThanOrEqual(0.0);    // the fist raised
    const v = flailBallVel({ ...makeFlailSwing(), phase: 'swing', side: 'R', t: FLAIL_SWING.strikeT });
    expect(v[1]).toBeLessThan(0);                      // coming down…
    expect(Math.abs(v[1])).toBeGreaterThanOrEqual(Math.abs(v[0]));   // …more down than across
  });

  it('H is a flat right-to-left sweep through the crosshair', () => {
    const at = (t: number) => flailPose({ phase: 'swing', side: 'H', t, struck: false, queued: false, nextSide: 'H', swingId: 1, idleT: 0 });
    const wind = at(0.12);
    expect(wind.ball[0]).toBeGreaterThanOrEqual(0.55);           // wound up wide right
    expect(Math.abs(wind.ball[1])).toBeLessThanOrEqual(0.2);     // at shoulder height, not overhead
    const follow = at(0.33);
    expect(follow.ball[0]).toBeLessThanOrEqual(-0.5);            // follows through far left
    const v = flailBallVel({ ...makeFlailSwing(), phase: 'swing', side: 'H', t: FLAIL_TIMING.H.strikeT });
    expect(v[0]).toBeLessThan(0);                                // moving right → left
    expect(Math.abs(v[0])).toBeGreaterThanOrEqual(2 * Math.abs(v[1]));   // flat
  });

  it('H, a longer swing, runs on its own timing: 0.55 s, the strike at 0.2 s; R and L keep FLAIL_SWING', () => {
    expect(FLAIL_TIMING.R).toEqual({ swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT });
    expect(FLAIL_TIMING.L).toEqual({ swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT });
    expect(FLAIL_TIMING.H).toEqual({ swingSec: 0.55, strikeT: 0.2 });
    for (const side of SIDES) {
      const times = flailKeyTimes(side);
      expect(times[0], side).toBe(0);
      expect(times[times.length - 1], side).toBe(FLAIL_TIMING[side].swingSec);
      expect(times, side).toContain(FLAIL_TIMING[side].strikeT);
    }
    expect(flailKeyTimes('H')).toEqual([0, 0.07, 0.12, 0.17, 0.2, 0.33, 0.43, 0.55]);
  });

  it('has no pops: ball ≤ 15 cm and grip ≤ 6 cm per 240 Hz step, through chained swings', () => {
    // The ball legitimately moves ~20 m/s into the strike (~8 cm per step); a pop is a jump far beyond that.
    let s = makeFlailSwing();
    let prev = flailPose(s);
    let worstBall = 0, worstGrip = 0;
    for (let i = 0; i < Math.round((3 * FLAIL_SWING.swingSec + 0.2) / DT); i++) {
      s = stepFlailSwing(s, { click: i === 0, held: i * DT < 2 * FLAIL_SWING.swingSec }, DT).state;
      const p = flailPose(s);
      worstBall = Math.max(worstBall, dist(p.ball, prev.ball));
      worstGrip = Math.max(worstGrip, dist(p.grip, prev.grip));
      prev = p;
    }
    expect(worstBall).toBeLessThan(0.15);
    expect(worstGrip).toBeLessThan(0.06);
  });

  it('H has no pops either: ball ≤ 15 cm and grip ≤ 6 cm per 240 Hz step, from rest to rest', () => {
    const S = FLAIL_TIMING.H;
    let prev = flailPose(makeFlailSwing());   // idle: FLAIL_REST
    let worstBall = 0, worstGrip = 0;
    for (let i = 0; i <= Math.round(S.swingSec / DT); i++) {
      const p = flailPose(swingOf('H', Math.min(i * DT, S.swingSec)));
      worstBall = Math.max(worstBall, dist(p.ball, prev.ball));
      worstGrip = Math.max(worstGrip, dist(p.grip, prev.grip));
      prev = p;
    }
    const idle = flailPose(makeFlailSwing());
    worstBall = Math.max(worstBall, dist(idle.ball, prev.ball));
    worstGrip = Math.max(worstGrip, dist(idle.grip, prev.grip));
    expect(worstBall).toBeLessThan(0.15);
    expect(worstGrip).toBeLessThan(0.06);
  });

  /** Finite-difference ball speed (m/s) at time `t` within a single swing. */
  function ballSpeed(side: FlailSide, t: number, eps = 1e-4): number {
    const lo = Math.max(0, t - eps), hi = Math.min(FLAIL_TIMING[side].swingSec, t + eps);
    const a = flailPose({ phase: 'swing', side, t: lo, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
    const b = flailPose({ phase: 'swing', side, t: hi, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
    return dist(b.ball, a.ball) / (hi - lo);
  }

  it('carries the ball through the strike near full speed, not slowing to a stop', () => {
    for (const side of SIDES) {
      const { strikeT } = FLAIL_TIMING[side];
      let peak = 0;
      for (let t = strikeT - 0.06; t <= strikeT + 0.12 + 1e-9; t += 1 / 480) peak = Math.max(peak, ballSpeed(side, t));
      const atStrike = ballSpeed(side, strikeT);
      expect(atStrike, side).toBeGreaterThanOrEqual(0.8 * peak);
    }
  });

  it('has no speed jump over 2x between consecutive 240 Hz samples, away from the rest ends', () => {
    // "Rest ends" includes the windup apex, which is a genuine momentary pause
    // (like the top of a golf backswing) — a smooth deceleration through a
    // near-zero speed necessarily produces large sample-to-sample RATIOS near
    // that zero crossing even though the curve itself is perfectly continuous.
    // REST_SPEED is well below the ~6-17 m/s the ball otherwise carries.
    const REST_SPEED = 1.0;
    for (const side of SIDES) {
      let prev: number | null = null;
      for (let t = DT; t < FLAIL_TIMING[side].swingSec - DT; t += DT) {
        const speed = ballSpeed(side, t);
        if (prev !== null && prev > REST_SPEED && speed > REST_SPEED) {
          const ratio = speed / prev;
          expect(ratio, `${side} t=${t.toFixed(4)}`).toBeLessThan(2);
          expect(ratio, `${side} t=${t.toFixed(4)}`).toBeGreaterThan(0.5);
        }
        prev = speed;
      }
    }
  });

  it('overshoots no key by more than 3 cm, on either the ball or the grip', () => {
    // flailKeyTimes(side) minus the helper keys (which only hold the chain out
    // between the main ones): rest, the back beat (v1.4: the hand draws back,
    // the ball out behind it — a main key, so its reach counts), wind-up,
    // strike, follow-through, rest.
    const mainTimes: Record<FlailSide, number[]> = { R: [0, 0.06, 0.1, 0.18, 0.3, 0.45], L: [0, 0.06, 0.1, 0.18, 0.3, 0.45], H: [0, 0.07, 0.12, 0.2, 0.33, 0.55] };
    for (const side of SIDES) {
      const keyTimes = flailKeyTimes(side).filter(t => mainTimes[side].includes(t));
      expect(keyTimes, side).toEqual(mainTimes[side]);
      const swingSec = FLAIL_TIMING[side].swingSec;
      const at = (t: number) => flailPose({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
      const keyPoses = keyTimes.map(at);
      for (const field of ['ball', 'grip'] as const) {
        for (const axis of [0, 1, 2] as const) {
          const vals = keyPoses.map(p => p[field][axis]);
          const lo = Math.min(...vals) - 0.03, hi = Math.max(...vals) + 0.03;
          for (let t = 0; t <= swingSec + 1e-9; t += 1 / 480) {
            const v = at(Math.min(t, swingSec))[field][axis];
            expect(v, `${side} ${field}[${axis}] t=${t.toFixed(4)}`).toBeGreaterThanOrEqual(lo);
            expect(v, `${side} ${field}[${axis}] t=${t.toFixed(4)}`).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  });

  /** The eye bolt: grip + R·(0, anchorY, 0), R the haft's XYZ Euler (three's
   *  order: R = Rx·Ry·Rz, so the vector is turned by z, then y, then x). */
  function bolt(grip: readonly number[], rot: readonly number[]): number[] {
    let x = 0, y: number = FLAIL_CHAIN.anchorY, z = 0;
    const [ax, ay, az] = rot as [number, number, number];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    return [grip[0]! + x, grip[1]! + y, grip[2]! + z];
  }

  it("this test's bolt helper is flailBolt (the module's), at several swing times", () => {
    for (const side of SIDES) {
      const times = side === 'H' ? [0.05, ...flailKeyTimes('H'), 0.25] : [0, 0.05, 0.1, 0.15, FLAIL_SWING.strikeT, 0.25, 0.3, 0.37, FLAIL_SWING.swingSec];
      for (const t of times) {
        const p = flailPose({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
        const a = bolt(p.grip, p.rot), b = flailBolt(p);
        for (const k of [0, 1, 2] as const) expect(b[k], `${side} t=${t}`).toBeCloseTo(a[k]!, 12);
      }
    }
  });

  it('keeps the ball within chain reach of the eye bolt at every key (the chain sim can reach every key)', () => {
    expect(chainReach()).toBeCloseTo(FLAIL_CHAIN.len + FLAIL_CHAIN.ringOffset, 9);
    for (const side of SIDES) {
      const times = flailKeyTimes(side);
      for (const t of times) {
        const p = flailPose({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
        expect(dist(p.ball, bolt(p.grip, p.rot)), `${side} t=${t}`).toBeLessThanOrEqual(chainReach());
      }
    }
    expect(dist(FLAIL_REST.ball, bolt(FLAIL_REST.grip, FLAIL_REST.rot))).toBeLessThanOrEqual(chainReach());
  });

  it('keeps the keyed ball ≥ 0.28 m from the eye bolt over the whole swing (no slack loop above the haft)', () => {
    // The ball's spline is a chord between keys while the bolt sweeps an arc
    // with the haft; with only wind-up → strike keys the chord cut to 0.19 m
    // of the bolt just before the strike, and the chain bunched into a loop.
    for (const side of SIDES) {
      const swingSec = FLAIL_TIMING[side].swingSec;
      let min = Infinity, at = 0;
      for (let t = 0; t <= swingSec + 1e-9; t += 1 / 480) {
        const p = flailPose({ phase: 'swing', side, t: Math.min(t, swingSec), struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
        const r = dist(p.ball, bolt(p.grip, p.rot));
        if (r < min) { min = r; at = t; }
      }
      expect(min, `${side} min at t=${at.toFixed(3)}`).toBeGreaterThanOrEqual(0.28);
    }
  });

  it('holds the chain nearly taut at the strike: the ball 0.34–0.36 m from the bolt', () => {
    for (const side of SIDES) {
      const p = flailPose({ phase: 'swing', side, t: FLAIL_TIMING[side].strikeT, struck: false, queued: false, nextSide: side, swingId: 1, idleT: 0 });
      const r = dist(p.ball, bolt(p.grip, p.rot));
      expect(r, side).toBeGreaterThanOrEqual(0.34);
      expect(r, side).toBeLessThanOrEqual(0.36);
    }
  });
});

describe('flailBolt / flailBallVel', () => {
  it('flailBolt is the haft tip anchorY up the haft from the grip', () => {
    const p = flailPose(makeFlailSwing());
    expect(dist(flailBolt(p), p.grip)).toBeCloseTo(FLAIL_CHAIN.anchorY, 9);
    expect(flailBolt({ grip: [1, 2, 3], rot: [0, 0, 0], ball: [0, 0, 0] })).toEqual([1, 2 + FLAIL_CHAIN.anchorY, 3]);
  });
  it('flailBallVel is zero at idle and matches the ball curve mid-swing', () => {
    expect(flailBallVel(makeFlailSwing())).toEqual([0, 0, 0]);
    const s: FlailSwing = { ...makeFlailSwing(), phase: 'swing', side: 'R', t: FLAIL_SWING.strikeT };
    const v = flailBallVel(s), h = 1 / 960;
    const a = flailPose({ ...s, t: s.t - h }).ball, b = flailPose({ ...s, t: s.t + h }).ball;
    for (const k of [0, 1, 2] as const) expect(v[k]).toBeCloseTo((b[k] - a[k]) / (2 * h), 0);
    expect(Math.hypot(...v)).toBeGreaterThan(5);   // the ball is moving fast through the hit
  });
});
