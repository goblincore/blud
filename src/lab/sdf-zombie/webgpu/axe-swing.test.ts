// src/lab/sdf-zombie/webgpu/axe-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  AXE_BLADE_DIR, AXE_REST, AXE_SWING, AXE_TIMING, axeKeys, axeKeyTimes, axePose, cancelAxeSwing, makeAxeSwing, stepAxeSwing,
  type AxeSide, type AxeSwing,
} from './axe-swing';

const DT = 1 / 120;
const click = { click: true, held: true }, idle = { click: false, held: false };
function run(s: AxeSwing, secs: number, input = idle): { s: AxeSwing; strikes: AxeSide[] } {
  const strikes: AxeSide[] = [];
  for (let t = 0; t < secs - 1e-9; t += DT) { const r = stepAxeSwing(s, input, DT); s = r.state; strikes.push(...r.strikes); }
  return { s, strikes };
}

describe('axe swing: the combo', () => {
  it('idle waits for a click; a held button alone never starts a swing', () => {
    const r = run(makeAxeSwing(), 0.5, { click: false, held: true });
    expect(r.s.phase).toBe('idle');
    expect(r.strikes).toEqual([]);
  });
  it('a click starts H (the overhead); the strike fires exactly once, at strikeT', () => {
    let { state: s, strikes } = stepAxeSwing(makeAxeSwing(), click, DT);
    expect(s.phase).toBe('swing');
    expect(s.side).toBe('H');
    const r = run(s, AXE_TIMING.H.swingSec + 0.05);
    strikes = [...strikes, ...r.strikes];
    expect(strikes).toEqual(['H']);
    expect(r.s.phase).toBe('idle');
  });
  it('chained clicks run H -> R -> L -> H', () => {
    let s = makeAxeSwing();
    const sides: AxeSide[] = [];
    for (let i = 0; i < 4; i++) {
      s = stepAxeSwing(s, click, DT).state;
      sides.push(s.side);
      s = run(s, AXE_TIMING[s.side].swingSec + 0.02).s;   // ends inside the combo window
    }
    expect(sides).toEqual(['H', 'R', 'L', 'H']);
  });
  it('an unchained click (after the combo window) restarts at H', () => {
    let s = stepAxeSwing(makeAxeSwing(), click, DT).state;
    s = run(s, AXE_TIMING.H.swingSec + AXE_SWING.comboWindowSec + 0.1).s;
    s = stepAxeSwing(s, click, DT).state;
    expect(s.side).toBe('H');
  });
  it('a click in the last bufferSec queues the next chop', () => {
    let s = stepAxeSwing(makeAxeSwing(), click, DT).state;
    s = run(s, AXE_TIMING.H.swingSec - AXE_SWING.bufferSec / 2).s;
    s = stepAxeSwing(s, click, DT).state;
    expect(s.queued).toBe(true);
    s = run(s, AXE_SWING.bufferSec).s;
    expect(s.phase).toBe('swing');
    expect(s.side).toBe('R');
  });
  it('the strike does not fire before strikeT, and fires on the step that crosses it', () => {
    let s = stepAxeSwing(makeAxeSwing(), click, DT).state;   // t = 1 step
    const n = Math.floor(AXE_TIMING.H.strikeT / DT);          // steps whose t is still < strikeT
    const early: AxeSide[] = [];
    for (let i = 1; i < n; i++) { const r = stepAxeSwing(s, idle, DT); s = r.state; early.push(...r.strikes); }
    expect(s.t).toBeLessThan(AXE_TIMING.H.strikeT);
    expect(early).toEqual([]);
    expect(stepAxeSwing(s, idle, DT).strikes).toEqual(['H']);   // the very next step crosses strikeT
  });
  it('a large dt steps through the strike and the swing end: one H strike, the held button chains to R', () => {
    const s = stepAxeSwing(makeAxeSwing(), click, DT).state;
    const r = stepAxeSwing(s, { click: false, held: true }, 0.75);
    expect(r.strikes).toEqual(['H']);
    expect(r.state.phase).toBe('swing');
    expect(r.state.side).toBe('R');
  });
  it('cancel returns to idle and no strike fires after it', () => {
    let s = stepAxeSwing(makeAxeSwing(), click, DT).state;
    s = cancelAxeSwing(s);
    expect(run(s, 1).strikes).toEqual([]);
  });
});

describe('axe swing: poses', () => {
  for (const side of ['H', 'R', 'L'] as const) {
    it(`${side}: rest at both ends, no jump between 120 Hz samples`, () => {
      const s0: AxeSwing = { ...makeAxeSwing(), phase: 'swing', side, t: 0 };
      expect(axePose(s0)).toEqual(AXE_REST);
      expect(axePose({ ...s0, t: AXE_TIMING[side].swingSec })).toEqual(AXE_REST);
      let prev = axePose(s0), worst = 0;
      for (let t = DT; t <= AXE_TIMING[side].swingSec; t += DT) {
        const p = axePose({ ...s0, t });
        worst = Math.max(worst, Math.hypot(p.grip[0] - prev.grip[0], p.grip[1] - prev.grip[1], p.grip[2] - prev.grip[2]));
        prev = p;
      }
      expect(worst).toBeLessThan(0.06);   // < 7.2 m/s at the grip: a fast chop, not a teleport
    });
    it(`${side}: strikeT is one of the key times, and the pose at strikeT is that key`, () => {
      const { strikeT } = AXE_TIMING[side];
      expect(axeKeyTimes(side)).toContain(strikeT);
      const key = axeKeys(side).find(k => k.t === strikeT)!;
      const p = axePose({ ...makeAxeSwing(), phase: 'swing', side, t: strikeT });
      for (let c = 0; c < 3; c++) {
        expect(p.grip[c]).toBeCloseTo(key.grip[c]!, 9);
        expect(p.rot[c]).toBeCloseTo(key.rot[c]!, 9);
      }
    });
    it(`${side}: within 1 mm / 1e-3 rad of rest just after the start and just before the end`, () => {
      const s0: AxeSwing = { ...makeAxeSwing(), phase: 'swing', side, t: 0 };
      for (const t of [1e-6, AXE_TIMING[side].swingSec - 1e-6]) {
        const p = axePose({ ...s0, t });
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(p.grip[c]! - AXE_REST.grip[c]!)).toBeLessThan(1e-3);
          expect(Math.abs(p.rot[c]! - AXE_REST.rot[c]!)).toBeLessThan(1e-3);
        }
      }
    });
    it(`${side}: no overshoot past the keys (grip 4 cm, rot 0.15 rad) and the haft turns < 0.3 rad per 120 Hz step`, () => {
      const keys = axeKeys(side), s0: AxeSwing = { ...makeAxeSwing(), phase: 'swing', side, t: 0 };
      let worstRot = 0;
      for (let t = DT / 4; t < AXE_TIMING[side].swingSec; t += DT / 4) {
        const p = axePose({ ...s0, t });
        let i = 0;
        while (i < keys.length - 2 && t >= keys[i + 1]!.t) i++;
        const a = keys[i]!, b = keys[i + 1]!;
        for (let c = 0; c < 3; c++) {
          expect(p.grip[c]!).toBeGreaterThanOrEqual(Math.min(a.grip[c]!, b.grip[c]!) - 0.04);
          expect(p.grip[c]!).toBeLessThanOrEqual(Math.max(a.grip[c]!, b.grip[c]!) + 0.04);
          expect(p.rot[c]!).toBeGreaterThanOrEqual(Math.min(a.rot[c]!, b.rot[c]!) - 0.15);
          expect(p.rot[c]!).toBeLessThanOrEqual(Math.max(a.rot[c]!, b.rot[c]!) + 0.15);
        }
      }
      let q = axePose(s0);
      for (let t = DT; t <= AXE_TIMING[side].swingSec; t += DT) {
        const p = axePose({ ...s0, t });
        worstRot = Math.max(worstRot, Math.hypot(p.rot[0] - q.rot[0], p.rot[1] - q.rot[1], p.rot[2] - q.rot[2]));
        q = p;
      }
      expect(worstRot).toBeLessThan(0.3);
    });
  }
  it('idle pose is the rest pose', () => {
    expect(axePose(makeAxeSwing())).toEqual(AXE_REST);
  });
});

describe('axe swing: blade lines (view space, unit, top end first)', () => {
  it('H is straight down; R runs right-to-left downward; L left-to-right downward', () => {
    expect(AXE_BLADE_DIR.H).toEqual([0, -1, 0]);
    expect(AXE_BLADE_DIR.R[0]).toBeLessThan(0); expect(AXE_BLADE_DIR.R[1]).toBeLessThan(0);
    expect(AXE_BLADE_DIR.L[0]).toBeGreaterThan(0); expect(AXE_BLADE_DIR.L[1]).toBeLessThan(0);
    for (const s of ['H', 'R', 'L'] as const) expect(Math.hypot(...AXE_BLADE_DIR[s])).toBeCloseTo(1, 9);
  });
});
