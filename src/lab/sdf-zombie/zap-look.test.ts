// src/lab/sdf-zombie/zap-look.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createZap, stepZap, ZAP } from './zap';
import { ZAP_LOOKS, ZAP_LOOK_IDS, decodeZapLane, encodeZapLane, setZapLook, strobeRate, zapLook, type ZapLookId } from './zap-look';

const DT = 1 / 60;
const TIER = { cookSec: [50, 60] as [number, number], dies: false, recoverSec: 0.6, star: true, xray: true };
/** The frames a jolt starts on over `sec` of a held arc, and the frames spent in a jolt. */
const strobe = (id: ZapLookId, seed: number, sec = 10) => {
  const s = createZap(seed, TIER, ZAP_LOOKS[id].strobe);
  const starts: number[] = [];
  let was = false, neg = 0;
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    const o = stepZap(s, DT, true, ZAP_LOOKS[id].strobe);
    if (o.invert && !was) starts.push(i);
    if (o.invert) neg++;
    was = o.invert;
  }
  return { starts, negShare: neg / n, perSec: starts.length / sec };
};

describe('the zap look variants', () => {
  afterEach(() => { setZapLook('a'); });

  it('the baseline is the default, with code 0 and the 2026-11-17 strobe', () => {
    expect(zapLook().id).toBe('a');
    expect(ZAP_LOOKS.a.code).toBe(0);
    expect(ZAP_LOOKS.a.strobe.joltSec).toEqual([ZAP.joltSec, ZAP.joltSec]);
    expect(ZAP_LOOKS.a.strobe.gapSec).toEqual([...ZAP.joltGapSec]);
    expect(ZAP_LOOKS.a.arcs).toBe(0);
    expect(ZAP_LOOKS.a.kitFlash).toBe(false);
    expect(ZAP_LOOKS.a.halo).toBe(false);
  });

  it('switches on a known name and ignores anything else', () => {
    expect(setZapLook('b')).toBe('b');
    expect(zapLook().id).toBe('b');
    expect(setZapLook('z')).toBe('b');
    expect(setZapLook(null)).toBe('b');
    expect(setZapLook('c')).toBe('c');
  });

  it('every variant has its own code', () => {
    expect(new Set(ZAP_LOOK_IDS.map(id => ZAP_LOOKS[id].code)).size).toBe(ZAP_LOOK_IDS.length);
  });

  it('the lane of code 0 is the signed glow, to the bit', () => {
    for (const g of [0.001, 0.25, 0.5597, 0.735, 1]) {
      expect(encodeZapLane(g, false, 0)).toBe(g);
      expect(encodeZapLane(g, true, 0)).toBe(-g);
    }
    expect(encodeZapLane(0, true, 2)).toBe(0);
  });

  it('the lane round-trips glow, strobe state and code', () => {
    for (const code of [0, 1, 2]) for (const g of [0.004, 0.25, 0.56, 0.97, 1]) for (const inv of [false, true]) {
      const d = decodeZapLane(encodeZapLane(g, inv, code));
      expect(d.code).toBe(code);
      expect(d.invert).toBe(inv);
      expect(d.glow).toBeCloseTo(g, 6);
    }
    expect(decodeZapLane(0)).toEqual({ glow: 0, invert: false, code: 0 });
  });

  it('b strobes about 3 times a second with the negative frame up about 40% of the time', () => {
    const r = strobe('b', 3);
    expect(r.perSec).toBeGreaterThan(2.6);
    expect(r.perSec).toBeLessThan(3.5);
    expect(r.negShare).toBeGreaterThan(0.3);
    expect(r.negShare).toBeLessThan(0.45);
    const want = strobeRate(ZAP_LOOKS.b.strobe);
    expect(r.perSec).toBeCloseTo(want.joltsPerSec, 0);
  });

  it('c strobes in bursts of 3 to 5 jolts 0.1 s apart', () => {
    const r = strobe('c', 3);
    const gaps = r.starts.slice(1).map((f, i) => (f - r.starts[i]!) * DT);
    const bursts: number[] = [];
    let n = 1;
    for (const g of gaps) { if (g < 0.2) n++; else { bursts.push(n); n = 1; } }
    expect(bursts.length).toBeGreaterThan(6);
    for (const b of bursts) { expect(b).toBeGreaterThanOrEqual(3); expect(b).toBeLessThanOrEqual(5); }
    for (const g of gaps) if (g < 0.2) { expect(g).toBeGreaterThan(0.08); expect(g).toBeLessThan(0.14); }
    expect(r.perSec).toBeGreaterThan(strobe('a', 3).perSec * 2);
  });

  it('every variant strobes harder than the baseline, and the same seed strobes the same', () => {
    const a = strobe('a', 5);
    for (const id of ['b', 'c'] as const) {
      const v = strobe(id, 5);
      expect(v.perSec).toBeGreaterThan(a.perSec * 1.5);
      expect(strobe(id, 5).starts).toEqual(v.starts);
      expect(strobe(id, 6).starts).not.toEqual(v.starts);
    }
  });

  it('a burst under way ends when the arc leaves', () => {
    const s = createZap(3, TIER, ZAP_LOOKS.c.strobe);
    let o = stepZap(s, DT, true, ZAP_LOOKS.c.strobe);
    for (let i = 0; i < 600 && !(o.invert && s.burstLeft > 0); i++) o = stepZap(s, DT, true, ZAP_LOOKS.c.strobe);
    expect(s.burstLeft).toBeGreaterThan(0);
    o = stepZap(s, DT, false, ZAP_LOOKS.c.strobe);
    expect(o.invert).toBe(false);
    expect(s.burstLeft).toBe(0);
  });
});
