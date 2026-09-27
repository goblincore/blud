// src/lab/sdf-zombie/webgpu/flail-swing.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  FLAIL_CHAIN, FLAIL_IMPACT, FLAIL_REST, maxBallBolt, FLAIL_SWING, cancelFlailSwing, flailPose, makeFlailSwing, stepFlailSwing,
  type FlailSide, type FlailSwing,
} from './flail-swing';

const DT = 1 / 240;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

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

  it('sides alternate click to click', () => {
    let r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
    r = run(r.s, FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['L']);
    r = run(r.s, FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
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
    const r = run(makeFlailSwing(), 3 * FLAIL_SWING.swingSec + 0.01, true, true);
    expect(r.strikes).toEqual(['R', 'L', 'R']);
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
    expect(r.state).toEqual(idle);
    expect(r.strikes).toEqual([]);
  });

  it('the buffer check uses the post-step time: a step landing exactly on the boundary counts', () => {
    const dt = DT;
    const t0 = FLAIL_SWING.swingSec - FLAIL_SWING.bufferSec - dt; // t0 + dt lands exactly on the boundary
    const s: FlailSwing = { phase: 'swing', side: 'R', t: t0, struck: true, queued: false, nextSide: 'L', swingId: 1 };
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

  it('a chained huge dt strikes each swing exactly once, still alternating', () => {
    let s = makeFlailSwing();
    const allStrikes: FlailSide[] = [];
    for (let i = 0; i < 6; i++) {
      const r = stepFlailSwing(s, { click: i === 0, held: true }, FLAIL_SWING.swingSec + 0.37);
      s = r.state;
      allStrikes.push(...r.strikes);
    }
    expect(allStrikes.length).toBe(s.swingId);
    expect(allStrikes).toEqual(allStrikes.map((_, i) => (i % 2 === 0 ? 'R' : 'L')));
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
    for (const side of ['R', 'L'] as const) {
      const s: FlailSwing = { ...makeFlailSwing(), phase: 'swing', side, t: FLAIL_SWING.strikeT };
      expect(dist(flailPose(s).ball, FLAIL_IMPACT[side])).toBeLessThan(1e-9);
    }
  });

  it('the strike is in front of the eye, and R and L mirror across the centre line', () => {
    expect(FLAIL_IMPACT.R[2]).toBeLessThan(-0.8);
    expect(FLAIL_IMPACT.L[2]).toBeLessThan(-0.8);
    expect(Math.abs(FLAIL_IMPACT.R[0] + FLAIL_IMPACT.L[0])).toBeLessThan(0.2);
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

  /** Finite-difference ball speed (m/s) at time `t` within a single swing. */
  function ballSpeed(side: FlailSide, t: number, eps = 1e-4): number {
    const lo = Math.max(0, t - eps), hi = Math.min(FLAIL_SWING.swingSec, t + eps);
    const a = flailPose({ phase: 'swing', side, t: lo, struck: false, queued: false, nextSide: side, swingId: 1 });
    const b = flailPose({ phase: 'swing', side, t: hi, struck: false, queued: false, nextSide: side, swingId: 1 });
    return dist(b.ball, a.ball) / (hi - lo);
  }

  it('carries the ball through the strike near full speed, not slowing to a stop', () => {
    for (const side of ['R', 'L'] as const) {
      let peak = 0;
      for (let t = 0.12; t <= 0.3 + 1e-9; t += 1 / 480) peak = Math.max(peak, ballSpeed(side, t));
      const atStrike = ballSpeed(side, FLAIL_SWING.strikeT);
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
    for (const side of ['R', 'L'] as const) {
      let prev: number | null = null;
      for (let t = DT; t < FLAIL_SWING.swingSec - DT; t += DT) {
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
    const keyTimes = [0, 0.1, 0.18, 0.3, 0.45];
    for (const side of ['R', 'L'] as const) {
      const at = (t: number) => flailPose({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1 });
      const keyPoses = keyTimes.map(at);
      for (const field of ['ball', 'grip'] as const) {
        for (const axis of [0, 1, 2] as const) {
          const vals = keyPoses.map(p => p[field][axis]);
          const lo = Math.min(...vals) - 0.03, hi = Math.max(...vals) + 0.03;
          for (let t = 0; t <= FLAIL_SWING.swingSec + 1e-9; t += 1 / 480) {
            const v = at(Math.min(t, FLAIL_SWING.swingSec))[field][axis];
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

  it('keeps the ball within chain reach of the eye bolt at every key (the renderer need not clamp a key)', () => {
    expect(maxBallBolt()).toBeCloseTo(0.415, 6);
    for (const side of ['R', 'L'] as const) {
      for (const t of [0, 0.1, FLAIL_SWING.strikeT, 0.3, FLAIL_SWING.swingSec]) {
        const p = flailPose({ phase: 'swing', side, t, struck: false, queued: false, nextSide: side, swingId: 1 });
        expect(dist(p.ball, bolt(p.grip, p.rot)), `${side} t=${t}`).toBeLessThanOrEqual(maxBallBolt());
      }
    }
    expect(dist(FLAIL_REST.ball, bolt(FLAIL_REST.grip, FLAIL_REST.rot))).toBeLessThanOrEqual(maxBallBolt());
  });
});
