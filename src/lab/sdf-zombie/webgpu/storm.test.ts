import { describe, expect, it } from 'vitest';
import { STORM, boltEnvelope, stormSchedule, windowLightAt } from './storm';

describe('stormSchedule', () => {
  it('is deterministic for a seed', () => {
    expect(stormSchedule(7, 200)).toEqual(stormSchedule(7, 200));
    expect(stormSchedule(7, 200)).not.toEqual(stormSchedule(8, 200));
  });

  it('keeps the gaps in range', () => {
    const s = stormSchedule(3, 600);
    for (let i = 1; i < s.bolts.length; i++) {
      const gap = s.bolts[i]!.t - s.bolts[i - 1]!.t;
      expect(gap).toBeGreaterThanOrEqual(STORM.boltGap[0]);
      expect(gap).toBeLessThanOrEqual(STORM.boltGap[1]);
    }
    for (let i = 1; i < s.sweeps.length; i++) {
      const gap = s.sweeps[i]!.t - s.sweeps[i - 1]!.t;
      expect(gap).toBeGreaterThanOrEqual(STORM.sweepGap[0]);
      expect(gap).toBeLessThanOrEqual(STORM.sweepGap[1]);
    }
    expect(s.bolts.at(-1)!.t).toBeLessThanOrEqual(600);
  });

  it('strikes on both sides', () => {
    const sides = new Set(stormSchedule(1, 120).bolts.map(b => b.side));
    expect(sides).toEqual(new Set([1, -1]));
  });
});

describe('boltEnvelope', () => {
  it('is 0 outside its life and peaks at 1', () => {
    expect(boltEnvelope(-0.01, 1)).toBe(0);
    expect(boltEnvelope(0.61, 1)).toBe(0);
    let peak = 0;
    for (let a = 0; a < 0.6; a += 0.005) peak = Math.max(peak, boltEnvelope(a, 1));
    expect(peak).toBeCloseTo(1, 2);
  });

  it('flickers: a dip between two spikes', () => {
    expect(boltEnvelope(0.05, 1)).toBeGreaterThan(0.9);
    expect(boltEnvelope(0.1, 1)).toBeLessThan(0.4);
    expect(boltEnvelope(0.17, 1)).toBeGreaterThan(0.6);
  });
});

describe('windowLightAt', () => {
  const bolt = { t: 10, side: 1 as const, z: 30, seed: 5 };
  const sweep = { t: 30, side: -1 as const };
  const s = { bolts: [bolt], sweeps: [sweep] };

  it('is dark between events', () => {
    expect(windowLightAt(s, 5).intensity).toBe(0);
    expect(windowLightAt(s, 20).intensity).toBe(0);
    expect(windowLightAt(s, 5).bolt).toBeNull();
  });

  it('lightning spikes from its side', () => {
    const l = windowLightAt(s, 10.05);
    expect(l.intensity).toBeGreaterThan(5);
    expect(l.bolt).toBe(bolt);
    expect(l.flash).toBeGreaterThan(0.9);
    expect(l.dir[0]).toBeGreaterThan(0);
    expect(l.color[2]).toBeGreaterThanOrEqual(l.color[0]);
  });

  it('a sweep swings along the train, warm', () => {
    const a = windowLightAt(s, 30 + STORM.sweepS * 0.2), b = windowLightAt(s, 30 + STORM.sweepS * 0.8);
    expect(a.intensity).toBeGreaterThan(0);
    expect(Math.sign(a.dir[2])).not.toBe(Math.sign(b.dir[2]));
    expect(a.dir[0]).toBeLessThan(0);
    expect(a.color[0]).toBeGreaterThan(a.color[2]);
    expect(a.flash).toBe(0);
  });

  it('returns unit directions', () => {
    for (const t of [5, 10.05, 30.3, 30.7]) {
      const d = windowLightAt(s, t).dir;
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    }
  });
});
