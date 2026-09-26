// src/lab/sdf-zombie/webgpu/void-portal.test.ts

import { describe, expect, it } from 'vitest';
import { emberWrap, glowAt, insidePortal, ovalDistance, portalFrame, trackHit, trackIntensity, RAIL_HALF_GAUGE } from './void-portal';

const P = { pos: [0, 0, -18] as [number, number, number], yaw: Math.PI, width: 2.2, height: 3.4 };

describe('void portal maths', () => {
  it('frame: facing the viewer at +z, tracks run to -z', () => {
    const f = portalFrame(P);
    expect(f.facing[2]).toBeCloseTo(1); expect(f.back[2]).toBeCloseTo(-1);
  });
  it('insidePortal: the box is width x 0.6 m x height around the base', () => {
    expect(insidePortal(P, [0, 0, -18])).toBe(true);
    expect(insidePortal(P, [0, 0, -18.25])).toBe(true);
    expect(insidePortal(P, [0, 0, -17.5])).toBe(false);
    expect(insidePortal(P, [1.2, 0, -18])).toBe(false);
  });
  it('oval distance: <0 inside, 0 on the rim, >0 outside', () => {
    expect(ovalDistance(0, 0)).toBeLessThan(0);
    expect(ovalDistance(1, 0)).toBeCloseTo(0);
    expect(ovalDistance(0, 1.2)).toBeGreaterThan(0);
  });
  it('a ray through the lower oval hits the ground behind the portal', () => {
    const h = trackHit(P, [0, 1.6, -6], [0, 0.6, -18])!;
    expect(h.depth).toBeGreaterThan(0); expect(Math.abs(h.lateral)).toBeLessThan(1e-6);
    expect(trackHit(P, [0, 1.6, -6], [0, 2.5, -18])).toBeNull(); // looking up: no ground
  });
  it('rails show on-axis, sleepers between them, black by far distance', () => {
    expect(trackIntensity(1, RAIL_HALF_GAUGE)).toBeGreaterThan(0.5);
    expect(trackIntensity(1, 0.3 + 0)).toBeGreaterThanOrEqual(0); // sleeper or gap, never negative
    expect(trackIntensity(1, 3)).toBe(0);
    expect(trackIntensity(80, RAIL_HALF_GAUGE)).toBeLessThan(0.01);
  });
  it('parallax: stepping sideways moves where the ray lands', () => {
    const a = trackHit(P, [0, 1.6, -6], [0, 0.6, -18])!;
    const b = trackHit(P, [2, 1.6, -6], [0, 0.6, -18])!;
    expect(b.lateral).not.toBeCloseTo(a.lateral);
  });
  it('embers wrap into the box around the camera', () => {
    const w = emberWrap([30, 1, -5], [0, 1.6, 0], 24);
    expect(Math.abs(w[0])).toBeLessThanOrEqual(12);
    expect(w[2]).toBe(-5);
  });
  it('glow pool falls off to zero at its radius', () => {
    expect(glowAt(0, 4)).toBeCloseTo(1); expect(glowAt(4, 4)).toBe(0);
  });
});
