// src/lab/sdf-zombie/webgpu/portal.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { EMBER_POS, GLOW_POOL, PORTAL_COLOR, PORTAL_H21, PORTAL_VNOISE } from './portal.wgsl';
import { RAIL_HALF_GAUGE, SLEEPER_PITCH_M, TRACK_FADE_M, TRACK_BLACK_M } from './void-portal';

describe('portal.wgsl', () => {
  it('shares its track constants with the twin', () => {
    expect(PORTAL_COLOR).toContain(`abs(abs(lateral) - ${RAIL_HALF_GAUGE})`);
    expect(PORTAL_COLOR).toContain(`fract(depth / ${SLEEPER_PITCH_M})`);
    expect(PORTAL_COLOR).toContain(`exp(-depth / ${TRACK_FADE_M}.0)`);
    expect(PORTAL_COLOR).toContain(`smoothstep(30.0, ${TRACK_BLACK_M}.0, depth)`);
  });
  it('each string declares exactly one fn', () => {
    for (const s of [PORTAL_COLOR, EMBER_POS, GLOW_POOL, PORTAL_H21, PORTAL_VNOISE]) expect(s.trim().startsWith('fn ')).toBe(true);
  });
});
