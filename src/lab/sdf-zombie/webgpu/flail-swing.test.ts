// src/lab/sdf-zombie/webgpu/flail-swing.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  FLAIL_IMPACT, FLAIL_REST, FLAIL_SWING, cancelFlailSwing, flailPose, makeFlailSwing, stepFlailSwing,
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
});
