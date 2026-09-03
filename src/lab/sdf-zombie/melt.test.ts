import { describe, it, expect } from 'vitest';
import { MELT_TUNING, meltInit, stepMelt, endpointProgress } from './melt';

const REST_Y = [0.02, 0.45, 0.95, 1.55]; // foot, knee, chest, crown

describe('melt state machine', () => {
  it('starts at zero progress with nothing melted', () => {
    const s = meltInit(REST_Y, 0);
    expect(s.t).toBe(0);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBe(0);
    }
  });

  it('advances progress at the tuned rate', () => {
    const s = stepMelt(meltInit(REST_Y, 0), 1);
    expect(s.t).toBeCloseTo(MELT_TUNING.rate, 6);
  });

  it('freezes at 1 and is idempotent past it', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    expect(s.t).toBe(1);
    const frozen = stepMelt(s, 1 / 60);
    expect(frozen.t).toBe(1);
    expect(frozen).toEqual(s);
  });

  it('melts low endpoints before high ones', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 20; i++) s = stepMelt(s, 1 / 60);
    const u = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let i = 1; i < u.length; i++) expect(u[i]!).toBeLessThanOrEqual(u[i - 1]!);
    expect(u[0]!).toBeGreaterThan(u[3]!); // foot strictly ahead of crown
  });

  it('brings every endpoint to full melt by progress 1', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBeCloseTo(1, 6);
    }
  });

  it('endpoint progress never decreases', () => {
    let s = meltInit(REST_Y, 0);
    let prev = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let f = 0; f < 200; f++) {
      s = stepMelt(s, 1 / 60);
      const now = REST_Y.map((_, i) => endpointProgress(s, i));
      for (let i = 0; i < now.length; i++) expect(now[i]!).toBeGreaterThanOrEqual(prev[i]!);
      prev = now;
    }
  });

  it('is deterministic — identical dt sequences give identical states', () => {
    const run = () => {
      let s = meltInit(REST_Y, 0);
      for (let i = 0; i < 100; i++) s = stepMelt(s, 1 / 60);
      return s;
    };
    expect(run()).toEqual(run());
  });
});
