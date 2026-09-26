import { describe, expect, it } from 'vitest';
import { SELF_SHADOW, selfShadowCfg } from './self-shadow';

describe('self-shadow cfg (spec §6)', () => {
  it('on by default: strength below 1 so shadowed flesh keeps some of the key', () => {
    const c = selfShadowCfg({ enabled: true });
    expect(c.strength).toBeGreaterThan(0);
    expect(c.strength).toBeLessThan(1);
    expect(c.reach).toBeCloseTo(SELF_SHADOW.reach);
  });
  it('the ?selfshadow=0 switch zeroes strength (z = 0 means the march skips it)', () => {
    expect(selfShadowCfg({ enabled: false }).strength).toBe(0);
  });
  it('caps the reach and never exceeds 12 steps', () => {
    const c = selfShadowCfg({ enabled: true, reach: 5 });
    expect(c.reach).toBeLessThanOrEqual(SELF_SHADOW.maxReach);
    expect(SELF_SHADOW.steps).toBeLessThanOrEqual(12);
  });
  it('the camera cut-off is 12 m', () => {
    expect(SELF_SHADOW.maxCamDist).toBe(12);
  });
});
