import { describe, expect, it } from 'vitest';
import { SELF_SHADOW, selfShadowCfg } from './self-shadow';

describe('self-shadow cfg (spec §6)', () => {
  it('enabled: strength below 1 so shadowed flesh keeps some of the key', () => {
    const c = selfShadowCfg({ enabled: true });
    expect(c.strength).toBeGreaterThan(0);
    expect(c.strength).toBeLessThan(1);
    expect(c.reach).toBeCloseTo(SELF_SHADOW.reach);
  });
  it('disabled (the default; ?selfshadow=1 opts in) zeroes strength', () => {
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
  it('pins the WGSL literals at the occlusion call site (occlusion.wgsl.ts)', async () => {
    const { MARCH_BODY_LIGHT } = await import('./march.wgsl');
    expect(MARCH_BODY_LIGHT).toContain(`select(${SELF_SHADOW.steps}, 14, wsOn)`);
    expect(MARCH_BODY_LIGHT).toContain(`t < ${SELF_SHADOW.maxCamDist}.0`);
    expect(MARCH_BODY_LIGHT).toContain('select(24.0,');
  });
});
