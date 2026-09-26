// src/lab/sdf-zombie/webgpu/censer-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_SWING, cancelCenserSwing, deadzoneOffset, handlePose, hitWindow,
  makeCenserSwing, ropeLength, stepCenserSwing, strokeDirection, type CenserSwing, type Dir2,
} from './censer-swing';
import { FREE_AIM } from './free-aim';

const DT = 1 / 240;
const run = (s: CenserSwing, sec: number, down: boolean, offset: Dir2 = { x: 0, y: 0 }): CenserSwing => {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) s = stepCenserSwing(s, { down, offset }, DT);
  return s;
};
const near = (a: Dir2, b: Dir2) => { expect(a.x).toBeCloseTo(b.x, 5); expect(a.y).toBeCloseTo(b.y, 5); };

describe('deadzoneOffset', () => {
  it('is ±1 at the dead-zone edge and clamps beyond it', () => {
    near(deadzoneOffset({ x: FREE_AIM.deadzoneX, y: -FREE_AIM.deadzoneY }), { x: 1, y: -1 });
    near(deadzoneOffset({ x: 0.9, y: 0 }), { x: 1, y: 0 });
  });
});

describe('strokeDirection', () => {
  it('runs from the weapon toward the opposite side', () => {
    near(strokeDirection({ x: 0, y: 1 }), { x: 0, y: -1 });   // high → overhead slam
    near(strokeDirection({ x: 0, y: -1 }), { x: 0, y: 1 });   // low → uppercut
    near(strokeDirection({ x: 1, y: 0 }), { x: -1, y: 0 });   // right → hook back left
    near(strokeDirection({ x: -1, y: 0 }), { x: 1, y: 0 });   // left → hook back right
  });
  it('centred is the default diagonal, upper right to lower left', () => {
    near(strokeDirection({ x: 0, y: 0 }), { x: -Math.SQRT1_2, y: -Math.SQRT1_2 });
  });
  it('blends continuously out of the centre', () => {
    let prev = strokeDirection({ x: 0, y: 0 });
    for (let m = 0.01; m <= 0.4; m += 0.01) {
      const d = strokeDirection({ x: m, y: 0.3 * m });
      expect(Math.acos(Math.min(1, d.x * prev.x + d.y * prev.y))).toBeLessThan(0.25);
      prev = d;
    }
  });
});

describe('stepCenserSwing', () => {
  it('a tap is a quick stroke, then a recover, then idle', () => {
    let s = run(makeCenserSwing(), 0.1, true);
    expect(s.phase).toBe('pending');
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('stroke');
    expect(s.heavy).toBe(false);
    expect(s.charge).toBe(0);
    expect(s.strokeId).toBe(1);
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    s = run(s, CENSER_SWING.tapRecoverSec + 0.01, false);
    expect(s.phase).toBe('idle');
  });
  it('holding past the threshold winds up and charges over chargeSec', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.01, true);
    expect(s.phase).toBe('windup');
    s = run(s, 0.5, true);
    expect(s.charge).toBeGreaterThan(0.45);
    expect(s.charge).toBeLessThan(0.56);
    s = run(s, 3, true);
    expect(s.charge).toBe(1);
    expect(s.phase).toBe('windup');   // the spin can be held at full charge
  });
  it('release after a wind-up is a heavy stroke that keeps its charge', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.6, true);
    const charge = s.charge;
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('stroke');
    expect(s.heavy).toBe(true);
    expect(s.charge).toBeCloseTo(charge, 2);
    s = run(s, CENSER_SWING.heavyStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    s = run(s, CENSER_SWING.heavyRecoverSec + 0.01, false);
    expect(s.phase).toBe('idle');
  });
  it('reads the direction at release, not at press', () => {
    let s = run(makeCenserSwing(), 1.0, true, { x: 1, y: 0 });
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 1 } }, DT);
    near(s.dir, { x: 0, y: -1 });
  });
  it('the hit window is the stroke and its recover', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    expect(hitWindow(s)).toBe(false);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(hitWindow(s)).toBe(true);
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    expect(hitWindow(s)).toBe(true);
    s = run(s, CENSER_SWING.tapRecoverSec + 0.01, false);
    expect(hitWindow(s)).toBe(false);
  });
  it('cancel returns to idle and keeps the stroke counter', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    const c = cancelCenserSwing(s);
    expect(c.phase).toBe('idle');
    expect(c.strokeId).toBe(1);
  });
  it('strokeId increments on a heavy stroke', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.6, true);
    const idBefore = s.strokeId;
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('stroke');
    expect(s.heavy).toBe(true);
    expect(s.strokeId).toBe(idBefore + 1);
  });
  it('dt 0 or negative leaves the state unchanged', () => {
    const s = run(makeCenserSwing(), 0.05, true);
    expect(stepCenserSwing(s, { down: true, offset: { x: 0, y: 0 } }, 0)).toEqual(s);
    expect(stepCenserSwing(s, { down: true, offset: { x: 0, y: 0 } }, -0.01)).toEqual(s);
  });
});

describe('press edge and buffer', () => {
  it('holding through a whole tap cycle does not start a second swing', () => {
    let s = run(makeCenserSwing(), 0.05, true);   // pending (fresh press)
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);   // release -> tap stroke
    expect(s.phase).toBe('stroke');
    // re-press immediately and hold continuously through stroke, recover, into idle and beyond
    s = run(s, CENSER_SWING.tapStrokeSec + CENSER_SWING.tapRecoverSec + 1, true);
    expect(s.phase).toBe('idle');   // never restarted — the hold was never a fresh edge at idle
  });
  it('release then press again at idle starts a new one', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);   // tap stroke
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);
    s = run(s, CENSER_SWING.tapRecoverSec + 0.01, false);
    expect(s.phase).toBe('idle');
    s = stepCenserSwing(s, { down: true, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('pending');
  });
  it('a press in the last 0.1s of recover produces the next stroke without another press', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);   // tap stroke, strokeId 1
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);   // recover
    expect(s.phase).toBe('recover');
    // advance to leave < 0.1s of recover remaining
    s = run(s, CENSER_SWING.tapRecoverSec - 0.08, false);
    // a quick tap (press then release), still inside recover, within the last 0.1s
    s = stepCenserSwing(s, { down: true, offset: { x: 0, y: 0 } }, DT);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    const idBefore = s.strokeId;
    // let recover finish naturally (no further press) and catch it just after
    expect(s.buffered).toBe(true);
    s = run(s, 0.1, false);
    expect(s.phase).toBe('stroke');
    expect(s.strokeId).toBe(idBefore + 1);
  });
});

describe('dt-independent timing', () => {
  it('recover.t after exactly 0.30s since the release step agrees at 1/240 and 1/60 steps', () => {
    // 0.30 is an exact multiple of both 1/240 and 1/60, so it lands on a step
    // boundary either way — the release step itself counts as the first of
    // that 0.30s (the release is deemed to land at the START of its step).
    const recoverTAt030 = (dt: number): number => {
      let s = makeCenserSwing();
      s = stepCenserSwing(s, { down: true, offset: { x: 0, y: 0 } }, dt);    // press
      s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, dt);   // release -> stroke, t = dt
      const totalSteps = Math.round(0.3 / dt);
      for (let i = 1; i < totalSteps; i++) {
        s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, dt);
      }
      expect(s.phase).toBe('recover');
      return s.t;
    };
    const t240 = recoverTAt030(1 / 240);
    const t60 = recoverTAt030(1 / 60);
    expect(t240).toBeCloseTo(0.3 - CENSER_SWING.tapStrokeSec, 6);
    expect(t60).toBeCloseTo(0.3 - CENSER_SWING.tapStrokeSec, 6);
    expect(Math.abs(t240 - t60)).toBeLessThan(1e-6);
  });
});

const POP_BOUND = 0.035;

describe('handlePose', () => {
  it('has no pops through a tap and a full heavy swing (< 3.5 cm per 240 Hz step)', () => {
    let s = makeCenserSwing();
    let prev = handlePose(s);
    let worst = 0;
    const seq: Array<[number, boolean]> = [[0.1, true], [0.7, false], [1.6, true], [1.0, false]];
    for (const [sec, down] of seq) {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) {
        s = stepCenserSwing(s, { down, offset: { x: 0.6, y: 0.4 } }, DT);
        const p = handlePose(s);
        worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
        prev = p;
      }
    }
    expect(worst).toBeLessThan(POP_BOUND);
  });
  it('a release during the first 0.1s of wind-up has no pop', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.05, true);
    expect(s.phase).toBe('windup');
    expect(s.t).toBeLessThan(0.1);
    const prev = handlePose(s);
    s = stepCenserSwing(s, { down: false, offset: { x: 0.6, y: 0.4 } }, DT);
    expect(s.phase).toBe('stroke');
    const p = handlePose(s);
    const delta = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    expect(delta).toBeLessThan(POP_BOUND);
  });
  it('the stroke sweeps along its direction', () => {
    let s = run(makeCenserSwing(), 0.05, true, { x: 1, y: 0 });
    s = stepCenserSwing(s, { down: false, offset: { x: 1, y: 0 } }, DT);   // travel (-1, 0)
    s = run(s, CENSER_SWING.tapStrokeSec * 0.95, false, { x: 1, y: 0 });
    expect(s.phase).toBe('stroke');
    expect(handlePose(s)[0]).toBeLessThan(-0.2);   // swept to the left
  });
  it('rests at zero when idle', () => {
    expect(handlePose(makeCenserSwing())).toEqual([0, 0, 0]);
  });
});

describe('ropeLength (reeled in at rest, paid out to swing)', () => {
  const FULL = 0.55;
  it('is reelRest at idle and while a press is pending', () => {
    expect(ropeLength(makeCenserSwing(), FULL)).toBe(CENSER_SWING.reelRest);
    const s = run(makeCenserSwing(), 0.05, true);
    expect(s.phase).toBe('pending');
    expect(ropeLength(s, FULL)).toBe(CENSER_SWING.reelRest);
  });
  it('is full mid-stroke, for a tap and for a heavy', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    s = run(s, CENSER_SWING.tapStrokeSec * 0.5, false);
    expect(s.phase).toBe('stroke');
    expect(ropeLength(s, FULL)).toBeCloseTo(FULL, 6);
    let h = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.6, true);
    expect(h.phase).toBe('windup');
    expect(ropeLength(h, FULL)).toBeCloseTo(FULL, 6);
    h = stepCenserSwing(h, { down: false, offset: { x: 0, y: 0 } }, DT);
    h = run(h, CENSER_SWING.heavyStrokeSec * 0.5, false);
    expect(h.phase).toBe('stroke');
    expect(ropeLength(h, FULL)).toBeCloseTo(FULL, 6);
  });
  it('is full early in recover and reelRest again once idle', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    s = run(s, CENSER_SWING.tapStrokeSec + 0.02, false);
    expect(s.phase).toBe('recover');
    expect(ropeLength(s, FULL)).toBeCloseTo(FULL, 6);
    s = run(s, 1, false);
    expect(s.phase).toBe('idle');
    expect(ropeLength(s, FULL)).toBe(CENSER_SWING.reelRest);
  });
  it('has no pops (< 3.5 cm per 240 Hz step) through taps, a heavy, an early release and a buffered re-press', () => {
    let s = makeCenserSwing();
    let prev = ropeLength(s, FULL);
    let worst = 0;
    const seq: Array<[number, boolean]> = [
      [0.1, true], [0.7, false], [1.6, true], [1.0, false],
      [CENSER_SWING.holdSec + 0.03, true], [0.5, false],                       // release early in wind-up
      [0.05, true], [CENSER_SWING.tapStrokeSec + CENSER_SWING.tapRecoverSec - 0.08, false],
      [0.05, true], [1.0, false],                                               // buffered press
    ];
    for (const [sec, down] of seq) {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) {
        s = stepCenserSwing(s, { down, offset: { x: 0.6, y: 0.4 } }, DT);
        const r = ropeLength(s, FULL);
        worst = Math.max(worst, Math.abs(r - prev));
        prev = r;
      }
    }
    expect(worst).toBeLessThan(POP_BOUND);
  });
});
