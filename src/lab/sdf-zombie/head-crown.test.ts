// src/lab/sdf-zombie/head-crown.test.ts
//
import { describe, expect, it } from 'vitest';
import { BRAIN_MESH, brainLaunch, brainLumps } from './head-crown';
import { GORE_COLORS } from './head-pop';
import type { Vec3 } from './types';

describe('the brain mesh gib (spec §14 decision 3)', () => {
  const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
  it('launches up and along the blow at BRAIN_MESH.launch, with a spin, above the crown', () => {
    const crown: Vec3 = [1, 1.7, -2];
    const l = brainLaunch(crown, [1, -0.2, 0], seq([0.5]));
    expect(Math.hypot(...l.vel)).toBeCloseTo(BRAIN_MESH.launch, 6);
    expect(l.vel[1]).toBeGreaterThan(0.8 * BRAIN_MESH.launch);   // mostly up, so it hangs in view
    expect(l.vel[0]).toBeGreaterThan(0.2);                        // and along the blow
    expect(l.vel[2]).toBeCloseTo(0, 6);
    expect(l.pos[1]).toBeGreaterThan(crown[1]);
    const spun = brainLaunch(crown, [1, 0, 0], seq([0.9, 0.1, 0.8, 0.2, 0.95, 0.05]));
    expect(Math.hypot(...spun.angVel)).toBeGreaterThan(2);
  });
  it('rests on its lowest support whatever its roll: the support covers the model bounds', () => {
    // The GLB's bbox (brain.glb POSITION min/max): ±0.0525, ±0.061, ±0.069. The support may not poke out of
    // it by more than 5 mm, and must reach within 1 cm of the bottom and of both poles.
    const S = BRAIN_MESH.support;
    const ext = (axis: 0 | 1 | 2, sign: 1 | -1) => Math.max(...S.map(s => sign * s.c[axis] + s.r));
    expect(ext(0, 1)).toBeLessThan(0.0525 + 0.005);
    expect(ext(1, 1)).toBeLessThan(0.061 + 0.005);
    expect(ext(1, -1)).toBeGreaterThan(0.061 - 0.01);
    expect(ext(2, 1)).toBeGreaterThan(0.069 - 0.01);
    expect(ext(2, -1)).toBeGreaterThan(0.069 - 0.01);
    expect(BRAIN_MESH.radius).toBeGreaterThanOrEqual(0.069);
  });
  it('throws three brain lumps up and outward in the brain colour', () => {
    const lumps = brainLumps([0, 1.7, 0], [0, 0, 1], seq([0.3, 0.7, 0.5, 0.2]));
    expect(lumps).toHaveLength(3);
    for (const p of lumps) {
      expect(p.kind).toBe('gob');
      expect(p.prims[0]!.color).toEqual(GORE_COLORS.brain);
      expect(p.vel![1]).toBeGreaterThan(1);
    }
  });
});
