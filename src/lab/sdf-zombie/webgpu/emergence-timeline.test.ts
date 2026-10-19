// src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts
import { describe, it, expect } from 'vitest';
import { CURVES, DURATION, SHOTS, evalCurve, paramsAt, shotAt, type ParamName } from './emergence-timeline';

const NAMES = Object.keys(CURVES) as ParamName[];
const grid = (step: number) => Array.from({ length: Math.round(DURATION / step) + 1 }, (_, i) => i * step);

describe('emergence timeline', () => {
  it('every curve starts at t = 0, ends at DURATION, ascends strictly and stays within 0..1', () => {
    for (const n of NAMES) {
      const ks = CURVES[n];
      expect(ks[0]!.t, n).toBe(0);
      expect(ks[ks.length - 1]!.t, n).toBe(DURATION);
      for (let i = 1; i < ks.length; i++) expect(ks[i]!.t, `${n} key ${i}`).toBeGreaterThan(ks[i - 1]!.t);
      for (const k of ks) { expect(k.v, n).toBeGreaterThanOrEqual(0); expect(k.v, n).toBeLessThanOrEqual(1); }
    }
  });

  it('starts at rest: nothing pushed, torn, slumped or healed', () => {
    const p = paramsAt(0);
    expect(p.push).toBe(0); expect(p.tear).toBe(0); expect(p.slump).toBe(0); expect(p.heal).toBe(0); expect(p.lipBow).toBe(0);
  });

  it('holds its last value past DURATION and its first before 0', () => {
    expect(paramsAt(DURATION + 5)).toEqual(paramsAt(DURATION));
    expect(paramsAt(-3)).toEqual(paramsAt(0));
  });

  it('push, slump and heal never go backwards', () => {
    for (const n of ['push', 'slump', 'heal'] as const) {
      let prev = -1;
      for (const t of grid(0.05)) { const v = paramsAt(t)[n]; expect(v, `${n} t=${t}`).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    }
  });

  it('the tear only opens until the egg is out, and closes only after', () => {
    const outEnd = SHOTS.find(s => s.id === 'out')!.end;
    let prev = -1;
    for (const t of grid(0.05).filter(t => t <= outEnd)) { const v = paramsAt(t).tear; expect(v, `t=${t}`).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    expect(paramsAt(outEnd).tear).toBe(1);
    expect(paramsAt(DURATION).tear).toBe(0);
  });

  it('the bezel stays slightly warped after the heal (the lip bows, then relaxes but not to zero)', () => {
    expect(paramsAt(DURATION).lipBow).toBeGreaterThan(0.1);
    expect(paramsAt(DURATION).lipBow).toBeLessThan(paramsAt(SHOTS.find(s => s.id === 'out')!.end).lipBow);
  });

  it('is continuous: no parameter jumps more than 0.02 in 10 ms', () => {
    for (const t of grid(0.01)) {
      const a = paramsAt(t), b = paramsAt(t + 0.01);
      for (const n of NAMES) expect(Math.abs(b[n] - a[n]), `${n} t=${t}`).toBeLessThan(0.02);
    }
  });

  it('the shots tile 0..DURATION in order and shotAt finds them', () => {
    expect(SHOTS[0]!.start).toBe(0);
    expect(SHOTS[SHOTS.length - 1]!.end).toBe(DURATION);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i]!.start).toBe(SHOTS[i - 1]!.end);
    for (const s of SHOTS) { expect(shotAt((s.start + s.end) / 2).id).toBe(s.id); expect(shotAt(s.start).id).toBe(s.id); }
    expect(shotAt(DURATION + 9).id).toBe(SHOTS[SHOTS.length - 1]!.id);
    expect(shotAt(-1).id).toBe(SHOTS[0]!.id);
  });

  it('evalCurve interpolates: linear midpoint, smooth midpoint equal at 0.5, smooth is flat at the ends', () => {
    const lin = [{ t: 0, v: 0 }, { t: 2, v: 1 }];
    const smo = [{ t: 0, v: 0 }, { t: 2, v: 1, ease: 'smooth' as const }];
    expect(evalCurve(lin, 1)).toBeCloseTo(0.5, 12);
    expect(evalCurve(smo, 1)).toBeCloseTo(0.5, 12);
    expect(evalCurve(smo, 0.1)).toBeLessThan(evalCurve(lin, 0.1));
    expect(evalCurve(smo, 1.9)).toBeGreaterThan(evalCurve(lin, 1.9));
  });
});
