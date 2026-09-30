// src/lab/sdf-zombie/webgpu/flail-impact.test.ts
import { describe, expect, it } from 'vitest';
import {
  FLAIL_IMPACT_FEEL as F, chainRelax, contact, impactKick, impactOutputs, makeImpactState, makeSpring,
  spring, stepImpact, timeScale, type ImpactState,
} from './flail-impact';

const DT = 1 / 60;

/** Run the time channel frame by frame on UNSCALED dt; returns [t at frame start, scale] pairs. */
function scaleCurve(s: ImpactState, dt: number, frames: number): [number, number][] {
  const out: [number, number][] = [];
  let t = 0;
  for (let i = 0; i < frames; i++) { out.push([t, timeScale(s, dt)]); t += dt; }
  return out;
}

describe('impactKick', () => {
  it('scales R = L < H, and a head hit adds 20%', () => {
    const r = impactKick('R', false), l = impactKick('L', false), h = impactKick('H', false);
    const rh = impactKick('R', true), hh = impactKick('H', true);
    for (const k of ['pitchKick', 'shakeAmp', 'rollAmp', 'fovPunchDeg', 'rigKick'] as const) {
      expect(r[k]).toBeGreaterThan(0);
      expect(l[k]).toBeCloseTo(r[k], 12);
      expect(h[k]).toBeCloseTo(r[k] * 1.4, 12);
      expect(rh[k]).toBeCloseTo(r[k] * 1.2, 12);
      expect(hh[k]).toBeCloseTo(r[k] * 1.4 * 1.2, 12);
    }
    expect(r.pitchKick).toBeCloseTo(0.045, 12);
    expect(r.fovPunchDeg).toBeCloseTo(3, 12);
    expect(r.hitStopSec).toBeCloseTo(0.07, 12);
    expect(h.hitStopSec).toBeCloseTo(0.10, 12);
    expect(r.slowScale).toBe(0.4); expect(r.slowSec).toBe(0.3);
    expect(h.slowScale).toBe(0.35); expect(h.slowSec).toBe(0.4);
    expect(h.hitStopSec).toBeGreaterThan(r.hitStopSec);
    expect(h.slowSec).toBeGreaterThan(r.slowSec);
    expect(h.slowScale).toBeLessThan(r.slowScale);
  });
});

describe('timeScale', () => {
  it('is 1 at rest', () => {
    const s = makeImpactState();
    expect(timeScale(s, DT)).toBe(1);
  });

  it('hit-stops, then ramps monotonically to exactly 1.0 within slowSec, on unscaled dt', () => {
    for (const side of ['R', 'H'] as const) {
      const k = impactKick(side, false);
      const s = makeImpactState();
      contact(s, k, { time: true, view: true });
      const curve = scaleCurve(s, DT, 60);
      const stop = curve.filter(([, v]) => v === F.hitStopScale);
      // The hit-stop covers ceil(hitStopSec / dt) frames.
      expect(stop.length).toBe(Math.ceil(k.hitStopSec / DT - 1e-9));
      const after = curve.slice(stop.length);
      expect(after[0]![1]).toBeCloseTo(k.slowScale, 12);
      let prev = 0;
      for (const [, v] of after) { expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
      const firstOne = after.findIndex(([, v]) => v === 1);
      expect(firstOne).toBeGreaterThan(0);
      // Exactly 1 once slowSec of unscaled time has passed since the ramp began.
      const tRamp0 = after[0]![0];
      expect(after[firstOne]![0] - tRamp0).toBeLessThan(k.slowSec + DT);
      expect(after[firstOne - 1]![0] - tRamp0).toBeLessThan(k.slowSec);
      for (const [, v] of curve) expect(v).toBeGreaterThanOrEqual(F.hitStopScale);
    }
  });

  it('with time off the contact leaves the scale at 1', () => {
    const s = makeImpactState();
    contact(s, impactKick('H', true), { time: false, view: true });
    for (const [, v] of scaleCurve(s, DT, 40)) expect(v).toBe(1);
  });

  it('never returns NaN at dt = 0 or 0.1', () => {
    for (const dt of [0, 0.1]) {
      const s = makeImpactState();
      contact(s, impactKick('R', false), { time: true, view: true });
      for (let i = 0; i < 20; i++) {
        const v = timeScale(s, dt);
        expect(Number.isFinite(v)).toBe(true);
        stepImpact(s, dt);
        const o = impactOutputs(s);
        for (const x of [o.cameraPitch, ...o.shake, o.fovDeg, ...o.rig.pos, ...o.rig.rot]) expect(Number.isFinite(x)).toBe(true);
      }
    }
  });
});

describe('spring', () => {
  it('is stable and exact at a large dt', () => {
    const st = makeSpring();
    st.v = 10;
    for (let i = 0; i < 20; i++) spring(st, 0, 23, 0.1, 0.1);
    expect(Math.abs(st.x)).toBeLessThan(1e-3);
    expect(Number.isFinite(st.x)).toBe(true);
  });
  it('dt = 0 is a no-op', () => {
    const st = makeSpring(); st.x = 0.5; st.v = 1;
    spring(st, 0, 5, 0.5, 0);
    expect(st.x).toBe(0.5); expect(st.v).toBe(1);
  });
});

/** Record a channel for `sec` of 60 Hz frames after one contact. */
function record(pick: (s: ImpactState) => number, sec: number, side: 'R' | 'L' | 'H' = 'R', head = false, dt = DT): number[] {
  const s = makeImpactState();
  contact(s, impactKick(side, head), { time: true, view: true });
  const out: number[] = [pick(s)];
  for (let i = 0; i < Math.round(sec / dt); i++) { stepImpact(s, dt); out.push(pick(s)); }
  return out;
}
const peakAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));
const tailAbs = (xs: number[], fromSec: number) => peakAbs(xs.slice(Math.ceil(fromSec / DT)));

describe('the channels', () => {
  it('camera pitch: peaks at the kick, overshoots a little, settles below 1% in its duration', () => {
    const xs = record(s => impactOutputs(s).cameraPitch, 0.6);
    const peak = Math.max(...xs);
    expect(peak).toBeGreaterThan(0.045 * 0.95);
    expect(peak).toBeLessThan(0.045 * 1.05);
    const over = -Math.min(...xs);
    expect(over / peak).toBeGreaterThan(0.05);   // an overshoot, not a pure exponential
    expect(over / peak).toBeLessThan(0.25);      // a small one
    expect(tailAbs(xs, F.pitch.settleSec) / peak).toBeLessThan(0.01);
  });

  it('shake: judders and decays below 10% by 0.35 s (below 1% by its settle time)', () => {
    for (const i of [0, 1, 2] as const) {
      const xs = record(s => impactOutputs(s).shake[i], 0.6);
      const peak = peakAbs(xs);
      expect(peak).toBeGreaterThan(0);
      // It oscillates (changes sign several times).
      let flips = 0;
      for (let k = 1; k < xs.length; k++) if (Math.sign(xs[k]!) !== Math.sign(xs[k - 1]!) && xs[k] !== 0) flips++;
      expect(flips).toBeGreaterThanOrEqual(3);
      expect(tailAbs(xs, 0.35) / peak).toBeLessThan(0.1);
      expect(tailAbs(xs, F.shake.settleSec) / peak).toBeLessThan(0.01);
    }
    const x = record(s => Math.hypot(impactOutputs(s).shake[0], impactOutputs(s).shake[1]), 0.3);
    // Sampled at 60 Hz a 23 Hz judder rarely lands a frame on its crest.
    expect(peakAbs(x)).toBeGreaterThan(F.shake.amp * 0.4);
    expect(peakAbs(x)).toBeLessThan(F.shake.amp * 1.1);
  });

  it('FOV: pinches by the punch in about 60 ms and is back at exactly 0 by 0.3 s', () => {
    const xs = record(s => impactOutputs(s).fovDeg, 0.5);
    expect(xs[0]).toBe(0);
    const peak = Math.min(...xs);
    expect(peak).toBeCloseTo(-3, 6);
    const tPeak = xs.indexOf(peak) * DT;
    expect(tPeak).toBeGreaterThanOrEqual(0.05);
    expect(tPeak).toBeLessThanOrEqual(0.07);
    expect(tailAbs(xs, 0.3)).toBe(0);
    for (const v of xs) expect(v).toBeLessThanOrEqual(0);
  });

  it('rig: kicks back, up, pitched and rolled; one or two overshoots; settles below 1% in its duration', () => {
    const xs = record(s => impactOutputs(s).rig.pos[2], 0.7);
    const peak = Math.max(...xs);
    expect(peak).toBeGreaterThan(0.10 * 0.95);
    expect(peak).toBeLessThan(0.10 * 1.05);
    // count the lobes above 1% of the peak after the first
    let lobes = 0, sign = 1;
    for (const v of xs) if (Math.abs(v) > 0.01 * peak && Math.sign(v) !== sign) { lobes++; sign = Math.sign(v); }
    expect(lobes).toBeGreaterThanOrEqual(1);
    expect(lobes).toBeLessThanOrEqual(3);
    expect(tailAbs(xs, F.rig.settleSec) / peak).toBeLessThan(0.01);
    const s = makeImpactState();
    contact(s, impactKick('R', false), { time: true, view: true });
    for (let i = 0; i < 2; i++) stepImpact(s, DT);
    const o = impactOutputs(s);
    expect(o.rig.pos[1]).toBeGreaterThan(0);           // up
    expect(o.rig.pos[2]).toBeGreaterThan(0);           // back (view +Z)
    expect(o.rig.rot[0]).toBeGreaterThan(0);           // pitched up
    expect(Math.abs(o.rig.rot[2])).toBeGreaterThan(0); // rolled
    // The peak pitch is 12 degrees.
    const pitch = record(q => impactOutputs(q).rig.rot[0], 0.3);
    expect(Math.abs(Math.max(...pitch) / (12 * Math.PI / 180) - 1)).toBeLessThan(0.05);
  });

  it('H > R > 0 on every channel, and a head hit is bigger still', () => {
    const chans: ((s: ImpactState) => number)[] = [
      s => impactOutputs(s).cameraPitch, s => Math.hypot(impactOutputs(s).shake[0], impactOutputs(s).shake[1]),
      s => impactOutputs(s).shake[2],
      s => impactOutputs(s).fovDeg, s => impactOutputs(s).rig.pos[2],
    ];
    for (const c of chans) {
      // Sampled finely: at 60 Hz the 23 Hz judder's crests alias.
      const r = peakAbs(record(c, 0.4, 'R', false, 1e-3)), h = peakAbs(record(c, 0.4, 'H', false, 1e-3));
      const rh = peakAbs(record(c, 0.4, 'R', true, 1e-3));
      expect(r).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(r);
      expect(rh).toBeGreaterThan(r);
    }
  });

  it('a second contact during a recovery restarts cleanly with no pop', () => {
    const s = makeImpactState();
    contact(s, impactKick('R', false), { time: true, view: true });
    for (let i = 0; i < 8; i++) stepImpact(s, DT);
    const before = impactOutputs(s);
    contact(s, impactKick('L', false), { time: true, view: true });
    const at = impactOutputs(s);
    // The contact changes velocities and the envelope's target, never a value.
    expect(at.cameraPitch).toBe(before.cameraPitch);
    expect(at.fovDeg).toBe(before.fovDeg);
    expect(at.shake).toEqual(before.shake);
    expect(at.rig).toEqual(before.rig);
    // And the next frame moves by no more than a fresh kick's first frame would.
    stepImpact(s, DT);
    const next = impactOutputs(s);
    const fresh = makeImpactState();
    contact(fresh, impactKick('R', false), { time: true, view: true });
    stepImpact(fresh, DT);
    const f1 = impactOutputs(fresh);
    expect(Math.abs(next.fovDeg - at.fovDeg)).toBeLessThanOrEqual(Math.abs(f1.fovDeg) + 1e-9);
    // The FOV pinch restarts to the full punch.
    let min = 0;
    for (let i = 0; i < 10; i++) { stepImpact(s, DT); min = Math.min(min, impactOutputs(s).fovDeg); }
    expect(min).toBeCloseTo(-3, 6);
    // The hit-stop restarted too.
    expect(timeScale(s, DT)).toBe(F.hitStopScale);
  });

  it('view off: a contact moves nothing but the time channel', () => {
    const s = makeImpactState();
    contact(s, impactKick('H', true), { time: true, view: false });
    for (let i = 0; i < 10; i++) {
      stepImpact(s, DT);
      const o = impactOutputs(s);
      expect([o.cameraPitch, ...o.shake, o.fovDeg, ...o.rig.pos, ...o.rig.rot].every(v => v === 0)).toBe(true);
    }
    expect(chainRelax(s, DT)).toBe(1);
  });
});

describe('chainRelax', () => {
  it('relaxes the guide for 50 ms of SIM time after a contact, then gives it back', () => {
    const s = makeImpactState();
    expect(chainRelax(s, DT)).toBe(1);
    contact(s, impactKick('R', false), { time: true, view: true });
    // Scaled (sim) dt during the hit-stop: it takes many frames to spend 50 ms.
    let frames = 0;
    while (chainRelax(s, DT * F.hitStopScale) < 1 && frames < 1000) frames++;
    expect(frames).toBe(Math.ceil(F.chainRelaxSec / (DT * F.hitStopScale) - 1e-9));
    expect(chainRelax(s, DT)).toBe(1);
  });
});
