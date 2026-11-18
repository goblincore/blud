// src/lab/sdf-zombie/zap-look.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createZap, stepZap, ZAP } from './zap';
import { ZAP_LOOKS, ZAP_LOOK_DEFAULT, ZAP_LOOK_IDS, ZAP_STROBE_REDUCED, setZapReducedFlashes, decodeZapLane, encodeZapLane, setZapLook, strobeRate, zapLook, type ZapLookId } from './zap-look';

const DT = 1 / 60;
const TIER = { cookSec: [50, 60] as [number, number], dies: false, recoverSec: 0.6, star: true, xray: true };
/** The frames a jolt starts on over `sec` of a held arc, and the frames spent in a jolt. */
const strobe = (id: ZapLookId, seed: number, sec = 10, st = ZAP_LOOKS[id].strobe) => {
  const s = createZap(seed, TIER, st);
  const starts: number[] = [];
  let was = false, neg = 0;
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    const o = stepZap(s, DT, true, st);
    if (o.invert && !was) starts.push(i);
    if (o.invert) neg++;
    was = o.invert;
  }
  return { starts, negShare: neg / n, perSec: starts.length / sec };
};

describe('the zap look variants', () => {
  afterEach(() => { setZapLook(ZAP_LOOK_DEFAULT); setZapReducedFlashes(false); });

  it('the game starts in look c; the baseline keeps code 0 and the 2026-11-17 strobe', () => {
    expect(ZAP_LOOK_DEFAULT).toBe('c');
    expect(zapLook().id).toBe('c');
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

  it('reduced flashes: b and c take the slow strobe and keep the rest of their look; off, they have their own', () => {
    for (const id of ['b', 'c'] as const) {
      setZapLook(id);
      expect(zapLook().strobe).toBe(ZAP_LOOKS[id].strobe);
      setZapReducedFlashes(true);
      expect(zapLook()).toEqual({ ...ZAP_LOOKS[id], strobe: ZAP_STROBE_REDUCED });
      setZapReducedFlashes(false);
    }
    setZapLook('a'); setZapReducedFlashes(true);
    expect(zapLook()).toBe(ZAP_LOOKS.a);
  });

  it('reduced flashes: never more than 3 jolts in any one-second window (photosensitivity guidance)', () => {
    for (const seed of [1, 2, 3, 7, 20261118]) {
      const r = strobe('c', seed, 60, ZAP_STROBE_REDUCED);
      expect(r.starts.length).toBeGreaterThan(60);
      const t = r.starts.map(f => f * DT);
      for (let i = 0; i < t.length; i++) expect(t.filter(x => x >= t[i]! && x < t[i]! + 1).length).toBeLessThanOrEqual(3);
    }
    // The baseline, which the setting leaves alone, is inside the same bound.
    const a = strobe('a', 3, 60).starts.map(f => f * DT);
    for (let i = 0; i < a.length; i++) expect(a.filter(x => x >= a[i]! && x < a[i]! + 1).length).toBeLessThanOrEqual(3);
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
