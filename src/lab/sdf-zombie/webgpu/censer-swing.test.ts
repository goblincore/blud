// src/lab/sdf-zombie/webgpu/censer-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_SWING, assertStrokeShape, cancelCenserSwing, deadzoneOffset, handHold, handlePose, hitWindow,
  makeCenserSwing, ropeLength, stepCenserSwing, strokeDirection, type CenserSwing, type Dir2,
} from './censer-swing';
import { FREE_AIM } from './free-aim';
import { CENSER_HEAD, makeCenserHead, stepCenserHead } from './censer-head';
import type { Vec3 } from '../types';

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

describe('stroke shape invariant (arcProgress needs accelEnd + brakeFrac < 1)', () => {
  it('the current tap and heavy constants satisfy it', () => {
    for (const K of [CENSER_SWING.tap, CENSER_SWING.heavy]) {
      expect(K.accelEnd).toBeGreaterThan(0);
      expect(K.brakeFrac).toBeGreaterThan(0);
      expect(K.accelEnd + K.brakeFrac).toBeLessThan(1);
    }
    expect(() => assertStrokeShape('tap', CENSER_SWING.tap)).not.toThrow();
    expect(() => assertStrokeShape('heavy', CENSER_SWING.heavy)).not.toThrow();
  });
  it('a violating shape throws, naming it', () => {
    expect(() => assertStrokeShape('heavy', { ...CENSER_SWING.heavy, accelEnd: 0.7, brakeFrac: 0.4 }))
      .toThrow(/CENSER_SWING\.heavy/);
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
  it('has no pops for a release at any phase of the spin, in any direction', () => {
    let worst = 0;
    const offs: Dir2[] = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -0.7, y: -0.7 }];
    for (const offset of offs) {
      for (const hold of [0.25, 0.4, 0.55, 0.7, 1.2, 1.28, 1.36, 1.44]) {
        let s = makeCenserSwing();
        let prev = handlePose(s);
        for (let i = 0; i < Math.round((hold + 1) / DT); i++) {
          s = stepCenserSwing(s, { down: i * DT < hold, offset }, DT);
          const p = handlePose(s);
          worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
          prev = p;
        }
      }
    }
    expect(worst).toBeLessThan(POP_BOUND);
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
  it('is full late in a tap (it pays out through the cruise) and mid-stroke in a heavy', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    s = run(s, CENSER_SWING.tapStrokeSec * 0.5, false);
    expect(ropeLength(s, FULL)).toBeLessThan(FULL);   // still reeled in part-way: the hand drags the head first
    s = run(s, CENSER_SWING.tapStrokeSec * 0.3, false);
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

// ---------------------------------------------------------------------------
// HEAD SPEED (spec §3.3: ~9 m/s on a tap, ~16 m/s on a full charge).
//
// The pure model the swing was tuned in. The camera fixed at the origin looking
// down -z (view = world, y up), the knot at the rest grip + the haft's knot
// offset + handlePose — the haft's tilt applied to a fixed offset, not rotated
// by the swing (game-censer rotates nothing either: the handle only
// translates). Mirrors CENSER_REST in game-censer.ts (0.22, -0.16, -0.46; tilt
// -65 deg; knot 0.255 up the haft). No camera motion, no bodies in the way.
//
// Measured 2026-09-26 (printed below): tap 13.11, half charge 16.32, full
// charge 20.96 m/s, all with the head fastest ~1.1-1.4 m out in front of the
// eye. Before the arc/orbit rework the same model gave tap 2.89 and heavy 2.46.
// Floors are the spec's acceptance numbers, not the measurements, so tuning
// has room; the regression guard is the 0.9 x measured floor.
const REST: Vec3 = [0.22, -0.16, -0.46];
const TILT = (-65 * Math.PI) / 180;
const KNOT_UP = 0.255;
const knotAt = (s: CenserSwing): Vec3 => {
  const p = handlePose(s);
  return [REST[0] + p[0], REST[1] + p[1] + KNOT_UP * Math.cos(TILT), REST[2] + p[2] + KNOT_UP * Math.sin(TILT)];
};
const OPEN_WORLD = { floorY: -100, boxes: [] };
const TAP_PEAK_MEASURED = 13.11;
const HEAVY_PEAK_MEASURED = 20.96;
const FULL_HOLD = CENSER_SWING.holdSec + CENSER_SWING.chargeSec + 0.1;
/** Settle at rest, press for `holdSec`, release; measure over the hit window. */
function measureStroke(holdSec: number, offset: Dir2 = { x: 0, y: 0 }): { peak: number; ext: number; at: Vec3 } {
  let s = makeCenserSwing();
  let h = makeCenserHead(knotAt(s), ropeLength(s, CENSER_HEAD.ropeLen));
  const step = (down: boolean) => {
    s = stepCenserSwing(s, { down, offset }, DT);
    h = stepCenserHead(h, knotAt(s), DT, OPEN_WORLD, undefined, ropeLength(s, CENSER_HEAD.ropeLen), handHold(s));
  };
  for (let i = 0; i < 240; i++) step(false);
  for (let i = 0; i < Math.round(holdSec / DT); i++) step(true);
  let peak = 0, ext = 0, seen = false;
  let at: Vec3 = [0, 0, 0];
  for (let i = 0; i < 480; i++) {
    step(false);
    if (!hitWindow(s)) { if (seen) break; continue; }
    seen = true;
    const k = knotAt(s);
    const v = Math.hypot(h.vel[0], h.vel[1], h.vel[2]);
    if (v > peak) { peak = v; at = h.pos; }
    ext = Math.max(ext, Math.hypot(h.pos[0] - k[0], h.pos[1] - k[1], h.pos[2] - k[2]));
  }
  return { peak, ext, at };
}
const fmt = (m: { peak: number; ext: number; at: Vec3 }) =>
  `peak ${m.peak.toFixed(3)} m/s at (${m.at.map((c) => c.toFixed(2)).join(', ')}), ${Math.hypot(...m.at).toFixed(2)} m from the eye; max extension ${m.ext.toFixed(3)} m`;
/** Where a zombie would be: in front of the eye, 0.8-1.6 m out. */
const expectInFront = (at: Vec3) => {
  expect(at[2]).toBeLessThan(-0.6);
  expect(Math.hypot(...at)).toBeGreaterThan(0.8);
  expect(Math.hypot(...at)).toBeLessThan(1.6);
};

describe('head speed over the hit window (spec targets tap ~9, heavy ~16; measured 13/21; gates 8/14)', () => {
  it('a tap reaches >= 8 m/s, in front of the player, on the full rope', () => {
    const m = measureStroke(0.05);
    console.log(`[censer power] tap ${fmt(m)}`);
    expect(m.peak).toBeGreaterThanOrEqual(8);
    expect(m.peak).toBeGreaterThanOrEqual(0.9 * TAP_PEAK_MEASURED);
    expect(m.ext).toBeGreaterThanOrEqual(CENSER_HEAD.ropeLen - 1e-3);
    expectInFront(m.at);
  });
  it('a tap in any direction reaches >= 8 m/s', () => {
    for (const o of [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0.7, y: -0.7 }]) {
      const m = measureStroke(0.05, o);
      expect(m.peak).toBeGreaterThanOrEqual(8);
      expectInFront(m.at);
    }
  });
  it('a half charge', () => {
    const m = measureStroke(CENSER_SWING.holdSec + 0.5 * CENSER_SWING.chargeSec);
    console.log(`[censer power] half charge ${fmt(m)}`);
    expect(m.peak).toBeGreaterThanOrEqual(8);
    expectInFront(m.at);
  });
  it('a full-charge heavy reaches >= 14 m/s, faster than a tap, in front, on the full rope', () => {
    const m = measureStroke(FULL_HOLD);
    console.log(`[censer power] heavy ${fmt(m)}`);
    expect(m.peak).toBeGreaterThanOrEqual(14);
    expect(m.peak).toBeGreaterThanOrEqual(0.9 * HEAVY_PEAK_MEASURED);
    expect(m.peak).toBeGreaterThan(measureStroke(0.05).peak);
    expect(m.ext).toBeGreaterThanOrEqual(CENSER_HEAD.ropeLen - 1e-3);
    expectInFront(m.at);
  });
  it('a full-charge heavy stays >= 14 m/s whatever the spin phase at release', () => {
    // One spin period at spinHzMax is ~0.34 s; sample 0.5 s of release times.
    const peaks: number[] = [];
    for (let k = 0; k < 12; k++) peaks.push(measureStroke(FULL_HOLD + (k * 0.5) / 12).peak);
    console.log(`[censer power] heavy by release phase: ${peaks.map((p) => p.toFixed(1)).join(' ')}`);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(14);
  });
});

describe('handHold (the hand on the chain)', () => {
  it('grips while pending and through the choke-up, then lets go; free in a stroke and at rest', () => {
    let s = makeCenserSwing();
    expect(handHold(s)).toEqual({ grip: 0, drive: null });
    s = run(s, 0.05, true);
    expect(s.phase).toBe('pending');
    expect(handHold(s).grip).toBe(CENSER_SWING.gripHold);
    s = run(s, CENSER_SWING.holdSec + 0.02, true);
    expect(s.phase).toBe('windup');
    expect(handHold(s).grip).toBeGreaterThan(0.9 * CENSER_SWING.gripHold);
    s = run(s, CENSER_SWING.spinPayoutStart + 0.1, true);
    expect(handHold(s).grip).toBe(0);
    s = run(s, 0.02, false);
    expect(s.phase).toBe('stroke');
    expect(handHold(s)).toEqual({ grip: 0, drive: null });
  });
  it("the wrist's floor starts with the pay-out, rises with the charge, and lies in the stroke plane", () => {
    const offset = { x: 0, y: 1 };
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 1 / 240, true, offset);
    expect(s.phase).toBe('windup');
    expect(handHold(s).drive).toBeNull();                       // t ≈ 0: still choking up
    s = run(s, 0.5, true, offset);
    const half = handHold(s).drive!;
    s = run(s, CENSER_SWING.chargeSec, true, offset);
    const full = handHold(s).drive!;
    expect(full.speed).toBeGreaterThan(half.speed);
    expect(full.speed).toBeCloseTo(CENSER_SWING.spinFloor[1], 5);
    // Overhead slam: the plane is vertical (up/down + forward), its normal is ±x.
    expect(Math.abs(full.normal[0])).toBeCloseTo(1, 5);
    expect(full.normal[1]).toBeCloseTo(0, 5);
    expect(full.normal[2]).toBeCloseTo(0, 5);
  });
});

// The wind-up used to form its orbit only from a head hanging still. Pressed
// while the reeled head was still swinging from the last stroke, the open-loop
// windmill sometimes drove the anti-phase wobble instead and a full charge
// swung at 3–5 m/s (3% of presses in this model, 14% overhead; 4 of 13 in game).
describe('a full charge forms whatever the head was doing at the press', () => {
  const ROBUST_OFFSETS: Dir2[] = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];
  it('after a tap or a heavy, pressed 0-0.9 s into idle, from every side: >= 14 m/s', () => {
    let worst = Infinity;
    for (const offset of ROBUST_OFFSETS) for (const prevHold of [0.05, 0.4, 1.3]) for (let gap = 0; gap <= 0.9; gap += 0.15) {
      let s = makeCenserSwing();
      let h = makeCenserHead(knotAt(s), ropeLength(s, CENSER_HEAD.ropeLen));
      const step = (down: boolean) => {
        s = stepCenserSwing(s, { down, offset }, 1 / 60);
        h = stepCenserHead(h, knotAt(s), 1 / 60, OPEN_WORLD, undefined, ropeLength(s, CENSER_HEAD.ropeLen), handHold(s));
      };
      for (let i = 0; i < 60; i++) step(false);
      for (let i = 0; i < Math.round(prevHold * 60); i++) step(true);
      for (let i = 0; i < 200 && s.phase !== 'idle'; i++) step(false);
      for (let i = 0; i < Math.round(gap * 60); i++) step(false);
      for (let i = 0; i < Math.round(FULL_HOLD * 60); i++) step(true);
      let peak = 0;
      for (let i = 0; i < 60; i++) { step(false); if (hitWindow(s)) peak = Math.max(peak, Math.hypot(...h.vel)); }
      worst = Math.min(worst, peak);
    }
    console.log(`[censer power] worst full charge after a previous stroke: ${worst.toFixed(1)} m/s`);
    expect(worst).toBeGreaterThanOrEqual(14);
  });
});
