// src/lab/sdf-zombie/webgpu/censer-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_SWING, cancelCenserSwing, deadzoneOffset, handlePose, hitWindow,
  makeCenserSwing, stepCenserSwing, strokeDirection, type CenserSwing, type Dir2,
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
});

describe('handlePose', () => {
  it('has no pops through a tap and a full heavy swing (< 5 cm per 240 Hz step)', () => {
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
    expect(worst).toBeLessThan(0.05);
  });
  it('the stroke sweeps along its direction', () => {
    let s = run(makeCenserSwing(), 0.05, true, { x: 1, y: 0 });
    s = stepCenserSwing(s, { down: false, offset: { x: 1, y: 0 } }, DT);   // travel (-1, 0)
    s = run(s, CENSER_SWING.tapStrokeSec * 0.99, false, { x: 1, y: 0 });
    expect(s.phase).toBe('stroke');
    expect(handlePose(s)[0]).toBeLessThan(-0.2);   // swept to the left
  });
  it('rests at zero when idle', () => {
    expect(handlePose(makeCenserSwing())).toEqual([0, 0, 0]);
  });
});
